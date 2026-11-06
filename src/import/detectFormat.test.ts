import { describe, expect, it } from 'vitest';
import { detectModelFormat, looksLikeGltfFileName } from './detectFormat';
import { ImportError } from './importErrors';
import { buildGlb, triangleBin, triangleGlb, triangleJson } from './__fixtures__/glbFixtures';

function codeOf(bytes: ArrayBuffer): string {
  try {
    detectModelFormat(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return (error as ImportError).code;
  }
  throw new Error('expected the format to be rejected');
}

describe('detectModelFormat', () => {
  it('accepts a GLB by its magic number', () => {
    expect(detectModelFormat(triangleGlb())).toBe('glb');
  });

  it('trusts the content, not the file name', () => {
    // The name is not consulted at all: a renamed GLB is still a GLB.
    expect(detectModelFormat(triangleGlb())).toBe('glb');
  });

  it('rejects an empty file', () => {
    expect(codeOf(new ArrayBuffer(0))).toBe('empty');
  });

  it('rejects content that is neither a container, a glTF nor an OBJ', () => {
    expect(codeOf(new TextEncoder().encode('glTF').buffer as ArrayBuffer)).toBe(
      'unsupported_format',
    );
  });

  it('recognises a JSON glTF by its asset block', () => {
    const gltf = JSON.stringify({ asset: { version: '2.0' } });
    expect(detectModelFormat(new TextEncoder().encode(gltf).buffer as ArrayBuffer)).toBe('gltf');
  });

  it('recognises an OBJ by its statement list', () => {
    const obj = '# chair\nmtllib chair.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
    expect(detectModelFormat(new TextEncoder().encode(obj).buffer as ArrayBuffer)).toBe('obj');
  });

  it('rejects non-model content with a generic message', () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>nope</body></html>');
    expect(codeOf(html.buffer as ArrayBuffer)).toBe('unsupported_format');
  });

  it('rejects JSON that is not a glTF document', () => {
    const text = new TextEncoder().encode('{"hello":"world"}');
    expect(codeOf(text.buffer as ArrayBuffer)).toBe('malformed');
  });

  it('rejects a GLB whose magic is corrupted', () => {
    const bytes = buildGlb(triangleJson(), triangleBin(), { magic: 0x00000000 });
    const text = new TextDecoder().decode(new Uint8Array(bytes, 0, 32));
    expect(text.trimStart().startsWith('{')).toBe(false);
    expect(codeOf(bytes)).toBe('unsupported_format');
  });
});

describe('looksLikeGltfFileName', () => {
  it('recognises the text form by extension', () => {
    expect(looksLikeGltfFileName('chair.gltf')).toBe(true);
    expect(looksLikeGltfFileName('CHAIR.GLTF')).toBe(true);
    expect(looksLikeGltfFileName('chair.glb')).toBe(false);
    expect(looksLikeGltfFileName('chair')).toBe(false);
  });
});
