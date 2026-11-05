/**
 * Phase 4.6 — per-object bitmap map lifecycle.
 *
 * Keeps the async texture work out of the renderer class so the stale-request
 * and reference-release rules can be tested without WebGL. Each `sync` call owns
 * one token: results from an older token are released, never applied.
 */
import type * as THREE from 'three';
import type { MaterialAssetMaps, TextureMapRole } from './asset';
import {
  presentTextureMapRoles,
  textureMapsKey,
  type ApplyTextureMapOptions,
} from './applyTextureMaps';
import {
  textureRegistry,
  type TextureAcquireOptions,
  type TextureProvider,
} from './textureRegistry';

export type TextureMapStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string };

export interface TextureMapLoaderOptions {
  provider?: TextureProvider;
  /** Attach one resolved texture to the object's live materials. */
  apply: (
    role: TextureMapRole,
    texture: THREE.Texture,
    options: ApplyTextureMapOptions,
  ) => void;
  /** `null` clears the status when the object no longer has any map. */
  onStatus?: (status: TextureMapStatus | null) => void;
}

export class ObjectTextureMapLoader {
  private readonly provider: TextureProvider;
  private readonly apply: TextureMapLoaderOptions['apply'];
  private readonly onStatus?: TextureMapLoaderOptions['onStatus'];
  private token = 0;
  private releases: Array<() => void> = [];
  private key?: string;

  constructor(options: TextureMapLoaderOptions) {
    this.provider = options.provider ?? textureRegistry;
    this.apply = options.apply;
    this.onStatus = options.onStatus;
  }

  sync(
    maps: MaterialAssetMaps | undefined,
    repeat: number,
    options: ApplyTextureMapOptions = {},
  ): void {
    const key = textureMapsKey(maps ?? {}, repeat);
    if (this.key === key) {
      return;
    }
    this.key = key;
    this.releaseAll();

    const roles = presentTextureMapRoles(maps);
    const token = (this.token += 1);
    if (roles.length === 0) {
      this.onStatus?.(null);
      return;
    }

    this.onStatus?.({ state: 'loading' });
    const failures: string[] = [];
    let pending = roles.length;
    const acquireOptions: TextureAcquireOptions = { repeat };

    const complete = (): void => {
      pending -= 1;
      if (pending > 0 || token !== this.token) {
        return;
      }
      this.onStatus?.(
        failures.length > 0
          ? { state: 'error', message: failures.join(' ') }
          : { state: 'ready' },
      );
    };

    for (const role of roles) {
      const ref = maps?.[role];
      if (!ref) {
        complete();
        continue;
      }
      void this.provider
        .acquire(ref, acquireOptions)
        .then((texture) => {
          if (token !== this.token) {
            this.provider.release(ref, acquireOptions);
            return;
          }
          this.releases.push(() => this.provider.release(ref, acquireOptions));
          this.apply(role, texture, options);
          complete();
        })
        .catch((error: unknown) => {
          if (token === this.token) {
            failures.push(error instanceof Error ? error.message : 'Tekstura yuklanmadi.');
          }
          complete();
        });
    }
  }

  /** Release every texture acquired by the current state. */
  releaseAll(): void {
    for (const release of this.releases) {
      release();
    }
    this.releases = [];
  }

  /** Invalidate in-flight work and release every acquired texture. */
  dispose(): void {
    this.token += 1;
    this.key = undefined;
    this.releaseAll();
  }
}
