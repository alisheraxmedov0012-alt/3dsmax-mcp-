import { describe, expect, it } from 'vitest';
import { scanObj } from './objGuard';
import { ImportError } from './importErrors';
import { MAX_POLYGON_VERTICES, MAX_TEXT_LINE_LENGTH } from './importLimits';

function codeOf(text: string): string {
  try {
    scanObj(text);
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return (error as ImportError).code;
  }
  throw new Error('expected the OBJ to be rejected');
}

const TRIANGLE = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n');

describe('scanObj — counting', () => {
  it('counts vertices, faces and triangles', () => {
    const scan = scanObj(TRIANGLE);
    expect(scan.vertices).toBe(3);
    expect(scan.faces).toBe(1);
    expect(scan.triangles).toBe(1);
  });

  it('treats an n-gon as n-2 triangles', () => {
    const quad = ['v 0 0 0', 'v 1 0 0', 'v 1 0 1', 'v 0 0 1', 'f 1 2 3 4', ''].join('\n');
    const scan = scanObj(quad);
    expect(scan.faces).toBe(1);
    expect(scan.triangles).toBe(2);
  });

  it('collects object, group and material names once', () => {
    const text = [
      'o Chair',
      'g Seat',
      'usemtl Wood',
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'f 1 2 3',
      'usemtl Wood',
      'o Chair',
    ].join('\n');
    const scan = scanObj(text);
    expect(scan.objectNames).toEqual(['Chair', 'Seat']);
    expect(scan.materialNames).toEqual(['Wood']);
    expect(scan.hasMaterials).toBe(true);
  });

  it('reads mtllib and normalises it', () => {
    const scan = scanObj('mtllib ./parts/chair.mtl other.mtl\n');
    expect(scan.mtlLibraries).toEqual(['parts/chair.mtl', 'other.mtl']);
  });

  it('handles CRLF and a missing final newline', () => {
    const scan = scanObj('v 0 0 0\r\nv 1 0 0\r\nv 0 1 0\r\nf 1 2 3');
    expect(scan.triangles).toBe(1);
  });

  it('ignores comments and unknown statements', () => {
    const scan = scanObj(['# note', 's off', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n'));
    expect(scan.triangles).toBe(1);
  });
});

describe('scanObj — indices', () => {
  it('accepts negative indices that resolve inside the file', () => {
    const scan = scanObj(['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f -3 -2 -1', ''].join('\n'));
    expect(scan.triangles).toBe(1);
  });

  it('rejects index 0, which OBJ does not define', () => {
    expect(codeOf(['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 0 1 2', ''].join('\n'))).toBe('malformed');
  });

  it('rejects an index beyond the vertices declared so far', () => {
    expect(codeOf(['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 4', ''].join('\n'))).toBe('malformed');
  });

  it('rejects a negative index that resolves before the first vertex', () => {
    expect(codeOf(['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f -1 -2 -4', ''].join('\n'))).toBe('malformed');
  });

  it('rejects a non-numeric index', () => {
    expect(codeOf(['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 two 3', ''].join('\n'))).toBe('malformed');
  });

  it('reads the vertex part of a v/vt/vn token', () => {
    const text = [
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'vt 0 0',
      'vt 1 0',
      'vt 0 1',
      'vn 0 0 1',
      'f 1/1/1 2/2/1 3/3/1',
      '',
    ].join('\n');
    expect(scanObj(text).triangles).toBe(1);
  });

  it('rejects a face with fewer than three vertices', () => {
    expect(codeOf(['v 0 0 0', 'v 1 0 0', 'f 1 2', ''].join('\n'))).toBe('malformed');
  });

  it(`rejects a face with more than ${MAX_POLYGON_VERTICES} vertices`, () => {
    const count = MAX_POLYGON_VERTICES + 1;
    const vertices = Array.from({ length: count }, (_unused, index) => `v ${index} 0 0`);
    const face = `f ${Array.from({ length: count }, (_unused, index) => index + 1).join(' ')}`;
    expect(codeOf([...vertices, face, ''].join('\n'))).toBe('too_complex');
  });
});

describe('scanObj — bounds', () => {
  it(`rejects a line longer than ${MAX_TEXT_LINE_LENGTH} characters`, () => {
    expect(codeOf(`v 0 0 0 ${'1'.repeat(MAX_TEXT_LINE_LENGTH)}`)).toBe('too_complex');
  });

  it('rejects a material library path with traversal', () => {
    expect(codeOf('mtllib ../../etc/passwd\n')).toBe('malformed');
  });

  it('rejects a control character in an object name', () => {
    expect(codeOf('o Chair\u0000\n')).toBe('malformed');
  });

  it('rejects more triangles than the budget without building geometry', () => {
    const lines = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0'];
    for (let index = 0; index < 500_001; index += 1) {
      lines.push('f 1 2 3');
    }
    expect(codeOf(lines.join('\n'))).toBe('too_complex');
  }, 30_000);
});
