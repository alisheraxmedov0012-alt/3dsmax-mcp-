/**
 * Phase 4.1 — texture source descriptions.
 *
 * A `TextureAssetRef` is only an id. This module turns it into a typed source
 * description the builder can resolve: a procedural generator today, an imported
 * bitmap later. It stays pure so it can be used by the serializable library and
 * tested without a canvas or a GL context.
 */
import type { TextureAssetRef, TextureColorSpace, TextureMapRole } from './asset';
import type { TextureKind } from './types';

export const PROCEDURAL_TEXTURE_PREFIX = 'procedural:';

export const PROCEDURAL_TEXTURE_KINDS: readonly Exclude<TextureKind, 'none'>[] = [
  'wood',
  'brushed',
  'fabric',
  'grain',
];

const ROLE_SUFFIX: Record<TextureMapRole, string> = {
  baseColor: 'color',
  normal: 'normal',
};

const SUFFIX_ROLE: Record<string, TextureMapRole> = {
  color: 'baseColor',
  normal: 'normal',
};

interface TextureSourceBase {
  role: TextureMapRole;
  colorSpace: TextureColorSpace;
}

export interface ProceduralTextureSource extends TextureSourceBase {
  kind: 'procedural';
  textureKind: Exclude<TextureKind, 'none'>;
}

export interface BitmapTextureSource extends TextureSourceBase {
  kind: 'bitmap';
  assetId: string;
  assetVersion: number;
}

export type TextureSource = ProceduralTextureSource | BitmapTextureSource;

/** Stable id for a built-in procedural map. */
export function proceduralTextureId(
  kind: Exclude<TextureKind, 'none'>,
  role: TextureMapRole,
): string {
  return `${PROCEDURAL_TEXTURE_PREFIX}${kind}:${ROLE_SUFFIX[role]}`;
}

/** Parse a procedural id, or null when it is not one (or is malformed). */
export function parseProceduralTextureId(
  id: string,
): { textureKind: Exclude<TextureKind, 'none'>; role: TextureMapRole } | null {
  if (!id.startsWith(PROCEDURAL_TEXTURE_PREFIX)) {
    return null;
  }
  const rest = id.slice(PROCEDURAL_TEXTURE_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 2) {
    return null;
  }
  const [kind, suffix] = parts;
  if (!(PROCEDURAL_TEXTURE_KINDS as readonly string[]).includes(kind)) {
    return null;
  }
  const role = SUFFIX_ROLE[suffix];
  if (!role) {
    return null;
  }
  return { textureKind: kind as Exclude<TextureKind, 'none'>, role };
}

/**
 * Describe how a reference should be resolved.
 *
 * Returns null for a malformed procedural id or when the id's role disagrees
 * with the slot it is stored in — the builder then reports a missing map instead
 * of silently painting the wrong texture.
 */
export function textureSourceFromRef(ref: TextureAssetRef): TextureSource | null {
  if (ref.id.startsWith(PROCEDURAL_TEXTURE_PREFIX)) {
    const parsed = parseProceduralTextureId(ref.id);
    if (!parsed || parsed.role !== ref.role) {
      return null;
    }
    return {
      kind: 'procedural',
      textureKind: parsed.textureKind,
      role: ref.role,
      colorSpace: ref.colorSpace,
    };
  }
  return {
    kind: 'bitmap',
    assetId: ref.id,
    assetVersion: ref.version,
    role: ref.role,
    colorSpace: ref.colorSpace,
  };
}
