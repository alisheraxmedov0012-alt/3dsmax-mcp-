/**
 * Phase 5.2 — viewer-owned environment lighting.
 *
 * The environment is generated from Three's procedural `RoomEnvironment` and
 * prefiltered with the existing viewer `WebGLRenderer`; no second renderer,
 * WebGL context, external HDRI or network request is involved. The manager owns
 * every GPU resource it creates and can be disposed independently of the viewer.
 */
import * as THREE from 'three';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ENVIRONMENT_INTENSITY_LIMITS } from '../render/renderPresets';

export interface EnvironmentSettings {
  enabled: boolean;
  intensity: number;
}

export type RoomEnvironmentLike = THREE.Scene & { dispose: () => void };

export interface PmremGeneratorLike {
  fromScene(
    scene: THREE.Scene,
    sigma?: number,
    near?: number,
    far?: number,
  ): THREE.WebGLRenderTarget;
  dispose(): void;
}

export interface EnvironmentManagerDeps {
  /** Injected in tests; production uses Three's RoomEnvironment. */
  createRoomEnvironment?: () => RoomEnvironmentLike;
  /** Injected in tests; production uses PMREMGenerator with the viewer renderer. */
  createPmremGenerator?: (renderer: THREE.WebGLRenderer) => PmremGeneratorLike;
}

function normalizeSettings(settings: EnvironmentSettings): EnvironmentSettings {
  const intensity = Number.isFinite(settings.intensity)
    ? Math.min(
        Math.max(settings.intensity, ENVIRONMENT_INTENSITY_LIMITS.min),
        ENVIRONMENT_INTENSITY_LIMITS.max,
      )
    : 1;
  return { enabled: settings.enabled === true, intensity };
}

export class EnvironmentManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly createRoomEnvironment: () => RoomEnvironmentLike;
  private readonly createPmremGenerator: (renderer: THREE.WebGLRenderer) => PmremGeneratorLike;

  private pmrem: PmremGeneratorLike | null = null;
  private room: RoomEnvironmentLike | null = null;
  private target: THREE.WebGLRenderTarget | null = null;
  private generationFailed = false;
  private lastError: unknown = null;
  private disposed = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    deps: EnvironmentManagerDeps = {},
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.createRoomEnvironment = deps.createRoomEnvironment ?? (() => new RoomEnvironment());
    this.createPmremGenerator =
      deps.createPmremGenerator ?? ((rendererInstance) => new PMREMGenerator(rendererInstance));
  }

  /**
   * Apply an environment state. Intensity-only changes reuse the existing PMREM
   * texture; the expensive generation runs only when the light is first enabled
   * (or re-enabled after it was disposed).
   */
  apply(settings: EnvironmentSettings): void {
    if (this.disposed) {
      return;
    }
    const next = normalizeSettings(settings);

    if (!next.enabled) {
      this.scene.environment = null;
      this.scene.environmentIntensity = 1;
      this.releaseTarget();
      this.generationFailed = false;
      this.lastError = null;
      return;
    }

    if (!this.target && !this.generationFailed) {
      this.generate();
    }

    // A render target is only produced by generate(); if generation failed on a
    // previous call, the scene simply stays without an environment.
    if (!this.target) {
      this.scene.environment = null;
      this.scene.environmentIntensity = 1;
      return;
    }

    this.scene.environment = this.target.texture;
    this.scene.environmentIntensity = next.intensity;
  }

  private generate(): void {
    try {
      if (!this.pmrem) {
        this.pmrem = this.createPmremGenerator(this.renderer);
      }
      if (!this.room) {
        this.room = this.createRoomEnvironment();
      }
      this.target = this.pmrem.fromScene(this.room, 0, 0.1, 100);
      this.generationFailed = false;
      this.lastError = null;
    } catch (error) {
      // Keep the viewer usable when the optional environment cannot be built.
      // Do not retry on every scene update; a disable/re-enable resets this flag.
      this.generationFailed = true;
      this.lastError = error;
      this.target = null;
    }
  }

  /** Last environment-build error, for diagnostics; null when the last attempt succeeded. */
  getLastError(): unknown {
    return this.lastError;
  }

  private releaseTarget(): void {
    if (!this.target) {
      return;
    }
    this.target.dispose();
    this.target = null;
  }

  /** Release the PMREM texture, RoomEnvironment scene and PMREM generator. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.scene.environment = null;
    this.scene.environmentIntensity = 1;
    this.releaseTarget();
    this.room?.dispose();
    this.room = null;
    this.pmrem?.dispose();
    this.pmrem = null;
  }
}
