import { describe, expect, it } from 'vitest';
import { LOCAL_TABLE_ADAPTER_ID, localTableAdapter, parseTablePrompt } from './localTableAdapter';
import { AiAdapterError } from './types';
import { TABLE_DEFAULTS, TABLE_LIMITS } from '../geometry/tableParams';

describe('parseTablePrompt', () => {
  it('reads an explicit width × depth × height triple', () => {
    const parsed = parseTablePrompt('180x60x75 sm stol');

    expect(parsed.raw).toEqual({ widthCm: 180, depthCm: 60, heightCm: 75 });
    expect(parsed.confidence).toBe('high');
  });

  it('reads per-field keywords in Uzbek', () => {
    const parsed = parseTablePrompt('kenglik 200, balandlik 90, chuqurlik 80');

    expect(parsed.raw.widthCm).toBe(200);
    expect(parsed.raw.heightCm).toBe(90);
    expect(parsed.raw.depthCm).toBe(80);
    expect(parsed.confidence).toBe('high');
  });

  it('supports keyword-before and number-before forms', () => {
    expect(parseTablePrompt('kenglik: 150').raw.widthCm).toBe(150);
    expect(parseTablePrompt('150 sm kenglik').raw.widthCm).toBe(150);
  });

  it('maps colour names to hex', () => {
    expect(parseTablePrompt('qizil stol').raw.color).toBe('#c0392b');
    expect(parseTablePrompt('white table').raw.color).toBe('#ffffff');
  });

  it('reads hex colours, including the short form', () => {
    expect(parseTablePrompt('stol #ff8800').raw.color).toBe('#ff8800');
    expect(parseTablePrompt('stol #abc').raw.color).toBe('#aabbcc');
  });

  it('uses low confidence when nothing is recognised', () => {
    const parsed = parseTablePrompt('iliq va zamonaviy stol');

    expect(parsed.raw).toEqual({});
    expect(parsed.confidence).toBe('low');
  });

  it('warns when the prompt asks for an unsupported object', () => {
    const parsed = parseTablePrompt('180x60x75 shkaf');

    expect(parsed.warnings.some((line) => line.includes('shkaf'))).toBe(true);
    // Dimensions are still read so a table can be produced.
    expect(parsed.raw.widthCm).toBe(180);
  });

  it('is deterministic', () => {
    expect(parseTablePrompt('kenglik 150 qora')).toEqual(parseTablePrompt('kenglik 150 qora'));
  });
});

describe('localTableAdapter', () => {
  it('declares text support and no image support', () => {
    expect(localTableAdapter.id).toBe(LOCAL_TABLE_ADAPTER_ID);
    expect(localTableAdapter.capabilities).toEqual({ text: true, image: false });
  });

  it('generates parameters and quality-control notes from text', async () => {
    const proposal = await localTableAdapter.generate({ text: '200x80x75 sm, qizil stol' });

    expect(proposal.adapterId).toBe(LOCAL_TABLE_ADAPTER_ID);
    expect(proposal.params).toEqual({
      widthCm: 200,
      heightCm: 75,
      depthCm: 80,
      color: '#c0392b',
    });
    expect(proposal.confidence).toBe('high');
    expect(proposal.notes.length).toBeGreaterThan(0);
  });

  it('clamps out-of-range values through quality control', async () => {
    const proposal = await localTableAdapter.generate({ text: 'kenglik 900' });

    expect(proposal.params.widthCm).toBe(TABLE_LIMITS.widthCm.max);
    expect(proposal.warnings.some((line) => line.includes('Kenglik'))).toBe(true);
  });

  it('falls back to defaults when the prompt has no usable values', async () => {
    const proposal = await localTableAdapter.generate({ text: 'shunchaki stol' });

    expect(proposal.params).toEqual(TABLE_DEFAULTS);
    expect(proposal.confidence).toBe('low');
  });

  it('rejects empty prompts', async () => {
    await expect(localTableAdapter.generate({ text: '   ' })).rejects.toBeInstanceOf(
      AiAdapterError,
    );
  });

  it('rejects image input (no AI service selected yet)', async () => {
    await expect(
      localTableAdapter.generate({ text: 'stol', imageFileName: 'table.png' }),
    ).rejects.toBeInstanceOf(AiAdapterError);
  });
});
