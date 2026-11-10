import { newId, requestContext } from './context.js';
import { REQUEST_ID } from './hooks.js';
import { injectIntoHtml } from './inject.js';
import { redact, truncate } from './redact.js';
import { buildReport } from './report.js';
import { store } from './store.js';
import { buildStories } from './stories.js';
import clientScript from './client/bundle.generated.js';
import { renderPage } from './ui/page.js';
import type { BugfinderOptions, IncomingEvent, Side } from './types.js';

interface Req {
  method: string;
  path: string;
  originalUrl?: string;
  url: string;
  baseUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  route?: { path?: unknown };
  socket?: { remoteAddress?: string };
  on(event: 'data', cb: (chunk: Buffer) => void): void;
  on(event: 'end' | 'error', cb: (err?: unknown) => void): void;
  [REQUEST_ID]?: string;
}
interface Res {
  statusCode: number;
  headersSent: boolean;
  setHeader(name: string, value: string | number): void;
  getHeader(name: string): unknown;
  removeHeader(name: string): void;
  write: (...args: never[]) => boolean;
  end: (...args: never[]) => unknown;
  on(event: 'finish' | 'close', cb: () => void): void;
  writableEnded?: boolean;
}
type Next = (err?: unknown) => void;
export type BugfinderMiddleware = (req: Req, res: Res, next: Next) => void;

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const HEADER_REQUEST = 'x-bugfinder-request';
const HEADER_ACTION = 'x-bugfinder-action';
const MAX_BODY = 512 * 1024;
const SIDES = new Set<Side>(['browser']);
const BROWSER_KINDS = new Set(['action', 'request', 'console', 'js-error']);

const header = (req: Req, name: string) => {
  const v = req.headers[name];
  return typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : undefined;
};

function send(res: Res, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  (res.end as (b: string) => void)(body);
}
const sendJson = (res: Res, status: number, value: unknown) =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
const sendError = (res: Res, status: number, code: string, message: string) =>
  sendJson(res, status, { error: { code, message } });

function readBody(req: Req): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () =>
      size > MAX_BODY ? reject(new Error('too large')) : resolve(Buffer.concat(chunks).toString('utf8')),
    );
    req.on('error', reject);
  });
}

/** Keeps only well-formed browser events, with sizes capped. */
export function cleanBrowserEvents(input: unknown): IncomingEvent[] {
  if (!Array.isArray(input)) return [];
  const out: IncomingEvent[] = [];
  for (const raw of input.slice(0, 500)) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (!SIDES.has(e.side as Side) || !BROWSER_KINDS.has(String(e.kind))) continue;
    const t = Number(e.t);
    out.push({
      t: Number.isFinite(t) ? t : Date.now(),
      side: 'browser',
      kind: e.kind as IncomingEvent['kind'],
      level: e.level === 'error' || e.level === 'warn' ? e.level : 'info',
      text: truncate(String(e.text ?? ''), 1000),
      actionId: typeof e.actionId === 'string' ? e.actionId.slice(0, 64) : undefined,
      requestId: typeof e.requestId === 'string' ? e.requestId.slice(0, 64) : undefined,
      data: e.data && typeof e.data === 'object' ? (redact(e.data) as Record<string, unknown>) : undefined,
    });
  }
  return out;
}

/**
 * Express middleware. Add it early: `app.use(bugfinder(app))`.
 * Records each request, links it to the click that caused it, and serves the
 * story page at `/__bugfinder`.
 */
export function bugfinder(_app?: unknown, options: BugfinderOptions = {}): BugfinderMiddleware {
  const enabled = options.enabled ?? process.env.NODE_ENV !== 'production';
  if (!enabled) return (_req, _res, next) => next();
  const base = `/${(options.path ?? '/__bugfinder').replace(/^\/+|\/+$/g, '')}`;
  const inject = options.inject ?? true;
  const localOnly = options.localOnly ?? true;
  const slowMs = options.slowMs ?? 500;
  if (options.maxEvents) store.setMax(options.maxEvents);

  return function bugfinderMiddleware(req, res, next) {
    const isOwn = req.path === base || req.path.startsWith(`${base}/`);
    if (isOwn) {
      void handleOwn(req, res, base, localOnly, slowMs).catch((err) => next(err));
      return;
    }

    const requestId = header(req, HEADER_REQUEST) ?? newId('r');
    const actionId = header(req, HEADER_ACTION);
    req[REQUEST_ID] = requestId;
    const started = Date.now();
    const path = (req.originalUrl ?? req.url).slice(0, 500);
    const event = store.add({
      t: started,
      side: 'server',
      kind: 'request',
      level: 'info',
      text: `${req.method} ${path}`,
      requestId,
      actionId,
      data: { method: req.method, path, requestId },
    });

    let recorded = false;
    const finish = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const status = aborted ? 0 : res.statusCode;
      const route =
        req.route?.path !== undefined ? `${req.baseUrl ?? ''}${String(req.route.path)}` : undefined;
      const failed = status >= 400 || aborted;
      store.update(event.id, {
        level: status >= 500 || aborted ? 'error' : status >= 400 ? 'warn' : 'info',
        text: `${req.method} ${path} → ${aborted ? 'aborted' : status} (${Date.now() - started} ms)`,
        data: {
          status,
          ms: Date.now() - started,
          ...(route ? { route } : {}),
          ...(failed && req.body !== undefined && typeof req.body === 'object'
            ? { body: redact(req.body) }
            : {}),
        },
      });
    };
    res.on('finish', () => finish(false));
    res.on('close', () => finish(!res.writableEnded));

    if (inject) {
      const tag = `<script src="${base}/client.js" data-bugfinder defer></script>`;
      injectIntoHtml(req, res, tag);
    }
    requestContext.run({ requestId, actionId }, next);
  };
}

async function handleOwn(
  req: Req,
  res: Res,
  base: string,
  localOnly: boolean,
  slowMs: number,
): Promise<void> {
  if (localOnly && !LOOPBACK.test(req.socket?.remoteAddress ?? '')) {
    return sendError(res, 403, 'local_only', 'bugfinder only answers requests from this machine.');
  }
  const sub = req.path.slice(base.length).replace(/\/+$/, '') || '/';
  const fullBase = `${req.baseUrl ?? ''}${base}`;

  if (req.method === 'GET' && sub === '/')
    return send(res, 200, 'text/html; charset=utf-8', renderPage(fullBase));
  if (req.method === 'GET' && sub === '/client.js') {
    return send(res, 200, 'text/javascript; charset=utf-8', clientScript);
  }
  if (req.method === 'GET' && sub === '/stories.json') {
    return sendJson(res, 200, { stories: buildStories(store.all(), { slowMs }).slice(0, 200) });
  }
  const report = /^\/report\/([\w:-]{1,80})$/.exec(sub);
  if (req.method === 'GET' && report) {
    const story = buildStories(store.all(), { slowMs }).find((s) => s.id === report[1]);
    if (!story) return sendError(res, 404, 'not_found', 'That story is no longer in memory.');
    const host = String(req.headers.host ?? 'localhost');
    const userAgent = story.events.find((e) => e.kind === 'action')?.data?.userAgent as string | undefined;
    const md = buildReport(story, {
      origin: `http://${host}`,
      os: `${process.platform} ${process.arch}`,
      node: process.version,
      userAgent,
    });
    return send(res, 200, 'text/markdown; charset=utf-8', md);
  }
  if (req.method === 'POST' && sub === '/events') {
    let parsed: unknown;
    try {
      // A body parser placed before bugfinder may have read the body already.
      if (Array.isArray(req.body)) parsed = req.body;
      else parsed = JSON.parse(typeof req.body === 'string' ? req.body : await readBody(req));
    } catch {
      return sendError(res, 400, 'bad_events', 'Events must be a JSON array.');
    }
    for (const e of cleanBrowserEvents(parsed)) store.add(e);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return send(res, 204, 'text/plain', '');
  }
  if (req.method === 'POST' && sub === '/clear') {
    store.clear();
    return send(res, 204, 'text/plain', '');
  }
  return sendError(res, 404, 'not_found', 'This bugfinder page does not exist.');
}
