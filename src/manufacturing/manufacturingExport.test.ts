import { describe, expect, it } from 'vitest';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import {
  BOM_JSON_FORMAT,
  CUT_LIST_JSON_FORMAT,
  MANUFACTURING_JSON_VERSION,
  bomToCsv,
  bomToJson,
  buildManufacturingArtifact,
  cutListToCsv,
  cutListToJson,
  escapeCsv,
} from './manufacturingExport';
import { createFurnitureParams } from '../geometry/furniture/types';

function fixtures() {
  const outcome = buildBom('table', createFurnitureParams('table'));
  if (!outcome.ok) {
    throw new Error('BOM failed');
  }
  return { bom: outcome.bom, cutList: buildCutList(outcome.bom) };
}

describe('escapeCsv', () => {
  it('passes plain values through', () => {
    expect(escapeCsv('abc')).toBe('abc');
    expect(escapeCsv(12)).toBe('12');
    expect(escapeCsv(null)).toBe('');
  });

  it('quotes values containing separators, quotes or newlines', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('bomToCsv', () => {
  it('has a header, one row per part group, and a total row', () => {
    const { bom } = fixtures();
    const lines = bomToCsv(bom).split('\n');
    expect(lines[0]).toContain('partId');
    expect(lines[0]).toContain('Qalinlik_mm');
    // header + 2 table groups + total.
    expect(lines).toHaveLength(bom.rows.length + 2);
    expect(lines[lines.length - 1]).toContain('Jami');
  });

  it('uses millimetres', () => {
    const { bom } = fixtures();
    expect(bomToCsv(bom)).toContain('1200');
  });
});

describe('cutListToCsv', () => {
  it('has a header, rows and a total', () => {
    const { cutList } = fixtures();
    const lines = cutListToCsv(cutList).split('\n');
    expect(lines[0]).toContain('Uzunlik_mm');
    expect(lines).toHaveLength(cutList.rows.length + 2);
    expect(lines[lines.length - 1]).toContain('Jami');
  });
});

describe('JSON exports', () => {
  it('writes a versioned BOM document', () => {
    const { bom } = fixtures();
    const doc = JSON.parse(bomToJson(bom));
    expect(doc.format).toBe(BOM_JSON_FORMAT);
    expect(doc.version).toBe(MANUFACTURING_JSON_VERSION);
    expect(doc.unit).toBe('mm');
    expect(doc.rows.length).toBe(bom.rows.length);
    expect(doc.limitations.length).toBeGreaterThan(0);
  });

  it('writes a versioned cut-list document', () => {
    const { cutList } = fixtures();
    const doc = JSON.parse(cutListToJson(cutList));
    expect(doc.format).toBe(CUT_LIST_JSON_FORMAT);
    expect(doc.version).toBe(MANUFACTURING_JSON_VERSION);
    expect(doc.rows.length).toBe(cutList.rows.length);
  });
});

describe('buildManufacturingArtifact', () => {
  it('names and types each export correctly', () => {
    const { bom, cutList } = fixtures();
    const base = { name: 'Yotoqxona', furnitureType: 'table', bom, cutList };

    const bomCsv = buildManufacturingArtifact({ ...base, kind: 'bom-csv' });
    expect(bomCsv.filename).toBe('yotoqxona-bom-table.csv');
    expect(bomCsv.mimeType).toBe('text/csv');

    const bomJson = buildManufacturingArtifact({ ...base, kind: 'bom-json' });
    expect(bomJson.filename).toBe('yotoqxona-bom-table.json');
    expect(bomJson.mimeType).toBe('application/json');

    const cutCsv = buildManufacturingArtifact({ ...base, kind: 'cutlist-csv' });
    expect(cutCsv.filename).toBe('yotoqxona-cutlist-table.csv');

    const cutJson = buildManufacturingArtifact({ ...base, kind: 'cutlist-json' });
    expect(cutJson.filename).toBe('yotoqxona-cutlist-table.json');
  });

  it('never produces a broken file for a scene-free input', () => {
    const { bom, cutList } = fixtures();
    const artifact = buildManufacturingArtifact({
      kind: 'bom-json',
      name: '',
      furnitureType: 'table',
      bom,
      cutList,
    });
    expect(artifact.filename).toMatch(/\.json$/);
    expect(() => JSON.parse(artifact.content)).not.toThrow();
  });
});
