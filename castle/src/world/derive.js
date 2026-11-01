// 建築物データ → 派生情報（占有ポリゴン、基礎高さ、城壁の断面サンプル、当たり判定）
import { DEFS } from '../buildings/defs.js';
import { rectPoly, circlePoly, segmentPoly, polyBBox, pointInPoly, segRot, toWorld } from '../core/geom.js';
import { SURFACE } from '../terrain/generator.js';

export const GATE = { W: 12, D: 9, passW: 4.4, passH: 5.2, flankH: 13, topH: 10 };

export function footprintOf(item) {
  const def = DEFS[item.type];
  if (def.kind === 'line') {
    const w = item.type === 'wall' ? item.thickness : def.width;
    return segmentPoly(item.ax, item.az, item.bx, item.bz, w, 0);
  }
  if (item.type === 'stairs') return rectPoly(item.x, item.z, item.length, 2.4, item.rot);
  const fp = def.fp;
  if (fp.shape === 'circle') return circlePoly(item.x, item.z, fp.r);
  return rectPoly(item.x, item.z, fp.w, fp.d, item.rot || 0);
}

// 多角形内の地面をサンプリング
export function sampleGround(terrain, poly, step = 1) {
  const bb = polyBBox(poly);
  let min = Infinity, max = -Infinity, sum = 0, cnt = 0;
  let water = false, cliff = false, out = false;
  const visit = (x, z) => {
    if (!terrain.inBounds(x, z, 1)) { out = true; return; }
    const h = terrain.heightAt(x, z);
    if (h < min) min = h; if (h > max) max = h;
    sum += h; cnt++;
    const t = terrain.surfaceAt(x, z);
    if (t === SURFACE.WATER) water = true;
    if (t === SURFACE.CLIFF) cliff = true;
  };
  for (const p of poly) visit(p.x, p.z);
  for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
    for (let z = bb.minZ + step / 2; z < bb.maxZ; z += step) {
      if (pointInPoly(x, z, poly)) visit(x, z);
    }
  }
  return { min, max, avg: cnt ? sum / cnt : 0, water, cliff, out };
}

// 城壁の断面サンプル（地形に沿う）
export function wallSamples(terrain, item) {
  const { ax, az, bx, bz, height: H, thickness: T } = item;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const nx = -uz, nz = ux;
  const s0 = -T / 2, s1 = L + T / 2;
  const segs = Math.max(2, Math.ceil((s1 - s0) / 2));
  const g = (s, off = 0) => terrain.heightAt(ax + ux * s + nx * off, az + uz * s + nz * off);
  const samples = [];
  for (let i = 0; i <= segs; i++) {
    const s = s0 + ((s1 - s0) * i) / segs;
    const sc = Math.max(0, Math.min(L, s));
    const gc = g(sc);
    const e = T / 2 + 0.6;
    const gl = g(sc, e), gr = g(sc, -e);
    const smooth = (g(sc - 3) + gc + g(sc + 3)) / 3;
    const top = Math.max(smooth + H, gc + H * 0.8);
    const bottom = Math.min(gc, gl, gr) - 1.5;
    samples.push({ s, x: ax + ux * s, z: az + uz * s, top, bottom, ground: gc });
  }
  return { L, ux, uz, nx, nz, samples, rot: segRot(ax, az, bx, bz) };
}

export function wallTopAt(ws, s) {
  const S = ws.samples;
  if (s <= S[0].s) return S[0].top;
  for (let i = 0; i < S.length - 1; i++) {
    if (s <= S[i + 1].s) {
      const t = (s - S[i].s) / (S[i + 1].s - S[i].s);
      return S[i].top + (S[i + 1].top - S[i].top) * t;
    }
  }
  return S[S.length - 1].top;
}

function boxCollider(cx, cz, rot, hx, hz, bottom, top) {
  return { cx, cz, rot, hx, hz, bottom, top };
}

// 派生情報の計算
export function derive(terrain, item) {
  const def = DEFS[item.type];
  const poly = footprintOf(item);
  const d = { poly, bbox: polyBBox(poly), colliders: [] };

  if (item.type === 'wall') {
    const ws = wallSamples(terrain, item);
    d.ws = ws;
    // 重複判定用は両端を縮めた多角形（接続部で塔や門と接するため）
    d.overlapPoly = segmentPoly(item.ax, item.az, item.bx, item.bz, item.thickness, item.thickness / 2 + 0.5);
    const cx = (item.ax + item.bx) / 2, cz = (item.az + item.bz) / 2;
    const L = ws.L, T = item.thickness;
    let minB = Infinity;
    for (const s of ws.samples) minB = Math.min(minB, s.bottom);
    const topFn = (lx) => wallTopAt(ws, lx + L / 2);
    d.colliders.push(boxCollider(cx, cz, ws.rot, L / 2 + T / 2, T / 2, minB, topFn));
    const side = item.outer || 1;
    const p = toWorld(cx, cz, ws.rot, 0, side * (T / 2 - 0.25));
    d.colliders.push(boxCollider(p.x, p.z, ws.rot, L / 2 + T / 2, 0.25, minB, (lx) => topFn(lx) + 1.0));
    return d;
  }
  if (item.type === 'road') {
    d.overlapPoly = segmentPoly(item.ax, item.az, item.bx, item.bz, def.width, 0.3);
    return d;
  }

  const gs = sampleGround(terrain, poly);
  d.ground = gs;
  d.base = gs.max;
  d.overlapPoly = poly;
  const { x, z } = item;
  const rot = item.rot || 0;
  const low = gs.min - 1;

  switch (item.type) {
    case 'gate': {
      const b = d.base;
      const { W, D, passW, passH, flankH, topH } = GATE;
      const fw = (W - passW) / 2;
      for (const sx of [-1, 1]) {
        const p = toWorld(x, z, rot, sx * (passW / 2 + fw / 2), 0);
        d.colliders.push(boxCollider(p.x, p.z, rot, fw / 2, D / 2, low, b + flankH + 1));
      }
      d.colliders.push(boxCollider(x, z, rot, passW / 2, D / 2, b + passH, b + topH));
      d.colliders.push(boxCollider(x, z, rot, passW / 2, D / 2, low, b + 0.15));
      // 門前後の傾斜路
      d.ramps = [];
      for (const sz of [-1, 1]) {
        const p = toWorld(x, z, rot, 0, sz * (D / 2 + 1.75));
        const outer = toWorld(x, z, rot, 0, sz * (D / 2 + 3.5));
        const gOut = Math.min(b + 0.15, terrain.heightAt(outer.x, outer.z));
        const y0 = b + 0.15;
        d.ramps.push({ sz, gOut, y0 });
        d.colliders.push(boxCollider(p.x, p.z, rot, passW / 2 + 0.6, 1.75, low,
          (lx, lz) => y0 + (gOut - y0) * Math.max(0, Math.min(1, (lz * sz + 1.75) / 3.5))));
      }
      if (!item.open) d.colliders.push(boxCollider(x, z, rot, passW / 2, 0.2, low, b + passH));
      break;
    }
    case 'towerSquare': {
      const fp = def.fp;
      d.colliders.push(boxCollider(x, z, rot, fp.w / 2, fp.d / 2, low, d.base + item.height + 1));
      break;
    }
    case 'towerRound': {
      const r = def.fp.r * 0.92;
      d.colliders.push(boxCollider(x, z, 0, r, r, low, d.base + item.height + 1));
      d.colliders.push(boxCollider(x, z, Math.PI / 4, r, r, low, d.base + item.height + 1));
      break;
    }
    case 'keep': {
      const fp = def.fp;
      d.colliders.push(boxCollider(x, z, rot, fp.w / 2, fp.d / 2, low, d.base + item.height + 3));
      break;
    }
    case 'stairs': {
      const L = item.length, dir = item.dir || 1;
      const y0 = item.y0, rise = item.rise;
      d.base = y0;
      d.colliders.push(boxCollider(x, z, rot, L / 2, 1.2, low,
        (lx) => y0 + 0.25 + (rise - 0.25) * Math.max(0, Math.min(1, (dir * lx + L / 2) / L))));
      break;
    }
    case 'well': {
      d.colliders.push(boxCollider(x, z, 0, 1.3, 1.3, low, d.base + 1.0));
      break;
    }
    default: {
      const fp = def.fp;
      d.colliders.push(boxCollider(x, z, rot, fp.w / 2, fp.d / 2, low, d.base + 9));
    }
  }
  return d;
}

// 接続点（城壁端点・門の両端・塔の中心）
export function nodesOf(item) {
  if (item.type === 'wall') return [{ x: item.ax, z: item.az }, { x: item.bx, z: item.bz }];
  if (item.type === 'gate') {
    return [toWorld(item.x, item.z, item.rot, -GATE.W / 2, 0), toWorld(item.x, item.z, item.rot, GATE.W / 2, 0)];
  }
  if (item.type === 'towerSquare' || item.type === 'towerRound') return [{ x: item.x, z: item.z }];
  return [];
}
