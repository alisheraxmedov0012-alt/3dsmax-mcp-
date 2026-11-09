// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HistoryControls } from './HistoryControls';

afterEach(() => {
  cleanup();
});

describe('9A.2.10 — history toolbar controls', () => {
  it('disables undo and redo when both stacks are empty', () => {
    render(
      <HistoryControls canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Bekor qilish' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Qayta qilish' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('enables the buttons from the real history state and calls the handlers', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <HistoryControls canUndo canRedo={false} onUndo={onUndo} onRedo={onRedo} />,
    );
    const undo = screen.getByRole('button', { name: 'Bekor qilish' });
    const redo = screen.getByRole('button', { name: 'Qayta qilish' });
    expect(undo).toHaveProperty('disabled', false);
    expect(redo).toHaveProperty('disabled', true);
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();
  });
});
