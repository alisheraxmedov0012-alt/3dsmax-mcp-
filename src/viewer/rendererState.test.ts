import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  captureRendererState,
  restoreRendererState,
  type RendererStateSource,
} from './rendererState';

function makeRenderer() {
  const target = new THREE.WebGLRenderTarget(64, 64);
  const state = {
    target: null as THREE.WebGLRenderTarget | null,
    viewport: new THREE.Vector4(0, 0, 320, 180),
    scissor: new THREE.Vector4(1, 2, 100, 50),
    scissorTest: true,
    clearColor: new THREE.Color('#123456'),
    clearAlpha: 0.4,
    autoClear: true,
    activeCubeFace: 2,
    activeMipmapLevel: 1,
  };
  const renderer: RendererStateSource = {
    get autoClear() {
      return state.autoClear;
    },
    set autoClear(value: boolean) {
      state.autoClear = value;
    },
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => state.activeCubeFace,
    getActiveMipmapLevel: () => state.activeMipmapLevel,
    getViewport: (out) => out.copy(state.viewport),
    getScissor: (out) => out.copy(state.scissor),
    getScissorTest: () => state.scissorTest,
    getClearColor: (out) => out.copy(state.clearColor),
    getClearAlpha: () => state.clearAlpha,
    setRenderTarget: (next) => {
      state.target = next;
    },
    setViewport: (next) => {
      state.viewport.copy(next);
    },
    setScissor: (next) => {
      state.scissor.copy(next);
    },
    setScissorTest: (next) => {
      state.scissorTest = next;
    },
    setClearColor: (color) => {
      state.clearColor.set(color);
    },
    setClearAlpha: (alpha) => {
      state.clearAlpha = alpha;
    },
  };
  return { target, state, renderer };
}

describe('captureRendererState / restoreRendererState', () => {
  it('restores target, viewport, scissor, clear state and autoClear', () => {
    const { target, state, renderer } = makeRenderer();
    state.target = target;
    const before = captureRendererState(renderer);

    state.target = null;
    state.viewport.set(0, 0, 10, 10);
    state.scissor.set(0, 0, 1, 1);
    state.scissorTest = false;
    state.clearColor.set('#ffffff');
    state.clearAlpha = 1;
    state.autoClear = false;

    restoreRendererState(renderer, before);

    expect(renderer.getRenderTarget()).toBe(target);
    expect(renderer.getViewport(new THREE.Vector4())).toEqual(new THREE.Vector4(0, 0, 320, 180));
    expect(renderer.getScissor(new THREE.Vector4())).toEqual(new THREE.Vector4(1, 2, 100, 50));
    expect(renderer.getScissorTest()).toBe(true);
    expect(renderer.getClearColor(new THREE.Color()).getHexString()).toBe('123456');
    expect(renderer.getClearAlpha()).toBeCloseTo(0.4, 8);
    expect(renderer.autoClear).toBe(true);
  });

  it('restores a null screen target without creating a renderer', () => {
    const { renderer } = makeRenderer();
    const before = captureRendererState(renderer);
    renderer.setRenderTarget(new THREE.WebGLRenderTarget(8, 8));
    restoreRendererState(renderer, before);
    expect(renderer.getRenderTarget()).toBeNull();
  });

  it('restores the viewport through the injected renderer API', () => {
    const { renderer } = makeRenderer();
    const spied = vi.spyOn(renderer, 'setViewport');
    restoreRendererState(renderer, captureRendererState(renderer));
    expect(spied).toHaveBeenCalledTimes(1);
  });
});
