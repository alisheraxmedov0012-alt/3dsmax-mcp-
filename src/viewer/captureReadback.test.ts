import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  MAX_ASYNC_READBACK_PIXELS,
  readCapturePixels,
  type CaptureReadbackSource,
} from './captureReadback';

function target(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(8, 8);
}

describe('readCapturePixels', () => {
  it('uses the async readback when available', async () => {
    const buffer = new Uint8Array(8 * 8 * 4);
    const sync = vi.fn();
    const asyncRead = vi.fn(async () => buffer);
    const renderer: CaptureReadbackSource = {
      readRenderTargetPixels: sync,
      readRenderTargetPixelsAsync: asyncRead,
    };

    const result = await readCapturePixels(renderer, target(), 8, 8, buffer, { preferAsync: true });

    expect(result).toBe(buffer);
    expect(asyncRead).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
  });

  it('falls back to synchronous readback when async readback fails', async () => {
    const buffer = new Uint8Array(8 * 8 * 4);
    const sync = vi.fn();
    const asyncRead = vi.fn(async () => {
      throw new Error('PBO unavailable');
    });
    const renderer: CaptureReadbackSource = {
      readRenderTargetPixels: sync,
      readRenderTargetPixelsAsync: asyncRead,
    };

    const result = await readCapturePixels(renderer, target(), 8, 8, buffer, { preferAsync: true });

    expect(result).toBe(buffer);
    expect(asyncRead).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(expect.any(THREE.WebGLRenderTarget), 0, 0, 8, 8, buffer);
  });

  it('uses synchronous readback for very large targets even when async exists', async () => {
    const width = 3840;
    const height = 2160;
    expect(width * height).toBeGreaterThan(MAX_ASYNC_READBACK_PIXELS);
    const buffer = new Uint8Array(16);
    const sync = vi.fn();
    const asyncRead = vi.fn(async () => buffer);
    const renderer: CaptureReadbackSource = {
      readRenderTargetPixels: sync,
      readRenderTargetPixelsAsync: asyncRead,
    };

    await readCapturePixels(renderer, target(), width, height, buffer, { preferAsync: true });

    expect(asyncRead).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('defaults to synchronous readback even when async is available', async () => {
    const buffer = new Uint8Array(8 * 8 * 4);
    const sync = vi.fn();
    const asyncRead = vi.fn(async () => buffer);
    const renderer: CaptureReadbackSource = {
      readRenderTargetPixels: sync,
      readRenderTargetPixelsAsync: asyncRead,
    };

    await readCapturePixels(renderer, target(), 8, 8, buffer);

    expect(asyncRead).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('uses synchronous readback when the async API is absent', async () => {
    const buffer = new Uint8Array(8 * 8 * 4);
    const sync = vi.fn();
    const renderer: CaptureReadbackSource = { readRenderTargetPixels: sync };

    await readCapturePixels(renderer, target(), 8, 8, buffer, { preferAsync: true });

    expect(sync).toHaveBeenCalledTimes(1);
  });
});
