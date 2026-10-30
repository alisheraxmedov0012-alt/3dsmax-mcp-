/**
 * Reduce a scene to the objects an export should contain.
 *
 * Shared by the manufacturing package (C1/C8) and the marketplace asset package
 * (A4) so "export just this piece" means the same thing in both archives: the
 * selected object, no room, no assemblies.
 */
import type { SceneData, SceneObject } from './types';

export function sceneForObject(scene: SceneData, object: SceneObject): SceneData {
  return {
    ...scene,
    objects: scene.objects.filter((entry) => entry.id === object.id),
    assemblies: undefined,
  };
}
