import type { BugEvent, IncomingEvent } from './types.js';

/** Keeps the latest events in memory, oldest dropped first. Nothing is written to disk. */
export class EventStore {
  private events: BugEvent[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();

  constructor(private max = 20_000) {}

  setMax(max: number): void {
    this.max = Math.max(100, max);
  }

  add(event: IncomingEvent): BugEvent {
    const full = { ...event, id: this.nextId++ };
    this.events.push(full);
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max);
    for (const fn of this.listeners) fn();
    return full;
  }

  all(): readonly BugEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }

  /** Lets a request's event be updated when it finishes (status, time). */
  update(id: number, patch: Partial<BugEvent>): void {
    const e = this.events.find((x) => x.id === id);
    if (e) Object.assign(e, patch, { data: { ...e.data, ...patch.data } });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** One store per process, shared by the middleware and the database hooks. */
export const store = new EventStore();
