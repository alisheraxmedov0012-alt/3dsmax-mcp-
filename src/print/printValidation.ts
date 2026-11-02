/**
 * B1 + B3 — turn mesh topology and a printer profile into one report.
 *
 * Every check is explicit and deterministic. A check that cannot be performed
 * returns `NOT_CHECKED`; a check that failed structurally (NaN, bad indices)
 * is blocking for file export, while print-quality findings (open walls, thin
 * walls, too large) are not: exporting a deliberately non-printable model for
 * diagnosis must remain possible.
 */
import * as THREE from 'three';
import { analyzeMeshTopology, type MeshTopology } from './meshTopology';
import { measureMinWallThickness, WALL_THICKNESS_LIMITATIONS } from './wallThickness';
import type { PrinterProfile } from './printerProfile';
import {
  aggregateStatus,
  type PrintCheck,
  type PrintCheckId,
  type PrintCheckStatus,
  type PrintMeshSummary,
  type PrintReadinessReport,
  type PrintTotals,
} from './printTypes';

export interface PrintValidationOptions {
  profile?: PrinterProfile | null;
  /** Caller-supplied identity of the analysed object; reported back for staleness. */
  fingerprint?: string;
  /** Cap on wall-thickness ray samples (default 2000). */
  wallSampleLimit?: number;
}

function namesWhere(
  topologies: readonly MeshTopology[],
  predicate: (mesh: MeshTopology) => boolean,
): string[] {
  return topologies.filter(predicate).map((mesh) => mesh.name);
}

function isWorldVisible(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

interface CheckInput {
  id: PrintCheckId;
  status: PrintCheckStatus;
  code: string;
  label: string;
  message: string;
  remediation?: string;
  meshNames?: string[];
  counts?: Record<string, number>;
  measurements?: Record<string, number>;
  blocking?: boolean;
}

function check(input: CheckInput): PrintCheck {
  return {
    id: input.id,
    status: input.status,
    code: input.code,
    label: input.label,
    message: input.message,
    ...(input.remediation ? { remediation: input.remediation } : {}),
    meshNames: input.meshNames ?? [],
    ...(input.counts ? { counts: input.counts } : {}),
    ...(input.measurements ? { measurements: input.measurements } : {}),
    blocking: input.blocking ?? false,
  };
}

function summarize(
  mesh: MeshTopology,
  wallMm: number | null,
  index: number,
): PrintMeshSummary {
  return {
    index,
    name: mesh.name,
    triangles: mesh.triangles,
    vertices: mesh.vertices,
    weldedVertices: mesh.weldedVertices,
    boundaryEdges: mesh.boundaryEdges,
    nonManifoldEdges: mesh.nonManifoldEdges,
    degenerateTriangles: mesh.degenerateTriangles,
    duplicateTriangles: mesh.duplicateTriangles,
    inconsistentWindingEdges: mesh.inconsistentWindingEdges,
    components: mesh.components,
    closed: mesh.closed,
    manifold: mesh.manifold,
    volumeMm3: mesh.volumeMm3,
    minWallThicknessMm: wallMm,
    negativeScale: mesh.negativeScale,
    nonFiniteVertices: mesh.nonFiniteVertices,
    invalidIndices: mesh.invalidIndices,
    missingNormals: mesh.missingNormals,
    invalidNormals: mesh.invalidNormals,
    boundsMm:
      mesh.bounds === null
        ? null
        : {
            minX: mesh.bounds.min.x * 10,
            minY: mesh.bounds.min.y * 10,
            minZ: mesh.bounds.min.z * 10,
            maxX: mesh.bounds.max.x * 10,
            maxY: mesh.bounds.max.y * 10,
            maxZ: mesh.bounds.max.z * 10,
          },
  };
}

/**
 * Validate the effective geometry of `root` (world transforms and visibility as
 * the exporters see them) against the implemented checks and an optional profile.
 */
export function validatePrintReadiness(
  root: THREE.Object3D,
  options: PrintValidationOptions = {},
): PrintReadinessReport {
  root.updateMatrixWorld(true);

  const topologies: MeshTopology[] = [];
  let meshIndex = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !isWorldVisible(mesh)) return;
    meshIndex += 1;
    topologies.push(analyzeMeshTopology(mesh, `mesh-${meshIndex}`));
  });

  const totals: PrintTotals = {
    meshes: topologies.length,
    triangles: topologies.reduce((sum, mesh) => sum + mesh.triangles, 0),
    vertices: topologies.reduce((sum, mesh) => sum + mesh.vertices, 0),
    components: topologies.reduce((sum, mesh) => sum + mesh.components, 0),
    boundaryEdges: topologies.reduce((sum, mesh) => sum + mesh.boundaryEdges, 0),
    nonManifoldEdges: topologies.reduce((sum, mesh) => sum + mesh.nonManifoldEdges, 0),
    degenerateTriangles: topologies.reduce((sum, mesh) => sum + mesh.degenerateTriangles, 0),
    duplicateTriangles: topologies.reduce((sum, mesh) => sum + mesh.duplicateTriangles, 0),
    inconsistentWindingEdges: topologies.reduce(
      (sum, mesh) => sum + mesh.inconsistentWindingEdges,
      0,
    ),
  };

  // Match the exporters: a hidden mesh is not part of the exported file, so it
  // must not affect bounds, volume or printability either.
  const box = new THREE.Box3();
  for (const mesh of topologies) {
    if (mesh.bounds) box.union(mesh.bounds);
  }
  const hasGeometry = totals.triangles > 0;
  const rawSize = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const sizeMm =
    hasGeometry && !box.isEmpty() && rawSize.every((value) => Number.isFinite(value))
      ? {
          x: Math.round(rawSize[0] * 10),
          y: Math.round(rawSize[1] * 10),
          z: Math.round(rawSize[2] * 10),
        }
      : null;

  const wall = hasGeometry
    ? measureMinWallThickness(root, { sampleLimit: options.wallSampleLimit })
    : null;
  const wallByMesh = new Map<string, number | null>();
  wall?.meshes.forEach((entry) => wallByMesh.set(entry.name, entry.minMm));

  const closedMeshes = topologies.filter((mesh) => mesh.closed);
  const totalVolumeMm3 =
    closedMeshes.length > 0
      ? closedMeshes.reduce((sum, mesh) => sum + (mesh.volumeMm3 ?? 0), 0)
      : null;

  const nonFinite = topologies.reduce((sum, mesh) => sum + mesh.nonFiniteVertices, 0);
  const invalidIndices = topologies.reduce((sum, mesh) => sum + mesh.invalidIndices, 0);
  const incomplete = topologies.some((mesh) => mesh.incompleteTriangles);
  const missingNormals = topologies.filter((mesh) => mesh.missingNormals);
  const invalidNormals = topologies.filter((mesh) => mesh.invalidNormals > 0);
  const opposedNormals = topologies.filter((mesh) => mesh.opposedNormals > 0);
  const degenerate = topologies.filter((mesh) => mesh.degenerateTriangles > 0);
  const duplicates = topologies.filter((mesh) => mesh.duplicateTriangles > 0);
  const open = topologies.filter((mesh) => mesh.boundaryEdges > 0);
  const nonManifold = topologies.filter((mesh) => mesh.nonManifoldEdges > 0);
  const winding = topologies.filter((mesh) => mesh.inconsistentWindingEdges > 0);
  const mirrored = topologies.filter((mesh) => mesh.negativeScale);
  const inverted = closedMeshes.filter((mesh) => mesh.inverted);
  const zeroVolume = closedMeshes.filter((mesh) => (mesh.volumeMm3 ?? 0) <= 1e-6);

  const checks: PrintCheck[] = [];

  checks.push(
    hasGeometry
      ? check({
          id: 'geometry_present',
          status: 'PASS',
          code: 'geometry_present',
          label: 'Geometriya mavjud',
          message: `${totals.meshes} mesh, ${totals.triangles} uchburchak tekshirildi.`,
          counts: { meshes: totals.meshes, triangles: totals.triangles },
        })
      : check({
          id: 'geometry_present',
          status: 'ERROR',
          code: 'empty_geometry',
          label: 'Geometriya mavjud',
          message: "Ko'rinadigan mesh yoki uchburchak yo'q — tekshirish uchun geometriya kerak.",
          remediation: "Obyektni ko'rsating yoki parametrlarni qayta tekshiring.",
          blocking: true,
        }),
  );

  checks.push(
    nonFinite === 0
      ? check({
          id: 'finite_vertices',
          status: 'PASS',
          code: 'finite_vertices',
          label: 'Chekli koordinatalar',
          message: "Barcha vertex koordinatalari chekli (NaN/Infinity yo'q).",
        })
      : check({
          id: 'finite_vertices',
          status: 'ERROR',
          code: 'non_finite_vertices',
          label: 'Chekli koordinatalar',
          message: `${nonFinite} vertex koordinatasi chekli emas (NaN yoki Infinity).`,
          remediation: "Model parametrlarini tuzating; noto'g'ri qiymat bilan fayl yozilmaydi.",
          meshNames: namesWhere(topologies, (mesh) => mesh.nonFiniteVertices > 0),
          counts: { nonFiniteVertices: nonFinite },
          blocking: true,
        }),
  );

  checks.push(
    invalidIndices === 0
      ? check({
          id: 'valid_indices',
          status: 'PASS',
          code: 'valid_indices',
          label: 'Indekslar',
          message: "Barcha indekslar butun son va vertex chegarasida.",
        })
      : check({
          id: 'valid_indices',
          status: 'ERROR',
          code: 'invalid_indices',
          label: 'Indekslar',
          message: `${invalidIndices} indeks noto'g'ri (butun emas yoki vertex chegarasidan tashqarida).`,
          remediation: 'Geometriyani qayta quring; indekslar eksport qilinmaydi.',
          meshNames: namesWhere(topologies, (mesh) => mesh.invalidIndices > 0),
          counts: { invalidIndices },
          blocking: true,
        }),
  );

  checks.push(
    !incomplete
      ? check({
          id: 'triangle_structure',
          status: 'PASS',
          code: 'triangle_structure',
          label: 'Uchburchak tuzilishi',
          message: 'Har bir mesh butun uchburchaklardan iborat.',
        })
      : check({
          id: 'triangle_structure',
          status: 'ERROR',
          code: 'incomplete_triangles',
          label: 'Uchburchak tuzilishi',
          message: "Indekslar soni uchga bo'linmaydi — tugallanmagan uchburchak bor.",
          remediation: 'Geometriya indekslarini tuzating.',
          meshNames: namesWhere(topologies, (mesh) => mesh.incompleteTriangles),
          blocking: true,
        }),
  );

  checks.push(
    invalidNormals.length > 0
      ? check({
          id: 'normals',
          status: 'WARNING',
          code: 'invalid_normals',
          label: 'Normallar',
          message: `${invalidNormals.length} meshda noto'g'ri yoki cheksiz normal bor.`,
          remediation: 'Normallarni qayta hisoblang (geometry.computeVertexNormals).',
          meshNames: invalidNormals.map((mesh) => mesh.name),
          counts: { meshesWithInvalidNormals: invalidNormals.length },
        })
      : missingNormals.length > 0
        ? check({
            id: 'normals',
            status: 'WARNING',
            code: 'missing_normals',
            label: 'Normallar',
            message: `${missingNormals.length} meshda normallar yo'q; STL/3MF uchburchak yo'nalishidan foydalanadi.`,
            remediation:
              'Silliq soyash yoki GLB uchun normallarni hisoblang; STL/3MF buni talab qilmaydi.',
            meshNames: missingNormals.map((mesh) => mesh.name),
            counts: { meshesWithoutNormals: missingNormals.length },
          })
        : opposedNormals.length > 0
          ? check({
              id: 'normals',
              status: 'WARNING',
              code: 'normals_opposed',
              label: 'Normallar',
              message: `${opposedNormals.reduce(
                (sum, mesh) => sum + mesh.opposedNormals,
                0,
              )} uchburchakda normal geometrik yo'nalishga qarama-qarshi.`,
              remediation:
                "Normallarni qayta hisoblang yoki uchburchak yo'nalishini (winding) tuzating.",
              meshNames: opposedNormals.map((mesh) => mesh.name),
            })
          : check({
              id: 'normals',
              status: 'PASS',
              code: 'normals',
              label: 'Normallar',
              message: 'Normallar mavjud, chekli va geometrik yo‘nalishga mos.',
            }),
  );

  checks.push(
    sizeMm === null
      ? check({
          id: 'bounds',
          status: 'ERROR',
          code: 'invalid_bounds',
          label: 'Chegaralar',
          message: "Mesh chegaralarini hisoblab bo'lmadi.",
          remediation: 'Geometriyani tekshiring.',
          blocking: true,
        })
      : check({
          id: 'bounds',
          status: 'PASS',
          code: 'bounds',
          label: 'Chegaralar',
          message: `O'lcham (mm): ${sizeMm.x} × ${sizeMm.y} × ${sizeMm.z}.`,
          measurements: {
            widthMm: sizeMm.x,
            heightMm: sizeMm.y,
            depthMm: sizeMm.z,
          },
        }),
  );

  checks.push(
    degenerate.length === 0
      ? check({
          id: 'degenerate_triangles',
          status: 'PASS',
          code: 'degenerate_triangles',
          label: 'Degenerativ uchburchaklar',
          message: "Nol maydonli yoki takrorlangan vertexli uchburchak yo'q.",
        })
      : check({
          id: 'degenerate_triangles',
          status: 'WARNING',
          code: 'degenerate_triangles',
          label: 'Degenerativ uchburchaklar',
          message: `${totals.degenerateTriangles} degenerativ uchburchak topildi (nol maydon yoki takrorlangan vertex).`,
          remediation:
            "Ularni o'chiring yoki geometriyani qayta quring; slicer ularni tashlab yuborishi mumkin.",
          meshNames: degenerate.map((mesh) => mesh.name),
          counts: { degenerateTriangles: totals.degenerateTriangles },
        }),
  );

  checks.push(
    duplicates.length === 0
      ? check({
          id: 'duplicate_triangles',
          status: 'PASS',
          code: 'duplicate_triangles',
          label: 'Takroriy uchburchaklar',
          message: "Bir xil vertex uchliklaridan iborat takroriy uchburchak yo'q.",
        })
      : check({
          id: 'duplicate_triangles',
          status: 'WARNING',
          code: 'duplicate_triangles',
          label: 'Takroriy uchburchaklar',
          message: `${totals.duplicateTriangles} takroriy uchburchak topildi (bir xil uch vertex).`,
          remediation: 'Takrorlarni olib tashlang; ular ikki marta chop etilishi mumkin.',
          meshNames: duplicates.map((mesh) => mesh.name),
          counts: { duplicateTriangles: totals.duplicateTriangles },
        }),
  );

  checks.push(
    open.length === 0
      ? check({
          id: 'closed_boundary',
          status: 'PASS',
          code: 'closed_boundary',
          label: 'Yopiq chegara',
          message:
            "Ochiq chegara yo'q: har bir uchburchak chekkasi kamida ikki marta ishlatilgan.",
        })
      : check({
          id: 'closed_boundary',
          status: 'ERROR',
          code: 'open_boundaries',
          label: 'Yopiq chegara',
          message: `${totals.boundaryEdges} chegara chekkasi ochiq — mesh suv o'tkazmaydigan emas.`,
          remediation:
            "Teshiklarni yoping yoki devor qalinligi bo'lgan yopiq qismga aylantiring.",
          meshNames: open.map((mesh) => mesh.name),
          counts: { boundaryEdges: totals.boundaryEdges },
        }),
  );

  checks.push(
    nonManifold.length === 0
      ? check({
          id: 'manifold_edges',
          status: 'PASS',
          code: 'manifold_edges',
          label: 'Manifold chekkalar',
          message: "Ikki uchburchakdan ko'p ishlatadigan chekka yo'q.",
        })
      : check({
          id: 'manifold_edges',
          status: 'ERROR',
          code: 'non_manifold_edges',
          label: 'Manifold chekkalar',
          message: `${totals.nonManifoldEdges} chekka ikki uchburchakdan ko'p ishlatilgan (non-manifold).`,
          remediation: "Umumiy chekkalarni ajrating yoki qo'shni qismlarni birlashtiring.",
          meshNames: nonManifold.map((mesh) => mesh.name),
          counts: { nonManifoldEdges: totals.nonManifoldEdges },
        }),
  );

  checks.push(
    winding.length === 0
      ? check({
          id: 'winding_consistency',
          status: 'PASS',
          code: 'winding_consistency',
          label: 'Uchburchak yo‘nalishi',
          message: "Qo'shni uchburchaklar chekka bo'ylab qarama-qarshi yo'nalishda.",
        })
      : check({
          id: 'winding_consistency',
          status: 'ERROR',
          code: 'inconsistent_winding',
          label: 'Uchburchak yo‘nalishi',
          message: `${totals.inconsistentWindingEdges} chekkada ikki uchburchak bir xil yo'nalishda — normal tashqariga qaramaydi.`,
          remediation:
            'Uchburchak tartibini (winding) tuzating yoki normallarni qayta hisoblang.',
          meshNames: winding.map((mesh) => mesh.name),
          counts: { inconsistentWindingEdges: totals.inconsistentWindingEdges },
        }),
  );

  checks.push(
    closedMeshes.length === 0
      ? check({
          id: 'volume',
          status: 'NOT_CHECKED',
          code: 'volume_not_measurable',
          label: 'Hajm',
          message: "Yopiq mesh yo'q — hajmni ishonchli hisoblab bo'lmaydi.",
        })
      : zeroVolume.length > 0
        ? check({
            id: 'volume',
            status: 'ERROR',
            code: 'zero_volume',
            label: 'Hajm',
            message: `${zeroVolume.length} yopiq meshning hajmi nolga teng.`,
            remediation: 'Geometriyani qayta quring; nol hajmli obyekt chop etilmaydi.',
            meshNames: zeroVolume.map((mesh) => mesh.name),
            measurements: { totalVolumeMm3: totalVolumeMm3 ?? 0 },
          })
        : inverted.length > 0
          ? check({
              id: 'volume',
              status: 'WARNING',
              code: 'inverted_winding',
              label: 'Hajm',
              message: `${inverted.length} yopiq mesh ichkariga qaragan (manfiy hajm) — slicer ichki/tashqi tomonni chalkashtirishi mumkin.`,
              remediation: 'Uchburchak yo‘nalishini tashqariga qarating.',
              meshNames: inverted.map((mesh) => mesh.name),
              measurements: { totalVolumeMm3: totalVolumeMm3 ?? 0 },
            })
          : check({
              id: 'volume',
              status: 'PASS',
              code: 'volume',
              label: 'Hajm',
              message: `Yopiq meshlar hajmi: ${Math.round(totalVolumeMm3 ?? 0)} mm³.`,
              measurements: { totalVolumeMm3: Math.round(totalVolumeMm3 ?? 0) },
            }),
  );

  checks.push(
    mirrored.length === 0
      ? check({
          id: 'mirrored_transform',
          status: 'PASS',
          code: 'mirrored_transform',
          label: 'Transformatsiya',
          message: 'Manfiy masshtab (mirror) topilmadi.',
        })
      : check({
          id: 'mirrored_transform',
          status: 'WARNING',
          code: 'mirrored_transform',
          label: 'Transformatsiya',
          message: `${mirrored.length} meshda manfiy masshtab bor — orientatsiya teskari bo'lishi mumkin.`,
          remediation: "Masshtabni musbat qiling yoki aks ettirishni qo'llamang.",
          meshNames: mirrored.map((mesh) => mesh.name),
        }),
  );

  checks.push(
    check({
      id: 'components',
      status: hasGeometry ? 'PASS' : 'NOT_CHECKED',
      code: 'component_count',
      label: 'Komponentlar',
      message: hasGeometry
        ? `${totals.components} alohida ulangan komponent; qismlar alohida yopiq jismlar bo'lishi mumkin.`
        : "Komponentlar yo'q.",
      counts: { components: totals.components },
    }),
  );

  checks.push(
    check({
      id: 'self_intersection',
      status: 'NOT_CHECKED',
      code: 'self_intersection_not_checked',
      label: 'Self-intersection',
      message: "Self-intersection tekshirilmagan: ishonchli algoritm bu buildda mavjud emas.",
      remediation: "Slicer yoki CAD vositasida qo'shimcha tekshiring.",
    }),
  );

  checks.push(
    check({
      id: 'part_overlap',
      status: 'NOT_CHECKED',
      code: 'part_overlap_not_checked',
      label: 'Qismlar kesishuvi',
      message: "Alohida qismlarning bir-biriga kirishi (overlap) tekshirilmagan.",
      remediation: "Yig'ma qismlarini CAD yoki slicerda tekshiring.",
    }),
  );

  const threshold = options.profile?.minWallThicknessMm ?? null;
  const measuredWall = wall?.minMm ?? null;
  if (threshold === null) {
    checks.push(
      check({
        id: 'wall_thickness',
        status: 'NOT_CHECKED',
        code: 'wall_not_configured',
        label: 'Devor qalinligi',
        message:
          measuredWall === null
            ? "Minimal devor qalinligi sozlanmagan — taqqoslash uchun chegara yo'q."
            : `Minimal devor qalinligi sozlanmagan; o'lchangan taxminiy qiymat ${measuredWall} mm.`,
        ...(measuredWall !== null
          ? { measurements: { measuredMinWallMm: measuredWall } }
          : {}),
        remediation: 'Printer/material uchun minimal devor qalinligini kiriting.',
      }),
    );
  } else if (measuredWall === null) {
    checks.push(
      check({
        id: 'wall_thickness',
        status: 'NOT_CHECKED',
        code: 'wall_not_measurable',
        label: 'Devor qalinligi',
        message:
          "Devor qalinligini o'lchab bo'lmadi: nurlar qarama-qarshi sirtni topmadi (ochiq mesh yoki juda yupqa qism).",
        measurements: { targetMinWallMm: threshold },
      }),
    );
  } else {
    const below = measuredWall < threshold;
    const close = !below && measuredWall < threshold * 1.2;
    const thinMeshes = (wall?.meshes ?? [])
      .filter(
        (entry) =>
          entry.minMm !== null && entry.minMm < (below ? threshold : threshold * 1.2),
      )
      .map((entry) => entry.name);
    checks.push(
      check({
        id: 'wall_thickness',
        status: below ? 'ERROR' : close ? 'WARNING' : 'PASS',
        code: below ? 'wall_below_target' : close ? 'wall_close_to_target' : 'wall_thickness',
        meshNames: below || close ? thinMeshes : [],
        label: 'Devor qalinligi',
        message: below
          ? `O'lchangan minimal devor ${measuredWall} mm — belgilangan ${threshold} mm dan yupqa.`
          : close
            ? `O'lchangan minimal devor ${measuredWall} mm — belgilangan ${threshold} mm ga juda yaqin.`
            : `O'lchangan minimal devor ${measuredWall} mm — belgilangan ${threshold} mm dan qalin.`,
        remediation: below
          ? 'Devor qalinligini oshiring yoki yupqa qismlarni qayta loyihalang.'
          : undefined,
        measurements: { measuredMinWallMm: measuredWall, targetMinWallMm: threshold },
      }),
    );
  }

  checks.push(
    check({
      id: 'min_feature_size',
      status: 'NOT_CHECKED',
      code: 'feature_size_not_checked',
      label: 'Minimal feature size',
      message:
        options.profile?.minFeatureSizeMm != null
          ? `Sozlama ${options.profile.minFeatureSizeMm} mm, lekin feature size o'lchanmagan.`
          : "Minimal feature size sozlanmagan va o'lchanmagan.",
    }),
  );

  const buildVolume = options.profile?.buildVolumeMm ?? null;
  if (buildVolume === null) {
    checks.push(
      check({
        id: 'build_volume',
        status: 'NOT_CHECKED',
        code: 'build_volume_not_configured',
        label: 'Build volume',
        message: "Printer build volume sozlanmagan — mos kelishini tekshirib bo'lmaydi.",
        remediation: 'Printerning X/Y/Z build volume qiymatlarini kiriting.',
      }),
    );
  } else if (sizeMm === null) {
    checks.push(
      check({
        id: 'build_volume',
        status: 'NOT_CHECKED',
        code: 'build_volume_no_size',
        label: 'Build volume',
        message: "Model o'lchami noma'lum — build volume bilan solishtirib bo'lmaydi.",
        measurements: {
          buildVolumeXmm: buildVolume.x,
          buildVolumeYmm: buildVolume.y,
          buildVolumeZmm: buildVolume.z,
        },
      }),
    );
  } else {
    const exceeded: string[] = [];
    if (sizeMm.x > buildVolume.x) exceeded.push(`X (${sizeMm.x} > ${buildVolume.x})`);
    if (sizeMm.y > buildVolume.y) exceeded.push(`Y (${sizeMm.y} > ${buildVolume.y})`);
    if (sizeMm.z > buildVolume.z) exceeded.push(`Z (${sizeMm.z} > ${buildVolume.z})`);
    checks.push(
      exceeded.length === 0
        ? check({
            id: 'build_volume',
            status: 'PASS',
            code: 'build_volume',
            label: 'Build volume',
            message: `Model joriy orientatsiyada ${buildVolume.x} × ${buildVolume.y} × ${buildVolume.z} mm ichida.`,
            measurements: {
              widthMm: sizeMm.x,
              heightMm: sizeMm.y,
              depthMm: sizeMm.z,
              buildVolumeXmm: buildVolume.x,
              buildVolumeYmm: buildVolume.y,
              buildVolumeZmm: buildVolume.z,
            },
          })
        : check({
            id: 'build_volume',
            status: 'ERROR',
            code: 'build_volume_exceeded',
            label: 'Build volume',
            message: `Model joriy orientatsiyada build volume'dan katta: ${exceeded.join(', ')} mm.`,
            remediation: "Modelni aylantiring, kichiklashtiring yoki qismlarga bo'ling.",
            measurements: {
              widthMm: sizeMm.x,
              heightMm: sizeMm.y,
              depthMm: sizeMm.z,
              buildVolumeXmm: buildVolume.x,
              buildVolumeYmm: buildVolume.y,
              buildVolumeZmm: buildVolume.z,
            },
          }),
    );
  }

  const minYmm =
    sizeMm !== null && !box.isEmpty() ? Math.round(box.min.y * 10 * 100) / 100 : null;
  checks.push(
    minYmm === null
      ? check({
          id: 'build_plate',
          status: 'NOT_CHECKED',
          code: 'build_plate_no_geometry',
          label: 'Build plate',
          message: "Geometriya yo'q — build plate holatini tekshirib bo'lmaydi.",
        })
      : minYmm < -0.01
        ? check({
            id: 'build_plate',
            status: 'WARNING',
            code: 'below_build_plate',
            label: 'Build plate',
            message: `Model build plate'dan ${Math.abs(minYmm)} mm pastga tushgan.`,
            remediation:
              "Obyektni yuqoriga suring (position Y ≥ 0) yoki slicer'da joylashtiring.",
            measurements: { minYmm },
          })
        : check({
            id: 'build_plate',
            status: 'PASS',
            code: 'build_plate',
            label: 'Build plate',
            message: `Model build plate ustida (min Y = ${minYmm} mm).`,
            measurements: { minYmm },
          }),
  );

  checks.push(
    check({
      id: 'overhang_supports',
      status: 'NOT_CHECKED',
      code: 'overhang_not_checked',
      label: 'Overhang va support',
      message:
        'Overhang, support va print vaqti tekshirilmagan — bounding box buni aniqlamaydi.',
    }),
  );

  checks.push(
    check({
      id: 'slicer',
      status: 'NOT_CHECKED',
      code: 'slicer_not_run',
      label: 'Slicer',
      message: 'Slicer ishga tushirilmagan: slicer dasturi bu muhitda chaqirilmadi.',
      remediation: "Yakuniy tekshiruvni o'z sliceringizda bajaring.",
    }),
  );

  const meshes = topologies.map((mesh, index) =>
    summarize(mesh, wallByMesh.get(mesh.name) ?? null, index),
  );

  return {
    status: aggregateStatus(checks),
    exportable: !checks.some((entry) => entry.blocking && entry.status === 'ERROR'),
    checks,
    meshes,
    totals,
    sizeMm,
    volumeMm3: totalVolumeMm3,
    minWallThicknessMm: measuredWall,
    profile: options.profile ?? null,
    fingerprint: options.fingerprint ?? '',
    limitations: [
      "Devor qalinligi faqat sirt normali bo'ylab nurlar bilan taxmin qilinadi — slicer o'lchovi emas.",
      ...WALL_THICKNESS_LIMITATIONS,
      'Self-intersection tekshirilmagan.',
      "Alohida qismlarning kesishuvi (overlap) va vertex-manifoldlik tekshirilmagan.",
      'Overhang, support, print vaqti va material sarfi tekshirilmagan.',
      'Slicer ishga tushirilmagan — slicer tekshiruvi NOT_CHECKED.',
      'Bu hisobot 3D-print kafolati yoki sertifikat emas.',
    ],
    counts: {
      PASS: checks.filter((entry) => entry.status === 'PASS').length,
      WARNING: checks.filter((entry) => entry.status === 'WARNING').length,
      ERROR: checks.filter((entry) => entry.status === 'ERROR').length,
      NOT_CHECKED: checks.filter((entry) => entry.status === 'NOT_CHECKED').length,
    },
  };
}
