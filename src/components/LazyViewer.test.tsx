// @vitest-environment jsdom
/**
 * C8.2 — the lazy 3D stage must never leave the user with a blank or broken area.
 *
 * The real viewer builds a WebGL context, which jsdom cannot provide, so the
 * viewer module is stubbed here. That is the only mock: the Suspense boundary,
 * the error boundary and both user-visible states are the real components.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ViewerFailure, ViewerLoading } from './LazyViewer';
import type { SceneData } from '../scene/types';

const SCENE = { objects: [] } as unknown as SceneData;

const viewerProps = {
  scene: SCENE,
  selectedId: null,
  resetToken: 0,
  cameraPreset: 'product' as const,
  cameraPresetToken: 0,
  onSelect: () => {},
  onReady: () => {},
};

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock('./ViewerCanvas');
});

describe('C8.2 lazy viewer — user-visible states', () => {
  it('announces loading politely rather than leaving an empty box', () => {
    render(<ViewerLoading />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('3D ko‘rinish yuklanmoqda');
    // Reuses the canvas class so the placeholder occupies the same box.
    expect(status.className).toContain('viewer');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('offers a retry when the viewer failed to load', () => {
    const onRetry = vi.fn();
    render(<ViewerFailure onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('yuklanmadi');
    fireEvent.click(screen.getByRole('button', { name: /Qayta urinish/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('C8.2 lazy viewer — lazy boundary', () => {
  it('renders the viewer once its chunk resolves', async () => {
    vi.doMock('./ViewerCanvas', () => ({
      ViewerCanvas: () => <div data-testid="real-viewer">canvas</div>,
    }));
    vi.resetModules();
    const { LazyViewer } = await import('./LazyViewer');
    render(<LazyViewer {...viewerProps} />);
    await waitFor(() => expect(screen.getByTestId('real-viewer')).toBeTruthy());
  });

  it('catches a failed chunk import instead of unmounting the app', async () => {
    vi.doMock('./ViewerCanvas', () => {
      throw new Error('chunk load failed');
    });
    vi.resetModules();
    const { LazyViewer } = await import('./LazyViewer');

    render(<LazyViewer {...viewerProps} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('3D ko‘rinish yuklanmadi');
    // The retry affordance is present rather than a dead screen.
    expect(screen.getByRole('button', { name: /Qayta urinish/ })).toBeTruthy();
  });

  it('retries the import after a failure', async () => {
    vi.doMock('./ViewerCanvas', () => {
      throw new Error('chunk load failed');
    });
    vi.resetModules();
    const { LazyViewer } = await import('./LazyViewer');

    render(<LazyViewer {...viewerProps} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // Retry re-renders the boundary; the mock still fails, so the alert returns
    // rather than the screen going blank.
    fireEvent.click(screen.getByRole('button', { name: /Qayta urinish/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
