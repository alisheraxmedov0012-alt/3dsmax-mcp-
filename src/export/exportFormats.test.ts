import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMATS,
  EXPORT_FORMAT_ORDER,
  formatCapabilitySummary,
  isExportFormatId,
} from './exportFormats';

describe('export format registry', () => {
  it('lists every format exactly once', () => {
    expect(new Set(EXPORT_FORMAT_ORDER).size).toBe(EXPORT_FORMAT_ORDER.length);
    for (const id of EXPORT_FORMAT_ORDER) {
      expect(EXPORT_FORMATS[id].id).toBe(id);
    }
  });

  it('does not claim capabilities the pipeline does not provide', () => {
    // GLB: geometry + material + the procedural maps and alpha blending that
    // buildPbrMaterial wires into MeshStandardMaterial (see
    // sceneExport.materials.test.ts, which reads these back out of the .glb).
    expect(EXPORT_FORMATS.glb.capabilities.material).toBe(true);
    expect(EXPORT_FORMATS.glb.capabilities.textures).toBe(true);
    expect(EXPORT_FORMATS.glb.capabilities.transparency).toBe(true);

    // OBJ: geometry only (Three.js OBJExporter emits no .mtl/materials).
    expect(EXPORT_FORMATS.obj.capabilities.geometry).toBe(true);
    expect(EXPORT_FORMATS.obj.capabilities.material).toBe(false);

    // STL: geometry only, no colour/material.
    expect(EXPORT_FORMATS.stl.capabilities.geometry).toBe(true);
    expect(EXPORT_FORMATS.stl.capabilities.material).toBe(false);
    expect(EXPORT_FORMATS.stl.capabilities.textures).toBe(false);

    // JSON: parameters, not a mesh.
    expect(EXPORT_FORMATS.json.capabilities.data).toBe(true);
    expect(EXPORT_FORMATS.json.capabilities.geometry).toBe(false);

    // PNG: a rendered image.
    expect(EXPORT_FORMATS.png.kind).toBe('render');
    expect(EXPORT_FORMATS.png.capabilities.render).toBe(true);
    expect(EXPORT_FORMATS.png.capabilities.geometry).toBe(false);
  });

  it('states the STL and OBJ limitations in their notes', () => {
    expect(EXPORT_FORMATS.stl.notes.join(' ')).toMatch(/SAQLANMAYDI/i);
    expect(EXPORT_FORMATS.stl.notes.join(' ')).toMatch(/manifold/i);
    expect(EXPORT_FORMATS.obj.notes.join(' ')).toMatch(/\.mtl/i);
  });

  it('states the GLB texture and transparency limits in its notes', () => {
    const notes = EXPORT_FORMATS.glb.notes.join(' ');
    expect(notes).toMatch(/base color/i);
    expect(notes).toMatch(/normal map/i);
    expect(notes).toMatch(/128/);
    expect(notes).toMatch(/BLEND/);
    expect(notes).toMatch(/ORM/i);
    expect(notes).toMatch(/BoxGeometry/);
  });

  it('never brings back the stale "no textures" claim for GLB', () => {
    // The exporter has embedded both maps since the A2.1 material work; the
    // registry text lagged behind. Guard so a revert of that fix fails here.
    const notes = EXPORT_FORMATS.glb.notes.join(' ');
    expect(notes).not.toMatch(/hozircha yo[‘']q/i);
    expect(notes).not.toMatch(/mavjud emas/i);
  });

  it('declares a MIME type and extension per format', () => {
    for (const id of EXPORT_FORMAT_ORDER) {
      const spec = EXPORT_FORMATS[id];
      expect(spec.extension.length).toBeGreaterThan(0);
      expect(spec.mimeType).toMatch(/^\w+\/[\w.+-]+$/);
      expect(spec.notes.length).toBeGreaterThan(0);
    }
  });

  it('builds a capability summary from real flags', () => {
    expect(formatCapabilitySummary(EXPORT_FORMATS.glb)).toBe(
      'geometriya, material, tekstura, shaffoflik',
    );
    expect(formatCapabilitySummary(EXPORT_FORMATS.stl)).toBe('geometriya');
    expect(formatCapabilitySummary(EXPORT_FORMATS.json)).toBe('parametrlar');
  });

  it('validates format ids', () => {
    expect(isExportFormatId('glb')).toBe(true);
    expect(isExportFormatId('fbx')).toBe(false);
    expect(isExportFormatId(7)).toBe(false);
  });
});
