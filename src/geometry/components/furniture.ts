import { GeometryKernelError } from '../kernel';
import { barHandleRecipe, drawerRecipe, knobHandleRecipe, panelRecipe } from './recipes';
import { integerInRange, positive, surfaceParams } from './validation';
import type {
  ComponentBuild,
  DoorParams,
  DrawerParams,
  HandleParams,
} from './types';

export function buildDrawer(params: DrawerParams): ComponentBuild {
  const width = positive(params.width, 'drawer.width');
  const height = positive(params.height, 'drawer.height');
  const depth = positive(params.depth, 'drawer.depth');
  const sideThickness = positive(params.sideThickness, 'drawer.sideThickness');
  const bottomThickness = positive(params.bottomThickness, 'drawer.bottomThickness');
  if (sideThickness >= width / 2 || bottomThickness >= height / 2) {
    throw new GeometryKernelError(
      'invalid_recipe',
      "drawer: sideThickness/bottomThickness tegishli o'lchamning yarmidan kichik bo'lishi kerak.",
    );
  }
  return {
    geometry: drawerRecipe(width, height, depth, sideThickness, bottomThickness),
    dimensions: { width, height, depth },
    metadata: { sideThickness, bottomThickness },
  };
}

export function buildDoor(params: DoorParams): ComponentBuild {
  const width = positive(params.width, 'door.width');
  const height = positive(params.height, 'door.height');
  const thickness = positive(params.thickness, 'door.thickness');
  const surface = surfaceParams(
    width,
    height,
    thickness,
    params.cornerRadius ?? 0,
    params.bevel ?? 0,
    params.segments ?? 4,
    'door',
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

export function buildHandle(params: HandleParams): ComponentBuild {
  const diameter = positive(params.diameter, 'handle.diameter');
  const projection = positive(params.projection, 'handle.projection');
  const segments = integerInRange(params.segments ?? 24, 4, 64, 'handle.segments');

  if (params.type === 'bar') {
    const length = positive(params.length ?? Number.NaN, 'handle.length');
    const mountingDistance = positive(
      params.mountingDistance ?? Number.NaN,
      'handle.mountingDistance',
    );
    if (mountingDistance > length) {
      throw new GeometryKernelError(
        'invalid_recipe',
        'handle.mountingDistance: handle.length dan oshmasligi kerak.',
      );
    }
    return {
      geometry: barHandleRecipe(length, projection, diameter, segments),
      dimensions: {
        width: length + diameter,
        height: projection + diameter,
        depth: diameter,
      },
      metadata: { type: 'bar', length, mountingDistance, diameter, projection, segments },
    };
  }

  if (params.type !== 'knob') {
    throw new GeometryKernelError('invalid_recipe', "handle.type: 'bar' yoki 'knob' bo'lishi kerak.");
  }
  if (params.mountingDistance !== undefined) {
    positive(params.mountingDistance, 'handle.mountingDistance');
  }
  return {
    geometry: knobHandleRecipe(diameter, projection, segments),
    dimensions: { width: diameter, height: projection, depth: diameter },
    metadata: {
      type: 'knob',
      diameter,
      projection,
      segments,
      ...(params.mountingDistance !== undefined ? { mountingDistance: params.mountingDistance } : {}),
    },
  };
}
