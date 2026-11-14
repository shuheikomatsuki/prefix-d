import * as THREE from 'three';

/**
 * 車の塗装・ガラス・ホイールに映り込む、まわりの景色（scene.environment）。
 * 上は明るい空、地平線は白っぽく光り、下は暗い地面のグラデーションの球を、ぼかした映り込み用の画像にする。
 * 映り込みを使うのは MeshStandardMaterial・MeshPhysicalMaterial（車）だけで、道路や山の見た目は変わらない
 */
export function createReflections(renderer: THREE.WebGLRenderer): THREE.Texture {
  const geo = new THREE.SphereGeometry(10, 48, 24);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const sky = new THREE.Color(0x8fb4e0);
  const horizon = new THREE.Color(0xf4f6f8);
  const ground = new THREE.Color(0x3a4034);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 10;
    if (t >= 0) c.copy(horizon).lerp(sky, Math.pow(t, 0.6));
    else c.copy(horizon).lerp(ground, Math.min(1, -t * 6));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  geo.dispose();
  return texture;
}
