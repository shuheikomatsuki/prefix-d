import * as THREE from 'three';
import { type SurfaceTextures, TEXTURE_METERS, surfaceTextures } from './courseTextures';

/**
 * コースの質感付きの材質（アスファルト・地面・岩・コンクリート・白線）。
 * 質感の画像は「1 枚 = TEXTURE_METERS [m]」で貼るので、ジオメトリの UV はメートル単位で付ける（worldUV など）。
 * 材質はコースを作り直しても使い回し（userData.shared）、雨の日は濡れた見た目（setCourseWetness）にする
 */

export type SurfaceKind = keyof typeof TEXTURE_METERS;

interface Options {
  /** 材質の色（頂点の色を使うときは掛け合わせる。省略すると白） */
  color?: number;
  vertexColors?: boolean;
  /** 手前に描く段（路面 1・白線 2 など。重なった薄い面のちらつきを防ぐ） */
  layer?: number;
  side?: THREE.Side;
  flatShading?: boolean;
}

/** 濡れたときに、どれだけつやが出るか（粗さを下げる割合）と、どれだけ暗くなるか */
const WET: Record<SurfaceKind, { gloss: number; darken: number }> = {
  asphalt: { gloss: 0.6, darken: 0.35 },
  paint: { gloss: 0.6, darken: 0.15 },
  concrete: { gloss: 0.45, darken: 0.25 },
  rock: { gloss: 0.45, darken: 0.3 },
  ground: { gloss: 0.2, darken: 0.2 },
};

/**
 * 元の色（質感のない、光の当たり方の簡単な材質で決めた色）に掛ける明るさ。つやのある材質は空の映り込みの分だけ
 * 明るく見えるのと、草は少し濃い色のほうが本物らしい
 */
const BRIGHTNESS: Record<SurfaceKind, number> = { asphalt: 0.9, paint: 0.95, concrete: 0.92, rock: 0.95, ground: 0.62 };

/** 景色の映り込みの強さ（空の光と二重に明るくならないよう弱める。濡れると強くなる） */
const ENV_DRY = 0.15;
const ENV_WET = 1;

interface Entry {
  material: THREE.MeshStandardMaterial;
  kind: SurfaceKind;
  color: THREE.Color;
}

const materials = new Map<string, Entry>();
let wetness = 0;

function apply(e: Entry) {
  const wet = WET[e.kind];
  e.material.roughness = 1 - wet.gloss * wetness;
  e.material.color.copy(e.color).multiplyScalar(1 - wet.darken * wetness);
  e.material.envMapIntensity = ENV_DRY + (ENV_WET - ENV_DRY) * wetness * wet.gloss;
  // 濡れると細かい凹凸に水がたまって平らになる（凹凸のまま光らせると、ラメのようにちらつく）
  e.material.normalScale.setScalar(0.8 * (1 - 0.8 * wetness * wet.gloss));
}

/** 質感付きの材質（同じ指定なら同じものを返す） */
export function surfaceMaterial(kind: SurfaceKind, options: Options = {}): THREE.MeshStandardMaterial {
  const key = `${kind}:${options.color ?? 'w'}:${options.vertexColors ? 1 : 0}:${options.layer ?? 0}:${options.side ?? 0}:${options.flatShading ? 1 : 0}`;
  let e = materials.get(key);
  if (!e) {
    const tex: SurfaceTextures = surfaceTextures(kind);
    const layer = options.layer ?? 0;
    const material = new THREE.MeshStandardMaterial({
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      metalness: 0,
      vertexColors: options.vertexColors ?? false,
      side: options.side ?? THREE.FrontSide,
      flatShading: options.flatShading ?? false,
      polygonOffset: layer > 0,
      polygonOffsetFactor: -layer,
      polygonOffsetUnits: -layer,
    });
    material.userData.shared = true;
    // 画像の平均の明るさで割って、元の色の明るさに戻す
    const color = new THREE.Color(options.color ?? 0xffffff).multiplyScalar(BRIGHTNESS[kind] / tex.mean);
    e = { material, kind, color };
    materials.set(key, e);
    apply(e);
  }
  return e.material;
}

/** 雨の日の濡れ具合（0 = 乾いている、1 = びしょ濡れ）を、すべてのコースの材質に反映する */
export function setCourseWetness(w: number): void {
  wetness = Math.max(0, Math.min(1, w));
  for (const e of materials.values()) apply(e);
}

/**
 * ワールド座標からメートル単位の UV を付ける（各頂点の法線の一番大きい向きに投影する。上向きの面は x, z、
 * 横向きの面は水平の位置と高さ）。meters は画像 1 枚の大きさ
 */
export function worldUV(geo: THREE.BufferGeometry, meters: number): THREE.BufferGeometry {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u / meters;
    uv[i * 2 + 1] = v / meters;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
