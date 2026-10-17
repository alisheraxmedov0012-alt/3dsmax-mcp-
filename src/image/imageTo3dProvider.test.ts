import { describe, expect, it } from 'vitest';
import {
  describeImageTo3DStatus,
  generateImageTo3DMesh,
  getImageTo3DProvider,
  ImageTo3DError,
  type ImageTo3DProvider,
} from './imageTo3dProvider';

describe('image-to-3D provider boundary', () => {
  it('reports no provider and a not-configured status', () => {
    expect(getImageTo3DProvider()).toBeNull();
    const status = describeImageTo3DStatus();
    expect(status.configured).toBe(false);
    // The message must be explicit and must not claim the feature works.
    expect(status.message).toContain('sozlanmagan');
  });

  it('throws a typed unconfigured error instead of faking a result', async () => {
    await expect(
      generateImageTo3DMesh({ image: { format: 'png', bytes: new ArrayBuffer(0) } }),
    ).rejects.toBeInstanceOf(ImageTo3DError);

    try {
      await generateImageTo3DMesh({ image: { format: 'png', bytes: new ArrayBuffer(0) } });
    } catch (error) {
      expect((error as ImageTo3DError).kind).toBe('unconfigured');
    }
  });

  it('does not read secrets or perform network I/O (module has no key surface)', () => {
    // A provider, when added, is an interface value — the module exposes no
    // environment access. This asserts the public surface only.
    const provider: ImageTo3DProvider | null = getImageTo3DProvider();
    expect(provider).toBeNull();
  });

  it('exposes no secret-looking exports and no endpoint/name in the status text', async () => {
    const surface = await import('./imageTo3dProvider');
    for (const name of Object.keys(surface)) {
      expect(name).not.toMatch(/key|token|secret|password|endpoint|apikey/i);
    }
    // The status must not fabricate a provider name, model or URL.
    const message = describeImageTo3DStatus().message;
    expect(message).not.toMatch(/https?:\/\//);
    expect(message).not.toMatch(/api[_-]?key|token|secret/i);
  });
});
