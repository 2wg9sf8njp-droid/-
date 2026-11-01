// 建築物データ → 3Dオブジェクトの同期。選択枠・配置プレビュー・扉アニメーション
import * as THREE from 'three';
import { buildModel } from '../buildings/models.js';
import { getMaterials } from './materials.js';
import { DEFS } from '../buildings/defs.js';

export class BuildingRenderer {
  constructor(scene, world, vegetation) {
    this.scene = scene;
    this.world = world;
    this.veg = vegetation;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.objs = new Map();
    this.selLine = null;
    this.hoverLine = null;
    this.rangeRing = null;
    world.on((ev) => this.onEvent(ev));
    this.rebuildAll();
  }

  onEvent(ev) {
    if (ev.type === 'reset') return this.rebuildAll();
    if (ev.type === 'add') { this._add(ev.item); this.veg.refresh(this.world.der(ev.item.id).bbox, this.world); }
    if (ev.type === 'remove') { this._remove(ev.item.id); this.veg.refresh(ev.derived.bbox, this.world); }
    if (ev.type === 'update') {
      this._remove(ev.item.id); this._add(ev.item);
      this.veg.refresh(ev.oldDerived.bbox, this.world);
      this.veg.refresh(this.world.der(ev.item.id).bbox, this.world);
    }
  }

  _add(item) {
    const d = this.world.der(item.id);
    const obj = buildModel(item, d, this.world.terrain);
    obj.traverse((o) => { o.userData.itemId = item.id; });
    obj.userData.itemId = item.id;
    this.root.add(obj);
    this.objs.set(item.id, obj);
  }

  _remove(id) {
    const obj = this.objs.get(id);
    if (!obj) return;
    this.root.remove(obj);
    disposeObj(obj);
    this.objs.delete(id);
  }

  rebuildAll() {
    for (const id of [...this.objs.keys()]) this._remove(id);
    for (const it of this.world.all()) this._add(it);
    this.veg.refresh(null, this.world);
  }

  pickables() { return this.root.children; }

  // 地形に沿った輪郭線
  outline(poly, color, lift = 0.35) {
    const t = this.world.terrain;
    const pts = [];
    for (let i = 0; i <= poly.length; i++) {
      const a = poly[i % poly.length], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / 2));
      for (let k = 0; k < n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
        pts.push(new THREE.Vector3(x, t.heightAt(x, z) + lift, z));
      }
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    line.renderOrder = 10;
    return line;
  }

  setSelected(id) {
    if (this.selLine) { this.scene.remove(this.selLine); this.selLine.geometry.dispose(); this.selLine = null; }
    if (this.rangeRing) { this.scene.remove(this.rangeRing); this.rangeRing.geometry.dispose(); this.rangeRing = null; }
    if (id == null) return;
    const d = this.world.der(id);
    const item = this.world.get(id);
    if (!d) return;
    this.selLine = this.outline(d.poly, 0xffd76a, 0.5);
    this.scene.add(this.selLine);
    const def = DEFS[item.type];
    if (def.range) {
      const ring = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        ring.push({ x: item.x + Math.cos(a) * def.range, z: item.z + Math.sin(a) * def.range });
      }
      this.rangeRing = this.outline(ring, 0xff9a5a, 0.8);
      this.rangeRing.material.opacity = 0.6;
      this.scene.add(this.rangeRing);
    }
  }

  setHover(id) {
    if (this.hoverLine) { this.scene.remove(this.hoverLine); this.hoverLine.geometry.dispose(); this.hoverLine = null; }
    if (id == null) return;
    const d = this.world.der(id);
    if (!d) return;
    this.hoverLine = this.outline(d.poly, 0xfff3c8, 0.45);
    this.hoverLine.material.opacity = 0.55;
    this.scene.add(this.hoverLine);
  }

  update(dt, time) {
    for (const [id, obj] of this.objs) {
      const item = this.world.get(id);
      if (!item) continue;
      if (item.type === 'gate') {
        for (const c of obj.children) {
          if (c.userData.door) {
            const target = item.open ? c.userData.door * 1.5 : 0;
            c.rotation.y += (target - c.rotation.y) * Math.min(1, dt * 2.5);
          }
        }
      } else if (item.type === 'keep') {
        for (const c of obj.children) if (c.userData.flag) c.rotation.y = Math.sin(time * 1.3) * 0.25;
      }
    }
  }
}

export function disposeObj(obj) {
  const M = getMaterials();
  const shared = new Set(Object.values(M));
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !shared.has(o.material)) o.material.dispose();
  });
}

// 配置プレビュー用：モデルを半透明の単色に置き換える
export function ghostify(obj, ok) {
  const M = getMaterials();
  obj.traverse((o) => {
    if (o.isMesh) {
      o.material = ok ? M.ghostOk : M.ghostBad;
      o.castShadow = false;
      o.receiveShadow = false;
      o.renderOrder = 5;
    }
  });
  return obj;
}
