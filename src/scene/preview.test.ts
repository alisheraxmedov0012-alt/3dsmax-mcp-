import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CAPTURE_MESSAGE,
  diffSpecs,
  isPreviewApplicable,
  previewCaptureBlockReason,
  previewScene,
} from './preview';
import { createFurnitureSceneObject, createUniversalSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from './types';
import { createDefaultSettings } from './sceneSettings';
import { getFurnitureParameters, updateFurnitureSpec } from './configurator';

function specFor(patch: Record<string, number | boolean>) {
  const defaults = getFurnitureParameters('desk.computer')?.defaults;
  const result = updateFurnitureSpec('desk.computer', defaults, patch);
  if (!result.ok) throw new Error('unexpected validation failure');
  return result.spec;
}

function sceneWithBoth(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [
      createUniversalSceneObject('desk.computer', 'desk-1'),
      createFurnitureSceneObject('table', 'legacy-1'),
    ],
    settings: createDefaultSettings(),
  };
}

describe('previewScene', () => {
  it('shows the proposed spec without mutating the scene data', () => {
    const data = sceneWithBoth();
    const object = data.objects[0];
    if (!object.spec) throw new Error('missing spec');
    const preview = {
      objectId: object.id,
      definitionId: 'desk.computer',
      baseSpec: object.spec,
      spec: specFor({ width: 180 }),
    };

    const rendered = previewScene(data, preview);

    expect(rendered).not.toBe(data);
    expect(rendered.objects[0].spec?.width).toBe(180);
    // The applied scene is untouched.
    expect(data.objects[0].spec?.width).toBe(160);
    // Other objects are the very same references.
    expect(rendered.objects[1]).toBe(data.objects[1]);
    expect(rendered.room).toBe(data.room);
  });

  it('returns the same data when the object is gone', () => {
    const data = sceneWithBoth();
    const object = data.objects[0];
    if (!object.spec) throw new Error('missing spec');

    const rendered = previewScene(data, {
      objectId: 'missing',
      definitionId: 'desk.computer',
      baseSpec: object.spec,
      spec: object.spec,
    });

    expect(rendered).toBe(data);
  });
});

describe('isPreviewApplicable', () => {
  it('accepts a preview of the selected object and its current spec', () => {
    const object = createUniversalSceneObject('desk.computer', 'desk-1');
    if (!object.spec) throw new Error('missing spec');
    const preview = {
      objectId: object.id,
      definitionId: 'desk.computer',
      baseSpec: object.spec,
      spec: specFor({ width: 180 }),
    };

    expect(isPreviewApplicable(preview, object)).toBe(true);
  });

  it('rejects a preview for another object, another definition or a stale base', () => {
    const object = createUniversalSceneObject('desk.computer', 'desk-1');
    if (!object.spec) throw new Error('missing spec');
    const preview = {
      objectId: object.id,
      definitionId: 'desk.computer',
      baseSpec: object.spec,
      spec: specFor({ width: 180 }),
    };

    expect(isPreviewApplicable(preview, null)).toBe(false);
    expect(isPreviewApplicable(preview, { ...object, id: 'other' })).toBe(false);
    // A different base spec means the object changed after the proposal.
    expect(isPreviewApplicable(preview, { ...object, spec: specFor({ width: 150 }) })).toBe(false);
    expect(isPreviewApplicable({ ...preview, definitionId: 'desk.gaming' }, object)).toBe(false);
  });
});

describe('diffSpecs', () => {
  it('reports only the changed channels', () => {
    const base = specFor({});
    const changed = specFor({ width: 180, drawerEnabled: false });

    const diff = diffSpecs(base, changed);

    expect(diff.map((entry) => entry.key).sort()).toEqual(['drawerEnabled', 'width']);
    expect(diff.find((entry) => entry.key === 'width')).toEqual({
      key: 'width',
      before: 160,
      after: 180,
    });
  });

  it('returns nothing for an identical spec', () => {
    const base = specFor({});
    expect(diffSpecs(base, { ...base })).toEqual([]);
  });
});

describe('previewCaptureBlockReason', () => {
  it('blocks image captures while a proposal is pending', () => {
    const object = createUniversalSceneObject('desk.computer', 'desk-1');
    if (!object.spec) throw new Error('missing spec');

    const reason = previewCaptureBlockReason({
      objectId: object.id,
      definitionId: 'desk.computer',
      baseSpec: object.spec,
      spec: specFor({ width: 180 }),
    });

    expect(reason).toBe(PREVIEW_CAPTURE_MESSAGE);
    expect(reason).toContain('Apply yoki Cancel');
  });

  it('allows captures when there is no preview', () => {
    expect(previewCaptureBlockReason(null)).toBeNull();
  });
});
