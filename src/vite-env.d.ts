/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** W14: enables the assembly feature. Off unless explicitly "true". */
  readonly VITE_ASSEMBLY_ENABLED?: string;
  /** A3.3: AI request deadline in milliseconds. Defaults to 30 seconds. */
  readonly VITE_AI_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
