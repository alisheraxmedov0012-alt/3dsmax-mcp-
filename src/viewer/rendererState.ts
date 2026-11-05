/**
 * Phase 5.6 — save/restore the WebGLRenderer state a capture is allowed to
 * disturb. The renderer itself and its single WebGL context remain the same.
 */
import * as THREE from 'three';

export interface RendererStateSource {
  autoClear: boolean;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  getScissor(target: THREE.Vector4): THREE.Vector4;
  getScissorTest(): boolean;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setRenderTarget(
    target: THREE.WebGLRenderTarget | null,
    activeCubeFace?: number,
    activeMipmapLevel?: number,
  ): void;
  setViewport(viewport: THREE.Vector4): void;
  setScissor(scissor: THREE.Vector4): void;
  setScissorTest(enabled: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setClearAlpha(alpha: number): void;
}

export interface RendererState {
  autoClear: boolean;
  renderTarget: THREE.WebGLRenderTarget | null;
  activeCubeFace: number;
  activeMipmapLevel: number;
  viewport: THREE.Vector4;
  scissor: THREE.Vector4;
  scissorTest: boolean;
  clearColor: THREE.Color;
  clearAlpha: number;
}

export function captureRendererState(renderer: RendererStateSource): RendererState {
  return {
    autoClear: renderer.autoClear,
    renderTarget: renderer.getRenderTarget(),
    activeCubeFace: renderer.getActiveCubeFace(),
    activeMipmapLevel: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()),
    scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(),
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
  };
}

export function restoreRendererState(
  renderer: RendererStateSource,
  state: RendererState,
): void {
  renderer.setRenderTarget(
    state.renderTarget,
    state.activeCubeFace,
    state.activeMipmapLevel,
  );
  renderer.setViewport(state.viewport);
  renderer.setScissor(state.scissor);
  renderer.setScissorTest(state.scissorTest);
  renderer.setClearColor(state.clearColor, state.clearAlpha);
  renderer.setClearAlpha(state.clearAlpha);
  renderer.autoClear = state.autoClear;
}
