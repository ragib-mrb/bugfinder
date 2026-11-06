/** Keys whose values are never kept: passwords, tokens, card numbers and the like. */
export const SECRET_KEY =
  /pass|secret|token|auth|card|cvv|cvc|ssn|pin\b|otp|cookie|session|api[-_]?key|private/i;

const MAX_TEXT = 2000;

/** Shortens text so one huge value can't fill the memory or the page. */
export function truncate(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text;
}

/** A copy of a value with secret-looking keys hidden, cut to a sensible size. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? truncate(value, 500) : value;
  }
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    out[k] = SECRET_KEY.test(k) ? '[hidden]' : redact(v, depth + 1);
  }
  return out;
}

const LIBRARY_FRAME = /node_modules|node:internal|\(node:|bugfinder[\\/]dist/;

/** A stack trace with library and Node frames folded away, so the app's own lines stand out. */
export function cleanStack(stack: string): string {
  const [head, ...frames] = stack.split('\n');
  const own = frames.filter((f) => !LIBRARY_FRAME.test(f));
  const hidden = frames.length - own.length;
  return [
    head,
    ...own,
    ...(hidden ? [`    … ${hidden} library frame${hidden === 1 ? '' : 's'} hidden`] : []),
  ].join('\n');
}

/** First stack frame in the app's own code (not node_modules or Node itself), e.g. "billing.js:42". */
export function appFrame(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split('\n').slice(1)) {
    if (/node_modules|node:internal|\(node:|<anonymous>|bugfinder[\\/]dist/.test(line)) continue;
    const m = /\(?((?:[A-Za-z]:)?[^():]+):(\d+):\d+\)?\s*$/.exec(line.trim());
    if (m) {
      const file = m[1]!.split(/[\\/]/).pop();
      return `${file}:${m[2]}`;
    }
  }
  return undefined;
}
