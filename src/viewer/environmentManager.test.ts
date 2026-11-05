import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildExportScene } from '../export/sceneExport';
import { createDefaultScene } from '../scene/types';
import {
  EnvironmentManager,
  type PmremGeneratorLike,
  type RoomEnvironmentLike,
} from './environmentManager';

function makeTarget(): THREE.WebGLRenderTarget {
  return {
    texture: new THREE.Texture(),
    dispose: vi.fn(),
  } as unknown as THREE.WebGLRenderTarget;
}

function makeHarness() {
  const scene = new THREE.Scene();
  const room = Object.assign(new THREE.Scene(), {
    dispose: vi.fn(),
  }) as RoomEnvironmentLike;
  const targets = [makeTarget(), makeTarget(), makeTarget()];
  const pmrem: PmremGeneratorLike = {
    fromScene: vi.fn(() => targets.shift() ?? makeTarget()),
    dispose: vi.fn(),
  };
  const createRoomEnvironment = vi.fn(() => room);
  const createPmremGenerator = vi.fn(() => pmrem);
  const manager = new EnvironmentManager({} as THREE.WebGLRenderer, scene, {
    createRoomEnvironment,
    createPmremGenerator,
  });

  return { scene, room, targets, pmrem, createRoomEnvironment, createPmremGenerator, manager };
}

describe('EnvironmentManager', () => {
  it('creates nothing while the environment is disabled', () => {
    const { scene, manager, createRoomEnvironment, createPmremGenerator } = makeHarness();

    manager.apply({ enabled: false, intensity: 1 });

    expect(createRoomEnvironment).not.toHaveBeenCalled();
    expect(createPmremGenerator).not.toHaveBeenCalled();
    expect(scene.environment).toBeNull();
    expect(scene.environmentIntensity).toBe(1);
  });

  it('generates and attaches a RoomEnvironment PMREM texture', () => {
    const { scene, manager, pmrem, createRoomEnvironment, createPmremGenerator, targets } =
      makeHarness();
    const target = targets[0];

    manager.apply({ enabled: true, intensity: 1.25 });

    expect(createPmremGenerator).toHaveBeenCalledTimes(1);
    expect(createRoomEnvironment).toHaveBeenCalledTimes(1);
    expect(pmrem.fromScene).toHaveBeenCalledTimes(1);
    expect(pmrem.fromScene).toHaveBeenCalledWith(expect.any(THREE.Scene), 0, 0.1, 100);
    expect(scene.environment).toBe(target.texture);
    expect(scene.environmentIntensity).toBe(1.25);
  });

  it('reuses the texture for repeated and intensity-only updates', () => {
    const { scene, manager, pmrem } = makeHarness();

    manager.apply({ enabled: true, intensity: 1 });
    manager.apply({ enabled: true, intensity: 1 });
    manager.apply({ enabled: true, intensity: 2.2 });

    expect(pmrem.fromScene).toHaveBeenCalledTimes(1);
    expect(scene.environmentIntensity).toBe(2.2);
  });

  it('clamps environment intensity to the documented limits', () => {
    const { scene, manager } = makeHarness();

    manager.apply({ enabled: true, intensity: 99 });
    expect(scene.environmentIntensity).toBe(3);

    manager.apply({ enabled: true, intensity: -5 });
    expect(scene.environmentIntensity).toBe(0);
  });

  it('disposes the old texture on disable and regenerates on re-enable', () => {
    const { scene, manager, pmrem, targets } = makeHarness();
    const first = targets[0];
    const second = targets[1];

    manager.apply({ enabled: true, intensity: 1 });
    expect(scene.environment).toBe(first.texture);

    manager.apply({ enabled: false, intensity: 1 });
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(scene.environment).toBeNull();
    expect(scene.environmentIntensity).toBe(1);

    manager.apply({ enabled: true, intensity: 1 });
    expect(second.dispose).not.toHaveBeenCalled();
    expect(scene.environment).toBe(second.texture);
    expect(pmrem.fromScene).toHaveBeenCalledTimes(2);
  });

  it('disposes the PMREM texture, RoomEnvironment and generator', () => {
    const { scene, room, targets, pmrem, manager } = makeHarness();
    const target = targets[0];
    manager.apply({ enabled: true, intensity: 1 });

    manager.dispose();

    expect(target.dispose).toHaveBeenCalledTimes(1);
    expect(room.dispose).toHaveBeenCalledTimes(1);
    expect(pmrem.dispose).toHaveBeenCalledTimes(1);
    expect(scene.environment).toBeNull();
    expect(scene.environmentIntensity).toBe(1);

    manager.dispose();
    expect(target.dispose).toHaveBeenCalledTimes(1);
    expect(pmrem.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed PMREM generation on every update', () => {
    const { scene, manager, pmrem, createPmremGenerator } = makeHarness();
    pmrem.fromScene = vi.fn(() => {
      throw new Error('PMREM failed');
    });

    manager.apply({ enabled: true, intensity: 1 });
    manager.apply({ enabled: true, intensity: 1 });
    manager.apply({ enabled: true, intensity: 2 });

    expect(createPmremGenerator).toHaveBeenCalledTimes(1);
    expect(pmrem.fromScene).toHaveBeenCalledTimes(1);
    expect(scene.environment).toBeNull();
    expect(manager.getLastError()).toBeInstanceOf(Error);

    manager.apply({ enabled: false, intensity: 1 });
    manager.apply({ enabled: true, intensity: 1 });
    expect(pmrem.fromScene).toHaveBeenCalledTimes(2);
  });
});

describe('GLB export isolation', () => {
  it('does not copy the viewer environment into the export scene', () => {
    const data = createDefaultScene(() => 'export-table');
    const withEnvironment = {
      ...data,
      settings: {
        ...data.settings,
        environmentEnabled: true,
        environmentIntensity: 2.5,
      },
    };

    const exported = buildExportScene(withEnvironment);
    try {
      expect(exported.scene.environment).toBeNull();
      expect(exported.scene.environmentIntensity).toBe(1);

      exported.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) {
          return;
        }
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            expect(material.envMap).toBeNull();
          }
        }
      });
    } finally {
      exported.dispose();
    }
  });
});
