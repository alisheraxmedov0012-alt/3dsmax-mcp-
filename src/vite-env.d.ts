/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** W14: enables the assembly feature. Off unless explicitly "true". */
  readonly VITE_ASSEMBLY_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
