/**
 * Phase 4.3B — baseColor texture picker.
 *
 * Upload uses the authenticated texture API; the scene only ever receives a
 * serializable `TextureAssetRef`. The server response is validated before it is
 * trusted, and every failure keeps the existing material untouched.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react';
import {
  ApiRequestError,
  BACKEND_CONFIGURED,
  isAuthError,
} from '../api/client';
import { getCsrfToken, setCsrfToken, subscribeCsrf } from '../api/csrfStore';
import { listTextureAssets, uploadTextureAsset } from '../api/textureApi';
import { defaultTextureTargetSize, normalizeTextureForUpload } from '../image/textureNormalize';
import { loadTextureThumbnail } from '../image/textureThumbnail';
import { MAX_TEXTURE_BYTES, validateTextureFileContent } from '../image/textureFile';
import type { TextureAssetRef } from '../materials/asset';
import {
  baseColorTextureRef,
  textureItemFromApi,
  type TextureLibraryItem,
} from '../materials/textureAssetApi';
import {
  getTextureResolutionStatus,
  subscribeTextureResolution,
} from '../materials/textureStatus';

interface TexturePickerProps {
  objectId: string;
  currentRef: TextureAssetRef | null;
  onApply: (ref: TextureAssetRef) => void;
  onRemove: () => void;
  /** Test override; production reads the build-time backend flag. */
  backendConfigured?: boolean;
}

type ListState = 'idle' | 'loading' | 'ready' | 'auth' | 'error';

function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (isAuthError(error)) {
      return "Tizimga kiring — tekstura yuklash uchun sessiya kerak.";
    }
    if (error.status === 429 && error.retryAfter) {
      return `${error.message} (${error.retryAfter} soniyadan keyin).`;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Tekstura bilan xatolik yuz berdi.";
}

export function TexturePicker({
  objectId,
  currentRef,
  onApply,
  onRemove,
  backendConfigured,
}: TexturePickerProps) {
  const configured = backendConfigured ?? BACKEND_CONFIGURED;
  const [token, setToken] = useState<string | null>(getCsrfToken);
  const [items, setItems] = useState<TextureLibraryItem[]>([]);
  const [listState, setListState] = useState<ListState>('idle');
  const [listMessage, setListMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'info' | 'error' | 'success'>('info');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const resolution = useSyncExternalStore(
    useCallback(
      (listener) => subscribeTextureResolution(objectId, listener),
      [objectId],
    ),
    () => getTextureResolutionStatus(objectId),
    () => undefined,
  );

  useEffect(() => {
    const update = () => setToken(getCsrfToken());
    update();
    return subscribeCsrf(update);
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!configured) {
        return;
      }
      setListState('loading');
      setListMessage('');
      try {
        const raw = await listTextureAssets(signal);
        setItems(raw.map(textureItemFromApi));
        setListState('ready');
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        if (error instanceof ApiRequestError && isAuthError(error)) {
          // The session expired or was revoked: a stale token must not keep the
          // upload UI looking usable.
          setCsrfToken(null);
          setListState('auth');
          return;
        }
        setListState('error');
        setListMessage(describeError(error));
      }
    },
    [configured],
  );

  useEffect(() => {
    if (!configured) {
      return;
    }
    const controller = new AbortController();
    // `refresh` owns the external request lifecycle (loading → ready/error); it is
    // intentionally kicked off from this effect, not from a render.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh(controller.signal);
    return () => controller.abort();
    // The session token is an intentional trigger: signing in/out must reload
    // the user's library.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [configured, token, refresh]);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const loaded = await Promise.all(
        items.map(async (item) => {
          try {
            const blob = await loadTextureThumbnail(item.asset.id);
            if (cancelled) {
              return null;
            }
            const url = URL.createObjectURL(blob);
            return { id: item.asset.id, url };
          } catch {
            // A failed thumbnail must not hide the metadata card.
            return null;
          }
        }),
      );
      if (cancelled) {
        for (const entry of loaded) {
          if (entry) {
            URL.revokeObjectURL(entry.url);
          }
        }
        return;
      }
      const next: Record<string, string> = {};
      for (const entry of loaded) {
        if (entry) {
          urls.push(entry.url);
          next[entry.id] = entry.url;
        }
      }
      setThumbs(next);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [items]);

  const currentItem = currentRef
    ? items.find((item) => item.asset.id === currentRef.id)
    : undefined;
  const currentLabel = currentItem?.filename ?? (currentRef ? `Texture ${currentRef.id.slice(0, 8)}` : null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setMessage('');
    if (!token) {
      setMessageKind('error');
      setMessage("Yuklash uchun tizimga kiring.");
      return;
    }

    setUploading(true);
    try {
      if (file.size > MAX_TEXTURE_BYTES) {
        setMessageKind('error');
        setMessage(
          `Fayl hajmi juda katta (maksimum ${MAX_TEXTURE_BYTES / (1024 * 1024)} MB).`,
        );
        return;
      }
      const buffer = await file.arrayBuffer();
      const validated = validateTextureFileContent({
        buffer,
        declaredMime: file.type,
      });
      if (!validated.ok) {
        setMessageKind('error');
        setMessage(validated.message);
        return;
      }

      const normalized = await normalizeTextureForUpload(file, validated, {
        maxDimension: defaultTextureTargetSize(),
      });
      const stem = file.name.replace(/\.[^.]+$/, '').trim() || 'texture';
      const raw = await uploadTextureAsset(normalized.blob, `${stem}.png`, token);
      const item = textureItemFromApi(raw);

      setItems((previous) => [
        item,
        ...previous.filter((entry) => entry.asset.id !== item.asset.id),
      ]);
      onApply(baseColorTextureRef(item.asset));
      setMessageKind('success');
      setMessage(`"${item.filename}" yuklandi va Base Color sifatida qo'llandi.`);
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        (isAuthError(error) || error.code === 'csrf_failed')
      ) {
        setCsrfToken(null);
      }
      setMessageKind('error');
      setMessage(describeError(error));
    } finally {
      setUploading(false);
      if (fileInput.current) {
        fileInput.current.value = '';
      }
    }
  };

  if (!configured) {
    return (
      <section className="texture-picker" data-testid="texture-picker">
        <div className="texture-picker__head">
          <h3 className="texture-picker__title">Base Color tekstura</h3>
          {currentRef ? (
            <button type="button" className="texture-picker__remove" onClick={onRemove}>
              Olib tashlash
            </button>
          ) : null}
        </div>
        {currentRef ? (
          <p className="texture-picker__current" data-testid="texture-current">
            Joriy: <strong>{currentLabel}</strong>
          </p>
        ) : null}
        <p className="texture-picker__hint">
          Tekstura yuklash uchun server manzili sozlanmagan. Bitmap teksturalar
          serverda saqlanadi; mavjud teksturani faqat server bilan ochish mumkin.
        </p>
      </section>
    );
  }

  return (
    <section className="texture-picker" data-testid="texture-picker">
      <div className="texture-picker__head">
        <h3 className="texture-picker__title">Base Color tekstura</h3>
        {currentRef ? (
          <button type="button" className="texture-picker__remove" onClick={onRemove}>
            Olib tashlash
          </button>
        ) : null}
      </div>

      <p className="texture-picker__current" data-testid="texture-current">
        {currentRef ? (
          <>
            Joriy: <strong>{currentLabel}</strong>
            {currentItem ? (
              <span className="texture-picker__meta">
                {currentItem.asset.width}×{currentItem.asset.height}
              </span>
            ) : null}
          </>
        ) : (
          'Bitmap tekstura tanlanmagan — protsedural material ishlatiladi.'
        )}
      </p>

      {resolution?.state === 'loading' ? (
        <p className="texture-picker__hint" role="status">
          3D ko&apos;rinishda tekstura yuklanmoqda…
        </p>
      ) : null}
      {resolution?.state === 'error' ? (
        <p className="texture-picker__hint texture-picker__hint--error" role="alert">
          {resolution.message} Mavjud material ko&apos;rsatilmoqda.
        </p>
      ) : null}
      {currentRef && listState === 'ready' && !currentItem ? (
        <p className="texture-picker__hint texture-picker__hint--error" role="alert">
          Joriy tekstura ro&apos;yxatda topilmadi (o&apos;chirilgan yoki boshqa
          hisobga tegishli). Uni olib tashlab, qayta yuklang.
        </p>
      ) : null}

      <div className="texture-picker__actions">
        <input
          ref={fileInput}
          className="texture-picker__file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Tekstura fayli"
          disabled={!token || uploading}
          onChange={(event) => void handleFile(event)}
        />
        <button
          type="button"
          className="visual-reset texture-picker__upload"
          disabled={!token || uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? 'Yuklanmoqda…' : 'Tekstura yuklash'}
        </button>
      </div>

      {!token ? (
        <p className="texture-picker__hint">
          Yuklash uchun tizimga kiring. Ro&apos;yxatdagi mavjud teksturalarni
          tanlash uchun ham sessiya kerak.
        </p>
      ) : null}

      {message ? (
        <p
          className={`texture-picker__hint texture-picker__hint--${messageKind}`}
          data-testid="texture-message"
          role={messageKind === 'error' ? 'alert' : 'status'}
        >
          {message}
        </p>
      ) : null}

      {listState === 'loading' ? (
        <p className="texture-picker__hint" role="status">
          Teksturalar ro&apos;yxati yuklanmoqda…
        </p>
      ) : null}
      {listState === 'auth' ? (
        <p className="texture-picker__hint">
          Teksturalar ro&apos;yxati uchun tizimga kiring.
        </p>
      ) : null}
      {listState === 'error' ? (
        <p className="texture-picker__hint texture-picker__hint--error" role="alert">
          {listMessage}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="texture-grid" data-testid="texture-grid">
          {items.map((item) => {
            const active = currentRef?.id === item.asset.id;
            return (
              <button
                key={item.asset.id}
                type="button"
                className={`texture-card${active ? ' texture-card--active' : ''}`}
                aria-pressed={active}
                data-testid={`texture-item-${item.asset.id}`}
                title={`${item.filename} — ${item.asset.width}×${item.asset.height}`}
                onClick={() => onApply(baseColorTextureRef(item.asset))}
              >
                {thumbs[item.asset.id] ? (
                  <img
                    className="texture-card__image"
                    src={thumbs[item.asset.id]}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="texture-card__placeholder" aria-hidden="true" />
                )}
                <span className="texture-card__label">{item.filename}</span>
                <span className="texture-card__meta">
                  {item.asset.width}×{item.asset.height}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {listState === 'ready' && items.length === 0 ? (
        <p className="texture-picker__hint" data-testid="texture-empty">
          Hali tekstura yuklanmagan. Yuqoridagi tugma orqali PNG, JPEG yoki WebP
          qo&apos;shing.
        </p>
      ) : null}
    </section>
  );
}
