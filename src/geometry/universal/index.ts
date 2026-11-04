/**
 * Stage 2.1a — universal furniture builder entry point.
 *
 * Importing this module registers the built-in definitions, so
 * `createFurniturePlan('desk.computer', spec)` works without extra setup.
 */
import './definitions';

export * from './types';
export * from './registry';
export * from './plan';
export * from './validate';
export * from './build';
export * from './collision';
