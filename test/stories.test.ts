import { describe, expect, it } from 'vitest';
import { appFrame, cleanStack, redact } from '../src/redact.js';
import { buildStories, findCause } from '../src/stories.js';
import { injectTag } from '../src/inject.js';
import { buildReport } from '../src/report.js';
import type { BugEvent, Story } from '../src/types.js';

let id = 0;
const ev = (e: Partial<BugEvent>): BugEvent => ({
  id: ++id,
  t: 1000,
  side: 'server',
  kind: 'request',
  text: '',
  ...e,
});

describe('stories', () => {
  it('links cross-origin requests by method, path and time', () => {
    const events = [
      ev({
        side: 'browser',
        kind: 'action',
        actionId: 'a1',
        text: 'Clicked "Pay"',
        data: { type: 'click' },
        t: 1000,
      }),
      ev({
        side: 'browser',
        kind: 'request',
        actionId: 'a1',
        t: 1010,
        data: { method: 'POST', url: 'http://localhost:5173/api/pay?x=1', status: 500 },
      }),
      ev({ requestId: 'r1', t: 1100, data: { method: 'POST', path: '/api/pay?x=1', status: 500 } }),
      ev({ requestId: 'r2', t: 9000, data: { method: 'POST', path: '/api/pay?x=1', status: 200 } }),
    ];
    const stories = buildStories(events);
    const pay = stories.find((s) => s.id === 'a1')!;
    expect(pay.events.map((e) => e.requestId ?? e.kind)).toEqual(['action', 'request', 'r1']);
    expect(stories.find((s) => s.id === 'req:r2')).toBeDefined(); // too far apart in time to link
  });

  it('links the first page load to the "Opened" action', () => {
    const stories = buildStories([
      ev({ requestId: 'r1', t: 990, data: { method: 'GET', path: '/shop', status: 200 } }),
      ev({
        side: 'browser',
        kind: 'action',
        actionId: 'a1',
        text: 'Opened /shop',
        t: 1500,
        data: { type: 'navigate', initial: true, path: '/shop', navStart: 980 },
      }),
    ]);
    expect(stories).toHaveLength(1);
    expect(stories[0]!.events).toHaveLength(2);
  });

  it('hides HEAD and favicon requests that belong to no action', () => {
    const stories = buildStories([
      ev({ requestId: 'r1', data: { method: 'HEAD', path: '/' } }),
      ev({ requestId: 'r2', data: { method: 'GET', path: '/favicon.ico', status: 404 } }),
      ev({ requestId: 'r3', data: { method: 'GET', path: '/api', status: 200 } }),
    ]);
    expect(stories.map((s) => s.id)).toEqual(['req:r3']);
  });

  it('prefers the deepest cause: database, then server error, then status, then browser', () => {
    const req = ev({
      requestId: 'r1',
      data: { method: 'GET', path: '/stock/1', route: '/stock/:id', status: 502 },
    });
    const serverError = ev({
      kind: 'error',
      requestId: 'r1',
      text: 'Error: boom',
      data: { frame: 'stock.js:9' },
    });
    const db = ev({
      side: 'db',
      kind: 'query',
      requestId: 'r1',
      text: 'SELECT 1',
      data: { error: 'ECONNREFUSED' },
    });
    const js = ev({
      side: 'browser',
      kind: 'js-error',
      text: 'TypeError: x',
      data: { source: 'app.js:3:1' },
    });
    expect(findCause([req, serverError, db, js])).toMatchObject({
      rule: 'db-error',
      text: 'Database query failed in GET /stock/:id: SELECT 1 → ECONNREFUSED',
    });
    expect(findCause([req, serverError, js])).toMatchObject({
      rule: 'server-error',
      text: 'Server error in GET /stock/:id: Error: boom (at stock.js:9)',
    });
    expect(findCause([req, js])).toMatchObject({ rule: 'server-status' });
    expect(findCause([js])).toMatchObject({
      rule: 'browser-error',
      text: 'Browser error: TypeError: x (at app.js:3:1)',
    });
    expect(findCause([ev({ data: { method: 'GET', path: '/ok', status: 200 } })])).toBeUndefined();
  });

  it('points out the slowest step, using the server view when both sides saw it', () => {
    const [story] = buildStories([
      ev({ side: 'browser', kind: 'action', actionId: 'a1', text: 'Clicked', data: { type: 'click' } }),
      ev({
        side: 'browser',
        kind: 'request',
        actionId: 'a1',
        text: 'GET /report (950 ms)',
        data: { method: 'GET', url: '/report', ms: 950, requestId: 'r1', status: 200 },
      }),
      ev({
        requestId: 'r1',
        actionId: 'a1',
        text: 'GET /report → 200 (900 ms)',
        data: { method: 'GET', path: '/report', ms: 900, status: 200 },
      }),
    ]);
    expect(story!.slowest).toEqual({ ms: 900, text: 'GET /report → 200 (900 ms)' });
    expect(story!.status).toBe('ok');
  });
});

describe('helpers', () => {
  it('hides secret-looking keys at any depth and caps sizes', () => {
    expect(
      redact({
        password: 'x',
        user: { apiKey: 'k', name: 'Ada' },
        cardNumber: '4242',
        list: [{ token: 't' }],
      }),
    ).toEqual({
      password: '[hidden]',
      user: { apiKey: '[hidden]', name: 'Ada' },
      cardNumber: '[hidden]',
      list: [{ token: '[hidden]' }],
    });
    expect(String(redact('a'.repeat(600))).length).toBeLessThan(600);
  });

  it('finds the app frame and folds library frames', () => {
    const stack = [
      'Error: boom',
      '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)',
      '    at charge (/app/src/billing.js:42:11)',
      '    at node:internal/process/task_queues:105:5',
    ].join('\n');
    expect(appFrame(stack)).toBe('billing.js:42');
    expect(cleanStack(stack)).toBe(
      'Error: boom\n    at charge (/app/src/billing.js:42:11)\n    … 2 library frames hidden',
    );
    expect(appFrame('C:\\app\\x.js')).toBeUndefined();
  });

  it('places the script tag in the head, the body, or at the start', () => {
    const tag = '<script data-bugfinder></script>';
    expect(injectTag('<HTML><HEAD></HEAD><body></body></HTML>', tag)).toBe(
      `<HTML><HEAD>${tag}</HEAD><body></body></HTML>`,
    );
    expect(injectTag('<body>x</body>', tag)).toBe(`<body>x${tag}</body>`);
    expect(injectTag('x', tag)).toBe(`${tag}x`);
    expect(injectTag(`<head>${tag}</head>`, tag)).toBe(`<head>${tag}</head>`);
  });

  it('formats OS in Environment section of bug report when specified', () => {
    const dummyStory: Story = {
      id: 'test-story',
      type: 'action',
      t: 1000,
      title: 'Failed checkout',
      events: [],
      status: 'error',
    };
    const reportWithOs = buildReport(dummyStory, {
      origin: 'http://localhost:3000',
      os: 'linux x64',
      node: 'v22.0.0',
    });
    expect(reportWithOs).toContain('### Environment');
    expect(reportWithOs).toContain('- OS: linux x64');
    expect(reportWithOs).toContain('- Node v22.0.0');

    const reportWithoutOs = buildReport(dummyStory, {
      origin: 'http://localhost:3000',
      node: 'v22.0.0',
    });
    expect(reportWithoutOs).not.toContain('OS:');
    expect(reportWithoutOs).toContain('- Node v22.0.0');
  });
});
