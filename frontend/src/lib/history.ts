// A tiny undo/redo stack for the edit.
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const start = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function push<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-100), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/** Apply a change to every state in the stack (not an undo step of its own). */
export function mapAll<T>(h: History<T>, f: (state: T) => T): History<T> {
  return { past: h.past.map(f), present: f(h.present), future: h.future.map(f) };
}
