import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError, isAuthError, type ServerJob } from '../api/client';
import { getCsrfToken, subscribeCsrf } from '../api/csrfStore';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { canRetry, formatElapsed, jobProgress } from '../jobs/jobProgress';

const POLL_MS = 3000;

function hasActiveJob(jobs: ServerJob[]): boolean {
  return jobs.some((job) => jobProgress(job).active);
}

/**
 * W11 — server job panel with honest loading, progress, error and retry states.
 *
 * * Progress is indeterminate while a job runs: the backend does not report a
 *   measurable fraction, so the UI never shows a fake percentage.
 * * Success is shown only after the server reports ``succeeded``.
 * * A failed job offers a retry only when the server marked it retryable; a
 *   permanent failure shows the error without a misleading retry button.
 * * Submitting is guarded against double clicks, and the panel polls only while a
 *   job is active rather than continuously.
 */
export function JobsPanel() {
  const [jobs, setJobs] = useState<ServerJob[]>([]);
  const [csrfToken, setToken] = useState<string | null>(getCsrfToken);
  const [loadError, setLoadError] = useState('');
  const [showJobs, setShowJobs] = useState(false);
  // Kept in a ref so the polling effect does not depend on the jobs list itself
  // (which would re-run the effect and re-poll on every state update).
  const activeRef = useRef(false);

  useEffect(() => subscribeCsrf(setToken), []);

  useEffect(() => {
    if (!showJobs) {
      return undefined;
    }
    let cancelled = false;

    const tick = () => {
      api
        .jobs()
        .then((list) => {
          if (cancelled) {
            return;
          }
          setJobs(list);
          activeRef.current = hasActiveJob(list);
          setLoadError('');
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          if (isAuthError(error)) {
            // Not signed in: stay quiet; the account panel asks for login.
            setJobs([]);
            activeRef.current = false;
            return;
          }
          setLoadError(describeError(error));
        });
    };

    tick();
    // Poll only while work is in flight; an idle panel does not hammer the API.
    const timer = setInterval(() => {
      if (activeRef.current) {
        tick();
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showJobs]);

  const reload = useCallback(
    () =>
      api
        .jobs()
        .then((list) => {
          setJobs(list);
          activeRef.current = hasActiveJob(list);
        })
        .catch((error) => {
          if (!isAuthError(error)) {
            setLoadError(describeError(error));
          }
        }),
    [],
  );

  const retryAction = useAsyncAction<ServerJob>(() => api.retryJob('', null), {
    successMessage: 'Vazifa qayta navbatga qo‘yildi.',
  });

  const handleRetry = (job: ServerJob) => {
    if (!canRetry(job)) {
      return;
    }
    void retryAction.execute(async () => {
      const updated = await api.retryJob(job.id, csrfToken);
      await reload();
      return updated;
    }, 'Qayta urinilmoqda…');
  };

  return (
    <section className="jobs-panel">
      <h2 className="jobs-panel__title">Server vazifalari</h2>

      <button
        type="button"
        className="jobs-panel__toggle"
        aria-expanded={showJobs}
        onClick={() => setShowJobs((value) => !value)}
      >
        {showJobs ? 'Yashirish' : 'Vazifalar navbatini ko‘rish'}
      </button>

      {showJobs && (
        <>
          {loadError && (
            <p className="render__message render__message--error" role="alert">
              {loadError}
            </p>
          )}

          {jobs.length === 0 && !loadError && (
            <p className="visual__hint">Hozircha server vazifalari yo‘q.</p>
          )}

          {jobs.length > 0 && (
            <ul className="jobs-panel__list">
              {jobs.map((job) => {
                const progress = jobProgress(job);
                const retryable = canRetry(job);
                return (
                  <li key={job.id} className="job">
                    <div className="job__row">
                      <span className="job__kind">{job.kind}</span>
                      <span className={`job__status job__status--${job.status}`}>
                        {progress.label}
                        {progress.active && '…'}
                      </span>
                    </div>

                    {progress.indeterminate && (
                      <div
                        className="job__progress"
                        role="progressbar"
                        aria-label={`${job.kind} bajarilmoqda`}
                        aria-valuetext="Bajarilmoqda"
                      />
                    )}

                    {progress.elapsedMs !== null && (
                      <span className="job__meta">
                        {progress.active ? 'O‘tgan vaqt: ' : 'Davomiylik: '}
                        {formatElapsed(progress.elapsedMs)} · Urinish {job.attempts}/
                        {job.max_attempts}
                      </span>
                    )}

                    {job.error && (
                      <p className="job__error" role="alert">
                        {job.error}
                      </p>
                    )}

                    {retryable && (
                      <button
                        type="button"
                        className="job__retry"
                        disabled={retryAction.isWorking}
                        onClick={() => handleRetry(job)}
                      >
                        {retryAction.isWorking ? 'Yuborilmoqda…' : 'Qayta urinish'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {retryAction.status === 'error' && (
            <p className="render__message render__message--error" role="alert">
              {retryAction.authRequired
                ? 'Sessiya muddati tugagan. Iltimos, qaytadan kiring.'
                : retryAction.message}
              {retryAction.retryAfter
                ? ` (${retryAction.retryAfter} soniyadan so‘ng qayta urinib ko‘ring)`
                : ''}
            </p>
          )}

          {retryAction.status === 'ok' && (
            <p className="render__message" role="status" aria-live="polite">
              {retryAction.message}
            </p>
          )}

          <p className="visual__hint">
            Jarayon foizsiz (aniq o‘lchovsiz) ko‘rsatiladi: server aniq jarayon
            ma’lumotini bermaydi.
          </p>
        </>
      )}
    </section>
  );
}
