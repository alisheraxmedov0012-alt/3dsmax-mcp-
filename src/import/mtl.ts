/**
 * Phase 6.2.3 — MTL parsing and the deterministic conversion to the editor's
 * material model.
 *
 * `MTLLoader` is reused as the *tokenizer* only (`parse()` builds the material
 * records and nothing else). Its material creator is deliberately not used: it
 * loads textures through its own loaders — which would bypass the in-memory
 * resource policy — and it produces `MeshPhongMaterial`. Building the
 * `MeshStandardMaterial` here keeps the conversion explicit, testable and
 * identical for every file.
 *
 * The conversion is an approximation and is reported as such in the UI:
 *
 * | MTL            | editor material                                  |
 * | -------------- | ------------------------------------------------ |
 * | `Kd`           | base colour                                      |
 * | `d` / `Tr`     | opacity (`Tr` is inverted)                       |
 * | `Ns` (0…1000)  | roughness = 1 − √(Ns/1000), clamped              |
 * | `Ks`           | metalness = (max(Ks) − 0.5) × 2, clamped         |
 * | `map_Kd`       | base-colour map                                  |
 * | `map_Bump`/`bump`/`norm` | normal map                             |
 * | `Ke`           | emissive colour                                  |
 *
 * MTL cannot express metalness/AO/emissive maps or modern PBR channels, so the
 * result is never claimed to be a faithful round trip.
 */
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { importFailure } from './importErrors';
import {
  MAX_MTL_MATERIALS,
  MAX_OBJECT_NAME_LENGTH,
  MAX_TEXT_LINE_LENGTH,
} from './importLimits';
import { normalizeImportPath } from './resourceMap';

export interface MtlMaterial {
  readonly name: string;
  readonly baseColor: readonly [number, number, number];
  readonly opacity: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly baseColorMap: string | null;
  readonly normalMap: string | null;
  readonly emissive: readonly [number, number, number] | null;
}

export interface MtlParseResult {
  readonly materials: ReadonlyMap<string, MtlMaterial>;
  /** Texture references that could not be used, with the reason. */
  readonly warnings: readonly string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function colorOf(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) {
    return null;
  }
  const channels = value.slice(0, 3).map((entry) => clamp01(Number(entry)));
  return channels.some((entry) => !Number.isFinite(entry))
    ? null
    : [channels[0], channels[1], channels[2]];
}

function numberOf(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Bounds the text before the tokenizer sees it.
 *
 * A single enormous line, thousands of materials or a control-character name are
 * all rejected here rather than becoming allocations inside `MTLLoader`.
 */
function scanMtl(text: string, fileName: string): void {
  let lineStart = 0;
  let line = 0;
  let materialCount = 0;

  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) {
      lineEnd = text.length;
    }
    line += 1;
    if (lineEnd - lineStart > MAX_TEXT_LINE_LENGTH) {
      throw importFailure(
        'too_complex',
        `${fileName}: ${line}-qator juda uzun (limit ${MAX_TEXT_LINE_LENGTH}).`,
      );
    }
    const start = text.slice(lineStart, lineEnd).trimStart();
    if (start.startsWith('newmtl')) {
      materialCount += 1;
      if (materialCount > MAX_MTL_MATERIALS) {
        throw importFailure(
          'too_complex',
          `${fileName}: materiallar soni ${MAX_MTL_MATERIALS} dan oshdi.`,
        );
      }
      const name = start.slice(6).trim();
      if (name.length > MAX_OBJECT_NAME_LENGTH) {
        throw importFailure('malformed', `${fileName}: material nomi juda uzun.`);
      }
    }
    if (lineEnd === text.length) {
      break;
    }
    lineStart = lineEnd + 1;
  }
}

function textureOf(
  value: unknown,
  creator: MTLLoader.MaterialCreator,
  warnings: string[],
  materialName: string,
  property: string,
): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = creator.getTextureParams(value, {});
  const normalized = normalizeImportPath(parsed.url);
  if (!normalized.ok) {
    // The reference never reaches the filesystem either way, so the safe outcome
    // is to leave the texture off and say so, not to discard the whole model.
    warnings.push(`${materialName}: ${property} yo‘li qabul qilinmadi — tekstura qo‘llanmadi.`);
    return null;
  }
  return normalized.path;
}

/** Parses an MTL document into deterministic material specifications. */
export function parseMtlDocument(text: string, fileName = 'model.mtl'): MtlParseResult {
  scanMtl(text, fileName);

  let creator: MTLLoader.MaterialCreator;
  try {
    creator = new MTLLoader().parse(text, '');
  } catch {
    throw importFailure('malformed', `${fileName}: MTL o‘qilmadi.`);
  }

  const materials = new Map<string, MtlMaterial>();
  const warnings: string[] = [];

  for (const [name, info] of Object.entries(creator.materialsInfo)) {
    const baseColor = colorOf(info.kd) ?? [0.8, 0.8, 0.8];
    const specular = colorOf(info.ks);

    const dissolve = numberOf(info.d);
    const transparency = numberOf(info.tr);
    const opacity = clamp01(dissolve ?? (transparency === null ? 1 : 1 - transparency));

    const shininess = numberOf(info.ns);
    const roughness =
      shininess === null ? 0.6 : Math.min(1, Math.max(0.04, 1 - Math.sqrt(clamp01(shininess / 1000))));

    // A bright specular highlight on a Phong material is the only metalness hint
    // MTL carries; this is an approximation, not a measurement.
    const metalness = specular === null ? 0 : clamp01((Math.max(...specular) - 0.5) * 2);

    materials.set(name, {
      name,
      baseColor,
      opacity,
      roughness,
      metalness,
      baseColorMap: textureOf(info.map_kd, creator, warnings, name, 'map_Kd'),
      normalMap:
        textureOf(info.map_bump, creator, warnings, name, 'map_Bump') ??
        textureOf(info.bump, creator, warnings, name, 'bump') ??
        textureOf(info.norm, creator, warnings, name, 'norm'),
      emissive: colorOf(info.ke),
    });
  }

  return { materials, warnings };
}
