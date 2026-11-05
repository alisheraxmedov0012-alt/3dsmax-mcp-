import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  applyFramingToCamera,
  captureCameraState,
  restoreCameraState,
  withRestoredCameraState,
  type OrbitControlsLike,
} from './cameraState';

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.5, 15000);
  camera.position.set(10, 20, 30);
  camera.zoom = 1.2;
  camera.updateProjectionMatrix();
  return camera;
}

function makeControls(target = new THREE.Vector3(1, 2, 3)): OrbitControlsLike {
  return {
    target,
    minDistance: 5,
    maxDistance: 900,
    update: vi.fn(),
  };
}

const vec = (value: { x: number; y: number; z: number }): number[] => [
  value.x,
  value.y,
  value.z,
];

describe('captureCameraState / restoreCameraState', () => {
  it('restores position, target, projection, zoom and orbit limits exactly', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const state = captureCameraState(camera, controls);
    const initialProjection = camera.projectionMatrix.clone();

    camera.position.set(-100, -200, -300);
    camera.up.set(0, 0, 1);
    camera.fov = 20;
    camera.aspect = 9 / 16;
    camera.near = 0.01;
    camera.far = 10;
    camera.zoom = 3;
    controls.target.x = 50;
    controls.target.y = 60;
    controls.target.z = 70;
    controls.minDistance = 1;
    controls.maxDistance = 100000;

    restoreCameraState(camera, controls, state);

    expect(vec(camera.position)).toEqual([10, 20, 30]);
    expect(vec(camera.up)).toEqual([0, 1, 0]);
    expect(vec(controls.target)).toEqual([1, 2, 3]);
    expect(camera.projectionMatrix.elements).toEqual(initialProjection.elements);
    expect(camera.fov).toBe(50);
    expect(camera.aspect).toBeCloseTo(4 / 3, 10);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(15000);
    expect(camera.zoom).toBe(1.2);
    expect(controls.minDistance).toBe(5);
    expect(controls.maxDistance).toBe(900);
    expect(controls.update).toHaveBeenCalledTimes(1);
  });

  it('restores the viewer after applying a capture framing', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const before = captureCameraState(camera, controls);

    applyFramingToCamera(
      camera,
      controls,
      {
        position: { x: 200, y: 300, z: 400 },
        target: { x: 100, y: 50, z: 25 },
        near: 2,
        far: 800,
      },
      { updateControls: false },
    );

    expect(controls.update).not.toHaveBeenCalled();
    expect(vec(camera.position)).toEqual([200, 300, 400]);
    expect(vec(controls.target)).toEqual([100, 50, 25]);
    expect(camera.near).toBe(2);
    expect(camera.far).toBe(800);

    restoreCameraState(camera, controls, before);

    expect(vec(camera.position)).toEqual([10, 20, 30]);
    expect(vec(controls.target)).toEqual([1, 2, 3]);
    expect(camera.aspect).toBeCloseTo(4 / 3, 10);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(15000);
    expect(camera.zoom).toBe(1.2);
    expect(controls.update).toHaveBeenCalledTimes(1);
  });

  it('aims the camera at the framing target when controls update is skipped', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const target = { x: -10, y: 5, z: 20 };

    applyFramingToCamera(
      camera,
      controls,
      { position: { x: 0, y: 0, z: 0 }, target },
      { updateControls: false },
    );

    const direction = camera.getWorldDirection(new THREE.Vector3());
    const expected = new THREE.Vector3(
      target.x - 0,
      target.y - 0,
      target.z - 0,
    ).normalize();
    expect(direction.dot(expected)).toBeGreaterThan(0.9999);
  });

  it('keeps the existing projection when a framing has no valid planes', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const near = camera.near;
    const far = camera.far;

    applyFramingToCamera(camera, controls, {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 0, z: 0 },
    });

    expect(camera.near).toBe(near);
    expect(camera.far).toBe(far);
    expect(controls.update).toHaveBeenCalledTimes(1);
  });
});

describe('withRestoredCameraState', () => {
  it('restores the camera after a successful capture task', async () => {
    const camera = makeCamera();
    const controls = makeControls();
    const before = captureCameraState(camera, controls);
    const initialProjection = camera.projectionMatrix.clone();

    const result = await withRestoredCameraState(camera, controls, () => {
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      applyFramingToCamera(
        camera,
        controls,
        {
          position: { x: 400, y: 300, z: 200 },
          target: { x: 9, y: 8, z: 7 },
          near: 0.1,
          far: 500,
        },
        { updateControls: false },
      );
      camera.up.set(0, 0, 1);
      return 42;
    });

    expect(result).toBe(42);
    expect(captureCameraState(camera, controls)).toEqual(before);
    expect(camera.projectionMatrix.elements).toEqual(initialProjection.elements);
  });

  it('restores the camera when the capture task throws', async () => {
    const camera = makeCamera();
    const controls = makeControls();
    const before = captureCameraState(camera, controls);
    const initialProjection = camera.projectionMatrix.clone();

    await expect(
      withRestoredCameraState(camera, controls, () => {
        camera.aspect = 2;
        camera.updateProjectionMatrix();
        applyFramingToCamera(
          camera,
          controls,
          {
            position: { x: -1, y: -2, z: -3 },
            target: { x: 100, y: 0, z: 0 },
            near: 0.2,
            far: 1000,
          },
          { updateControls: false },
        );
        camera.up.set(1, 0, 0);
        throw new Error('readback failed');
      }),
    ).rejects.toThrow('readback failed');

    expect(captureCameraState(camera, controls)).toEqual(before);
    expect(camera.projectionMatrix.elements).toEqual(initialProjection.elements);
    expect(controls.update).toHaveBeenCalledTimes(1);
  });
});
