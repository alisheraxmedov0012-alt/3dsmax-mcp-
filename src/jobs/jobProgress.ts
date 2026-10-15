import type { JobStatus, ServerJob } from '../api/client';

/**
 * Pure helpers for the jobs panel.
 *
 * Progress is derived only from what the server actually reports: a job is
 * either active (queued/running) or finished, and elapsed time comes from the
 * timestamps the server returned. No percentage is synthesised, because the
 * backend does not report a measurable fraction of work done.
 */

export const ACTIVE_STATUSES: ReadonlyArray<JobStatus> = ['queued', 'running'];

export function isActive(status: JobStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export interface JobProgress {
  /** True while the job is queued or running. */
  active: boolean;
  /** Indeterminate progress: the UI must not claim a specific percentage. */
  indeterminate: boolean;
  /** Human-readable status label (Uzbek). */
  label: string;
  /** Elapsed milliseconds since the job started, when known. */
  elapsedMs: number | null;
}

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Navbatda',
  running: 'Bajarilmoqda',
  succeeded: 'Yakunlandi',
  failed: 'Xato',
  cancelled: 'Bekor qilindi',
};

export function describeJobStatus(status: JobStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function jobProgress(job: ServerJob, now: number = Date.now()): JobProgress {
  const active = isActive(job.status);
  const started = job.started_at ? Date.parse(job.started_at) : null;
  const finished = job.finished_at ? Date.parse(job.finished_at) : null;

  let elapsedMs: number | null = null;
  if (started !== null && Number.isFinite(started)) {
    const end = finished !== null && Number.isFinite(finished) ? finished : now;
    elapsedMs = Math.max(end - started, 0);
  }

  return {
    active,
    indeterminate: active,
    label: describeJobStatus(job.status),
    elapsedMs,
  };
}

/** A retry is offered only when the server said the failure is worth retrying. */
export function canRetry(job: ServerJob): boolean {
  return (
    job.status === 'failed' &&
    job.retryable === true &&
    job.attempts < job.max_attempts
  );
}

export function formatElapsed(elapsedMs: number | null): string {
  if (elapsedMs === null) {
    return '';
  }
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} daq ${rest} s`;
}
