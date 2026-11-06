/**
 * Phase 6.2.3 — bounded pre-scan of an untrusted OBJ.
 *
 * `OBJLoader` is a geometry converter, not a validator: it happily allocates
 * whatever a file describes, and a single 300 MB line or a negative index that
 * resolves outside the vertex list reaches it as ordinary input. This scan runs
 * first, refuses the file before the loader sees it, and returns the counts the
 * import report needs.
 *
 * The scanner walks the string once without splitting it: a 500k-triangle OBJ is
 * several million lines, and building an array of them would cost more memory than
 * the model itself.
 *
 * Numeric values on `v` lines are not parsed here — a NaN coordinate is caught by
 * the shared geometry guard after loading, which already rejects non-finite
 * positions and is the same rule the exporters apply.
 */
import { importFailure } from './importErrors';
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_POLYGON_VERTICES,
  MAX_TEXT_LINE_LENGTH,
  MAX_TRIANGLES,
  MAX_VERTICES,
} from './importLimits';
import { normalizeImportPath } from './resourceMap';

const SPACE = 32;
const TAB = 9;
const SLASH = 47;

export interface ObjScan {
  readonly vertices: number;
  readonly textureCoords: number;
  readonly normals: number;
  readonly faces: number;
  readonly triangles: number;
  /** Deduplicated `o`/`g` names, in file order. */
  readonly objectNames: readonly string[];
  /** Deduplicated `usemtl` names, in file order. */
  readonly materialNames: readonly string[];
  /** `mtllib` entries, already normalised. */
  readonly mtlLibraries: readonly string[];
  /** True when the file references a material it never declares via `mtllib`. */
  readonly hasMaterials: boolean;
}

const MAX_COLLECTED_NAMES = 1000;

function isSpace(code: number): boolean {
  return code === SPACE || code === TAB;
}

/** Reads a bounded decimal integer without allocating a substring. */
function readInteger(text: string, start: number, end: number): number | null {
  let index = start;
  let sign = 1;
  if (index < end && text.charCodeAt(index) === 45 /* '-' */) {
    sign = -1;
    index += 1;
  }
  if (index >= end) {
    return null;
  }
  let value = 0;
  let digits = 0;
  while (index < end) {
    const code = text.charCodeAt(index);
    if (code < 48 || code > 57) {
      return null;
    }
    value = value * 10 + (code - 48);
    digits += 1;
    // An index longer than this cannot be a real reference; refuse early instead
    // of losing precision.
    if (digits > 9) {
      return null;
    }
    index += 1;
  }
  return sign * value;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** `o` / `g` / `usemtl` names are display strings, so they get a shape check. */
function validateName(name: string, line: number): string {
  const trimmed = name.trim();
  if (trimmed.length > MAX_OBJECT_NAME_LENGTH || hasControlCharacter(trimmed)) {
    throw importFailure('malformed', `OBJ ${line}-qatorda nom noto‘g‘ri.`);
  }
  return trimmed;
}

function addName(target: string[], seen: Set<string>, name: string): void {
  if (name === '' || seen.has(name) || target.length >= MAX_COLLECTED_NAMES) {
    return;
  }
  seen.add(name);
  target.push(name);
}

interface FaceResult {
  readonly verticesInFace: number;
  readonly triangles: number;
}

/**
 * Validates one `f` line: 3..MAX_POLYGON_VERTICES vertices, every index an integer
 * that resolves inside the vertex list declared so far.
 */
function scanFace(
  text: string,
  start: number,
  end: number,
  vertexCount: number,
  line: number,
): FaceResult {
  let index = start;
  let verticesInFace = 0;

  while (index < end) {
    while (index < end && isSpace(text.charCodeAt(index))) {
      index += 1;
    }
    if (index >= end) {
      break;
    }

    const tokenStart = index;
    while (index < end) {
      const code = text.charCodeAt(index);
      if (isSpace(code) || code === SLASH) {
        break;
      }
      index += 1;
    }
    const value = readInteger(text, tokenStart, index);
    if (value === null) {
      throw importFailure('malformed', `OBJ ${line}-qatorda yuz indeksi noto‘g‘ri.`);
    }
    const resolved = value > 0 ? value - 1 : vertexCount + value;
    if (value === 0 || resolved < 0 || resolved >= vertexCount) {
      throw importFailure(
        'malformed',
        `OBJ ${line}-qatorda indeks mavjud vertexlarga ishora qilmaydi (${value}).`,
      );
    }

    verticesInFace += 1;
    if (verticesInFace > MAX_POLYGON_VERTICES) {
      throw importFailure(
        'too_complex',
        `OBJ ${line}-qatorda ${verticesInFace} dan ortiq uchli yuz (limit ${MAX_POLYGON_VERTICES}).`,
      );
    }

    // Skip the texture/normal components of this token.
    while (index < end && !isSpace(text.charCodeAt(index))) {
      index += 1;
    }
  }

  if (verticesInFace < 3) {
    throw importFailure('malformed', `OBJ ${line}-qatorda yuz 3 tadan kam uchga ega.`);
  }

  return { verticesInFace, triangles: verticesInFace - 2 };
}

/** Scans an OBJ document, throwing an `ImportError` on anything out of policy. */
export function scanObj(text: string): ObjScan {
  const objectNames: string[] = [];
  const materialNames: string[] = [];
  const seenObjects = new Set<string>();
  const seenMaterials = new Set<string>();
  const mtlLibraries: string[] = [];

  let vertices = 0;
  let textureCoords = 0;
  let normals = 0;
  let faces = 0;
  let triangles = 0;

  const length = text.length;
  let lineStart = 0;
  let line = 0;

  while (lineStart <= length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) {
      lineEnd = length;
    }
    // Tolerate CRLF without copying the line.
    let contentEnd = lineEnd;
    if (contentEnd > lineStart && text.charCodeAt(contentEnd - 1) === 13) {
      contentEnd -= 1;
    }
    line += 1;

    if (contentEnd - lineStart > MAX_TEXT_LINE_LENGTH) {
      throw importFailure(
        'too_complex',
        `OBJ ${line}-qator juda uzun (${contentEnd - lineStart} belgi, limit ${MAX_TEXT_LINE_LENGTH}).`,
      );
    }

    let cursor = lineStart;
    while (cursor < contentEnd && isSpace(text.charCodeAt(cursor))) {
      cursor += 1;
    }

    if (cursor < contentEnd) {
      const first = text.charCodeAt(cursor);
      const second = cursor + 1 < contentEnd ? text.charCodeAt(cursor + 1) : 0;

      // 'v', 'vt', 'vn', 'vp'
      if (first === 118 /* v */) {
        if (isSpace(second) || cursor + 1 === contentEnd) {
          vertices += 1;
          if (vertices > MAX_VERTICES) {
            throw importFailure('too_complex', `OBJ vertexlar soni ${MAX_VERTICES} dan oshdi.`);
          }
        } else if (second === 116 /* t */) {
          textureCoords += 1;
        } else if (second === 110 /* n */) {
          normals += 1;
        }
        if (textureCoords > MAX_VERTICES || normals > MAX_VERTICES) {
          throw importFailure('too_complex', 'OBJ normal yoki UV soni chegaradan oshdi.');
        }
      } else if (first === 102 /* f */ && isSpace(second)) {
        const result = scanFace(text, cursor + 1, contentEnd, vertices, line);
        faces += 1;
        triangles += result.triangles;
        if (triangles > MAX_TRIANGLES) {
          throw importFailure(
            'too_complex',
            `OBJ ${triangles} uchburchakdan iborat (limit ${MAX_TRIANGLES}).`,
          );
        }
      } else if (first === 111 /* o */ || first === 103 /* g */) {
        if (isSpace(second)) {
          addName(
            objectNames,
            seenObjects,
            validateName(text.slice(cursor + 1, contentEnd), line),
          );
        }
      } else if (first === 117 /* u */) {
        // usemtl
        if (second === 115 && text.startsWith('usemtl', cursor)) {
          addName(
            materialNames,
            seenMaterials,
            validateName(text.slice(cursor + 6, contentEnd), line),
          );
        }
      } else if (first === 109 /* m */) {
        // mtllib may list several libraries on one line.
        if (text.startsWith('mtllib', cursor)) {
          const rest = text.slice(cursor + 6, contentEnd).trim();
          for (const entry of rest.split(/\s+/u)) {
            if (entry === '') {
              continue;
            }
            const normalized = normalizeImportPath(entry);
            if (!normalized.ok) {
              throw importFailure(
                'malformed',
                `OBJ ${line}-qatorda mtllib yo‘li qabul qilinmaydi: ${normalized.problem}`,
              );
            }
            if (!mtlLibraries.includes(normalized.path)) {
              mtlLibraries.push(normalized.path);
            }
          }
        }
      }
    }

    if (lineEnd === length) {
      break;
    }
    lineStart = lineEnd + 1;
  }

  return {
    vertices,
    textureCoords,
    normals,
    faces,
    triangles,
    objectNames,
    materialNames,
    mtlLibraries,
    hasMaterials: materialNames.length > 0,
  };
}
