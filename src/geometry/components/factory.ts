import type * as THREE from 'three';
import { validateRecipe, type GeometryRecipe } from '../kernel';
import type { PartBuilder } from '../furniture/parts';
import { buildDoor, buildDrawer, buildHandle } from './furniture';
import { buildGrommet, buildBolt, buildScrew, buildFoot } from './hardware';
import { buildFrame, buildLeg, buildPanel, buildShelf, buildSupport } from './structural';
import {
  nonEmptyId,
  vec3,
} from './validation';
import {
  COMPONENT_VERSION,
  type ComponentBuild,
  type ComponentMaterialSlot,
  type ComponentParamsMap,
  type ComponentPart,
  type ComponentPlacement,
  type ComponentRole,
  type ComponentType,
} from './types';

interface ComponentDefaults {
  readonly role: ComponentRole;
  readonly materialSlot: ComponentMaterialSlot;
}

const DEFAULTS: Record<ComponentType, ComponentDefaults> = {
  panel: { role: 'panel', materialSlot: 'panel' },
  leg: { role: 'leg', materialSlot: 'frame' },
  frame: { role: 'frame', materialSlot: 'frame' },
  shelf: { role: 'shelf', materialSlot: 'panel' },
  support: { role: 'support', materialSlot: 'frame' },
  drawer: { role: 'drawer', materialSlot: 'panel' },
  door: { role: 'door', materialSlot: 'panel' },
  handle: { role: 'handle', materialSlot: 'hardware' },
  grommet: { role: 'grommet', materialSlot: 'hardware' },
  bolt: { role: 'bolt', materialSlot: 'hardware' },
  screw: { role: 'screw', materialSlot: 'hardware' },
  foot: { role: 'foot', materialSlot: 'hardware' },
};

function build<K extends ComponentType>(
  type: K,
  params: ComponentParamsMap[K],
): ComponentBuild {
  switch (type) {
    case 'panel':
      return buildPanel(params as ComponentParamsMap['panel']);
    case 'leg':
      return buildLeg(params as ComponentParamsMap['leg']);
    case 'frame':
      return buildFrame(params as ComponentParamsMap['frame']);
    case 'shelf':
      return buildShelf(params as ComponentParamsMap['shelf']);
    case 'support':
      return buildSupport(params as ComponentParamsMap['support']);
    case 'drawer':
      return buildDrawer(params as ComponentParamsMap['drawer']);
    case 'door':
      return buildDoor(params as ComponentParamsMap['door']);
    case 'handle':
      return buildHandle(params as ComponentParamsMap['handle']);
    case 'grommet':
      return buildGrommet(params as ComponentParamsMap['grommet']);
    case 'bolt':
      return buildBolt(params as ComponentParamsMap['bolt']);
    case 'screw':
      return buildScrew(params as ComponentParamsMap['screw']);
    case 'foot':
      return buildFoot(params as ComponentParamsMap['foot']);
    default: {
      const exhaustive: never = type;
      throw new Error(`Qo'llab-quvvatlanmaydigan component turi: ${String(exhaustive)}`);
    }
  }
}

/** Build an immutable component description; no material or Three.js object is created. */
export function createComponent<K extends ComponentType>(
  type: K,
  id: string,
  params: ComponentParamsMap[K],
  placement: ComponentPlacement = {},
): ComponentPart {
  const componentId = nonEmptyId(id, 'component.id');
  const built = build(type, params);
  validateRecipe(built.geometry);
  const defaults = DEFAULTS[type];
  const role = placement.role ?? defaults.role;
  const materialSlot = placement.materialSlot ?? defaults.materialSlot;
  const metadata = {
    ...placement.metadata,
    ...built.metadata,
    partId: componentId,
    role,
    materialSlot,
    componentVersion: COMPONENT_VERSION,
  };
  return {
    id: componentId,
    type,
    dimensions: built.dimensions,
    position: vec3(placement.position, [0, 0, 0], 'component.position'),
    rotation: vec3(placement.rotation, [0, 0, 0], 'component.rotation'),
    geometry: built.geometry,
    role,
    materialSlot,
    componentVersion: COMPONENT_VERSION,
    metadata,
  };
}

/** Materialise one component through the Stage 1.1 PartBuilder/kernel path. */
const DEG_TO_RAD = Math.PI / 180;

/** Convert component rotation degrees to the radians PartBuilder/Three.js expects. */
export function addComponent(builder: PartBuilder, component: ComponentPart): THREE.Mesh {
  return builder.addGeometry(
    component.id,
    component.geometry,
    [component.position[0], component.position[1], component.position[2]],
    [
      component.rotation[0] * DEG_TO_RAD,
      component.rotation[1] * DEG_TO_RAD,
      component.rotation[2] * DEG_TO_RAD,
    ],
  );
}

export function addComponents(
  builder: PartBuilder,
  components: readonly ComponentPart[],
): THREE.Mesh[] {
  return components.map((component) => addComponent(builder, component));
}

export type { GeometryRecipe };
