/**
 * Phase 5.3 — the shadow cache key.
 *
 * Shadow maps are rendered on demand (renderer.shadowMap.autoUpdate = false).
 * This pure key decides whether the next scene update needs a shadow pass.
 * Camera movement and camera damping are deliberately absent: orbiting does
 * not change a directional light's shadow map.
 */
import { sceneObjectGeometryKey } from '../scene/buildSceneObject';
import type { SceneData } from '../scene/types';

export function buildShadowKey(
  data: SceneData,
  roomKey: string | null,
  selectedId: string | null,
  shadowMapSize: number,
): string {
  const lights = data.settings.lights;
  // Only key-light/shadow inputs affect the depth map. Fill/rim lights,
  // ambient colour, background and environment intensity are intentionally
  // excluded so changing them cannot trigger a shadow pass.
  const shadowLights = {
    keyEnabled: lights.keyEnabled,
    shadowsEnabled: lights.shadowsEnabled,
    shadowBias: lights.shadowBias,
    shadowNormalBias: lights.shadowNormalBias,
    shadowRadius: lights.shadowRadius,
    shadowIntensity: lights.shadowIntensity,
  };
  return JSON.stringify([
    roomKey,
    selectedId,
    data.settings.lightingPreset,
    data.settings.qualityPreset,
    shadowLights,
    data.objects.map((object) => [
      object.id,
      sceneObjectGeometryKey(object),
      object.position,
      object.rotation,
      object.scale,
      object.visible,
    ]),
    shadowMapSize,
  ]);
}

export function shadowKeyChanged(previous: string | null, next: string): boolean {
  return previous !== next;
}
