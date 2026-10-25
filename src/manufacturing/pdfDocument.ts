/**
 * C5 — PDF manufacturing document.
 *
 * Composes the documents earlier stages already produce (C2 drawing, C1 BOM and
 * cut list, C3 materials, C4 validation) into one readable PDF. It reads those
 * sources and never recomputes them: a PDF that disagreed with the CSV export
 * would be worse than no PDF.
 *
 * Layout: A4. The body is portrait; the drawing gets its own landscape page,
 * because shrinking a 1:5 sheet into a portrait column would make the dimension
 * text unreadable rather than merely small. The drawing is fitted with one scale
 * factor for both axes, so its proportions stay true, and the document states
 * plainly that a printout is not guaranteed to be to the SVG's stated scale.
 *
 * This document is documentation, not a certificate: every report finishes with
 * what was not checked, and an export with validation errors is still produced
 * (it is useful for inspection) but is clearly marked as failing.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { nameDigest, slugifyName } from '../export/exportNaming';
import { FURNITURE_TYPE_LABELS, type FurnitureParams, type FurnitureType } from '../geometry/furniture/types';
import type { BomResult } from './bom';
import type { CutListResult } from './cutList';
import type { MaterialGroup } from './sheetMaterial';
import type { ValidationReport } from './validation';
import { PDF_FONT_BOLD_B64, PDF_FONT_REGULAR_B64 } from './pdfFont';
import { parseDrawingSvg, renderDrawing } from './pdfDrawing';
import {
  ASSEMBLY_RELATION_LABELS,
  ASSEMBLY_STATUS_LABELS,
  type AssemblyPlan,
} from './assemblyInstructions';
import {
  CUTTING_STATUS_LABELS,
  UNPLACED_REASON_LABELS,
  type CuttingPlan,
  type PlacedPiece,
} from './cuttingPlan';

export interface PdfDrawingInput {
  /** The SVG produced by `createTechnicalDrawingSvg`. */
  svg: string;
  /** Scale the drawing generator reported, printed verbatim. */
  scale: { ratio: string; standard: boolean };
}

export interface PdfDocumentInput {
  type: FurnitureType;
  params: FurnitureParams;
  projectName: string;
  bom: BomResult;
  cutList: CutListResult;
  materials: MaterialGroup[];
  validation: ValidationReport;
  drawing: PdfDrawingInput;
  overall: { widthMm: number; heightMm: number; depthMm: number };
  /**
   * C6 assembly instructions.
   *
   * Optional so every pre-C6 caller keeps producing the same document: without a
   * plan the section is absent and the numbering is unchanged. With a plan — even
   * an `unsupported` one — the section appears and states why it is empty rather
   * than leaving a silent gap where a workshop expects guidance.
   */
  assembly?: AssemblyPlan | null;
  /**
   * C7 material usage and cutting plan.
   *
   * Optional for the same reason as `assembly`: without it the document is the
   * pre-C7 one, byte for byte, including the section numbering. With it, a
   * section is inserted after the material list and the numbers below shift.
   */
  cuttingPlan?: CuttingPlan | null;
  /** Export timestamp; injected so the same input yields identical bytes. */
  generatedAt: Date;
}

export type PdfOutcome =
  | {
      // `ArrayBuffer`-backed, because `BlobPart` rejects the wider
      // `ArrayBufferLike` that pdf-lib's return type carries. `doc.save()`
      // allocates a fresh, exactly-sized buffer, so the narrower type is true.
      ok: true;
      bytes: Uint8Array<ArrayBuffer>;
      filename: string;
      pageCount: number;
      notes: string[];
    }
  | { ok: false; reason: string };

const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const MARGIN = 46;
const FOOTER_HEIGHT = 26;

const INK = rgb(0.09, 0.1, 0.12);
const MUTED = rgb(0.36, 0.39, 0.43);
const RULE = rgb(0.78, 0.79, 0.81);
const ERROR_INK = rgb(0.72, 0.16, 0.16);
const WARN_INK = rgb(0.68, 0.45, 0.09);
const PANEL_FILL = rgb(0.95, 0.96, 0.97);
/** Tint for a rotated piece, so a turned part is visible on the diagram too. */
const TINT = rgb(0.88, 0.92, 0.96);

const TITLE = 'Mebel ishlab chiqarish hujjatlari';

interface Column {
  header: string;
  /** Fraction of the content width. */
  weight: number;
  align?: 'left' | 'right';
}

/** A table row: pre-formatted cell strings, already in the source's units. */
export type Row = string[];

function base64ToBytes(base64: string): Uint8Array {
  // Browser and Node both expose atob in the supported targets; Buffer is a
  // fallback for environments without it.
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  const globalBuffer = (globalThis as { Buffer?: { from(input: string, enc: string): Uint8Array } })
    .Buffer;
  if (globalBuffer) {
    return new Uint8Array(globalBuffer.from(base64, 'base64'));
  }
  throw new Error('Base64 decoder topilmadi.');
}

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Safe, collision-resistant filename, mirroring the C1.1 archive rule. */
export function pdfFilename(projectName: string): string {
  return `${slugifyName(projectName, 'model')}-${nameDigest(projectName)}-hujjatlar.pdf`;
}

/**
 * Stateful layout helper.
 *
 * Keeps the "where am I on the page" bookkeeping in one place so a table can
 * break across pages without losing its header.
 */
class Layout {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private cursorY = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly portrait: [number, number] = A4_PORTRAIT,
  ) {
    this.addPage();
  }

  get width(): number {
    return this.page.getWidth();
  }

  get contentWidth(): number {
    return this.width - MARGIN * 2;
  }

  get bottomLimit(): number {
    return MARGIN + FOOTER_HEIGHT;
  }

  private addPage(): void {
    this.page = this.doc.addPage(this.portrait);
    this.pages.push(this.page);
    this.cursorY = this.page.getHeight() - MARGIN;
  }

  /** Force a new page (used for the landscape drawing sheet). */
  newPage(size: [number, number] = this.portrait): void {
    this.page = this.doc.addPage(size);
    this.pages.push(this.page);
    this.cursorY = this.page.getHeight() - MARGIN;
  }

  get y(): number {
    return this.cursorY;
  }

  set y(value: number) {
    this.cursorY = value;
  }

  ensure(height: number): void {
    if (this.cursorY - height < this.bottomLimit) {
      this.addPage();
    }
  }

  wrap(text: string, size: number, font: PDFFont, maxWidth: number): string[] {
    const words = text.split(/\s+/).filter((word) => word !== '');
    if (words.length === 0) {
      return [''];
    }
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== '') {
        lines.push(current);
      }
      // A single word longer than the column still has to be broken.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const char of word) {
          if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk !== '') {
            lines.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
    if (current !== '') {
      lines.push(current);
    }
    return lines;
  }

  heading(text: string, size = 15): void {
    const lines = this.wrap(text, size, this.bold, this.contentWidth);
    this.ensure(lines.length * (size + 4) + 12);
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN,
        y: this.cursorY - size,
        size,
        font: this.bold,
        color: INK,
      });
      this.cursorY -= size + 4;
    }
    this.cursorY -= 8;
  }

  subheading(text: string, size = 11): void {
    const lines = this.wrap(text, size, this.bold, this.contentWidth);
    this.ensure(lines.length * (size + 3) + 6);
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN,
        y: this.cursorY - size,
        size,
        font: this.bold,
        color: INK,
      });
      this.cursorY -= size + 3;
    }
    this.cursorY -= 4;
  }

  /** Draw a paragraph. `color` lets validation errors and warnings stand apart. */
  paragraph(text: string, size = 9.5, color = MUTED, indent = 0): void {
    const lines = this.wrap(text, size, this.regular, this.contentWidth - indent);
    this.ensure(lines.length * (size + 2.5));
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.cursorY - size,
        size,
        font: this.regular,
        color,
      });
      this.cursorY -= size + 2.5;
    }
  }

  gap(points: number): void {
    this.cursorY -= points;
  }

  rule(): void {
    this.ensure(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.cursorY },
      end: { x: this.width - MARGIN, y: this.cursorY },
      thickness: 0.6,
      color: RULE,
    });
    this.cursorY -= 8;
  }

  /** Key/value block used by the cover. */
  keyValues(entries: Array<[string, string]>, size = 10): void {
    const labelWidth = 150;
    for (const [label, value] of entries) {
      const valueLines = this.wrap(value, size, this.regular, this.contentWidth - labelWidth);
      this.ensure(Math.max(valueLines.length * (size + 3), size + 3) + 2);
      this.page.drawText(label, {
        x: MARGIN,
        y: this.cursorY - size,
        size,
        font: this.bold,
        color: MUTED,
      });
      let lineY = this.cursorY;
      for (const line of valueLines) {
        this.page.drawText(line, {
          x: MARGIN + labelWidth,
          y: lineY - size,
          size,
          font: this.regular,
          color: INK,
        });
        lineY -= size + 3;
      }
      this.cursorY = Math.min(this.cursorY - (size + 3), lineY) - 1;
    }
  }

  /**
   * Render a table, repeating the header on every page it spans.
   *
   * Row heights come from the tallest wrapped cell, so nothing is clipped and no
   * row is split mid-line across a page boundary.
   */
  table(columns: Column[], rows: Row[], size = 8.2): void {
    const widths = columns.map((column) => this.contentWidth * column.weight);
    const lineHeight = size + 2.6;
    const padding = 3;

    const drawHeader = () => {
      this.ensure(lineHeight + padding * 2 + 6);
      let x = MARGIN;
      for (let index = 0; index < columns.length; index += 1) {
        this.page.drawText(columns[index].header, {
          x,
          y: this.cursorY - size,
          size,
          font: this.bold,
          color: INK,
        });
        x += widths[index];
      }
      this.cursorY -= size + padding;
      this.page.drawLine({
        start: { x: MARGIN, y: this.cursorY },
        end: { x: this.width - MARGIN, y: this.cursorY },
        thickness: 0.7,
        color: RULE,
      });
      this.cursorY -= padding;
    };

    drawHeader();

    for (const row of rows) {
      const cells = row.map((cell, index) =>
        this.wrap(cell ?? '', size, this.regular, widths[index] - 4),
      );
      const rowHeight = Math.max(...cells.map((lines) => lines.length)) * lineHeight + padding * 2;

      if (this.cursorY - rowHeight < this.bottomLimit) {
        this.newPage();
        drawHeader();
      }

      const rowTop = this.cursorY;
      let x = MARGIN;
      for (let index = 0; index < cells.length; index += 1) {
        const align = columns[index].align ?? 'left';
        let lineY = rowTop;
        for (const line of cells[index]) {
          const textWidth = this.regular.widthOfTextAtSize(line, size);
          const drawX =
            align === 'right' ? x + widths[index] - 4 - textWidth : x;
          this.page.drawText(line, {
            x: Math.max(drawX, x),
            y: lineY - size,
            size,
            font: this.regular,
            color: INK,
          });
          lineY -= lineHeight;
        }
        x += widths[index];
      }
      this.cursorY = rowTop - rowHeight;

      this.page.drawLine({
        start: { x: MARGIN, y: this.cursorY + 1 },
        end: { x: this.width - MARGIN, y: this.cursorY + 1 },
        thickness: 0.3,
        color: RULE,
      });
    }
    this.cursorY -= 6;
  }

  /** Callout box, used for the validation verdict and unassigned-material notice. */
  callout(title: string, body: string[], color = INK, fill = PANEL_FILL): void {
    const size = 9.5;
    const innerWidth = this.contentWidth - 20;
    const wrapped = body.flatMap((line) => this.wrap(line, size, this.regular, innerWidth));
    const height = 16 + size + 6 + wrapped.length * (size + 2.5) + 8;
    this.ensure(height + 6);
    const top = this.cursorY;
    this.page.drawRectangle({
      x: MARGIN,
      y: top - height,
      width: this.contentWidth,
      height,
      color: fill,
    });
    this.page.drawText(title, {
      x: MARGIN + 10,
      y: top - 8 - size,
      size,
      font: this.bold,
      color,
    });
    let lineY = top - 8 - size - 6 - size;
    for (const line of wrapped) {
      this.page.drawText(line, {
        x: MARGIN + 10,
        y: lineY,
        size,
        font: this.regular,
        color,
      });
      lineY -= size + 2.5;
    }
    this.cursorY = top - height - 8;
  }

  /**
   * Draw one cutting sheet to scale, with each placed piece in its position.
   *
   * The diagram uses a single scale for both axes, so proportions stay true and a
   * rectangle's place on the page is its place on the board. The scale is chosen
   * to fit the text column and `maxHeight`, which keeps every sheet on the page
   * it starts on instead of splitting a diagram across two pages.
   */
  cuttingSheet(
    sheetLengthMm: number,
    sheetWidthMm: number,
    placements: readonly PlacedPiece[],
    maxHeight = 128,
  ): void {
    if (sheetLengthMm <= 0 || sheetWidthMm <= 0) {
      return;
    }
    const scale = Math.min(this.contentWidth / sheetLengthMm, maxHeight / sheetWidthMm);
    const width = sheetLengthMm * scale;
    const height = sheetWidthMm * scale;
    this.ensure(height + 12);
    const originX = MARGIN;
    const originY = this.cursorY - height;

    this.page.drawRectangle({
      x: originX,
      y: originY,
      width,
      height,
      borderColor: RULE,
      borderWidth: 0.7,
    });
    const labelSize = 3.8;
    for (const piece of placements) {
      this.page.drawRectangle({
        x: originX + piece.xMm * scale,
        y: originY + piece.yMm * scale,
        width: piece.widthMm * scale,
        height: piece.heightMm * scale,
        borderColor: MUTED,
        borderWidth: 0.4,
        color: piece.rotated ? TINT : undefined,
      });
      const pieceWidth = piece.widthMm * scale;
      const pieceHeight = piece.heightMm * scale;
      if (pieceWidth > 26 && pieceHeight > 8) {
        this.page.drawText(piece.partId, {
          x: originX + piece.xMm * scale + 1.5,
          y: originY + piece.yMm * scale + pieceHeight - labelSize - 1,
          size: labelSize,
          font: this.regular,
          color: MUTED,
        });
      }
    }
    this.cursorY = originY - 10;
  }

  /** Footer with the page number and title, applied once the total is known. */
  stampFooters(): void {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const y = MARGIN - 8;
      page.drawLine({
        start: { x: MARGIN, y: y + 12 },
        end: { x: page.getWidth() - MARGIN, y: y + 12 },
        thickness: 0.4,
        color: RULE,
      });
      page.drawText(`${TITLE} · ${index + 1} / ${total}`, {
        x: MARGIN,
        y,
        size: 7.5,
        font: this.regular,
        color: MUTED,
      });
      const notice = 'Dastlabki hujjat — ishlab chiqarishga yaroqlilik sertifikati emas';
      const noticeWidth = this.regular.widthOfTextAtSize(notice, 7.5);
      page.drawText(notice, {
        // Right-aligned from the real text width, not an assumed box.
        x: page.getWidth() - MARGIN - noticeWidth,
        y,
        size: 7.5,
        font: this.regular,
        color: MUTED,
      });
    });
  }
}

function join(values: string[], separator = ', '): string {
  return values.filter((value) => value !== '').join(separator);
}

/**
 * The document's tables as plain data.
 *
 * Exported and pure so the content can be asserted directly in tests: the PDF
 * itself stores text as glyph indices, which no assertion can read back without
 * a CMap parser. The renderer consumes these same functions, so what is tested is
 * exactly what is printed.
 */
export function bomTableRows(bom: BomResult): Row[] {
  return bom.rows.map((row) => [
    row.name,
    row.partId,
    row.partType,
    String(row.quantity),
    String(row.sizeMm.x),
    String(row.sizeMm.y),
    String(row.sizeMm.z),
    // Measured geometry thickness — never the nominal material thickness.
    row.thicknessMm === null ? '—' : String(row.thicknessMm),
    row.material ? row.material.name : '',
  ]);
}

export function cutListTableRows(cutList: CutListResult): Row[] {
  return cutList.rows.map((row) => [
    row.name,
    row.partId,
    String(row.quantity),
    // No rounding: the source value is printed exactly as the CSV has it.
    String(row.lengthMm),
    String(row.widthMm),
    String(row.thicknessMm),
    row.material ? row.material.name : '',
  ]);
}

export function materialTableRows(materials: MaterialGroup[]): Row[] {
  return materials.map((group) => [
    group.name,
    group.materialId,
    `${group.thicknessMm} ${group.unit}`,
    String(group.totalPieces),
    join(group.partIds, ', '),
  ]);
}

export function validationTableRows(issues: ValidationReport['issues']): Row[] {
  return issues
    .filter((issue) => issue.level !== 'info')
    .map((issue) => [
      issue.level === 'error' ? 'XATO' : 'OGOH',
      issue.code,
      issue.partId ?? '—',
      issue.message,
    ]);
}

/**
 * One assembly step as the strings that get printed, in order.
 *
 * Same contract as `bomTableRows`: the renderer consumes exactly these fields, so
 * asserting on them is asserting on the document. `parts` always names every part
 * of the step, including its quantity, so a step cannot be printed with its
 * contents silently dropped.
 */
export interface AssemblyStepBlock {
  heading: string;
  instruction: string;
  parts: string;
  dependsOn: string | null;
}

export function assemblyStepBlocks(plan: AssemblyPlan): AssemblyStepBlock[] {
  return plan.steps.map((step) => ({
    heading: `${step.order}. ${step.title} — ${ASSEMBLY_RELATION_LABELS[step.relation]}`,
    instruction: step.instruction,
    parts: step.parts
      .map((part) => {
        const size = part.sizeMm
          ? `${part.sizeMm.x}×${part.sizeMm.y}×${part.sizeMm.z} mm`
          : "o'lcham noaniq";
        return `${part.name} (${part.partId}) × ${part.quantity} — ${size}`;
      })
      .join('; '),
    dependsOn: step.dependsOn.length > 0 ? step.dependsOn.join(', ') : null,
  }));
}

/**
 * Build the PDF.
 *
 * Deterministic: `generatedAt` fixes the metadata dates, and nothing else in the
 * document varies between runs, so the same model produces identical bytes.
 */
export async function buildManufacturingPdf(input: PdfDocumentInput): Promise<PdfOutcome> {
  const parsedDrawing = parseDrawingSvg(input.drawing.svg);
  if (!parsedDrawing) {
    return {
      ok: false,
      reason: "Texnik chizma SVG o'qib bo'lmadi — hujjat yaratilmadi.",
    };
  }

  let doc: PDFDocument;
  let regular: PDFFont;
  let bold: PDFFont;
  try {
    doc = await PDFDocument.create({ updateMetadata: false });
    doc.registerFontkit(fontkit);
    regular = await doc.embedFont(base64ToBytes(PDF_FONT_REGULAR_B64), { subset: true });
    bold = await doc.embedFont(base64ToBytes(PDF_FONT_BOLD_B64), { subset: true });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `PDF shriftini yuklab bo'lmadi: ${error.message}`
          : "PDF shriftini yuklab bo'lmadi.",
    };
  }

  const notes: string[] = [];
  const layout = new Layout(doc, regular, bold);
  const project = input.projectName.trim() || 'Nomsiz loyiha';
  const assemblyPlan = input.assembly ?? null;
  const cuttingPlan = input.cuttingPlan ?? null;
  // Optional sections are numbered in the order they appear: the cutting plan
  // sits with the other material documents, the assembly instructions after it.
  // With neither supplied the numbering is exactly the pre-C6 one.
  const cuttingNumber = cuttingPlan ? 5 : null;
  const assemblyNumber = assemblyPlan ? (cuttingPlan ? 6 : 5) : null;
  const validationNumber = 4 + (cuttingPlan ? 1 : 0) + (assemblyPlan ? 1 : 0) + 1;
  const limitationsNumber = validationNumber + 1;

  doc.setTitle(`${TITLE} — ${project}`);
  doc.setProducer('3D Studio AI');
  doc.setCreator('3D Studio AI');
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);

  // ---- 1. Cover -------------------------------------------------------
  layout.heading(TITLE, 19);
  layout.paragraph(
    "Ushbu hujjat C1–C4 bosqichlarida yaratilgan ma'lumotlardan tuzildi: texnik chizma, detallar ro'yxati, kesish ro'yxati, materiallar va tekshiruv natijasi.",
    9.5,
  );
  layout.gap(6);
  layout.keyValues([
    ['Loyiha', project],
    ['Mebel turi', `${FURNITURE_TYPE_LABELS[input.type]} (${input.type})`],
    [
      'Umumiy olcham',
      `W ${formatMm(input.overall.widthMm)} x H ${formatMm(input.overall.heightMm)} x D ${formatMm(input.overall.depthMm)} mm`,
    ],
    ['Detallar', `${input.bom.rows.length} tur · ${input.bom.totalParts} dona`],
    ['Kesish', `${input.cutList.totalPieces} panel · ${input.cutList.panelAreaM2} m2`],
    ['Olchov birligi', 'sahna — santimetr, hujjatlar — millimetr'],
    ['Sana', input.generatedAt.toISOString().slice(0, 10)],
  ]);
  layout.gap(4);

  const { counts } = input.validation;
  layout.callout(
    input.validation.ok ? 'Tekshiruv: xatolik yoq' : `Tekshiruv: ${counts.error} xatolik`,
    [
      `Xatolik: ${counts.error} · Ogohlantirish: ${counts.warning} · Malumot: ${counts.info}`,
      input.validation.ok
        ? `Bu hisobot ishlab chiqarishga yaroqlilikni tasdiqlamaydi — ${limitationsNumber}-bo'limdagi cheklovlarni oqing.`
        : "Diqqat: xatoliklar mavjud. Hujjat tekshirish uchun foydali, lekin model tayyor deb belgilanmaydi.",
    ],
    input.validation.ok ? INK : ERROR_INK,
  );

  // A shop flipping through a printout benefits from knowing what follows.
  layout.gap(10);
  layout.subheading('Hujjat tarkibi');
  const contents = [
    '1. Texnik chizma — old, yon va yuqoridan korinishlar, olchamlar bilan',
    '2. Detallar royxati (BOM) — nomi, olchamlari, olchangan qalinligi',
    '3. Kesish royxati — panel detallar',
    '4. Materiallar — tanlangan material va nominal qalinlik',
  ];
  if (cuttingNumber !== null) {
    contents.push(
      `${cuttingNumber}. Material sarfi — listlar, joylashuv va chiqindi`,
    );
  }
  if (assemblyNumber !== null) {
    contents.push(`${assemblyNumber}. Montaj yoriqnomasi — tartiblangan qadamlar va detallar`);
  }
  contents.push(
    `${validationNumber}. Tekshiruv natijasi — C4 xatolik va ogohlantirishlari`,
    `${limitationsNumber}. Cheklovlar — nima tekshirilmagan`,
  );
  for (const entry of contents) {
    layout.paragraph(entry, 9);
  }

  // ---- 2. Technical drawing (landscape) -------------------------------
  layout.newPage(A4_LANDSCAPE);
  layout.heading('1. Texnik chizma', 14);
  layout.paragraph(
    `Masshtab (chizma generatori): ${input.drawing.scale.ratio}${input.drawing.scale.standard ? '' : ' (standart emas)'}`,
    9,
  );
  const drawingPage = layout.pages[layout.pages.length - 1];
  // Reserve a strip at the bottom for the drawing notes, so they live on this
  // sheet instead of spilling onto an almost-empty page of their own.
  const notesStrip = 42;
  const drawingBox = {
    x: MARGIN,
    y: layout.bottomLimit + notesStrip,
    width: layout.contentWidth,
    height: layout.y - layout.bottomLimit - notesStrip - 6,
  };
  const drawn = renderDrawing(drawingPage, parsedDrawing, regular, drawingBox);
  if (!drawn.ok) {
    return { ok: false, reason: drawn.reason ?? 'Chizma joylashtirilmadi.' };
  }
  if (drawn.skipped.length > 0) {
    notes.push(`Chizmada ${drawn.skipped.length} element o'qilmadi.`);
  }
  if (drawn.droppedTooSmall) {
    notes.push('Chizmadagi ba\'zi yozuvlar PDF uchun juda kichik — chiqarilmadi.');
  }
  layout.y = layout.bottomLimit + notesStrip - 4;
  layout.paragraph(
    "Eslatma: PDF sahifasi qog'ozga chop etilganda chizma masshtabi kafolatlanmaydi. O'lchov uchun faqat o'lcham yozuvlaridagi mm qiymatlariga tayaning.",
    8.5,
    WARN_INK,
  );
  layout.paragraph(
    "Bu sxematik o'lchamli chizma: yashirin chiziqlar, birlashma detallari va konstruktiv yechimlar ko'rsatilmagan.",
    8.5,
  );

  // ---- 3. BOM ---------------------------------------------------------
  layout.newPage(A4_PORTRAIT);
  layout.heading('2. Detallar royxati (BOM)', 14);
  if (input.bom.rows.length === 0) {
    layout.paragraph("Detallar ro'yxati bosh.");
  } else {
    layout.table(
      [
        { header: 'Nomi', weight: 0.2 },
        { header: 'partId', weight: 0.19 },
        { header: 'Turi', weight: 0.1 },
        { header: 'Soni', weight: 0.07, align: 'right' },
        { header: 'X', weight: 0.07, align: 'right' },
        { header: 'Y', weight: 0.07, align: 'right' },
        { header: 'Z', weight: 0.07, align: 'right' },
        // Measured geometry thickness — never the nominal material thickness.
        { header: 'Qalinlik', weight: 0.09, align: 'right' },
        { header: 'Material', weight: 0.14 },
      ],
      bomTableRows(input.bom),
    );
    layout.paragraph("Olchamlar mm. Qalinlik — geometriyadan olchangan qiymat, material qalinligi emas.", 8, MUTED);
    layout.paragraph(`Jami: ${input.bom.totalParts} dona, ${input.bom.panelAreaM2} m2 panel yuzasi.`, 8.5);
  }

  // ---- 4. Cut list ----------------------------------------------------
  layout.gap(6);
  layout.heading('3. Kesish royxati', 14);
  if (input.cutList.rows.length === 0) {
    layout.paragraph("Kesish ro'yxati bosh.");
  } else {
    layout.table(
      [
        { header: 'Nomi', weight: 0.19 },
        { header: 'partId', weight: 0.19 },
        { header: 'Soni', weight: 0.07, align: 'right' },
        { header: 'Uzunlik', weight: 0.1, align: 'right' },
        { header: 'Kenglik', weight: 0.1, align: 'right' },
        { header: 'Qalinlik', weight: 0.1, align: 'right' },
        { header: 'Material', weight: 0.25 },
      ],
      cutListTableRows(input.cutList),
    );
    layout.paragraph(`Jami: ${input.cutList.totalPieces} panel, ${input.cutList.panelAreaM2} m2.`, 8.5);
    layout.paragraph(
      "Kerf, chiqindi, nesting va tola yo'nalishi hisoblanmagan — C7 bosqichiga qoldirilgan.",
      8,
      MUTED,
    );
  }

  // ---- 5. Materials ---------------------------------------------------
  layout.gap(6);
  layout.heading('4. Materiallar', 14);
  if (input.materials.length === 0) {
    layout.callout(
      'Material tanlanmagan',
      [
        "Modelga ishlab chiqarish materiali biriktirilmagan. Bu PDF materialni o'zidan to'ldirmaydi.",
        'Material ustunlari BOM va kesish royxatida bosh qoldirilgan.',
      ],
      WARN_INK,
    );
  } else {
    layout.table(
      [
        { header: 'Material', weight: 0.24 },
        { header: 'ID', weight: 0.14 },
        { header: 'Nominal qalinlik', weight: 0.16, align: 'right' },
        { header: 'Detallar', weight: 0.1, align: 'right' },
        { header: 'partId', weight: 0.36 },
      ],
      materialTableRows(input.materials),
    );
    layout.paragraph(
      "Nominal qalinlik — sotib olinadigan taxta qalinligi. Geometriyadan olchangan qalinlik BOM jadvalida alohida ko'rsatilgan; ikkalasi hech qachon almashtirilmaydi.",
      8,
    );
    layout.paragraph(
      "Material nomi — foydalanuvchi tanlagan belgi. U standart, sertifikat yoki mustahkamlik kafolati emas.",
      8,
      MUTED,
    );
    const materialWarnings = input.validation.issues.filter(
      (issue) => issue.level === 'warning' && issue.code.startsWith('material'),
    );
    for (const warning of materialWarnings) {
      layout.paragraph(`! ${warning.message}`, 8.5, WARN_INK);
    }
  }

  // ---- C7 material usage and cutting plan -----------------------------
  if (cuttingPlan && cuttingNumber !== null) {
    layout.gap(6);
    layout.heading(`${cuttingNumber}. Material sarfi va kesish rejasi`, 14);
    layout.paragraph(
      `${CUTTING_STATUS_LABELS[cuttingPlan.status]} · List ${cuttingPlan.settings.sheetLengthMm}×${cuttingPlan.settings.sheetWidthMm} mm · kerf ${cuttingPlan.settings.kerfMm} mm · chekka ${cuttingPlan.settings.edgeMarginMm} mm · aylantirish ${cuttingPlan.settings.allowRotation ? "ruxsat etilgan" : "taqiqlangan"}`,
      9.2,
    );

    layout.gap(2);
    layout.table(
      [
        { header: 'Korsatkich', weight: 0.5 },
        { header: 'Qiymat', weight: 0.5 },
      ],
      [
        ['Detallar', `${cuttingPlan.summary.placedCount} / ${cuttingPlan.summary.pieceCount} dona`],
        ['Listlar', `${cuttingPlan.summary.sheetCount} dona`],
        ['Foydalanilgan yuza', `${cuttingPlan.summary.usedAreaM2} m2`],
        ['Mavjud yuza', `${cuttingPlan.summary.availableAreaM2} m2`],
        ['Kerf maydoni', `${cuttingPlan.summary.kerfAreaM2} m2`],
        [
          'Chiqindi (qoldiq)',
          `${cuttingPlan.summary.wasteAreaM2} m2 (${cuttingPlan.summary.wastePercent}%)`,
        ],
      ],
      8.6,
    );

    if (cuttingPlan.summary.sheetCount === 0) {
      layout.gap(4);
      layout.callout(
        'Kesish rejasi tuzilmadi',
        [
          "Hech bir detal listga joylashtirilmadi, shuning uchun kesish sxemasi chop etilmadi.",
          ...cuttingPlan.issues
            .filter((issue) => issue.level === 'error')
            .map((issue) => `• ${issue.message}`),
        ],
        ERROR_INK,
      );
    }

    for (const group of cuttingPlan.groups) {
      layout.gap(4);
      layout.subheading(
        `${group.name} · ${group.thicknessMm} mm — ${group.sheets.length} list, ${group.pieceCount} detal, chiqindi ${group.wastePercent}%`,
        10,
      );
      for (const sheet of group.sheets) {
        layout.paragraph(
          `List ${sheet.index}: ${sheet.sheetLengthMm}×${sheet.sheetWidthMm} mm · foydalanilgan ${sheet.usedAreaM2} m2 · kerf ${sheet.kerfAreaM2} m2 · chiqindi ${sheet.wasteAreaM2} m2 (${sheet.wastePercent}%)`,
          8.6,
        );
        layout.cuttingSheet(sheet.sheetLengthMm, sheet.sheetWidthMm, sheet.placements);
        layout.paragraph(
          sheet.placements
            .map(
              (piece) =>
                `${piece.name} (${piece.partId}) #${piece.instance} — ${piece.widthMm}×${piece.heightMm} mm @ ${piece.xMm},${piece.yMm}${piece.rotated ? " (aylantirilgan)" : ''}`,
            )
            .join('; '),
          7.8,
        );
      }
    }

    if (cuttingPlan.unplaced.length > 0) {
      layout.gap(4);
      layout.subheading('Joylashtirilmagan detallar', 10);
      for (const piece of cuttingPlan.unplaced) {
        layout.paragraph(
          `• ${UNPLACED_REASON_LABELS[piece.reason]} · ${piece.name} (${piece.partId}) × ${piece.quantity} — ${piece.lengthMm}×${piece.widthMm} mm`,
          8.4,
          ERROR_INK,
        );
      }
    }

    if (cuttingPlan.excluded.length > 0) {
      layout.gap(2);
      layout.paragraph(
        `Panel bolmagan detallar (listga kirmaydi): ${cuttingPlan.excluded.map((piece) => `${piece.name} (${piece.partId}) × ${piece.quantity}`).join(', ')}`,
        8,
        MUTED,
      );
    }

    layout.gap(2);
    layout.subheading('Kesish rejasi boyicha cheklovlar', 10);
    for (const limitation of cuttingPlan.limitations) {
      layout.paragraph(`• ${limitation}`, 8.4);
    }

    if (counts.error > 0) {
      layout.paragraph(
        `Model tekshiruvida ${counts.error} xatolik bor — bu kesish rejasi tasdiqlangan hisoblanmaydi.`,
        8.6,
        ERROR_INK,
      );
    }
  }

  // ---- 6. Assembly instructions (C6) ----------------------------------
  if (assemblyPlan) {
    layout.gap(6);
    layout.heading(`${assemblyNumber}. Montaj yoriqnomasi`, 14);
    layout.paragraph(
      `${assemblyPlan.modelLabel} — holat: ${ASSEMBLY_STATUS_LABELS[assemblyPlan.status]}.`,
      9.5,
    );

    if (assemblyPlan.steps.length === 0) {
      layout.callout(
        'Montaj yoriqnomasi tuzilmadi',
        [
          "Bu model uchun ishonchli qadamlar tuzib bo'lmadi, shuning uchun hech qanday qadam chop etilmadi.",
          ...assemblyPlan.issues
            .filter((issue) => issue.level === 'error')
            .map((issue) => `• ${issue.message}`),
        ],
        ERROR_INK,
      );
    } else {
      layout.paragraph(
        "Qadamlar tartibi modeldagi qism rollari va bog'lanishlaridan tuzilgan. Manba har bir qadam sarlavhasida ko'rsatilgan.",
        8.5,
      );
      for (const block of assemblyStepBlocks(assemblyPlan)) {
        // Keep a heading with at least its instruction on one page.
        layout.ensure(70);
        layout.subheading(block.heading, 10.5);
        layout.paragraph(block.instruction, 9.2, INK);
        layout.paragraph(`Detallar: ${block.parts}`, 8.6);
        if (block.dependsOn) {
          layout.paragraph(`Avval bajarilishi kerak: ${block.dependsOn}`, 8.2, MUTED);
        }
        layout.gap(3);
      }

      const stepIssues = assemblyPlan.issues.filter((issue) => issue.level !== 'info');
      if (stepIssues.length > 0) {
        layout.gap(2);
        layout.subheading('Montaj rejasidagi eslatmalar', 10);
        for (const issue of stepIssues) {
          layout.paragraph(
            `${issue.level === 'error' ? 'XATO' : 'OGOH'} · ${issue.code}: ${issue.message}`,
            8.4,
            issue.level === 'error' ? ERROR_INK : WARN_INK,
          );
        }
      }
    }

    layout.gap(2);
    layout.subheading('Montaj boyicha cheklovlar', 10);
    for (const limitation of assemblyPlan.limitations) {
      layout.paragraph(`• ${limitation}`, 8.6);
    }
    if (counts.error > 0) {
      layout.paragraph(
        `Model tekshiruvida ${counts.error} xatolik bor — bu montaj rejasi tasdiqlangan hisoblanmaydi.`,
        8.8,
        ERROR_INK,
      );
    }
  }

  // ---- 6. Validation --------------------------------------------------
  layout.gap(6);
  layout.heading(`${validationNumber}. Tekshiruv natijasi`, 14);
  layout.paragraph(
    `Xatolik: ${counts.error} · Ogohlantirish: ${counts.warning} · Malumot: ${counts.info}`,
    9.5,
  );
  const reported = input.validation.issues.filter((issue) => issue.level !== 'info');
  if (reported.length === 0) {
    layout.paragraph("Aniqlangan muammo yoq.");
  } else {
    layout.table(
      [
        { header: 'Daraja', weight: 0.12 },
        { header: 'Kod', weight: 0.24 },
        { header: 'Detal', weight: 0.16 },
        { header: 'Izoh', weight: 0.48 },
      ],
      validationTableRows(input.validation.issues),
      8,
    );
  }
  if (counts.error > 0) {
    layout.callout(
      `${counts.error} xatolik topildi`,
      [
        'Bu hujjat tekshirish uchun chiqarilgan, model esa ishlab chiqarishga tayyor deb belgilanmaydi.',
        "Xatoliklarni tuzatib, hujjatni qayta chiqaring.",
      ],
      ERROR_INK,
    );
  }

  // ---- 7. Limitations -------------------------------------------------
  layout.gap(6);
  layout.heading(`${limitationsNumber}. Cheklovlar va tekshirilmagan jihatlar`, 14);
  for (const limitation of input.validation.limitations) {
    layout.paragraph(`• ${limitation}`, 8.8);
  }
  const sourceLimitations = [...input.bom.limitations, ...input.cutList.limitations];
  for (const limitation of sourceLimitations) {
    layout.paragraph(`• ${limitation}`, 8.8);
  }
  layout.gap(4);
  layout.paragraph(
    "Ushbu hujjat ishlab chiqarishga yaroqlilik, konstruktiv mustahkamlik yoki standartga muvofiqlik sertifikati EMAS. Har bir olchamni va materialni sexda qayta tekshiring.",
    9,
    ERROR_INK,
  );

  if (notes.length > 0) {
    layout.gap(6);
    layout.subheading('Chizma haqida texnik eslatmalar');
    for (const note of notes) {
      layout.paragraph(`• ${note}`, 8.2, MUTED);
    }
  }

  layout.stampFooters();

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = (await doc.save()) as Uint8Array<ArrayBuffer>;
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message
          ? `PDF yozib bo'lmadi: ${error.message}`
          : "PDF yozib bo'lmadi.",
    };
  }

  return {
    ok: true,
    bytes,
    filename: pdfFilename(input.projectName),
    pageCount: doc.getPageCount(),
    notes,
  };
}
