import { describe, expect, it } from 'vitest';
import type { ServerJob } from '../api/client';
import { canRetry, formatElapsed, isActive, jobProgress } from './jobProgress';

function makeJob(overrides: Partial<ServerJob> = {}): ServerJob {
  return {
    id: 'j1',
    kind: 'render',
    status: 'queued',
    attempts: 0,
    max_attempts: 3,
    result: null,
    error: null,
    retryable: null,
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

describe('jobProgress', () => {
  it('treats queued and running as active', () => {
    expect(isActive('queued')).toBe(true);
    expect(isActive('running')).toBe(true);
    expect(isActive('succeeded')).toBe(false);
    expect(isActive('failed')).toBe(false);
  });

  it('never reports a fake percentage while active', () => {
    const progress = jobProgress(makeJob({ status: 'running', started_at: '2026-01-01T00:00:00.000Z' }));
    expect(progress.active).toBe(true);
    expect(progress.indeterminate).toBe(true);
    expect(progress).not.toHaveProperty('percent');
  });

  it('computes elapsed time from server timestamps only', () => {
    const progress = jobProgress(
      makeJob({
        status: 'running',
        started_at: '2026-01-01T00:00:00.000Z',
      }),
      Date.parse('2026-01-01T00:00:05.000Z'),
    );
    expect(progress.elapsedMs).toBe(5000);
  });

  it('has no elapsed time when the job has not started', () => {
    expect(jobProgress(makeJob()).elapsedMs).toBeNull();
  });
});

describe('canRetry', () => {
  it('offers retry only for a retryable failure with attempts left', () => {
    expect(
      canRetry(makeJob({ status: 'failed', retryable: true, attempts: 1, max_attempts: 3 })),
    ).toBe(true);
  });

  it('does not offer retry for a permanent failure', () => {
    expect(
      canRetry(makeJob({ status: 'failed', retryable: false, attempts: 1, max_attempts: 3 })),
    ).toBe(false);
  });

  it('does not offer retry when attempts are exhausted', () => {
    expect(
      canRetry(makeJob({ status: 'failed', retryable: true, attempts: 3, max_attempts: 3 })),
    ).toBe(false);
  });

  it('does not offer retry when the server did not classify the failure', () => {
    expect(canRetry(makeJob({ status: 'failed', retryable: null }))).toBe(false);
  });
});

describe('formatElapsed', () => {
  it('formats seconds and minutes', () => {
    expect(formatElapsed(5000)).toBe('5 s');
    expect(formatElapsed(65000)).toBe('1 daq 5 s');
    expect(formatElapsed(null)).toBe('');
  });
});
