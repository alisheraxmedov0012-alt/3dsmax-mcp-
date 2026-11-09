/**
 * Phase 9A.2.1 — Interior domain entry point.
 *
 * Importing this module registers `room.standard` in the interior registry.
 * The furniture generic registry and the legacy room builder are untouched.
 */
import './registry';

export * from './types';
export * from './roomSpec';
export * from './roomPlan';
export * from './roomDefinition';
export * from './registry';
