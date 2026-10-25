// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductPackagePanel } from './ProductPackagePanel';
import { buildBom } from '../manufacturing/bom';
import { buildCutList } from '../manufacturing/cutList';
import { buildCuttingPlan } from '../manufacturing/cuttingPlan';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';
import type { SheetMaterialEntry } from '../manufacturing/sheetMaterial';

const SETTINGS = {
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  kerfMm: 4,
  allowRotation: true,
} as const;

function materialsFor(type: FurnitureType): SheetMaterialEntry[] {
  const bom = buildBom(type, createFurnitureParams(type));
  if (!bom.ok) throw new Error(bom.reason);
  return bom.bom.rows.map((row) => ({
    partId: row.partId,
    materialId: 'ldsp',
    thicknessMm: 18,
    thicknessSource: 'user',
  }));
}

function objectFor(type: FurnitureType = 'table', withMaterials = true): SceneObject {
  return createFurnitureSceneObject(type, `${type}-1`, {
    sheetMaterials: withMaterials ? materialsFor(type) : [],
  });
}

function sceneWith(object: SceneObject): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
}

function planFor(object: SceneObject) {
  const bom = buildBom(object.type, object.params, object.sheetMaterials);
  if (!bom.ok) throw new Error(bom.reason);
  const outcome = buildCuttingPlan({
    cutList: buildCutList(bom.bom),
    bom: bom.bom,
    settings: SETTINGS,
  });
  return outcome.ok ? outcome.plan : null;
}

function renderPanel(options: {
  object?: SceneObject | null;
  cuttingPlan?: ReturnType<typeof planFor>;
  onCapturePreview?: () => Promise<Blob | null>;
} = {}) {
  const object = options.object === undefined ? objectFor() : options.object;
  const scene = object ? sceneWith(object) : { ...sceneWith(objectFor()), objects: [] };
  const cuttingPlan = options.cuttingPlan === undefined && object ? planFor(object) : options.cuttingPlan ?? null;
  render(
    <ProductPackagePanel
      object={object}
      scene={scene}
      projectName="Stol loyihasi"
      cuttingPlan={cuttingPlan}
      onCapturePreview={options.onCapturePreview}
    />,
  );
}

const checkButton = () => screen.getByTestId('product-check') as HTMLButtonElement;

afterEach(() => {
  cleanup();
});

describe('C8 panel — before checking', () => {
  it('explains the package and shows no verdict yet', () => {
    renderPanel();
    expect(screen.getByTestId('product-package')).toBeTruthy();
    expect(screen.queryByTestId('product-verdict')).toBeNull();
    expect(checkButton().textContent).toContain('Tayyorlikni tekshirish');
  });

  it('asks for a selection when nothing is selected', () => {
    renderPanel({ object: null });
    expect(screen.getByTestId('product-package').textContent).toMatch(/mebelni tanlang/i);
    expect(screen.queryByTestId('product-check')).toBeNull();
  });

  it('names the product and material state', () => {
    renderPanel();
    const context = screen.getByTestId('product-context').textContent ?? '';
    expect(context).toContain('Stol');
    expect(context).toMatch(/tayinlangan/);
  });
});

describe('C8 panel — readiness result', () => {
  it('runs the check and renders every check with its status word', async () => {
    renderPanel();
    fireEvent.click(checkButton());

    await waitFor(() => expect(screen.getByTestId('product-verdict')).toBeTruthy());

    const checks = screen.getAllByTestId(/^product-check-[a-z-]+$/);
    expect(checks.length).toBeGreaterThanOrEqual(10);

    // Each row prints the status in words, not only in colour.
    for (const row of checks) {
      const text = row.textContent ?? '';
      expect(text).toMatch(/Tayyor|Ogohlantirish|Xato|Qo'llanmaydi/);
    }
    expect(screen.getByTestId('product-check-package').textContent).toMatch(/Tayyor/);
    expect(screen.getByTestId('product-check-pdf').textContent).toMatch(/Tayyor/);
  });

  it('shows the overall verdict with counts', async () => {
    renderPanel();
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-verdict')).toBeTruthy());
    const verdict = screen.getByTestId('product-verdict').textContent ?? '';
    expect(verdict).toMatch(/Umumiy holat/);
    expect(verdict).toMatch(/tayyor/);
    expect(verdict).toMatch(/ogohlantirish/);
  });

  it('surfaces a failing check instead of a green result', async () => {
    // No material: the cutting check cannot succeed.
    renderPanel({ object: objectFor('table', false) });
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-verdict')).toBeTruthy());

    const cutting = screen.getByTestId('product-check-cutting').textContent ?? '';
    expect(cutting).toMatch(/Ogohlantirish|Xato/);
    expect(screen.getByTestId('product-check-materials').textContent).toMatch(/Ogohlantirish/);
  });

  it('reports a model that cannot be packaged at all', async () => {
    renderPanel({ object: objectFor('sofa') });
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-error')).toBeTruthy());
    expect(screen.getByTestId('product-error').textContent).toMatch(/kesish|Kesish|paket/i);
    expect(screen.queryByTestId('product-download')).toBeNull();
  });
});

describe('C8 panel — downloads and description', () => {
  it('offers the package and the English description once ready', async () => {
    renderPanel();
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-download')).toBeTruthy());
    expect(screen.getByTestId('product-download-description')).toBeTruthy();
    expect(checkButton().textContent).toContain('qayta tekshirish');
  });

  it('renders the English description from the model', async () => {
    renderPanel();
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-description')).toBeTruthy());

    const text = screen.getByTestId('product-description').textContent ?? '';
    expect(text).toContain('Dining Table');
    expect(text).toContain('1200 mm W');
    expect(text).toContain('LDSP');
    expect(text).toMatch(/product-description\.md/);
  });

  it('states the limitations and never claims certification', async () => {
    renderPanel();
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-limitations')).toBeTruthy());

    const text = screen.getByTestId('product-limitations').textContent ?? '';
    expect(text).toMatch(/sertifikat/i);
    expect(text).toMatch(/evristik/i);
    expect(text).toMatch(/mutaxassis/i);
    expect(text).not.toMatch(/sertifikatlangan mahsulot/i);
  });

  it('marks the result stale when the model changes', async () => {
    const object = objectFor();
    const { rerender } = render(
      <ProductPackagePanel
        object={object}
        scene={sceneWith(object)}
        projectName="Stol loyihasi"
        cuttingPlan={planFor(object)}
      />,
    );
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-verdict')).toBeTruthy());
    expect(screen.queryByTestId('product-stale')).toBeNull();

    const changed = {
      ...object,
      params: { ...object.params, widthCm: 180 },
    } as SceneObject;
    rerender(
      <ProductPackagePanel
        object={changed}
        scene={sceneWith(changed)}
        projectName="Stol loyihasi"
        cuttingPlan={planFor(changed)}
      />,
    );

    const stale = screen.getByTestId('product-stale');
    expect(stale.textContent).toMatch(/o‘zgargan/);
  });

  it('warns that no cutting layout was supplied', async () => {
    renderPanel({ cuttingPlan: null });
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-verdict')).toBeTruthy());
    const cutting = screen.getByTestId('product-check-cutting').textContent ?? '';
    expect(cutting).toMatch(/Ogohlantirish/);
    expect(cutting).toMatch(/hisoblanmagan/i);
  });

  it('spells out the machine-readable cutting reason', async () => {
    renderPanel({ cuttingPlan: null });
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-verdict')).toBeTruthy());
    // C8.6.2: the panel explains *why* the layout is missing, not just that it is.
    const reason = screen.getByTestId('product-reason-cutting').textContent ?? '';
    expect(reason).toMatch(/Sabab:/);
    expect(reason).toMatch(/hisoblanmagan/i);
  });
});

describe('A2.2 panel — preview shots reach the package', () => {
  function png(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = [
      0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    return new Uint8Array([...signature, ...ihdr]);
  }

  it('captures previews before packaging and includes them', async () => {
    const object = objectFor('table');
    const onCaptureProductPreviews = vi.fn(async () => [
      { name: 'preview-front.png', bytes: png() },
      { name: 'preview-side.png', bytes: png() },
    ]);

    render(
      <ProductPackagePanel
        object={object}
        scene={sceneWith(object)}
        projectName="Stol loyihasi"
        cuttingPlan={planFor(object)}
        onCaptureProductPreviews={onCaptureProductPreviews}
      />,
    );
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-verdict')).toBeTruthy());

    expect(onCaptureProductPreviews).toHaveBeenCalledTimes(1);
    // Two shots requested, so the package reports fourteen files, not twelve.
    const pkg = screen.getByTestId('product-check-package').textContent ?? '';
    expect(pkg).toMatch(/14 fayl/);
  });

  it('packages without previews when the viewer is not ready', async () => {
    const object = objectFor('table');
    render(
      <ProductPackagePanel
        object={object}
        scene={sceneWith(object)}
        projectName="Stol loyihasi"
        cuttingPlan={planFor(object)}
        onCaptureProductPreviews={async () => null}
      />,
    );
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-verdict')).toBeTruthy());

    const pkg = screen.getByTestId('product-check-package').textContent ?? '';
    expect(pkg).toMatch(/12 fayl/);
  });

  it('surfaces a capture failure instead of shipping a text-only bundle silently', async () => {
    const object = objectFor('table');
    render(
      <ProductPackagePanel
        object={object}
        scene={sceneWith(object)}
        projectName="Stol loyihasi"
        cuttingPlan={planFor(object)}
        onCaptureProductPreviews={async () => {
          throw new Error('renderer yo‘q');
        }}
      />,
    );
    fireEvent.click(checkButton());
    await waitFor(() => expect(screen.getByTestId('product-error')).toBeTruthy());
    expect(screen.getByTestId('product-error').textContent).toMatch(/Preview rasmlarini olishda xatolik/);
  });
});

describe('C8 panel — 3D preview', () => {
  it('does not offer a preview when the app supplies no capture handler', () => {
    renderPanel();
    expect(screen.queryByTestId('product-preview')).toBeNull();
  });

  it('shows the captured image with an honest caption', async () => {
    const onCapturePreview = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    renderPanel({ onCapturePreview });
    fireEvent.click(screen.getByTestId('product-preview'));

    await waitFor(() => expect(screen.getByTestId('product-preview-image')).toBeTruthy());
    expect(onCapturePreview).toHaveBeenCalledWith('preview');
    const caption = screen.getByTestId('product-preview-image').textContent ?? '';
    expect(caption).toMatch(/fotosurat yoki fotorealistik render emas/i);
  });

  it('reports a capture that produced nothing', async () => {
    const onCapturePreview = vi.fn(async () => null);
    renderPanel({ onCapturePreview });
    fireEvent.click(screen.getByTestId('product-preview'));
    await waitFor(() => expect(screen.getByTestId('product-error')).toBeTruthy());
    expect(screen.getByTestId('product-error').textContent).toMatch(/3D/);
  });
});
