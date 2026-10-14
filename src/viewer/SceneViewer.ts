import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildRoom } from '../geometry/buildRoom';
import { applyObjectTransform, buildSceneObject } from '../scene/buildSceneObject';
import { ROOM_OBJECT_ID, type SceneData } from '../scene/types';
import type { CameraPreset, SceneSettings } from '../scene/sceneSettings';
import { computePresetFraming, computeRoomFraming } from './cameraFraming';
import { computeObjectFraming, isValidBounds, type BoundsBox } from '../render/framing';
import {
  LIGHTING_PRESET_POSITIONS,
  isLightingPresetId,
  resolveRendererConfig,
  type ResolvedRendererConfig,
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
  basic: THREE.BasicShadowMap,
  pcf: THREE.PCFShadowMap,
  pcfSoft: THREE.PCFSoftShadowMap,
};

export interface SceneViewerOptions {
  onSelect?: (id: string | null) => void;
}

interface ObjectEntry {
  group: THREE.Group;
  dispose: () => void;
  paramsKey: string;
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
  private readonly ambient: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;

  private room: { group: THREE.Group; dispose: () => void; key: string } | null = null;
  private readonly objects = new Map<string, ObjectEntry>();
  private selectionHelper: THREE.BoxHelper | null = null;

  private data: SceneData | null = null;
  private selectedId: string | null = null;
  private frameId: number | null = null;
  private hasFramedOnce = false;
  private shadowsEnabled = true;
  private renderConfig: ResolvedRendererConfig | null = null;

  private pointerDown: { x: number; y: number } | null = null;
  private readonly handlePointerDown: (event: PointerEvent) => void;
  private readonly handlePointerUp: (event: PointerEvent) => void;

  constructor(container: HTMLElement, options: SceneViewerOptions = {}) {
    this.container = container;
    this.onSelect = options.onSelect;

    this.scene = new THREE.Scene();
    this.scene.background = this.background;

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
    this.camera.position.set(600, 500, 700);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('data-testid', 'viewer-canvas');
    // Prevent the browser's own touch gestures (scroll, pinch-page-zoom) so the
    // viewer receives them on Android and other touch devices.
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 6000;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
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

    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.fillLight.position.set(-500, 400, -400);
    this.scene.add(this.fillLight);

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
      data.settings.roomMaterials.floorColor,
      data.settings.roomMaterials.wallColor,
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
        this.scene.remove(entry.group);
        entry.dispose();
        this.objects.delete(id);
      }
    }

    for (const object of data.objects) {
      const paramsKey = JSON.stringify([object.params, object.material]);
      const existing = this.objects.get(object.id);

      if (!existing) {
        const built = buildSceneObject(object);
        this.scene.add(built.group);
        this.objects.set(object.id, { group: built.group, dispose: built.dispose, paramsKey });
      } else if (existing.paramsKey !== paramsKey) {
        this.scene.remove(existing.group);
        existing.dispose();
        const built = buildSceneObject(object);
        this.scene.add(built.group);
        this.objects.set(object.id, { group: built.group, dispose: built.dispose, paramsKey });
      } else {
        applyObjectTransform(existing.group, object);
      }
    }

    if (!this.hasFramedOnce) {
      this.resetView();
      this.hasFramedOnce = true;
    }

    this.updateSelectionHelper();
    this.controls.update();
  }

  /** Applies background, lighting, render quality, tone mapping and shadows. */
  private applySettings(settings: SceneSettings): void {
    this.background.set(settings.background);

    this.ambient.intensity = settings.lights.ambientIntensity;
    this.ambient.color.set(settings.lights.ambientColor);

    this.keyLight.visible = settings.lights.keyEnabled;
    this.keyLight.intensity = settings.lights.keyIntensity;
    this.keyLight.color.set(settings.lights.keyColor);
    this.keyLight.castShadow = settings.lights.shadowsEnabled;

    this.fillLight.visible = settings.lights.fillEnabled;
    this.fillLight.intensity = settings.lights.fillIntensity;
    this.fillLight.color.set(settings.lights.fillColor);

    // Light directions come from the active lighting preset (a render concern,
    // so they live in the viewer rather than the persisted light settings).
    if (isLightingPresetId(settings.lightingPreset)) {
      const positions = LIGHTING_PRESET_POSITIONS[settings.lightingPreset];
      this.keyLight.position.set(positions.key[0], positions.key[1], positions.key[2]);
      this.fillLight.position.set(positions.fill[0], positions.fill[1], positions.fill[2]);
    }

    if (this.shadowsEnabled !== settings.lights.shadowsEnabled) {
      this.shadowsEnabled = settings.lights.shadowsEnabled;
      this.renderer.shadowMap.enabled = settings.lights.shadowsEnabled;
      // Toggling shadows requires materials to recompile.
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
    this.renderConfig = config;

    this.renderer.setPixelRatio(config.pixelRatio);

    if (this.renderer.shadowMap.type !== SHADOW_MAP_KIND[config.shadowMapKind]) {
      this.renderer.shadowMap.type = SHADOW_MAP_KIND[config.shadowMapKind];
    }
    if (this.keyLight.shadow.mapSize.x !== config.shadowMapSize) {
      this.keyLight.shadow.mapSize.set(config.shadowMapSize, config.shadowMapSize);
      // Force the shadow map to be recreated at the new size.
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }

    this.renderer.toneMapping = TONE_MAPPING[settings.toneMapping];
    this.renderer.toneMappingExposure = settings.exposure;
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

  /** Moves the camera to frame the selection (or the room) for a preset. */
  private frameTo(preset: CameraPreset): void {
    if (!this.data) {
      return;
    }
    const bounds = this.selectedObjectBounds();
    const framing =
      bounds && isValidBounds(bounds)
        ? computeObjectFraming(bounds, preset, this.camera.aspect)
        : computePresetFraming(this.data.room, preset);
    this.camera.position.set(framing.position.x, framing.position.y, framing.position.z);
    this.controls.target.set(framing.target.x, framing.target.y, framing.target.z);
    this.controls.update();
  }

  /** Restores the default framing (the selection when present, else the room). */
  resetView(): void {
    if (!this.data) {
      return;
    }
    const framing = computeRoomFraming(this.data.room);
    const bounds = this.selectedObjectBounds();
    if (bounds && isValidBounds(bounds)) {
      this.frameTo('product');
      return;
    }
    this.camera.position.set(framing.position.x, framing.position.y, framing.position.z);
    this.controls.target.set(framing.target.x, framing.target.y, framing.target.z);
    this.controls.update();
  }

  /** Moves the camera to a named preset. Object coordinates are never changed. */
  applyCameraPreset(preset: CameraPreset): void {
    this.frameTo(preset);
  }

  /**
   * Renders the current scene composition at the requested pixel size and
   * returns a PNG Blob. Uses a temporary render target (no global
   * `preserveDrawingBuffer`), and always disposes it and restores the camera
   * aspect so the visible view is never left broken.
   */
  async capturePng(width: number, height: number): Promise<Blob> {
    const prevAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    const target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false,
      // Multisample the offscreen target when the quality preset enables AA.
      samples: this.renderConfig?.antialias ? 4 : 0,
    });
    target.texture.colorSpace = THREE.SRGBColorSpace;

    const prevTarget = this.renderer.getRenderTarget();

    try {
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.scene, this.camera);

      const pixels = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('2D kontekst mavjud emas.');
      }

      const imageData = context.createImageData(width, height);
      // WebGL reads bottom-up; flip vertically into the 2D canvas.
      for (let y = 0; y < height; y += 1) {
        const src = (height - 1 - y) * width * 4;
        imageData.data.set(pixels.subarray(src, src + width * 4), y * width * 4);
      }
      context.putImageData(imageData, 0, 0);

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error("PNG yaratib bo'lmadi."))),
          'image/png',
        );
      });
    } finally {
      this.renderer.setRenderTarget(prevTarget ?? null);
      target.dispose();
      this.camera.aspect = prevAspect;
      this.camera.updateProjectionMatrix();
      // Redraw the visible frame at the restored size.
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
      this.renderer.render(this.scene, this.camera);
    };
    loop();
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

    for (const entry of this.objects.values()) {
      this.scene.remove(entry.group);
      entry.dispose();
    }
    this.objects.clear();

    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
