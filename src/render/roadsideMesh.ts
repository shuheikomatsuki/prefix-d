import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoadsideProp } from '../map/roadside';

/**
 * 峠の道ばたの小物の見た目（視線誘導標・矢印板・カーブミラー）。種類と色ごとに 1 つのメッシュにまとめる
 */

/** 小物の部品を、その小物の位置と向きに置く（部品は小物の正面が +Z、根元が原点） */
function placed(g: THREE.BufferGeometry, p: RoadsideProp): THREE.BufferGeometry {
  g.rotateY(p.yaw);
  g.translate(p.x, p.y, p.z);
  return g.index ? g.toNonIndexed() : g;
}

/** 矢印板の「く」の字の矢印（板の表の面、左向き。turn = -1 で右向き） */
function chevronArrow(turn: number, w: number, h: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const t = w * 0.22;
  s.moveTo(-w * 0.3, 0);
  s.lineTo(w * 0.12, h * 0.4);
  s.lineTo(w * 0.12 + t, h * 0.4);
  s.lineTo(-w * 0.3 + t, 0);
  s.lineTo(w * 0.12 + t, -h * 0.4);
  s.lineTo(w * 0.12, -h * 0.4);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  // ShapeGeometry は XY 平面で +Z を向く。正面から見て左が -X なので、右向きは左右を反転する
  if (turn < 0) g.scale(-1, 1, 1);
  return g;
}

export function buildRoadside(props: readonly RoadsideProp[]): THREE.Group {
  const group = new THREE.Group();
  const parts: Record<string, THREE.BufferGeometry[]> = { white: [], orange: [], yellow: [], black: [], grey: [], mirrorPole: [], glass: [] };
  for (const p of props) {
    if (p.kind === 'delineator') {
      // 白いポールの上の方に、来る車のほうへ向けたオレンジの丸い反射板
      parts.white.push(placed(new THREE.CylinderGeometry(0.035, 0.04, 1.1, 8).translate(0, 0.55, 0), p));
      parts.orange.push(placed(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12).rotateX(Math.PI / 2).translate(0, 1.0, 0.045), p));
      parts.black.push(placed(new THREE.BoxGeometry(0.08, 0.1, 0.02).translate(0, 0.86, 0.035), p));
    } else if (p.kind === 'chevron') {
      const w = 0.55;
      const h = 0.7;
      const top = 1.05 + h;
      parts.grey.push(placed(new THREE.CylinderGeometry(0.03, 0.03, top, 6).translate(0, top / 2, -0.03), p));
      parts.yellow.push(placed(new THREE.BoxGeometry(w, h, 0.02).translate(0, 1.05 + h / 2, 0), p));
      // 矢印は表と裏の両方に描く（裏から見ても曲がる向きがわかるよう、裏は左右反転）
      parts.black.push(placed(chevronArrow(p.turn, w, h).translate(0, 1.05 + h / 2, 0.011), p));
      parts.black.push(placed(chevronArrow(-p.turn, w, h).rotateY(Math.PI).translate(0, 1.05 + h / 2, -0.011), p));
    } else {
      // カーブミラー: オレンジのポールの上に、丸い鏡（オレンジの縁と、景色を映す鏡面）
      const top = 2.7;
      parts.mirrorPole.push(placed(new THREE.CylinderGeometry(0.045, 0.05, top, 10).translate(0, top / 2, 0), p));
      parts.mirrorPole.push(placed(new THREE.BoxGeometry(0.08, 0.08, 0.28).translate(0, top - 0.05, 0.12), p));
      const rim = new THREE.CylinderGeometry(0.36, 0.36, 0.08, 24).rotateX(Math.PI / 2);
      parts.mirrorPole.push(placed(rim.rotateX(-0.12).translate(0, top + 0.05, 0.28), p));
      // 鏡は少しふくらんだ凸面（広い範囲を映す）
      const glass = new THREE.SphereGeometry(0.9, 24, 8, 0, Math.PI * 2, 0, 0.36).rotateX(Math.PI / 2);
      glass.translate(0, 0, -0.9 * Math.cos(0.36) + 0.045);
      parts.glass.push(placed(glass.rotateX(-0.12).translate(0, top + 0.05, 0.28), p));
    }
  }
  const mats: Record<string, THREE.Material> = {
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }),
    // 反射板はヘッドライトが当たると光って見えるよう、少しだけ自分で光らせる
    orange: new THREE.MeshStandardMaterial({ color: 0xff8a1c, emissive: 0xff6a00, emissiveIntensity: 0.35, roughness: 0.3 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf6c400, emissive: 0x3a2c00, roughness: 0.45, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x9ba0a6, metalness: 0.6, roughness: 0.45 }),
    mirrorPole: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04, envMapIntensity: 1.2 }),
  };
  for (const [key, geos] of Object.entries(parts)) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mats[key]);
    mesh.castShadow = key !== 'black' && key !== 'glass';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
