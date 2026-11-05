/**
 * Phase 5.6 — read a capture target with Three's async PBO path when available,
 * falling back to the synchronous readback on older/unsupported environments.
 */
import type * as THREE from 'three';

/**
 * Async PBO readback is used for ordinary product sizes. Very large (4K)
 * targets use the synchronous path: several drivers/SwiftShader builds fail to
 * complete a 4K PBO fence, leaving the UI stuck. The synchronous path is slower
 * but deterministic, and the capture loop is already paused.
 */
export const MAX_ASYNC_READBACK_PIXELS = 4_000_000;

export interface CaptureReadbackSource {
  readRenderTargetPixels(
    target: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: Uint8Array,
  ): void;
  readRenderTargetPixelsAsync?(
    target: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: Uint8Array,
  ): Promise<unknown>;
}

export interface ReadCaptureOptions {
  /**
   * Opt-in async PBO readback. Capture defaults to synchronous because PBO
   * fences proved unreliable/hanging in the headless SwiftShader probe; the
   * capability remains available and tested for browsers where it is safe.
   */
  preferAsync?: boolean;
}

export async function readCapturePixels(
  renderer: CaptureReadbackSource,
  target: THREE.WebGLRenderTarget,
  width: number,
  height: number,
  buffer: Uint8Array,
  options: ReadCaptureOptions = {},
): Promise<Uint8Array> {
  if (
    options.preferAsync === true &&
    width * height <= MAX_ASYNC_READBACK_PIXELS &&
    typeof renderer.readRenderTargetPixelsAsync === 'function'
  ) {
    try {
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, buffer);
      return buffer;
    } catch {
      // Some drivers reject async PBOs for a multisample/sRGB target. The
      // synchronous path remains valid while the target is still alive.
    }
  }
  renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
  return buffer;
}
