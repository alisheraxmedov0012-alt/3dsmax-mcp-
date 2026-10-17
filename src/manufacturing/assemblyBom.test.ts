import { describe, expect, it } from 'vitest';
import { ASSEMBLY_KINDS } from '../scene/types';
import { assemblyDefaults, requireAssemblyParams } from '../geometry/assemblies/params';
import { ASSEMBLY_BOM_LIMITATIONS, buildAssemblyBom } from './assemblyBom';

describe('W14 assembly BOM', () => {
  it('produces rows for every kind', () => {
    for (const kind of ASSEMBLY_KINDS) {
      const outcome = buildAssemblyBom(kind, assemblyDefaults(kind) as never);
      expect(outcome.ok, kind).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.bom.rows.length, kind).toBeGreaterThan(0);
      expect(outcome.bom.totalParts, kind).toBeGreaterThan(0);
      expect(outcome.bom.unit).toBe('mm');
      expect(outcome.bom.assemblyKind).toBe(kind);
    }
  });

  it('reports sizes in millimetres, measured from geometry', () => {
    const params = requireAssemblyParams('wall-cabinet', {
      widthCm: 80,
      heightCm: 60,
      depthCm: 30,
      doorCount: 1,
    });
    const outcome = buildAssemblyBom('wall-cabinet', params);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const corpus = outcome.bom.rows.find((row) => row.kind === 'body');
    expect(corpus).toBeDefined();
    expect(corpus?.sizeMm).toEqual({ x: 800, y: 600, z: 300 });
  });

  it('counts identical parts into a single quantity row', () => {
    const params = requireAssemblyParams('stair-straight', { stepCount: 12 });
    const outcome = buildAssemblyBom('stair-straight', params);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Twelve identical steps fold into one row of quantity 12.
    const stepRows = outcome.bom.rows.filter((row) => row.kind === 'board');
    expect(stepRows).toHaveLength(1);
    expect(stepRows[0].quantity).toBe(12);
    expect(outcome.bom.totalParts).toBe(14); // 12 steps + 2 stringers
  });

  it('keeps the material column honest: null, with a stated limitation', () => {
    const outcome = buildAssemblyBom('wardrobe-section', assemblyDefaults('wardrobe-section'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    outcome.bom.rows.forEach((row) => {
      expect(row.material).toBeNull();
      expect(row.sources.material).toBe('unavailable');
    });
    expect(outcome.bom.limitations).toEqual([...ASSEMBLY_BOM_LIMITATIONS]);
    expect(
      outcome.bom.limitations.some((line) => line.toLowerCase().includes('manufacturing-ready')),
    ).toBe(true);
  });

  it('never claims manufacturing readiness', () => {
    const outcome = buildAssemblyBom('kitchen-base-run', assemblyDefaults('kitchen-base-run'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const joined = outcome.bom.limitations.join(' ').toLowerCase();
    expect(joined).toContain('edge banding');
    expect(joined).not.toContain('tayyor mahsulot');
  });

  it('returns a reason instead of throwing for invalid parameters', () => {
    const outcome = buildAssemblyBom('stair-straight', {
      ...assemblyDefaults('stair-straight'),
      riseCm: -1,
    } as never);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("noto'g'ri");
  });

  it('reports a panel area for panel-based assemblies', () => {
    const outcome = buildAssemblyBom('wardrobe-section', assemblyDefaults('wardrobe-section'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.bom.panelAreaM2).toBeGreaterThan(0);
  });

  it('does not mutate the parameters it receives', () => {
    const params = assemblyDefaults('kitchen-base-run');
    const snapshot = JSON.stringify(params);
    buildAssemblyBom('kitchen-base-run', params);
    expect(JSON.stringify(params)).toBe(snapshot);
  });
});
