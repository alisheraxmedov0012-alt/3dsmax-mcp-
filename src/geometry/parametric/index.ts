/**
 * Phase 9A.1 — category-neutral parametric contract.
 *
 * Importing this module registers the built-in furniture definitions (through
 * the registry) and exposes a domain-agnostic view of them.
 */
import '../universal/definitions';

export * from './types';
export * from './registry';
export * from './plan';
export * from './build';
