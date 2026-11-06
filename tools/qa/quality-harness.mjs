/**
 * Local-first 3D quality harness.
 *
 * Pipeline: export a real GLB with the existing browser harness, run the
 * repository's independent GLB validator, run the official Khronos validator,
 * then import the same file in Blender when it is installed. Reports are written
 * as JSON and Markdown; Blender is optional and is reported as NOT VERIFIED when
 * absent rather than being silently treated as a pass.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGlb } from './export-glb.mjs';
import { compareGolden, parseGlbMetrics } from './golden.mjs';
import {
  buildReport,
  classifyBlender,
  classifyExport,
  classifyKhronos,
  classifyQualityBudget,
  classifyRepoValidator,
  extractBlenderJson,
  parseRepoValidatorOutput,
  renderMarkdown,
  STATUS,
} from './quality-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const USAGE = `Usage: npm run test:quality -- [options]

Options:
  --glb <path>    Validate an existing GLB instead of exporting a new one.
  --out <dir>     Report directory (default: qa-output).
  --no-blender    Skip Blender even when it is installed.
  --golden        Compare against the golden baseline (default for harness exports).
  --no-golden     Disable golden comparison.
  -h, --help      Show this help.

Environment:
  CHROMIUM        Chromium executable used for the export harness.
  BLENDER         Blender executable; otherwise "blender" from PATH.
  QA_PYTHON       Python executable; otherwise python3 or python from PATH.
`;

function parseArgs(argv) {
  const args = {
    glb: null,
    out: 'qa-output',
    noBlender: false,
    golden: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--glb') {
      args.glb = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (arg === '--no-blender') {
      args.noBlender = true;
    } else if (arg === '--golden') {
      args.golden = true;
    } else if (arg === '--no-golden') {
      args.golden = false;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.glb === undefined || args.out === undefined) {
    throw new Error('--glb and --out require a value.');
  }
  return args;
}

function findExecutable(candidates) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    const result = spawnSync(finder, [candidate], { encoding: 'utf8' });
    if (result.status === 0) {
      const found = result.stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find(Boolean);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function readBaseline(root) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    return { branch, sha };
  } catch {
    return null;
  }
}

function tail(text, max = 2000) {
  const value = String(text ?? '');
  return value.length > max ? value.slice(-max) : value;
}

function extractLogWarnings(stderr) {
  return String(stderr ?? '')
    .split(/\r?\n/u)
    .filter((line) => /(^|\s)(warning|error):/iu.test(line))
    .map((line) => line.trim())
    .slice(0, 20);
}

function runRepoValidator(root, python, glbPath) {
  if (!python) {
    return { unavailableReason: 'Python not found; set QA_PYTHON to run the repository validator.' };
  }
  const script = path.join(root, 'backend/scripts/glb_validate.py');
  if (!existsSync(script)) {
    return { unavailableReason: `Repository validator not found: ${script}` };
  }

  const result = spawnSync(python, [script, glbPath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    return { error: `Repository validator failed to start: ${result.error.message}` };
  }

  const raw = parseRepoValidatorOutput(result.stdout, glbPath);
  if (!raw) {
    return {
      error: `Repository validator produced unreadable output (exit ${result.status}).`,
      stderrTail: tail(result.stderr),
    };
  }
  return {
    raw,
    exitCode: result.status,
    stderrTail: tail(result.stderr),
  };
}

async function runKhronos(bytes, glbPath) {
  let validator;
  try {
    const module = await import('gltf-validator');
    validator = module.default ?? module;
  } catch (error) {
    return {
      unavailableReason: `gltf-validator is not installed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!validator || typeof validator.validateBytes !== 'function') {
    return { unavailableReason: 'gltf-validator does not export validateBytes.' };
  }

  try {
    const raw = await validator.validateBytes(new Uint8Array(bytes), {
      uri: path.basename(glbPath),
      maxIssues: 1000,
    });
    return { raw };
  } catch (error) {
    return {
      error: `Khronos validator failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function runBlender(root, glbPath, noBlender) {
  if (noBlender) {
    return { unavailableReason: 'Blender check disabled with --no-blender.' };
  }
  const blender = process.env.BLENDER || findExecutable(['blender']);
  if (!blender) {
    return {
      unavailableReason:
        'Blender not found. Set BLENDER to the executable; see tools/qa/README.md.',
    };
  }
  const script = path.join(root, 'tools/qa/blender-import.py');
  if (!existsSync(script)) {
    return { unavailableReason: `Blender inspection script not found: ${script}` };
  }

  const result = spawnSync(
    blender,
    ['--background', '--factory-startup', '--python', script, '--', glbPath],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const logWarnings = extractLogWarnings(`${result.stderr ?? ''}\n${result.stdout ?? ''}`);
  if (result.error) {
    return { error: `Blender failed to start: ${result.error.message}`, logWarnings };
  }

  const raw = extractBlenderJson(result.stdout);
  if (result.status !== 0) {
    return {
      error: `Blender exited with code ${result.status}.`,
      raw,
      logWarnings,
      stderrTail: tail(result.stderr),
    };
  }
  if (!raw) {
    return {
      error: 'Blender output did not contain QA_BLENDER_JSON.',
      logWarnings,
      stderrTail: tail(result.stderr),
    };
  }
  return { raw, logWarnings, stderrTail: tail(result.stderr) };
}

function limitationsFor(components) {
  const limitations = [
    'Khronos warnings are recorded, not suppressed.',
    'Tangent generation is part of the export pipeline; the report records the resulting validator state.',
  ];
  if (components.blender?.status === STATUS.NOT_VERIFIED) {
    limitations.push(`Blender import is NOT VERIFIED: ${components.blender.reason}`);
  }
  if (components.khronos?.status === STATUS.NOT_VERIFIED) {
    limitations.push(`Khronos validation is NOT VERIFIED: ${components.khronos.reason}`);
  }
  if (components.qualityBudget?.status === STATUS.NOT_VERIFIED) {
    limitations.push(`Quality budget is NOT VERIFIED: ${components.qualityBudget.reason}`);
  }
  if (components.goldenRegression?.status === STATUS.NOT_VERIFIED) {
    limitations.push(
      `Golden regression is NOT VERIFIED: ${components.goldenRegression.reason ?? 'unavailable'}`,
    );
  }
  return limitations;
}

async function readQualityBudget(outDir) {
  const file = path.join(outDir, 'quality-stats.json');
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    return { raw };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { unavailableReason: 'quality-stats.json was not produced by the export page.' };
    }
    return {
      error: `quality-stats.json could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function readGoldenBaseline(root) {
  const file = path.join(root, 'tools/qa/golden/quality-baseline.json');
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeReports(outDir, report) {
  const jsonPath = path.join(outDir, 'quality-report.json');
  const markdownPath = path.join(outDir, 'quality-report.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, renderMarkdown(report));
  return { jsonPath, markdownPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const outDir = path.resolve(repoRoot, args.out);
  await fs.mkdir(outDir, { recursive: true });
  await fs.rm(path.join(outDir, 'quality-stats.json'), { force: true });
  const baseline = readBaseline(repoRoot);
  const python = process.env.QA_PYTHON || findExecutable(['python3', 'python']);

  let glbPath = null;
  let bytes = null;
  let sha256 = null;
  let exportComponent;

  try {
    if (args.glb) {
      glbPath = path.resolve(args.glb);
      bytes = await fs.readFile(glbPath);
      sha256 = createHash('sha256').update(bytes).digest('hex');
      exportComponent = classifyExport({
        bytes: bytes.length,
        sha256,
        source: 'provided',
      });
    } else {
      if (!python) {
        throw new Error('Python not found; the export server needs it (set QA_PYTHON).');
      }
      const result = await exportGlb({
        outDir,
        chromium: process.env.CHROMIUM,
        python,
      });
      glbPath = result.path;
      bytes = await fs.readFile(glbPath);
      sha256 = createHash('sha256').update(bytes).digest('hex');
      exportComponent = classifyExport({
        bytes: bytes.length,
        sha256,
        source: 'tools/glb-harness/export.html',
      });
    }
  } catch (error) {
    exportComponent = classifyExport({
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let repoValidator;
  let khronos;
  let blender;
  if (exportComponent.status === STATUS.PASS) {
    repoValidator = classifyRepoValidator(runRepoValidator(repoRoot, python, glbPath));
    khronos = classifyKhronos(await runKhronos(bytes, glbPath));
    blender = classifyBlender(runBlender(repoRoot, glbPath, args.noBlender));
  } else {
    const skipped = 'Skipped because no valid GLB was produced.';
    repoValidator = classifyRepoValidator({ unavailableReason: skipped });
    khronos = classifyKhronos({ unavailableReason: skipped });
    blender = classifyBlender({ unavailableReason: skipped });
  }

  const qualityBudget = classifyQualityBudget(await readQualityBudget(outDir));
  const goldenEnabled = args.golden ?? !args.glb;
  let goldenRegression;
  if (!goldenEnabled) {
    goldenRegression = {
      status: STATUS.NOT_VERIFIED,
      reason: 'Golden comparison disabled.',
      baselineVersion: null,
      checks: [],
      failures: [],
      notVerified: [],
    };
  } else {
    const goldenBaseline = await readGoldenBaseline(repoRoot);
    if (!goldenBaseline) {
      goldenRegression = {
        status: STATUS.NOT_VERIFIED,
        reason: 'Golden baseline file is missing.',
        baselineVersion: null,
        checks: [],
        failures: [],
        notVerified: [],
      };
    } else {
      goldenRegression = compareGolden(
        {
          glb: bytes ? parseGlbMetrics(bytes) : null,
          budget: qualityBudget.metrics ?? null,
          khronos:
            khronos.status === STATUS.NOT_VERIFIED
              ? null
              : { errors: khronos.errors ?? null, warnings: khronos.warnings ?? null },
          blender: blender.status === STATUS.PASS ? blender.metrics : null,
        },
        goldenBaseline,
      );
    }
  }
  const components = {
    export: exportComponent,
    repoValidator,
    khronos,
    qualityBudget,
    goldenRegression,
    blender,
  };
  const input = glbPath
    ? { path: glbPath, bytes: bytes?.length ?? null, sha256 }
    : null;
  const report = buildReport({
    input,
    components,
    baseline,
    limitations: limitationsFor(components),
  });
  const paths = await writeReports(outDir, report);

  console.log(`Quality harness: ${report.overall.status} (exit ${report.overall.exitCode})`);
  console.log(`GLB: ${input?.path ?? 'not produced'}`);
  console.log(`JSON: ${paths.jsonPath}`);
  console.log(`Markdown: ${paths.markdownPath}`);
  if (report.overall.failed.length > 0) {
    console.log(`Failed components: ${report.overall.failed.join(', ')}`);
  }
  if (report.overall.notVerified.length > 0) {
    console.log(`Not verified: ${report.overall.notVerified.join(', ')}`);
  }

  process.exitCode = report.overall.exitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
