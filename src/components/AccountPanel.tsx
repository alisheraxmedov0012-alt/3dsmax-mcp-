import { useEffect, useState } from 'react';
import {
  api,
  describeError,
  type ApiUser,
  type BillingEvent,
  type Invoice,
  type Plan,
  type Subscription,
} from '../api/client';
import { createLocalProjectRepository } from '../projects/localProjectRepository';

type Status = 'idle' | 'working' | 'ok' | 'error';

const STATUS_LABELS: Record<string, string> = {
  active: 'Faol',
  pending: 'To\u2019lov kutilmoqda',
  payment_failed: 'To\u2019lov muvaffaqiyatsiz',
  expired: 'Muddati tugagan',
  cancelled: 'Bekor qilingan',
};

const METRIC_LABELS: Record<string, string> = {
  projects: 'Loyihalar',
  png_exports: 'PNG eksportlar',
  glb_exports: 'GLB eksportlar',
  ai_requests: 'AI so\u2019rovlar',
};

function formatMoney(cents: number | null, currency: string | null): string {
  if (cents === null || !currency) {
    return 'Narx hali tasdiqlanmagan';
  }
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function AccountPanel() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [history, setHistory] = useState<BillingEvent[]>([]);
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [lastPaymentId, setLastPaymentId] = useState<string | null>(null);

  const loadAccountData = async () => {
    try {
      const [planList, subscriptionData, invoiceList, historyList] = await Promise.all([
        api.plans(),
        api.subscription(),
        api.invoices(),
        api.billingHistory(),
      ]);
      setPlans(planList);
      setSubscription(subscriptionData);
      setInvoices(invoiceList);
      setHistory(historyList);
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  useEffect(() => {
    // Detect an existing session without assuming one exists.
    api
      .me()
      .then((current) => {
        setUser(current);
        return loadAccountData();
      })
      .catch(() => {
        // Not signed in (or backend unavailable) — load public plan info only.
        api.plans().then(setPlans).catch(() => undefined);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afterAuth = async (session: { user: ApiUser; csrf_token: string; dev_verification_token?: string | null }) => {
    setUser(session.user);
    setCsrfToken(session.csrf_token);
    setDevToken(session.dev_verification_token ?? null);
    setStatus('ok');
    setMessage(`Tizimga kirdingiz: ${session.user.email}`);
    await loadAccountData();
  };

  const handleRegister = async () => {
    setStatus('working');
    try {
      await afterAuth(await api.register(email, password));
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  const handleLogin = async () => {
    setStatus('working');
    try {
      await afterAuth(await api.login(email, password));
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  const handleLogout = async () => {
    setStatus('working');
    try {
      await api.logout(csrfToken);
      setUser(null);
      setCsrfToken(null);
      setSubscription(null);
      setInvoices([]);
      setHistory([]);
      setStatus('ok');
      setMessage('Chiqdingiz.');
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  const handleVerifyEmail = async () => {
    if (!devToken) return;
    setStatus('working');
    try {
      const result = await api.verifyEmail(devToken);
      const current = await api.me();
      setUser(current);
      setStatus('ok');
      setMessage(result.message);
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  const handleCheckout = async (planKey: string) => {
    setStatus('working');
    try {
      const checkout = await api.checkout(planKey, csrfToken);
      setSandboxEnabled(true);
      setLastPaymentId(checkout.payment_id);
      setStatus('ok');
      setMessage(
        checkout.mode === 'sandbox'
          ? "Sandbox to'lov yaratildi. Bu HAQIQIY to'lov emas."
          : "To'lov yaratildi.",
      );
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  const handleSandboxOutcome = async (outcome: 'succeeded' | 'failed' | 'cancelled') => {
    if (!lastPaymentId) return;
    setStatus('working');
    try {
      await api.sandboxConfirm(lastPaymentId, outcome, csrfToken);
      await loadAccountData();
      setStatus('ok');
      setMessage("Sandbox natijasi qayd etildi (haqiqiy to'lov emas).");
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  const handleCancel = async () => {
    setStatus('working');
    try {
      setSubscription(await api.cancelSubscription(csrfToken));
      await loadAccountData();
      setStatus('ok');
      setMessage('Obuna bekor qilindi.');
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  const handleImport = async () => {
    setStatus('working');
    try {
      const repository = createLocalProjectRepository({ storage: window.localStorage });
      const local = await repository.list();
      if (local.length === 0) {
        setStatus('ok');
        setMessage("Import qilinadigan lokal loyiha topilmadi.");
        return;
      }
      const result = await api.importProjects(
        local.map((project) => ({
          client_id: project.id,
          name: project.name,
          scene: project.scene as unknown as Record<string, unknown>,
        })),
        csrfToken,
      );
      setStatus('ok');
      setMessage(
        `Import: ${result.imported} yangi, ${result.skipped} mavjud. Lokal ma'lumotlar o'chirilmadi.`,
      );
      await loadAccountData();
    } catch (error) {
      setStatus('error');
      setMessage(describeError(error));
    }
  };

  return (
    <section className="account">
      <h2 className="account__title">Hisob</h2>

      {!user ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="account-email">
              Email
            </label>
            <input
              id="account-email"
              className="field__input"
              type="email"
              value={email}
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="account-password">
              Parol
            </label>
            <input
              id="account-password"
              className="field__input"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="account__actions">
            <button type="button" className="account__primary" onClick={handleLogin}>
              Kirish
            </button>
            <button type="button" className="account__secondary" onClick={handleRegister}>
              Ro'yxatdan o'tish
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="account__who">
            {user.email} · rol: <code>{user.role}</code>
            {user.is_email_verified ? ' · email tasdiqlangan' : ' · email tasdiqlanmagan'}
          </p>
          <div className="account__actions">
            {!user.is_email_verified && devToken && (
              <button type="button" className="account__secondary" onClick={handleVerifyEmail}>
                Emailni tasdiqlash
              </button>
            )}
            <button type="button" className="account__secondary" onClick={handleLogout}>
              Chiqish
            </button>
          </div>

          {subscription && (
            <div className="account__block">
              <h3 className="account__subtitle">Tarif</h3>
              <p className="account__meta">
                {subscription.plan_name} ·{' '}
                {STATUS_LABELS[subscription.status] ?? subscription.status}
              </p>
              <ul className="account__list">
                {subscription.usage.map((row) => (
                  <li key={row.metric}>
                    {METRIC_LABELS[row.metric] ?? row.metric}: {row.used}
                    {row.limit === null ? ' / cheklanmagan (hali belgilanmagan)' : ` / ${row.limit}`}
                  </li>
                ))}
              </ul>
              {subscription.status === 'active' && subscription.plan_key !== 'free' && (
                <button type="button" className="account__secondary" onClick={handleCancel}>
                  Obunani bekor qilish
                </button>
              )}
            </div>
          )}

          <div className="account__block">
            <h3 className="account__subtitle">Tariflar</h3>
            {plans.map((plan) => (
              <div className="plan-row" key={plan.key}>
                <span className="plan-row__name">{plan.name}</span>
                <span className="plan-row__price">
                  {formatMoney(plan.price_cents, plan.currency)}
                </span>
                {plan.key !== 'free' && (
                  <button
                    type="button"
                    className="account__primary"
                    onClick={() => handleCheckout(plan.key)}
                  >
                    Sandbox to'lov
                  </button>
                )}
              </div>
            ))}
            <p className="account__hint">
              To'lovlar hozircha faqat sandbox (sinov) rejimida. Haqiqiy to'lov qabul qilinmaydi.
            </p>
          </div>

          {sandboxEnabled && lastPaymentId && (
            <div className="account__block">
              <h3 className="account__subtitle">Sandbox to'lov natijasi</h3>
              <div className="account__actions">
                <button
                  type="button"
                  className="account__primary"
                  onClick={() => handleSandboxOutcome('succeeded')}
                >
                  Muvaffaqiyatli
                </button>
                <button
                  type="button"
                  className="account__secondary"
                  onClick={() => handleSandboxOutcome('failed')}
                >
                  Muvaffaqiyatsiz
                </button>
              </div>
            </div>
          )}

          <div className="account__block">
            <h3 className="account__subtitle">Hisob-fakturalar</h3>
            {invoices.length === 0 ? (
              <p className="account__meta">Hozircha hisob-faktura yo'q.</p>
            ) : (
              <ul className="account__list">
                {invoices.map((invoice) => (
                  <li key={invoice.id}>
                    {invoice.number} · {invoice.description} ·{' '}
                    {(invoice.amount_cents / 100).toFixed(2)} {invoice.currency} · {invoice.status}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="account__block">
            <h3 className="account__subtitle">Lokal loyihalarni import qilish</h3>
            <button type="button" className="account__secondary" onClick={handleImport}>
              Brauzerdagi loyihalarni import qilish
            </button>
            <p className="account__hint">
              Bu brauzerda saqlangan loyihalarni hisobingizga nusxalaydi. Lokal nusxa
              o'chirilmaydi.
            </p>
          </div>

          {history.length > 0 && (
            <details className="account__block">
              <summary className="account__subtitle">Billing tarixi</summary>
              <ul className="account__list">
                {history.slice(0, 10).map((event) => (
                  <li key={event.id}>{event.event_type}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {message &&
        (status === 'error' ? (
          <p className="account__message account__message--error" role="alert">
            {message}
          </p>
        ) : (
          <p className="account__message" role="status" aria-live="polite">
            {message}
          </p>
        ))}
    </section>
  );
}
