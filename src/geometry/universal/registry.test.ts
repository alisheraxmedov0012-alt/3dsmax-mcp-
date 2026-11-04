import { describe, expect, it } from 'vitest';
import {
  FurnitureDefinitionRegistry,
  defineFurniture,
  furnitureDefinitions,
  type FurnitureDefinition,
} from './index';

interface TestSpec {
  readonly width: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function testDefinition(id = 'test.basic'): FurnitureDefinition<TestSpec> {
  return {
    id,
    version: 1,
    family: 'table',
    label: 'Test furniture',
    fields: [{ key: 'width', label: 'Kenglik', kind: 'number' }],
    defaults: { width: 10 },
    slots: [
      {
        id: 'main',
        label: 'Asosiy',
        color: '#a9744f',
        materialId: 'wood-oak',
        groupName: 'test-main-group',
      },
    ],
    limits: {
      maxParts: 4,
      maxPartVertices: 1000,
      maxPartTriangles: 2000,
      maxTotalVertices: 4000,
    },
    groupName: 'test-assembly',
    parseSpec: (input) => {
      if (!isRecord(input)) {
        return { ok: false, errors: ['spec obyekt bo‘lishi kerak.'] };
      }
      const raw = input.width;
      if (raw !== undefined && (typeof raw !== 'number' || !Number.isFinite(raw))) {
        return { ok: false, errors: ['width chekli son bo‘lishi kerak.'] };
      }
      return { ok: true, spec: { width: typeof raw === 'number' ? raw : 10 } };
    },
    solve: () => ({ parts: [], connections: [], warnings: [] }),
  };
}

describe('definition registry', () => {
  it('registers and retrieves a definition', () => {
    const registry = new FurnitureDefinitionRegistry();
    registry.register(testDefinition());
    expect(registry.has('test.basic')).toBe(true);
    expect(registry.get('test.basic')?.label).toBe('Test furniture');
    expect(registry.require('test.basic').family).toBe('table');
  });

  it('rejects a duplicate definition id', () => {
    const registry = new FurnitureDefinitionRegistry();
    registry.register(testDefinition());
    expect(() => registry.register(testDefinition())).toThrowError(
      expect.objectContaining({ code: 'duplicate_definition' }),
    );
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects an invalid definition id at definition time', () => {
    expect(() => defineFurniture(testDefinition('NotAnId'))).toThrowError(
      expect.objectContaining({ code: 'invalid_definition' }),
    );
  });

  it('accepts camelCase variants that start with a lowercase letter', () => {
    for (const id of [
      'kitchen.baseCabinet',
      'chair.office',
      'desk.computer',
      'sofa.standard',
    ]) {
      const registry = new FurnitureDefinitionRegistry();
      registry.register(testDefinition(id));
      expect(registry.has(id)).toBe(true);
    }
  });

  it('rejects malformed or non-lowercase id segments', () => {
    for (const id of [
      'kitchen.UPPER',
      'kitchen.123',
      'kitchen.BaseCabinet',
      'kitchen..cabinet',
      'kitchen.cabinet.',
    ]) {
      expect(() => defineFurniture(testDefinition(id))).toThrowError(
        expect.objectContaining({ code: 'invalid_definition' }),
      );
    }
  });

  it('returns undefined for an unknown id and throws from require', () => {
    const registry = new FurnitureDefinitionRegistry();
    expect(registry.get('test.missing')).toBeUndefined();
    expect(() => registry.require('test.missing')).toThrowError(
      expect.objectContaining({ code: 'unknown_definition' }),
    );
  });

  it('lists definitions in stable id order', () => {
    const registry = new FurnitureDefinitionRegistry();
    registry.register(testDefinition('test.zeta'));
    registry.register(testDefinition('test.alpha'));
    expect(registry.list().map((definition) => definition.id)).toEqual([
      'test.alpha',
      'test.zeta',
    ]);
  });

  it('registers the built-in desk.computer definition', () => {
    expect(furnitureDefinitions.has('desk.computer')).toBe(true);
    expect(furnitureDefinitions.list().map((definition) => definition.id)).toContain(
      'desk.computer',
    );
  });
});
