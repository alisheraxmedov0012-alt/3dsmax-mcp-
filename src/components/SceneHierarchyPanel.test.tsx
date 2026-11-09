// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { createRoomInstance } from '../scene/roomInstance';
import { roomSelectionId } from '../scene/selectionIds';
import {
  ROOM_DEFAULTS,
  ROOM_OBJECT_ID,
  createTableSceneObject,
  type RoomInstance,
} from '../scene/types';
import { SceneHierarchyPanel } from './SceneHierarchyPanel';

function room(id: string, name: string, visible = true): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: false,
    }),
    name,
    visible,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof SceneHierarchyPanel>[0]> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onToggleVisibility: vi.fn(),
    onDelete: vi.fn(),
    onAddTable: vi.fn(),
    onRename: vi.fn(),
    onFocus: vi.fn(),
  };
  const props = {
    room: { ...ROOM_DEFAULTS },
    rooms: [room('room-a', 'Xona A')],
    objects: [createTableSceneObject('table-1', { name: 'Stol A' })],
    selectedId: roomSelectionId('room-a'),
    ...overrides,
    ...handlers,
  };
  render(<SceneHierarchyPanel {...props} />);
  return handlers;
}

afterEach(() => {
  cleanup();
});

describe('9A.2.11 — Scene Hierarchy panel', () => {
  it('renders Rooms and Furniture groups with selection state', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Scene Hierarchy' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Rooms/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Furniture/ })).toBeTruthy();
    expect(screen.getByText('Xona A').closest('button')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('Stol A').closest('button')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('selects rooms and furniture from hierarchy clicks', () => {
    const handlers = renderPanel({ selectedId: null });
    fireEvent.click(screen.getByText('Xona A'));
    expect(handlers.onSelect).toHaveBeenCalledWith(roomSelectionId('room-a'));
    fireEvent.click(screen.getByText('Stol A'));
    expect(handlers.onSelect).toHaveBeenCalledWith('table-1');
    fireEvent.click(screen.getByText('Xona').closest('button') as HTMLElement);
    expect(handlers.onSelect).toHaveBeenCalledWith(ROOM_OBJECT_ID);
  });

  it('toggles room and furniture visibility and focuses visible items', () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Xona A yashirish' }));
    expect(handlers.onToggleVisibility).toHaveBeenCalledWith(roomSelectionId('room-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Stol A yashirish' }));
    expect(handlers.onToggleVisibility).toHaveBeenCalledWith('table-1');
    fireEvent.click(screen.getByRole('button', { name: 'Xona A ga fokus' }));
    expect(handlers.onFocus).toHaveBeenCalledWith(roomSelectionId('room-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Stol A ga fokus' }));
    expect(handlers.onFocus).toHaveBeenCalledWith('table-1');
  });

  it('blocks selection and focus for hidden items but keeps the restore toggle', () => {
    renderPanel({ rooms: [room('room-a', 'Xona A', false)], selectedId: null });
    const nameButton = screen.getByText('Xona A').closest('button') as HTMLButtonElement;
    expect(nameButton.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Xona A ga fokus' })).toBeNull();
    expect(screen.getByRole('button', { name: "Xona A ko'rsatish" })).toBeTruthy();
    expect(nameButton.closest('li')?.className).toContain('node--hidden');
  });

  it('renames a room through the inline editor and rejects blank names', () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: "Xona A nomini o'zgartirish" }));
    const input = screen.getByRole('textbox', { name: 'Xona A yangi nomi' });
    fireEvent.change(input, { target: { value: 'Yangi xona' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handlers.onRename).toHaveBeenCalledWith(
      roomSelectionId('room-a'),
      'Yangi xona',
    );

    fireEvent.click(screen.getByRole('button', { name: "Stol A nomini o'zgartirish" }));
    const second = screen.getByRole('textbox', { name: 'Stol A yangi nomi' });
    fireEvent.change(second, { target: { value: '   ' } });
    fireEvent.blur(second);
    expect(handlers.onRename).toHaveBeenCalledTimes(1);
  });

  it('does not offer rename or visibility for the legacy room', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: "Xona nomini o'zgartirish" })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xona yashirish' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xona ga fokus' })).toBeTruthy();
  });

  it('shows an empty furniture state and deletes furniture only', () => {
    renderPanel({ objects: [], rooms: [] });
    expect(screen.getByText("Sahnada mebel yo'q.")).toBeTruthy();
    expect(screen.getByText("Sahnada qo'shimcha obyekt yo'q.")).toBeTruthy();

    cleanup();
    const withObject = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: "Stol A o'chirish" }));
    expect(withObject.onDelete).toHaveBeenCalledWith('table-1');
    expect(screen.queryByRole('button', { name: "Xona A o'chirish" })).toBeNull();
  });
});
