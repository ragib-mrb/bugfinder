import { createRequire } from 'node:module';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { bugfinder, patchConsole, patchExpressErrors, store, type Story } from '../src/index.js';

const require = createRequire(import.meta.url);
type ExpressModule = typeof import('express');
const versions: [string, string][] = [
  ['express 5', 'express'],
  ['express 4', 'express4'],
];

patchConsole();
for (const [, pkg] of versions) patchExpressErrors(pkg, import.meta.filename);

const stories = async (app: Parameters<typeof request>[0]) =>
  (await request(app).get('/__bugfinder/stories.json').expect(200)).body.stories as Story[];

describe.each(versions)('%s', (_name, pkg) => {
  const express = require(pkg) as ExpressModule;

  const makeApp = () => {
    const app = express();
    app.use(bugfinder(app));
    app.use(express.json());
    app.get('/page', (_req, res) =>
      res.type('html').send('<html><head><title>x</title></head><body>hi</body></html>'),
    );
    app.get('/frag', (_req, res) => res.type('html').send('<p>no head</p>'));
    app.get('/json', (_req, res) => res.json({ ok: true }));
    app.post('/orders', (req, _res) => {
      console.log('charging', req.body.qty);
      throw new Error('payment timed out');
    });
    app.get('/async-fail', async () => {
      await Promise.resolve();
      throw new TypeError('bad thing');
    });
    app.post('/profile', (_req, res) => res.status(422).json({ error: { message: 'bad email' } }));
    app.use(
      (
        _err: unknown,
        _req: unknown,
        res: { status: (n: number) => { json: (v: unknown) => void } },
        _next: unknown,
      ) => res.status(502).json({ error: { message: 'Something went wrong' } }),
    );
    return app;
  };

  beforeEach(() => store.clear());

  it('adds the browser script to HTML pages, and only to HTML', async () => {
    const app = makeApp();
    const page = await request(app).get('/page').expect(200);
    expect(page.text).toContain('<script src="/__bugfinder/client.js" data-bugfinder defer></script></head>');
    expect(Number(page.headers['content-length'])).toBe(Buffer.byteLength(page.text));
    expect((await request(app).get('/frag')).text).toMatch(/^<script src="\/__bugfinder\/client\.js"/);
    expect((await request(app).get('/json')).text).toBe('{"ok":true}');
  });

  it('serves the client script and the story page', async () => {
    const app = makeApp();
    const js = await request(app).get('/__bugfinder/client.js').expect(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.text).toContain('x-bugfinder-request');
    const page = await request(app).get('/__bugfinder').expect(200);
    expect(page.text).toContain('window.__BUGFINDER_BASE__ = "/__bugfinder"');
  });

  it('turns a failing request into a story with the server error as the likely cause', async () => {
    const app = makeApp();
    await request(app)
      .post('/orders')
      .set('x-bugfinder-request', 'r1')
      .set('x-bugfinder-action', 'a1')
      .send({ qty: 2, card: '4242424242424242', password: 'hunter2' })
      .expect(502);
    const [story] = await stories(app);
    expect(story!.id).toBe('a1');
    expect(story!.status).toBe('error');
    expect(story!.cause).toMatchObject({ rule: 'server-error' });
    expect(story!.cause!.text).toContain('Server error in POST /orders: Error: payment timed out');
    expect(story!.cause!.text).toMatch(/\(at server\.test\.ts:\d+\)/);
    const kinds = story!.events.map((e) => `${e.side}:${e.kind}`);
    expect(kinds).toEqual(['server:request', 'server:log', 'server:error']);
    expect(story!.events[1]!.text).toBe('charging 2');
    const req = story!.events[0]!;
    expect(req.data).toMatchObject({
      status: 502,
      route: '/orders',
      body: { qty: 2, card: '[hidden]', password: '[hidden]' },
    });
  });

  // Express 4 itself never catches errors from async handlers (the request hangs), so this is Express 5 only.
  it.runIf(pkg === 'express')('catches errors from async handlers', async () => {
    const app = makeApp();
    await request(app).get('/async-fail').expect(502);
    const [story] = await stories(app);
    expect(story!.cause!.text).toContain('TypeError: bad thing');
    expect(story!.type).toBe('request');
  });

  it('reports 4xx as a warning with the response', async () => {
    const app = makeApp();
    await request(app).post('/profile').send({ email: 'x' }).expect(422);
    const [story] = await stories(app);
    expect(story!.status).toBe('warn');
    expect(story!.cause).toMatchObject({ rule: 'client-status' });
  });

  it('accepts browser events and links them to the server request by header', async () => {
    const app = makeApp();
    await request(app)
      .post('/orders')
      .set('x-bugfinder-request', 'r9')
      .set('x-bugfinder-action', 'a9')
      .send({ qty: 1 });
    const now = Date.now();
    await request(app)
      .post('/__bugfinder/events')
      .set('content-type', 'text/plain')
      .send(
        JSON.stringify([
          {
            t: now - 50,
            side: 'browser',
            kind: 'action',
            text: 'Clicked button "Pay"',
            actionId: 'a9',
            data: { type: 'click', page: 'http://x/' },
          },
          {
            t: now - 40,
            side: 'browser',
            kind: 'request',
            level: 'error',
            text: 'POST /orders → 502',
            actionId: 'a9',
            data: {
              method: 'POST',
              url: 'http://x/orders',
              status: 502,
              requestId: 'r9',
              token: 'secret-token',
            },
          },
          { t: now, side: 'server', kind: 'error', text: 'forged' },
          'junk',
        ]),
      )
      .expect(204);
    const [story] = await stories(app);
    expect(story!.title).toBe('Clicked button "Pay"');
    expect(story!.events.filter((e) => e.side === 'browser')).toHaveLength(2);
    expect(JSON.stringify(story)).not.toContain('forged');
    expect(JSON.stringify(story)).not.toContain('secret-token');
  });

  it('builds a Markdown bug report with a curl command and hidden secrets', async () => {
    const app = makeApp();
    await request(app).post('/orders').set('x-bugfinder-action', 'a2').send({ qty: 3, password: 'hunter2' });
    const md = (await request(app).get('/__bugfinder/report/a2').expect(200)).text;
    expect(md).toMatch(/^## Bug: Server error in POST \/orders/);
    expect(md).toContain("curl -X POST 'http://127.0.0.1");
    expect(md).toContain('"password":"[hidden]"');
    expect(md).not.toContain('hunter2');
    expect(md).toContain('library frame');
    expect(md).toContain(`OS: ${process.platform} ${process.arch}`);
    await request(app).get('/__bugfinder/report/nope').expect(404);
  });

  it('refuses other machines, and does nothing when disabled', async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'socket', { value: { remoteAddress: '203.0.113.9' } });
      next();
    });
    app.use(bugfinder(app));
    expect((await request(app).get('/__bugfinder').expect(403)).body.error.code).toBe('local_only');

    const off = express();
    off.use(bugfinder(off, { enabled: false }));
    off.get('/p', (_req, res) => res.type('html').send('<head></head>'));
    await request(off).get('/__bugfinder').expect(404);
    expect((await request(off).get('/p')).text).toBe('<head></head>');
  });

  it('clears stories', async () => {
    const app = makeApp();
    await request(app).get('/json');
    await request(app).post('/__bugfinder/clear').expect(204);
    expect(await stories(app)).toEqual([]);
  });
});
