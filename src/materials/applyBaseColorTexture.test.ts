import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyBaseColorTextureToGroup } from './applyBaseColorTexture';

describe('applyBaseColorTextureToGroup', () => {
  it('applies one texture to every unique standard material and whitens the tint', () => {
    const shared = new THREE.MeshStandardMaterial({ color: '#aa0000' });
    const own = new THREE.MeshStandardMaterial({ color: '#00aa00' });
    const plain = new THREE.MeshBasicMaterial({ color: '#0000aa' });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), own));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plain));

    const texture = new THREE.Texture();
    const applied = applyBaseColorTextureToGroup(group, texture);

    expect(applied).toBe(2);
    expect(shared.map).toBe(texture);
    expect(own.map).toBe(texture);
    expect(shared.color.getHexString()).toBe('ffffff');
    expect(own.color.getHexString()).toBe('ffffff');
    expect(plain.map).toBeNull();
  });
});
