/**
 * Pure reporting logic for the local 3D quality harness.
 *
 * The harness itself owns process execution; this module only turns validator
 * output into a stable report. Keeping it free of I/O lets the tests cover the
 * pass/fail/not-verified rules without starting Chromium, Blender or Python.
 */

export const STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_VERIFIED: 'NOT VERIFIED',
});

export const EXIT_CODES = Object.freeze({
  PASS: 0,
  FAIL: 1,
  NOT_VERIFIED: 2,
});

const SEVERITY_LABELS = ['Error', 'Warning', 'Info', 'Hint'];

function severityLabel(value) {
  return SEVERITY_LABELS[value] ?? `Severity ${String(value)}`;
}

/** Count validator issue messages by their stable issue code. */
export function countByCode(messages) {
  const counts = {};
  for (const message of messages ?? []) {
    const code = typeof message.code === 'string' ? message.code : 'UNKNOWN';
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

function failedKhronos(reason) {
  return {
    status: STATUS.FAIL,
    reason,
    validatorVersion: null,
    errors: 0,
    warnings: 0,
    infos: 0,
    hints: 0,
    issueCodes: {},
    messages: [],
    info: null,
  };
}

export function classifyKhronos({ raw, unavailableReason, error } = {}) {
  if (error) {
    return failedKhronos(error);
  }
  if (!raw) {
    return {
      status: STATUS.NOT_VERIFIED,
      reason: unavailableReason ?? 'Khronos glTF Validator is unavailable.',
    };
  }

  const issues = raw.issues;
  if (!issues || typeof issues !== 'object') {
    return failedKhronos('Khronos report has no issues block.');
  }

  const messages = Array.isArray(issues.messages) ? issues.messages : [];
  const errors =
    typeof issues.numErrors === 'number'
      ? issues.numErrors
      : messages.filter((message) => message.severity === 0).length;
  const warnings = typeof issues.numWarnings === 'number' ? issues.numWarnings : 0;
  const infos = typeof issues.numInfos === 'number' ? issues.numInfos : 0;
  const hints = typeof issues.numHints === 'number' ? issues.numHints : 0;

  return {
    status: errors > 0 ? STATUS.FAIL : STATUS.PASS,
    validatorVersion: raw.validatorVersion ?? null,
    errors,
    warnings,
    infos,
    hints,
    issueCodes: countByCode(messages),
    messages,
    info: raw.info ?? null,
  };
}

export function classifyRepoValidator({ raw, unavailableReason, error } = {}) {
  if (error) {
    return {
      status: STATUS.FAIL,
      verdict: null,
      reason: error,
      checks: [],
      errors: [],
      warnings: [],
    };
  }
  if (!raw) {
    return {
      status: STATUS.NOT_VERIFIED,
      reason: unavailableReason ?? 'Repository GLB validator is unavailable.',
    };
  }

  const verdict = raw.verdict;
  if (verdict !== 'PASS' && verdict !== 'FAIL') {
    return {
      status: STATUS.FAIL,
      verdict: verdict ?? null,
      reason: `Unexpected repository validator verdict: ${String(verdict)}.`,
      checks: [],
      errors: [],
      warnings: [],
    };
  }

  return {
    status: verdict === 'PASS' ? STATUS.PASS : STATUS.FAIL,
    verdict,
    checks: Array.isArray(raw.checks) ? raw.checks : [],
    errors: Array.isArray(raw.errors) ? raw.errors : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
  };
}

export function classifyExport({ bytes, sha256, source, error } = {}) {
  if (error) {
    return { status: STATUS.FAIL, reason: error };
  }
  if (!Number.isInteger(bytes) || bytes <= 0) {
    return { status: STATUS.FAIL, reason: 'GLB is empty or missing.' };
  }
  return {
    status: STATUS.PASS,
    source: source ?? 'unknown',
    bytes,
    sha256: sha256 ?? null,
  };
}

export function classifyBlender({ raw, unavailableReason, error, logWarnings } = {}) {
  const warnings = Array.isArray(logWarnings) ? logWarnings : [];

  if (error) {
    return {
      status: STATUS.FAIL,
      reason: error,
      version: raw?.blenderVersion ?? null,
      metrics: raw ?? null,
      logWarnings: warnings,
    };
  }
  if (!raw) {
    return {
      status: STATUS.NOT_VERIFIED,
      reason: unavailableReason ?? 'Blender is unavailable.',
      version: null,
      metrics: null,
      logWarnings: warnings,
    };
  }
  if (raw.ok !== true) {
    return {
      status: STATUS.FAIL,
      reason: raw.error ?? 'Blender import failed.',
      version: raw.blenderVersion ?? null,
      metrics: raw,
      logWarnings: warnings,
    };
  }

  return {
    status: STATUS.PASS,
    reason: null,
    version: raw.blenderVersion ?? null,
    metrics: raw,
    logWarnings: warnings,
  };
}

/** Overall status and process exit code. Blender is optional; the other three are mandatory. */
export function overallOf(components) {
  const names = Object.keys(components ?? {});
  const failed = names.filter((name) => components[name]?.status === STATUS.FAIL);
  const notVerified = names.filter((name) => components[name]?.status === STATUS.NOT_VERIFIED);
  const mandatory = ['export', 'repoValidator', 'khronos'];
  const missingMandatory = mandatory.filter(
    (name) => components[name]?.status === STATUS.NOT_VERIFIED,
  );

  if (failed.length > 0) {
    return {
      status: STATUS.FAIL,
      exitCode: EXIT_CODES.FAIL,
      failed,
      notVerified,
      missingMandatory,
    };
  }
  if (missingMandatory.length > 0) {
    return {
      status: STATUS.NOT_VERIFIED,
      exitCode: EXIT_CODES.NOT_VERIFIED,
      failed: [],
      notVerified,
      missingMandatory,
    };
  }
  return {
    status: STATUS.PASS,
    exitCode: EXIT_CODES.PASS,
    failed: [],
    notVerified,
    missingMandatory: [],
  };
}

export function buildReport({
  input = null,
  components,
  generatedAt = new Date().toISOString(),
  baseline = null,
  limitations = [],
} = {}) {
  return {
    schemaVersion: 1,
    tool: '3d-studio-ai-quality-harness',
    generatedAt,
    baseline,
    input,
    components,
    overall: overallOf(components),
    limitations,
  };
}

function mdCell(value) {
  return String(value ?? '')
    .replace(/\|/gu, '\\|')
    .replace(/\r?\n/gu, ' ')
    .trim();
}

function componentDetail(name, component) {
  if (!component) {
    return 'No data.';
  }
  if (component.status === STATUS.NOT_VERIFIED || component.reason) {
    return component.reason ?? component.status;
  }
  switch (name) {
    case 'export':
      return `${component.bytes} bytes, sha256 ${component.sha256 ?? 'unknown'}`;
    case 'repoValidator':
      return `verdict ${component.verdict}; ${component.checks?.length ?? 0} checks; ${component.errors?.length ?? 0} errors`;
    case 'khronos':
      return `${component.errors} errors, ${component.warnings} warnings, ${component.infos} infos`;
    case 'blender':
      return component.metrics
        ? `${component.metrics.meshes} meshes, ${component.metrics.triangles} triangles, ${component.metrics.materials} materials`
        : 'Import passed.';
    default:
      return 'Passed.';
  }
}

function componentLabel(name) {
  switch (name) {
    case 'export':
      return 'GLB input';
    case 'repoValidator':
      return 'Repository validator';
    case 'khronos':
      return 'Khronos validator';
    case 'blender':
      return 'Blender import';
    default:
      return name;
  }
}

function listBlock(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return ['- None.'];
  }
  return items.map((item) => `- ${item}`);
}

export function renderMarkdown(report) {
  const lines = [
    '# 3D Quality Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Overall: **${report.overall.status}** (exit ${report.overall.exitCode})`,
  ];

  if (report.baseline) {
    lines.push(
      `- Baseline: \`${report.baseline.branch ?? 'unknown'}\` @ \`${report.baseline.sha ?? 'unknown'}\``,
    );
  }
  if (report.input) {
    lines.push(
      `- Input: \`${report.input.path ?? 'unknown'}\` (${report.input.bytes ?? 0} bytes, sha256 \`${report.input.sha256 ?? 'unknown'}\`)`,
    );
  }

  lines.push('', '## Component summary', '', '| Component | Status | Detail |', '| --- | --- | --- |');
  for (const [name, component] of Object.entries(report.components ?? {})) {
    lines.push(
      `| ${mdCell(componentLabel(name))} | ${mdCell(component?.status)} | ${mdCell(componentDetail(name, component))} |`,
    );
  }

  const repo = report.components?.repoValidator;
  lines.push('', '## Repository GLB validator', '');
  if (!repo) {
    lines.push('No data.');
  } else if (repo.status === STATUS.NOT_VERIFIED) {
    lines.push(`**${STATUS.NOT_VERIFIED}** — ${repo.reason ?? 'Validator unavailable.'}`);
  } else {
    lines.push(`**${repo.status}** — verdict \`${repo.verdict ?? 'unknown'}\`.`);
    if (repo.reason) {
      lines.push('', repo.reason);
    }
    lines.push('', '### Errors', '', ...listBlock(repo.errors));
    lines.push('', '### Warnings', '', ...listBlock(repo.warnings));
  }

  const khronos = report.components?.khronos;
  lines.push('', '## Khronos glTF Validator', '');
  if (!khronos) {
    lines.push('No data.');
  } else if (khronos.status === STATUS.NOT_VERIFIED) {
    lines.push(`**${STATUS.NOT_VERIFIED}** — ${khronos.reason ?? 'Validator unavailable.'}`);
  } else {
    lines.push(`**${khronos.status}** — validator \`${khronos.validatorVersion ?? 'unknown'}\`.`);
    if (khronos.reason) {
      lines.push('', khronos.reason);
    }
    lines.push(
      '',
      `- Errors: ${khronos.errors ?? 0}`,
      `- Warnings: ${khronos.warnings ?? 0}`,
      `- Infos: ${khronos.infos ?? 0}`,
      `- Hints: ${khronos.hints ?? 0}`,
    );

    const codes = Object.entries(khronos.issueCodes ?? {}).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );
    lines.push('', '### Issue codes', '', '| Code | Count |', '| --- | --- |');
    if (codes.length === 0) {
      lines.push('| None | 0 |');
    } else {
      for (const [code, count] of codes) {
        lines.push(`| ${mdCell(code)} | ${count} |`);
      }
    }

    const messages = (khronos.messages ?? []).slice(0, 20);
    if (messages.length > 0) {
      lines.push(
        '',
        '### First messages',
        '',
        '| Severity | Code | Pointer | Message |',
        '| --- | --- | --- | --- |',
      );
      for (const message of messages) {
        lines.push(
          `| ${mdCell(severityLabel(message.severity))} | ${mdCell(message.code)} | ${mdCell(message.pointer ?? '')} | ${mdCell(message.message ?? '')} |`,
        );
      }
    }
  }

  const blender = report.components?.blender;
  lines.push('', '## Blender import', '');
  if (!blender) {
    lines.push('No data.');
  } else if (blender.status === STATUS.NOT_VERIFIED) {
    lines.push(`**${STATUS.NOT_VERIFIED}** — ${blender.reason ?? 'Blender unavailable.'}`);
  } else if (blender.status === STATUS.FAIL) {
    lines.push(`**${STATUS.FAIL}** — ${blender.reason ?? 'Import failed.'}`);
  } else {
    const metrics = blender.metrics ?? {};
    lines.push(
      `**${STATUS.PASS}** — Blender \`${blender.version ?? metrics.blenderVersion ?? 'unknown'}\`.`,
    );
    lines.push(
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Objects | ${metrics.objects ?? 0} |`,
      `| Meshes | ${metrics.meshes ?? 0} |`,
      `| Vertices | ${metrics.vertices ?? 0} |`,
      `| Polygons | ${metrics.polygons ?? 0} |`,
      `| Triangles | ${metrics.triangles ?? 0} |`,
      `| Materials | ${metrics.materials ?? 0} |`,
      `| Images | ${metrics.images ?? 0} |`,
      `| UV layers | ${metrics.uvLayers ?? 0} |`,
      `| Meshes without UV | ${metrics.meshesWithoutUv?.length ?? 0} |`,
      `| Missing normals | ${metrics.missingNormals?.length ?? 0} |`,
      `| Zero-area polygons | ${metrics.zeroAreaPolygons ?? 0} |`,
      `| Bounding box (m) | ${(metrics.bboxM ?? []).join(' × ')} |`,
    );
  }

  if (Array.isArray(blender?.logWarnings) && blender.logWarnings.length > 0) {
    lines.push('', '### Import log warnings', '', ...listBlock(blender.logWarnings));
  }

  lines.push('', '## Limitations', '', ...listBlock(report.limitations));
  lines.push('');
  return lines.join('\n');
}

/** Extract the single JSON document printed by blender-import.py. */
export function extractBlenderJson(stdout) {
  const marker = 'QA_BLENDER_JSON:';
  const index = String(stdout ?? '').lastIndexOf(marker);
  if (index === -1) {
    return null;
  }
  const line = String(stdout).slice(index + marker.length).split(/\r?\n/u, 1)[0].trim();
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Parse the repository validator's one-file JSON wrapper. */
export function parseRepoValidatorOutput(stdout, glbPath) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const direct = glbPath ? parsed[glbPath] : undefined;
  const report = direct ?? Object.values(parsed)[0];
  if (!report || typeof report !== 'object' || typeof report.verdict !== 'string') {
    return null;
  }
  return report;
}
