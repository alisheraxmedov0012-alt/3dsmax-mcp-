/**
 * B3 — object-level print readiness.
 *
 * The geometry is built exactly as the viewer and the STL/3MF exporters build it
 * (`buildSceneObject`: object transform, visibility, material), so the measured
 * size and checks describe the file a user would actually export.
 */
import { buildSceneObject } from '../scene/buildSceneObject';
import { importedModelStore } from '../import/importedModelStore';
import type { SceneObject } from '../scene/types';
import type { PrinterProfile } from './printerProfile';
import { validatePrintReadiness } from './printValidation';
import type { PrintReadinessReport } from './printTypes';

/**
 * Identity of everything the report depends on. If the object or profile
 * changes, the fingerprint changes, so a stored report cannot be reused.
 */
export function printFingerprint(
  object: SceneObject,
  profile: PrinterProfile | null,
): string {
  return JSON.stringify({
    type: object.type,
    definitionId: object.definitionId ?? null,
    spec: object.spec ?? null,
    params: object.params,
    position: object.position,
    rotation: object.rotation,
    scale: object.scale,
    visible: object.visible,
    profile: profile
      ? {
          buildVolumeMm: profile.buildVolumeMm,
          minWallThicknessMm: profile.minWallThicknessMm,
          minFeatureSizeMm: profile.minFeatureSizeMm,
        }
      : null,
  });
}

/** Build the selected object, validate it, and dispose the geometry afterwards. */
export function analyzeObjectPrintReadiness(
  object: SceneObject,
  profile: PrinterProfile | null = null,
): PrintReadinessReport {
  const built = buildSceneObject(object, { imported: importedModelStore });
  try {
    return validatePrintReadiness(built.group, {
      profile,
      fingerprint: printFingerprint(object, profile),
    });
  } finally {
    built.dispose();
  }
}
