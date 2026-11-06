# bugfinder

Every click in your app becomes a **story**: the click, the requests it made, what the server logged, the database queries it ran, and the error at the end. bugfinder points at the likely cause and gives you a bug report you can paste into an issue.

One line for Express. No SDK in your frontend, no account, nothing leaves your machine.

```js
app.use(bugfinder(app));
```

Then open `http://localhost:3000/__bugfinder` next to your app.

```
Clicked button "Pay now"                                    ● error

LIKELY CAUSE
Server error in POST /api/orders: TimeoutError: payment provider timed out after 3000ms (at billing.js:47)

+0.00s  browser  POST /api/orders → 502 (62 ms)
+0.00s  server   POST /api/orders → 502 (24 ms)
+0.03s  server   charging card { amount: 240 }
+0.03s  server   TimeoutError: payment provider timed out after 3000ms
```

Note that the app's own error handler showed users a generic "Something went wrong". bugfinder still found the real error and the line it came from.

## Why

- Your browser's devtools see the click and the 502, but not why the server failed.
- Your server logs see the error, but not which click caused it.
- Hosted tools (Sentry, LogRocket) need SDKs, accounts and configuration on both sides.

bugfinder joins both halves on your machine, while you develop.

## Install

```bash
npm install --save-dev @ragib.mrb/bugfinder
```

```js
import express from 'express';
import { bugfinder } from '@ragib.mrb/bugfinder'; // import it before your routes and database code

const app = express();
app.use(bugfinder(app)); // add it first
app.use(express.json());
// …your routes…
```

CommonJS works too: `const { bugfinder } = require('@ragib.mrb/bugfinder');`

### Frontend on another dev server (Vite, Next.js, CRA…)

bugfinder adds its script to HTML pages your Express app serves. If your pages come from another dev server, add one tag to your `index.html` (development only):

```html
<script src="http://localhost:3000/__bugfinder/client.js"></script>
```

Requests from that page to your API are linked to the right click by method, path and time, so you don't need any CORS changes.

## What it records

| Where    | What                                                                                                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser  | clicks and form submits (the label of what was clicked, never what was typed), page changes, every `fetch` and `XMLHttpRequest` (method, URL, status, time, error responses), `console.error`/`console.warn`, uncaught errors and promise rejections |
| Server   | every request (route, status, time), `console` output written while handling it, errors passed to Express (with the app's own line), and the body of failed requests                                                                                 |
| Database | **Mongoose** queries, aggregations and saves (collection, operation, filter keys, time, error) and **mysql2** queries, pools included (SQL text, time, error, never the values)                                                                      |

Each browser request gets an ID header (same-origin requests only), so the server side is joined to the click that caused it.

## Likely cause

bugfinder looks for the deepest failure first:

1. a failed database query,
2. a server error (with the first line of your own code),
3. a 5xx response,
4. a browser error,
5. a 4xx response (with the server's message),
6. a `console.error` in the browser.

It also shows the **slowest step** (any request or query over 500 ms).

## Bug report

**Copy bug report** puts Markdown on your clipboard with:

- what happened (the likely cause),
- steps to reproduce (the page and the clicks),
- the failing request as a `curl` command,
- the error with library frames folded away,
- the timeline of logs, queries and requests,
- the Node and browser versions.

## Options

```js
app.use(
  bugfinder(app, {
    path: '/__bugfinder', // where the story page lives
    enabled: true, // default: off when NODE_ENV is "production"
    inject: true, // add the browser script to HTML pages
    localOnly: true, // only answer requests from this machine
    maxEvents: 20000, // events kept in memory
    slowMs: 500, // what counts as slow
  }),
);
```

## Privacy and safety

- Off in production unless you turn it on. Set `BUGFINDER=off` to skip its hooks entirely.
- Only answers requests from `localhost` by default.
- Never records what people type into fields: clicks are recorded by label only.
- Request bodies are kept only for failed requests, and any key that looks secret (password, token, card, cvv, api key, cookie, session…) is replaced with `[hidden]`.
- SQL values and Mongo filter values are never kept.
- Everything stays in memory in your app's process and is gone when it stops. The page loads nothing from the internet.

## Limits

- Express 4 and 5 only, for now. Fastify, Next.js route handlers and PostgreSQL are planned.
- Express 4 doesn't catch errors thrown in `async` route handlers by itself (the request hangs). Use Express 5, or wrap the handler, and bugfinder will see the error.
- Import bugfinder before your database code, so its hooks are in place before queries run.

## Develop

```bash
npm install
npm test
npm run example   # demo shop with planted bugs on http://localhost:3078
```

## License

[MIT](LICENSE)
