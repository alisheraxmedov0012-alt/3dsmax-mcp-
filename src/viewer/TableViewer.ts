import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildTable, type BuiltTable } from '../geometry/buildTable';
import type { TableParams } from '../geometry/tableParams';

/**
 * Viewer layer: owns the WebGL renderer, scene, camera, lights and camera
 * controls. It only renders geometry produced by the geometry layer and never
 * creates model geometry itself.
 */
export class TableViewer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private table: BuiltTable | null = null;
  private frameId: number | null = null;
  private hasFramedOnce = false;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1b1f24');

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 10000);
    this.camera.position.set(180, 150, 220);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('data-testid', 'viewer-canvas');
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 900;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.target.set(0, 40, 0);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x30363d, 1.0);
    this.scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(150, 260, 180);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 1200;
    keyLight.shadow.camera.left = -400;
    keyLight.shadow.camera.right = 400;
    keyLight.shadow.camera.top = 400;
    keyLight.shadow.camera.bottom = -400;
    this.scene.add(keyLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: '#2a2f36', roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(2000, 100, 0x3a4149, 0x2f353c);
    this.scene.add(grid);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.start();
  }

  setParams(params: TableParams): void {
    if (this.table) {
      this.scene.remove(this.table.group);
      this.table.dispose();
    }

    this.table = buildTable(params);
    this.scene.add(this.table.group);

    this.controls.target.set(0, params.heightCm / 2, 0);

    if (!this.hasFramedOnce) {
      this.frameCamera(params);
      this.hasFramedOnce = true;
    }
    this.controls.update();
  }

  private frameCamera(params: TableParams): void {
    const maxDim = Math.max(params.widthCm, params.heightCm, params.depthCm);
    const distance = maxDim * 2.2;
    this.camera.position.set(distance * 0.8, params.heightCm + maxDim * 0.8, distance);
    this.controls.update();
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
    this.resizeObserver.disconnect();
    this.controls.dispose();

    if (this.table) {
      this.scene.remove(this.table.group);
      this.table.dispose();
      this.table = null;
    }

    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
