/**
 * Stage 1.2.2 — declarative computer/office desk specification.
 *
 * All lengths are centimetres, matching the scene, kernel and component library.
 * The solver does not clamp or silently correct anything: invalid values are
 * reported and `solveDesk()` refuses to build a plan.
 */
export interface DeskSpec {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly tabletopThickness: number;

  readonly legWidth: number;
  readonly legDepth: number;
  readonly legInset: number;

  readonly frameThickness: number;
  readonly frameHeight: number;
  readonly frameInset: number;
  readonly supportThickness: number;

  readonly cornerRadius: number;

  readonly grommetEnabled: boolean;
  readonly grommetDiameter: number;

  readonly drawerEnabled: boolean;
  readonly drawerWidth: number;
  readonly drawerHeight: number;
  readonly drawerDepth: number;
}

/** Realistic default office/computer desk, 160 × 80 × 75 cm. */
export const DEFAULT_DESK_SPEC: Readonly<DeskSpec> = {
  width: 160,
  depth: 80,
  height: 75,
  tabletopThickness: 3,

  legWidth: 5,
  legDepth: 5,
  legInset: 5,

  frameThickness: 3,
  frameHeight: 6,
  frameInset: 5,
  supportThickness: 2,

  cornerRadius: 1,

  grommetEnabled: true,
  grommetDiameter: 8,

  drawerEnabled: true,
  drawerWidth: 45,
  drawerHeight: 20,
  drawerDepth: 50,
};

/** Distance from the grommet edge to the tabletop edge in the solver. */
export const GROMMET_EDGE_MARGIN_CM = 5;

export interface DeskSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export class DeskSpecError extends Error {
  readonly code = 'invalid_desk_spec';
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join(' '));
    this.name = 'DeskSpecError';
    this.errors = errors;
  }
}

type NumericKey = {
  [K in keyof DeskSpec]: DeskSpec[K] extends number ? K : never;
}[keyof DeskSpec];

function checkNumber(
  errors: string[],
  spec: DeskSpec,
  key: NumericKey,
  options: { positive?: boolean; nonNegative?: boolean } = {},
): number | null {
  const value = spec[key];
  if (!Number.isFinite(value)) {
    errors.push(`${key}: chekli son bo'lishi kerak.`);
    return null;
  }
  if (options.positive === true && value <= 0) {
    errors.push(`${key}: noldan katta bo'lishi kerak.`);
  }
  if (options.nonNegative === true && value < 0) {
    errors.push(`${key}: manfiy bo'lmasligi kerak.`);
  }
  return value;
}

/** Validate every DeskSpec constraint without correcting the input. */
export function validateDeskSpec(spec: DeskSpec): DeskSpecValidation {
  const errors: string[] = [];
  const width = checkNumber(errors, spec, 'width', { positive: true });
  const depth = checkNumber(errors, spec, 'depth', { positive: true });
  const height = checkNumber(errors, spec, 'height', { positive: true });
  const tabletopThickness = checkNumber(errors, spec, 'tabletopThickness', {
    positive: true,
  });
  const legWidth = checkNumber(errors, spec, 'legWidth', { positive: true });
  const legDepth = checkNumber(errors, spec, 'legDepth', { positive: true });
  const legInset = checkNumber(errors, spec, 'legInset', { nonNegative: true });
  const frameThickness = checkNumber(errors, spec, 'frameThickness', { positive: true });
  const frameHeight = checkNumber(errors, spec, 'frameHeight', { positive: true });
  const frameInset = checkNumber(errors, spec, 'frameInset', { nonNegative: true });
  const supportThickness = checkNumber(errors, spec, 'supportThickness', { positive: true });
  const cornerRadius = checkNumber(errors, spec, 'cornerRadius', { nonNegative: true });
  const grommetDiameter = checkNumber(errors, spec, 'grommetDiameter', { nonNegative: true });
  const drawerWidth = checkNumber(errors, spec, 'drawerWidth', { nonNegative: true });
  const drawerHeight = checkNumber(errors, spec, 'drawerHeight', { nonNegative: true });
  const drawerDepth = checkNumber(errors, spec, 'drawerDepth', { nonNegative: true });

  if (typeof spec.grommetEnabled !== 'boolean') {
    errors.push('grommetEnabled: boolean bo‘lishi kerak.');
  }
  if (typeof spec.drawerEnabled !== 'boolean') {
    errors.push('drawerEnabled: boolean bo‘lishi kerak.');
  }

  if (width !== null && legWidth !== null && legInset !== null) {
    if (width <= 2 * legInset + legWidth) {
      errors.push('width: legInset va legWidth stol chetidan chiqmasligi kerak.');
    }
  }
  if (depth !== null && legDepth !== null && legInset !== null) {
    if (depth <= 2 * legInset + legDepth) {
      errors.push('depth: legInset va legDepth stol chetidan chiqmasligi kerak.');
    }
  }
  if (height !== null && tabletopThickness !== null && frameHeight !== null) {
    if (height <= tabletopThickness + frameHeight) {
      errors.push('height: tabletopThickness + frameHeight dan katta bo‘lishi kerak.');
    }
  }
  if (
    supportThickness !== null &&
    height !== null &&
    tabletopThickness !== null &&
    supportThickness >= height - tabletopThickness
  ) {
    errors.push('supportThickness: stol ostidagi mavjud balandlikdan kichik bo‘lishi kerak.');
  }
  if (
    width !== null &&
    depth !== null &&
    legWidth !== null &&
    frameInset !== null &&
    frameThickness !== null
  ) {
    const frameWidth = width - 2 * frameInset;
    const frameDepth = depth - 2 * frameInset;
    if (frameWidth <= 0 || frameDepth <= 0) {
      errors.push('frameInset: frame o‘lchamlari noldan katta bo‘lishi kerak.');
    } else if (frameThickness >= Math.min(frameWidth, frameDepth) / 2) {
      errors.push('frameThickness: frame o‘lchamining yarmidan kichik bo‘lishi kerak.');
    } else if (frameDepth <= 3 * frameThickness) {
      errors.push('frameThickness: support rail uchun frameDepth yetarli emas.');
    }
    if (frameWidth - 2 * frameThickness - 2 * legWidth <= 0) {
      errors.push('legWidth: support rail uchun frame ichki kengligi yetarli emas.');
    }
  }
  if (width !== null && depth !== null && tabletopThickness !== null && cornerRadius !== null) {
    if (cornerRadius > Math.min(width, depth, tabletopThickness) / 2) {
      errors.push('cornerRadius: tabletop o‘lchamining yarmidan oshmasligi kerak.');
    }
  }
  if (
    spec.grommetEnabled &&
    grommetDiameter !== null &&
    width !== null &&
    depth !== null
  ) {
    if (grommetDiameter <= 0) {
      errors.push('grommetDiameter: grommet yoqilganda noldan katta bo‘lishi kerak.');
    }
    const radius = grommetDiameter / 2;
    if (radius + GROMMET_EDGE_MARGIN_CM > Math.min(width, depth) / 2) {
      errors.push('grommetDiameter: grommet tabletop chegarasidan chiqadi.');
    }
  }
  if (
    spec.drawerEnabled &&
    drawerWidth !== null &&
    drawerHeight !== null &&
    drawerDepth !== null &&
    width !== null &&
    depth !== null &&
    height !== null &&
    tabletopThickness !== null &&
    legInset !== null &&
    frameInset !== null &&
    frameThickness !== null
  ) {
    if (drawerWidth <= 0 || drawerHeight <= 0 || drawerDepth <= 0) {
      errors.push('drawer: yoqilganda barcha o‘lchamlar noldan katta bo‘lishi kerak.');
    }
    if (drawerWidth > width - 2 * legInset) {
      errors.push('drawerWidth: mavjud kenglikdan oshadi.');
    }
    if (drawerDepth > depth - 2 * legInset) {
      errors.push('drawerDepth: mavjud chuqurlikdan oshadi.');
    }
    const frameWidth = width - 2 * frameInset;
    const frameDepth = depth - 2 * frameInset;
    if (drawerWidth > frameWidth - 2 * frameThickness) {
      errors.push('drawerWidth: frame ichki ochilishidan oshadi.');
    }
    if (drawerDepth > frameDepth - 2 * frameThickness) {
      errors.push('drawerDepth: frame ichki ochilishidan oshadi.');
    }
    if (drawerHeight > height - tabletopThickness) {
      errors.push('drawerHeight: stol ostidagi mavjud balandlikdan oshadi.');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidDeskSpec(spec: DeskSpec): void {
  const result = validateDeskSpec(spec);
  if (!result.valid) {
    throw new DeskSpecError(result.errors);
  }
}

export function createDeskSpec(overrides: Partial<DeskSpec> = {}): DeskSpec {
  return { ...DEFAULT_DESK_SPEC, ...overrides };
}
