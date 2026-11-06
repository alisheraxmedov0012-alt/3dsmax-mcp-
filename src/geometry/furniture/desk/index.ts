export {
  DEFAULT_DESK_SPEC,
  DeskSpecError,
  GROMMET_EDGE_MARGIN_CM,
  assertValidDeskSpec,
  createDeskSpec,
  validateDeskSpec,
  type DeskSpec,
  type DeskSpecValidation,
} from './spec';
export { solveDesk, type DeskAssemblyPlan, type DeskSolveOptions } from './solver';
export { buildDesk, createDefaultDesk, type BuiltDesk, type DeskMaterialSlot } from './builder';
