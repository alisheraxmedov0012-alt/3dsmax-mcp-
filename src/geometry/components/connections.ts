import { GeometryKernelError } from '../kernel';
import {
  connectionType,
  nonEmptyId,
  unitDirection,
  vec3,
} from './validation';
import type {
  ComponentConnection,
  ComponentPart,
  ConnectionInput,
} from './types';

function invalid(message: string): never {
  throw new GeometryKernelError('invalid_recipe', message);
}

/** Create validated connection metadata; no physics or solver is implied. */
export function createConnection(input: ConnectionInput): ComponentConnection {
  const id = nonEmptyId(input.id, 'connection.id');
  const type = connectionType(input.type);
  const [first, second] = input.componentIds;
  const firstId = nonEmptyId(first, 'connection.componentIds[0]');
  const secondId = nonEmptyId(second, 'connection.componentIds[1]');
  if (firstId === secondId) {
    invalid('connection.componentIds: ikki xil component bo‘lishi kerak.');
  }
  const hardwareId =
    input.hardwareId === undefined
      ? undefined
      : nonEmptyId(input.hardwareId, 'connection.hardwareId');
  if ((type === 'screw' || type === 'bolt') && hardwareId === undefined) {
    invalid(`connection.type ${type}: hardwareId majburiy.`);
  }
  return {
    id,
    type,
    componentIds: [firstId, secondId],
    position: vec3(input.position, [0, 0, 0], 'connection.position'),
    direction: unitDirection(input.direction, 'connection.direction'),
    ...(hardwareId !== undefined ? { hardwareId } : {}),
    connectionVersion: 1,
    metadata: { ...input.metadata },
  };
}

const PANEL_LIKE = new Set(['panel', 'door', 'shelf']);

/** Validate references and minimum semantics for a connection list. */
export function validateConnections(
  components: readonly ComponentPart[],
  connections: readonly ComponentConnection[],
): void {
  const byId = new Map(components.map((component) => [component.id, component]));
  const seen = new Set<string>();
  for (const connection of connections) {
    if (seen.has(connection.id)) {
      invalid(`connection.id takrorlangan: ${connection.id}.`);
    }
    seen.add(connection.id);
    const related = connection.componentIds.map((id) => {
      const component = byId.get(id);
      if (!component) {
        invalid(`connection ${connection.id}: component "${id}" topilmadi.`);
      }
      return component;
    });
    if (connection.type === 'screw' || connection.type === 'bolt') {
      if (!connection.hardwareId) {
        invalid(`connection ${connection.id}: hardwareId majburiy.`);
      }
      const hardware = byId.get(connection.hardwareId);
      if (!hardware) {
        invalid(`connection ${connection.id}: hardware "${connection.hardwareId}" topilmadi.`);
      }
      if (hardware.type !== 'bolt' && hardware.type !== 'screw') {
        invalid(`connection ${connection.id}: hardware bolt yoki screw bo‘lishi kerak.`);
      }
    } else if (connection.hardwareId) {
      const hardware = byId.get(connection.hardwareId);
      if (!hardware) {
        invalid(`connection ${connection.id}: hardware "${connection.hardwareId}" topilmadi.`);
      }
    }
    if (connection.type === 'leg-to-frame') {
      const types = new Set(related.map((component) => component.type));
      if (!types.has('leg') || !types.has('frame')) {
        invalid(`connection ${connection.id}: leg-to-frame uchun leg va frame kerak.`);
      }
    }
    if (connection.type === 'panel-to-panel') {
      if (!related.every((component) => PANEL_LIKE.has(component.type))) {
        invalid(`connection ${connection.id}: panel-to-panel uchun panel/door/shelf kerak.`);
      }
    }
  }
}
