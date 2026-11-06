import { AsyncLocalStorage } from 'node:async_hooks';

/** The request being handled, available to any code that runs because of it. */
export interface RequestContext {
  requestId: string;
  actionId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The context of the request whose code is running now, if any. */
export const currentRequest = () => requestContext.getStore();

let counter = 0;
/** Short, unique-enough id for this process. */
export const newId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(counter++ % 1296).toString(36).padStart(2, '0')}`;
