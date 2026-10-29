import { describe, expect, it } from 'vitest';
import { buildHardwareBom, hardwareCsv, hardwareLines, validateHardwareSteps } from './hardware';

describe('C6 hardware BOM', () => {
  it('never invents fasteners when no data is supplied', () => {
    const outcome = buildHardwareBom();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.hardware.specified).toBe(false);
    expect(outcome.hardware.items).toHaveLength(1);
    expect(outcome.hardware.items[0].kind).toBe('unspecified');
    expect(outcome.hardware.items[0].quantity).toBeNull();
    expect(outcome.hardware.totalPieces).toBeNull();
    expect(outcome.hardware.limitations.join(' ')).toMatch(/aniqlanmaydi|hisoblanmagan/);
  });

  it('keeps caller-supplied hardware and sums known piece counts', () => {
    const outcome = buildHardwareBom([
      {
        kind: 'screw',
        name: 'Konfirmat',
        quantity: 12,
        unit: 'pcs',
        size: '4×40 mm',
        stepIds: ['step-1', 'step-2'],
      },
      { kind: 'dowel', name: 'Dowel', quantity: 8, unit: 'pcs', size: null },
      { kind: 'glue', name: 'Yelim', quantity: 50, unit: 'ml', size: null },
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.hardware.specified).toBe(true);
    expect(outcome.hardware.items).toHaveLength(3);
    // The same row linked to two steps is still counted once.
    expect(outcome.hardware.totalPieces).toBe(20);
    expect(outcome.hardware.items[0].stepIds).toEqual(['step-1', 'step-2']);
    expect(hardwareCsv(outcome.hardware)).toContain('step-1;step-2');
  });

  it('reports step links that do not exist in the current plan', () => {
    const outcome = buildHardwareBom([
      {
        kind: 'screw',
        name: 'Konfirmat',
        quantity: 4,
        unit: 'pcs',
        size: null,
        stepIds: ['step-9'],
      },
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(validateHardwareSteps(outcome.hardware, [{ id: 'step-1' }])).toHaveLength(1);
    expect(validateHardwareSteps(outcome.hardware, [{ id: 'step-9' }])).toEqual([]);
  });

  it('rejects malformed rows instead of silently dropping them', () => {
    expect(buildHardwareBom([{ kind: 'screw', name: '', quantity: 1, unit: 'pcs', size: null }]).ok).toBe(false);
    expect(buildHardwareBom([{ kind: 'screw', name: 'X', quantity: 0, unit: 'pcs', size: null }]).ok).toBe(false);
    expect(buildHardwareBom([{ kind: 'screw', name: 'X', quantity: 1.5, unit: 'pcs', size: null }]).ok).toBe(false);
    expect(buildHardwareBom([{ kind: 'screw', name: 'X', quantity: null, unit: 'pcs', size: null }]).ok).toBe(false);
  });

  it('writes a CSV with an explicit not-specified status', () => {
    const outcome = buildHardwareBom();
    if (!outcome.ok) throw new Error(outcome.reason);
    const csv = hardwareCsv(outcome.hardware);
    expect(csv.split('\n')[0]).toBe('kind,name,quantity,unit,size,note,steps,status');
    expect(csv).toContain('not-specified');
  });

  it('states the missing hardware in the human-readable section', () => {
    const outcome = buildHardwareBom();
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(hardwareLines(outcome.hardware)[0]).toMatch(/ko'rsatilmagan/i);
  });
});
