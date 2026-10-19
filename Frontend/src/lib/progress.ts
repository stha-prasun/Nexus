type Listener = (active: number) => void;

let active = 0;
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) listener(active);
};

/**
 * Observe the number of in-flight API requests. The listener fires
 * immediately with the current count so a late subscriber never misses
 * a request that is already running. Returns an unsubscribe function.
 */
export function subscribeToRequests(listener: Listener): () => void {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Marks a request as in-flight for its whole lifetime. The returned
 * promise settles exactly like the input (rejections are re-thrown, not
 * swallowed), so callers can use it as a drop-in replacement.
 */
export function trackRequest<T>(request: Promise<T>): Promise<T> {
  active += 1;
  notify();
  return request.finally(() => {
    active = Math.max(0, active - 1);
    notify();
  });
}
