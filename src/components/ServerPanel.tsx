import { useEffect, useState } from 'react';
import { api, describeError, type StorageStatus } from '../api/client';

type Status = 'idle' | 'ok' | 'error';

/**
 * W10 — server capabilities panel.
 *
 * Read-only and honest: it reports whether the backend's cloud file storage and
 * production job queue are actually configured. It never claims a real payment
 * provider or a cloud bucket is active — those are still unconfigured in this
 * stage, and the UI says so.
 */
export function ServerPanel() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    // State is only updated from the async callbacks (never synchronously inside
    // the effect), so this does not trigger cascading renders.
    api
      .storageStatus()
      .then((result) => {
        setStorage(result);
        setStatus('ok');
      })
      .catch((error) => {
        setStatus('error');
        setMessage(describeError(error));
      });
  }, []);

  return (
    <section className="server-panel">
      <h2 className="server-panel__title">Server (tijoriy backend)</h2>

      <div className="field">
        <span className="field__label">Fayl saqlash</span>
        {storage ? (
          <p className="visual__hint">
            {storage.message}
            {!storage.persistent && ' (production uchun doimiy storage kerak)'}
          </p>
        ) : (
          <p className="visual__hint">Holat yuklanmoqda…</p>
        )}
      </div>

      <div className="field">
        <span className="field__label">Vazifalar navbati (job queue)</span>
        <p className="visual__hint">
          Uzoq vazifalar uchun navbat mavjud. Ishlab chiqarishda alohida worker
          jarayoni (APP_JOB_BACKEND=worker) sozlanishi shart.
        </p>
      </div>

      <div className="field">
        <span className="field__label">To‘lov</span>
        <p className="visual__hint">
          Haqiqiy to‘lov provayderi hali sozlanmagan. Hozircha faqat sandbox adapter
          mavjud (Account bo‘limida).
        </p>
      </div>

      {status === 'error' && (
        <p className="render__message render__message--error" role="alert">
          Server holatini olib bo‘lmadi: {message}
        </p>
      )}

      <p className="visual__hint">
        Serverda loyiha saqlash va navbat holati hisobga kirilgandan keyin mavjud.
      </p>
    </section>
  );
}
