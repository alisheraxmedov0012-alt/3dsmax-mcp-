import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getProceduralState } from '../../materials/buildMaterial';
import { getMaterialPreset } from '../../materials/presets';
import { detectMirroredUv, UV_TILE_CM } from '../../materials/uv';
import { createDefaultSettings } from '../../scene/sceneSettings';
import { parseSceneJson, serializeSceneToJson } from '../../export/sceneJson';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../../scene/types';
import { buildRoomInstance, createRoomInstance } from '../../scene/roomInstance';
import { buildPlanWithDefinition } from '../universal/build';
import { createRoomPlan } from './registry';
import { resolveRoomMaterials, resolveRoomSlotTileCm } from './roomMaterials';
import { DEFAULT_ROOM_SPEC, parseRoomSpec } from './roomSpec';
import {
  ROOM_SLOTS,
  ROOM_STANDARD_DEFINITION_ID,
  roomStandardDefinition,
  solveRoomParts,
} from './roomDefinition';
import type { RoomOpeningSpec, RoomPlan, RoomSpec } from './types';

const EXPORT_METADATA = { name: 'Rooms', furnitureType: null, units: 'cm' as const };
const EXPORT_TIME = '2026-01-01T00:00:00.000Z';

function specWith(overrides: Partial<RoomSpec>): RoomSpec {
  const parsed = parseRoomSpec({ ...DEFAULT_ROOM_SPEC, ...overrides });
  if (!parsed.ok) {
    throw new Error(parsed.errors.join(' '));
  }
  return parsed.spec;
}

function planFor(overrides: Partial<RoomSpec> = {}): RoomPlan {
  return createRoomPlan(ROOM_STANDARD_DEFINITION_ID, { ...DEFAULT_ROOM_SPEC, ...overrides });
}

function buildPlan(plan: RoomPlan) {
  const materials = resolveRoomMaterials(ROOM_SLOTS, plan.spec);
  return buildPlanWithDefinition(plan.parametric, roomStandardDefinition.parametric, {
    ...(Object.keys(materials.overrides).length > 0
      ? { materialOverrides: materials.overrides }
      : {}),
    uvTileOverrides: materials.tiles,
  });
}

function meshes(group: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      found.push(object);
    }
  });
  return found;
}

function meshNamed(group: THREE.Object3D, name: string): THREE.Mesh {
  const mesh = meshes(group).find((entry) => entry.name === name);
  if (!mesh) {
    throw new Error(`Mesh "${name}" topilmadi.`);
  }
  return mesh;
}

interface FaceUv {
  readonly count: number;
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
  readonly spanU: number;
  readonly spanV: number;
}

function faceUv(mesh: THREE.Mesh, axis: 'x' | 'y' | 'z', sign: 1 | -1): FaceUv {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let count = 0;
  for (let index = 0; index < uv.count; index += 1) {
    if (normal.getComponent(index, axisIndex) * sign < 0.99) {
      continue;
    }
    minU = Math.min(minU, uv.getX(index));
    maxU = Math.max(maxU, uv.getX(index));
    minV = Math.min(minV, uv.getY(index));
    maxV = Math.max(maxV, uv.getY(index));
    count += 1;
  }
  return {
    count,
    minU,
    maxU,
    minV,
    maxV,
    spanU: maxU - minU,
    spanV: maxV - minV,
  };
}

function uvTile(mesh: THREE.Mesh): number | undefined {
  return (mesh.geometry.userData.uvLayout as { tileCm?: number } | undefined)?.tileCm;
}

function door(overrides: Partial<RoomOpeningSpec> = {}): RoomOpeningSpec {
  return {
    id: 'door-1',
    type: 'door',
    wallId: 'north',
    offsetCm: 100,
    widthCm: 90,
    heightCm: 200,
    sillHeightCm: 0,
    ...overrides,
  };
}

function windowOpening(overrides: Partial<RoomOpeningSpec> = {}): RoomOpeningSpec {
  return {
    id: 'window-1',
    type: 'window',
    wallId: 'north',
    offsetCm: 250,
    widthCm: 100,
    heightCm: 100,
    sillHeightCm: 90,
    ...overrides,
  };
}

describe('9A.2.5 — interior material presets', () => {
  const floorIds = [
    'oak-parquet',
    'light-oak',
    'dark-oak',
    'ceramic-tile',
    'marble',
    'polished-concrete',
    'matte-concrete',
  ] as const;
  const wallIds = [
    'paint-white',
    'paint-warm-white',
    'paint-gray',
    'paint-beige',
    'plaster',
    'concrete-wall',
    'wallpaper-neutral',
  ] as const;
  const ceilingIds = [
    'ceiling-white',
    'ceiling-matte',
    'ceiling-plaster',
    'ceiling-concrete',
  ] as const;

  it('registers every floor preset as a dielectric material with a real tile size', () => {
    for (const id of floorIds) {
      const preset = getMaterialPreset(id);
      expect(preset.id, id).toBe(id);
      expect(preset.metalness, id).toBe(0);
      expect(preset.roughness, id).toBeGreaterThan(0);
      expect(preset.roughness, id).toBeLessThan(1);
      expect(preset.physicalTileCm, id).toBeGreaterThan(0);
    }
    expect(getMaterialPreset('ceramic-tile').physicalTileCm).toBe(60);
    expect(getMaterialPreset('oak-parquet').type).toBe('wood');
  });

  it('registers every wall preset as a dielectric material independent of the floor', () => {
    for (const id of wallIds) {
      const preset = getMaterialPreset(id);
      expect(preset.id, id).toBe(id);
      expect(preset.metalness, id).toBe(0);
      expect(preset.physicalTileCm, id).toBeGreaterThan(0);
    }
    expect(getMaterialPreset('paint-white').physicalTileCm).toBe(100);
    expect(getMaterialPreset('wallpaper-neutral').physicalTileCm).toBe(53);
  });

  it('registers neutral, bright ceiling presets', () => {
    for (const id of ceilingIds) {
      const preset = getMaterialPreset(id);
      expect(preset.id, id).toBe(id);
      expect(preset.metalness, id).toBe(0);
      expect(preset.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      const color = new THREE.Color(preset.color ?? '#000000');
      // Neutral and readable: the two white/plaster grades are brighter than the
      // concrete grade, but none may be dark enough to make a ceiling read grey.
      expect(color.r, id).toBeGreaterThan(0.4);
      expect(color.g, id).toBeGreaterThan(0.4);
      expect(color.b, id).toBeGreaterThan(0.4);
    }
    expect(new THREE.Color(getMaterialPreset('ceiling-white').color ?? '#000').r).toBeGreaterThan(
      0.9,
    );
  });

  it('keeps the furniture presets untouched', () => {
    expect(getMaterialPreset('wood-oak').physicalTileCm).toBeUndefined();
    expect(getMaterialPreset('metal-satin-black').physicalTileCm).toBeUndefined();
  });
});

describe('9A.2.5 — RoomSpec material block', () => {
  it('parses materials deterministically in canonical slot order', () => {
    const parsed = parseRoomSpec({
      ...DEFAULT_ROOM_SPEC,
      materials: {
        ceiling: { materialId: 'ceiling-concrete' },
        floor: { materialId: 'marble', physicalTileCm: 120, roughness: 0.2 },
        wall: { materialId: 'paint-beige' },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.spec.materials ?? {})).toEqual(['floor', 'wall', 'ceiling']);
    expect(parsed.spec.materials?.floor).toMatchObject({
      materialId: 'marble',
      physicalTileCm: 120,
      roughness: 0.2,
    });
  });

  it('omits an absent or empty material block so old specs round-trip unchanged', () => {
    const absent = parseRoomSpec({ ...DEFAULT_ROOM_SPEC });
    expect(absent.ok).toBe(true);
    if (absent.ok) {
      expect('materials' in absent.spec).toBe(false);
    }
    const empty = parseRoomSpec({ ...DEFAULT_ROOM_SPEC, materials: {} });
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect('materials' in empty.spec).toBe(false);
    }
  });

  it('rejects unknown slots, unknown channels, bad preset ids and bad ranges', () => {
    const cases: unknown[] = [
      { attic: { materialId: 'marble' } },
      { floor: { gloss: 1 } },
      { floor: { materialId: 'not-a-material' } },
      { floor: { physicalTileCm: 0 } },
      { floor: { physicalTileCm: 100_000 } },
      { floor: { metalness: 2 } },
      { floor: { baseColor: 'oak' } },
      { floor: 'oak' },
      'oak',
    ];
    for (const materials of cases) {
      const parsed = parseRoomSpec({ ...DEFAULT_ROOM_SPEC, materials });
      expect(parsed.ok, JSON.stringify(materials)).toBe(false);
    }
  });

  it('normalises colours to lowercase and freezes the parsed block', () => {
    const parsed = parseRoomSpec({
      ...DEFAULT_ROOM_SPEC,
      materials: { floor: { baseColor: '#AABBCC' } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spec.materials?.floor?.baseColor).toBe('#aabbcc');
    expect(Object.isFrozen(parsed.spec.materials)).toBe(true);
  });

  it('round-trips a room instance with materials through scene JSON', () => {
    const room = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'room-1', {
      ...DEFAULT_ROOM_SPEC,
      materials: {
        floor: { materialId: 'oak-parquet', physicalTileCm: 100 },
        wall: { materialId: 'paint-white' },
      },
    });
    const scene: SceneData = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [],
      settings: createDefaultSettings(),
      rooms: [room],
    };
    const json = serializeSceneToJson(scene, EXPORT_METADATA, EXPORT_TIME);
    const parsed = parseSceneJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.rooms).toEqual(scene.rooms);
    expect(parsed.scene.rooms?.[0]?.spec.materials?.floor?.materialId).toBe('oak-parquet');
  });
});

describe('9A.2.5 — plan tile resolution', () => {
  it('attaches the preset tile to floor, wall, ceiling and opening parts', () => {
    const plan = planFor({
      showCeiling: true,
      openings: [door(), windowOpening()],
      materials: {
        floor: { materialId: 'oak-parquet' },
        wall: { materialId: 'paint-white' },
        ceiling: { materialId: 'ceiling-concrete' },
        'door-frame': { materialId: 'wood-oak' },
        'window-frame': { materialId: 'wood-oak' },
      },
    });
    const tiles = new Map(plan.parametric.parts.map((part) => [part.id, part.uvTileCm]));
    expect(tiles.get('room-floor')).toBe(100);
    expect(tiles.get('room-wall-north')).toBe(100);
    expect(tiles.get('room-ceiling')).toBe(150);
    // wood-oak has no interior tile, so these parts keep the historical default
    // and omit the property entirely.
    expect(tiles.get('door-1-door-frame-left')).toBeUndefined();
    expect(tiles.get('window-1-window-frame-left')).toBeUndefined();
  });

  it('keeps pre-9A.2.5 structural plan parts free of uvTileCm', () => {
    const plan = planFor();
    for (const part of plan.parametric.parts) {
      if (part.type === 'baseboard' || part.type === 'crown-molding') {
        continue;
      }
      expect('uvTileCm' in part, part.id).toBe(false);
    }
  });

  it('drops the ceiling part when showCeiling is off, whatever the material says', () => {
    const off = solveRoomParts(
      specWith({ showCeiling: false, materials: { ceiling: { materialId: 'ceiling-white' } } }),
    );
    expect(off.parts.some((part) => part.id === 'room-ceiling')).toBe(false);
    const on = solveRoomParts(
      specWith({ showCeiling: true, materials: { ceiling: { materialId: 'ceiling-white' } } }),
    );
    expect(on.parts.some((part) => part.id === 'room-ceiling')).toBe(true);
  });

  it('resolves instance overrides above the stored spec layer', () => {
    const spec = specWith({ materials: { floor: { physicalTileCm: 100 } } });
    const resolved = resolveRoomMaterials(ROOM_SLOTS, spec, {
      floor: { physicalTileCm: 50, roughness: 0.9 },
    });
    const floorSlot = ROOM_SLOTS.find((slot) => slot.id === 'floor');
    expect(floorSlot).toBeDefined();
    if (!floorSlot) return;
    expect(resolveRoomSlotTileCm(floorSlot, spec)).toBe(100);
    expect(resolveRoomSlotTileCm(floorSlot, spec, { physicalTileCm: 50 })).toBe(50);
    expect(resolved.tiles.floor).toBe(50);
    expect(resolved.overrides.floor).toMatchObject({ physicalTileCm: 50, roughness: 0.9 });
  });
});

describe('9A.2.5 — physical UV on built room geometry', () => {
  it('maps a 4 × 5 m floor at a 1 m tile to 4 × 5 repeats', () => {
    const plan = planFor({
      widthCm: 400,
      lengthCm: 500,
      materials: { floor: { materialId: 'oak-parquet' } },
    });
    const built = buildPlan(plan);
    try {
      const floor = meshNamed(built.group, 'room-floor');
      const top = faceUv(floor, 'y', 1);
      expect(uvTile(floor)).toBe(100);
      expect(top.count).toBe(4);
      expect(top.spanU).toBeCloseTo(4, 5);
      expect(top.spanV).toBeCloseTo(5, 5);
      expect(top.minU).toBeCloseTo(0, 5);
      expect(top.minV).toBeCloseTo(0, 5);
    } finally {
      built.dispose();
    }
  });

  it('keeps texel density constant when the room grows', () => {
    const small = buildPlan(
      planFor({ widthCm: 200, lengthCm: 300, materials: { floor: { materialId: 'oak-parquet' } } }),
    );
    const large = buildPlan(
      planFor({ widthCm: 400, lengthCm: 600, materials: { floor: { materialId: 'oak-parquet' } } }),
    );
    try {
      const smallTop = faceUv(meshNamed(small.group, 'room-floor'), 'y', 1);
      const largeTop = faceUv(meshNamed(large.group, 'room-floor'), 'y', 1);
      expect(smallTop.spanU).toBeCloseTo(2, 5);
      expect(largeTop.spanU).toBeCloseTo(4, 5);
      expect(largeTop.spanU / smallTop.spanU).toBeCloseTo(2, 5);
      expect(largeTop.spanU / 400).toBeCloseTo(smallTop.spanU / 200, 8);
    } finally {
      small.dispose();
      large.dispose();
    }
  });

  it('changes the repeat count when the physical tile changes', () => {
    const plan = planFor({
      widthCm: 400,
      lengthCm: 500,
      materials: { floor: { materialId: 'ceramic-tile' } },
    });
    const built = buildPlan(plan);
    try {
      const top = faceUv(meshNamed(built.group, 'room-floor'), 'y', 1);
      expect(top.spanU).toBeCloseTo(400 / 60, 5);
      expect(top.spanV).toBeCloseTo(500 / 60, 5);
    } finally {
      built.dispose();
    }
  });

  it('maps walls vertically by height and horizontally by wall run', () => {
    const plan = planFor({
      widthCm: 400,
      lengthCm: 500,
      heightCm: 280,
      materials: { wall: { materialId: 'paint-white' } },
    });
    const built = buildPlan(plan);
    try {
      const north = meshNamed(built.group, 'room-wall-north');
      const front = faceUv(north, 'z', 1);
      expect(uvTile(north)).toBe(100);
      expect(front.count).toBeGreaterThan(0);
      expect(front.spanU).toBeCloseTo(4.08, 5);
      expect(front.spanV).toBeCloseTo(2.8, 5);

      const east = meshNamed(built.group, 'room-wall-east');
      const eastFront = faceUv(east, 'z', 1);
      expect(eastFront.spanU).toBeCloseTo(5, 5);
      expect(eastFront.spanV).toBeCloseTo(2.8, 5);
    } finally {
      built.dispose();
    }
  });

  it('keeps one continuous UV projection across door and window openings', () => {
    const plan = planFor({
      widthCm: 400,
      lengthCm: 500,
      heightCm: 280,
      openings: [door(), windowOpening()],
      materials: { wall: { materialId: 'paint-white' } },
    });
    const built = buildPlan(plan);
    try {
      const north = meshNamed(built.group, 'room-wall-north');
      const geometry = north.geometry as THREE.BufferGeometry;
      const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;

      let xMin = Infinity;
      for (let index = 0; index < position.count; index += 1) {
        xMin = Math.min(xMin, position.getX(index));
      }

      let checked = 0;
      for (let index = 0; index < position.count; index += 1) {
        if (normal.getZ(index) < 0.99) {
          continue;
        }
        expect(uv.getX(index)).toBeCloseTo((position.getX(index) - xMin) / 100, 5);
        expect(uv.getY(index)).toBeCloseTo(position.getY(index) / 100, 5);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(20);

      for (let index = 0; index < uv.count; index += 1) {
        expect(Number.isFinite(uv.getX(index))).toBe(true);
        expect(Number.isFinite(uv.getY(index))).toBe(true);
      }
    } finally {
      built.dispose();
    }
  });

  it('produces unit normals and no mirrored triangles on room surfaces', () => {
    const plan = planFor({
      widthCm: 400,
      lengthCm: 500,
      heightCm: 280,
      showCeiling: true,
      openings: [door(), windowOpening()],
      materials: {
        floor: { materialId: 'oak-parquet' },
        wall: { materialId: 'paint-white' },
        ceiling: { materialId: 'ceiling-white' },
      },
    });
    const built = buildPlan(plan);
    try {
      for (const name of ['room-floor', 'room-wall-north', 'room-wall-east', 'room-ceiling']) {
        const mesh = meshNamed(built.group, name);
        const geometry = mesh.geometry as THREE.BufferGeometry;
        const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
        for (let index = 0; index < normal.count; index += 1) {
          const length = Math.hypot(
            normal.getX(index),
            normal.getY(index),
            normal.getZ(index),
          );
          expect(length, `${name}[${index}]`).toBeCloseTo(1, 5);
        }
        const report = detectMirroredUv(geometry);
        expect(report.totalTriangles, name).toBeGreaterThan(0);
        expect(report.mirroredTriangles, name).toBe(0);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps the ceiling UV independent from the floor and sized to the slab', () => {
    const plan = planFor({
      widthCm: 400,
      lengthCm: 500,
      showCeiling: true,
      materials: {
        floor: { materialId: 'oak-parquet' },
        ceiling: { materialId: 'ceiling-concrete' },
      },
    });
    const built = buildPlan(plan);
    try {
      const ceiling = meshNamed(built.group, 'room-ceiling');
      const face = faceUv(ceiling, 'y', 1);
      expect(uvTile(ceiling)).toBe(150);
      expect(face.spanU).toBeCloseTo(408 / 150, 5);
      expect(face.spanV).toBeCloseTo(508 / 150, 5);
      expect(face.spanU).not.toBeCloseTo(4, 3);
    } finally {
      built.dispose();
    }
  });

  it('applies textureScale to the material pattern without changing world-scale UVs', () => {
    const plan = planFor({
      widthCm: 400,
      lengthCm: 500,
      materials: { floor: { materialId: 'oak-parquet', textureScale: 2 } },
    });
    const built = buildPlan(plan);
    try {
      const floor = meshNamed(built.group, 'room-floor');
      const top = faceUv(floor, 'y', 1);
      expect(top.spanU).toBeCloseTo(4, 5);
      const material = floor.material as THREE.MeshStandardMaterial;
      expect(getProceduralState(material)?.scale).toBe(2);
    } finally {
      built.dispose();
    }
  });
});

describe('9A.2.5 — RoomInstance material integration', () => {
  it('applies preset colours and channels to every room slot', () => {
    const instance = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'room-1', {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: true,
      openings: [door(), windowOpening()],
      materials: {
        floor: { materialId: 'dark-oak' },
        wall: { materialId: 'paint-beige' },
        ceiling: { materialId: 'ceiling-matte' },
        'door-frame': { materialId: 'wood-oak' },
        'door-leaf': { materialId: 'wood-oak' },
        'door-hardware': { materialId: 'metal-satin-black' },
        'window-frame': { materialId: 'wood-oak' },
        'window-glass': { materialId: 'glass-clear' },
        'window-sill': { materialId: 'paint-white' },
      },
    });
    const built = buildRoomInstance(instance);
    try {
      const expectations: Array<[string, string]> = [
        ['room-floor', '#4a3226'],
        ['room-wall-north', '#e5dbc9'],
        ['room-ceiling', '#eeece7'],
        ['door-1-door-frame-left', '#a9744f'],
        ['door-1-door-leaf', '#a9744f'],
        ['door-1-door-handle', '#1b1d20'],
        ['window-1-window-frame-left', '#a9744f'],
        ['window-1-window-glass-1-1', '#bfe3ea'],
        ['window-1-window-sill', '#f4f4f1'],
      ];
      for (const [name, color] of expectations) {
        const mesh = meshNamed(built.group, name);
        const material = mesh.material as THREE.MeshStandardMaterial;
        expect(material.color.getHexString(), name).toBe(color.slice(1));
      }
    } finally {
      built.dispose();
    }
  });

  it('applies instance overrides above the room spec and the slot default', () => {
    const instance = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'room-1', {
      ...DEFAULT_ROOM_SPEC,
      widthCm: 400,
      lengthCm: 500,
      materials: {
        floor: { materialId: 'oak-parquet', baseColor: '#112233', physicalTileCm: 100 },
      },
    });
    const withOverride = buildRoomInstance({
      ...instance,
      materialAssignments: {
        floor: { roughness: 0.9, physicalTileCm: 50 },
      },
    });
    try {
      const floor = meshNamed(withOverride.group, 'room-floor');
      const material = floor.material as THREE.MeshStandardMaterial;
      expect(material.color.getHexString()).toBe('112233');
      expect(material.roughness).toBeCloseTo(0.9, 5);
      expect(uvTile(floor)).toBe(50);
      expect(faceUv(floor, 'y', 1).spanU).toBeCloseTo(8, 5);
    } finally {
      withOverride.dispose();
    }

    const specOnly = buildRoomInstance(instance);
    try {
      const floor = meshNamed(specOnly.group, 'room-floor');
      const material = floor.material as THREE.MeshStandardMaterial;
      expect(material.color.getHexString()).toBe('112233');
      expect(uvTile(floor)).toBe(100);
      expect(material.roughness).toBeCloseTo(getMaterialPreset('oak-parquet').roughness, 5);
    } finally {
      specOnly.dispose();
    }
  });

  it('falls back to the definition slot defaults when no material is assigned', () => {
    const built = buildRoomInstance(createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'room-1'));
    try {
      const floor = meshNamed(built.group, 'room-floor');
      const material = floor.material as THREE.MeshStandardMaterial;
      expect(material.color.getHexString()).toBe(
        getMaterialPreset('wood-oak').color?.slice(1),
      );
      expect(uvTile(floor)).toBe(UV_TILE_CM);
    } finally {
      built.dispose();
    }
  });

  it('ignores a malformed instance tile override instead of guessing', () => {
    const instance = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'room-1');
    const invalid = {
      ...instance,
      materialAssignments: { floor: { physicalTileCm: 'large' } },
    };
    const built = buildRoomInstance(invalid);
    try {
      const floor = meshNamed(built.group, 'room-floor');
      expect(uvTile(floor)).toBe(UV_TILE_CM);
    } finally {
      built.dispose();
    }
  });
});

describe('9A.2.5 — budget and sharing', () => {
  it('shares one material per slot across all room parts', () => {
    const plan = planFor({
      showCeiling: true,
      openings: [door(), windowOpening()],
      materials: {
        floor: { materialId: 'oak-parquet' },
        wall: { materialId: 'paint-white' },
        ceiling: { materialId: 'ceiling-white' },
        'door-frame': { materialId: 'wood-oak' },
        'window-frame': { materialId: 'wood-oak' },
      },
    });
    const built = buildPlan(plan);
    try {
      const bySlot = new Map<string, Set<THREE.Material>>();
      for (const mesh of meshes(built.group)) {
        const slot = (mesh.parent?.name ?? '').replace(/-group$/, '');
        const set = bySlot.get(slot) ?? new Set<THREE.Material>();
        set.add(mesh.material as THREE.Material);
        bySlot.set(slot, set);
      }
      expect(bySlot.size).toBeGreaterThan(0);
      for (const [slot, materials] of bySlot) {
        expect(materials.size, slot).toBe(1);
      }
    } finally {
      built.dispose();
    }
  });

  it('stays within the definition part budget for an opening-heavy room', () => {
    const openings: RoomOpeningSpec[] = [];
    for (const side of ['north', 'east', 'south', 'west'] as const) {
      openings.push(
        door({ id: `${side}-door-1`, wallId: side, offsetCm: 20 }),
        windowOpening({ id: `${side}-window-1`, wallId: side, offsetCm: 150 }),
        door({ id: `${side}-door-2`, wallId: side, offsetCm: 280 }),
      );
    }
    const plan = planFor({ showCeiling: true, openings });
    expect(plan.parametric.parts.length).toBeLessThanOrEqual(512);
    const built = buildPlan(plan);
    try {
      expect(meshes(built.group).length).toBe(plan.parametric.parts.length);
    } finally {
      built.dispose();
    }
  });

  it('builds the 20-room scene cap and releases every geometry', () => {
    const rooms = Array.from({ length: 20 }, (_, index) =>
      buildRoomInstance(
        createRoomInstance(ROOM_STANDARD_DEFINITION_ID, `room-${index}`, {
          ...DEFAULT_ROOM_SPEC,
          showCeiling: index % 2 === 0,
          openings: [door({ id: `door-${index}` }), windowOpening({ id: `window-${index}` })],
          materials: {
            floor: { materialId: index % 2 === 0 ? 'oak-parquet' : 'ceramic-tile' },
            wall: { materialId: 'paint-white' },
            ceiling: { materialId: 'ceiling-white' },
          },
        }),
      ),
    );
    try {
      let meshCount = 0;
      for (const room of rooms) {
        const roomMeshes: THREE.Mesh[] = [];
        room.group.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            roomMeshes.push(object);
          }
        });
        meshCount += roomMeshes.length;
        expect(roomMeshes.length).toBeLessThanOrEqual(512);
        for (const mesh of roomMeshes) {
          const geometry = mesh.geometry as THREE.BufferGeometry;
          const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
          const position = geometry.getAttribute('position') as THREE.BufferAttribute;
          expect(uv.count).toBe(position.count);
        }
      }
      expect(meshCount).toBeGreaterThan(0);
    } finally {
      for (const room of rooms) {
        room.dispose();
      }
    }
  });
});
