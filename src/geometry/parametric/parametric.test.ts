import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarizeGlb } from '../../export/glbSummary';
import { exportGroupToGlb, exportSceneToGlb } from '../../export/sceneExport';
import { parseSceneJson, serializeSceneToJson } from '../../export/sceneJson';
import { buildSceneObject } from '../../scene/buildSceneObject';
import { createParametricSceneObject } from '../../scene/parametricObject';
import { createDefaultSettings } from '../../scene/sceneSettings';
import { validateSceneData } from '../../scene/sceneValidation';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  createUniversalSceneObject,
  isFurnitureSceneObject,
  type SceneData,
} from '../../scene/types';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { furnitureDefinitions } from '../universal/registry';
import type { SpecParseResult } from '../universal/types';
import { buildParametricPlan } from './build';
import { createParametricPlan } from './plan';
import {
  FURNITURE_DOMAIN,
  ParametricPlanError,
  type ParametricDefinition,
  type ParametricPlanDraft,
  type RegisteredParametricDefinition,
} from './types';
import {
  ParametricDefinitionRegistry,
  listParametricDefinitions,
  parametricDefinitions,
  requireParametricDefinition,
} from './registry';

class TestFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

beforeAll(() => {
  (globalThis as unknown as { FileReader: typeof TestFileReader }).FileReader = TestFileReader;
});

afterAll(() => {
  delete (globalThis as unknown as { FileReader?: typeof TestFileReader }).FileReader;
});

interface TestPedestalSpec {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

/** A deliberately non-furniture, test-only definition. Production code never registers it. */
const TEST_DEFINITION_ID = 'test.pedestal';
const TEST_DOMAIN = 'test-object';

function parseTestSpec(input: unknown): SpecParseResult<TestPedestalSpec> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['Pedestal spec: obyekt bo‘lishi kerak.'] };
  }
  const record = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(record)) {
    if (key !== 'width' && key !== 'height' && key !== 'depth') {
      errors.push(`Pedestal spec.${key}: noma'lum maydon.`);
    }
  }
  const read = (key: keyof TestPedestalSpec): number => {
    const raw = record[key];
    if (raw === undefined) {
      return { width: 40, height: 70, depth: 40 }[key];
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > 200) {
      errors.push(`${key}: 0 dan katta va 200 dan kichik chekli son bo'lishi kerak.`);
      return 0;
    }
    return raw;
  };
  const spec: TestPedestalSpec = {
    width: read('width'),
    height: read('height'),
    depth: read('depth'),
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, spec };
}

function solveTestSpec(spec: TestPedestalSpec): ParametricPlanDraft {
  const finialRadius = Math.min(spec.width, spec.depth) * 0.1;
  const finialHeight = 8;
  return {
    parts: [
      {
        id: 'test-pedestal-body',
        type: 'panel',
        role: 'panel',
        dimensions: {
          width: spec.width,
          height: spec.height,
          depth: spec.depth,
        },
        geometry: {
          kind: 'box',
          width: spec.width,
          height: spec.height,
          depth: spec.depth,
        },
        position: [0, spec.height / 2, 0],
        rotation: [0, 0, 0],
        materialSlot: 'body',
      },
      {
        id: 'test-pedestal-finial',
        type: 'handle',
        role: 'handle',
        dimensions: {
          width: finialRadius * 2,
          height: finialHeight,
          depth: finialRadius * 2,
        },
        geometry: {
          kind: 'cylinder',
          radiusTop: finialRadius,
          radiusBottom: finialRadius,
          height: finialHeight,
          radialSegments: 16,
        },
        position: [0, spec.height + finialHeight / 2, 0],
        rotation: [0, 0, 0],
        materialSlot: 'body',
      },
    ],
    connections: [],
  };
}

const testDefinition: ParametricDefinition<TestPedestalSpec> = {
  id: TEST_DEFINITION_ID,
  version: 1,
  domain: TEST_DOMAIN,
  family: 'pedestal',
  label: 'Test pedestal',
  fields: [
    { key: 'width', label: 'Kenglik (sm)', kind: 'number' },
    { key: 'height', label: 'Balandlik (sm)', kind: 'number' },
    { key: 'depth', label: 'Chuqurlik (sm)', kind: 'number' },
  ],
  defaults: { width: 40, height: 70, depth: 40 },
  slots: [
    {
      id: 'body',
      label: 'Korpus',
      color: '#8a8f98',
      materialId: 'metal-satin-black',
      groupName: 'test-pedestal-group',
      materialName: 'Test_Pedestal_Material',
    },
  ],
  limits: {
    maxParts: 8,
    maxPartVertices: 10_000,
    maxPartTriangles: 20_000,
    maxTotalVertices: 40_000,
  },
  groupName: 'test-pedestal-assembly',
  parseSpec: parseTestSpec,
  solve: solveTestSpec,
};

beforeAll(() => {
  if (!parametricDefinitions.has(TEST_DEFINITION_ID)) {
    parametricDefinitions.register(testDefinition);
  }
});

function testScene(objects: SceneData['objects']): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects,
    settings: createDefaultSettings(),
  };
}

function meshNames(group: THREE.Object3D): string[] {
  const names: string[] = [];
  group.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      names.push(node.name);
    }
  });
  return names;
}

describe('category-neutral parametric contract', () => {
  it('exposes all 13 built-in furniture definitions through the adapter', () => {
    const furnitureIds = furnitureDefinitions.list().map((definition) => definition.id);
    expect(furnitureIds).toHaveLength(13);

    const genericIds = listParametricDefinitions()
      .map((definition) => definition.id)
      .filter((id) => id !== TEST_DEFINITION_ID);
    expect([...genericIds].sort()).toEqual([...furnitureIds].sort());

    for (const id of furnitureIds) {
      const adapted: RegisteredParametricDefinition = requireParametricDefinition(id);
      expect(adapted.domain).toBe(FURNITURE_DOMAIN);
      expect(adapted.family).toBe(furnitureDefinitions.require(id).family);
    }
  });

  it('solves a furniture definition through the generic plan pipeline unchanged', () => {
    const plan = createParametricPlan('desk.computer', DEFAULT_DESK_SPEC);
    expect(plan.domain).toBe(FURNITURE_DOMAIN);
    expect(plan.family).toBe('table');
    expect(plan.parts).toHaveLength(24);

    const built = buildParametricPlan(plan);
    try {
      expect(meshNames(built.group)).toHaveLength(24);
      expect(built.materialSlots).toEqual(['tabletop', 'structure', 'drawer', 'hardware']);
    } finally {
      built.dispose();
    }
  });

  it('registers a non-furniture definition and builds the same kernel geometry', () => {
    const plan = createParametricPlan(TEST_DEFINITION_ID, {
      width: 50,
      height: 90,
      depth: 30,
    });
    expect(plan.domain).toBe(TEST_DOMAIN);
    expect(plan.family).toBe('pedestal');
    expect(plan.parts).toHaveLength(2);

    const built = buildParametricPlan(plan);
    try {
      expect(built.group.name).toBe('test-pedestal-assembly');
      expect(meshNames(built.group)).toEqual([
        'test-pedestal-body',
        'test-pedestal-finial',
      ]);
      built.group.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(built.group).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(50, 5);
      expect(size.y).toBeCloseTo(98, 5);
      expect(size.z).toBeCloseTo(30, 5);
    } finally {
      built.dispose();
    }
  });

  it('rejects invalid generic input and unknown definitions', () => {
    expect(() => createParametricPlan(TEST_DEFINITION_ID, { width: -1 })).toThrowError(
      expect.objectContaining({ code: 'invalid_spec' }),
    );
    expect(() => createParametricPlan('test.missing', {})).toThrowError(
      expect.objectContaining({ code: 'unknown_definition' }),
    );
  });

  it('rejects malformed registrations and furniture id collisions', () => {
    const registry = new ParametricDefinitionRegistry();
    expect(() =>
      registry.register({ ...testDefinition, id: 'desk.computer' }),
    ).toThrowError(expect.objectContaining({ code: 'duplicate_definition' }));
    expect(() =>
      registry.register({ ...testDefinition, id: 'test.badDomain', domain: 'Bad Domain' }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_definition' }));
    expect(() =>
      registry.register({
        ...testDefinition,
        id: 'test.badFamily',
        domain: FURNITURE_DOMAIN,
        family: 'pedestal',
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_definition' }));
  });

  it('creates a generic scene object without turning it into furniture', () => {
    const object = createParametricSceneObject(TEST_DEFINITION_ID, 'generic-1', {
      width: 45,
      height: 80,
      depth: 35,
    });
    expect(object.type).toBe('table');
    expect(object.domain).toBe(TEST_DOMAIN);
    expect(object.definitionId).toBe(TEST_DEFINITION_ID);
    expect(object.spec).toEqual({ width: 45, height: 80, depth: 35 });
    expect(isFurnitureSceneObject(object)).toBe(false);
  });

  it('delegates a furniture definition to the existing universal factory', () => {
    const object = createParametricSceneObject(
      'desk.computer',
      'desk-generic-path',
      DEFAULT_DESK_SPEC,
    );
    expect(object.type).toBe('table');
    expect(object.domain).toBeUndefined();
    expect(object.definitionId).toBe('desk.computer');
    expect(object.spec).toEqual(DEFAULT_DESK_SPEC);
    expect(isFurnitureSceneObject(object)).toBe(true);
  });

  it('builds a generic scene object through buildSceneObject', () => {
    const object = createParametricSceneObject(TEST_DEFINITION_ID, 'generic-1');
    const built = buildSceneObject(object);
    try {
      expect(meshNames(built.group)).toEqual([
        'test-pedestal-body',
        'test-pedestal-finial',
      ]);
      expect(built.group.userData.definitionId).toBe(TEST_DEFINITION_ID);
    } finally {
      built.dispose();
    }
  });

  it('exports a generic plan and a generic scene through the existing GLB pipeline', async () => {
    const plan = createParametricPlan(TEST_DEFINITION_ID, {});
    const built = buildParametricPlan(plan);
    try {
      const groupGlb = await exportGroupToGlb(built.group);
      const groupSummary = summarizeGlb(groupGlb);
      expect(groupSummary.ok).toBe(true);
      if (groupSummary.ok) {
        expect(groupSummary.summary.meshes).toBe(2);
        expect(groupSummary.summary.triangles).toBeGreaterThan(0);
        expect(groupSummary.summary.materials).toContain('Test_Pedestal_Material');
      }
    } finally {
      built.dispose();
    }

    const scene = testScene([createParametricSceneObject(TEST_DEFINITION_ID, 'generic-1')]);
    const sceneGlb = await exportSceneToGlb(scene, {
      includeRoom: false,
      onlyObjectId: 'generic-1',
    });
    const sceneSummary = summarizeGlb(sceneGlb);
    expect(sceneSummary.ok).toBe(true);
    if (sceneSummary.ok) {
      expect(sceneSummary.summary.meshes).toBe(2);
      expect(sceneSummary.summary.triangles).toBeGreaterThan(0);
    }
  });

  it('persists and reloads a generic object, then rebuilds it', () => {
    const object = createParametricSceneObject(TEST_DEFINITION_ID, 'generic-1');
    const scene = testScene([object]);
    const json = serializeSceneToJson(
      scene,
      { name: 'Generic', furnitureType: null, units: 'cm' },
      '2026-01-01T00:00:00.000Z',
    );

    const reloaded = parseSceneJson(json);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }
    expect(reloaded.droppedObjects).toBe(0);
    const [stored] = reloaded.scene.objects;
    expect(stored.definitionId).toBe(TEST_DEFINITION_ID);
    expect(stored.domain).toBe(TEST_DOMAIN);
    expect(stored.spec).toEqual(object.spec);

    const built = buildSceneObject(stored);
    try {
      expect(meshNames(built.group)).toHaveLength(2);
    } finally {
      built.dispose();
    }
  });

  it('keeps legacy and furniture scene JSON shape unchanged', () => {
    const scene = testScene([
      createFurnitureSceneObject('table', 'legacy-1'),
      createUniversalSceneObject('desk.computer', 'desk-1'),
    ]);
    const json = serializeSceneToJson(
      scene,
      { name: 'Legacy', furnitureType: 'table', units: 'cm' },
      '2026-01-01T00:00:00.000Z',
    );

    expect(json).not.toContain('"domain"');
    expect(JSON.parse(json).scene.objects).toEqual(scene.objects);

    const reloaded = parseSceneJson(json);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.scene.objects).toHaveLength(2);
      expect(reloaded.scene.objects.every((entry) => entry.domain === undefined)).toBe(true);
    }
  });

  it('rejects a stored generic object whose definition disappeared', () => {
    const result = validateSceneData(
      testScene([
        {
          ...createFurnitureSceneObject('table', 'orphan-1'),
          definitionId: 'test.removed',
          spec: { width: 40 },
          domain: TEST_DOMAIN,
        },
      ]),
    );
    expect(result.scene?.objects).toHaveLength(0);
    expect(result.droppedObjects).toBe(1);
  });

  it('exposes a typed error for invalid generic scenarios', () => {
    expect(new ParametricPlanError('invalid_spec', 'x')).toMatchObject({
      name: 'ParametricPlanError',
      code: 'invalid_spec',
    });
  });
});
