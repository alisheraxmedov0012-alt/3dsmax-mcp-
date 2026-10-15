import { useEffect, useState } from 'react';
import { api, describeError, type ReadinessResponse, type StorageStatus } from '../api/client';

type Status = 'loading' | 'ok' | 'error';

/**
 * W11 — server capabilities / readiness panel.
 *
 * Read-only and honest: it reports whether the backend's database, file storage
 * and (when configured) worker are actually ready, straight from the readiness
 * endpoint. It never claims a real payment provider or a cloud bucket is active —
 * those are still unconfigured, and the UI says so. A failed load shows an error
 * with a retry rather than a stale "ready".
 */
export function ServerPanel() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // State is only updated from the async callbacks (never synchronously inside
    // the effect), so this does not trigger cascading renders.
    let cancelled = false;
    Promise.all([api.storageStatus(), api.readiness()])
      .then(([storageResult, readinessResult]) => {
        if (cancelled) {
          return;
        }
        setStorage(storageResult);
        setReadiness(readinessResult);
        setStatus('ok');
        setMessage('');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setStatus('error');
        setMessage(describeError(error));
      });
    return () => {
      cancelled = true;
    };
    // The token is only a re-run trigger; it is intentionally not read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  const checks = readiness?.checks;

  return (
    <section className="server-panel">
      <h2 className="server-panel__title">Server (tijoriy backend)</h2>

      {status === 'loading' && <p className="visual__hint">Holat yuklanmoqda…</p>}

      {status === 'error' && (
        <>
          <p className="render__message render__message--error" role="alert">
            Server holatini olib bo‘lmadi: {message}
          </p>
          <button
            type="button"
            className="server-panel__retry"
            onClick={() => {
              setStatus('loading');
              setReloadToken((token) => token + 1);
            }}
          >
            Qayta urinish
          </button>
        </>
      )}

      {status === 'ok' && (
        <>
          <div className="field">
            <span className="field__label">Tayyorlik (readiness)</span>
            <p className="visual__hint">
              {readiness?.status === 'ready' ? 'Tayyor' : 'Tayyor emas'}
              {checks
                ? ` · DB: ${checks.database ? '✓' : '✗'} · Saqlash: ${
                    checks.storage ? '✓' : '✗'
                  } · Worker: ${checks.worker ? '✓' : '✗'}`
                : ''}
            </p>
          </div>

          <div className="field">
            <span className="field__label">Fayl saqlash</span>
            <p className="visual__hint">
              {storage?.message}
              {storage && !storage.persistent && ' (production uchun doimiy storage kerak)'}
            </p>
          </div>

          <div className="field">
            <span className="field__label">Vazifalar navbati (job queue)</span>
            <p className="visual__hint">
              {readiness?.worker.mode === 'worker'
                ? readiness.worker.running
                  ? 'Worker ishlamoqda.'
                  : 'Worker sozlangan, lekin heartbeat topilmadi (worker ishlamayapti).'
                : 'Uzoq vazifalar so‘rov ichida (inline) bajariladi; ishlab chiqarishda alohida worker (APP_JOB_BACKEND=worker) sozlanishi shart.'}
            </p>
          </div>

          <div className="field">
            <span className="field__label">To‘lov</span>
            <p className="visual__hint">
              Haqiqiy to‘lov provayderi hali sozlanmagan. Hozircha faqat sandbox adapter
              mavjud (Account bo‘limida).
            </p>
          </div>

          <p className="visual__hint">
            Serverda loyiha saqlash va navbat holati hisobga kirilgandan keyin mavjud.
          </p>
        </>
      )}
    </section>
  );
}
