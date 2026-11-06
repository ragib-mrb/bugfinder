import appScript from './app.generated.js';

const CSS = `
:root {
  --bg: #ffffff; --panel: #f6f7f9; --text: #1b1f24; --muted: #57606a; --border: #d0d7de;
  --accent: #0b57d0; --accent-text: #ffffff; --ok: #116329; --warn: #9a6700; --err: #b42318;
  --err-bg: #fef3f2; --warn-bg: #fff8e1;
  --browser: #0b57d0; --server: #8250df; --db: #116329;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117; --panel: #161b22; --text: #e6edf3; --muted: #9da7b3; --border: #30363d;
    --accent: #4493f8; --accent-text: #0d1117; --ok: #3fb950; --warn: #d29922; --err: #f85149;
    --err-bg: #2d1416; --warn-bg: #2b2111;
    --browser: #4493f8; --server: #a371f7; --db: #3fb950;
  }
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--text); }
header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
header h1 { font-size: 16px; margin: 0; }
header .muted { flex: 1; }
main { display: grid; grid-template-columns: minmax(260px, 380px) 1fr; height: calc(100vh - 51px); }
@media (max-width: 760px) { main { grid-template-columns: 1fr; height: auto; } }
aside { border-right: 1px solid var(--border); overflow: auto; background: var(--panel); }
ul { list-style: none; margin: 0; padding: 0; }
li button { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 14px 1fr auto; gap: 8px; width: 100%; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--border); }
li button:hover, li button[aria-current="true"] { background: var(--bg); }
li button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; }
.dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); } .dot.error { background: var(--err); }
.title { font-weight: 600; word-break: break-word; }
.sub { color: var(--muted); font-size: 12px; word-break: break-word; }
.time { color: var(--muted); font-size: 12px; white-space: nowrap; }
section { overflow: auto; padding: 16px 20px; }
h2 { font-size: 16px; margin: 0 0 4px; word-break: break-word; }
h3 { font-size: 13px; margin: 18px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.cause { border: 1px solid var(--err); background: var(--err-bg); border-radius: 8px; padding: 10px 12px; margin-top: 12px; }
.cause.warn { border-color: var(--warn); background: var(--warn-bg); }
.cause strong { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.slow { margin-top: 8px; color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
td { padding: 5px 6px; border-bottom: 1px solid var(--border); vertical-align: top; }
td.off { color: var(--muted); font-family: var(--mono); white-space: nowrap; width: 1%; }
td.side { width: 1%; }
.badge { font: 600 11px var(--mono); padding: 1px 6px; border-radius: 4px; border: 1px solid currentColor; }
.b-browser { color: var(--browser); } .b-server { color: var(--server); } .b-db { color: var(--db); }
tr.error td.text { color: var(--err); } tr.warn td.text { color: var(--warn); }
tr.hit { background: var(--err-bg); }
td.text { font-family: var(--mono); word-break: break-word; }
details pre { font: 12px/1.5 var(--mono); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px; white-space: pre-wrap; word-break: break-word; margin: 6px 0 0; }
.actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.btn { font: 600 13px system-ui, sans-serif; border-radius: 6px; padding: 7px 14px; cursor: pointer; border: 1px solid var(--border); background: var(--panel); color: var(--text); }
.btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.muted { color: var(--muted); }
.empty { padding: 24px; color: var(--muted); }
textarea.report { width: 100%; min-height: 220px; font: 12px var(--mono); margin-top: 10px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
`;

const escapeForScript = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');

/** The story page: HTML, styles and script in one response, no external files. */
export function renderPage(base: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bugfinder</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>bugfinder</h1>
  <span class="muted" id="status">Waiting for activity…</span>
  <button type="button" class="btn" id="clear">Clear</button>
</header>
<main>
  <aside aria-label="Stories"><ul id="stories"></ul></aside>
  <section id="detail" aria-live="polite"><p class="empty">Use your app in another tab. Each click shows up here as a story.</p></section>
</main>
<script>window.__BUGFINDER_BASE__ = ${escapeForScript(base)};</script>
<script>${appScript.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
}
