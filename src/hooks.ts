import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { format } from 'node:util';
import { currentRequest } from './context.js';
import { appFrame, truncate } from './redact.js';
import { store } from './store.js';
import type { Level } from './types.js';

const PATCHED = Symbol.for('bugfinder.patched');
type AnyFn = (...args: unknown[]) => unknown;
const isPatched = (fn: unknown) => typeof fn === 'function' && (fn as { [PATCHED]?: boolean })[PATCHED];
const mark = <T extends AnyFn>(fn: T): T => Object.defineProperty(fn, PATCHED, { value: true });

/** Request id stored on the request object, for code that runs outside the async context. */
export const REQUEST_ID = Symbol.for('bugfinder.requestId');

/* ---------------- console ---------------- */

const CONSOLE_LEVELS: Record<string, Level> = {
  log: 'info',
  info: 'info',
  debug: 'info',
  warn: 'warn',
  error: 'error',
};

/** Records console output written while a request is being handled. Output still goes to the terminal. */
export function patchConsole(target: Console = console): void {
  for (const [method, level] of Object.entries(CONSOLE_LEVELS)) {
    const original = (target as unknown as Record<string, AnyFn>)[method];
    if (typeof original !== 'function' || isPatched(original)) continue;
    (target as unknown as Record<string, AnyFn>)[method] = mark(function (this: unknown, ...args: unknown[]) {
      const ctx = currentRequest();
      if (ctx) {
        store.add({
          t: Date.now(),
          side: 'server',
          kind: 'log',
          level,
          text: truncate(format(...args)),
          requestId: ctx.requestId,
          actionId: ctx.actionId,
        });
      }
      return original.apply(this, args);
    });
  }
}

/* ---------------- Express errors ---------------- */

const seenErrors = new WeakSet<object>();

export function recordServerError(err: unknown, requestId: string | undefined, actionId?: string): void {
  if (err && typeof err === 'object') {
    if (seenErrors.has(err)) return;
    seenErrors.add(err);
  }
  const e = err instanceof Error ? err : new Error(String(err));
  store.add({
    t: Date.now(),
    side: 'server',
    kind: 'error',
    level: 'error',
    text: `${e.name}: ${e.message}`,
    requestId,
    actionId,
    data: {
      message: e.message,
      name: e.name,
      stack: truncate(e.stack ?? '', 4000),
      frame: appFrame(e.stack),
    },
  });
}

/**
 * Express hands every error from a route to `next(err)`. Wrapping each layer's
 * `next` catches the error where it starts, whether or not the app has its own
 * error handler. Works with Express 4 (`handle_request`) and 5 (`handleRequest`).
 */
export function patchExpressErrors(packageName = 'express', from = `${process.cwd()}/package.json`): boolean {
  const require = createRequire(from);
  let expressDir: string;
  let major: number;
  try {
    const pkgPath = require.resolve(`${packageName}/package.json`);
    expressDir = dirname(pkgPath);
    major = Number(String((require(pkgPath) as { version?: string }).version).split('.')[0]);
  } catch {
    return false;
  }
  // Pick by version: a project can have Express 4 and another package's Express 5 side by side.
  const candidates: [() => string, string][] =
    major >= 5
      ? [[() => require.resolve('router/lib/layer.js', { paths: [expressDir] }), 'handleRequest']]
      : [[() => require.resolve(`${expressDir}/lib/router/layer.js`), 'handle_request']];
  for (const [resolveLayer, method] of candidates) {
    let Layer: { prototype: Record<string, AnyFn> };
    try {
      Layer = require(resolveLayer()) as typeof Layer;
    } catch {
      continue;
    }
    const original = Layer.prototype[method];
    if (typeof original !== 'function') continue;
    if (isPatched(original)) return true;
    Layer.prototype[method] = mark(function (this: unknown, req: unknown, res: unknown, next: unknown) {
      const wrappedNext =
        typeof next === 'function'
          ? (err?: unknown, ...rest: unknown[]) => {
              if (err && err !== 'route' && err !== 'router') {
                const r = req as { [REQUEST_ID]?: string };
                const ctx = currentRequest();
                recordServerError(err, r[REQUEST_ID] ?? ctx?.requestId, ctx?.actionId);
              }
              return (next as AnyFn)(err, ...rest);
            }
          : next;
      return original.call(this, req, res, wrappedNext);
    });
    return true;
  }
  return false;
}

/* ---------------- databases ---------------- */

function recordQuery(
  ctx: ReturnType<typeof currentRequest>,
  db: 'mongodb' | 'mysql',
  text: string,
  started: number,
  error?: unknown,
  extra: Record<string, unknown> = {},
): void {
  if (!ctx) return; // only queries made while handling a request belong to a story
  const ms = Date.now() - started;
  const message = error instanceof Error ? error.message : error ? String(error) : undefined;
  store.add({
    t: started,
    side: 'db',
    kind: 'query',
    level: error ? 'error' : 'info',
    text: truncate(text, 500),
    requestId: ctx.requestId,
    actionId: ctx.actionId,
    data: { db, ms, ...(message ? { error: truncate(message, 500) } : {}), ...extra },
  });
}

/** Records Mongoose queries, aggregations and saves: what ran, on which collection, how long, and errors. */
export function patchMongoose(mongoose: unknown): boolean {
  const m = mongoose as {
    Query?: { prototype: Record<string, AnyFn> };
    Aggregate?: { prototype: Record<string, AnyFn> };
    Model?: { prototype: Record<string, AnyFn> };
  };
  if (!m?.Query?.prototype?.exec) return false;

  const wrap = (proto: Record<string, AnyFn>, method: string, describe: (self: never) => string) => {
    const original = proto[method];
    if (typeof original !== 'function' || isPatched(original)) return;
    proto[method] = mark(async function (this: never, ...args: unknown[]) {
      const ctx = currentRequest();
      const started = Date.now();
      let text = method;
      try {
        text = describe(this);
      } catch {
        // describing is best effort
      }
      try {
        const result = await original.apply(this, args);
        recordQuery(ctx, 'mongodb', text, started);
        return result;
      } catch (err) {
        recordQuery(ctx, 'mongodb', text, started, err);
        throw err;
      }
    });
  };

  type Q = { op?: string; model?: { collection?: { collectionName?: string } }; getFilter?: () => object };
  wrap(m.Query.prototype, 'exec', (q: Q) => {
    const keys = Object.keys(q.getFilter?.() ?? {});
    return `${q.model?.collection?.collectionName ?? '?'}.${q.op ?? 'query'}(${keys.length ? `{ ${keys.join(', ')} }` : ''})`;
  });
  type A = { _model?: { collection?: { collectionName?: string } }; pipeline?: () => unknown[] };
  if (m.Aggregate) {
    wrap(m.Aggregate.prototype, 'exec', (a: A) => {
      const stages = (a.pipeline?.() ?? []).map((s) => Object.keys(s as object)[0]).join(', ');
      return `${a._model?.collection?.collectionName ?? '?'}.aggregate([${stages}])`;
    });
  }
  type D = { collection?: { collectionName?: string }; isNew?: boolean };
  if (m.Model) {
    wrap(
      m.Model.prototype,
      'save',
      (d: D) => `${d.collection?.collectionName ?? '?'}.save(${d.isNew ? 'new' : 'update'})`,
    );
  }
  return true;
}

/**
 * Records mysql2 queries (callback and promise styles, connections and pools):
 * the SQL text, how long, and errors. Values are not kept.
 */
export function patchMysql2(mysql2: unknown): boolean {
  const lib = mysql2 as {
    Connection?: { prototype: Record<string, AnyFn> };
    Pool?: { prototype: Record<string, AnyFn> };
  };
  if (!lib?.Connection?.prototype?.query) return false;
  wrapMysql(lib.Connection.prototype, true);
  // A pool can fail before any connection runs the query (e.g. the server is down), so it is hooked too.
  if (lib.Pool?.prototype?.query) wrapMysql(lib.Pool.prototype, false);
  return true;
}

function wrapMysql(proto: Record<string, AnyFn>, isConnection: boolean): void {
  for (const method of ['query', 'execute']) {
    const original = proto[method];
    if (typeof original !== 'function' || isPatched(original)) continue;
    proto[method] = mark(function (this: unknown, ...args: unknown[]) {
      const ctx = currentRequest();
      // A pool's own connections are already counted by the pool hook.
      const fromPool = isConnection && Boolean((this as { _pool?: unknown })._pool);
      if (!ctx || fromPool) return original.apply(this, args);
      const started = Date.now();
      const first = args[0] as string | { sql?: string };
      const sql = typeof first === 'string' ? first : (first?.sql ?? '?');
      const values = Array.isArray(args[1]) ? args[1] : (first as { values?: unknown[] })?.values;
      const extra = values?.length ? { values: `${values.length} value(s), not recorded` } : {};
      let done = false;
      const finish = (err?: unknown) => {
        if (done) return;
        done = true;
        recordQuery(ctx, 'mysql', sql.replace(/\s+/g, ' ').trim(), started, err, extra);
      };
      const cbIndex = args.findIndex((a) => typeof a === 'function');
      if (cbIndex >= 0) {
        const cb = args[cbIndex] as AnyFn;
        args[cbIndex] = function (this: unknown, err: unknown, ...rest: unknown[]) {
          finish(err);
          return cb.call(this, err, ...rest);
        };
        return original.apply(this, args);
      }
      const query = original.apply(this, args) as { once?: (e: string, f: AnyFn) => void } | undefined;
      query?.once?.('error', (err) => finish(err));
      query?.once?.('end', () => finish());
      return query;
    });
  }
}

/** Applies every hook it can, using the app's own installed packages. */
export function autoPatch(from = `${process.cwd()}/package.json`): void {
  patchConsole();
  patchExpressErrors('express', from);
  const require = createRequire(from);
  const tryLoad = (name: string) => {
    try {
      return require(name) as unknown;
    } catch {
      return undefined;
    }
  };
  patchMongoose(tryLoad('mongoose'));
  patchMysql2(tryLoad('mysql2'));
}
