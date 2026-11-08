/**
 * Phase 9A.1 — scene objects driven by a category-neutral definition.
 *
 * `SceneObject.type` is still a `FurnitureType | 'imported'`, because every
 * furniture panel, BOM, drawing and placement path keys off it. A generic
 * object therefore keeps a *legacy projection*: a furniture type used only by
 * those existing code paths. Its geometry always comes from `definitionId`, and
 * the stored `domain` lets `isFurnitureSceneObject` refuse to treat it as
 * furniture. No panel or control is added in 9A.1.
 */
import { FURNITURE_DOMAIN, ParametricPlanError } from '../geometry/parametric/types';
import { requireParametricDefinition } from '../geometry/parametric/registry';
import { isFurnitureType, type FurnitureType } from '../geometry/furniture/types';
import {
  createFurnitureSceneObject,
  normalizeSceneSpec,
  type FurnitureSceneObjectOverrides,
  type SceneObject,
} from './types';

export interface CreateParametricSceneObjectOptions {
  /**
   * Furniture type used as the legacy projection for a non-furniture object.
   * Defaults to `table`. Ignored for furniture definitions, whose own family is
   * the projection.
   */
  readonly legacyType?: FurnitureType;
  readonly overrides?: FurnitureSceneObjectOverrides;
}

/**
 * Creates a scene object from any registered definition, furniture or not.
 *
 * The spec is parsed and canonicalised by the definition, exactly like
 * `createUniversalSceneObject`; an invalid spec throws instead of producing an
 * object that cannot be built.
 */
export function createParametricSceneObject(
  definitionId: string,
  id: string,
  spec: unknown = undefined,
  options: CreateParametricSceneObjectOptions = {},
): SceneObject {
  const definition = requireParametricDefinition(definitionId);
  const parsed = definition.parseSpec(spec === undefined ? definition.defaults : spec);
  if (!parsed.ok) {
    throw new ParametricPlanError('invalid_spec', parsed.errors.join(' '));
  }
  const canonical = normalizeSceneSpec(parsed.spec);
  if (!canonical) {
    throw new ParametricPlanError(
      'invalid_spec',
      `"${definitionId}": spec canonical shaklga keltirilmadi.`,
    );
  }

  if (definition.domain === FURNITURE_DOMAIN) {
    if (!isFurnitureType(definition.family)) {
      throw new ParametricPlanError(
        'invalid_definition',
        `"${definitionId}": furniture domain uchun family mebel turi bo'lishi kerak.`,
      );
    }
    const object = createFurnitureSceneObject(definition.family, id, {
      name: definition.label,
      ...options.overrides,
    });
    return { ...object, definitionId: definition.id, spec: canonical };
  }

  const legacyType = options.legacyType ?? 'table';
  const object = createFurnitureSceneObject(legacyType, id, {
    name: definition.label,
    ...options.overrides,
  });
  return {
    ...object,
    definitionId: definition.id,
    spec: canonical,
    domain: definition.domain,
  };
}
