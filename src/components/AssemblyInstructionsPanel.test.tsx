// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssemblyInstructionsPanel } from './AssemblyInstructionsPanel';
import {
  buildFurnitureAssemblyPlan,
  type AssemblyPlan,
} from '../manufacturing/assemblyInstructions';
import { buildBom } from '../manufacturing/bom';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';

/**
 * C6 render tests for the assembly-instructions section.
 *
 * The plans under test are the real ones `assemblyInstructions` produces from a
 * real BOM — a fixture would let the component agree with a plan the generator
 * never emits, which is exactly the failure this section must not have.
 */
function planFor(type: FurnitureType): AssemblyPlan {
  const bom = buildBom(type, createFurnitureParams(type));
  if (!bom.ok) throw new Error(bom.reason);
  return buildFurnitureAssemblyPlan({ bom: bom.bom });
}

afterEach(() => cleanup());

describe('AssemblyInstructionsPanel', () => {
  it('offers generation and shows no steps until one is asked for', () => {
    const onGenerate = vi.fn();
    render(<AssemblyInstructionsPanel plan={null} stale={false} onGenerate={onGenerate} />);

    expect(screen.getByTestId('assembly-instructions').textContent).toContain('Montaj yo‘riqnomasi');
    expect(screen.queryByTestId('assembly-steps')).toBeNull();
    fireEvent.click(screen.getByTestId('assembly-generate'));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('renders the real steps of a wardrobe in order', () => {
    const plan = planFor('wardrobe');
    render(<AssemblyInstructionsPanel plan={plan} stale={false} onGenerate={vi.fn()} />);

    const list = screen.getByTestId('assembly-steps');
    expect(list.tagName).toBe('OL');
    // Only the direct children: each step also contains a parts list of its own.
    const items = Array.from(list.children) as HTMLElement[];
    expect(items).toHaveLength(plan.steps.length);
    plan.steps.forEach((step, index) => {
      expect(items[index].textContent).toContain(`${step.order}. ${step.title}`);
      expect(items[index].textContent).toContain(step.instruction);
    });
  });

  it('names every referenced part and its grouped quantity', () => {
    const plan = planFor('wardrobe');
    render(<AssemblyInstructionsPanel plan={plan} stale={false} onGenerate={vi.fn()} />);

    const steps = screen.getByTestId('assembly-steps');
    // Two doors are one BOM line of quantity 2, not one anonymous door.
    expect(steps.textContent).toContain('wardrobe-door');
    expect(steps.textContent).toContain('× 2');
    const one = plan.steps[0];
    for (const part of one.parts) {
      expect(steps.textContent).toContain(part.partId);
      expect(steps.textContent).toContain(part.name);
    }
  });

  it('shows the dimension of a part when the model provides one', () => {
    const plan = planFor('table');
    render(<AssemblyInstructionsPanel plan={plan} stale={false} onGenerate={vi.fn()} />);

    const top = plan.steps[1].parts[0];
    expect(top.sizeMm).toEqual({ x: 1200, y: 40, z: 600 });
    expect(screen.getByTestId('assembly-steps').textContent).toContain('1200×40×600 mm');
  });

  it('distinguishes a modelled relationship from a role-derived one', () => {
    const plan = planFor('bed');
    render(<AssemblyInstructionsPanel plan={plan} stale={false} onGenerate={vi.fn()} />);

    // Furniture plans are role-derived...
    expect(screen.getByTestId('assembly-source-1').textContent).toBe('Roldan kelib chiqqan');
    // ...and the component is able to show the stronger claim when it holds.
    const modelled: AssemblyPlan = {
      ...plan,
      steps: [{ ...plan.steps[0], relation: 'modeled' }],
    };
    cleanup();
    render(<AssemblyInstructionsPanel plan={modelled} stale={false} onGenerate={vi.fn()} />);
    expect(screen.getByTestId('assembly-source-1').textContent).toBe('Modelda belgilangan');
  });

  it('marks a stale plan explicitly instead of rewriting it silently', () => {
    const plan = planFor('shelf');
    render(<AssemblyInstructionsPanel plan={plan} stale onGenerate={vi.fn()} />);

    expect(screen.getByTestId('assembly-stale').textContent).toMatch(/eski reja/);
    // The old steps are still visible, so the reader can tell what is stale.
    expect(screen.getByTestId('assembly-steps')).toBeTruthy();
    expect(screen.getByTestId('assembly-generate').textContent).toMatch(/yangilash/i);
  });

  it('does not show a stale banner for a current plan', () => {
    render(<AssemblyInstructionsPanel plan={planFor('shelf')} stale={false} onGenerate={vi.fn()} />);
    expect(screen.queryByTestId('assembly-stale')).toBeNull();
  });

  it('shows the status and the limitations on every populated plan', () => {
    const plan = planFor('chair');
    render(<AssemblyInstructionsPanel plan={plan} stale={false} onGenerate={vi.fn()} />);

    expect(screen.getByTestId('assembly-status').textContent).toContain("To'liq");
    const limitations = screen.getByTestId('assembly-limitations');
    expect(limitations.textContent).toContain('Mahkamlash vositalari');
    expect(limitations.textContent).toContain('sertifikati emas');
    // No hardware is claimed anywhere in the rendered steps.
    expect(screen.getByTestId('assembly-steps').textContent).not.toMatch(/shurop|shtift|yelim/i);
  });

  it('surfaces plan issues with their severity', () => {
    const plan = planFor('table');
    const limited: AssemblyPlan = {
      ...plan,
      status: 'limited',
      issues: [
        {
          level: 'warning',
          code: 'part-unclassified',
          stepId: 'step-3',
          message: "«table-gizmo» detali ma'lum rolga ega emas.",
        },
      ],
    };
    render(<AssemblyInstructionsPanel plan={limited} stale={false} onGenerate={vi.fn()} />);

    const issues = screen.getByTestId('assembly-issues');
    expect(issues.textContent).toContain('Ogohlantirish');
    expect(issues.textContent).toContain('part-unclassified');
    expect(screen.getByTestId('assembly-status').textContent).toContain('Qisman');
  });

  it('explains an unsupported plan instead of rendering an empty list', () => {
    const plan = planFor('table');
    const unsupported: AssemblyPlan = {
      ...plan,
      status: 'unsupported',
      steps: [],
      issues: [
        {
          level: 'error',
          code: 'plan-empty',
          stepId: null,
          message: "Modelda montaj qadamlarini tuzish uchun detallar yo'q.",
        },
      ],
    };
    render(<AssemblyInstructionsPanel plan={unsupported} stale={false} onGenerate={vi.fn()} />);

    expect(screen.queryByTestId('assembly-steps')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/detallar yo.q/);
    expect(screen.getByTestId('assembly-status').textContent).toContain('Mavjud emas');
    // Limitations stay visible even when nothing could be planned.
    expect(screen.getByTestId('assembly-limitations')).toBeTruthy();
  });

  it('keeps a single-column structure so a narrow panel does not need horizontal scroll', () => {
    const plan = planFor('wardrobe');
    const { container } = render(
      <AssemblyInstructionsPanel plan={plan} stale={false} onGenerate={vi.fn()} />,
    );

    // jsdom performs no layout, so the structural guarantee is asserted instead:
    // one ordered list, one item per step, and no nested grid/table that would
    // need a minimum width to stay readable.
    const root = container.querySelector('.assembly') as HTMLElement;
    expect(root.tagName).toBe('DIV');
    expect(root.querySelectorAll('ol.assembly__steps')).toHaveLength(1);
    expect(root.querySelectorAll('table')).toHaveLength(0);
    expect(root.querySelectorAll('ol.assembly__steps > li.assembly-step')).toHaveLength(
      plan.steps.length,
    );
  });
});
