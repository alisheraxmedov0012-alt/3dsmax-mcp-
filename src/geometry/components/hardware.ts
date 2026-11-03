import { GeometryKernelError } from '../kernel';
import { fastenerRecipe, grommetRecipe } from './recipes';
import { inRange, integerInRange, positive } from './validation';
import type {
  BoltParams,
  ComponentBuild,
  FootParams,
  GrommetParams,
  ScrewParams,
} from './types';

export function buildGrommet(params: GrommetParams): ComponentBuild {
  const outerRadius = positive(params.outerRadius, 'grommet.outerRadius');
  const innerRadius = positive(params.innerRadius, 'grommet.innerRadius');
  const thickness = positive(params.thickness, 'grommet.thickness');
  const segments = integerInRange(params.segments ?? 32, 3, 128, 'grommet.segments');
  if (innerRadius >= outerRadius) {
    throw new GeometryKernelError(
      'invalid_recipe',
      'grommet.innerRadius: outerRadius dan kichik bo‘lishi kerak.',
    );
  }
  return {
    geometry: grommetRecipe(outerRadius, innerRadius, thickness, segments),
    dimensions: {
      width: outerRadius * 2,
      height: thickness,
      depth: outerRadius * 2,
    },
    metadata: { outerRadius, innerRadius, thickness, segments },
  };
}

function buildFastener(
  label: 'bolt' | 'screw',
  params: BoltParams | ScrewParams,
): ComponentBuild {
  const shaftDiameter = positive(params.shaftDiameter, `${label}.shaftDiameter`);
  const length = positive(params.length, `${label}.length`);
  const headDiameter = positive(params.headDiameter, `${label}.headDiameter`);
  const headHeight = positive(params.headHeight, `${label}.headHeight`);
  const segments = integerInRange(params.segments ?? 16, 8, 64, `${label}.segments`);
  if (headDiameter < shaftDiameter) {
    throw new GeometryKernelError(
      'invalid_recipe',
      `${label}.headDiameter: shaftDiameter dan kichik bo‘lmasligi kerak.`,
    );
  }
  if (headHeight >= length) {
    throw new GeometryKernelError(
      'invalid_recipe',
      `${label}.headHeight: length dan kichik bo‘lishi kerak.`,
    );
  }
  return {
    geometry: fastenerRecipe(shaftDiameter, length, headDiameter, headHeight, segments),
    dimensions: { width: headDiameter, height: length, depth: headDiameter },
    metadata: { shaftDiameter, length, headDiameter, headHeight, segments },
  };
}

export function buildBolt(params: BoltParams): ComponentBuild {
  return buildFastener('bolt', params);
}

export function buildScrew(params: ScrewParams): ComponentBuild {
  return buildFastener('screw', params);
}

export function buildFoot(params: FootParams): ComponentBuild {
  const height = positive(params.height, 'foot.height');
  const diameter = positive(params.diameter, 'foot.diameter');
  const taper = inRange(params.taper ?? 0, 0, 0.8, 'foot.taper');
  const segments = integerInRange(params.segments ?? 16, 3, 64, 'foot.segments');
  return {
    geometry: {
      kind: 'cylinder',
      radiusTop: (diameter / 2) * (1 - taper),
      radiusBottom: diameter / 2,
      height,
      radialSegments: segments,
    },
    dimensions: { width: diameter, height, depth: diameter },
    metadata: { diameter, taper, segments },
  };
}
