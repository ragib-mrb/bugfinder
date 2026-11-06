/** Puts the script tag before </head>, else before </body>, else at the start. */
export function injectTag(html: string, tag: string): string {
  if (html.includes('data-bugfinder')) return html;
  const head = html.search(/<\/head>/i);
  if (head >= 0) return html.slice(0, head) + tag + html.slice(head);
  const body = html.search(/<\/body>/i);
  if (body >= 0) return html.slice(0, body) + tag + html.slice(body);
  return tag + html;
}

interface Res {
  statusCode: number;
  headersSent: boolean;
  getHeader(name: string): unknown;
  setHeader(name: string, value: string | number): void;
  removeHeader(name: string): void;
  write: (...args: never[]) => boolean;
  end: (...args: never[]) => unknown;
}

type Chunk = string | Buffer | Uint8Array;
const toBuffer = (chunk: unknown, encoding?: unknown) =>
  Buffer.isBuffer(chunk)
    ? chunk
    : chunk instanceof Uint8Array
      ? Buffer.from(chunk)
      : Buffer.from(String(chunk), (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding);

/**
 * Buffers HTML responses (from res.send, res.render or express.static) and adds
 * the script tag on the way out. Other responses pass through untouched.
 */
export function injectIntoHtml(req: { method: string }, res: Res, tag: string): void {
  if (req.method === 'HEAD') return;
  const originalWrite = res.write.bind(res) as (chunk: Chunk, ...rest: unknown[]) => boolean;
  const originalEnd = res.end.bind(res) as (...args: unknown[]) => unknown;
  let decided = false;
  let buffering = false;
  const chunks: Buffer[] = [];

  const decide = () => {
    if (decided) return;
    decided = true;
    const type = String(res.getHeader('content-type') ?? '');
    buffering =
      !res.headersSent &&
      /text\/html/i.test(type) &&
      !res.getHeader('content-encoding') &&
      res.statusCode !== 204 &&
      res.statusCode !== 304;
  };

  (res as { write: unknown }).write = (chunk: unknown, encoding?: unknown, cb?: unknown) => {
    decide();
    if (!buffering) return originalWrite(chunk as Chunk, encoding, cb);
    if (chunk !== undefined && chunk !== null) chunks.push(toBuffer(chunk, encoding));
    if (typeof encoding === 'function') (encoding as () => void)();
    else if (typeof cb === 'function') (cb as () => void)();
    return true;
  };

  (res as { end: unknown }).end = (chunk?: unknown, encoding?: unknown, cb?: unknown) => {
    decide();
    if (!buffering) return originalEnd(chunk, encoding, cb);
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function')
      chunks.push(toBuffer(chunk, encoding));
    const html = injectTag(Buffer.concat(chunks).toString('utf8'), tag);
    const body = Buffer.from(html, 'utf8');
    if (!res.headersSent) {
      res.setHeader('Content-Length', body.length);
      res.removeHeader('ETag'); // the page changed, so the old ETag no longer matches
    }
    const done = typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : cb;
    return originalEnd(body, done);
  };
}
