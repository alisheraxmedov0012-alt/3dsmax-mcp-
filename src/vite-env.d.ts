/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** W14: enables the assembly feature. Off unless explicitly "true". */
  readonly VITE_ASSEMBLY_ENABLED?: string;
  /** W15.10: enables AI scene editing. Off unless explicitly "true". */
  readonly VITE_AI_EDIT_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
