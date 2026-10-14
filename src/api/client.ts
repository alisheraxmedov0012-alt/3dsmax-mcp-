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

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

/** A user-facing Uzbek message for a failed request. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  return "Serverga ulanib bo'lmadi. Iltimos, keyinroq qayta urinib ko'ring.";
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

  // AI design generation (W1). Authenticated compute endpoint; requires a session
  // cookie but no CSRF token (it does not mutate user-visible state).
  aiDesign: (text: string, imageFileName?: string) =>
    request<AiDesignResponse>('/api/ai/design', {
      method: 'POST',
      body: { text, image_filename: imageFileName ?? null },
    }),
};
