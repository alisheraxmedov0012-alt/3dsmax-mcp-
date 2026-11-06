import { describe, expect, it } from 'vitest';
import {
  buildResourceMap,
  describeResourceMapFailure,
  normalizeImportPath,
  type ImportFile,
} from './resourceMap';
import {
  MAX_MODEL_BYTES,
  MAX_SELECTED_FILES,
  MAX_TOTAL_INPUT_BYTES,
} from './importLimits';

function file(path: string, text = 'x'): ImportFile {
  return { name: path, bytes: new TextEncoder().encode(text).buffer as ArrayBuffer };
}

function mapOf(files: ImportFile[]) {
  const built = buildResourceMap(files);
  if (!built.ok) {
    throw new Error(describeResourceMapFailure(built.failure));
  }
  return built.map;
}

describe('normalizeImportPath', () => {
  it('keeps a plain relative path, including spaces', () => {
    expect(normalizeImportPath('textures/wood fine.png')).toEqual({
      ok: true,
      path: 'textures/wood fine.png',
    });
  });

  it('rejects traversal, absolute paths and drive letters', () => {
    for (const bad of [
      '../secret.png',
      'textures/../../secret.png',
      '/etc/passwd',
      'C:\\Windows\\win.ini',
      'c:/Windows/win.ini',
      'textures\\wood.png',
      '',
      'a//b.png',
      './a.png',
      'file./png',
      'trailing /',
    ]) {
      expect(normalizeImportPath(bad).ok).toBe(false);
    }
  });

  it('rejects control characters and over-long paths', () => {
    expect(normalizeImportPath('a\u0000b.png').ok).toBe(false);
    expect(normalizeImportPath(`${'a'.repeat(201)}.png`).ok).toBe(false);
  });
});

describe('buildResourceMap', () => {
  it('indexes the selection by normalised path', () => {
    const map = mapOf([file('model.gltf'), file('textures/wood.png')]);
    expect([...map.paths].sort()).toEqual(['model.gltf', 'textures/wood.png']);
    expect(map.size).toBe(2);
  });

  it('rejects two files with the same path', () => {
    const built = buildResourceMap([file('a.png'), file('a.png')]);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.failure.kind).toBe('duplicate');
    }
  });

  it('rejects an unsafe selected path', () => {
    const built = buildResourceMap([file('../escape.png')]);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.failure.kind).toBe('invalid_path');
    }
  });

  it('rejects too many files', () => {
    const files = Array.from({ length: MAX_SELECTED_FILES + 1 }, (_unused, index) =>
      file(`f-${index}.png`),
    );
    const built = buildResourceMap(files);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.failure.kind).toBe('too_many_files');
    }
  });

  it('rejects a single file over the per-file cap', () => {
    const big: ImportFile = { name: 'big.bin', bytes: new ArrayBuffer(MAX_MODEL_BYTES + 1) };
    const built = buildResourceMap([big]);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.failure.kind).toBe('file_too_large');
    }
  });

  it('rejects a selection over the total cap', () => {
    const each = Math.floor(MAX_TOTAL_INPUT_BYTES / 2) + 1;
    const files = [
      { name: 'a.bin', bytes: new ArrayBuffer(each) },
      { name: 'b.bin', bytes: new ArrayBuffer(each) },
    ];
    const built = buildResourceMap(files);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.failure.kind).toBe('too_large');
    }
  });
});

describe('ResourceMap.lookup', () => {
  it('resolves an exact path', () => {
    const map = mapOf([file('textures/wood.png', 'wood')]);
    const found = map.lookup('textures/wood.png');
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(new TextDecoder().decode(found.bytes)).toBe('wood');
    }
  });

  it('resolves a percent-encoded reference', () => {
    const map = mapOf([file('textures/wood fine.png', 'wood')]);
    const found = map.lookup('textures/wood%20fine.png');
    expect(found.ok).toBe(true);
  });

  it('falls back to a unique basename', () => {
    const map = mapOf([file('textures/wood.png', 'wood')]);
    expect(map.lookup('wood.png').ok).toBe(true);
  });

  it('reports ambiguity instead of guessing between same-named files', () => {
    const map = mapOf([file('a/wood.png'), file('b/wood.png')]);
    const found = map.lookup('wood.png');
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.reason).toBe('ambiguous');
      expect([...found.candidates].sort()).toEqual(['a/wood.png', 'b/wood.png']);
    }
  });

  it('resolves a case difference only when it is unique', () => {
    const map = mapOf([file('textures/Wood.PNG')]);
    expect(map.lookup('textures/wood.png').ok).toBe(true);

    const colliding = mapOf([file('textures/Wood.PNG'), file('textures/wood.PNG')]);
    const found = colliding.lookup('textures/wood.png');
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.reason).toBe('ambiguous');
    }
  });

  it('reports a missing reference', () => {
    const map = mapOf([file('model.gltf')]);
    const found = map.lookup('normal.png');
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.reason).toBe('missing');
    }
  });

  it('rejects schemes and traversal at lookup time too', () => {
    const map = mapOf([file('model.gltf')]);
    for (const bad of [
      'https://example.com/a.png',
      'http://example.com/a.png',
      'file:///etc/passwd',
      'blob:http://x/y',
      '../../../etc/passwd',
    ]) {
      const found = map.lookup(bad);
      expect(found.ok).toBe(false);
      if (!found.ok) {
        expect(found.reason).toBe('invalid');
      }
    }
  });

  it('never reads outside the selection', () => {
    const map = mapOf([file('model.gltf')]);
    // An absolute path that exists on the machine running the test is still
    // refused, because resolution only knows the selected files.
    expect(map.lookup('/etc/passwd').ok).toBe(false);
  });
});
