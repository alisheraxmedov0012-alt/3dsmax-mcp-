/**
 * General product listing metadata for the package's `meta.json`.
 *
 * This is deliberately marketplace-neutral: it records facts the pipeline
 * actually knows (title, product type, formats, dimensions) and passes through
 * optional seller-supplied fields. It never invents a seller, price, currency,
 * license or approval; those stay absent until a caller provides them.
 */
import {
  FURNITURE_TYPE_LABELS,
  type FurnitureType,
} from '../geometry/furniture/types';

export interface ProductListingInput {
  /** Overrides the project name as the listing title. */
  title?: string;
  sku?: string;
  /** Product version supplied by the seller; not the package format version. */
  version?: string;
  category?: string;
  tags?: readonly string[];
  author?: string;
  license?: string;
  /** Actual bitmap size of the exported maps, when known. */
  textureResolutionPx?: number;
  compatibilityNotes?: string;
}

export interface ProductListingMetadata {
  title: string;
  productType: FurnitureType;
  furnitureTypeLabel: string;
  /** File extensions actually present in the archive, lower-case and sorted. */
  formats: string[];
  dimensionsMm: { widthMm: number; heightMm: number; depthMm: number };
  unit: 'mm';
  sku?: string;
  version?: string;
  category?: string;
  tags?: string[];
  author?: string;
  license?: string;
  textureResolutionPx?: number;
  compatibilityNotes?: string;
}

export interface ProductListingSource {
  projectName: string;
  type: FurnitureType;
  overallMm: { widthMm: number; heightMm: number; depthMm: number };
  entries: readonly string[];
  listing?: ProductListingInput | null;
}

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

function formatsOf(entries: readonly string[]): string[] {
  const formats = new Set<string>();
  for (const entry of entries) {
    const dot = entry.lastIndexOf('.');
    if (dot > 0 && dot < entry.length - 1) {
      formats.add(entry.slice(dot + 1).toLowerCase());
    }
  }
  return [...formats].sort();
}

function tagsOf(tags: readonly string[] | undefined): string[] | undefined {
  if (!tags) {
    return undefined;
  }
  const cleaned = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== ''))];
  return cleaned.length > 0 ? cleaned : undefined;
}

export function buildProductListing(source: ProductListingSource): ProductListingMetadata {
  const input = source.listing;
  const title =
    clean(input?.title) ??
    (source.projectName.trim() !== '' ? source.projectName.trim() : FURNITURE_TYPE_LABELS[source.type]);
  const textureResolutionPx =
    typeof input?.textureResolutionPx === 'number' &&
    Number.isInteger(input.textureResolutionPx) &&
    input.textureResolutionPx > 0
      ? input.textureResolutionPx
      : undefined;

  return {
    title,
    productType: source.type,
    furnitureTypeLabel: FURNITURE_TYPE_LABELS[source.type],
    formats: formatsOf(source.entries),
    dimensionsMm: { ...source.overallMm },
    unit: 'mm',
    ...(clean(input?.sku) ? { sku: clean(input?.sku) } : {}),
    ...(clean(input?.version) ? { version: clean(input?.version) } : {}),
    ...(clean(input?.category) ? { category: clean(input?.category) } : {}),
    ...(tagsOf(input?.tags) ? { tags: tagsOf(input?.tags) } : {}),
    ...(clean(input?.author) ? { author: clean(input?.author) } : {}),
    ...(clean(input?.license) ? { license: clean(input?.license) } : {}),
    ...(textureResolutionPx !== undefined ? { textureResolutionPx } : {}),
    ...(clean(input?.compatibilityNotes)
      ? { compatibilityNotes: clean(input?.compatibilityNotes) }
      : {}),
  };
}
