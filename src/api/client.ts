/**
 * Backend API client.
 *
 * The frontend is a presentation layer only: plan, limit and entitlement
 * decisions always come from the server. Nothing here decides access.
 *
 * Requests use cookies (credentials: 'include') plus the CSRF token returned at
 * login/register, sent in the X-CSRF-Token header for state-changing calls.
 */

const DEFAULT_BASE_URL = 'http://localhost:8000';

export const API_BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || DEFAULT_BASE_URL;

export interface ApiErrorShape {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  /** Seconds the server asked the client to wait (429/503), when provided. */
  readonly retryAfter: number | null;
  /** True when a retry (possibly after waiting) could plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    // A transport error (status 0), a rate limit, a temporary outage or a 5xx
    // are worth retrying; a 4xx validation/auth failure is not.
    this.retryable =
      status === 0 || status === 429 || status === 503 || (status >= 500 && status < 600);
  }
}

/** Session/authentication problems the UI must react to by asking to sign in. */
export function isAuthError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 401 || error.code === 'not_authenticated')
  );
}

/** The plan limit was reached (402) — surface an upgrade hint, not a retry. */
export function isLimitError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'limit_reached';
}

/** Too many parallel jobs / rate limited (429). */
export function isBusyError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 429 || error.code === 'too_many_parallel_jobs')
  );
}

/** A dependency (worker, storage, DB) is temporarily unavailable (503). */
export function isServiceDownError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 503 || error.code === 'service_unavailable');
}

/** A user-facing Uzbek message for a failed request. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  return "Serverga ulanib bo'lmadi. Iltimos, keyinroq qayta urinib ko'ring.";
}

function parseRetryAfter(response: Response): number | null {
  const raw = response.headers.get('Retry-After');
  if (!raw) {
    return null;
  }
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  csrfToken?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, csrfToken } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (csrfToken && method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(
      'network_error',
      "Serverga ulanib bo'lmadi. Iltimos, keyinroq qayta urinib ko'ring.",
      0,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const errorShape = (data as { error?: ApiErrorShape } | undefined)?.error;
    throw new ApiRequestError(
      errorShape?.code ?? 'request_failed',
      errorShape?.message ?? "So'rov amalga oshmadi.",
      response.status,
      parseRetryAfter(response),
    );
  }

  return data as T;
}

export interface ApiUser {
  id: string;
  email: string;
  role: string;
  is_email_verified: boolean;
  created_at: string;
}

export interface SessionResponse {
  user: ApiUser;
  csrf_token: string;
  dev_verification_token?: string | null;
}

export interface PlanLimits {
  max_projects?: number | null;
  max_png_exports?: number | null;
  max_glb_exports?: number | null;
  max_ai_requests?: number | null;
  [key: string]: number | null | undefined;
}

export interface Plan {
  key: string;
  name: string;
  is_active: boolean;
  limits: PlanLimits;
  price_cents: number | null;
  currency: string | null;
  period_days: number | null;
}

export interface UsageRow {
  metric: string;
  used: number;
  limit: number | null;
}

export interface Subscription {
  plan_key: string;
  plan_name: string;
  status: string;
  current_period_end: string | null;
  limits: PlanLimits;
  usage: UsageRow[];
}

export interface Invoice {
  id: string;
  number: string;
  description: string;
  amount_cents: number;
  currency: string;
  status: string;
  issued_at: string;
  paid_at: string | null;
}

export interface BillingEvent {
  id: string;
  event_type: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface CheckoutResponse {
  payment_id: string;
  provider: string;
  mode: 'sandbox';
  status: string;
  amount_cents: number | null;
  currency: string | null;
  confirm_url?: string | null;
  cancelled_url?: string | null;
}

export interface MessageResponse {
  message: string;
  dev_token?: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  project_ids: string[];
}

/**
 * W10 — server-side project, job and storage wire types.
 * These mirror the FastAPI schemas; the server enforces ownership and limits.
 */
export interface ServerProject {
  id: string;
  client_id: string;
  name: string;
  version: number;
  schema_version: number;
  created_at: string | null;
  updated_at: string | null;
  scene?: Record<string, unknown>;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ServerJob {
  id: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  result: Record<string, unknown> | null;
  error: string | null;
  retryable: boolean | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface StorageStatus {
  backend: string;
  available: boolean;
  persistent: boolean;
  message: string;
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  checks: {
    database: boolean;
    storage: boolean;
    worker: boolean;
  };
  environment: string;
  database_backend: string;
  storage_backend: string | null;
  worker: { mode: string; required: boolean; running: boolean; note: string };
  rate_limit_backend: string;
  error_tracking: boolean;
}

export interface UsageSummaryRow {
  operation: string;
  records: number;
  quantity: number;
  duration_ms: number;
  total_tokens: number;
  actual: number;
  estimated: number;
  unknown: number;
}

export interface UsageRecordRow {
  id: string;
  operation: string;
  quantity: number;
  unit: string;
  duration_ms: number | null;
  cost_kind: string;
  cost_micros: number | null;
  currency: string | null;
  provider: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  project_id: string | null;
  job_id: string | null;
  meta: Record<string, unknown>;
  created_at: string | null;
}

export interface DiagnosticsCheck {
  key: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

export interface DiagnosticsResponse {
  environment: string;
  production: boolean;
  ready: boolean;
  checks: DiagnosticsCheck[];
  blocking: string[];
  config_problems: string[];
  payments_real: boolean;
}

/**
 * Wire contract for AI design generation (W1). Mirrors the backend
 * ``DesignSpec``; ``furniture`` is the shared W1/W2 vocabulary and ``supported``
 * says whether the current build can turn the spec into geometry.
 */
export type AiFurnitureType =
  | 'table'
  | 'chair'
  | 'armchair'
  | 'sofa'
  | 'bed'
  | 'wardrobe'
  | 'shelf'
  | 'dresser';

export interface AiDesignDimensions {
  width_cm: number;
  height_cm: number;
  depth_cm: number;
}

export interface AiDesignSpec {
  furniture: AiFurnitureType;
  dimensions: AiDesignDimensions | null;
  color: string | null;
  material_kind: string | null;
  style: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
  warnings: string[];
  supported: boolean;
}

export interface AiDesignResponse {
  provider: string;
  spec: AiDesignSpec;
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),

  register: (email: string, password: string) =>
    request<SessionResponse>('/api/auth/register', { method: 'POST', body: { email, password } }),

  login: (email: string, password: string) =>
    request<SessionResponse>('/api/auth/login', { method: 'POST', body: { email, password } }),

  logout: (csrfToken: string | null) =>
    request<MessageResponse>('/api/auth/logout', { method: 'POST', csrfToken }),

  me: () => request<ApiUser>('/api/auth/me'),

  verifyEmail: (token: string) =>
    request<MessageResponse>('/api/auth/verify-email', { method: 'POST', body: { token } }),

  forgotPassword: (email: string) =>
    request<MessageResponse>('/api/auth/forgot-password', { method: 'POST', body: { email } }),

  resetPassword: (token: string, password: string) =>
    request<MessageResponse>('/api/auth/reset-password', {
      method: 'POST',
      body: { token, password },
    }),

  plans: () => request<Plan[]>('/api/plans'),

  subscription: () => request<Subscription>('/api/subscription'),

  usage: () => request<UsageRow[]>('/api/usage'),

  invoices: () => request<Invoice[]>('/api/invoices'),

  billingHistory: () => request<BillingEvent[]>('/api/billing/history'),

  checkout: (planKey: string, csrfToken: string | null) =>
    request<CheckoutResponse>('/api/billing/checkout', {
      method: 'POST',
      body: { plan_key: planKey },
      csrfToken,
    }),

  sandboxConfirm: (paymentId: string, outcome: 'succeeded' | 'failed' | 'cancelled', csrfToken: string | null) =>
    request<CheckoutResponse>('/api/billing/sandbox/confirm', {
      method: 'POST',
      body: { payment_id: paymentId, outcome },
      csrfToken,
    }),

  cancelSubscription: (csrfToken: string | null) =>
    request<Subscription>('/api/subscription/cancel', { method: 'POST', csrfToken }),

  importProjects: (
    projects: Array<{ client_id: string; name: string; scene: Record<string, unknown> }>,
    csrfToken: string | null,
  ) =>
    request<ImportResult>('/api/projects/import', {
      method: 'POST',
      body: { projects },
      csrfToken,
    }),

  // --- W10: server-side projects, jobs and storage ---

  serverProjects: () => request<ServerProject[]>('/api/projects'),

  serverProject: (id: string) => request<ServerProject>(`/api/projects/${id}`),

  createServerProject: (name: string, scene: Record<string, unknown>, csrfToken: string | null) =>
    request<ServerProject>('/api/projects', { method: 'POST', body: { name, scene }, csrfToken }),

  updateServerProject: (
    id: string,
    patch: { name?: string; scene?: Record<string, unknown>; expected_version?: number },
    csrfToken: string | null,
  ) => request<ServerProject>(`/api/projects/${id}`, { method: 'PATCH', body: patch, csrfToken }),

  deleteServerProject: (id: string, csrfToken: string | null) =>
    request<void>(`/api/projects/${id}`, { method: 'DELETE', csrfToken }),

  jobs: () => request<ServerJob[]>('/api/jobs'),

  job: (id: string) => request<ServerJob>(`/api/jobs/${id}`),

  createJob: (kind: string, idempotencyKey: string, csrfToken: string | null) =>
    request<ServerJob>('/api/jobs', {
      method: 'POST',
      body: { kind, idempotency_key: idempotencyKey, payload: {} },
      csrfToken,
    }),

  cancelJob: (id: string, csrfToken: string | null) =>
    request<ServerJob>(`/api/jobs/${id}/cancel`, { method: 'POST', csrfToken }),

  retryJob: (id: string, csrfToken: string | null) =>
    request<ServerJob>(`/api/jobs/${id}/retry`, { method: 'POST', csrfToken }),

  // Public: reports the storage backend honestly (no auth required).
  storageStatus: () => request<StorageStatus>('/api/files/status'),

  // --- W11: readiness, usage and diagnostics ---

  readiness: () => request<ReadinessResponse>('/api/health/ready'),

  usageSummary: () => request<UsageSummaryRow[]>('/api/usage/summary'),

  usageRecords: (limit = 50) => request<UsageRecordRow[]>(`/api/usage/records?limit=${limit}`),

  diagnostics: () => request<DiagnosticsResponse>('/api/admin/diagnostics'),

  // AI design generation (W1). Authenticated compute endpoint; requires a session
  // cookie but no CSRF token (it does not mutate user-visible state).
  aiDesign: (text: string, imageFileName?: string) =>
    request<AiDesignResponse>('/api/ai/design', {
      method: 'POST',
      body: { text, image_filename: imageFileName ?? null },
    }),
};
