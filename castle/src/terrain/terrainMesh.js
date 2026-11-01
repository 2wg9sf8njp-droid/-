// 地形の3D表現：本体メッシュ（頂点カラー・表示モード切替）、外周の遠景、水面、領域境界
import * as THREE from 'three';
import { SURFACE, MAP_SIZE } from './generator.js';
import { getMaterials } from '../render/materials.js';
import { clamp, lerp, smoothstep } from '../core/rng.js';

const C = (hex) => new THREE.Color(hex);
const SURF_COL = {
  [SURFACE.WATER]: C(0x4f5a48),
  [SURFACE.SHORE]: C(0x9c9372),
  [SURFACE.GRASS]: C(0x6f8a4c),
  [SURFACE.FERTILE]: C(0x93965a),
  [SURFACE.FOREST]: C(0x47603a),
  [SURFACE.ROCK]: C(0x86826f),
  [SURFACE.CLIFF]: C(0x6d655a),
};

const tmpC = new THREE.Color();

function cellColorNormal(t, k) {
  const base = SURF_COL[t.cType[k]];
  tmpC.copy(base);
  const det = t.cDetail[k];
  const h = t.cH[k];
  if (t.cType[k] === SURFACE.GRASS || t.cType[k] === SURFACE.FERTILE) {
    tmpC.offsetHSL(det * 0.025, det * 0.05, det * 0.04);
    // 標高が上がると乾いた色に
    tmpC.lerp(C(0x8c8a5c), smoothstep(14, 34, h) * 0.45);
  } else {
    tmpC.offsetHSL(0, 0, det * 0.03);
  }
  return tmpC;
}

function heightRamp(h) {
  const stops = [
    [-3, 0x3a5a7a], [0.5, 0x5f8f6a], [6, 0x86a560], [14, 0xc5b865], [24, 0xb88a52], [40, 0x8c6a5a], [70, 0xeeeeee],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (h <= stops[i + 1][0]) {
      const t = clamp((h - stops[i][0]) / (stops[i + 1][0] - stops[i][0]), 0, 1);
      return tmpC.set(stops[i][1]).lerp(C(stops[i + 1][1]), t);
    }
  }
  return tmpC.set(0xeeeeee);
}

function cellColor(mode, t, k) {
  if (mode === 'normal') return cellColorNormal(t, k);
  if (mode === 'height') return heightRamp(t.cH[k]);
  if (mode === 'build') {
    const s = t.cSlope[k];
    if (!t.buildableAt(k)) return tmpC.set(0xb8483a);
    if (s > 0.35) return tmpC.set(0xd08a3a);
    if (s > 0.15) return tmpC.set(0xd8c45a);
    return tmpC.set(0x6fae5a);
  }
  if (mode === 'resource') {
    const ty = t.cType[k];
    if (ty === SURFACE.WATER) return tmpC.set(0x3a5a7a);
    if (ty === SURFACE.FOREST) return tmpC.set(0x2f5a2a).lerp(C(0x5fbf4a), clamp(t.cWood[k] / 240, 0, 1));
    if (t.cStone[k] > 0) return tmpC.set(0x6a7080).lerp(C(0xc0c8d8), clamp(t.cStone[k] / 220, 0, 1));
    return tmpC.set(0x605a48).lerp(C(0xe0c050), t.cFert[k]);
  }
  return tmpC.set(0xff00ff);
}

export class TerrainView {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mode = 'normal';
    this._buildMain();
    this._buildOuter();
    this._buildWater();
    this._buildBorder();
  }

  _buildMain() {
    const t = this.terrain;
    const { vn, half, cell } = t;
    const pos = new Float32Array(vn * vn * 3);
    const uv = new Float32Array(vn * vn * 2);
    for (let j = 0; j < vn; j++) for (let i = 0; i < vn; i++) {
      const k = j * vn + i;
      pos[k * 3] = -half + i * cell;
      pos[k * 3 + 1] = t.heights[k];
      pos[k * 3 + 2] = -half + j * cell;
      uv[k * 2] = (i * cell) / 6; uv[k * 2 + 1] = (j * cell) / 6;
    }
    const n = t.n;
    const idx = new Uint32Array(n * n * 6);
    let p = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vn * vn * 3), 3));
    const M = getMaterials();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, map: M.groundDetail });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.colorCache = {};
    this.setMode('normal');
  }

  computeColors(mode) {
    const t = this.terrain;
    const { vn, n } = t;
    const out = new Float32Array(vn * vn * 3);
    const cellCols = new Float32Array(n * n * 3);
    for (let k = 0; k < n * n; k++) {
      const c = cellColor(mode, t, k);
      cellCols[k * 3] = c.r; cellCols[k * 3 + 1] = c.g; cellCols[k * 3 + 2] = c.b;
    }
    for (let j = 0; j < vn; j++) for (let i = 0; i < vn; i++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const ci = i + di, cj = j + dj;
        if (ci < 0 || cj < 0 || ci >= n || cj >= n) continue;
        const k = (cj * n + ci) * 3;
        r += cellCols[k]; g += cellCols[k + 1]; b += cellCols[k + 2]; c++;
      }
      const k = (j * vn + i) * 3;
      let mul = 1;
      if (mode === 'height') {
        const h = t.heights[j * vn + i];
        const f = ((h % 5) + 5) % 5;
        if (f < 0.35) mul = 0.72;
      }
      out[k] = (r / c) * mul; out[k + 1] = (g / c) * mul; out[k + 2] = (b / c) * mul;
    }
    return out;
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.colorCache[mode]) this.colorCache[mode] = this.computeColors(mode);
    const attr = this.mesh.geometry.attributes.color;
    attr.array.set(this.colorCache[mode]);
    attr.needsUpdate = true;
  }

  // 外周の遠景（建築不可。マップの外も地形が続いて見える）
  _buildOuter() {
    const t = this.terrain;
    const R = MAP_SIZE * 2.2, step = 10;
    const cnt = Math.round((R * 2) / step) + 1;
    const pos = new Float32Array(cnt * cnt * 3);
    const col = new Float32Array(cnt * cnt * 3);
    const half = t.half;
    const c = new THREE.Color();
    for (let j = 0; j < cnt; j++) for (let i = 0; i < cnt; i++) {
      const x = -R + i * step, z = -R + j * step;
      const k = j * cnt + i;
      let h;
      const inside = Math.abs(x) < half - 0.01 && Math.abs(z) < half - 0.01;
      if (Math.abs(x) <= half + 0.01 && Math.abs(z) <= half + 0.01) h = t.heightAt(x, z) - (inside ? 4 : 0.05);
      else h = t.gen.height(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      // 簡易な色分け
      const a = t.gen.aux(x, z);
      if (h < 0.2) c.set(0x4f5a48);
      else if (h > 70) c.set(0xd8d8d4);
      else if (h > 38) c.set(0x7f7a6c);
      else if (a.forest > 0.05) c.set(0x405733);
      else c.set(0x6c8449).lerp(C(0x8c8a5c), smoothstep(14, 34, h) * 0.5);
      col[k * 3] = c.r * 0.92; col[k * 3 + 1] = c.g * 0.92; col[k * 3 + 2] = c.b * 0.92;
    }
    const idx = [];
    for (let j = 0; j < cnt - 1; j++) for (let i = 0; i < cnt - 1; i++) {
      const x0 = -R + i * step, z0 = -R + j * step;
      if (x0 >= -half && x0 + step <= half && z0 >= -half && z0 + step <= half) continue; // 内側は不要
      const a = j * cnt + i, b = a + 1, cc = a + cnt, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    this.outer = new THREE.Mesh(g, mat);
    this.outer.receiveShadow = true;
    this.group.add(this.outer);
  }

  _buildWater() {
    const g = new THREE.PlaneGeometry(MAP_SIZE * 4.4, MAP_SIZE * 4.4, 1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3f6670, roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.86 });
    this.water = new THREE.Mesh(g, mat);
    this.water.position.y = this.terrain.waterLevel;
    this.water.receiveShadow = true;
    this.group.add(this.water);
  }

  _buildBorder() {
    const t = this.terrain;
    const pts = [];
    const h = t.half;
    const push = (x, z) => pts.push(new THREE.Vector3(x, Math.max(t.heightAt(x, z), t.waterLevel) + 0.4, z));
    for (let x = -h; x < h; x += 4) push(x, -h);
    for (let z = -h; z < h; z += 4) push(h, z);
    for (let x = h; x > -h; x -= 4) push(x, h);
    for (let z = h; z > -h; z -= 4) push(-h, z);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    this.border = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xe9d9a6, transparent: true, opacity: 0.55 }));
    this.group.add(this.border);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== getMaterials().water) o.material.dispose?.();
    });
  }
}

export function raycastTerrain(terrain, origin, dir, maxDist = 2500) {
  // 高さ場へのレイマーチング＋二分探索
  let step = 1.5, prevT = 0;
  const f = (t) => origin.y + dir.y * t - Math.max(terrain.heightAt(origin.x + dir.x * t, origin.z + dir.z * t), terrain.waterLevel);
  if (f(0) < 0) return null;
  for (let t = step; t < maxDist; t += step) {
    const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
    if (!terrain.inBounds(x, z, -400)) { if (t > 50 && dir.y >= 0) break; }
    if (f(t) < 0) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (f(m) < 0) hi = m; else lo = m; }
      const x2 = origin.x + dir.x * hi, z2 = origin.z + dir.z * hi;
      return new THREE.Vector3(x2, origin.y + dir.y * hi, z2);
    }
    prevT = t;
    step = Math.min(6, 1.5 + t * 0.004);
  }
  return null;
}

export { lerp };
