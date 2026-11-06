import { GeometryKernelError } from '../kernel';
import {
  frameRecipe,
  panelRecipe,
  plateRecipe,
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
  if (params.plate === true) {
    return {
      geometry: plateRecipe(
        width,
        thickness,
        height,
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
        plate: true,
      },
    };
  }
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
  if (params.hole !== undefined || params.plate === true) {
    const hole = params.hole;
    if (hole !== undefined) {
      const radius = positive(hole.radius, 'shelf.hole.radius');
      const x = hole.x;
      const z = hole.z;
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        throw new GeometryKernelError(
          'invalid_recipe',
          'shelf.hole: x va z chekli son bo‘lishi kerak.',
        );
      }
      if (
        Math.abs(x) + radius > width / 2 ||
        Math.abs(z) + radius > depth / 2
      ) {
        throw new GeometryKernelError(
          'invalid_recipe',
          'shelf.hole: teshik panel chegarasidan chiqmasligi kerak.',
        );
      }
    }
    return {
      geometry: plateRecipe(
        width,
        thickness,
        depth,
        surface.cornerRadius,
        surface.bevel,
        surface.segments,
        hole,
      ),
      dimensions: { width, height: thickness, depth },
      metadata: {
        thickness,
        cornerRadius: surface.cornerRadius,
        bevel: surface.bevel,
        segments: surface.segments,
        ...(hole === undefined ? {} : { hole }),
      },
    };
  }
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
    const bevel = nonNegative(params.bevel ?? 0, 'leg.bevel');
    const bevelSegments = integerInRange(
      params.bevelSegments ?? 2,
      1,
      8,
      'leg.bevelSegments',
    );
    const radius = Math.min(bevel, width / 2, depth / 2, height / 2);
    if (taper > 0) {
      if (bevel > 0) {
        throw new GeometryKernelError(
          'invalid_recipe',
          'leg: taper va bevel bir vaqtda qo‘llanmaydi.',
        );
      }
      return {
        geometry: taperedSquareRecipe(width, height, taper, depth),
        dimensions: { width, height, depth },
        metadata: { shape: 'square', width, depth, taper },
      };
    }
    return {
      geometry: radius > 0
        ? {
            kind: 'roundedBox',
            width,
            height,
            depth,
            radius,
            segments: bevelSegments,
          }
        : { kind: 'box', width, height, depth },
      dimensions: { width, height, depth },
      metadata: {
        shape: 'square',
        width,
        depth,
        taper,
        ...(bevel > 0 ? { bevel, bevelSegments } : {}),
      },
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
  const bevel = nonNegative(params.bevel ?? 0, 'frame.bevel');
  if (memberThickness >= Math.min(width, height) / 2) {
    throw new GeometryKernelError(
      'invalid_recipe',
      'frame.memberThickness: tashqi o‘lchamning yarmidan kichik bo‘lishi kerak.',
    );
  }
  if (bevel >= Math.min(memberThickness, depth / 2)) {
    throw new GeometryKernelError(
      'invalid_recipe',
      'frame.bevel: memberThickness va depth/2 dan kichik bo‘lishi kerak.',
    );
  }
  if ((params.profile ?? 'rectangular') !== 'rectangular') {
    throw new GeometryKernelError('invalid_recipe', 'frame.profile: V1 faqat rectangular profilni qo‘llaydi.');
  }
  return {
    geometry: frameRecipe(width, height, depth, memberThickness, bevel),
    dimensions: { width, height, depth },
    metadata: {
      memberThickness,
      profile: 'rectangular',
      ...(bevel > 0 ? { bevel } : {}),
    },
  };
}

export function buildSupport(params: SupportParams): ComponentBuild {
  const width = positive(params.width, 'support.width');
  const height = positive(params.height, 'support.height');
  const depth = positive(params.depth, 'support.depth');
  const surface = surfaceParams(
    width,
    height,
    depth,
    0,
    params.bevel ?? 0,
    params.segments ?? 2,
    'support',
  );
  return {
    geometry: panelRecipe(
      width,
      height,
      depth,
      0,
      surface.bevel,
      surface.segments,
    ),
    dimensions: { width, height, depth },
    metadata:
      surface.bevel > 0
        ? { bevel: surface.bevel, segments: surface.segments }
        : {},
  };
}
