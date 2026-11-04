/**
 * Stage 2.1a — structural plan validation.
 *
 * Every rule produces a structured issue; nothing is corrected silently. The
 * geometry check builds each recipe through the kernel (budget included) and
 * disposes it immediately, so a plan is only accepted when its parts can
 * actually be materialised.
 */
import {
  createGeometry,
  GeometryKernelError,
  geometryStats,
  type Vec3Tuple,
} from '../kernel';
import type {
  FurniturePlanDraft,
  PlanIssue,
  PlanPart,
  PlanValidationResult,
  RegisteredFurnitureDefinition,
} from './types';

function finiteTuple(value: Vec3Tuple): boolean {
  return value.length === 3 && value.every((item) => Number.isFinite(item));
}

function issue(
  code: PlanIssue['code'],
  message: string,
  extra: { partId?: string; connectionId?: string } = {},
): PlanIssue {
  return { code, message, ...extra };
}

function checkManufacturing(part: PlanPart): PlanIssue[] {
  const manufacturing = part.manufacturing;
  if (!manufacturing) {
    return [];
  }
  if (!manufacturing.boxCm) {
    return [
      issue(
        'invalid_manufacturing',
        `"${part.id}": manufacturing.boxCm majburiy (metadata berilgan).`,
        { partId: part.id },
      ),
    ];
  }
  const box = manufacturing.boxCm;
  if (!finiteTuple(box) || box.some((value) => value <= 0)) {
    return [
      issue(
        'invalid_manufacturing',
        `"${part.id}": manufacturing.boxCm musbat chekli sonlar bo'lishi kerak.`,
        { partId: part.id },
      ),
    ];
  }
  if (part.geometry.kind !== 'box') {
    return [
      issue(
        'invalid_manufacturing',
        `"${part.id}": manufacturing.boxCm faqat box geometry uchun qo'llanadi.`,
        { partId: part.id },
      ),
    ];
  }
  const expected: Vec3Tuple = [part.geometry.width, part.geometry.height, part.geometry.depth];
  const matches = expected.every((value, index) => Math.abs(value - box[index]) <= 1e-9);
  if (!matches) {
    return [
      issue(
        'invalid_manufacturing',
        `"${part.id}": manufacturing.boxCm geometry o'lchamlariga mos emas.`,
        { partId: part.id },
      ),
    ];
  }
  return [];
}

export function validatePlanDraft(
  draft: FurniturePlanDraft,
  definition: RegisteredFurnitureDefinition,
): PlanValidationResult {
  const errors: PlanIssue[] = [];

  if (draft.parts.length > definition.limits.maxParts) {
    errors.push(
      issue(
        'part_budget_exceeded',
        `Plan ${draft.parts.length} ta partdan iborat; limit ${definition.limits.maxParts}.`,
      ),
    );
  }

  const slotIds = new Set(definition.slots.map((slot) => slot.id));
  const partIds = new Set<string>();
  let totalVertices = 0;

  for (const part of draft.parts) {
    if (part.id.trim() === '') {
      errors.push(issue('duplicate_part_id', 'Part id bo‘sh bo‘lmasligi kerak.'));
    } else if (partIds.has(part.id)) {
      errors.push(
        issue('duplicate_part_id', `Takroriy part id: "${part.id}".`, { partId: part.id }),
      );
    } else {
      partIds.add(part.id);
    }

    if (!finiteTuple(part.position) || !finiteTuple(part.rotation)) {
      errors.push(
        issue(
          'non_finite_transform',
          `"${part.id}": position va rotation chekli sonlardan iborat bo'lishi kerak.`,
          { partId: part.id },
        ),
      );
    }

    if (
      !finiteTuple([part.dimensions.width, part.dimensions.height, part.dimensions.depth]) ||
      part.dimensions.width <= 0 ||
      part.dimensions.height <= 0 ||
      part.dimensions.depth <= 0
    ) {
      errors.push(
        issue(
          'invalid_dimensions',
          `"${part.id}": dimensions musbat chekli sonlar bo'lishi kerak.`,
          { partId: part.id },
        ),
      );
    }

    if (!slotIds.has(part.materialSlot)) {
      errors.push(
        issue(
          'invalid_material_slot',
          `"${part.id}": materialSlot "${part.materialSlot}" definition slotlarida yo'q.`,
          { partId: part.id },
        ),
      );
    }

    try {
      const geometry = createGeometry(part.geometry, {
        maxVertices: definition.limits.maxPartVertices,
        maxTriangles: definition.limits.maxPartTriangles,
      });
      try {
        totalVertices += geometryStats(geometry).vertices;
      } finally {
        geometry.dispose();
      }
    } catch (error) {
      const budget =
        error instanceof GeometryKernelError && error.code === 'budget_exceeded';
      errors.push(
        issue(
          budget ? 'geometry_budget_exceeded' : 'invalid_geometry_recipe',
          `"${part.id}": ${error instanceof Error ? error.message : 'geometry yaratilmadi.'}`,
          { partId: part.id },
        ),
      );
    }

    errors.push(...checkManufacturing(part));
  }

  for (const part of draft.parts) {
    if (part.parentId !== undefined && !partIds.has(part.parentId)) {
      errors.push(
        issue(
          'missing_parent',
          `"${part.id}": parentId "${part.parentId}" topilmadi.`,
          { partId: part.id },
        ),
      );
    }
  }

  if (totalVertices > definition.limits.maxTotalVertices) {
    errors.push(
      issue(
        'geometry_budget_exceeded',
        `Plan jami ${totalVertices} vertexdan iborat; limit ${definition.limits.maxTotalVertices}.`,
      ),
    );
  }

  const connectionIds = new Set<string>();
  for (const connection of draft.connections) {
    if (connectionIds.has(connection.id)) {
      errors.push(
        issue('duplicate_connection_id', `Takroriy connection id: "${connection.id}".`, {
          connectionId: connection.id,
        }),
      );
    } else {
      connectionIds.add(connection.id);
    }
    for (const componentId of connection.componentIds) {
      if (!partIds.has(componentId)) {
        errors.push(
          issue(
            'missing_connection_component',
            `Connection "${connection.id}": component "${componentId}" topilmadi.`,
            { connectionId: connection.id },
          ),
        );
      }
    }
    if (connection.hardwareId !== undefined && !partIds.has(connection.hardwareId)) {
      errors.push(
        issue(
          'missing_connection_hardware',
          `Connection "${connection.id}": hardware "${connection.hardwareId}" topilmadi.`,
          { connectionId: connection.id },
        ),
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
