import type { TableParams } from '../geometry/tableParams';
import type { RoomConfig } from '../scene/types';

export interface FramingVector {
  x: number;
  y: number;
  z: number;
}

export interface TableFraming {
  position: FramingVector;
  target: FramingVector;
}

/**
 * Computes the default camera framing for a table of the given parameters.
 * Pure math (no Three.js objects), so the default/reset-view behaviour can be
 * tested without a WebGL context.
 */
export function computeTableFraming(params: TableParams): TableFraming {
  const maxDim = Math.max(params.widthCm, params.heightCm, params.depthCm);
  const distance = maxDim * 2.2;

  return {
    position: {
      x: distance * 0.8,
      y: params.heightCm + maxDim * 0.8,
      z: distance,
    },
    target: {
      x: 0,
      y: params.heightCm / 2,
      z: 0,
    },
  };
}

/**
 * Computes a useful camera framing for a room: an elevated three-quarter view
 * from outside a corner, aimed at the middle of the room. Pure math so the
 * room reset-view behaviour is testable without a browser.
 */
export function computeRoomFraming(room: RoomConfig): TableFraming {
  const span = Math.max(room.widthCm, room.lengthCm, room.heightCm);
  const distance = span * 1.6;

  return {
    position: {
      x: distance * 0.9,
      y: room.heightCm + span * 0.7,
      z: distance,
    },
    target: {
      x: 0,
      y: room.heightCm / 2,
      z: 0,
    },
  };
}
