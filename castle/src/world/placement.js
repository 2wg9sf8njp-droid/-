// 配置判定（地形・重複）とスナップ（接続点・城壁への組み込み）
import { DEFS } from '../buildings/defs.js';
import { derive, wallTopAt, GATE } from './derive.js';
import { polysOverlap, bboxOverlap, segIntersect, projectOnSeg, toWorld, pointInPoly } from '../core/geom.js';
import { SURFACE } from '../terrain/generator.js';

const ALLOW = new Set([
  'wall|towerSquare', 'wall|towerRound', 'wall|stairs',
  'stairs|towerSquare', 'stairs|towerRound',
  'road|gate', 'road|road', 'road|stairs',
]);
export function canOverlap(a, b) { return ALLOW.has(a + '|' + b) || ALLOW.has(b + '|' + a); }

const fail = (reason, derived) => ({ ok: false, reason, derived });

export function validate(world, item, exclude = []) {
  const terrain = world.terrain;
  const def = DEFS[item.type];
  const d = derive(terrain, item);

  if (def.kind === 'line') {
    const len = Math.hypot(item.bx - item.ax, item.bz - item.az);
    if (len < 2) return fail('線分が短すぎます（2m以上）', d);
    if (len > 150) return fail('1区間が長すぎます（150mまで）', d);
    const n = Math.ceil(len);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = item.ax + (item.bx - item.ax) * t, z = item.az + (item.bz - item.az) * t;
      if (!terrain.inBounds(x, z, 1)) return fail('マップの範囲外です', d);
      const s = terrain.surfaceAt(x, z);
      if (s === SURFACE.WATER) return fail(item.type === 'road' ? '道路は水域を渡れません（橋は未実装）' : '城壁は水域に建設できません（川は天然の堀として活用）', d);
      if (item.type === 'wall' && terrain.slopeAt(x, z) > 1.9) return fail('断崖の斜面には城壁を築けません（崖の上か下に沿わせてください）', d);
    }
  } else {
    if (d.ground.out) return fail('マップの範囲外です', d);
    if (d.ground.water) return fail('水域には建設できません', d);
    if (d.ground.cliff && item.type !== 'stairs') return fail('崖には建設できません', d);
    const diff = d.ground.max - d.ground.min;
    if (diff > def.maxDiff) return fail(`地面の高低差が大きすぎます（${diff.toFixed(1)}m / 許容${def.maxDiff}m）`, d);
  }

  // 重複判定
  for (const other of world.queryPoly(d.poly, d.bbox, exclude)) {
    const od = world.der(other.id);
    if (item.type === 'wall' && other.type === 'wall') {
      if (wallsConflict(item, other)) return fail('既存の城壁と交差・重複しています（接続点にスナップさせてください）', d);
      continue;
    }
    if (canOverlap(item.type, other.type)) continue;
    if (!bboxOverlap(d.bbox, od.bbox, 0)) continue;
    if (polysOverlap(d.overlapPoly, od.overlapPoly)) {
      if (item.type === 'road' && other.type === 'wall') return fail('道路は城壁を横切れません（城門を通してください）', d);
      return fail(`${DEFS[other.type].name}と重なっています`, d);
    }
  }
  return { ok: true, derived: d };
}

function wallsConflict(a, b) {
  const near = (x1, z1, x2, z2) => Math.hypot(x1 - x2, z1 - z2) < 0.35;
  const hit = segIntersect(a.ax, a.az, a.bx, a.bz, b.ax, b.az, b.bx, b.bz);
  if (hit) {
    const x = a.ax + (a.bx - a.ax) * hit.t, z = a.az + (a.bz - a.az) * hit.t;
    const atA = near(x, z, a.ax, a.az) || near(x, z, a.bx, a.bz);
    const atB = near(x, z, b.ax, b.az) || near(x, z, b.bx, b.bz);
    if (!(atA && atB)) return true;
  }
  // 平行に重なる場合
  for (const [p, s] of [[{ x: a.ax, z: a.az }, b], [{ x: a.bx, z: a.bz }, b], [{ x: b.ax, z: b.az }, a], [{ x: b.bx, z: b.bz }, a]]) {
    const pr = projectOnSeg(p.x, p.z, s.ax, s.az, s.bx, s.bz);
    if (pr.dist < 0.6 && pr.t > 0.01 && pr.t < 0.99 && pr.len * Math.min(pr.t, 1 - pr.t) > 0.4) return true;
  }
  // 端点が同じで方向も同じ（重なる）場合
  const ang = (x1, z1, x2, z2) => Math.atan2(z2 - z1, x2 - x1);
  const ends = [[a.ax, a.az, a.bx, a.bz], [a.bx, a.bz, a.ax, a.az]];
  const ends2 = [[b.ax, b.az, b.bx, b.bz], [b.bx, b.bz, b.ax, b.az]];
  for (const e of ends) for (const f of ends2) {
    if (near(e[0], e[1], f[0], f[1])) {
      let da = Math.abs(ang(...e) - ang(...f));
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.2) return true;
    }
  }
  return false;
}

// 線分建築（城壁・道路）の端点スナップ
export function snapLinePoint(world, x, z, type) {
  const filter = type === 'wall'
    ? (it) => it.type === 'wall' || it.type === 'gate' || it.type === 'towerSquare' || it.type === 'towerRound'
    : (it) => it.type === 'road';
  const node = world.nearestNode(x, z, 3.2, filter);
  if (node) return { x: node.x, z: node.z, snap: 'node' };
  if (type === 'road') {
    // 城門の出入口にスナップ
    let best = null, bd = 5;
    for (const it of world.all()) {
      if (it.type !== 'gate') continue;
      for (const sz of [-1, 1]) {
        const p = toWorld(it.x, it.z, it.rot, 0, sz * (GATE.D / 2 + 2));
        const dd = Math.hypot(p.x - x, p.z - z);
        if (dd < bd) { bd = dd; best = p; }
      }
    }
    if (best) return { x: best.x, z: best.z, snap: 'node' };
  }
  const seg = world.nearestSegment(x, z, 2.2, type);
  if (seg && seg.t > 0.02 && seg.t < 0.98 && seg.len * Math.min(seg.t, 1 - seg.t) > 1.5) {
    return { x: seg.x, z: seg.z, snap: 'segment', split: { id: seg.item.id, t: seg.t } };
  }
  return { x, z, snap: null };
}

// 線分を点で分割（T字接続用）
export function splitLine(world, id, t) {
  const it = world.get(id);
  if (!it) return;
  const mx = it.ax + (it.bx - it.ax) * t, mz = it.az + (it.bz - it.az) * t;
  const base = { ...it };
  delete base.id;
  world.remove(id);
  world.add({ ...base, bx: mx, bz: mz });
  world.add({ ...base, ax: mx, az: mz });
}

// 城門：城壁の近くなら壁に組み込む
export function proposeGate(world, x, z, rot) {
  const seg = world.nearestSegment(x, z, 6, 'wall');
  if (seg && seg.len >= GATE.W + 1) {
    const w = seg.item;
    const ux = (w.bx - w.ax) / seg.len, uz = (w.bz - w.az) / seg.len;
    const s = Math.max(GATE.W / 2, Math.min(seg.len - GATE.W / 2, seg.t * seg.len));
    const px = w.ax + ux * s, pz = w.az + uz * s;
    const wrot = Math.atan2(-uz, ux);
    return {
      item: { type: 'gate', x: px, z: pz, rot: wrot, open: false },
      exclude: [w.id],
      apply: () => {
        const base = { type: 'wall', height: w.height, thickness: w.thickness, outer: w.outer };
        world.remove(w.id);
        const s0 = s - GATE.W / 2, s1 = s + GATE.W / 2;
        if (s0 > 0.5) world.add({ ...base, ax: w.ax, az: w.az, bx: w.ax + ux * s0, bz: w.az + uz * s0 });
        if (seg.len - s1 > 0.5) world.add({ ...base, ax: w.ax + ux * s1, az: w.az + uz * s1, bx: w.bx, bz: w.bz });
      },
      snapped: true,
    };
  }
  return { item: { type: 'gate', x, z, rot, open: false }, exclude: [], snapped: false };
}

// 塔：城壁の接続点・城壁上にスナップ
export function proposeTower(world, type, x, z, rotOffset, height) {
  const node = world.nearestNode(x, z, 4, (it) => it.type === 'wall');
  if (node) {
    const w = node.item;
    const rot = Math.atan2(-(w.bz - w.az), w.bx - w.ax) + rotOffset;
    return { item: { type, x: node.x, z: node.z, rot, height }, snapped: true };
  }
  const seg = world.nearestSegment(x, z, 3.5, 'wall');
  if (seg) {
    const w = seg.item;
    const rot = Math.atan2(-(w.bz - w.az), w.bx - w.ax) + rotOffset;
    return { item: { type, x: seg.x, z: seg.z, rot, height }, snapped: true };
  }
  return { item: { type, x, z, rot: rotOffset, height }, snapped: false };
}

// 城壁階段：城壁の内側に沿わせ、歩廊の高さに合わせる
export function proposeStairs(world, x, z, dir) {
  const seg = world.nearestSegment(x, z, 10, 'wall');
  if (!seg) return { item: null, reason: '城壁の近く（10m以内）で配置してください' };
  const w = seg.item;
  const ws = world.der(w.id).ws;
  const L = ws.L;
  const side = (x - seg.x) * ws.nx + (z - seg.z) * ws.nz >= 0 ? 1 : -1;
  const off = w.thickness / 2 + 1.25;
  let Ls = 8, s = seg.t * L, rise = 4, y0 = 0;
  const terrain = world.terrain;
  for (let k = 0; k < 4; k++) {
    if (Ls > L) return { item: null, reason: `城壁が短すぎます（階段に${Ls.toFixed(0)}m必要）` };
    s = Math.max(Ls / 2, Math.min(L - Ls / 2, s));
    const sLow = s - (dir * Ls) / 2, sHigh = s + (dir * Ls) / 2;
    const lowX = w.ax + ws.ux * sLow + ws.nx * side * off, lowZ = w.az + ws.uz * sLow + ws.nz * side * off;
    y0 = terrain.heightAt(lowX, lowZ);
    const top = wallTopAt(ws, sHigh);
    rise = top - y0;
    Ls = Math.max(4, Math.min(34, rise * 1.45));
  }
  if (rise < 1) return { item: null, reason: '城壁が低すぎます' };
  const cx = w.ax + ws.ux * s + ws.nx * side * off, cz = w.az + ws.uz * s + ws.nz * side * off;
  return { item: { type: 'stairs', x: cx, z: cz, rot: ws.rot, length: Ls, rise, y0, dir, wallId: w.id }, side };
}

// 城壁の外側（胸壁の向き）を決める。閉じた囲郭なら多角形の外側
export function orientWalls(world, ids, loopPts) {
  for (const id of ids) {
    const w = world.get(id);
    if (!w) continue;
    const L = Math.hypot(w.bx - w.ax, w.bz - w.az) || 1;
    const nx = -(w.bz - w.az) / L, nz = (w.bx - w.ax) / L;
    const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
    let outer;
    if (loopPts && loopPts.length >= 3) {
      outer = pointInPoly(mx + nx * 1.5, mz + nz * 1.5, loopPts) ? -1 : 1;
    } else {
      // 主塔、なければ全接続点の重心から遠い側
      const keep = world.all().find((it) => it.type === 'keep');
      let cx, cz;
      if (keep) { cx = keep.x; cz = keep.z; } else {
        const ns = world.nodes(); cx = 0; cz = 0;
        for (const n of ns) { cx += n.x; cz += n.z; }
        cx /= ns.length || 1; cz /= ns.length || 1;
      }
      outer = (mx - cx) * nx + (mz - cz) * nz >= 0 ? 1 : -1;
    }
    if (w.outer !== outer) world.update(id, { outer });
  }
}
