/**
 * Phase 4.3B — authenticated texture API.
 *
 * Kept separate from the JSON-only request helper because uploads are multipart
 * and content downloads are binary. Credentials and the CSRF token follow the
 * same session contract as the rest of the client.
 */
import { API_BASE_URL, ApiRequestError } from './client';

export interface TextureAssetApiSource {
  kind: string;
  generator?: string | null;
}

/** Wire shape of the FastAPI `TextureAssetResponse` (snake_case). */
export interface TextureAssetApiResponse {
  id: string;
  version: number;
  filename?: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  content_hash: string;
  source: TextureAssetApiSource;
}

const STATUS_MESSAGES: Record<number, string> = {
  401: "Tizimga kiring — tekstura yuklash uchun sessiya kerak.",
  403: "CSRF tekshiruvi muvaffaqiyatsiz. Sahifani yangilab, qayta kiring.",
  404: 'Tekstura topilmadi yoki unga ruxsat yo‘q.',
  413: "Fayl ruxsat etilgan hajmdan yoki o‘lchamdan katta.",
  415: "Faqat PNG, JPEG yoki WebP teksturalari qabul qilinadi.",
  422: 'Rasm tekshiruvdan o‘tmadi. Boshqa fayl tanlang.',
  429: "Juda ko‘p urinish. Biroz kutib, qayta urinib ko‘ring.",
  503: "Serverda doimiy fayl saqlash mavjud emas. Keyinroq urinib ko‘ring.",
};

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get('Retry-After');
  if (!raw || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  return Number(raw.trim());
}

async function errorFromResponse(response: Response): Promise<ApiRequestError> {
  let code = 'request_failed';
  let message = STATUS_MESSAGES[response.status] ?? "So'rov amalga oshmadi.";
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
      if (typeof parsed.error?.code === 'string') code = parsed.error.code;
      if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
        message = parsed.error.message;
      }
    }
  } catch {
    // Keep the status-based message; the body was not the documented JSON shape.
  }
  return new ApiRequestError(code, message, response.status, retryAfterSeconds(response));
}

function networkError(): ApiRequestError {
  return new ApiRequestError(
    'network_error',
    "Serverga ulanib bo'lmadi. Internet aloqasini tekshirib, qayta urinib ko'ring.",
    0,
  );
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
  } catch {
    throw networkError();
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError(
      'invalid_response',
      "Server noto'g'ri javob qaytardi.",
      response.status,
    );
  }
}

/** List the authenticated user's textures. */
export function listTextureAssets(signal?: AbortSignal): Promise<TextureAssetApiResponse[]> {
  return requestJson<TextureAssetApiResponse[]>('/api/textures', signal);
}

/** One texture's metadata. */
export function getTextureAsset(
  id: string,
  signal?: AbortSignal,
): Promise<TextureAssetApiResponse> {
  return requestJson<TextureAssetApiResponse>(`/api/textures/${encodeURIComponent(id)}`, signal);
}

/** Upload a normalized PNG. The caller supplies the CSRF token from the session. */
export async function uploadTextureAsset(
  blob: Blob,
  filename: string,
  csrfToken: string | null,
  signal?: AbortSignal,
): Promise<TextureAssetApiResponse> {
  if (!csrfToken) {
    throw new ApiRequestError('csrf_missing', STATUS_MESSAGES[401], 401);
  }
  const form = new FormData();
  form.append('file', blob, filename);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/textures`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrfToken },
      body: form,
      signal,
    });
  } catch {
    throw networkError();
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  try {
    return (await response.json()) as TextureAssetApiResponse;
  } catch {
    throw new ApiRequestError(
      'invalid_response',
      "Server noto'g'ri javob qaytardi.",
      response.status,
    );
  }
}

/** Fetch texture bytes. The response must really be an image/png. */
export async function fetchTextureContent(
  id: string,
  signal?: AbortSignal,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/textures/${encodeURIComponent(id)}/content`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
  } catch {
    throw networkError();
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase();
  if (!contentType.startsWith('image/png')) {
    throw new ApiRequestError(
      'invalid_response',
      "Server tekstura o'rniga boshqa fayl qaytardi.",
      response.status,
    );
  }
  return response.blob();
}
