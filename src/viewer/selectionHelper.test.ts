import { describe, expect, it } from 'vitest';
import { selectionHelperAction } from './selectionHelper';

describe('selectionHelperAction', () => {
  it('does nothing when there is no helper and no target', () => {
    expect(selectionHelperAction(null, null)).toBe('none');
  });

  it('creates a helper for the first selected target', () => {
    expect(selectionHelperAction(null, { id: 1 })).toBe('create');
  });

  it('updates the existing helper when the scene is rebuilt in place', () => {
    const target = { id: 1 };
    expect(selectionHelperAction(target, target)).toBe('update');
  });

  it('recreates only when the selected object instance changes', () => {
    expect(selectionHelperAction({ id: 1 }, { id: 1 })).toBe('recreate');
  });

  it('disposes the helper when nothing is selected or visible', () => {
    expect(selectionHelperAction({ id: 1 }, null)).toBe('dispose');
  });
});
