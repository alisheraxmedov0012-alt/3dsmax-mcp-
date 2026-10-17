import { describe, expect, it } from 'vitest';
import { ASSEMBLY_KINDS } from '../../scene/types';
import {
  assemblyPartIds,
  buildAssembly,
  buildKitchenBaseRun,
  buildStairStraight,
  buildWallCabinet,
  buildWardrobeSection,
} from './index';
import { AssemblyError } from './limits';
import {
  assemblyDefaults,
  requireAssemblyParams,
  validateAssemblyParams,
} from './params';

/** Count meshes in a built assembly. */
function meshCount(built: { group: { traverse: (fn: (o: unknown) => void) => void } }): number {
  let count = 0;
  built.group.traverse((object) => {
    const node = object as { isMesh?: boolean };
    if (node.isMesh) {
      count += 1;
    }
  });
  return count;
}

describe('W14 assembly builders', () => {
  it('builds every kind through the dispatcher', () => {
    for (const kind of ASSEMBLY_KINDS) {
      const params = assemblyDefaults(kind);
      const built = buildAssembly(kind, params as never);
      expect(built.group.children.length, kind).toBeGreaterThan(0);
      expect(meshCount(built), kind).toBeGreaterThan(0);
      expect(built.members.length, kind).toBeGreaterThan(0);
      built.dispose();
    }
  });

  it('names the root group after the kind and tags every mesh with a part id', () => {
    const built = buildWallCabinet(assemblyDefaults('wall-cabinet'));
    expect(built.group.name).toBe('wall-cabinet:assembly');
    built.group.traverse((object) => {
      const mesh = object as { isMesh?: boolean; userData: Record<string, unknown> };
      if (mesh.isMesh) {
        expect(typeof mesh.userData.partId).toBe('string');
      }
    });
    built.dispose();
  });

  it('exposes members with stable ids and a readable label', () => {
    const built = buildKitchenBaseRun(assemblyDefaults('kitchen-base-run'));
    expect(built.members.map((member) => member.objectId)).toEqual([
      'module-1',
      'module-2',
      'module-3',
      'top',
      'plinth',
    ]);
    built.members.forEach((member) => expect(member.label.length).toBeGreaterThan(0));
    built.dispose();
  });

  it('builds a kitchen run with one mesh per part', () => {
    const params = requireAssemblyParams('kitchen-base-run', { moduleCount: 2, plinthHeightCm: 10 });
    const built = buildKitchenBaseRun(params);
    // 2 corpora + 2 doors + 1 top + 1 plinth
    expect(meshCount(built)).toBe(6);
    built.dispose();
  });

  it('builds a wall cabinet whose parts all hang above the mount height', () => {
    const params = requireAssemblyParams('wall-cabinet', { mountHeightCm: 150, heightCm: 60 });
    const built = buildWallCabinet(params);
    let minY = Infinity;
    built.group.updateMatrixWorld(true);
    built.group.traverse((object) => {
      const mesh = object as { isMesh?: boolean; position: { y: number } };
      if (mesh.isMesh) {
        minY = Math.min(minY, mesh.position.y);
      }
    });
    expect(minY).toBeGreaterThanOrEqual(150);
    built.dispose();
  });

  it('builds a wardrobe with dividers, shelves and doors', () => {
    const params = requireAssemblyParams('wardrobe-section', {
      sectionCount: 3,
      shelfCountPerSection: 2,
      doorCount: 2,
    });
    const built = buildWardrobeSection(params);
    // corpus + 2 dividers + 6 shelves + 2 doors
    expect(meshCount(built)).toBe(11);
    expect(built.members.map((member) => member.objectId)).toEqual(['corpus', 'doors']);
    built.dispose();
  });

  it('omits the doors member when doorCount is zero', () => {
    const params = requireAssemblyParams('wardrobe-section', { doorCount: 0 });
    const built = buildWardrobeSection(params);
    expect(built.members.map((member) => member.objectId)).toEqual(['corpus']);
    built.dispose();
  });

  it('builds a stair with all steps and both stringers', () => {
    const params = requireAssemblyParams('stair-straight', { stepCount: 10 });
    const built = buildStairStraight(params);
    expect(meshCount(built)).toBe(12);
    expect(built.members.map((member) => member.objectId)).toEqual(['flight', 'stringers']);
    built.dispose();
  });

  it('disposes without throwing and can be built repeatedly', () => {
    for (let round = 0; round < 3; round += 1) {
      const built = buildWallCabinet(assemblyDefaults('wall-cabinet'));
      expect(() => built.dispose()).not.toThrow();
    }
  });

  it('rejects invalid parameters before creating any geometry', () => {
    const bad = validateAssemblyParams('wardrobe-section', { heightCm: 10 });
    expect(bad).toBeNull();

    // A hand-crafted parameter object bypasses the schema on purpose: the
    // builder's own constraint pass must still refuse it.
    expect(() =>
      buildWardrobeSection({
        ...assemblyDefaults('wardrobe-section'),
        heightCm: 5,
        sectionCount: 2,
        shelfCountPerSection: 0,
        doorCount: 0,
      }),
    ).toThrow(AssemblyError);
  });

  it('reports a controlled error, not a raw exception', () => {
    try {
      buildStairStraight({
        ...assemblyDefaults('stair-straight'),
        riseCm: -5,
      });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AssemblyError);
      expect((error as AssemblyError).code).toBe('assembly_invalid_params');
    }
  });

  it('lists part ids without leaking geometry', () => {
    for (const kind of ASSEMBLY_KINDS) {
      const ids = assemblyPartIds(kind, assemblyDefaults(kind) as never);
      expect(ids.length, kind).toBeGreaterThan(0);
      expect(new Set(ids).size, kind).toBe(ids.length);
    }
  });

  it('never produces duplicate part ids across kinds', () => {
    const allIds = ASSEMBLY_KINDS.flatMap((kind) => assemblyPartIds(kind, assemblyDefaults(kind) as never));
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
