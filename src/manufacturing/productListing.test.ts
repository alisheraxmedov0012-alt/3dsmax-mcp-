import { describe, expect, it } from 'vitest';
import { buildProductListing } from './productListing';

const BASE = {
  projectName: 'Golden Dresser',
  type: 'dresser' as const,
  overallMm: { widthMm: 1200, heightMm: 800, depthMm: 470 },
  entries: ['model.glb', 'BOM.csv', 'cutlist.csv', 'document.pdf', 'preview-front.png'],
};

describe('product listing metadata', () => {
  it('derives only facts the package actually contains', () => {
    const listing = buildProductListing(BASE);

    expect(listing.title).toBe('Golden Dresser');
    expect(listing.productType).toBe('dresser');
    expect(listing.furnitureTypeLabel).toBe('Tumba');
    expect(listing.formats).toEqual(['csv', 'glb', 'pdf', 'png']);
    expect(listing.dimensionsMm).toEqual({ widthMm: 1200, heightMm: 800, depthMm: 470 });
    expect(listing.unit).toBe('mm');
  });

  it('does not invent seller, license, SKU, version or category fields', () => {
    const listing = buildProductListing(BASE);

    for (const key of ['sku', 'version', 'category', 'tags', 'author', 'license', 'textureResolutionPx', 'compatibilityNotes']) {
      expect(listing).not.toHaveProperty(key);
    }
  });

  it('passes through optional seller-supplied fields, trimmed and de-duplicated', () => {
    const listing = buildProductListing({
      ...BASE,
      listing: {
        title: '  Golden Dresser  ',
        sku: ' GD-120-3 ',
        version: '1.0.0',
        category: 'furniture',
        tags: [' oak ', 'dresser', 'oak', '  '],
        author: 'Test Author',
        license: 'LicenseRef-Test-Only',
        textureResolutionPx: 128,
        compatibilityNotes: 'Imported in Blender by the tester.',
      },
    });

    expect(listing.title).toBe('Golden Dresser');
    expect(listing.sku).toBe('GD-120-3');
    expect(listing.version).toBe('1.0.0');
    expect(listing.category).toBe('furniture');
    expect(listing.tags).toEqual(['oak', 'dresser']);
    expect(listing.author).toBe('Test Author');
    expect(listing.license).toBe('LicenseRef-Test-Only');
    expect(listing.textureResolutionPx).toBe(128);
    expect(listing.compatibilityNotes).toBe('Imported in Blender by the tester.');
  });

  it('rejects a non-positive texture resolution instead of recording it', () => {
    expect(buildProductListing({ ...BASE, listing: { textureResolutionPx: 0 } })).not.toHaveProperty(
      'textureResolutionPx',
    );
    expect(buildProductListing({ ...BASE, listing: { textureResolutionPx: 128.5 } })).not.toHaveProperty(
      'textureResolutionPx',
    );
  });

  it('falls back to the furniture label when the project name is blank', () => {
    expect(buildProductListing({ ...BASE, projectName: '   ' }).title).toBe('Tumba');
  });
});
