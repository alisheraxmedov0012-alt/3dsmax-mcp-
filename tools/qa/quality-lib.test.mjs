import { describe, expect, it } from 'vitest';
import {
  EXIT_CODES,
  STATUS,
  buildReport,
  classifyBlender,
  classifyExport,
  classifyKhronos,
  classifyQualityBudget,
  classifyRepoValidator,
  countByCode,
  extractBlenderJson,
  overallOf,
  parseRepoValidatorOutput,
  renderMarkdown,
} from './quality-lib.mjs';

const HASH = '8abc9b0d2109647a62451361066f83e1391b48a6fd7b789a0dd89631b698a4e0';

const khronosWarningsOnly = {
  validatorVersion: '2.0.0-dev.3.10',
  issues: {
    numErrors: 0,
    numWarnings: 32,
    numInfos: 32,
    numHints: 0,
    messages: [
      ...Array.from({ length: 32 }, (_, index) => ({
        severity: 1,
        code: 'MESH_PRIMITIVE_GENERATED_TANGENT_SPACE',
        message: 'Material requires a tangent space.',
        pointer: `/meshes/${index}/primitives/0/material`,
      })),
      ...Array.from({ length: 32 }, (_, index) => ({
        severity: 2,
        code: 'UNUSED_OBJECT',
        message: 'This object may be unused.',
        pointer: `/meshes/${index}/primitives/0/attributes/TEXCOORD_0`,
      })),
    ],
  },
  info: { version: '2.0', totalTriangleCount: 768 },
};

const repoPass = {
  verdict: 'PASS',
  checks: [{ check: 'GLB magic', status: 'PASS' }],
  errors: [],
  warnings: [],
};

const blenderPass = {
  ok: true,
  blenderVersion: '4.2.9',
  objects: 77,
  meshes: 67,
  vertices: 1608,
  polygons: 804,
  triangles: 804,
  materials: 10,
  images: 8,
  uvLayers: 67,
  meshesWithoutUv: [],
  missingNormals: [],
  zeroAreaPolygons: 0,
  bboxM: [8.4, 5.08, 2.84],
};

function makeReport(overrides = {}) {
  const components = {
    export: classifyExport({ bytes: 279464, sha256: HASH, source: 'test' }),
    repoValidator: classifyRepoValidator({ raw: repoPass }),
    khronos: classifyKhronos({ raw: khronosWarningsOnly }),
    blender: classifyBlender({ unavailableReason: 'Blender not found (test)' }),
    ...overrides,
  };
  return buildReport({
    input: { path: '/tmp/model-with-room.glb', bytes: 279464, sha256: HASH },
    components,
    generatedAt: '2026-11-06T00:00:00.000Z',
    baseline: { branch: 'test-branch', sha: 'abc123' },
    limitations: ['test limitation'],
  });
}

describe('quality report statuses', () => {
  it('passes when only the optional Blender check is unavailable', () => {
    const report = makeReport();
    expect(report.components.blender.status).toBe(STATUS.NOT_VERIFIED);
    expect(report.overall.status).toBe(STATUS.PASS);
    expect(report.overall.exitCode).toBe(EXIT_CODES.PASS);
    expect(report.overall.notVerified).toContain('blender');
  });

  it('does not claim verification when the mandatory Khronos validator is missing', () => {
    const report = makeReport({
      khronos: classifyKhronos({ unavailableReason: 'gltf-validator is not installed' }),
    });
    expect(report.components.khronos.status).toBe(STATUS.NOT_VERIFIED);
    expect(report.overall.status).toBe(STATUS.NOT_VERIFIED);
    expect(report.overall.exitCode).toBe(EXIT_CODES.NOT_VERIFIED);
    expect(report.overall.missingMandatory).toContain('khronos');
  });

  it('fails on a repository validator FAIL verdict', () => {
    const report = makeReport({
      repoValidator: classifyRepoValidator({
        raw: { verdict: 'FAIL', checks: [], errors: ['GLB magic'], warnings: [] },
      }),
    });
    expect(report.components.repoValidator.status).toBe(STATUS.FAIL);
    expect(report.overall.status).toBe(STATUS.FAIL);
    expect(report.overall.exitCode).toBe(EXIT_CODES.FAIL);
  });

  it('fails on Khronos errors even when other checks pass', () => {
    const report = makeReport({
      khronos: classifyKhronos({
        raw: {
          validatorVersion: '2.0.0-dev.3.10',
          issues: {
            numErrors: 1,
            numWarnings: 0,
            numInfos: 0,
            numHints: 0,
            messages: [{ severity: 0, code: 'INVALID_JSON', message: 'Invalid JSON.' }],
          },
        },
      }),
    });
    expect(report.components.khronos.status).toBe(STATUS.FAIL);
    expect(report.components.khronos.errors).toBe(1);
    expect(report.overall.status).toBe(STATUS.FAIL);
    expect(report.overall.exitCode).toBe(EXIT_CODES.FAIL);
  });

  it('treats warning-only Khronos results as PASS and keeps every count', () => {
    const report = makeReport();
    expect(report.components.khronos.status).toBe(STATUS.PASS);
    expect(report.components.khronos.errors).toBe(0);
    expect(report.components.khronos.warnings).toBe(32);
    expect(report.components.khronos.infos).toBe(32);
    expect(report.components.khronos.issueCodes).toEqual({
      MESH_PRIMITIVE_GENERATED_TANGENT_SPACE: 32,
      UNUSED_OBJECT: 32,
    });
    expect(report.overall.status).toBe(STATUS.PASS);
    expect(report.overall.exitCode).toBe(EXIT_CODES.PASS);
  });

  it('fails when Blender is installed but the import fails', () => {
    const report = makeReport({
      blender: classifyBlender({ raw: { ok: false, error: 'ImportError: bad file' } }),
    });
    expect(report.components.blender.status).toBe(STATUS.FAIL);
    expect(report.overall.status).toBe(STATUS.FAIL);
    expect(report.overall.exitCode).toBe(EXIT_CODES.FAIL);
  });

  it('returns the pass exit code for a fully verified run', () => {
    const report = makeReport({ blender: classifyBlender({ raw: blenderPass }) });
    expect(report.components.blender.status).toBe(STATUS.PASS);
    expect(report.overall.status).toBe(STATUS.PASS);
    expect(report.overall.exitCode).toBe(EXIT_CODES.PASS);
  });

  it('uses explicit exit codes for pass, fail and not-verified states', () => {
    const pass = overallOf({
      export: { status: STATUS.PASS },
      repoValidator: { status: STATUS.PASS },
      khronos: { status: STATUS.PASS },
      blender: { status: STATUS.NOT_VERIFIED },
    });
    const fail = overallOf({
      export: { status: STATUS.PASS },
      repoValidator: { status: STATUS.FAIL },
      khronos: { status: STATUS.PASS },
      blender: { status: STATUS.NOT_VERIFIED },
    });
    const unverified = overallOf({
      export: { status: STATUS.PASS },
      repoValidator: { status: STATUS.NOT_VERIFIED },
      khronos: { status: STATUS.PASS },
      blender: { status: STATUS.NOT_VERIFIED },
    });
    expect(pass).toMatchObject({ status: STATUS.PASS, exitCode: 0 });
    expect(fail).toMatchObject({ status: STATUS.FAIL, exitCode: 1 });
    expect(unverified).toMatchObject({ status: STATUS.NOT_VERIFIED, exitCode: 2 });
  });
});

describe('quality report serialization', () => {
  it('round-trips through JSON with the required report fields', () => {
    const report = makeReport({ blender: classifyBlender({ raw: blenderPass }) });
    const parsed = JSON.parse(JSON.stringify(report, null, 2));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.tool).toBe('3d-studio-ai-quality-harness');
    expect(parsed.overall.status).toBe(STATUS.PASS);
    expect(parsed.components.khronos.warnings).toBe(32);
    expect(parsed.components.blender.metrics.meshes).toBe(67);
  });

  it('renders a Markdown summary with statuses and Khronos codes', () => {
    const markdown = renderMarkdown(makeReport());
    expect(markdown).toContain('# 3D Quality Report');
    expect(markdown).toContain('| Khronos validator | PASS |');
    expect(markdown).toContain('| MESH_PRIMITIVE_GENERATED_TANGENT_SPACE | 32 |');
    expect(markdown).toContain('| UNUSED_OBJECT | 32 |');
    expect(markdown).toContain('**NOT VERIFIED** — Blender not found (test)');
    expect(markdown).toContain('## Limitations');
  });

  it('renders Blender metrics without inventing values', () => {
    const markdown = renderMarkdown(makeReport({ blender: classifyBlender({ raw: blenderPass }) }));
    expect(markdown).toContain('| Meshes | 67 |');
    expect(markdown).toContain('| Triangles | 804 |');
    expect(markdown).toContain('| Materials | 10 |');
  });

  it('renders validator tool failures without undefined counts', () => {
    const report = makeReport({
      repoValidator: classifyRepoValidator({ error: 'repository validator crashed' }),
      khronos: classifyKhronos({ error: 'Khronos validator crashed' }),
    });
    const markdown = renderMarkdown(report);
    expect(report.overall.status).toBe(STATUS.FAIL);
    expect(markdown).toContain('repository validator crashed');
    expect(markdown).toContain('Khronos validator crashed');
    expect(markdown).not.toContain('undefined');
  });
});

describe('validator output helpers', () => {
  it('counts issue codes deterministically', () => {
    expect(
      countByCode([
        { code: 'A' },
        { code: 'B' },
        { code: 'A' },
        { code: 'A' },
      ]),
    ).toEqual({ A: 3, B: 1 });
  });

  it('extracts the Blender JSON line from surrounding log output', () => {
    const stdout = [
      'Blender 4.2.9 LTS',
      'Warning: unrelated',
      'QA_BLENDER_JSON:{"ok":true,"meshes":67,"triangles":804}',
      'Blender quit',
    ].join('\n');
    expect(extractBlenderJson(stdout)).toEqual({ ok: true, meshes: 67, triangles: 804 });
    expect(extractBlenderJson('no marker here')).toBeNull();
    expect(extractBlenderJson('QA_BLENDER_JSON:{bad json}')).toBeNull();
  });

  it('parses the repository validator JSON wrapper and rejects garbage', () => {
    const report = { verdict: 'FAIL', checks: [], errors: ['GLB magic'], warnings: [] };
    const stdout = JSON.stringify({ '/tmp/model.glb': report });
    expect(parseRepoValidatorOutput(stdout, '/tmp/model.glb')).toEqual(report);
    expect(parseRepoValidatorOutput('not json', '/tmp/model.glb')).toBeNull();
    expect(parseRepoValidatorOutput('{}', '/tmp/model.glb')).toBeNull();
  });
});

describe('quality budget harness integration', () => {
  const budget = {
    status: 'WARNING',
    profile: { id: 'standard', label: 'Standart', budgetSeverity: 'WARNING' },
    limits: {},
    checks: [
      {
        id: 'geometry.triangles',
        label: 'Uchburchaklar soni',
        category: 'geometry',
        status: 'WARNING',
        actual: 10,
        limit: 1,
        message: 'Uchburchaklar limitdan oshdi.',
        remediation: 'Detallarni soddalashtiring.',
      },
    ],
    summary: { pass: 20, warning: 1, block: 0, total: 21 },
    metrics: { triangles: 10 },
    message: 'Eksport mumkin, lekin 1 ta sifat ogohlantirishi bor.',
    estimated: true,
  };

  it('maps budget PASS/WARNING to passing and BLOCK to failing', () => {
    const warning = classifyQualityBudget({ raw: budget });
    expect(warning.status).toBe(STATUS.PASS);
    expect(warning.budgetStatus).toBe('WARNING');
    expect(warning.summary.warning).toBe(1);

    const blocking = classifyQualityBudget({ raw: { ...budget, status: 'BLOCK' } });
    expect(blocking.status).toBe(STATUS.FAIL);
    expect(blocking.budgetStatus).toBe('BLOCK');
  });

  it('reports a missing budget result as NOT VERIFIED without failing other checks', () => {
    const report = makeReport({
      qualityBudget: classifyQualityBudget({ unavailableReason: 'no quality-stats.json' }),
    });
    expect(report.components.qualityBudget.status).toBe(STATUS.NOT_VERIFIED);
    expect(report.overall.status).toBe(STATUS.PASS);
    expect(report.overall.notVerified).toContain('qualityBudget');
  });

  it('fails the report when the budget blocks', () => {
    const report = makeReport({
      qualityBudget: classifyQualityBudget({ raw: { ...budget, status: 'BLOCK' } }),
    });
    expect(report.components.qualityBudget.status).toBe(STATUS.FAIL);
    expect(report.overall.status).toBe(STATUS.FAIL);
    expect(report.overall.exitCode).toBe(EXIT_CODES.FAIL);
  });

  it('renders profile, limits result and checks in Markdown', () => {
    const report = makeReport({ qualityBudget: classifyQualityBudget({ raw: budget }) });
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('## Quality budget');
    expect(markdown).toContain('profile `Standart`');
    expect(markdown).toContain('| Uchburchaklar soni | WARNING | 10 | 1 |');
    expect(markdown).toContain('File-size check used an estimate');
  });

  it('includes the budget result in the JSON report', () => {
    const report = makeReport({ qualityBudget: classifyQualityBudget({ raw: budget }) });
    const parsed = JSON.parse(JSON.stringify(report));
    expect(parsed.components.qualityBudget.budgetStatus).toBe('WARNING');
    expect(parsed.components.qualityBudget.checks[0].id).toBe('geometry.triangles');
  });
});
