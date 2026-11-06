import type { BugEvent, Cause, Story } from './types.js';

/** How far apart a browser request and a server request can start and still be the same request. */
const LINK_WINDOW_MS = 2000;

const pathOf = (url: unknown): string => {
  try {
    const u = new URL(String(url), 'http://x');
    return u.pathname + u.search;
  } catch {
    return String(url);
  }
};

/**
 * Same-origin requests carry the browser's request and action ids in headers.
 * Cross-origin ones (e.g. a Vite dev server calling the API) can't, so they are
 * matched by method, path and start time instead.
 */
function linkRequests(events: readonly BugEvent[]): Map<string, string> {
  const actionOfRequest = new Map<string, string>();
  const serverRequests = events.filter((e) => e.side === 'server' && e.kind === 'request');
  for (const s of serverRequests) if (s.requestId && s.actionId) actionOfRequest.set(s.requestId, s.actionId);

  const claimed = new Set<string>();
  for (const b of events) {
    if (b.side !== 'browser' || !b.actionId) continue;
    // The first page load is linked to the "Opened …" action by path and navigation start time.
    const pageLoad = b.kind === 'action' && b.data?.initial === true;
    if (b.kind !== 'request' && !pageLoad) continue;
    const browserRequestId = b.data?.requestId as string | undefined;
    if (browserRequestId && actionOfRequest.has(browserRequestId)) continue; // already linked by header
    const method = pageLoad ? 'GET' : String(b.data?.method ?? 'GET').toUpperCase();
    const path = pageLoad ? String(b.data?.path ?? '') : pathOf(b.data?.url);
    const startedAt = pageLoad ? Number(b.data?.navStart ?? b.t) : b.t;
    const match = serverRequests.find(
      (s) =>
        s.requestId &&
        !s.actionId &&
        !claimed.has(s.requestId) &&
        s.data?.method === method &&
        s.data?.path === path &&
        Math.abs(s.t - startedAt) <= LINK_WINDOW_MS,
    );
    if (match?.requestId) {
      claimed.add(match.requestId);
      actionOfRequest.set(match.requestId, b.actionId);
    }
  }
  return actionOfRequest;
}

const status = (e: BugEvent) => Number(e.data?.status ?? 0);

/** Looks for the most likely cause, deepest first: database, server error, status code, browser. */
export function findCause(events: BugEvent[]): Cause | undefined {
  const found = (rule: Cause['rule'], e: BugEvent, text: string): Cause => ({ rule, eventId: e.id, text });
  const requestLabel = (requestId?: string) => {
    const r = events.find((e) => e.side === 'server' && e.kind === 'request' && e.requestId === requestId);
    return r ? `${r.data?.method} ${r.data?.route ?? r.data?.path}` : undefined;
  };

  const dbError = events.find((e) => e.kind === 'query' && e.data?.error);
  if (dbError) {
    const where = requestLabel(dbError.requestId);
    return found(
      'db-error',
      dbError,
      `Database query failed${where ? ` in ${where}` : ''}: ${dbError.text} → ${dbError.data?.error}`,
    );
  }
  const serverError = events.find((e) => e.side === 'server' && e.kind === 'error');
  if (serverError) {
    const where = requestLabel(serverError.requestId);
    const frame = serverError.data?.frame ? ` (at ${serverError.data.frame})` : '';
    return found(
      'server-error',
      serverError,
      `Server error${where ? ` in ${where}` : ''}: ${serverError.text}${frame}`,
    );
  }
  const server5xx = events.find((e) => e.kind === 'request' && status(e) >= 500);
  if (server5xx) {
    const label = `${server5xx.data?.method} ${server5xx.data?.route ?? server5xx.data?.path ?? pathOf(server5xx.data?.url)}`;
    const body = server5xx.data?.errorBody ? `: ${String(server5xx.data.errorBody).slice(0, 200)}` : '';
    return found('server-status', server5xx, `${label} returned ${status(server5xx)}${body}`);
  }
  const jsError = events.find((e) => e.kind === 'js-error');
  if (jsError) {
    const source = jsError.data?.source ? ` (at ${jsError.data.source})` : '';
    return found('browser-error', jsError, `Browser error: ${jsError.text}${source}`);
  }
  const client4xx = events.find((e) => e.kind === 'request' && status(e) >= 400);
  if (client4xx) {
    const label = `${client4xx.data?.method} ${client4xx.data?.route ?? client4xx.data?.path ?? pathOf(client4xx.data?.url)}`;
    const body = client4xx.data?.errorBody ? `: ${String(client4xx.data.errorBody).slice(0, 200)}` : '';
    return found('client-status', client4xx, `${label} returned ${status(client4xx)}${body}`);
  }
  const consoleError = events.find(
    (e) => e.side === 'browser' && e.kind === 'console' && e.level === 'error',
  );
  if (consoleError) return found('console-error', consoleError, `Console error: ${consoleError.text}`);
  return undefined;
}

function findSlowest(events: BugEvent[], slowMs: number): Story['slowest'] {
  let best: Story['slowest'];
  for (const e of events) {
    const ms = Number(e.data?.ms ?? 0);
    if ((e.kind !== 'request' && e.kind !== 'query') || ms < slowMs) continue;
    if (
      e.kind === 'request' &&
      e.side === 'browser' &&
      events.some((s) => s.side === 'server' && s.requestId === e.data?.requestId)
    ) {
      continue; // prefer the server-side view of the same request
    }
    if (!best || ms > best.ms) best = { ms, text: e.text };
  }
  return best;
}

/** Requests browsers and tools make on their own, which are not worth a story of their own. */
const isNoise = (request: BugEvent) =>
  request.data?.method === 'HEAD' ||
  /^\/(favicon\.ico|apple-touch-icon[\w.-]*\.png|robots\.txt|\.well-known\/)/.test(
    String(request.data?.path ?? ''),
  );

/** Groups events into one story per user action, newest first. */
export function buildStories(all: readonly BugEvent[], options: { slowMs?: number } = {}): Story[] {
  const slowMs = options.slowMs ?? 500;
  const actionOfRequest = linkRequests(all);
  const groups = new Map<string, BugEvent[]>();
  const actions = new Map<string, BugEvent>();

  for (const e of all) {
    if (e.kind === 'action' && e.actionId) actions.set(e.actionId, e);
    const key =
      e.actionId ??
      (e.requestId ? actionOfRequest.get(e.requestId) : undefined) ??
      (e.requestId ? `req:${e.requestId}` : undefined);
    if (!key) continue;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(e);
  }

  const stories: Story[] = [];
  for (const [id, events] of groups) {
    events.sort((a, b) => a.t - b.t || a.id - b.id);
    const action = actions.get(id);
    const request = events.find((e) => e.side === 'server' && e.kind === 'request');
    if (!action && !request) continue; // stray events with nothing to hang them on
    if (!action && isNoise(request!)) continue;
    const cause = findCause(events);
    const warn = events.some((e) => e.level === 'warn' || (e.kind === 'request' && status(e) >= 400));
    stories.push({
      id,
      type: action ? String(action.data?.type ?? 'action') : 'request',
      title: action ? action.text : `${request!.data?.method} ${request!.data?.path}`,
      t: events[0]!.t,
      page: action ? (action.data?.page as string | undefined) : undefined,
      status:
        cause && cause.rule !== 'client-status' && cause.rule !== 'console-error'
          ? 'error'
          : cause || warn
            ? 'warn'
            : 'ok',
      cause,
      slowest: findSlowest(events, slowMs),
      events,
    });
  }
  return stories.sort((a, b) => b.t - a.t);
}
