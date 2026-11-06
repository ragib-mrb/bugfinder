/** Where an event happened. */
export type Side = 'browser' | 'server' | 'db';

export type EventKind =
  | 'action' // browser: click, submit, page change
  | 'request' // browser fetch/XHR, or a request the server handled
  | 'console' // browser console.error / console.warn
  | 'js-error' // browser uncaught error or promise rejection
  | 'log' // server console output while handling a request
  | 'error' // server error passed to Express
  | 'query'; // database query

export type Level = 'info' | 'warn' | 'error';

export interface BugEvent {
  id: number;
  /** Milliseconds since 1970. */
  t: number;
  side: Side;
  kind: EventKind;
  level?: Level;
  /** One readable line. */
  text: string;
  actionId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
}

/** What the browser sends; the server adds the id. */
export type IncomingEvent = Omit<BugEvent, 'id'>;

export interface Cause {
  /** One sentence, e.g. "POST /orders returned 502: payment timed out (billing.js:42)". */
  text: string;
  /** Which rule found it. */
  rule: 'db-error' | 'server-error' | 'server-status' | 'browser-error' | 'client-status' | 'console-error';
  eventId: number;
}

export interface Story {
  id: string;
  title: string;
  /** click, submit, navigate, background, or request (a server request with no browser action). */
  type: string;
  t: number;
  page?: string;
  status: 'ok' | 'warn' | 'error';
  cause?: Cause;
  slowest?: { text: string; ms: number };
  events: BugEvent[];
}

export interface BugfinderOptions {
  /** Where the story page lives. Default `/__bugfinder`. */
  path?: string;
  /** Default: on unless NODE_ENV is "production". */
  enabled?: boolean;
  /** Add the browser script to HTML pages the app serves. Default true. */
  inject?: boolean;
  /** Only answer requests from this machine. Default true. */
  localOnly?: boolean;
  /** How many events to keep in memory. Default 20000. */
  maxEvents?: number;
  /** A request or query slower than this (ms) is reported as the slowest step. Default 500. */
  slowMs?: number;
}
