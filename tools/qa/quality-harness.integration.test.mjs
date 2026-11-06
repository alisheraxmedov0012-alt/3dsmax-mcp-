import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  STATUS,
  classifyKhronos,
  classifyRepoValidator,
  parseRepoValidatorOutput,
} from './quality-lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function findExecutable(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }
  return null;
}

/** A structurally valid GLB container whose JSON document is invalid as glTF. */
function makeMalformedGlb() {
  const json = Buffer.from('{}', 'utf8');
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + padded.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(padded.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  return new Uint8Array(Buffer.concat([header, chunk, padded]));
}

const python = process.env.QA_PYTHON || findExecutable(['python3', 'python']);

describe('official Khronos validator integration', () => {
  it('reports a malformed GLB as errors instead of passing it', async () => {
    const module = await import('gltf-validator');
    const validator = module.default ?? module;
    const raw = await validator.validateBytes(makeMalformedGlb(), {
      uri: 'broken.glb',
      maxIssues: 100,
    });
    const component = classifyKhronos({ raw });
    expect(component.errors).toBeGreaterThan(0);
    expect(component.status).toBe(STATUS.FAIL);
  });
});

describe.skipIf(!python)('repository validator integration', () => {
  it('returns FAIL for a malformed GLB', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-harness-'));
    const glbPath = path.join(directory, 'broken.glb');
    try {
      await fs.writeFile(glbPath, makeMalformedGlb());
      const result = spawnSync(
        python,
        [path.join(repoRoot, 'backend/scripts/glb_validate.py'), glbPath],
        { cwd: repoRoot, encoding: 'utf8', timeout: 120000 },
      );
      expect(result.status).toBe(1);
      const raw = parseRepoValidatorOutput(result.stdout, glbPath);
      expect(raw?.verdict).toBe('FAIL');
      expect(classifyRepoValidator({ raw }).status).toBe(STATUS.FAIL);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
