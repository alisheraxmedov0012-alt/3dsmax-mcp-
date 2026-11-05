import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildExportScene } from '../export/sceneExport';
import { createDefaultScene } from '../scene/types';
import { createShadowCatcher } from './shadowCatcher';

const bounds = {
  min: { x: -40, y: 0, z: -20 },
  max: { x: 60, y: 80, z: 40 },
};

describe('createShadowCatcher', () => {
  it('creates a small, non-casting shadow receiver', () => {
    const catcher = createShadowCatcher();
    try {
      const mesh = catcher.object;
      expect(mesh.name).toBe('shadow-catcher');
      expect(mesh.visible).toBe(false);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.material).toBeInstanceOf(THREE.ShadowMaterial);
      const material = mesh.material as THREE.ShadowMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(mesh.geometry).toBeInstanceOf(THREE.BufferGeometry);
    } finally {
      catcher.dispose();
    }
  });

  it('sizes and places the catcher under the selected bounds', () => {
    const catcher = createShadowCatcher();
    try {
      catcher.update(bounds, true);

      expect(catcher.object.visible).toBe(true);
      expect(catcher.object.position.x).toBeCloseTo(10, 8);
      expect(catcher.object.position.z).toBeCloseTo(10, 8);
      expect(catcher.object.position.y).toBeGreaterThan(0);
      expect(catcher.object.scale.x).toBeGreaterThan(100);
      expect(catcher.object.scale.z).toBe(catcher.object.scale.x);

      catcher.update(bounds, false);
      expect(catcher.object.visible).toBe(false);

      catcher.update(null, true);
      expect(catcher.object.visible).toBe(false);
    } finally {
      catcher.dispose();
    }
  });

  it('disposes geometry and material once', () => {
    const catcher = createShadowCatcher();
    const disposeGeometry = vi.spyOn(catcher.object.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(catcher.object.material as THREE.Material, 'dispose');

    catcher.dispose();
    catcher.dispose();

    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(catcher.object.visible).toBe(false);
  });
});

describe('shadow catcher export isolation', () => {
  it('is not present in the GLB export scene', () => {
    const data = createDefaultScene(() => 'export-table');
    data.settings.background = '#101113';
    const exported = buildExportScene(data);
    try {
      let found = false;
      exported.scene.traverse((node) => {
        if (node.name === 'shadow-catcher') {
          found = true;
        }
      });
      expect(found).toBe(false);
      expect(exported.scene.background).toBeNull();
      expect(exported.scene.environment).toBeNull();
    } finally {
      exported.dispose();
    }
  });
});
