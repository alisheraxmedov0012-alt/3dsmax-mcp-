// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MaterialPanel } from './MaterialPanel';
import { createFurnitureSceneObject, type SceneObject } from '../scene/types';
import { setCsrfToken } from '../api/csrfStore';
import { listTextureAssets, uploadTextureAsset } from '../api/textureApi';
import type { MaterialAssetMaps, TextureMapRole } from '../materials/asset';
import {
  clearTextureResolutionStatus,
  setTextureResolutionStatus,
} from '../materials/textureStatus';

vi.mock('../api/textureApi', () => ({
  listTextureAssets: vi.fn(),
  uploadTextureAsset: vi.fn(),
}));

vi.mock('../image/textureThumbnail', () => ({
  loadTextureThumbnail: vi.fn(async () => new Blob(['thumb'], { type: 'image/png' })),
}));

vi.mock('../image/textureNormalize', () => ({
  defaultTextureTargetSize: () => 2048,
  normalizeTextureForUpload: vi.fn(async () => ({
    blob: new Blob(['normalized'], { type: 'image/png' }),
    width: 100,
    height: 100,
    thumbnailBlob: new Blob(['thumb'], { type: 'image/png' }),
  })),
  TEXTURE_TARGET_DESKTOP: 2048,
  TEXTURE_TARGET_MOBILE: 1024,
  TEXTURE_THUMBNAIL_SIZE: 128,
}));

const listMock = vi.mocked(listTextureAssets);
const uploadMock = vi.mocked(uploadTextureAsset);

function raw(id: string, filename = `${id}.png`) {
  return {
    id,
    version: 1,
    filename,
    mime_type: 'image/png',
    width: 512,
    height: 256,
    byte_size: 1000,
    content_hash: 'sha256:abc',
    source: { kind: 'bitmap' as const, generator: null },
  };
}

function pngFile(name = 'rough.png'): File {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 100);
  view.setUint32(20, 50);
  const file = new File([bytes], name, { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.buffer.slice(0) as ArrayBuffer,
  });
  return file;
}

function refFor(role: TextureMapRole, id = `tex-${role}`) {
  return {
    id,
    version: 1,
    role,
    colorSpace: role === 'emissive' || role === 'baseColor' ? 'srgb' : 'linear',
    wrap: 'repeat',
  } as const;
}

function objectWith(maps?: MaterialAssetMaps, emissiveIntensity?: number): SceneObject {
  const object = createFurnitureSceneObject('table', 'obj-1');
  return {
    ...object,
    material: {
      ...object.material,
      ...(maps ? { maps } : {}),
      ...(emissiveIntensity === undefined ? {} : { emissiveIntensity }),
    },
  };
}

function renderPanel(object: SceneObject) {
  const onMaterial = vi.fn();
  const onMaterialMap = vi.fn();
  const view = render(
    <MaterialPanel
      object={object}
      onMaterial={onMaterial}
      onApplyPreset={vi.fn()}
      onMaterialMap={onMaterialMap}
      onReset={vi.fn()}
      textureBackendConfigured
    />,
  );
  return { ...view, onMaterial, onMaterialMap };
}

beforeEach(() => {
  setCsrfToken('csrf-token');
  listMock.mockReset();
  uploadMock.mockReset();
  listMock.mockResolvedValue([raw('tex-1', 'surface.png'), raw('tex-2', 'rough.png')]);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:texture'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  setCsrfToken(null);
  clearTextureResolutionStatus('obj-1');
  vi.unstubAllGlobals();
});

describe('MaterialPanel advanced PBR maps', () => {
  it('explains ORM channel packing', async () => {
    renderPanel(objectWith());
    const note = await screen.findByTestId('texture-orm-note');
    expect(note.textContent).toContain('R');
    expect(note.textContent).toContain('Ambient Occlusion');
    expect(note.textContent).toContain('G');
    expect(note.textContent).toContain('Roughness');
    expect(note.textContent).toContain('B');
    expect(note.textContent).toContain('Metalness');
  });

  it('applies a library texture to the selected roughness slot', async () => {
    const { onMaterialMap } = renderPanel(objectWith());
    fireEvent.click(screen.getByTestId('map-role-roughness'));

    const item = await screen.findByTestId('texture-map-item-roughness-tex-1');
    fireEvent.click(item);

    expect(onMaterialMap).toHaveBeenCalledWith('roughness', {
      id: 'tex-1',
      version: 1,
      role: 'roughness',
      colorSpace: 'linear',
      wrap: 'repeat',
    });
  });

  it('applies an emissive texture with sRGB colour space', async () => {
    const { onMaterialMap } = renderPanel(objectWith());
    fireEvent.click(screen.getByTestId('map-role-emissive'));
    fireEvent.click(await screen.findByTestId('texture-map-item-emissive-tex-1'));

    expect(onMaterialMap).toHaveBeenCalledWith(
      'emissive',
      expect.objectContaining({ role: 'emissive', colorSpace: 'srgb' }),
    );
  });

  it('shows the current map and removes it', async () => {
    const { onMaterialMap } = renderPanel(
      objectWith({ normal: refFor('normal') }),
    );
    fireEvent.click(screen.getByTestId('map-role-normal'));

    expect(screen.getByTestId('texture-map-current').textContent).toContain('tex-norm');
    fireEvent.click(
      screen.getByRole('button', { name: 'Normal kartasini olib tashlash' }),
    );
    expect(onMaterialMap).toHaveBeenCalledWith('normal', null);
  });

  it('uploads a file into the active map slot', async () => {
    uploadMock.mockResolvedValue(raw('tex-new', 'uploaded.png'));
    const { onMaterialMap } = renderPanel(objectWith());
    fireEvent.click(screen.getByTestId('map-role-metalness'));

    const input = screen.getByLabelText('Metalness fayli');
    fireEvent.change(input, { target: { files: [pngFile()] } });

    await waitFor(() => expect(onMaterialMap).toHaveBeenCalled());
    expect(onMaterialMap).toHaveBeenCalledWith('metalness', {
      id: 'tex-new',
      version: 1,
      role: 'metalness',
      colorSpace: 'linear',
      wrap: 'repeat',
    });
    expect(await screen.findByTestId('texture-map-message')).toBeTruthy();
  });

  it('shows an error and does not apply an invalid upload', async () => {
    const { onMaterialMap } = renderPanel(objectWith());
    fireEvent.click(screen.getByTestId('map-role-ao'));

    const file = new File([new Uint8Array([1, 2, 3])], 'bad.svg', { type: 'image/svg+xml' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    fireEvent.change(screen.getByLabelText('Ambient Occlusion fayli'), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(screen.getByTestId('texture-map-message').textContent).toBeTruthy(),
    );
    expect(onMaterialMap).not.toHaveBeenCalled();
  });

  it('sends the normal and emissive scalar controls', async () => {
    const { onMaterial } = renderPanel(objectWith(undefined, 1.5));
    fireEvent.change(await screen.findByLabelText(/Normal karta kuchi/), {
      target: { value: '0.8' },
    });
    expect(onMaterial).toHaveBeenCalledWith({ normalStrength: 0.8 });

    fireEvent.change(screen.getByLabelText(/Emissive kuchi/), {
      target: { value: '3' },
    });
    expect(onMaterial).toHaveBeenCalledWith({ emissiveIntensity: 3 });
  });

  it('sends base colour, emissive colour and AO intensity', async () => {
    const { onMaterial } = renderPanel(objectWith(undefined, 1));
    fireEvent.change(await screen.findByLabelText('Base Color (albedo)'), {
      target: { value: '#abcdef' },
    });
    expect(onMaterial).toHaveBeenCalledWith({ baseColor: '#abcdef' });

    fireEvent.change(screen.getByLabelText('Emissive rang'), {
      target: { value: '#3366ff' },
    });
    expect(onMaterial).toHaveBeenCalledWith({ emissiveColor: '#3366ff' });

    fireEvent.change(screen.getByLabelText(/AO kuchi/), {
      target: { value: '0.4' },
    });
    expect(onMaterial).toHaveBeenCalledWith({ aoIntensity: 0.4 });
  });

  it('routes the base colour through the dedicated callback when provided', async () => {
    const onBaseColor = vi.fn();
    const onMaterial = vi.fn();
    render(
      <MaterialPanel
        object={objectWith()}
        onMaterial={onMaterial}
        onApplyPreset={vi.fn()}
        onMaterialMap={vi.fn()}
        onBaseColor={onBaseColor}
        onReset={vi.fn()}
        textureBackendConfigured
      />,
    );
    fireEvent.change(await screen.findByLabelText('Base Color (albedo)'), {
      target: { value: '#abcdef' },
    });
    expect(onBaseColor).toHaveBeenCalledWith('#abcdef');
    expect(onMaterial).not.toHaveBeenCalledWith({ baseColor: '#abcdef' });
  });

  it('shows the current library name for an assigned map', async () => {
    renderPanel(objectWith({ ao: refFor('ao', 'tex-1') }));
    fireEvent.click(screen.getByTestId('map-role-ao'));
    await waitFor(() =>
      expect(screen.getByTestId('texture-map-current').textContent).toContain('surface.png'),
    );
  });

  it('surfaces viewer loading and error states for the assigned maps', async () => {
    setTextureResolutionStatus('obj-1', { state: 'loading' });
    const view = renderPanel(objectWith({ normal: refFor('normal') }));
    fireEvent.click(screen.getByTestId('map-role-normal'));
    expect(screen.getAllByText(/3D ko'rinishda tekstura yuklanmoqda/).length).toBeGreaterThan(0);

    setTextureResolutionStatus('obj-1', {
      state: 'error',
      message: 'Normal: server xatosi.',
    });
    view.rerender(
      <MaterialPanel
        object={objectWith({ normal: refFor('normal') })}
        onMaterial={vi.fn()}
        onApplyPreset={vi.fn()}
        onMaterialMap={vi.fn()}
        onReset={vi.fn()}
        textureBackendConfigured
      />,
    );
    expect((await screen.findAllByText(/Normal: server xatosi/)).length).toBeGreaterThan(0);
  });
});
