import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildRoom } from '../geometry/buildRoom';
import { applyObjectTransform, buildSceneObject } from '../scene/buildSceneObject';
import { ROOM_OBJECT_ID, type SceneData } from '../scene/types';
import { computeRoomFraming } from './cameraFraming';

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
 * Viewer layer for the Stage 5 scene: owns the WebGL renderer, scene, camera,
 * lights, camera controls, selection highlighting and pointer picking. It only
 * renders geometry produced by the geometry/scene builders and never mutates
 * the scene data model.
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

  private room: { group: THREE.Group; dispose: () => void; key: string } | null = null;
  private readonly objects = new Map<string, ObjectEntry>();
  private selectionHelper: THREE.BoxHelper | null = null;

  private data: SceneData | null = null;
  private selectedId: string | null = null;
  private frameId: number | null = null;
  private hasFramedOnce = false;

  private pointerDown: { x: number; y: number } | null = null;
  private readonly handlePointerDown: (event: PointerEvent) => void;
  private readonly handlePointerUp: (event: PointerEvent) => void;

  constructor(container: HTMLElement, options: SceneViewerOptions = {}) {
    this.container = container;
    this.onSelect = options.onSelect;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1b1f24');

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

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x30363d, 1.0);
    this.scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(400, 700, 500);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 4000;
    keyLight.shadow.camera.left = -1500;
    keyLight.shadow.camera.right = 1500;
    keyLight.shadow.camera.top = 1500;
    keyLight.shadow.camera.bottom = -1500;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-500, 400, -400);
    this.scene.add(fillLight);

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

    const roomKey = `${data.room.widthCm}:${data.room.lengthCm}:${data.room.heightCm}`;
    if (!this.room || this.room.key !== roomKey) {
      if (this.room) {
        this.scene.remove(this.room.group);
        this.room.dispose();
      }
      const built = buildRoom(data.room);
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
      const paramsKey = JSON.stringify(object.params);
      const existing = this.objects.get(object.id);

      if (!existing) {
        const built = buildSceneObject(object);
        this.scene.add(built.group);
        this.objects.set(object.id, {
          group: built.group,
          dispose: built.dispose,
          paramsKey,
        });
      } else if (existing.paramsKey !== paramsKey) {
        this.scene.remove(existing.group);
        existing.dispose();
        const built = buildSceneObject(object);
        this.scene.add(built.group);
        this.objects.set(object.id, {
          group: built.group,
          dispose: built.dispose,
          paramsKey,
        });
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

  /** Restores the default camera framing for the current room. */
  resetView(): void {
    if (!this.data) {
      return;
    }
    const framing = computeRoomFraming(this.data.room);
    this.camera.position.set(framing.position.x, framing.position.y, framing.position.z);
    this.controls.target.set(framing.target.x, framing.target.y, framing.target.z);
    this.controls.update();
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
