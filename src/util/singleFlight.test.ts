import { describe, expect, it } from 'vitest';
import { createSingleFlight } from './singleFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('createSingleFlight', () => {
  it('runs the first task and skips a concurrent repeat', async () => {
    const flight = createSingleFlight();
    const gate = deferred<number>();

    const first = flight.run(() => gate.promise);
    const second = await flight.run(async () => 2);

    expect(second.skipped).toBe(true);
    expect(flight.isRunning()).toBe(true);

    gate.resolve(1);
    const firstResult = await first;
    expect(firstResult.skipped).toBe(false);
    expect(firstResult.skipped ? undefined : firstResult.value).toBe(1);
    expect(flight.isRunning()).toBe(false);
  });

  it('allows a new run once the previous one finished', async () => {
    const flight = createSingleFlight();
    await flight.run(async () => 1);
    const next = await flight.run(async () => 2);
    expect(next.skipped).toBe(false);
    expect(next.skipped ? undefined : next.value).toBe(2);
  });

  it('releases the guard when the task throws', async () => {
    const flight = createSingleFlight();
    await expect(
      flight.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(flight.isRunning()).toBe(false);
    const retry = await flight.run(async () => 3);
    expect(retry.skipped).toBe(false);
  });
});
