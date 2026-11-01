// 基本形状の生成と、マテリアル別に結合してドローコールを減らすモデルビルダー
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UVS = 4; // テクスチャ1枚 = 4m

export function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// 面ごとに実寸に合わせたUVを持つ箱
export function boxGeo(w, h, d, s = UVS) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / s, uv.getY(i) * dims[f][1] / s);
    }
  }
  return g;
}

export function cylGeo(rt, rb, h, seg = 16, s = UVS, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  return scaleUV(g, (Math.PI * 2 * Math.max(rt, rb)) / s, h / s);
}

// 切妻屋根（棟はローカルX方向）。slopes と gables を別ジオメトリで返す
export function gableRoof(w, d, h, o = 0.5, s = UVS) {
  const W = w / 2 + o, D = d / 2 + o;
  const L = Math.hypot(h, D);
  const pos = [], uv = [];
  const quad = (a, b, c, dd, ua, ub, uc, ud) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...dd);
    uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
  };
  quad([-W, 0, D], [W, 0, D], [W, h, 0], [-W, h, 0], [-W / s, 0], [W / s, 0], [W / s, L / s], [-W / s, L / s]);
  quad([W, 0, -D], [-W, 0, -D], [-W, h, 0], [W, h, 0], [-W / s, 0], [W / s, 0], [W / s, L / s], [-W / s, L / s]);
  const slopes = new THREE.BufferGeometry();
  slopes.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  slopes.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  slopes.computeVertexNormals();
  const hw = w / 2, hd = d / 2;
  const gp = [hw, 0, hd, hw, 0, -hd, hw, h, 0, -hw, 0, -hd, -hw, 0, hd, -hw, h, 0];
  const gu = [hd / s, 0, -hd / s, 0, 0, h / s, -hd / s, 0, hd / s, 0, 0, h / s];
  const gables = new THREE.BufferGeometry();
  gables.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  gables.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
  gables.computeVertexNormals();
  return { slopes, gables };
}

// 四角錐屋根（w×d の正方形底面）
export function pyramidGeo(w, h, d) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  g.scale(w, h, d);
  return scaleUV(g, 2, 2);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class ModelBuilder {
  constructor() { this.parts = new Map(); }

  add(geo, mat, t = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
    _q.setFromEuler(_e);
    _p.set(t.x || 0, t.y || 0, t.z || 0);
    _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }

  // 中心(x, y, z) の箱
  box(w, h, d, mat, t = {}) { return this.add(boxGeo(w, h, d), mat, t); }

  // y0〜y1 の高さ範囲を持つ箱
  boxY(w, d, y0, y1, mat, t = {}) {
    if (y1 - y0 < 0.01) return this;
    return this.add(boxGeo(w, y1 - y0, d), mat, { ...t, y: (y0 + y1) / 2 });
  }

  // ローカル直線 (x0,z0)-(x1,z1) 上に狭間付き胸壁の凸部を並べる
  merlons(x0, z0, x1, z1, y, mat, { spacing = 1.9, w = 1.0, h = 0.95, d = 0.55 } = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.floor(len / spacing));
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      this.box(Math.min(w, len / n * 0.6), h, d, mat, { x: x0 + (x1 - x0) * t, y: y + h / 2, z: z0 + (z1 - z0) * t, ry });
    }
    return this;
  }

  build(shadows = true) {
    const group = new THREE.Group();
    for (const [mat, geos] of this.parts) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      for (const g of geos) if (g !== merged) g.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}
