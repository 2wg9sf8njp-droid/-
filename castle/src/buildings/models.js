// 建築物の3Dモデル生成（基本形状の組み合わせ）。ゲーム上の機能とは独立
import * as THREE from 'three';
import { ModelBuilder, boxGeo, cylGeo, gableRoof, pyramidGeo } from '../render/shapes.js';
import { getMaterials } from '../render/materials.js';
import { DEFS } from './defs.js';
import { GATE } from '../world/derive.js';
import { mulberry32 } from '../core/rng.js';

const UVS = 4;

// 地形に沿ったリボン状の角柱（城壁本体・胸壁）
function ribbonGeo(samples, ux, uz, nx, nz, offA, offB, botFn, topFn, batter = 0) {
  const pos = [], uv = [];
  const P = (smp, off, y) => [smp.x + nx * off, y, smp.z + nz * off];
  const tri = (a, b, c, ta, tb, tc) => { pos.push(...a, ...b, ...c); uv.push(...ta, ...tb, ...tc); };
  const quad = (a, b, c, d, ta, tb, tc, td) => { tri(a, b, c, ta, tb, tc); tri(a, c, d, ta, tc, td); };
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i], s1 = samples[i + 1];
    const b0 = botFn(s0), b1 = botFn(s1), t0 = topFn(s0), t1 = topFn(s1);
    const u0 = s0.s / UVS, u1 = s1.s / UVS;
    // +n 側面
    quad(P(s0, offB + batter, b0), P(s1, offB + batter, b1), P(s1, offB, t1), P(s0, offB, t0),
      [u0, b0 / UVS], [u1, b1 / UVS], [u1, t1 / UVS], [u0, t0 / UVS]);
    // -n 側面
    quad(P(s1, offA - batter, b1), P(s0, offA - batter, b0), P(s0, offA, t0), P(s1, offA, t1),
      [u1, b1 / UVS], [u0, b0 / UVS], [u0, t0 / UVS], [u1, t1 / UVS]);
    // 上面
    quad(P(s0, offA, t0), P(s0, offB, t0), P(s1, offB, t1), P(s1, offA, t1),
      [u0, offA / UVS], [u0, offB / UVS], [u1, offB / UVS], [u1, offA / UVS]);
  }
  const f = samples[0], l = samples[samples.length - 1];
  const bf = botFn(f), tf = topFn(f), bl = botFn(l), tl = topFn(l);
  quad(P(f, offA - batter, bf), P(f, offB + batter, bf), P(f, offB, tf), P(f, offA, tf),
    [offA / UVS, bf / UVS], [offB / UVS, bf / UVS], [offB / UVS, tf / UVS], [offA / UVS, tf / UVS]);
  quad(P(l, offB + batter, bl), P(l, offA - batter, bl), P(l, offA, tl), P(l, offB, tl),
    [offB / UVS, bl / UVS], [offA / UVS, bl / UVS], [offA / UVS, tl / UVS], [offB / UVS, tl / UVS]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function buildWall(item, d) {
  const M = getMaterials();
  const ws = d.ws;
  const T = item.thickness;
  const side = item.outer || 1;
  const mb = new ModelBuilder();
  mb.add(ribbonGeo(ws.samples, ws.ux, ws.uz, ws.nx, ws.nz, -T / 2, T / 2, (s) => s.bottom, (s) => s.top, 0.35), M.stone);
  // 外側の胸壁（パラペット）
  const pA = side > 0 ? T / 2 - 0.5 : -T / 2, pB = side > 0 ? T / 2 : -T / 2 + 0.5;
  mb.add(ribbonGeo(ws.samples, ws.ux, ws.uz, ws.nx, ws.nz, pA, pB, (s) => s.top - 0.05, (s) => s.top + 1.0), M.stone);
  // 内側の低い縁石
  const iA = side > 0 ? -T / 2 : T / 2 - 0.3, iB = side > 0 ? -T / 2 + 0.3 : T / 2;
  mb.add(ribbonGeo(ws.samples, ws.ux, ws.uz, ws.nx, ws.nz, iA, iB, (s) => s.top - 0.05, (s) => s.top + 0.35), M.stoneDark);
  // 凸壁（メルロン）
  const L = ws.L;
  const n = Math.max(1, Math.floor(L / 1.9));
  const off = side * (T / 2 - 0.25);
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * L;
    const top = topAt(ws, s) + 1.0;
    mb.box(1.0, 0.95, 0.5, M.stone, {
      x: item.ax + ws.ux * s + ws.nx * off, y: top + 0.47, z: item.az + ws.uz * s + ws.nz * off, ry: ws.rot,
    });
  }
  return mb.build();
}

function topAt(ws, s) {
  const S = ws.samples;
  for (let i = 0; i < S.length - 1; i++) {
    if (s <= S[i + 1].s) {
      const t = (s - S[i].s) / (S[i + 1].s - S[i].s);
      return S[i].top + (S[i + 1].top - S[i].top) * t;
    }
  }
  return S[S.length - 1].top;
}

export function buildRoad(item, d, terrain) {
  const M = getMaterials();
  const W = DEFS.road.width / 2;
  const L = Math.hypot(item.bx - item.ax, item.bz - item.az);
  const ux = (item.bx - item.ax) / L, uz = (item.bz - item.az) / L;
  const nx = -uz, nz = ux;
  const segs = Math.max(1, Math.ceil(L));
  const pos = [], uv = [];
  const across = 4;
  const pt = (s, o) => {
    const x = item.ax + ux * s + nx * o, z = item.az + uz * s + nz * o;
    return [x, terrain.heightAt(x, z) + 0.06, z];
  };
  for (let i = 0; i < segs; i++) {
    const s0 = (i / segs) * L, s1 = ((i + 1) / segs) * L;
    for (let j = 0; j < across; j++) {
      const o0 = -W + (2 * W * j) / across, o1 = -W + (2 * W * (j + 1)) / across;
      const a = pt(s0, o0), b = pt(s0, o1), c = pt(s1, o1), dd = pt(s1, o0);
      pos.push(...a, ...b, ...c, ...a, ...c, ...dd);
      uv.push(s0 / 4, o0 / 4, s0 / 4, o1 / 4, s1 / 4, o1 / 4, s0 / 4, o0 / 4, s1 / 4, o1 / 4, s1 / 4, o0 / 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // 巻き順を上向きに揃える
  const nrm = g.attributes.normal;
  if (nrm.getY(0) < 0) {
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uvs = uv.slice();
    for (let i = 0; i < uvs.length; i += 6) {
      for (let k = 0; k < 2; k++) { const t = uvs[i + 2 + k]; uvs[i + 2 + k] = uvs[i + 4 + k]; uvs[i + 4 + k] = t; }
    }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(g, M.dirt);
  mesh.receiveShadow = true;
  const grp = new THREE.Group();
  grp.add(mesh);
  return grp;
}

// 基礎（地形の低い側を埋める）
function plinth(mb, w, d, depth, mat, round = 0) {
  if (round) mb.add(cylGeo(round + 0.3, round + 0.5, depth + 0.3, 18), mat, { y: -depth / 2 + 0.15 });
  else mb.boxY(w + 0.6, d + 0.6, -depth, 0.3, mat);
}

function windows(mb, w, d, ys, mat, every = 3.2) {
  for (const y of ys) {
    for (const [fw, nxz, ax] of [[w, d / 2, 'z'], [d, w / 2, 'x']]) {
      const n = Math.max(1, Math.floor(fw / every));
      for (let i = 0; i < n; i++) {
        const t = -fw / 2 + (fw * (i + 0.5)) / n;
        for (const sg of [-1, 1]) {
          if (ax === 'z') mb.box(0.55, 1.3, 0.12, mat, { x: t, y, z: sg * (nxz + 0.02) });
          else mb.box(0.12, 1.3, 0.55, mat, { x: sg * (nxz + 0.02), y, z: t });
        }
      }
    }
  }
}

function squareTowerParts(mb, M, w, H, depth) {
  plinth(mb, w, w, depth, M.stoneDark);
  mb.boxY(w + 0.4, w + 0.4, 0, 1.2, M.stoneDark);
  mb.boxY(w, w, 0, H, M.stone);
  mb.boxY(w + 0.9, w + 0.9, H - 0.9, H, M.stoneDark); // 持送り
  const e = (w + 0.9) / 2 - 0.25;
  for (const [x0, z0, x1, z1] of [[-e, -e, e, -e], [e, -e, e, e], [e, e, -e, e], [-e, e, -e, -e]]) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    mb.box(len + 0.5, 0.9, 0.5, M.stone, { x: (x0 + x1) / 2, y: H + 0.45, z: (z0 + z1) / 2, ry });
    mb.merlons(x0, z0, x1, z1, H + 0.9, M.stone);
  }
  // 矢狭間
  for (const y of [H * 0.45, H * 0.72]) {
    for (const [x, z, ry] of [[0, w / 2 + 0.02, 0], [0, -w / 2 - 0.02, 0], [w / 2 + 0.02, 0, Math.PI / 2], [-w / 2 - 0.02, 0, Math.PI / 2]]) {
      mb.box(0.22, 1.5, 0.1, M.dark, { x, y, z, ry });
    }
  }
}

export function buildPoint(item, d) {
  const M = getMaterials();
  const def = DEFS[item.type];
  const mb = new ModelBuilder();
  const depth = Math.max(0.5, d.base - d.ground.min + 1);
  const extra = [];

  switch (item.type) {
    case 'towerSquare': {
      squareTowerParts(mb, M, def.fp.w, item.height, depth);
      mb.box(1.4, 2.4, 0.1, M.dark, { y: 1.2 + 0.3, z: def.fp.w / 2 + 0.03 });
      break;
    }
    case 'towerRound': {
      const r = def.fp.r - 0.2, H = item.height;
      plinth(mb, 0, 0, depth, M.stoneDark, r);
      mb.add(cylGeo(r, r * 1.08, H, 22), M.stone, { y: H / 2 });
      mb.add(cylGeo(r + 0.45, r + 0.2, 0.9, 22), M.stoneDark, { y: H - 0.45 });
      mb.add(cylGeo(r + 0.45, r + 0.45, 1.0, 22, 4, true), M.stone, { y: H + 0.5 });
      const nM = 14;
      for (let i = 0; i < nM; i++) {
        const a = (i / nM) * Math.PI * 2;
        mb.box(1.0, 0.9, 0.45, M.stone, { x: Math.cos(a) * (r + 0.25), y: H + 1.45, z: Math.sin(a) * (r + 0.25), ry: -a + Math.PI / 2 });
      }
      mb.add(new THREE.ConeGeometry(r + 0.9, r * 1.9, 22), M.slate, { y: H + 1.0 + r * 0.95 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        for (const y of [H * 0.45, H * 0.75]) {
          mb.box(0.22, 1.5, 0.12, M.dark, { x: Math.cos(a) * (r * 1.03), y, z: Math.sin(a) * (r * 1.03), ry: -a + Math.PI / 2 });
        }
      }
      mb.box(1.4, 2.4, 0.3, M.dark, { y: 1.5, z: r * 1.06 });
      break;
    }
    case 'keep': {
      const w = def.fp.w - 1, H = item.height;
      plinth(mb, w + 1, w + 1, depth, M.stoneDark);
      mb.add(new THREE.CylinderGeometry(Math.SQRT1_2 * w, Math.SQRT1_2 * (w + 1.4), 3.5, 4).rotateY(Math.PI / 4), M.stoneDark, { y: 1.75 });
      mb.boxY(w, w, 0, H, M.stone);
      mb.boxY(w + 0.8, w + 0.8, H - 0.8, H, M.stoneDark);
      const e = (w + 0.8) / 2 - 0.25;
      for (const [x0, z0, x1, z1] of [[-e, -e, e, -e], [e, -e, e, e], [e, e, -e, e], [-e, e, -e, -e]]) {
        const ry = Math.atan2(-(z1 - z0), x1 - x0);
        mb.box(Math.hypot(x1 - x0, z1 - z0) + 0.5, 1.0, 0.5, M.stone, { x: (x0 + x1) / 2, y: H + 0.5, z: (z0 + z1) / 2, ry });
        mb.merlons(x0, z0, x1, z1, H + 1.0, M.stone);
      }
      // 四隅の小塔
      const c = w / 2 - 0.9;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        mb.boxY(3.2, 3.2, H - 1, H + 4.5, M.stone, { x: sx * c, z: sz * c });
        mb.merlons(sx * c - 1.5, sz * c + 1.5, sx * c + 1.5, sz * c + 1.5, H + 4.5, M.stone, { spacing: 1.5 });
        mb.merlons(sx * c - 1.5, sz * c - 1.5, sx * c + 1.5, sz * c - 1.5, H + 4.5, M.stone, { spacing: 1.5 });
      }
      mb.add(pyramidGeo(w - 3, 4, w - 3), M.slate, { y: H + 2 });
      windows(mb, w, w, [H * 0.45, H * 0.65, H * 0.82], M.dark, 4);
      // 入口（2階）と木の外階段
      mb.box(1.6, 2.6, 0.12, M.dark, { x: -2, y: 6.4, z: w / 2 + 0.03 });
      for (let i = 0; i < 10; i++) {
        mb.boxY(1.6, 0.5, 0, 0.5 + i * 0.5, M.wood, { x: -2 + 6.5 - i * 0.65, z: w / 2 + 1.0 });
      }
      mb.boxY(2.4, 1.6, 4.8, 5.1, M.wood, { x: -2, z: w / 2 + 0.8 });
      // 旗
      mb.add(cylGeo(0.08, 0.08, 6, 6), M.wood, { x: c, y: H + 7.5, z: c });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), M.flag);
      flag.position.set(c + 1.5, H + 9.4, c);
      flag.castShadow = true;
      flag.userData.flag = true;
      extra.push(flag);
      break;
    }
    case 'gate': {
      const { W, D, passW, passH, flankH, topH } = GATE;
      const fw = (W - passW) / 2;
      plinth(mb, W, D, depth, M.stoneDark);
      for (const sx of [-1, 1]) {
        const cx = sx * (passW / 2 + fw / 2);
        mb.boxY(fw, D, 0, flankH, M.stone, { x: cx });
        mb.boxY(fw + 0.6, D + 0.6, flankH - 0.8, flankH, M.stoneDark, { x: cx });
        const ex = (fw + 0.6) / 2 - 0.25, ez = (D + 0.6) / 2 - 0.25;
        mb.merlons(cx - ex, -ez, cx + ex, -ez, flankH, M.stone);
        mb.merlons(cx - ex, ez, cx + ex, ez, flankH, M.stone);
        mb.merlons(cx + sx * ex, -ez, cx + sx * ex, ez, flankH, M.stone);
        for (const sz of [-1, 1]) mb.box(0.22, 1.5, 0.1, M.dark, { x: cx, y: flankH * 0.6, z: sz * (D / 2 + 0.03) });
      }
      // 門上の部屋と胸壁
      mb.boxY(passW, D, passH, topH, M.stone);
      for (const sz of [-1, 1]) {
        mb.boxY(passW, 0.5, topH, topH + 1.0, M.stone, { z: sz * (D / 2 - 0.25) });
        mb.merlons(-passW / 2, sz * (D / 2 - 0.25), passW / 2, sz * (D / 2 - 0.25), topH + 1.0, M.stone);
        // 門口の枠石
        mb.boxY(passW + 0.8, 0.3, passH - 0.1, passH + 0.7, M.stoneDark, { z: sz * (D / 2 + 0.05) });
        mb.boxY(0.4, 0.3, 0, passH, M.stoneDark, { x: -passW / 2 - 0.15, z: sz * (D / 2 + 0.05) });
        mb.boxY(0.4, 0.3, 0, passH, M.stoneDark, { x: passW / 2 + 0.15, z: sz * (D / 2 + 0.05) });
        // 殺人孔の暗がり
        mb.box(passW - 0.4, 0.05, 1.0, M.dark, { y: passH - 0.02, z: sz * 2.5 });
      }
      // 通路の床と傾斜路
      mb.boxY(passW, D, -0.2, 0.15, M.stoneDark);
      for (const r of d.ramps) {
        const drop = r.y0 - r.gOut;
        const len = Math.hypot(3.5, drop);
        const ang = Math.atan2(drop, 3.5);
        mb.add(boxGeo(passW + 1.2, 0.5, len), M.stoneDark, {
          y: (r.y0 + r.gOut) / 2 - d.base - 0.25, z: r.sz * (D / 2 + 1.75), rx: r.sz * ang,
        });
      }
      // 落とし格子（上げた状態）
      for (let i = 0; i < 7; i++) mb.boxY(0.1, 0.1, passH - 1.2, passH, M.iron, { x: -passW / 2 + 0.3 + i * (passW - 0.6) / 6, z: -D / 2 + 1.2 });
      // 扉（開閉するので結合しない）
      for (const sx of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * passW / 2, 0.15, 0);
        const door = new THREE.Mesh(boxGeo(passW / 2 - 0.05, passH - 0.3, 0.25), M.wood);
        door.position.set(-sx * (passW / 4), (passH - 0.3) / 2, 0);
        door.castShadow = true;
        pivot.add(door);
        const band = new THREE.Mesh(boxGeo(passW / 2 - 0.1, 0.15, 0.3), M.iron);
        for (const y of [1.0, passH - 1.5]) {
          const b = band.clone();
          b.position.set(-sx * (passW / 4), y, 0);
          pivot.add(b);
        }
        pivot.userData.door = sx;
        pivot.rotation.y = item.open ? sx * 1.5 : 0;
        extra.push(pivot);
      }
      break;
    }
    case 'stairs': {
      const L = item.length, dir = item.dir || 1;
      const n = Math.max(4, Math.ceil(item.rise / 0.28));
      const low = d.ground.min - 0.6 - d.base;
      for (let i = 0; i < n; i++) {
        const lx = -L / 2 + (L * (i + 0.5)) / n;
        const top = ((i + 1) / n) * item.rise;
        mb.boxY(L / n + 0.02, 2.4, low, top, M.stone, { x: dir * lx });
      }
      break;
    }
    case 'barracks': {
      const { w, d: dd } = def.fp;
      plinth(mb, w, dd, depth, M.stoneDark);
      mb.boxY(w, dd, 0, 4.6, M.stone);
      const roof = gableRoof(w, dd, 3.6, 0.6);
      mb.add(roof.slopes, M.roofTile, { y: 4.6 });
      mb.add(roof.gables, M.stone, { y: 4.6 });
      windows(mb, w, dd, [2.6], M.dark, 3);
      mb.box(1.4, 2.3, 0.12, M.dark, { y: 1.15, z: dd / 2 + 0.03 });
      mb.boxY(1.1, 1.1, 5.5, 9.4, M.stoneDark, { x: w / 2 - 2.5, z: -1.2 });
      break;
    }
    case 'storehouse': {
      const { w, d: dd } = def.fp;
      plinth(mb, w, dd, depth, M.stoneDark);
      mb.boxY(w, dd, 0, 0.6, M.stoneDark);
      mb.boxY(w - 0.2, dd - 0.2, 0.6, 5, M.wood);
      const roof = gableRoof(w, dd, 3.2, 0.7);
      mb.add(roof.slopes, M.thatch, { y: 5 });
      mb.add(roof.gables, M.wood, { y: 5 });
      mb.box(2.8, 3.4, 0.12, M.dark, { y: 2.3, z: dd / 2 - 0.05 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.boxY(0.35, 0.35, 0, 5, M.wood, { x: sx * (w / 2 - 0.1), z: sz * (dd / 2 - 0.1) });
      break;
    }
    case 'stable': {
      const { w, d: dd } = def.fp;
      plinth(mb, w, dd, depth, M.stoneDark);
      mb.boxY(w, dd, 0, 3.4, M.wood);
      const roof = gableRoof(w, dd, 2.6, 0.9);
      mb.add(roof.slopes, M.thatch, { y: 3.4 });
      mb.add(roof.gables, M.wood, { y: 3.4 });
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n;
        mb.box(1.6, 1.4, 0.12, M.dark, { x, y: 1.8, z: dd / 2 + 0.03 });
        mb.box(1.6, 1.1, 0.14, M.wood, { x, y: 0.6, z: dd / 2 + 0.05 });
      }
      break;
    }
    case 'house': {
      const { w, d: dd } = def.fp;
      const rnd = mulberry32(item.id * 9973 + 7);
      const h = 4.6 + rnd() * 1.6;
      plinth(mb, w, dd, depth, M.stoneDark);
      mb.boxY(w, dd, 0, 1.0, M.stoneDark);
      mb.boxY(w, dd, 1.0, h, M.timber);
      const roof = gableRoof(dd, w, 3.8 + rnd() * 1.2, 0.5);
      const rm = rnd() < 0.5 ? M.thatch : M.roofTile;
      mb.add(roof.slopes, rm, { y: h, ry: Math.PI / 2 });
      mb.add(roof.gables, M.timber, { y: h, ry: Math.PI / 2 });
      mb.boxY(0.9, 0.9, h - 1, h + 4.6, M.stoneDark, { x: w / 2 - 1.2, z: dd / 2 - 1.6 });
      mb.box(1.1, 2.0, 0.1, M.wood, { y: 1.0, z: dd / 2 + 0.03 });
      break;
    }
    case 'well': {
      plinth(mb, 0, 0, depth, M.stoneDark, 1.3);
      mb.add(cylGeo(1.3, 1.4, 1.0, 14), M.stone, { y: 0.5 });
      mb.add(new THREE.CircleGeometry(1.0, 14), M.water, { y: 0.8, rx: -Math.PI / 2 });
      for (const sx of [-1, 1]) mb.boxY(0.18, 0.18, 0.9, 3.0, M.wood, { x: sx * 1.2 });
      mb.box(2.6, 0.15, 0.15, M.wood, { y: 2.6 });
      const roof = gableRoof(2.8, 1.6, 0.9, 0.2);
      mb.add(roof.slopes, M.thatch, { y: 3.0 });
      mb.add(roof.gables, M.wood, { y: 3.0 });
      break;
    }
  }
  const grp = mb.build();
  for (const e of extra) grp.add(e);
  return grp;
}

export function buildModel(item, d, terrain) {
  let obj;
  if (item.type === 'wall') obj = buildWall(item, d);
  else if (item.type === 'road') obj = buildRoad(item, d, terrain);
  else {
    obj = buildPoint(item, d);
    obj.position.set(item.x, d.base, item.z);
    obj.rotation.y = item.type === 'towerRound' || item.type === 'well' ? 0 : item.rot || 0;
  }
  return obj;
}
