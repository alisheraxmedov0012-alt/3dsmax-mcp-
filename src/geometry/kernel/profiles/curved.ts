/**
 * Curved frames and handles use the same swept-tube builder as `tube`.
 *
 * Keeping this named entry point makes the intent explicit for furniture
 * builders without introducing a second geometry path or a separate recipe.
 */
export { createTube as createCurved } from './tube';
