// @vitest-environment jsdom
/**
 * C8.3 — the lazily loaded manufacturing panel must not degrade the experience.
 *
 * The real panel pulls in the whole manufacturing document stack, so its module
 * is stubbed here; that is the only mock. The Suspense boundary, the error
 * boundary and both user-visible states are the real components, and the
 * pass-through test asserts the panel receives every prop unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ManufacturingPanelFailure, ManufacturingPanelLoading } from './LazyManufacturingPanel';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

const OBJECT = createFurnitureSceneObject('table', 'table-1');
const SCENE: SceneData = {
  schemaVersion: SCENE_SCHEMA_VERSION,
  room: { ...ROOM_DEFAULTS },
  objects: [OBJECT],
  settings: createDefaultSettings(),
};

const panelProps = {
  object: OBJECT,
  projectName: 'Stol loyihasi',
  scene: SCENE,
  onAssignSheetMaterial: () => {},
  onRemoveSheetMaterial: () => {},
  onCapturePreview: async () => null,
};

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock('./ManufacturingPanel');
});

describe('C8.3 lazy manufacturing panel — user-visible states', () => {
  it('reserves the panel slot while the chunk loads', () => {
    render(<ManufacturingPanelLoading />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Panel yuklanmoqda');
    // Reuses the panel's own section class so the sidebar does not jump.
    expect(status.className).toContain('manufacturing');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('offers a retry when the panel chunk failed', () => {
    const onRetry = vi.fn();
    render(<ManufacturingPanelFailure onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Panel yuklanmadi');
    fireEvent.click(screen.getByRole('button', { name: /Qayta urinish/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('C8.3 lazy manufacturing panel — boundary', () => {
  it('passes every prop through to the panel unchanged', async () => {
    const received: Record<string, unknown> = {};
    vi.doMock('./ManufacturingPanel', () => ({
      ManufacturingPanel: (props: Record<string, unknown>) => {
        Object.assign(received, props);
        return <div data-testid="real-panel">{String(props.projectName)}</div>;
      },
    }));
    vi.resetModules();
    const { LazyManufacturingPanel } = await import('./LazyManufacturingPanel');

    render(<LazyManufacturingPanel {...panelProps} />);
    await waitFor(() => expect(screen.getByTestId('real-panel')).toBeTruthy());

    // Every prop, including the callbacks, arrives intact — nothing is dropped
    // or rebound by the wrapper.
    expect(received.object).toBe(panelProps.object);
    expect(received.projectName).toBe('Stol loyihasi');
    expect(received.scene).toBe(panelProps.scene);
    expect(received.onAssignSheetMaterial).toBe(panelProps.onAssignSheetMaterial);
    expect(received.onRemoveSheetMaterial).toBe(panelProps.onRemoveSheetMaterial);
    expect(received.onCapturePreview).toBe(panelProps.onCapturePreview);
  });

  it('renders with a null object too, matching the real panel contract', async () => {
    vi.doMock('./ManufacturingPanel', () => ({
      ManufacturingPanel: (props: { object: unknown }) => (
        <div data-testid="real-panel">{props.object === null ? 'empty' : 'selected'}</div>
      ),
    }));
    vi.resetModules();
    const { LazyManufacturingPanel } = await import('./LazyManufacturingPanel');

    render(<LazyManufacturingPanel {...panelProps} object={null} />);
    await waitFor(() => expect(screen.getByTestId('real-panel').textContent).toBe('empty'));
  });

  it('catches a failed chunk import instead of unmounting the app', async () => {
    vi.doMock('./ManufacturingPanel', () => {
      throw new Error('chunk load failed');
    });
    vi.resetModules();
    const { LazyManufacturingPanel } = await import('./LazyManufacturingPanel');

    render(<LazyManufacturingPanel {...panelProps} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Panel yuklanmadi');
    expect(screen.getByRole('button', { name: /Qayta urinish/ })).toBeTruthy();
  });

  it('keeps showing the error state after a retry that fails again', async () => {
    vi.doMock('./ManufacturingPanel', () => {
      throw new Error('chunk load failed');
    });
    vi.resetModules();
    const { LazyManufacturingPanel } = await import('./LazyManufacturingPanel');

    render(<LazyManufacturingPanel {...panelProps} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Qayta urinish/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
