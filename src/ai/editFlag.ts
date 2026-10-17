/**
 * W15.10 — feature flag for AI scene editing.
 *
 * The panel ships behind a flag so the whole feature can be switched off without
 * touching code if something goes wrong after merge (plan §9, rollback level
 * R0). With the flag off, `AiEditPanel` is not rendered at all; the scene, the
 * viewer, export, projects and the undo/redo shortcuts are untouched.
 *
 * Default is **off**. It is turned on by setting `VITE_AI_EDIT_ENABLED=true` at
 * **build** time — Vite inlines `VITE_*` values into the bundle, so changing the
 * value at runtime has no effect until a new build is produced.
 */

export const AI_EDIT_FLAG_NAME = 'VITE_AI_EDIT_ENABLED';

/**
 * Parses a raw flag value.
 *
 * Only the exact string `true` (surrounding whitespace and case ignored) enables
 * the feature. Everything else — `undefined`, `''`, `'false'`, `'0'`, `'1'`,
 * `'yes'`, `'on'` — leaves it off.
 *
 * `Boolean(value)` is deliberately not used: `Boolean('false')` is `true`, which
 * would turn the feature on with the value a rollback sets.
 */
export function parseFlagValue(raw: unknown): boolean {
  if (typeof raw !== 'string') {
    return false;
  }
  return raw.trim().toLowerCase() === 'true';
}

/** True when AI editing is enabled for this build. */
export function aiEditEnabled(): boolean {
  return parseFlagValue(import.meta.env?.VITE_AI_EDIT_ENABLED);
}
