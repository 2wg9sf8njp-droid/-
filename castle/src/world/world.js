// 建築物データ管理（見た目から独立）。追加・撤去・照会・スナップショット
import { DEFS, itemCost } from '../buildings/defs.js';
import { derive, nodesOf } from './derive.js';
import { bboxOverlap, projectOnSeg, pointInPoly, toLocal } from '../core/geom.js';

export class World {
  constructor(terrain) {
    this.terrain = terrain;
    this.items = new Map();
    this.derived = new Map();
    this.nextId = 1;
    this.listeners = [];
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  add(data, silent = false) {
    const item = { ...data, id: data.id ?? this.nextId++ };
    if (item.id >= this.nextId) this.nextId = item.id + 1;
    this.items.set(item.id, item);
    this.derived.set(item.id, derive(this.terrain, item));
    if (!silent) this.emit({ type: 'add', item });
    return item;
  }

  remove(id, silent = false) {
    const item = this.items.get(id);
    if (!item) return null;
    this.items.delete(id);
    const d = this.derived.get(id);
    this.derived.delete(id);
    if (!silent) this.emit({ type: 'remove', item, derived: d });
    return item;
  }

  update(id, patch) {
    const item = this.items.get(id);
    if (!item) return;
    const old = this.derived.get(id);
    Object.assign(item, patch);
    this.derived.set(id, derive(this.terrain, item));
    this.emit({ type: 'update', item, oldDerived: old });
  }

  get(id) { return this.items.get(id); }
  der(id) { return this.derived.get(id); }
  all() { return [...this.items.values()]; }

  serialize() {
    return this.all().map((it) => ({ ...it }));
  }

  load(list) {
    this.items.clear();
    this.derived.clear();
    this.nextId = 1;
    for (const it of list) this.add(it, true);
    this.emit({ type: 'reset' });
  }

  // 多角形と重なる建築物
  queryPoly(poly, bbox, excludeIds = []) {
    const out = [];
    for (const [id, d] of this.derived) {
      if (excludeIds.includes(id)) continue;
      if (bboxOverlap(bbox, d.bbox, 0.5)) out.push(this.items.get(id));
    }
    return out;
  }

  // 地点にある建築物（選択用）
  itemAt(x, z) {
    let best = null, bestArea = Infinity;
    for (const [id, d] of this.derived) {
      if (x < d.bbox.minX - 0.5 || x > d.bbox.maxX + 0.5 || z < d.bbox.minZ - 0.5 || z > d.bbox.maxZ + 0.5) continue;
      if (pointInPoly(x, z, d.poly)) {
        const area = (d.bbox.maxX - d.bbox.minX) * (d.bbox.maxZ - d.bbox.minZ);
        const item = this.items.get(id);
        const pr = item.type === 'road' ? 1e6 : area; // 道路は最後に選ばれる
        if (pr < bestArea) { bestArea = pr; best = item; }
      }
    }
    return best;
  }

  // 接続点の一覧
  nodes() {
    const out = [];
    for (const it of this.items.values()) {
      for (const n of nodesOf(it)) out.push({ ...n, item: it });
    }
    return out;
  }

  nearestNode(x, z, maxDist, filter) {
    let best = null, bd = maxDist;
    for (const n of this.nodes()) {
      if (filter && !filter(n.item)) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  nearestSegment(x, z, maxDist, type = 'wall') {
    let best = null, bd = maxDist;
    for (const it of this.items.values()) {
      if (it.type !== type) continue;
      const p = projectOnSeg(x, z, it.ax, it.az, it.bx, it.bz);
      if (p.dist < bd) { bd = p.dist; best = { item: it, ...p }; }
    }
    return best;
  }

  collidersNear(x, z, r) {
    const out = [];
    for (const d of this.derived.values()) {
      if (x < d.bbox.minX - r - 4 || x > d.bbox.maxX + r + 4 || z < d.bbox.minZ - r - 4 || z > d.bbox.maxZ + r + 4) continue;
      for (const c of d.colliders) out.push(c);
    }
    return out;
  }

  totals() {
    const sum = { wood: 0, stone: 0, gold: 0 };
    let wallLen = 0;
    for (const it of this.items.values()) {
      const c = itemCost(it);
      for (const k of Object.keys(sum)) sum[k] += c[k] || 0;
      if (it.type === 'wall') wallLen += Math.hypot(it.bx - it.ax, it.bz - it.az);
    }
    return { cost: sum, count: this.items.size, wallLen };
  }
}

// 当たり判定ボックスの局所座標
export function colliderLocal(c, x, z) {
  return toLocal(c.cx, c.cz, c.rot, x, z);
}

export function colliderTop(c, lx, lz) {
  return typeof c.top === 'function' ? c.top(lx, lz) : c.top;
}

export { DEFS };
