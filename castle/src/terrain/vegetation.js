// 樹木・岩の配置（インスタンス描画）。建築物の下の木は自動で伐採表示にする
import * as THREE from 'three';
import { SURFACE } from './generator.js';
import { hashSeed, mulberry32 } from '../core/rng.js';
import { pointInPoly } from '../core/geom.js';

const BUCKET = 16;

export class Vegetation {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.trees = [];
    this.buckets = new Map();
    this._generate();
  }

  _generate() {
    const t = this.terrain;
    const rand = mulberry32(hashSeed(t.seed + '#veg'));
    const list = [];
    const rocks = [];
    for (let j = 0; j < t.n; j++) for (let i = 0; i < t.n; i++) {
      const k = j * t.n + i;
      const ty = t.cType[k];
      let count = 0;
      if (ty === SURFACE.FOREST) count = rand() < 0.55 + Math.min(0.4, t.cForestN[k]) ? 1 : 0;
      else if (ty === SURFACE.GRASS) count = rand() < 0.012 ? 1 : 0;
      else if (ty === SURFACE.FERTILE) count = rand() < 0.004 ? 1 : 0;
      else if (ty === SURFACE.ROCK) count = rand() < 0.05 ? 1 : 0;
      for (let c = 0; c < count; c++) {
        const x = -t.half + (i + rand()) * t.cell, z = -t.half + (j + rand()) * t.cell;
        const y = t.heightAt(x, z);
        const conifer = y > 14 || rand() < 0.35;
        list.push({ x, z, y, conifer, s: 0.75 + rand() * 0.6, r: rand() * Math.PI * 2, tint: rand() });
      }
      if ((ty === SURFACE.ROCK || ty === SURFACE.CLIFF) && rand() < 0.12) {
        const x = -t.half + (i + rand()) * t.cell, z = -t.half + (j + rand()) * t.cell;
        rocks.push({ x, z, y: t.heightAt(x, z), s: 0.4 + rand() * 1.1, r: rand() * 6 });
      }
    }
    const nCon = list.filter((a) => a.conifer).length;
    const nDec = list.length - nCon;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 1 });
    const conMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const decMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 1, 5); trunkGeo.translate(0, 0.5, 0);
    const conGeo = new THREE.ConeGeometry(1, 1, 7); conGeo.translate(0, 0.5, 0);
    const decGeo = new THREE.IcosahedronGeometry(1, 0); decGeo.translate(0, 0, 0);
    this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    this.cons = new THREE.InstancedMesh(conGeo, conMat, Math.max(1, nCon));
    this.decs = new THREE.InstancedMesh(decGeo, decMat, Math.max(1, nDec));
    this.cons.count = nCon; this.decs.count = nDec;
    for (const m of [this.trunks, this.cons, this.decs]) { m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    let ci = 0, di = 0;
    list.forEach((tr, idx) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.r);
      if (tr.conifer) {
        const h = 9 * tr.s;
        tr.trunkM = m4.compose(p.set(tr.x, tr.y - 0.3, tr.z), q, sc.set(1.1 * tr.s, h * 0.35, 1.1 * tr.s)).clone();
        tr.canM = m4.compose(p.set(tr.x, tr.y + h * 0.18, tr.z), q, sc.set(2.0 * tr.s, h * 0.85, 2.0 * tr.s)).clone();
        tr.mesh = this.cons; tr.ci = ci++;
        col.setHSL(0.31 + tr.tint * 0.04, 0.38, 0.13 + tr.tint * 0.05);
      } else {
        const h = 7 * tr.s;
        tr.trunkM = m4.compose(p.set(tr.x, tr.y - 0.3, tr.z), q, sc.set(1.2 * tr.s, h * 0.55, 1.2 * tr.s)).clone();
        tr.canM = m4.compose(p.set(tr.x, tr.y + h * 0.62, tr.z), q, sc.set(2.6 * tr.s, 2.3 * tr.s, 2.6 * tr.s)).clone();
        tr.mesh = this.decs; tr.ci = di++;
        col.setHSL(0.21 + tr.tint * 0.07, 0.42, 0.17 + tr.tint * 0.07);
      }
      tr.ti = idx;
      this.trunks.setMatrixAt(idx, tr.trunkM);
      tr.mesh.setMatrixAt(tr.ci, tr.canM);
      tr.mesh.setColorAt(tr.ci, col);
      tr.hidden = false;
      const bk = this._bkey(tr.x, tr.z);
      if (!this.buckets.has(bk)) this.buckets.set(bk, []);
      this.buckets.get(bk).push(tr);
    });
    this.trees = list;
    for (const m of [this.trunks, this.cons, this.decs]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a867a, roughness: 1, flatShading: true });
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(1, rocks.length));
    this.rocks.count = rocks.length;
    rocks.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(r.r, r.r * 2, r.r * 3));
      this.rocks.setMatrixAt(i, m4.compose(p.set(r.x, r.y, r.z), q, sc.set(r.s * 1.3, r.s * 0.8, r.s)));
    });
    this.rocks.castShadow = true; this.rocks.receiveShadow = true;
    this.group.add(this.rocks);
  }

  _bkey(x, z) { return Math.floor(x / BUCKET) + ',' + Math.floor(z / BUCKET); }

  treesInBBox(bb) {
    const out = [];
    for (let bx = Math.floor((bb.minX - 2) / BUCKET); bx <= Math.floor((bb.maxX + 2) / BUCKET); bx++) {
      for (let bz = Math.floor((bb.minZ - 2) / BUCKET); bz <= Math.floor((bb.maxZ + 2) / BUCKET); bz++) {
        const b = this.buckets.get(bx + ',' + bz);
        if (b) out.push(...b);
      }
    }
    return out;
  }

  // 領域内の木の表示を、現在の建築物の配置に合わせて再計算
  refresh(bbox, world) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let changed = false;
    const trees = bbox ? this.treesInBBox(bbox) : this.trees;
    const items = [];
    for (const [id, d] of world.derived) items.push(d);
    for (const tr of trees) {
      let covered = false;
      for (const d of items) {
        const b = d.bbox;
        if (tr.x < b.minX - 1.5 || tr.x > b.maxX + 1.5 || tr.z < b.minZ - 1.5 || tr.z > b.maxZ + 1.5) continue;
        if (pointInPoly(tr.x, tr.z, d.poly) || nearPoly(tr.x, tr.z, d.poly, 1.2)) { covered = true; break; }
      }
      if (covered !== tr.hidden) {
        tr.hidden = covered;
        this.trunks.setMatrixAt(tr.ti, covered ? zero : tr.trunkM);
        tr.mesh.setMatrixAt(tr.ci, covered ? zero : tr.canM);
        changed = true;
      }
    }
    if (changed) for (const m of [this.trunks, this.cons, this.decs]) m.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}

function nearPoly(x, z, poly, r) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < r) return true;
  }
  return false;
}
