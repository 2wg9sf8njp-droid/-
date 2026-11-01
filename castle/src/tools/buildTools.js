// 建築操作：ツール状態、配置プレビュー、城壁の連続配置、撤去、選択、取り消し
import * as THREE from 'three';
import { DEFS } from '../buildings/defs.js';
import { buildModel } from '../buildings/models.js';
import { ghostify, disposeObj } from '../render/buildingRenderer.js';
import { validate, snapLinePoint, splitLine, proposeGate, proposeTower, proposeStairs, orientWalls } from '../world/placement.js';

const ROT_STEP = Math.PI / 12;

export class History {
  constructor(game) { this.g = game; this.undoStack = []; this.redoStack = []; }
  snapshot() { return JSON.stringify(this.g.world.serialize()); }
  push() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.g.markDirty();
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.g.world.load(JSON.parse(this.undoStack.pop()));
    this.g.markDirty();
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.g.world.load(JSON.parse(this.redoStack.pop()));
    this.g.markDirty();
    return true;
  }
  clear() { this.undoStack = []; this.redoStack = []; }
}

export class BuildTools {
  constructor(game) {
    this.g = game;
    this.tool = 'select';
    this.rot = 0;
    this.stairsDir = 1;
    this.params = {};
    for (const [k, def] of Object.entries(DEFS)) {
      if (def.params) {
        this.params[k] = {};
        for (const [pk, p] of Object.entries(def.params)) this.params[k][pk] = p.def;
      }
    }
    this.chain = null;
    this.ghost = null;
    this.ghostKey = '';
    this.cursor = null;
    this.angleSnap = false;
    this.selectedId = null;
    this.hoverId = null;
    this.lastResult = null;
    this.needsPreview = false;
    const ringGeo = new THREE.RingGeometry(0.9, 1.4, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.snapRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd76a, depthTest: false, transparent: true, opacity: 0.9 }));
    this.snapRing.renderOrder = 12;
    this.snapRing.visible = false;
    game.scene.add(this.snapRing);
  }

  get world() { return this.g.world; }

  setTool(key) {
    this.cancelChain();
    this.tool = key;
    this.rot = 0;
    this.clearGhost();
    if (key !== 'select') this.select(null);
    this.needsPreview = true;
    this.g.ui.onToolChanged(key);
    this.updateHint();
  }

  cancelChain() {
    if (this.chain) { this.chain = null; this.g.ui.status('連続配置を終了しました'); }
    this.needsPreview = true;
  }

  clearGhost() {
    if (this.ghost) { this.g.scene.remove(this.ghost); disposeObj(this.ghost); this.ghost = null; }
    this.ghostKey = '';
  }

  setCursor(p, shift) {
    this.cursor = p;
    this.angleSnap = shift;
    this.needsPreview = true;
  }

  // 現在のカーソル位置から配置案を計算
  propose() {
    const p = this.cursor;
    if (!p) return null;
    const def = DEFS[this.tool];
    if (!def) return null;
    const W = this.world;
    if (def.kind === 'line') {
      let s = snapLinePoint(W, p.x, p.z, this.tool);
      if (this.chain && this.angleSnap && s.snap == null) {
        const a = this.chain.last;
        const ang = Math.atan2(p.z - a.z, p.x - a.x);
        const sa = Math.round(ang / ROT_STEP) * ROT_STEP;
        const len = Math.hypot(p.x - a.x, p.z - a.z);
        s = { x: a.x + Math.cos(sa) * len, z: a.z + Math.sin(sa) * len, snap: null };
      }
      if (!this.chain) return { kind: 'start', snap: s };
      const a = this.chain.last;
      const item = { type: this.tool, ax: a.x, az: a.z, bx: s.x, bz: s.z };
      if (this.tool === 'wall') Object.assign(item, this.params.wall, { outer: 1 });
      const exclude = [];
      if (a.split) exclude.push(a.split.id);
      if (s.split) exclude.push(s.split.id);
      let res;
      if (a.split && s.split && a.split.id === s.split.id) res = { ok: false, reason: '同じ線分上の2点は結べません' };
      else res = validate(W, item, exclude);
      return { kind: 'line', item, snap: s, res, len: Math.hypot(s.x - a.x, s.z - a.z) };
    }
    let prop;
    if (this.tool === 'gate') prop = proposeGate(W, p.x, p.z, this.rot);
    else if (this.tool === 'towerSquare' || this.tool === 'towerRound') prop = proposeTower(W, this.tool, p.x, p.z, this.rot, this.params[this.tool].height);
    else if (this.tool === 'stairs') {
      prop = proposeStairs(W, p.x, p.z, this.stairsDir);
      if (!prop.item) return { kind: 'point', item: null, res: { ok: false, reason: prop.reason } };
    } else {
      const item = { type: this.tool, x: p.x, z: p.z, rot: this.rot };
      if (this.params[this.tool]?.height) item.height = this.params[this.tool].height;
      prop = { item, exclude: [] };
    }
    const res = validate(W, prop.item, prop.exclude || []);
    return { kind: 'point', item: prop.item, prop, res };
  }

  // 毎フレーム（必要時のみ）プレビュー更新
  update() {
    if (!this.needsPreview) return;
    this.needsPreview = false;
    if (this.g.mode !== 'build' || this.tool === 'select' || this.tool === 'demolish') {
      this.clearGhost();
      this.snapRing.visible = false;
      if (this.tool === 'demolish' || this.tool === 'select') this.updateHover();
      return;
    }
    const r = this.propose();
    this.lastResult = r;
    this.snapRing.visible = false;
    if (!r) { this.clearGhost(); return; }
    const snap = r.snap;
    if (snap && snap.snap) {
      this.snapRing.visible = true;
      this.snapRing.position.set(snap.x, this.world.terrain.heightAt(snap.x, snap.z) + 0.6, snap.z);
      this.snapRing.material.color.set(snap.snap === 'node' ? 0xffd76a : 0x7fd3e0);
    }
    if (r.kind === 'start') {
      this.clearGhost();
      if (!snap.snap) {
        this.snapRing.visible = true;
        this.snapRing.position.set(snap.x, this.world.terrain.heightAt(snap.x, snap.z) + 0.6, snap.z);
        this.snapRing.material.color.set(0xffffff);
      }
      this.updateHint();
      return;
    }
    if (!r.item) {
      this.clearGhost();
      this.g.ui.status(r.res.reason, 'warn', true);
      return;
    }
    const key = JSON.stringify(r.item) + r.res.ok;
    if (key !== this.ghostKey) {
      this.clearGhost();
      if (r.item && r.res.derived) {
        const obj = buildModel(r.item, r.res.derived, this.world.terrain);
        ghostify(obj, r.res.ok);
        this.ghost = obj;
        this.g.scene.add(obj);
      }
      this.ghostKey = key;
    }
    if (!r.res.ok) this.g.ui.status(r.res.reason, 'warn', true);
    else this.g.ui.status(this.previewText(r), 'ok', true);
  }

  previewText(r) {
    const def = DEFS[r.item.type];
    if (r.kind === 'line') return `${def.name}：長さ ${r.len.toFixed(1)}m — クリックで確定`;
    if (r.prop?.snapped) return `${def.name}：城壁にスナップ — クリックで配置`;
    return `${def.name}：クリックで配置（R で回転）`;
  }

  updateHover() {
    const id = this.g.pickItem();
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.g.buildings.setHover(id != null && id !== this.selectedId ? id : null);
      if (this.tool === 'demolish' && id != null) {
        const it = this.world.get(id);
        this.g.ui.status(`クリックで撤去：${DEFS[it.type].name}`, 'warn', true);
      }
    }
  }

  onClick(e) {
    if (this.g.mode !== 'build') return;
    if (this.tool === 'select') {
      this.select(this.g.pickItem());
      return;
    }
    if (this.tool === 'demolish') {
      const id = this.g.pickItem();
      if (id != null) this.demolish(id);
      return;
    }
    this.needsPreview = false;
    const r = this.propose();
    if (!r) return;
    if (r.kind === 'start') {
      this.chain = { start: { x: r.snap.x, z: r.snap.z }, last: { x: r.snap.x, z: r.snap.z, split: r.snap.split }, ids: [], pts: [{ x: r.snap.x, z: r.snap.z }] };
      this.g.ui.status(`${DEFS[this.tool].name}の始点を決めました。次の点をクリック（右クリック／Escで終了）`, 'ok');
      this.needsPreview = true;
      this.updateHint();
      return;
    }
    if (!r.res.ok) { this.g.ui.status(r.res.reason, 'error'); this.g.ui.flash(); return; }
    this.g.history.push();
    const W = this.world;
    if (r.kind === 'line') {
      const a = this.chain.last, s = r.snap;
      if (a.split) splitLine(W, a.split.id, a.split.t);
      if (s.split) {
        // a 側の分割で ID が変わっている場合に備え、改めて最寄り線分を探す
        const seg = W.nearestSegment(s.x, s.z, 0.5, this.tool);
        if (seg && seg.t > 0.001 && seg.t < 0.999) splitLine(W, seg.item.id, seg.t);
      }
      const added = W.add(r.item);
      this.chain.ids.push(added.id);
      this.chain.pts.push({ x: s.x, z: s.z });
      const closed = Math.hypot(s.x - this.chain.start.x, s.z - this.chain.start.z) < 0.3 && this.chain.pts.length > 3;
      if (this.tool === 'wall') orientWalls(W, this.chain.ids, closed ? this.chain.pts.slice(0, -1) : null);
      if (closed) {
        this.g.ui.status('囲郭が閉じました。門・塔を配置しましょう', 'ok');
        this.chain = null;
      } else {
        this.chain.last = { x: s.x, z: s.z };
        this.g.ui.status(`${DEFS[this.tool].name}を配置しました（${r.len.toFixed(1)}m）。続けて次の点をクリック`, 'ok');
      }
    } else {
      r.prop?.apply?.();
      const added = W.add(r.item);
      this.g.ui.status(`${DEFS[added.type].name}を建設しました`, 'ok');
    }
    this.ghostKey = '';
    this.needsPreview = true;
    this.g.onWorldChanged();
  }

  onRightClick() {
    if (this.chain) { this.cancelChain(); this.updateHint(); return; }
    if (this.tool !== 'select') this.setTool('select');
    else this.select(null);
  }

  demolish(id) {
    const it = this.world.get(id);
    if (!it) return;
    this.g.history.push();
    this.world.remove(id);
    if (this.selectedId === id) this.select(null);
    this.hoverId = null;
    this.g.buildings.setHover(null);
    this.g.ui.status(`${DEFS[it.type].name}を撤去しました`, 'ok');
    this.g.onWorldChanged();
  }

  select(id) {
    this.selectedId = id ?? null;
    this.g.buildings.setSelected(this.selectedId);
    this.g.ui.showItem(this.selectedId != null ? this.world.get(this.selectedId) : null);
  }

  // 選択中の建築物の変更（高さなど）。不正になる場合は元に戻す
  modifySelected(patch) {
    const id = this.selectedId;
    const it = this.world.get(id);
    if (!it) return false;
    const test = { ...it, ...patch };
    const res = validate(this.world, test, [id]);
    if (!res.ok) { this.g.ui.status(res.reason, 'error'); return false; }
    this.g.history.push();
    this.world.update(id, patch);
    this.g.buildings.setSelected(id);
    this.g.ui.showItem(this.world.get(id));
    this.g.onWorldChanged();
    return true;
  }

  toggleGate(id) {
    const it = this.world.get(id);
    if (!it || it.type !== 'gate') return;
    this.world.update(id, { open: !it.open });
    if (this.selectedId === id) { this.g.buildings.setSelected(id); this.g.ui.showItem(this.world.get(id)); }
    this.g.ui.status(it.open ? '城門を開きました' : '城門を閉じました', 'ok');
    this.g.markDirty();
  }

  onKey(e) {
    if (this.g.mode !== 'build') return false;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { this.cancelChain(); if (e.shiftKey ? this.g.history.redo() : this.g.history.undo()) { this.select(null); this.g.ui.status(e.shiftKey ? 'やり直しました' : '取り消しました', 'ok'); this.g.onWorldChanged(); } return true; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { this.cancelChain(); if (this.g.history.redo()) { this.select(null); this.g.ui.status('やり直しました', 'ok'); this.g.onWorldChanged(); } return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'r') {
      if (this.tool === 'stairs') this.stairsDir *= -1;
      else this.rot += e.shiftKey ? -ROT_STEP : ROT_STEP;
      this.needsPreview = true; this.ghostKey = '';
      return true;
    }
    if (e.key === 'Escape') { this.onRightClick(); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (this.selectedId != null) this.demolish(this.selectedId); return true; }
    if (k === 'v') { this.setTool('select'); return true; }
    if (k === 'x') { this.setTool('demolish'); return true; }
    for (const [key, def] of Object.entries(DEFS)) {
      if (def.hotkey && def.hotkey === e.key) { this.setTool(key); return true; }
    }
    return false;
  }

  updateHint() {
    const def = DEFS[this.tool];
    let h;
    if (this.tool === 'select') h = '左クリック：選択　右ドラッグ：回転　中ドラッグ／WASD：移動　ホイール：ズーム　Del：撤去　Ctrl+Z：取り消し';
    else if (this.tool === 'demolish') h = '左クリックした建築物を撤去　右クリック／Esc：選択ツールへ';
    else if (def.kind === 'line') h = this.chain
      ? '左クリック：次の点（始点に戻ると囲郭が閉じる）　Shift：15°刻み　右クリック／Esc：終了'
      : '左クリック：始点（金の輪＝接続点、水色の輪＝既存の線上でT字接続）';
    else if (this.tool === 'stairs') h = '城壁の内側近くでクリック　R：登る向きを反転　右クリック／Esc：取消';
    else h = '左クリック：配置　R／Shift+R：回転　右クリック／Esc：取消';
    this.g.ui.hint(h);
  }
}
