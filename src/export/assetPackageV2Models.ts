/**
 * Phase 6.1-B — build the four model representations from one logical selection.
 *
 * Each format gets a fresh export scene. The original SceneData is never
 * mutated, and no mutable Three.js scene is shared between exporters.
 */
import { sha256Hex } from '../util/sha256';
import { sceneForObject } from '../scene/sceneSelection';
import type { TextureProvider } from '../materials/textureRegistry';
import { exportSceneToGlb, buildTexturedExportScene } from './sceneExport';
import { exportSceneToFormat } from './sceneFileExport';
import { summarizeGlb } from './glbSummary';
import { exportObjWithMtl } from './objMtl';
import type { TexturePngEncoder } from './texturePng';
import {
  glbStats,
  inspectStlBytes,
  inspectThreeMfBytes,
} from './modelFormatStats';
import { objMtlPath, type AssetPackageV2ModelFormat } from './assetPackageV2Schema';
import type {
  AssetPackageV2Input,
  AssetPackageV2Model,
  AssetPackageV2Texture,
} from './assetPackageV2Schema';

export interface V2ModelBuildOptions {
  formats: readonly AssetPackageV2ModelFormat[];
  textureSize?: 128 | 512;
  textureProvider?: TextureProvider;
  textureEncoder?: TexturePngEncoder;
  onProgress?: (format: AssetPackageV2ModelFormat) => void;
}

export interface V2ModelBundle {
  models: AssetPackageV2Model[];
  textures: AssetPackageV2Texture[];
  /** Model, MTL and texture-sidecar bytes, keyed by archive path. */
  modelFiles: Record<string, Uint8Array>;
}

function modelPath(format: AssetPackageV2ModelFormat): string {
  return `models/model.${format}`;
}

function modelRecord(
  format: AssetPackageV2ModelFormat,
  bytes: Uint8Array,
  stats: AssetPackageV2Model['stats'],
): AssetPackageV2Model {
  return {
    format,
    file: modelPath(format),
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    unit: format === 'glb' ? 'm' : 'mm',
    stats,
  };
}

/** Build the requested formats. Throws an actionable error on any failure. */
export async function buildV2Models(
  input: AssetPackageV2Input,
  options: V2ModelBuildOptions,
): Promise<V2ModelBundle> {
  const selected = sceneForObject(input.scene, input.object);
  const title = input.product.title.trim();
  const models: AssetPackageV2Model[] = [];
  const textures: AssetPackageV2Texture[] = [];
  const modelFiles: Record<string, Uint8Array> = {};

  for (const format of options.formats) {
    options.onProgress?.(format);
    if (format === 'glb') {
      // eslint-disable-next-line no-await-in-loop
      const glb = await exportSceneToGlb(selected, {
        includeRoom: false,
        ...(options.textureSize ? { textureSize: options.textureSize } : {}),
        ...(options.textureProvider ? { textureProvider: options.textureProvider } : {}),
      });
      const summarized = summarizeGlb(glb);
      if (!summarized.ok) {
        throw new Error(`GLB tekshiruvdan o'tmadi: ${summarized.reason}`);
      }
      const bytes = new Uint8Array(glb);
      models.push(modelRecord('glb', bytes, glbStats(summarized.summary)));
      modelFiles[modelPath('glb')] = bytes;
      continue;
    }

    if (format === 'obj') {
      // eslint-disable-next-line no-await-in-loop
      const built = await buildTexturedExportScene(selected, {
        includeRoom: false,
        ...(options.textureSize ? { textureSize: options.textureSize } : {}),
        ...(options.textureProvider ? { textureProvider: options.textureProvider } : {}),
      });
      let result: Awaited<ReturnType<typeof exportObjWithMtl>>;
      try {
        // eslint-disable-next-line no-await-in-loop
        result = await exportObjWithMtl(
          built.scene,
          options.textureEncoder ? { textureEncoder: options.textureEncoder } : {},
        );
      } finally {
        built.dispose();
      }
      const objPath = modelPath('obj');
      const mtlPath = objMtlPath(objPath);
      models.push(modelRecord('obj', result.objBytes, result.stats));
      modelFiles[objPath] = result.objBytes;
      modelFiles[mtlPath] = result.mtlBytes;
      for (const sidecar of result.textures) {
        modelFiles[sidecar.file] = sidecar.bytes;
        textures.push({
          file: sidecar.file,
          role: sidecar.role,
          sha256: sidecar.sha256,
          bytes: sidecar.bytes.byteLength,
          mimeType: 'image/png',
        });
      }
      continue;
    }

    // Sequential by design: each format gets a fresh export scene, and the
    // exporters share the browser's GPU/CPU resources.
    // eslint-disable-next-line no-await-in-loop
    const artifact = await exportSceneToFormat(
      format,
      selected,
      { name: title, furnitureType: input.object.type, units: 'cm' },
      { includeRoom: false },
    );
    // eslint-disable-next-line no-await-in-loop
    const bytes = new Uint8Array(await artifact.blob.arrayBuffer());
    const stats = format === 'stl' ? inspectStlBytes(bytes) : inspectThreeMfBytes(bytes);
    models.push(modelRecord(format, bytes, stats));
    modelFiles[modelPath(format)] = bytes;
  }

  return { models, textures, modelFiles };
}
