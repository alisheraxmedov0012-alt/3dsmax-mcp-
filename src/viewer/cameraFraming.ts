import type { TableParams } from '../geometry/tableParams';

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
