/**
 * C6 — fastening hardware for an assembly.
 *
 * The geometry model carries no joint, screw, dowel or glue information, so this
 * module must never invent a fastener type, diameter, length or quantity. When
 * the caller supplies nothing it returns one explicit `unspecified` entry and a
 * limitation list; a workshop can then see that the data is missing instead of
 * reading an empty table as "no hardware needed".
 */
export type HardwareKind =
  | 'screw'
  | 'bolt'
  | 'dowel'
  | 'nail'
  | 'glue'
  | 'bracket'
  | 'other'
  | 'unspecified';

export type HardwareUnit = 'pcs' | 'set' | 'ml' | 'g';

export interface HardwareItem {
  kind: HardwareKind;
  name: string;
  /** Null means the quantity is not known. Never replaced by a guessed number. */
  quantity: number | null;
  /** Null is only allowed together with a null quantity. */
  unit: HardwareUnit | null;
  /** Free-text size (e.g. user-entered "4×40 mm"), or null when unspecified. */
  size: string | null;
  note?: string | null;
  /**
   * Assembly steps this item belongs to. References, not quantities: the same
   * item linked to two steps is still counted once in `totalPieces`.
   */
  stepIds?: string[];
}

export interface HardwareBom {
  /** False when the model supplied no hardware data at all. */
  specified: boolean;
  items: HardwareItem[];
  /** Total pieces where every quantity is known; null otherwise. */
  totalPieces: number | null;
  limitations: string[];
}

export type HardwareOutcome = { ok: true; hardware: HardwareBom } | { ok: false; reason: string };

const HARDWARE_KINDS: ReadonlySet<string> = new Set<HardwareKind>([
  'screw',
  'bolt',
  'dowel',
  'nail',
  'glue',
  'bracket',
  'other',
  'unspecified',
]);

const HARDWARE_UNITS: ReadonlySet<string> = new Set<HardwareUnit>([
  'pcs',
  'set',
  'ml',
  'g',
]);

export const HARDWARE_LIMITATIONS: readonly string[] = [
  "Modelda birikma turlari, teshik joylari va mahkamlash usuli yo'q — furnitura soni va o'lchami hisoblanmagan.",
  "Vint, shpilka, dowel yoki yelim turi, diametri va uzunligi modeldan aniqlanmaydi.",
  "Bu ro'yxat ishlab chiqarish yoki yuk ko'tarish bo'yicha tavsiya emas.",
];

const UNSPECIFIED_ITEM: HardwareItem = {
  kind: 'unspecified',
  name: "Mahkamlagichlar ko'rsatilmagan",
  quantity: null,
  unit: null,
  size: null,
  note: 'Konstruksiya va birikma ma’lumoti modelda yo‘q.',
};

function normalizeItem(value: HardwareItem, index: number): HardwareItem | string {
  if (!value || typeof value !== 'object') {
    return `${index + 1}-furnitura yozuvi obyekt emas.`;
  }
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (name === '') {
    return `${index + 1}-furnitura nomi bo'sh.`;
  }
  if (!HARDWARE_KINDS.has(value.kind)) {
    return `${index + 1}-furnitura turi noma'lum: ${String(value.kind)}.`;
  }
  const quantity = value.quantity;
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
    return `${index + 1}-furnitura soni musbat son yoki null bo'lishi kerak.`;
  }
  if (quantity === null && value.unit !== null) {
    return `${index + 1}-furnitura soni noma'lum bo'lsa, birlik ham null bo'lishi kerak.`;
  }
  if (value.unit !== null && !HARDWARE_UNITS.has(value.unit)) {
    return `${index + 1}-furnitura birligi noma'lum: ${String(value.unit)}.`;
  }
  if ((value.unit === 'pcs' || value.unit === 'set') && quantity !== null && !Number.isInteger(quantity)) {
    return `${index + 1}-furnitura dona soni butun bo'lishi kerak.`;
  }
  return {
    kind: value.kind,
    name,
    quantity,
    unit: value.unit,
    size: typeof value.size === 'string' && value.size.trim() !== '' ? value.size.trim() : null,
    note: typeof value.note === 'string' && value.note.trim() !== '' ? value.note.trim() : null,
    stepIds: Array.isArray(value.stepIds)
      ? [...new Set(value.stepIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))]
      : [],
  };
}

/**
 * Validate caller-supplied hardware. Invalid data is a hard error: dropping a
 * malformed row would make the package look complete while it is not.
 */
export function buildHardwareBom(items: readonly HardwareItem[] = []): HardwareOutcome {
  if (items.length === 0) {
    return {
      ok: true,
      hardware: {
        specified: false,
        items: [{ ...UNSPECIFIED_ITEM }],
        totalPieces: null,
        limitations: [...HARDWARE_LIMITATIONS],
      },
    };
  }

  const normalized: HardwareItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const result = normalizeItem(items[index], index);
    if (typeof result === 'string') {
      return { ok: false, reason: result };
    }
    normalized.push(result);
  }

  const pieces = normalized.filter((item) => item.unit === 'pcs' || item.unit === 'set');
  const totalPieces =
    pieces.length > 0 && pieces.every((item) => item.quantity !== null)
      ? pieces.reduce((sum, item) => sum + (item.quantity ?? 0), 0)
      : null;

  return {
    ok: true,
    hardware: {
      specified: true,
      items: normalized,
      totalPieces,
      limitations: [...HARDWARE_LIMITATIONS],
    },
  };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Hardware CSV for the product archive. */
export function hardwareCsv(
  hardware: HardwareBom,
  steps: readonly HardwareStepLabel[] = [],
): string {
  const header = 'kind,name,quantity,unit,size,note,steps,status';
  const labels = new Map(steps.map((step) => [step.id, `${step.order}. ${step.title}`]));
  const rows = hardware.items.map((item) =>
    [
      item.kind,
      item.name,
      item.quantity,
      item.unit,
      item.size,
      item.note ?? null,
      (item.stepIds ?? [])
        .map((id) => `${id}:${labels.get(id) ?? 'noma’lum qadam'}`)
        .join(';'),
      hardware.specified ? 'specified' : 'not-specified',
    ]
      .map(csvCell)
      .join(','),
  );
  return `${[header, ...rows].join('\n')}\n`;
}

export interface HardwareStepLabel {
  id: string;
  order: number;
  title: string;
}

/** Human-readable hardware section for assembly.txt and PDF. */
export function hardwareLines(
  hardware: HardwareBom,
  steps: readonly HardwareStepLabel[] = [],
): string[] {
  if (!hardware.specified) {
    return [
      "Mahkamlagichlar: ko'rsatilmagan (modelda birikma ma'lumoti yo'q).",
      ...hardware.limitations.map((line) => `• ${line}`),
    ];
  }
  return hardware.items.map((item) => {
    const quantity = item.quantity === null ? "soni ko'rsatilmagan" : `${item.quantity} ${item.unit}`;
    const size = item.size ? `, ${item.size}` : '';
    const labels = (item.stepIds ?? [])
      .map((id) => steps.find((step) => step.id === id))
      .filter((step): step is HardwareStepLabel => Boolean(step))
      .map((step) => `${step.order}. ${step.title}`);
    const where = labels.length > 0 ? `; qadamlar: ${labels.join(', ')}` : '';
    return `${item.name} — ${quantity}${size}${where}${item.note ? ` (${item.note})` : ''}`;
  });
}

/** Errors when a hardware row points at a step the current plan does not have. */
export function validateHardwareSteps(
  hardware: HardwareBom,
  steps: readonly { id: string }[],
): string[] {
  const known = new Set(steps.map((step) => step.id));
  const errors: string[] = [];
  for (const item of hardware.items) {
    for (const stepId of item.stepIds ?? []) {
      if (!known.has(stepId)) {
        errors.push(
          /^step-\d+$/.test(stepId)
            ? `"${item.name}" eski formatdagi qadamga bog'langan: ${stepId} — qayta bog'lang.`
            : `"${item.name}" noma'lum montaj qadamiga bog'langan: ${stepId}.`,
        );
      }
    }
  }
  return errors;
}
