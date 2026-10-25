/**
 * C8.6.1 — fit checks for stacked parts.
 *
 * Two builders place N repeated parts inside a fixed opening:
 *
 * - `buildShelf` stacks `shelfCount` boards between the bottom and top panels.
 * - `buildDresser` stacks `drawerCount` fronts over the body height.
 *
 * Both derive the pitch from the available space and clamp each part to a
 * minimum thickness. When the opening is too short for the requested count, the
 * clamp wins over the pitch and consecutive parts overlap. The mesh stays finite
 * and every part keeps a positive size, so nothing downstream noticed — but the
 * piece cannot be built as modelled.
 *
 * This module holds the *layout scalars* both the builders and the parameter
 * validator use, so the rule that rejects a combination is by construction the
 * same arithmetic that would have produced the overlap. Duplicating the formula
 * in a validator is how the two drift apart.
 *
 * Deliberately free of `three`: `params.ts` imports this module, and that module
 * is used by pure validation everywhere. The local `clamp` mirrors
 * `clampValue` in `parts.ts` (clamp to the fallback-ordered bounds) without
 * pulling the geometry library in.
 */

/** Interior wall thickness of a dresser carcass, in centimetres. */
export const DRESSER_WALL_CM = 2;
/** Drawer/door front thickness, in centimetres. */
export const DRESSER_FRONT_THICKNESS_CM = 2;

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(numeric, lower), upper);
}

export interface ShelfLayout {
  /** Side/top/bottom/board thickness after clamping, in cm. */
  wallCm: number;
  innerWidthCm: number;
  /** Clear opening between the bottom and top panels, in cm. */
  innerHeightCm: number;
  shelfCount: number;
  /** Centre-to-centre distance between neighbouring boards, in cm. */
  pitchCm: number;
  shelfDepthCm: number;
}

/**
 * Layout of the shelf boards, exactly as `buildShelf` places them.
 *
 * Boards sit at `wallCm + pitchCm * i` for i = 1..shelfCount and are `wallCm`
 * thick, so two neighbours are clear of each other only while
 * `pitchCm >= wallCm`.
 */
export function shelfLayout(params: {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  wallThicknessCm?: number;
  shelfCount?: number;
}): ShelfLayout {
  const { widthCm, heightCm, depthCm } = params;
  const wallCm = clamp(params.wallThicknessCm, 1, Math.min(widthCm, heightCm, depthCm) / 3, 2);
  const innerWidthCm = Math.max(widthCm - 2 * wallCm, wallCm);
  const innerHeightCm = Math.max(heightCm - 2 * wallCm, wallCm);
  const shelfCount = Math.round(clamp(params.shelfCount, 1, 8, 4));
  const usable = Math.max(innerHeightCm, wallCm);
  const pitchCm = usable / (shelfCount + 1);
  const shelfDepthCm = Math.max(depthCm - wallCm, wallCm);
  return { wallCm, innerWidthCm, innerHeightCm, shelfCount, pitchCm, shelfDepthCm };
}

export interface DrawerLayout {
  legHeightCm: number;
  /** Front-panel area height, in cm. */
  bodyHeightCm: number;
  /** Y of the body's bottom face (the leg height), in cm. */
  bodyBottomCm: number;
  frontHeightCm: number;
  innerWidthCm: number;
  drawerCount: number;
  /** Vertical distance between neighbouring drawer centres, in cm. */
  pitchCm: number;
  drawerHeightCm: number;
}

/**
 * Layout of the drawer stack, exactly as `buildDresser` places it.
 *
 * Fronts are `drawerHeightCm` tall and their centres are `pitchCm` apart, so
 * neighbours stay clear only while `pitchCm >= drawerHeightCm`. Because
 * `drawerHeightCm` is `max(pitchCm - 1, DRESSER_WALL_CM)`, that is equivalent to
 * `pitchCm >= DRESSER_WALL_CM`.
 */
export function drawerLayout(params: {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  drawerCount?: number;
  doorCount?: number;
  legHeightCm?: number;
}): DrawerLayout {
  const { widthCm, heightCm } = params;
  const legHeightCm = clamp(params.legHeightCm, 0, Math.max(heightCm - 10, 0), 10);
  const bodyHeightCm = Math.max(heightCm - legHeightCm, 10);
  const drawerCount = Math.round(clamp(params.drawerCount, 1, 6, 3));
  const innerWidthCm = Math.max(widthCm - 2 * DRESSER_WALL_CM, DRESSER_WALL_CM);
  const frontHeightCm = Math.max(bodyHeightCm - DRESSER_WALL_CM, DRESSER_WALL_CM);
  const pitchCm = frontHeightCm / drawerCount;
  const drawerHeightCm = Math.max(pitchCm - 1, DRESSER_WALL_CM);
  return {
    legHeightCm,
    bodyHeightCm,
    bodyBottomCm: legHeightCm,
    frontHeightCm,
    innerWidthCm,
    drawerCount,
    pitchCm,
    drawerHeightCm,
  };
}

/**
 * Why the shelf boards do not fit, or `null` when they do.
 *
 * The message names the numbers that clash so the user can act on it, and it is
 * the same for the editor, the storage validator and the C4 report because all
 * three go through `relationErrors`.
 */
export function shelfFitProblem(params: {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  wallThicknessCm?: number;
  shelfCount?: number;
}): string | null {
  const layout = shelfLayout(params);
  if (layout.pitchCm >= layout.wallCm - 1e-9) {
    return null;
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  const maxBoards = Math.max(
    Math.floor(layout.innerHeightCm / layout.wallCm) - 1,
    0,
  );
  return (
    `Tokchalar ${layout.shelfCount} ta, lekin ichki balandlik ${round(layout.innerHeightCm)} sm ` +
    `va tokcha qalinligi ${round(layout.wallCm)} sm — oraliq ${round(layout.pitchCm)} sm bo'lib, ` +
    `tokchalar bir-biriga kirib ketadi. ` +
    `Bu balandlikda ko'pi bilan ${maxBoards} ta tokcha sig'adi; ` +
    `tokchalar sonini kamaytiring yoki balandlikni oshiring.`
  );
}

/** Why the drawer fronts do not fit, or `null` when they do. */
export function drawerFitProblem(params: {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  drawerCount?: number;
  doorCount?: number;
  legHeightCm?: number;
}): string | null {
  const layout = drawerLayout(params);
  if (layout.pitchCm >= layout.drawerHeightCm - 1e-9) {
    return null;
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  const maxDrawers = Math.max(Math.floor(layout.frontHeightCm / DRESSER_WALL_CM), 1);
  return (
    `Tortmalar ${layout.drawerCount} ta, lekin old panel balandligi ` +
    `${round(layout.frontHeightCm)} sm (korpus ${round(layout.bodyHeightCm)} sm, ` +
    `oyoq ${round(layout.legHeightCm)} sm) — har bir tortmaga ${round(layout.pitchCm)} sm ` +
    `to'g'ri keladi va oldlar bir-biriga kirib ketadi. ` +
    `Bu o'lchamda ko'pi bilan ${maxDrawers} ta tortma sig'adi; ` +
    `tortmalar sonini kamaytiring, oyoq balandligini pasaytiring yoki balandlikni oshiring.`
  );
}
