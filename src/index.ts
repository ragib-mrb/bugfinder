import { autoPatch } from './hooks.js';
import { bugfinder } from './middleware.js';

export { bugfinder } from './middleware.js';
export type { BugfinderMiddleware } from './middleware.js';
export { patchConsole, patchExpressErrors, patchMongoose, patchMysql2 } from './hooks.js';
export { buildStories, findCause } from './stories.js';
export { buildReport, toCurl } from './report.js';
export { store } from './store.js';
export type { BugEvent, BugfinderOptions, Cause, Story } from './types.js';

// Hook into console, Express, Mongoose and mysql2 as soon as bugfinder is
// imported, unless it is switched off for production.
if (process.env.NODE_ENV !== 'production' && process.env.BUGFINDER !== 'off') autoPatch();

export default bugfinder;
