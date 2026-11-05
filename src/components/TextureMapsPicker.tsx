/**
 * Phase 4.5 — advanced PBR map picker.
 *
 * One shared texture library and one shared upload path serve normal,
 * roughness, metalness, AO, ORM and emissive. Switching the active role never
 * fetches the library again, which keeps the panel usable on mobile.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react';
import { ApiRequestError, BACKEND_CONFIGURED, isAuthError } from '../api/client';
import { getCsrfToken, setCsrfToken, subscribeCsrf } from '../api/csrfStore';
import { listTextureAssets } from '../api/textureApi';
import { loadTextureThumbnail } from '../image/textureThumbnail';
import type { MaterialAssetMaps, TextureAssetRef, TextureMapRole } from '../materials/asset';
import { TEXTURE_MAP_ROLE_LABELS } from '../materials/asset';
import { textureItemFromApi, textureRefForRole, type TextureLibraryItem } from '../materials/textureAssetApi';
import {
  getTextureResolutionStatus,
  subscribeTextureResolution,
} from '../materials/textureStatus';
import { uploadTextureFile } from './textureUpload';

/** Base Color keeps its Phase 4.3 picker; this component owns the rest. */
export const ADVANCED_TEXTURE_MAP_ROLES: readonly TextureMapRole[] = [
  'normal',
  'roughness',
  'metalness',
  'ao',
  'orm',
  'emissive',
];

interface TextureMapsPickerProps {
  objectId: string;
  maps: MaterialAssetMaps | undefined;
  onMapChange: (role: TextureMapRole, ref: TextureAssetRef | null) => void;
  backendConfigured?: boolean;
}

type ListState = 'idle' | 'loading' | 'ready' | 'auth' | 'error';

function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (isAuthError(error)) {
      return 'Tizimga kiring — tekstura yuklash uchun sessiya kerak.';
    }
    if (error.status === 429 && error.retryAfter) {
      return `${error.message} (${error.retryAfter} soniyadan keyin).`;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Tekstura bilan xatolik yuz berdi.';
}

export function TextureMapsPicker({
  objectId,
  maps,
  onMapChange,
  backendConfigured,
}: TextureMapsPickerProps) {
  const configured = backendConfigured ?? BACKEND_CONFIGURED;
  const [role, setRole] = useState<TextureMapRole>('normal');
  const [token, setToken] = useState<string | null>(getCsrfToken);
  const [items, setItems] = useState<TextureLibraryItem[]>([]);
  const [listState, setListState] = useState<ListState>('idle');
  const [listMessage, setListMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'info' | 'error' | 'success'>('info');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const currentRef = maps?.[role] ?? null;
  const resolution = useSyncExternalStore(
    useCallback((listener) => subscribeTextureResolution(objectId, listener), [objectId]),
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
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh(controller.signal);
    return () => controller.abort();
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
            return { id: item.asset.id, url: URL.createObjectURL(blob) };
          } catch {
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
  const currentLabel =
    currentItem?.filename ?? (currentRef ? `Texture ${currentRef.id.slice(0, 8)}` : null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setMessage('');
    if (!token) {
      setMessageKind('error');
      setMessage('Yuklash uchun tizimga kiring.');
      return;
    }
    setUploading(true);
    try {
      const item = await uploadTextureFile(file, token);
      setItems((previous) => [
        item,
        ...previous.filter((entry) => entry.asset.id !== item.asset.id),
      ]);
      onMapChange(role, textureRefForRole(item.asset, role));
      setMessageKind('success');
      setMessage(
        `"${item.filename}" yuklandi va ${TEXTURE_MAP_ROLE_LABELS[role]} kartasi sifatida qo'llandi.`,
      );
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

  return (
    <section className="texture-maps" data-testid="texture-maps-picker">
      <h3 className="texture-picker__title">PBR tekstura kartalari</h3>
      <p className="texture-picker__hint" data-testid="texture-orm-note">
        ORM — bitta kanalga qadoqlangan karta: <strong>R</strong> = Ambient Occlusion,{' '}
        <strong>G</strong> = Roughness, <strong>B</strong> = Metalness. Alohida AO,
        Roughness yoki Metalness kartasi biriktirilsa, u ORM kanalidan ustun turadi.
      </p>

      <div
        className="texture-map-roles"
        role="group"
        aria-label="PBR tekstura kartasi"
      >
        {ADVANCED_TEXTURE_MAP_ROLES.map((candidate) => {
          const active = candidate === role;
          return (
            <button
              key={candidate}
              type="button"
              className={`material-category${active ? ' material-category--active' : ''}`}
              aria-pressed={active}
              data-testid={`map-role-${candidate}`}
              onClick={() => {
                setRole(candidate);
                setMessage('');
              }}
            >
              {TEXTURE_MAP_ROLE_LABELS[candidate]}
              {maps?.[candidate] ? <span className="material-category__count">✓</span> : null}
            </button>
          );
        })}
      </div>

      {!configured ? (
        <p className="texture-picker__hint">
          Tekstura yuklash uchun server manzili sozlanmagan. Bitmap teksturalar
          serverda saqlanadi.
        </p>
      ) : (
        <>
          <p className="texture-picker__current" data-testid="texture-map-current">
            {currentRef ? (
              <>
                {TEXTURE_MAP_ROLE_LABELS[role]}: <strong>{currentLabel}</strong>
                {currentItem ? (
                  <span className="texture-picker__meta">
                    {currentItem.asset.width}×{currentItem.asset.height}
                  </span>
                ) : null}
              </>
            ) : (
              `${TEXTURE_MAP_ROLE_LABELS[role]} kartasi tanlanmagan.`
            )}
          </p>

          {currentRef ? (
            <button
              type="button"
              className="texture-picker__remove"
              onClick={() => onMapChange(role, null)}
            >
              {TEXTURE_MAP_ROLE_LABELS[role]} kartasini olib tashlash
            </button>
          ) : null}

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
              Joriy karta ro&apos;yxatda topilmadi (o&apos;chirilgan yoki boshqa
              hisobga tegishli).
            </p>
          ) : null}

          <div className="texture-picker__actions">
            <input
              ref={fileInput}
              className="texture-picker__file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={`${TEXTURE_MAP_ROLE_LABELS[role]} fayli`}
              disabled={!token || uploading}
              onChange={(event) => void handleFile(event)}
            />
            <button
              type="button"
              className="visual-reset texture-picker__upload"
              disabled={!token || uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? 'Yuklanmoqda…' : `${TEXTURE_MAP_ROLE_LABELS[role]} yuklash`}
            </button>
          </div>

          {!token ? (
            <p className="texture-picker__hint">
              Yuklash uchun tizimga kiring. Ro&apos;yxatdagi teksturalarni tanlash
              uchun ham sessiya kerak.
            </p>
          ) : null}

          {message ? (
            <p
              className={`texture-picker__hint texture-picker__hint--${messageKind}`}
              data-testid="texture-map-message"
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
            <p className="texture-picker__hint">Teksturalar ro&apos;yxati uchun tizimga kiring.</p>
          ) : null}
          {listState === 'error' ? (
            <p className="texture-picker__hint texture-picker__hint--error" role="alert">
              {listMessage}
            </p>
          ) : null}

          {items.length > 0 ? (
            <div className="texture-grid" data-testid="texture-map-grid">
              {items.map((item) => {
                const active = currentRef?.id === item.asset.id;
                return (
                  <button
                    key={item.asset.id}
                    type="button"
                    className={`texture-card${active ? ' texture-card--active' : ''}`}
                    aria-pressed={active}
                    data-testid={`texture-map-item-${role}-${item.asset.id}`}
                    title={`${item.filename} — ${item.asset.width}×${item.asset.height}`}
                    onClick={() => onMapChange(role, textureRefForRole(item.asset, role))}
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
                  </button>
                );
              })}
            </div>
          ) : null}

          {listState === 'ready' && items.length === 0 ? (
            <p className="texture-picker__hint" data-testid="texture-map-empty">
              Hali tekstura yuklanmagan. Yuqoridagi tugma orqali PNG, JPEG yoki WebP
              qo&apos;shing.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
