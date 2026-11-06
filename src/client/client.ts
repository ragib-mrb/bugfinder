/*
 * Browser part of bugfinder. Loaded from <script src=".../__bugfinder/client.js">.
 * Records clicks, page changes, requests and errors, and sends them to the server.
 * Never records what people type: only labels of what they clicked.
 */

type Kind = 'action' | 'request' | 'console' | 'js-error';
interface Ev {
  t: number;
  side: 'browser';
  kind: Kind;
  level?: 'info' | 'warn' | 'error';
  text: string;
  actionId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
}

const w = window as unknown as { __bugfinderLoaded?: boolean };
if (!w.__bugfinderLoaded) {
  w.__bugfinderLoaded = true;
  start();
}

function start(): void {
  const script = document.currentScript as HTMLScriptElement | null;
  const scriptUrl = new URL(script?.src ?? '/__bugfinder/client.js', location.href);
  const BASE = scriptUrl.href.replace(/\/client\.js(\?.*)?$/, '');
  const ACTION_WINDOW_MS = 15_000;
  const queue: Ev[] = [];
  let current: { id: string; t: number; type: string } | undefined;

  const rid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const isOwn = (url: string) => url.startsWith(BASE);
  const sameOrigin = (url: string) => {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch {
      return false;
    }
  };
  const push = (e: Omit<Ev, 't' | 'side'> & { t?: number }) => {
    queue.push({ t: Date.now(), side: 'browser', ...e });
    if (queue.length > 200) queue.splice(0, queue.length - 200);
  };

  /* ---------- actions ---------- */

  const newAction = (type: string, text: string, extra: Record<string, unknown> = {}) => {
    current = { id: rid('a'), t: Date.now(), type };
    push({
      kind: 'action',
      text,
      actionId: current.id,
      data: { type, page: location.href, userAgent: navigator.userAgent.slice(0, 200), ...extra },
    });
    return current.id;
  };
  /** The action a request or error belongs to: the last one, unless it was long ago. */
  const actionNow = () => {
    if (!current || Date.now() - current.t > ACTION_WINDOW_MS) {
      newAction('background', 'Background activity');
    }
    return current!.id;
  };

  const squash = (s: string | null | undefined, max = 60) =>
    (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const describe = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const input = el as HTMLInputElement;
    const isButtonInput = tag === 'input' && /^(submit|button|reset)$/i.test(input.type);
    const name =
      squash(el.getAttribute('aria-label')) ||
      (tag === 'input' || tag === 'textarea' || tag === 'select'
        ? isButtonInput
          ? squash(input.value)
          : ''
        : squash((el as HTMLElement).innerText)) ||
      squash(el.getAttribute('title')) ||
      squash(el.getAttribute('name')) ||
      (el.id ? `#${el.id}` : '');
    const kind = tag === 'a' ? 'link' : tag === 'button' || isButtonInput ? 'button' : tag;
    const field = tag === 'input' && !isButtonInput ? ` ${input.type || 'text'} field` : '';
    return `${kind}${field}${name ? ` "${name}"` : ''}`;
  };

  document.addEventListener(
    'click',
    (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      const el =
        target.closest(
          'button,a,[role=button],input,select,textarea,summary,label,[onclick],[data-testid]',
        ) ?? target;
      newAction('click', `Clicked ${describe(el)}`);
    },
    true,
  );
  document.addEventListener(
    'submit',
    (ev) => {
      // Clicking a submit button fires a click and then a submit: keep them as one action.
      if (current && current.type === 'click' && Date.now() - current.t < 1000) return;
      const form = ev.target as HTMLFormElement;
      const name =
        form.getAttribute('aria-label') || form.name || form.id || form.getAttribute('action') || '';
      newAction('submit', `Submitted form${name ? ` "${squash(name)}"` : ''}`);
    },
    true,
  );
  const onNavigate = () => newAction('navigate', `Went to ${location.pathname}${location.search}`);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History['pushState']>) => {
      const before = location.href;
      original(...args);
      if (location.href !== before) onNavigate();
    };
  }
  addEventListener('popstate', onNavigate);
  // The page's own request ran before this script, so pass its start time to link it on the server.
  newAction('navigate', `Opened ${location.pathname}${location.search}`, {
    initial: true,
    path: location.pathname + location.search,
    navStart: Math.round(performance.timeOrigin),
  });

  /* ---------- requests ---------- */

  const recordRequest = (
    method: string,
    url: string,
    requestId: string,
    actionId: string,
    started: number,
    status: number,
    errorBody?: string,
    networkError?: string,
  ) => {
    const ms = Math.round(Date.now() - started);
    const shown = (() => {
      try {
        const u = new URL(url, location.href);
        return u.origin === location.origin ? u.pathname + u.search : u.href;
      } catch {
        return url;
      }
    })();
    push({
      t: started,
      kind: 'request',
      level: networkError || status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      text: `${method} ${shown} → ${networkError ? 'failed' : status} (${ms} ms)`,
      actionId,
      requestId,
      data: {
        method,
        url: new URL(url, location.href).href,
        status,
        ms,
        requestId,
        ...(errorBody ? { errorBody: errorBody.slice(0, 2000) } : {}),
        ...(networkError ? { networkError } : {}),
      },
    });
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (isOwn(url)) return originalFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const requestId = rid('r');
    const actionId = actionNow();
    let nextInit = init;
    if (sameOrigin(url)) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('x-bugfinder-request', requestId);
      headers.set('x-bugfinder-action', actionId);
      nextInit = { ...init, headers };
    }
    const started = Date.now();
    try {
      const res = await originalFetch(input, nextInit);
      let errorBody: string | undefined;
      if (res.status >= 400)
        errorBody = await res
          .clone()
          .text()
          .catch(() => undefined);
      recordRequest(method, url, requestId, actionId, started, res.status, errorBody);
      return res;
    } catch (err) {
      recordRequest(
        method,
        url,
        requestId,
        actionId,
        started,
        0,
        undefined,
        (err as Error)?.message ?? 'network error',
      );
      throw err;
    }
  };

  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  type Tracked = XMLHttpRequest & { __bf?: { method: string; url: string } };
  XHR.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
    this.__bf = { method: method.toUpperCase(), url: String(url) };
    return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.open;
  XHR.send = function (this: Tracked, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = this.__bf;
    if (info && !isOwn(info.url)) {
      const requestId = rid('r');
      const actionId = actionNow();
      if (sameOrigin(info.url)) {
        this.setRequestHeader('x-bugfinder-request', requestId);
        this.setRequestHeader('x-bugfinder-action', actionId);
      }
      const started = Date.now();
      this.addEventListener('loadend', () => {
        const text =
          this.status >= 400 && (this.responseType === '' || this.responseType === 'text')
            ? this.responseText
            : undefined;
        recordRequest(
          info.method,
          info.url,
          requestId,
          actionId,
          started,
          this.status,
          text,
          this.status === 0 ? 'network error' : undefined,
        );
      });
    }
    return originalSend.call(this, body);
  };

  /* ---------- errors and console ---------- */

  const stringify = (args: unknown[]) =>
    args
      .map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ')
      .slice(0, 1000);

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push({ kind: 'console', level, text: stringify(args), actionId: actionNow() });
      original(...args);
    };
  }
  addEventListener('error', (ev) => {
    if (!(ev instanceof ErrorEvent) || !ev.message) return;
    const file = (ev.filename || '').split('/').pop();
    push({
      kind: 'js-error',
      level: 'error',
      text: ev.message,
      actionId: actionNow(),
      data: {
        message: ev.message,
        stack: (ev.error as Error | undefined)?.stack?.slice(0, 4000),
        source: file ? `${file}:${ev.lineno}:${ev.colno}` : undefined,
      },
    });
  });
  addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason as unknown;
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : stringify([reason]);
    push({
      kind: 'js-error',
      level: 'error',
      text: `Unhandled promise rejection: ${message}`,
      actionId: actionNow(),
      data: { message, stack: reason instanceof Error ? reason.stack?.slice(0, 4000) : undefined },
    });
  });

  /* ---------- sending ---------- */

  const flush = (useBeacon = false) => {
    if (!queue.length) return;
    const body = JSON.stringify(queue.splice(0, queue.length));
    const url = `${BASE}/events`;
    // text/plain keeps it a "simple" request, so other origins (e.g. a Vite dev server) need no CORS setup.
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      return;
    }
    originalFetch(url, {
      method: 'POST',
      body,
      keepalive: true,
      mode: 'no-cors',
      headers: { 'content-type': 'text/plain' },
    }).catch(() => undefined);
  };
  setInterval(flush, 1000);
  addEventListener('pagehide', () => flush(true));
}
