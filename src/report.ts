import { cleanStack } from './redact.js';
import type { BugEvent, Story } from './types.js';

const fence = (text: string, lang = '') => `\`\`\`${lang}\n${text.replace(/```/g, '`​``')}\n\`\`\``;
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The failing request as a curl command (body only if it was recorded, secrets already hidden). */
export function toCurl(request: BugEvent, origin: string): string {
  const method = String(request.data?.method ?? 'GET');
  const path = String(request.data?.path ?? request.data?.url ?? '/');
  const url = /^https?:/.test(path) ? path : `${origin.replace(/\/$/, '')}${path}`;
  const parts = [`curl -X ${method} ${shellQuote(url)}`];
  const body = request.data?.body;
  if (body !== undefined) {
    parts.push(`-H 'content-type: application/json'`);
    parts.push(`--data ${shellQuote(JSON.stringify(body))}`);
  }
  return parts.join(' \\\n  ');
}

const offset = (story: Story, e: BugEvent) => `+${((e.t - story.t) / 1000).toFixed(2)}s`;

/** A Markdown bug report: what happened, steps to reproduce, the failing request, the error and the logs. */
export function buildReport(
  story: Story,
  options: { origin: string; node?: string; userAgent?: string },
): string {
  const lines: string[] = [];
  const steps = story.events.filter((e) => e.kind === 'action');
  const failing =
    story.events.find((e) => e.side === 'server' && e.kind === 'request' && Number(e.data?.status) >= 400) ??
    story.events.find((e) => e.side === 'server' && e.kind === 'request');
  const serverError = story.events.find((e) => e.side === 'server' && e.kind === 'error');
  const jsError = story.events.find((e) => e.kind === 'js-error');
  const logs = story.events.filter(
    (e) =>
      e.kind === 'log' ||
      e.kind === 'console' ||
      e.kind === 'query' ||
      (e.kind === 'request' && e.side === 'browser'),
  );

  lines.push(`## Bug: ${story.cause?.text ?? story.title}`, '');
  lines.push(
    '### What happened',
    '',
    story.cause ? story.cause.text : 'No error was recorded for this action.',
    '',
  );
  if (story.slowest) lines.push(`Slowest step: ${story.slowest.text} (${story.slowest.ms} ms)`, '');

  lines.push('### Steps to reproduce', '');
  if (story.page) lines.push(`1. Open ${story.page}`);
  steps.forEach((s, i) => lines.push(`${i + (story.page ? 2 : 1)}. ${s.text}`));
  if (!steps.length) lines.push(`1. Send ${story.title}`);
  lines.push('');

  if (failing) {
    lines.push('### Request', '', fence(toCurl(failing, options.origin), 'bash'), '');
    lines.push(`Status: ${failing.data?.status ?? '?'} · ${failing.data?.ms ?? '?'} ms`, '');
  }
  const err = serverError ?? jsError;
  if (err) {
    lines.push(`### ${serverError ? 'Server' : 'Browser'} error`, '');
    lines.push(fence(cleanStack(String(err.data?.stack || err.text))), '');
  }
  if (logs.length) {
    lines.push('### Timeline', '');
    lines.push(
      fence(
        logs
          .map(
            (e) =>
              `${offset(story, e)} [${e.side}] ${e.level === 'info' || !e.level ? '' : `${e.level.toUpperCase()} `}${e.text}`,
          )
          .join('\n'),
      ),
      '',
    );
  }
  const env = [
    options.node && `Node ${options.node}`,
    options.userAgent && `Browser: ${options.userAgent}`,
  ].filter(Boolean);
  if (env.length) lines.push('### Environment', '', ...env.map((x) => `- ${x}`), '');
  lines.push('_Recorded with bugfinder. Passwords, tokens, card numbers and similar fields are hidden._');
  return lines.join('\n');
}
