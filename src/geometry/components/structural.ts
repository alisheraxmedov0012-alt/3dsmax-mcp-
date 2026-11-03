import { GeometryKernelError } from '../kernel';
import {
  frameRecipe,
  panelRecipe,
  shelfRecipe,
  taperedSquareRecipe,
} from './recipes';
import {
  integerInRange,
  nonNegative,
  positive,
  surfaceParams,
} from './validation';
import type {
  ComponentBuild,
  FrameParams,
  LegParams,
  PanelParams,
  ShelfParams,
  SupportParams,
} from './types';

export function buildPanel(params: PanelParams): ComponentBuild {
  const width = positive(params.width, 'panel.width');
  const height = positive(params.height, 'panel.height');
  const thickness = positive(params.thickness, 'panel.thickness');
  const surface = surfaceParams(
    width,
    height,
    thickness,
    params.cornerRadius ?? 0,
    params.bevel ?? 0,
    params.segments ?? 4,
    'panel',
  );
  return {
    geometry: panelRecipe(
      width,
      height,
      thickness,
      surface.cornerRadius,
      surface.bevel,
      surface.segments,
    ),
    dimensions: { width, height, depth: thickness },
    metadata: {
      thickness,
      cornerRadius: surface.cornerRadius,
      bevel: surface.bevel,
      segments: surface.segments,
    },
  };
}

export function buildShelf(params: ShelfParams): ComponentBuild {
  const width = positive(params.width, 'shelf.width');
  const depth = positive(params.depth, 'shelf.depth');
  const thickness = positive(params.thickness, 'shelf.thickness');
  const surface = surfaceParams(
    width,
    thickness,
    depth,
    params.cornerRadius ?? 0,
    params.bevel ?? 0,
    params.segments ?? 4,
    'shelf',
  );
  return {
    geometry: shelfRecipe(
      width,
      thickness,
      depth,
      surface.cornerRadius,
      surface.bevel,
      surface.segments,
    ),
    dimensions: { width, height: thickness, depth },
    metadata: {
      thickness,
      cornerRadius: surface.cornerRadius,
      bevel: surface.bevel,
      segments: surface.segments,
    },
  };
}

export function buildLeg(params: LegParams): ComponentBuild {
  const height = positive(params.height, 'leg.height');
  const taper = nonNegative(params.taper ?? 0, 'leg.taper');
  if (taper > 0.8) {
    throw new GeometryKernelError('invalid_recipe', 'leg.taper: 0–0.8 oralig‘ida bo‘lishi kerak.');
  }
  if (params.shape === 'square') {
    const width = positive(params.width ?? Number.NaN, 'leg.width');
    const depth = positive(params.depth ?? width, 'leg.depth');
    return {
      geometry: taper > 0
        ? taperedSquareRecipe(width, height, taper, depth)
        : { kind: 'box', width, height, depth },
      dimensions: { width, height, depth },
      metadata: { shape: 'square', width, depth, taper },
    };
  }
  if (params.shape !== 'round') {
    throw new GeometryKernelError('invalid_recipe', "leg.shape: 'square' yoki 'round' bo'lishi kerak.");
  }
  const radius = positive(params.radius ?? Number.NaN, 'leg.radius');
  const segments = integerInRange(params.segments ?? 16, 3, 64, 'leg.segments');
  return {
    geometry: {
      kind: 'cylinder',
      radiusTop: radius * (1 - taper),
      radiusBottom: radius,
      height,
      radialSegments: segments,
    },
    dimensions: { width: radius * 2, height, depth: radius * 2 },
    metadata: { shape: 'round', radius, taper, segments },
  };
}

export function buildFrame(params: FrameParams): ComponentBuild {
  const width = positive(params.width, 'frame.width');
  const height = positive(params.height, 'frame.height');
  const depth = positive(params.depth, 'frame.depth');
  const memberThickness = positive(params.memberThickness, 'frame.memberThickness');
  if (memberThickness >= Math.min(width, height) / 2) {
    throw new GeometryKernelError(
      'invalid_recipe',
      'frame.memberThickness: tashqi o‘lchamning yarmidan kichik bo‘lishi kerak.',
    );
  }
  if ((params.profile ?? 'rectangular') !== 'rectangular') {
    throw new GeometryKernelError('invalid_recipe', 'frame.profile: V1 faqat rectangular profilni qo‘llaydi.');
  }
  return {
    geometry: frameRecipe(width, height, depth, memberThickness),
    dimensions: { width, height, depth },
    metadata: { memberThickness, profile: 'rectangular' },
  };
}

export function buildSupport(params: SupportParams): ComponentBuild {
  const width = positive(params.width, 'support.width');
  const height = positive(params.height, 'support.height');
  const depth = positive(params.depth, 'support.depth');
  return {
    geometry: { kind: 'box', width, height, depth },
    dimensions: { width, height, depth },
    metadata: {},
  };
}
