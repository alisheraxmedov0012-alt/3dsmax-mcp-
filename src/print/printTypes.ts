/**
 * B1/B3 — print-validation vocabulary.
 *
 * Statuses are explicit because "unknown" and "passed" are different answers.
 * A check that this build cannot perform must say `NOT_CHECKED`; it must never
 * default to `PASS`.
 */
import type { PrinterProfile } from './printerProfile';

export type PrintCheckStatus = 'PASS' | 'WARNING' | 'ERROR' | 'NOT_CHECKED';

export const PRINT_STATUS_LABELS: Record<PrintCheckStatus, string> = {
  PASS: "O'tdi",
  WARNING: 'Ogohlantirish',
  ERROR: 'Xato',
  NOT_CHECKED: 'Tekshirilmadi',
};

/** Severity used to aggregate an overall status. `NOT_CHECKED` adds no severity. */
export const PRINT_STATUS_SEVERITY: Record<PrintCheckStatus, number> = {
  NOT_CHECKED: 0,
  PASS: 1,
  WARNING: 2,
  ERROR: 3,
};

export type PrintCheckId =
  | 'geometry_present'
  | 'finite_vertices'
  | 'valid_indices'
  | 'triangle_structure'
  | 'degenerate_triangles'
  | 'duplicate_triangles'
  | 'normals'
  | 'bounds'
  | 'closed_boundary'
  | 'manifold_edges'
  | 'winding_consistency'
  | 'volume'
  | 'mirrored_transform'
  | 'components'
  | 'self_intersection'
  | 'part_overlap'
  | 'wall_thickness'
  | 'min_feature_size'
  | 'build_volume'
  | 'build_plate'
  | 'overhang_supports'
  | 'slicer';

export interface PrintCheck {
  id: PrintCheckId;
  status: PrintCheckStatus;
  /** Stable machine-readable code, independent of the localized message. */
  code: string;
  label: string;
  message: string;
  remediation?: string;
  /** Meshes the finding applies to, in traversal order. */
  meshNames: string[];
  counts?: Record<string, number>;
  measurements?: Record<string, number>;
  /**
   * True when the finding means the file itself would be corrupt or unreadable.
   * Print-quality findings (open walls, thin walls, too large) never block file
   * creation — a diagnostic or intentionally non-printable model may still be
   * exported.
   */
  blocking: boolean;
}

export interface PrintMeshSummary {
  /** Stable index in traversal order; names may repeat. */
  index: number;
  name: string;
  triangles: number;
  vertices: number;
  weldedVertices: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
  inconsistentWindingEdges: number;
  components: number;
  closed: boolean;
  manifold: boolean;
  /** Signed-volume magnitude in mm³; `null` when the mesh is open/not measurable. */
  volumeMm3: number | null;
  /** Measured minimum wall thickness in mm, when the ray approximation found one. */
  minWallThicknessMm: number | null;
  negativeScale: boolean;
  nonFiniteVertices: number;
  invalidIndices: number;
  missingNormals: boolean;
  invalidNormals: number;
  boundsMm: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null;
}

export interface PrintTotals {
  meshes: number;
  triangles: number;
  vertices: number;
  components: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
  inconsistentWindingEdges: number;
}

export interface PrintReadinessReport {
  /** Worst implemented check; `NOT_CHECKED` only when nothing was checked. */
  status: PrintCheckStatus;
  /** True when no blocking (file-integrity) check failed. */
  exportable: boolean;
  checks: PrintCheck[];
  meshes: PrintMeshSummary[];
  totals: PrintTotals;
  /** World-space size in millimetres, matching what the STL/3MF exporters write. */
  sizeMm: { x: number; y: number; z: number } | null;
  volumeMm3: number | null;
  minWallThicknessMm: number | null;
  profile: PrinterProfile | null;
  /** Changes whenever the object or profile changes; used to reject stale results. */
  fingerprint: string;
  limitations: string[];
  counts: Record<PrintCheckStatus, number>;
}

export function aggregateStatus(checks: readonly PrintCheck[]): PrintCheckStatus {
  let worst: PrintCheckStatus = 'NOT_CHECKED';
  for (const check of checks) {
    if (PRINT_STATUS_SEVERITY[check.status] > PRINT_STATUS_SEVERITY[worst]) {
      worst = check.status;
    }
  }
  return worst;
}
