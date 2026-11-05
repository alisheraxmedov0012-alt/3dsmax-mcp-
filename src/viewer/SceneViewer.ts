import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildRoom } from '../geometry/buildRoom';
import {
  applyObjectTransform,
  buildSceneObject,
  sceneObjectGeometryKey,
} from '../scene/buildSceneObject';
import { ROOM_OBJECT_ID, type SceneData, type SceneObject } from '../scene/types';
import type { CameraPreset, SceneSettings } from '../scene/sceneSettings';
import { applyTextureMapToGroup } from '../materials/applyTextureMaps';
import { resolvePresetSettings } from '../materials/presets';
import { ObjectTextureMapLoader } from '../materials/textureMapLoader';
import { updateObjectMaterials } from '../materials/updateMaterial';
import {
  clearTextureResolutionStatus,
  setTextureResolutionStatus,
} from '../materials/textureStatus';
import { computePresetFraming, computeRoomFraming } from './cameraFraming';
import {
  DEFAULT_CAMERA_FAR,
  DEFAULT_CAMERA_NEAR,
  DEFAULT_ORBIT_MAX_DISTANCE,
  DEFAULT_ORBIT_MIN_DISTANCE,
  FRAMING_FOV_DEG,
  captureAspect,
  computeCameraPlanes,
  computeObjectFraming,
  computeObjectFramingForDirection,
  computeOrbitDistanceLimits,
  isValidBounds,
  type BoundsBox,
  type OrbitDistanceLimits,
} from '../render/framing';
import { applyFramingToCamera, withRestoredCameraState } from './cameraState';
import { applyOrbitSettings } from './orbitSettings';
import { EnvironmentManager } from './environmentManager';
import { computeCameraAngleFraming, type CameraAngleId } from './cameraAngles';
import { buildShadowKey, shadowKeyChanged } from './shadowInvalidation';
import { computeLightRig } from './lightRig';
import { computeShadowFit } from './shadowFit';
import { createShadowCatcher, type ShadowCatcher } from './shadowCatcher';
import { PRODUCT_PREVIEW_VIEWS, type ProductPreviewId } from './productPreviewViews';
import { capturePreviewViews } from './previewCapture';
import { captureRendererState, restoreRendererState } from './rendererState';
import { readCapturePixels } from './captureReadback';
import { validateCaptureSize } from '../export/sceneImage';
import {
  LIGHTING_PRESET_POSITIONS,
  isLightingPresetId,
  isQualityPresetId,
  resolveRendererConfig,
  type LightingPresetPositions,
  type QualityPresetId,
  type ShadowMapKind,
  type ToneMappingMode,
} from '../render/renderPresets';

const TONE_MAPPING: Record<ToneMappingMode, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
};

const SHADOW_MAP_KIND: Record<ShadowMapKind, THREE.ShadowMapType> = {
  pcf: THREE.PCFShadowMap,
  vsm: THREE.VSMShadowMap,
};

export interface SceneViewerOptions {
  onSelect?: (id: string | null) => void;
}

export interface CapturePngOptions {
  /**
   * Re-frame the selected object (or the room) for this preset at the capture
   * size before rendering.
   */
  cameraPreset?: CameraPreset;
  /**
   * When no preset is supplied, fit the selected object for the output aspect
   * while keeping the current orbit direction. Defaults to true; pass false to
   * capture the exact current composition.
   */
  reframeSelection?: boolean;
  /** Runtime product angle; takes precedence over cameraPreset for framing. */
  cameraAngle?: CameraAngleId;
  /** Optional selected part bounds for a close-up detail shot. */
  detailBounds?: BoundsBox | null;
  /** Include the room/floor in the capture. Defaults to true. */
  includeRoom?: boolean;
  /** Hide the editor selection BoxHelper. Defaults to true. */
  hideSelection?: boolean;
  /** Override the scene background; null hides it. */
  background?: string | null;
  /** Capture-only shadow/window quality override. */
  qualityPreset?: QualityPresetId;
}

export interface CaptureProductPreviewsOptions {
  /** Optional selected part bounds for the detail shot. */
  detailBounds?: BoundsBox | null;
}

interface ObjectEntry {
  group: THREE.Group;
  dispose: () => void;
  geometryKey: string;
  mapLoader: ObjectTextureMapLoader;
}

const CLICK_MOVE_THRESHOLD_PX = 6;

/**
 * Viewer layer for the scene (Stage 5–6): owns the WebGL renderer, scene,
 * camera, lights, camera controls, selection highlighting, pointer picking and
 * PNG capture. It only renders geometry produced by the geometry/scene builders
 * and never mutates the scene data model.
 *
 * Updates are incremental: only the room or the affected object is rebuilt.
 */
export class SceneViewer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly onSelect?: (id: string | null) => void;

  private readonly background = new THREE.Color('#1b1f24');
  private readonly environment: EnvironmentManager;
  private readonly shadowCatcher: ShadowCatcher;
  private readonly ambient: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;

  private room: { group: THREE.Group; dispose: () => void; key: string } | null = null;
  private readonly objects = new Map<string, ObjectEntry>();
  private selectionHelper: THREE.BoxHelper | null = null;

  private data: SceneData | null = null;
  private selectedId: string | null = null;
  private frameId: number | null = null;
  private hasFramedOnce = false;
  private shadowsEnabled = true;
  private shadowKey: string | null = null;
  private renderPaused = false;
  private captureDepth = 0;
  private outputPass: OutputPass | null = null;

  private pointerDown: { x: number; y: number } | null = null;
  private readonly handlePointerDown: (event: PointerEvent) => void;
  private readonly handlePointerUp: (event: PointerEvent) => void;

  constructor(container: HTMLElement, options: SceneViewerOptions = {}) {
    this.container = container;
    this.onSelect = options.onSelect;

    this.scene = new THREE.Scene();
    this.scene.background = this.background;

    this.camera = new THREE.PerspectiveCamera(
      FRAMING_FOV_DEG,
      1,
      DEFAULT_CAMERA_NEAR,
      DEFAULT_CAMERA_FAR,
    );
    this.camera.position.set(600, 500, 700);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // PCF is the supported r186 filter with a controllable softness radius.
    // PCFSoftShadowMap was removed from Three r186.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The scene is static between edits; update the shadow map only when the
    // shadow-relevant state changes (see updateShadowInvalidation).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.setAttribute('data-testid', 'viewer-canvas');
    // Prevent the browser's own touch gestures (scroll, pinch-page-zoom) so the
    // viewer receives them on Android and other touch devices.
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.environment = new EnvironmentManager(this.renderer, this.scene);
    this.shadowCatcher = createShadowCatcher();
    this.scene.add(this.shadowCatcher.object);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    applyOrbitSettings(this.controls);
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this.ambient = new THREE.HemisphereLight(0xffffff, 0x30363d, 1.0);
    this.scene.add(this.ambient);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    this.keyLight.position.set(400, 700, 500);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 10;
    this.keyLight.shadow.camera.far = 4000;
    this.keyLight.shadow.camera.left = -1500;
    this.keyLight.shadow.camera.right = 1500;
    this.keyLight.shadow.camera.top = 1500;
    this.keyLight.shadow.camera.bottom = -1500;
    this.scene.add(this.keyLight);
    // The target must be in the scene graph so its matrixWorld follows the
    // fitted shadow centre instead of staying at the origin.
    this.scene.add(this.keyLight.target);

    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.fillLight.position.set(-500, 400, -400);
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);

    this.rimLight = new THREE.DirectionalLight(0xffffff, 0);
    this.rimLight.position.set(-450, 420, -650);
    this.rimLight.castShadow = false;
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    this.handlePointerDown = (event) => this.onPointerDown(event);
    this.handlePointerUp = (event) => this.onPointerUp(event);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.start();
  }

  /** Applies scene data incrementally, rebuilding only what changed. */
  setScene(data: SceneData, selectedId: string | null): void {
    this.data = data;
    this.selectedId = selectedId;

    this.applySettings(data.settings);

    const roomKey = [
      data.room.widthCm,
      data.room.lengthCm,
      data.room.heightCm,
      data.room.showCeiling === true,
      data.settings.roomMaterials.floorColor,
      data.settings.roomMaterials.wallColor,
      data.settings.roomMaterials.ceilingColor,
      // Openings only affect markers; fold them into the key so toggling them
      // rebuilds the room without a separate code path.
      JSON.stringify(data.room.openings ?? []),
    ].join(':');

    if (!this.room || this.room.key !== roomKey) {
      if (this.room) {
        this.scene.remove(this.room.group);
        this.room.dispose();
      }
      const built = buildRoom(data.room, data.settings.roomMaterials);
      built.group.userData.sceneObjectId = ROOM_OBJECT_ID;
      this.scene.add(built.group);
      this.room = { group: built.group, dispose: built.dispose, key: roomKey };
    }

    const nextIds = new Set(data.objects.map((object) => object.id));

    for (const [id, entry] of this.objects) {
      if (!nextIds.has(id)) {
        this.disposeObjectEntry(entry);
        this.objects.delete(id);
        clearTextureResolutionStatus(id);
      }
    }

    for (const object of data.objects) {
      const geometryKey = sceneObjectGeometryKey(object);
      const existing = this.objects.get(object.id);

      if (!existing) {
        this.objects.set(object.id, this.createObjectEntry(object, geometryKey));
      } else if (existing.geometryKey !== geometryKey) {
        this.disposeObjectEntry(existing);
        this.objects.set(object.id, this.createObjectEntry(object, geometryKey));
      } else {
        applyObjectTransform(existing.group, object);
        this.refreshObjectMaterials(object, existing);
      }
    }

    if (!this.hasFramedOnce) {
      this.resetView();
      this.hasFramedOnce = true;
    }

    this.updateSelectionHelper();
    this.refreshCameraLimits();
    this.updateLightRig();
    this.updateShadowFrustum();
    this.refreshShadowCatcher();
    this.updateShadowInvalidation();
    this.controls.update();
  }

  private createObjectEntry(object: SceneObject, geometryKey: string): ObjectEntry {
    const built = buildSceneObject(object);
    this.scene.add(built.group);
    const loader = new ObjectTextureMapLoader({
      apply: (role, texture, options) =>
        applyTextureMapToGroup(built.group, role, texture, options),
      onStatus: (status) => {
        if (status === null) {
          clearTextureResolutionStatus(object.id);
        } else {
          setTextureResolutionStatus(object.id, status);
        }
      },
    });
    const entry: ObjectEntry = {
      group: built.group,
      dispose: built.dispose,
      geometryKey,
      mapLoader: loader,
    };
    this.refreshObjectMaterials(object, entry);
    return entry;
  }

  /**
   * Project the current material model onto the already-built materials. The
   * group is never replaced here, so geometry identity and GPU buffers survive a
   * slider drag; the map loader only swaps textures whose references changed.
   */
  private refreshObjectMaterials(object: SceneObject, entry: ObjectEntry): void {
    updateObjectMaterials(entry.group, object);
    const settings = resolvePresetSettings(object.material);
    entry.mapLoader.sync(object.material.maps, settings.textureScale, {
      normalStrength: settings.normalStrength,
      emissiveIntensity: settings.emissiveIntensity,
      emissiveColor: object.material.emissiveColor,
      aoIntensity: settings.aoIntensity,
    });
  }

  private disposeObjectEntry(entry: ObjectEntry): void {
    entry.mapLoader.dispose();
    this.scene.remove(entry.group);
    entry.dispose();
  }

  /** Applies background, lighting, render quality, tone mapping and shadows. */
  private applySettings(settings: SceneSettings): void {
    this.background.set(settings.background);

    this.ambient.intensity = settings.lights.ambientIntensity;
    this.ambient.color.set(settings.lights.ambientColor);

    this.keyLight.visible = settings.lights.keyEnabled;
    this.keyLight.intensity = settings.lights.keyIntensity;
    this.keyLight.color.set(settings.lights.keyColor);
    this.keyLight.castShadow = settings.lights.shadowsEnabled && settings.lights.keyEnabled;

    this.fillLight.visible = settings.lights.fillEnabled;
    this.fillLight.intensity = settings.lights.fillIntensity;
    this.fillLight.color.set(settings.lights.fillColor);

    this.rimLight.visible = settings.lights.rimEnabled;
    this.rimLight.intensity = settings.lights.rimIntensity;
    this.rimLight.color.set(settings.lights.rimColor);

    const shadow = this.keyLight.shadow;
    shadow.bias = settings.lights.shadowBias;
    shadow.normalBias = settings.lights.shadowNormalBias;
    shadow.radius = settings.lights.shadowRadius;
    shadow.intensity = settings.lights.shadowIntensity;

    // Named presets replace the directions. Custom mode leaves the current rig
    // positions untouched so repeated scene updates do not drift the lights.
    if (isLightingPresetId(settings.lightingPreset)) {
      const positions = LIGHTING_PRESET_POSITIONS[settings.lightingPreset];
      this.keyLight.position.set(positions.key[0], positions.key[1], positions.key[2]);
      this.fillLight.position.set(positions.fill[0], positions.fill[1], positions.fill[2]);
      this.rimLight.position.set(positions.rim[0], positions.rim[1], positions.rim[2]);
    }

    this.environment.apply({
      enabled: settings.environmentEnabled,
      intensity: settings.environmentIntensity,
    });

    if (this.shadowsEnabled !== settings.lights.shadowsEnabled) {
      this.shadowsEnabled = settings.lights.shadowsEnabled;
      this.renderer.shadowMap.enabled = settings.lights.shadowsEnabled;
      // Toggling shadows requires materials to recompile.
      this.renderer.shadowMap.needsUpdate = true;
      this.scene.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        if (Array.isArray(material)) {
          material.forEach((entry) => (entry.needsUpdate = true));
        } else if (material) {
          material.needsUpdate = true;
        }
      });
    }

    this.applyRenderSettings(settings);
  }

  /**
   * Applies the render-quality preset and the tone-mapping/exposure settings to
   * the WebGL renderer. These are real renderer parameters (pixel ratio, shadow
   * map filter/size, tone mapping, exposure); nothing here is cosmetic.
   */
  private applyRenderSettings(settings: SceneSettings): void {
    const devicePixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1;
    const config = resolveRendererConfig(settings.qualityPreset, { devicePixelRatio });

    this.renderer.setPixelRatio(config.pixelRatio);

    if (this.renderer.shadowMap.type !== SHADOW_MAP_KIND[config.shadowMapKind]) {
      this.renderer.shadowMap.type = SHADOW_MAP_KIND[config.shadowMapKind];
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.keyLight.shadow.mapSize.x !== config.shadowMapSize) {
      this.keyLight.shadow.mapSize.set(config.shadowMapSize, config.shadowMapSize);
      // Force the shadow map to be recreated at the new size.
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
      this.renderer.shadowMap.needsUpdate = true;
    }

    this.renderer.toneMapping = TONE_MAPPING[settings.toneMapping];
    this.renderer.toneMappingExposure = settings.exposure;
  }

  /**
   * Apply a capture-only shadow quality override. Returns a restore callback,
   * or null when the request is absent/identical. The interactive quality state
   * is not changed.
   */
  private applyCaptureQuality(
    qualityPreset: QualityPresetId | undefined,
  ): (() => void) | null {
    if (!qualityPreset || !isQualityPresetId(qualityPreset)) {
      return null;
    }
    const config = resolveRendererConfig(qualityPreset, { devicePixelRatio: 1 });
    const nextType = SHADOW_MAP_KIND[config.shadowMapKind];
    const prevType = this.renderer.shadowMap.type;
    const prevSize = this.keyLight.shadow.mapSize.x;
    let changed = false;

    if (prevType !== nextType) {
      this.renderer.shadowMap.type = nextType;
      changed = true;
    }
    if (prevSize !== config.shadowMapSize) {
      this.keyLight.shadow.mapSize.set(config.shadowMapSize, config.shadowMapSize);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
      changed = true;
    }
    if (!changed) {
      return null;
    }
    this.renderer.shadowMap.needsUpdate = true;

    return () => {
      if (this.renderer.shadowMap.type !== prevType) {
        this.renderer.shadowMap.type = prevType;
      }
      if (this.keyLight.shadow.mapSize.x !== prevSize) {
        this.keyLight.shadow.mapSize.set(prevSize, prevSize);
        this.keyLight.shadow.map?.dispose();
        this.keyLight.shadow.map = null;
      }
      this.renderer.shadowMap.needsUpdate = true;
    };
  }

  /**
   * Bounding box (world space) of the currently selected object, or null when
   * the room / nothing is selected or the box is empty/invalid. Used so camera
   * presets frame the selected furniture piece, not just the room.
   */
  private selectedObjectBounds(): BoundsBox | null {
    if (!this.selectedId || this.selectedId === ROOM_OBJECT_ID) {
      return null;
    }
    const entry = this.objects.get(this.selectedId);
    if (!entry) {
      return null;
    }
    const box = new THREE.Box3().setFromObject(entry.group);
    if (box.isEmpty()) {
      return null;
    }
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    };
  }

  /** Preset directions, or the current viewer positions in custom mode. */
  private lightingPositions(): LightingPresetPositions {
    const preset = this.data?.settings.lightingPreset;
    if (preset && isLightingPresetId(preset)) {
      return LIGHTING_PRESET_POSITIONS[preset];
    }
    return {
      key: [
        this.keyLight.position.x - this.keyLight.target.position.x,
        this.keyLight.position.y - this.keyLight.target.position.y,
        this.keyLight.position.z - this.keyLight.target.position.z,
      ],
      fill: [
        this.fillLight.position.x - this.fillLight.target.position.x,
        this.fillLight.position.y - this.fillLight.target.position.y,
        this.fillLight.position.z - this.fillLight.target.position.z,
      ],
      rim: [
        this.rimLight.position.x - this.rimLight.target.position.x,
        this.rimLight.position.y - this.rimLight.target.position.y,
        this.rimLight.position.z - this.rimLight.target.position.z,
      ],
    };
  }

  /** Move all three lights around the active product/room bounds. */
  private updateLightRig(): void {
    if (!this.data) {
      return;
    }
    const rig = computeLightRig(
      this.selectedObjectBounds() ?? this.roomBounds(),
      this.lightingPositions(),
    );
    this.keyLight.position.set(rig.key.x, rig.key.y, rig.key.z);
    this.fillLight.position.set(rig.fill.x, rig.fill.y, rig.fill.z);
    this.rimLight.position.set(rig.rim.x, rig.rim.y, rig.rim.z);
    this.keyLight.target.position.set(rig.target.x, rig.target.y, rig.target.z);
    this.fillLight.target.position.set(rig.target.x, rig.target.y, rig.target.z);
    this.rimLight.target.position.set(rig.target.x, rig.target.y, rig.target.z);
    this.keyLight.target.updateMatrixWorld();
    this.fillLight.target.updateMatrixWorld();
    this.rimLight.target.updateMatrixWorld();
  }

  /** World-space bounds of the room, used when no furniture is selected. */
  private roomBounds(): BoundsBox | null {
    if (!this.room) {
      return null;
    }
    const box = new THREE.Box3().setFromObject(this.room.group);
    if (box.isEmpty()) {
      return null;
    }
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    };
  }

  /** Fit the directional light's orthographic shadow camera to the active bounds. */
  private updateShadowFrustum(): void {
    if (!this.data) {
      return;
    }
    const keyPosition = this.lightingPositions().key;
    const direction = {
      x: keyPosition[0],
      y: keyPosition[1],
      z: keyPosition[2],
    };
    const fit = computeShadowFit(
      this.selectedObjectBounds() ?? this.roomBounds(),
      direction,
      { preferredDistance: Math.hypot(direction.x, direction.y, direction.z) },
    );

    this.keyLight.position.set(fit.position.x, fit.position.y, fit.position.z);
    this.keyLight.target.position.set(fit.target.x, fit.target.y, fit.target.z);
    this.keyLight.target.updateMatrixWorld();

    const shadowCamera = this.keyLight.shadow.camera;
    shadowCamera.left = -fit.extent;
    shadowCamera.right = fit.extent;
    shadowCamera.top = fit.extent;
    shadowCamera.bottom = -fit.extent;
    shadowCamera.near = fit.near;
    shadowCamera.far = fit.far;
    shadowCamera.updateProjectionMatrix();
  }

  /** The catcher is only needed when the room floor is hidden (product shots). */
  private refreshShadowCatcher(): void {
    const roomHidden = this.room !== null && this.room.group.visible === false;
    this.shadowCatcher.update(this.selectedObjectBounds(), roomHidden);
  }

  /**
   * Shadow maps are not re-rendered every frame. This key changes only when
   * geometry, transforms, visibility, lights, shadow settings or shadow map
   * resolution change; camera orbiting does not invalidate a shadow.
   */
  private updateShadowInvalidation(): void {
    if (!this.data) {
      return;
    }
    const key = buildShadowKey(
      this.data,
      this.room?.key ?? null,
      this.selectedId,
      this.keyLight.shadow.mapSize.x,
    );
    if (shadowKeyChanged(this.shadowKey, key)) {
      this.shadowKey = key;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  /**
   * Apply distance limits. With `preserveCurrent`, the live zoom distance is
   * always kept inside the interval so selecting a different object cannot
   * make OrbitControls jump the camera.
   */
  private setOrbitDistanceLimits(
    limits: OrbitDistanceLimits,
    preserveCurrent = false,
  ): void {
    let { minDistance, maxDistance } = limits;
    if (preserveCurrent) {
      const current = this.camera.position.distanceTo(this.controls.target);
      if (Number.isFinite(current) && current > 0) {
        minDistance = Math.min(minDistance, current);
        maxDistance = Math.max(maxDistance, current);
      }
    }
    this.controls.minDistance = minDistance;
    this.controls.maxDistance = maxDistance;
  }

  /**
   * Keeps clipping planes and OrbitControls limits compatible with the selected
   * piece without moving the camera. Small pieces previously hit the fixed 40 cm
   * minimum; large pieces could exceed the 6000 cm maximum; and a size change
   * could leave near/far planes tuned for the old selection.
   */
  private refreshCameraLimits(): void {
    const bounds = this.selectedObjectBounds();
    if (bounds && isValidBounds(bounds)) {
      const framing = computeObjectFraming(
        bounds,
        this.data?.settings.cameraPreset ?? 'product',
        this.camera.aspect,
      );
      const currentDistance = this.camera.position.distanceTo(this.controls.target);
      const planes = computeCameraPlanes(currentDistance, framing.radius);
      if (this.camera.near !== planes.near || this.camera.far !== planes.far) {
        this.camera.near = planes.near;
        this.camera.far = planes.far;
        this.camera.updateProjectionMatrix();
      }
      this.setOrbitDistanceLimits(
        computeOrbitDistanceLimits(framing.distance, framing.radius),
        true,
      );
      return;
    }

    if (
      this.camera.near !== DEFAULT_CAMERA_NEAR ||
      this.camera.far !== DEFAULT_CAMERA_FAR
    ) {
      this.camera.near = DEFAULT_CAMERA_NEAR;
      this.camera.far = DEFAULT_CAMERA_FAR;
      this.camera.updateProjectionMatrix();
    }
    this.setOrbitDistanceLimits(
      {
        minDistance: DEFAULT_ORBIT_MIN_DISTANCE,
        maxDistance: DEFAULT_ORBIT_MAX_DISTANCE,
      },
      true,
    );
  }

  /**
   * Moves the camera to frame the selection (or the room) for a preset.
   *
   * `aspect` is explicit so a capture can frame for the requested output size
   * instead of inheriting the on-screen viewport aspect. `updateControls:false`
   * lets a capture render before OrbitControls applies its distance clamps.
   */
  private frameTo(
    preset: CameraPreset,
    aspect: number = this.camera.aspect,
    options: { updateControls?: boolean } = {},
  ): void {
    if (!this.data) {
      return;
    }
    const bounds = this.selectedObjectBounds();
    if (bounds && isValidBounds(bounds)) {
      const framing = computeObjectFraming(bounds, preset, aspect);
      this.setOrbitDistanceLimits(
        computeOrbitDistanceLimits(framing.distance, framing.radius),
      );
      applyFramingToCamera(this.camera, this.controls, framing, {
        updateControls: options.updateControls,
      });
      return;
    }

    const framing = {
      ...computePresetFraming(this.data.room, preset),
      near: DEFAULT_CAMERA_NEAR,
      far: DEFAULT_CAMERA_FAR,
    };
    this.setOrbitDistanceLimits({
      minDistance: DEFAULT_ORBIT_MIN_DISTANCE,
      maxDistance: DEFAULT_ORBIT_MAX_DISTANCE,
    });
    applyFramingToCamera(this.camera, this.controls, framing, {
      updateControls: options.updateControls,
    });
  }

  /** Restores the default framing (the selection when present, else the room). */
  resetView(): void {
    if (!this.data) {
      return;
    }
    const bounds = this.selectedObjectBounds();
    if (bounds && isValidBounds(bounds)) {
      this.frameTo('product');
      return;
    }
    const framing = {
      ...computeRoomFraming(this.data.room),
      near: DEFAULT_CAMERA_NEAR,
      far: DEFAULT_CAMERA_FAR,
    };
    this.setOrbitDistanceLimits({
      minDistance: DEFAULT_ORBIT_MIN_DISTANCE,
      maxDistance: DEFAULT_ORBIT_MAX_DISTANCE,
    });
    applyFramingToCamera(this.camera, this.controls, framing);
  }

  /** Moves the camera to a named preset. Object coordinates are never changed. */
  applyCameraPreset(preset: CameraPreset): void {
    this.frameTo(preset);
  }

  /** Moves the camera to a runtime product angle (not persisted in schema v3). */
  applyCameraAngle(angle: CameraAngleId, detailBounds?: BoundsBox | null): void {
    if (!this.data) {
      return;
    }
    const bounds = this.selectedObjectBounds() ?? this.roomBounds();
    const framing = computeCameraAngleFraming(
      bounds,
      angle,
      this.camera.aspect,
      detailBounds,
    );
    this.setOrbitDistanceLimits(
      computeOrbitDistanceLimits(framing.distance, framing.radius),
    );
    applyFramingToCamera(this.camera, this.controls, framing);
  }

  /**
   * Renders the scene at the requested pixel size and returns a PNG Blob.
   *
   * Works like the existing offscreen capture (no global
   * `preserveDrawingBuffer`), but snapshots and restores the complete camera and
   * orbit state around the render. When `options.cameraPreset` is supplied the
   * framing is computed from the *output* aspect ratio, not the viewport aspect.
   * The viewer is restored before the asynchronous PNG encode, so encoding a
   * large still cannot leave the on-screen composition changed.
   */
  async capturePng(
    width: number,
    height: number,
    options: CapturePngOptions = {},
  ): Promise<Blob> {
    const size = validateCaptureSize(
      width,
      height,
      this.renderer.capabilities.maxTextureSize,
    );
    const captureWidth = size.width;
    const captureHeight = size.height;
    const aspect = captureAspect(captureWidth, captureHeight);
    const requestedQuality =
      options.qualityPreset && isQualityPresetId(options.qualityPreset)
        ? options.qualityPreset
        : this.data?.settings.qualityPreset ?? 'standard';
    const captureConfig = resolveRendererConfig(requestedQuality, {
      devicePixelRatio: 1,
    });
    // HDR half-float targets are expensive at 4K; keep MSAA for ordinary
    // product/catalog sizes and rely on the output resolution at 4K.
    const samples =
      captureConfig.antialias && captureWidth * captureHeight <= 3_700_000
        ? 4
        : 0;

    this.beginCapture();
    const rendererState = captureRendererState(this.renderer);
    const prevRoomVisible = this.room?.group.visible ?? null;
    const prevSelectionVisible = this.selectionHelper?.visible ?? null;
    const prevBackground = this.scene.background;
    const temporaryTargets: THREE.WebGLRenderTarget[] = [];
    let restoreQuality: (() => void) | null = null;
    let pixels: Uint8Array | null = null;

    try {
      if (options.includeRoom === false && this.room) {
        this.room.group.visible = false;
      }
      if (options.hideSelection !== false && this.selectionHelper) {
        this.selectionHelper.visible = false;
      }
      if (options.background !== undefined) {
        this.scene.background =
          options.background === null ? null : new THREE.Color(options.background);
      }
      this.refreshShadowCatcher();
      restoreQuality = this.applyCaptureQuality(options.qualityPreset);

      pixels = await withRestoredCameraState(this.camera, this.controls, async () => {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
        if (options.cameraAngle) {
          const bounds = this.selectedObjectBounds() ?? this.roomBounds();
          const framing = computeCameraAngleFraming(
            bounds,
            options.cameraAngle,
            aspect,
            options.detailBounds,
          );
          this.setOrbitDistanceLimits(
            computeOrbitDistanceLimits(framing.distance, framing.radius),
          );
          applyFramingToCamera(this.camera, this.controls, framing, {
            updateControls: false,
          });
        } else if (options.cameraPreset) {
          // Do not let OrbitControls clamp the capture camera before the render;
          // the transaction restores the previous limits afterwards.
          this.frameTo(options.cameraPreset, aspect, { updateControls: false });
        } else if (options.reframeSelection !== false) {
          const bounds = this.selectedObjectBounds();
          if (bounds && isValidBounds(bounds)) {
            const direction = {
              x: this.camera.position.x - this.controls.target.x,
              y: this.camera.position.y - this.controls.target.y,
              z: this.camera.position.z - this.controls.target.z,
            };
            const framing = computeObjectFramingForDirection(bounds, direction, aspect);
            this.setOrbitDistanceLimits(
              computeOrbitDistanceLimits(framing.distance, framing.radius),
            );
            applyFramingToCamera(this.camera, this.controls, framing, {
              updateControls: false,
            });
          }
        }

        // Render the scene linearly into HDR. Three deliberately skips tone
        // mapping for non-XR render targets, so the OutputPass below applies the
        // same tone mapping/exposure/color-space path as the visible canvas.
        // Half-float is preferred; an LDR fallback keeps capture usable on
        // devices without a renderable float/half-float format.
        const supportsHalfFloat =
          this.renderer.extensions.has('EXT_color_buffer_float') ||
          this.renderer.extensions.has('EXT_color_buffer_half_float');
        const hdrTarget = new THREE.WebGLRenderTarget(captureWidth, captureHeight, {
          depthBuffer: true,
          stencilBuffer: false,
          samples,
          type: supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        });
        hdrTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
        temporaryTargets.push(hdrTarget);

        const outputTarget = new THREE.WebGLRenderTarget(captureWidth, captureHeight, {
          depthBuffer: false,
          stencilBuffer: false,
          samples: 0,
          type: THREE.UnsignedByteType,
        });
        // OutputPass writes already-encoded sRGB bytes; do not let the target
        // perform a second sRGB conversion.
        outputTarget.texture.colorSpace = THREE.NoColorSpace;
        temporaryTargets.push(outputTarget);

        this.renderer.setRenderTarget(hdrTarget);
        this.renderer.render(this.scene, this.camera);
        this.getOutputPass().render(this.renderer, outputTarget, hdrTarget, 0, false);

        const buffer = new Uint8Array(captureWidth * captureHeight * 4);
        await readCapturePixels(
          this.renderer,
          outputTarget,
          captureWidth,
          captureHeight,
          buffer,
        );
        return buffer;
      });
    } finally {
      restoreQuality?.();
      if (this.room && prevRoomVisible !== null) {
        this.room.group.visible = prevRoomVisible;
      }
      if (this.selectionHelper && prevSelectionVisible !== null) {
        this.selectionHelper.visible = prevSelectionVisible;
      }
      this.scene.background = prevBackground;
      restoreRendererState(this.renderer, rendererState);
      for (const target of temporaryTargets) {
        target.dispose();
      }
      this.refreshShadowCatcher();
      this.endCapture();
      // Redraw the visible frame with the restored composition immediately,
      // before the PNG encoder runs asynchronously.
      this.renderer.render(this.scene, this.camera);
    }

    if (!pixels) {
      throw new Error("Render natijasini o'qib bo'lmadi.");
    }

    const canvas = document.createElement('canvas');
    canvas.width = captureWidth;
    canvas.height = captureHeight;
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!context) {
      throw new Error('2D kontekst mavjud emas.');
    }

    const imageData = context.createImageData(captureWidth, captureHeight);
    // WebGL reads bottom-up; flip vertically into the 2D canvas.
    for (let y = 0; y < captureHeight; y += 1) {
      const src = (captureHeight - 1 - y) * captureWidth * 4;
      imageData.data.set(
        pixels.subarray(src, src + captureWidth * 4),
        y * captureWidth * 4,
      );
    }
    context.putImageData(imageData, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("PNG yaratib bo'lmadi."))),
        'image/png',
      );
    });
  }

  /**
   * Capture one PNG per product preview shot.
   *
   * Each shot re-frames the camera with an existing preset and renders offscreen
   * via {@link capturePng}.
   *
   * The room and the selection outline are hidden for the duration. Two reasons,
   * and the first is a bug this fixed: the `side` framing puts the camera outside
   * the room's wall, so the wall completely occluded the product and the shot came
   * out as a flat picture of a wall. More generally, a listing image should show
   * the piece, not the customer's room or an editor selection box — this matches
   * what the C1 package does with `includeRoom: false`.
   *
   * The camera, orbit target, room visibility and selection visibility are all
   * restored in a `finally`, so exporting a package never disturbs what the reader
   * is looking at, however far the loop got.
   *
   * Returns the bytes per view; the caller decides whether to put them in a ZIP.
   * An empty blob is reported as a failure rather than passed off as a preview.
   */
  async captureProductPreviews(
    width: number,
    height: number,
    options: CaptureProductPreviewsOptions = {},
  ): Promise<Array<{ id: ProductPreviewId; filename: string; bytes: Uint8Array }>> {
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startAspect = this.camera.aspect;
    const startRoomVisible = this.room?.group.visible ?? null;
    const startSelectionVisible = this.selectionHelper?.visible ?? null;
    const results: Array<{ id: ProductPreviewId; filename: string; bytes: Uint8Array }> = [];

    try {
      if (this.room) {
        this.room.group.visible = false;
      }
      if (this.selectionHelper) {
        this.selectionHelper.visible = false;
      }
      this.refreshShadowCatcher();
      const captured = await capturePreviewViews(PRODUCT_PREVIEW_VIEWS, async (view) => {
        const blob = await this.capturePng(width, height, {
          cameraAngle: view.cameraAngle,
          detailBounds: options.detailBounds,
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length === 0) {
          throw new Error(`"${view.filename}" uchun rasm bo'sh chiqdi.`);
        }
        return bytes;
      });
      for (const { view, value } of captured) {
        results.push({ id: view.id, filename: view.filename, bytes: value });
      }
      return results;
    } finally {
      if (this.room && startRoomVisible !== null) {
        this.room.group.visible = startRoomVisible;
      }
      if (this.selectionHelper && startSelectionVisible !== null) {
        this.selectionHelper.visible = startSelectionVisible;
      }
      this.refreshShadowCatcher();
      this.camera.position.copy(startPosition);
      this.controls.target.copy(startTarget);
      this.camera.aspect = startAspect;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateSelectionHelper(): void {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      (this.selectionHelper.material as THREE.Material).dispose();
      this.selectionHelper = null;
    }

    if (!this.selectedId || !this.data) {
      return;
    }

    let target: THREE.Object3D | null = null;
    if (this.selectedId === ROOM_OBJECT_ID) {
      target = this.room?.group ?? null;
    } else {
      const entry = this.objects.get(this.selectedId);
      const object = this.data.objects.find((item) => item.id === this.selectedId);
      if (entry && object?.visible) {
        target = entry.group;
      }
    }

    if (!target) {
      return;
    }

    this.selectionHelper = new THREE.BoxHelper(target, 0x4f9dff);
    this.selectionHelper.name = 'selection-helper';
    this.scene.add(this.selectionHelper);
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  }

  private onPointerUp(event: PointerEvent): void {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || !this.onSelect) {
      return;
    }

    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > CLICK_MOVE_THRESHOLD_PX) {
      // Treated as an orbit/pan drag, not a selection click.
      return;
    }

    this.onSelect(this.pick(event.clientX, event.clientY));
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const roots: THREE.Object3D[] = [];
    if (this.room) roots.push(this.room.group);
    for (const entry of this.objects.values()) roots.push(entry.group);

    const hits = this.raycaster.intersectObjects(roots, true);
    if (hits.length === 0) {
      return null;
    }

    let node: THREE.Object3D | null = hits[0].object;
    while (node) {
      if (typeof node.userData.sceneObjectId === 'string') {
        return node.userData.sceneObjectId;
      }
      node = node.parent;
    }
    return null;
  }

  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private start(): void {
    const loop = () => {
      this.frameId = requestAnimationFrame(loop);
      this.controls.update();
      if (!this.renderPaused) {
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  private beginCapture(): void {
    if (this.captureDepth === 0) {
      this.renderPaused = true;
    }
    this.captureDepth += 1;
  }

  private endCapture(): void {
    this.captureDepth = Math.max(0, this.captureDepth - 1);
    if (this.captureDepth === 0) {
      this.renderPaused = false;
    }
  }

  private getOutputPass(): OutputPass {
    if (!this.outputPass) {
      this.outputPass = new OutputPass();
    }
    return this.outputPass;
  }

  dispose(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);

    this.resizeObserver.disconnect();
    this.controls.dispose();

    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      (this.selectionHelper.material as THREE.Material).dispose();
      this.selectionHelper = null;
    }

    if (this.room) {
      this.scene.remove(this.room.group);
      this.room.dispose();
      this.room = null;
    }

    for (const [id, entry] of this.objects) {
      this.disposeObjectEntry(entry);
      clearTextureResolutionStatus(id);
    }
    this.objects.clear();

    this.scene.remove(this.shadowCatcher.object);
    this.shadowCatcher.dispose();
    this.scene.remove(this.keyLight.target);
    this.scene.remove(this.fillLight.target);
    this.scene.remove(this.rimLight.target);
    this.keyLight.shadow.dispose();
    this.environment.dispose();
    this.outputPass?.dispose();
    this.outputPass = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
