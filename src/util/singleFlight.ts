/**
 * A single-flight guard.
 *
 * Ensures at most one run of a task is in progress at a time, so a double click
 * or an impatient repeat cannot start the same request twice. The second caller
 * is told the run was skipped instead of being queued — the UI should reflect
 * "already working", not silently fan out.
 */
export type SingleFlightResult<T> = { skipped: true } | { skipped: false; value: T };

export function createSingleFlight() {
  let running = false;

  return {
    isRunning(): boolean {
      return running;
    },
    async run<T>(task: () => Promise<T>): Promise<SingleFlightResult<T>> {
      if (running) {
        return { skipped: true };
      }
      running = true;
      try {
        const value = await task();
        return { skipped: false, value };
      } finally {
        running = false;
      }
    },
  };
}
