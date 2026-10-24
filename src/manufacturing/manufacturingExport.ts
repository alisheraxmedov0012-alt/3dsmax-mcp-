/**
 * W9 manufacturing exports (CSV + JSON).
 *
 * Pure string builders so they are trivially testable and never touch the DOM.
 * Both formats are documented and versioned in the JSON case; the CSV is plain
 * RFC-4180-style with proper quoting.
 */
import { buildExportFilename } from '../export/exportNaming';
import type { BomResult } from './bom';
import type { CutListResult } from './cutList';
import { groupByMaterial } from './sheetMaterial';

export const BOM_JSON_FORMAT = '3d-studio-ai-bom';
export const CUT_LIST_JSON_FORMAT = '3d-studio-ai-cutlist';
export const MANUFACTURING_JSON_VERSION = 1;

/** RFC-4180 style field quoting. */
export function escapeCsv(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function row(fields: Array<string | number | null>): string {
  return fields.map(escapeCsv).join(',');
}

const BOM_HEADER = [
  'Nomi',
  'partId',
  'Turi',
  'Soni',
  'X_mm',
  'Y_mm',
  'Z_mm',
  'Qalinlik_mm',
  'Manba',
  'Material',
  'Izohlar',
];

/** BOM as CSV (millimetres). */
export function bomToCsv(bom: BomResult): string {
  const lines = [row(BOM_HEADER)];
  for (const entry of bom.rows) {
    lines.push(
      row([
        entry.name,
        entry.partId,
        entry.partType,
        entry.quantity,
        entry.sizeMm.x,
        entry.sizeMm.y,
        entry.sizeMm.z,
        entry.thicknessMm,
        'geometry',
        entry.material ? entry.material.name : null,
        entry.notes.join(' '),
      ]),
    );
  }
  lines.push(row(['Jami', '', '', bom.totalParts, '', '', '', '', '', '', '']));
  return lines.join('\n');
}

/**
 * Cut list columns. `Material` is appended after the original seven so existing
 * consumers that read by position keep working unchanged.
 */
const CUT_HEADER = [
  'Nomi',
  'partId',
  'Soni',
  'Uzunlik_mm',
  'Kenglik_mm',
  'Qalinlik_mm',
  'Izohlar',
  'Material',
];

/** Cut list as CSV (millimetres). */
export function cutListToCsv(cutList: CutListResult): string {
  const lines = [row(CUT_HEADER)];
  for (const entry of cutList.rows) {
    lines.push(
      row([
        entry.name,
        entry.partId,
        entry.quantity,
        entry.lengthMm,
        entry.widthMm,
        entry.thicknessMm,
        entry.notes.join(' '),
        entry.material ? entry.material.name : null,
      ]),
    );
  }
  lines.push(row(['Jami', '', cutList.totalPieces, '', '', '', '', '']));
  return lines.join('\n');
}

/** BOM as a versioned JSON document. */
export function bomToJson(bom: BomResult): string {
  return JSON.stringify(
    {
      format: BOM_JSON_FORMAT,
      version: MANUFACTURING_JSON_VERSION,
      unit: bom.unit,
      furnitureType: bom.type,
      totalParts: bom.totalParts,
      panelAreaM2: bom.panelAreaM2,
      materials: groupByMaterial(bom.rows),
      issues: bom.issues,
      limitations: bom.limitations,
      rows: bom.rows,
    },
    null,
    2,
  );
}

/** Cut list as a versioned JSON document. */
export function cutListToJson(cutList: CutListResult): string {
  return JSON.stringify(
    {
      format: CUT_LIST_JSON_FORMAT,
      version: MANUFACTURING_JSON_VERSION,
      unit: cutList.unit,
      totalPieces: cutList.totalPieces,
      panelAreaM2: cutList.panelAreaM2,
      materials: groupByMaterial(cutList.rows),
      limitations: cutList.limitations,
      rows: cutList.rows,
    },
    null,
    2,
  );
}

export type ManufacturingArtifactKind = 'bom-csv' | 'bom-json' | 'cutlist-csv' | 'cutlist-json';

export interface ManufacturingArtifact {
  filename: string;
  mimeType: string;
  content: string;
}

interface BuildArtifactInput {
  kind: ManufacturingArtifactKind;
  name: string;
  furnitureType: string;
  bom: BomResult;
  cutList: CutListResult;
}

/** Build the download artifact for a given manufacturing export. */
export function buildManufacturingArtifact(input: BuildArtifactInput): ManufacturingArtifact {
  const meta = { name: input.name, furnitureType: input.furnitureType, units: 'cm' as const };
  switch (input.kind) {
    case 'bom-csv':
      return {
        filename: buildExportFilename({ ...meta, name: `${meta.name}-bom` }, 'csv'),
        mimeType: 'text/csv',
        content: bomToCsv(input.bom),
      };
    case 'bom-json':
      return {
        filename: buildExportFilename({ ...meta, name: `${meta.name}-bom` }, 'json'),
        mimeType: 'application/json',
        content: bomToJson(input.bom),
      };
    case 'cutlist-csv':
      return {
        filename: buildExportFilename({ ...meta, name: `${meta.name}-cutlist` }, 'csv'),
        mimeType: 'text/csv',
        content: cutListToCsv(input.cutList),
      };
    case 'cutlist-json':
    default:
      return {
        filename: buildExportFilename({ ...meta, name: `${meta.name}-cutlist` }, 'json'),
        mimeType: 'application/json',
        content: cutListToJson(input.cutList),
      };
  }
}
