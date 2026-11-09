import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildExportScene } from '../export/sceneExport';
import { resolveRoomMaterials } from '../geometry/interior/roomMaterials';
import { ROOM_SLOTS } from '../geometry/interior/roomDefinition';
import { INTERIOR_FIXTURES } from './interiorFixtures';

function meshNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      names.push(object.name);
    }
  });
  return names;
}

describe('9A.2.8 — interior QA fixtures', () => {
  it('defines four deterministic fixtures with unique ids', () => {
    expect(INTERIOR_FIXTURES.map((fixture) => fixture.id)).toEqual([
      'room-only',
      'furniture-room',
      'multi-room',
      'hidden-room',
    ]);
    expect(new Set(INTERIOR_FIXTURES.map((fixture) => fixture.id)).size).toBe(
      INTERIOR_FIXTURES.length,
    );
    for (const fixture of INTERIOR_FIXTURES) {
      expect(JSON.parse(JSON.stringify(fixture.scene))).toEqual(fixture.scene);
    }
  });

  it.each(INTERIOR_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    '%s matches its scene expectations',
    (_id, fixture) => {
      const built = buildExportScene(fixture.scene);
      try {
        built.scene.updateMatrixWorld(true);
        const names = meshNames(built.scene);

        const box = new THREE.Box3().setFromObject(built.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        expect(size.x).toBeCloseTo(fixture.expectations.bboxCm[0], 0);
        expect(size.y).toBeCloseTo(fixture.expectations.bboxCm[1], 0);
        expect(size.z).toBeCloseTo(fixture.expectations.bboxCm[2], 0);

        expect(names.length).toBeGreaterThanOrEqual(fixture.expectations.minMeshes);
        expect(names.filter((name) => name.includes('room-baseboard'))).toHaveLength(
          fixture.expectations.baseboardParts,
        );
        expect(names.filter((name) => name.includes('room-crown-molding'))).toHaveLength(
          fixture.expectations.crownParts,
        );

        for (const required of fixture.expectations.requiredObjectNames) {
          expect(built.scene.getObjectByName(required), required).toBeDefined();
        }
        for (const forbidden of fixture.expectations.forbiddenObjectNames) {
          expect(built.scene.getObjectByName(forbidden), forbidden).toBeUndefined();
        }
        for (const include of fixture.expectations.requiredNameIncludes) {
          expect(names.some((name) => name.includes(include)), include).toBe(true);
        }

        for (const [roomId, translation] of Object.entries(
          fixture.expectations.roomTranslationsCm,
        )) {
          const group = built.scene.getObjectByName(`room:${roomId}`);
          expect(group, roomId).toBeDefined();
          expect(group?.position.x).toBeCloseTo(translation[0], 6);
          expect(group?.position.y).toBeCloseTo(translation[1], 6);
          expect(group?.position.z).toBeCloseTo(translation[2], 6);
        }

        const visibleRooms = (fixture.scene.rooms ?? []).filter((room) => room.visible);
        const floorTiles = visibleRooms
          .map((room) => resolveRoomMaterials(ROOM_SLOTS, room.spec).tiles.floor)
          .sort((left, right) => left - right);
        expect(floorTiles).toEqual(
          [...fixture.expectations.floorTilesCm].sort((a, b) => a - b),
        );
        for (const room of visibleRooms) {
          const tiles = resolveRoomMaterials(ROOM_SLOTS, room.spec).tiles;
          expect(tiles.baseboard).toBe(fixture.expectations.baseboardTileCm);
          expect(tiles['crown-molding']).toBe(fixture.expectations.crownTileCm);
        }

        const raycaster = new THREE.Raycaster();
        for (const ray of fixture.expectations.rays) {
          const targets: THREE.Object3D[] = [];
          built.scene.traverse((object) => {
            if (
              object instanceof THREE.Mesh &&
              ray.objectNameIncludes.some((fragment) => object.name.includes(fragment))
            ) {
              targets.push(object);
            }
          });
          expect(targets.length, ray.id).toBeGreaterThan(0);
          raycaster.set(
            new THREE.Vector3(...ray.originCm),
            new THREE.Vector3(...ray.directionCm).normalize(),
          );
          const hits = raycaster.intersectObjects(targets, false);
          if (ray.expect === 'pass') {
            expect(hits, ray.id).toHaveLength(0);
          } else {
            expect(hits.length, ray.id).toBeGreaterThan(0);
          }
        }
      } finally {
        built.dispose();
      }
    },
  );
});
