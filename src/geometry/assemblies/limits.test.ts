import { describe, expect, it } from 'vitest';
import {
  AssemblyError,
  MAX_ASSEMBLIES_PER_SCENE,
  MAX_ASSEMBLY_DEPTH,
  MAX_MEMBERS_PER_ASSEMBLY,
  MAX_PARTS_PER_ASSEMBLY,
  assertAssemblyBudget,
  assertMemberBudget,
  assertNoNestedAssemblyRefs,
  assertPartBudget,
} from './limits';

describe('W14 assembly limits', () => {
  it('caps assemblies per scene at the shared constant', () => {
    expect(MAX_ASSEMBLIES_PER_SCENE).toBe(20);
    const atCap = Array.from({ length: 20 }, () => ({}));
    const overCap = Array.from({ length: 21 }, () => ({}));
    expect(() => assertAssemblyBudget(atCap)).not.toThrow();
    expect(() => assertAssemblyBudget(overCap)).toThrow(AssemblyError);
  });

  it('reports assembly_too_many with a safe message', () => {
    try {
      assertAssemblyBudget(Array.from({ length: MAX_ASSEMBLIES_PER_SCENE + 1 }, () => ({})));
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AssemblyError);
      const assemblyError = error as AssemblyError;
      expect(assemblyError.code).toBe('assembly_too_many');
      expect(assemblyError.message).toContain(String(MAX_ASSEMBLIES_PER_SCENE));
    }
  });

  it('caps parts per assembly', () => {
    expect(() => assertPartBudget(MAX_PARTS_PER_ASSEMBLY)).not.toThrow();
    expect(() => assertPartBudget(MAX_PARTS_PER_ASSEMBLY + 1)).toThrow(AssemblyError);
  });

  it('caps members per assembly', () => {
    expect(() => assertMemberBudget(MAX_MEMBERS_PER_ASSEMBLY)).not.toThrow();
    expect(() => assertMemberBudget(MAX_MEMBERS_PER_ASSEMBLY + 1)).toThrow(AssemblyError);
  });

  it('allows flat parameters', () => {
    expect(() =>
      assertNoNestedAssemblyRefs({ widthCm: 180, doorCount: 3, nested: { x: 1 } }),
    ).not.toThrow();
  });

  it('rejects a direct assembly reference inside parameters', () => {
    for (const key of ['assemblyId', 'assemblies']) {
      try {
        assertNoNestedAssemblyRefs({ [key]: 'a1' });
        throw new Error('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AssemblyError);
        expect((error as AssemblyError).code).toBe('assembly_too_deep');
      }
    }
  });

  it('rejects a nested assembly reference deep in the parameters', () => {
    expect(() => assertNoNestedAssemblyRefs({ nested: [{ deeper: { assemblyId: 'a1' } }] })).toThrow(
      AssemblyError,
    );
  });

  it('stops before unbounded recursion', () => {
    // A cyclic object would loop forever without the depth cap.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertNoNestedAssemblyRefs(cyclic)).toThrow(AssemblyError);
    expect(MAX_ASSEMBLY_DEPTH).toBe(2);
  });

  it('ignores primitives and null', () => {
    expect(() => assertNoNestedAssemblyRefs(null)).not.toThrow();
    expect(() => assertNoNestedAssemblyRefs(42)).not.toThrow();
    expect(() => assertNoNestedAssemblyRefs('x')).not.toThrow();
  });
});
