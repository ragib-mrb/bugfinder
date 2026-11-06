/* The story page's browser code. Bundled into a string at build time. */

interface Ev {
  id: number;
  t: number;
  side: 'browser' | 'server' | 'db';
  kind: string;
  level?: string;
  text: string;
  data?: Record<string, unknown>;
}
interface Story {
  id: string;
  title: string;
  type: string;
  t: number;
  page?: string;
  status: 'ok' | 'warn' | 'error';
  cause?: { text: string; rule: string; eventId: number };
  slowest?: { text: string; ms: number };
  events: Ev[];
}

const BASE = (window as unknown as { __BUGFINDER_BASE__: string }).__BUGFINDER_BASE__;
const listEl = document.getElementById('stories') as HTMLUListElement;
const detailEl = document.getElementById('detail') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;

let stories: Story[] = [];
let selected: string | undefined;
let lastSignature = '';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function renderList() {
  listEl.replaceChildren();
  for (const s of stories) {
    const btn = el(
      'button',
      { type: 'button' },
      el('span', { className: `dot ${s.status}`, title: s.status }),
      el(
        'span',
        {},
        el('div', { className: 'title' }, s.title),
        el('div', { className: 'sub' }, s.cause?.text ?? `${s.events.length} events`),
      ),
      el('span', { className: 'time' }, clock(s.t)),
    );
    if (s.id === selected) btn.setAttribute('aria-current', 'true');
    btn.addEventListener('click', () => {
      selected = s.id;
      renderList();
      renderDetail();
    });
    listEl.append(el('li', {}, btn));
  }
  if (!stories.length) listEl.append(el('li', { className: 'empty' }, 'No activity yet.'));
}

function renderDetail() {
  const s = stories.find((x) => x.id === selected);
  if (!s) return;
  const parts: Node[] = [el('h2', {}, s.title)];
  if (s.page) parts.push(el('div', { className: 'muted' }, s.page));
  if (s.cause) {
    parts.push(
      el(
        'div',
        { className: `cause ${s.status === 'warn' ? 'warn' : ''}` },
        el('strong', {}, 'Likely cause'),
        s.cause.text,
      ),
    );
  }
  if (s.slowest)
    parts.push(el('div', { className: 'slow' }, `Slowest step: ${s.slowest.text} (${s.slowest.ms} ms)`));

  const copy = el('button', { type: 'button', className: 'btn primary' }, 'Copy bug report');
  const show = el('button', { type: 'button', className: 'btn' }, 'Show report');
  const reportBox = el('div');
  const loadReport = async () => {
    const res = await fetch(`${BASE}/report/${encodeURIComponent(s.id)}`);
    return res.ok ? res.text() : Promise.reject(new Error('This story is no longer in memory.'));
  };
  copy.addEventListener('click', () => {
    void loadReport()
      .then((md) => navigator.clipboard.writeText(md))
      .then(
        () => (copy.textContent = 'Copied'),
        () => (copy.textContent = 'Copy failed: use Show report'),
      )
      .finally(() => setTimeout(() => (copy.textContent = 'Copy bug report'), 2000));
  });
  show.addEventListener('click', () => {
    void loadReport().then(
      (md) =>
        reportBox.replaceChildren(
          el('textarea', { className: 'report', value: md, readOnly: true, ariaLabel: 'Bug report' }),
        ),
      (err: Error) => reportBox.replaceChildren(el('p', { className: 'muted' }, err.message)),
    );
  });
  parts.push(el('div', { className: 'actions' }, copy, show), reportBox);

  parts.push(el('h3', {}, 'Timeline'));
  const table = el('table');
  for (const e of s.events) {
    const text = el('td', { className: 'text' }, e.text);
    const stack = (e.data?.stack as string | undefined) || undefined;
    const extra = e.data?.errorBody ?? e.data?.error ?? e.data?.body;
    if (stack || extra) {
      text.append(
        el(
          'details',
          {},
          el('summary', {}, 'details'),
          el('pre', {}, stack ?? (typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2))),
        ),
      );
    }
    const row = el(
      'tr',
      { className: `${e.level ?? ''} ${s.cause?.eventId === e.id ? 'hit' : ''}` },
      el('td', { className: 'off' }, `+${((e.t - s.t) / 1000).toFixed(2)}s`),
      el('td', { className: 'side' }, el('span', { className: `badge b-${e.side}` }, e.side)),
      text,
    );
    table.append(row);
  }
  parts.push(table);
  detailEl.replaceChildren(...parts);
}

async function refresh() {
  try {
    const res = await fetch(`${BASE}/stories.json`, { cache: 'no-store' });
    const data = (await res.json()) as { stories: Story[] };
    const signature = JSON.stringify(data.stories.map((s) => [s.id, s.events.length, s.status]));
    if (signature === lastSignature) return;
    lastSignature = signature;
    stories = data.stories;
    const errors = stories.filter((s) => s.status === 'error').length;
    statusEl.textContent = `${stories.length} stories${errors ? ` · ${errors} with errors` : ''} · updates live`;
    if (!selected || !stories.some((s) => s.id === selected)) selected = stories[0]?.id;
    renderList();
    renderDetail();
  } catch {
    statusEl.textContent = 'Lost contact with the app. Is it still running?';
  }
}

clearBtn.addEventListener('click', () => {
  void fetch(`${BASE}/clear`, { method: 'POST' }).then(() => {
    selected = undefined;
    lastSignature = '';
    detailEl.replaceChildren(el('p', { className: 'empty' }, 'Cleared. New activity will show up here.'));
    return refresh();
  });
});

void refresh();
setInterval(() => void refresh(), 1500);
