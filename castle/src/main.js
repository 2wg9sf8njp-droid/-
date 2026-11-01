// エントリーポイント：各システムの組み立てとメインループ
import * as THREE from 'three';
import { TerrainData } from './terrain/generator.js';
import { TerrainView, raycastTerrain } from './terrain/terrainMesh.js';
import { Vegetation } from './terrain/vegetation.js';
import { World } from './world/world.js';
import { BuildingRenderer } from './render/buildingRenderer.js';
import { Environment } from './render/environment.js';
import { RTSCamera } from './controls/rtsCamera.js';
import { FPSController } from './controls/fpsController.js';
import { BuildTools, History } from './tools/buildTools.js';
import { UI, randomSeed } from './ui/ui.js';
import { Minimap } from './ui/minimap.js';
import { makeState, saveSlot, loadSlot, storageAvailable } from './save/saveManager.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 6000);
    this.env = new Environment(this.scene, this.renderer);
    this.time = { day: 1, hour: 9, speed: 1 };
    this.mode = 'build';
    this.modalOpen = false;
    this.mouse = { x: 0, y: 0, inside: false, moved: false, ndc: new THREE.Vector2() };
    this.raycaster = new THREE.Raycaster();
    this.dirty = false;
    this.lastAutosave = performance.now();

    this.ui = new UI(this);
    this.minimap = new Minimap(document.getElementById('minimap'), (x, z) => {
      if (this.mode === 'build') this.rts.lookAt(x, z);
    });
    this.history = new History(this);
    this._bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ---- 地形・世界の生成 ----
  newMap(seed, type, state = null) {
    document.getElementById('loading').hidden = false;
    // 描画を一度挟んでから重い生成処理を行う
    requestAnimationFrame(() => setTimeout(() => {
      this._createWorld(seed, type, state);
      document.getElementById('loading').hidden = true;
    }, 20));
  }

  _createWorld(seed, type, state) {
    if (this.mode === 'explore') this.setMode('build');
    this.terrainView?.dispose();
    this.vegetation?.dispose();
    if (this.buildings) { this.scene.remove(this.buildings.root); for (const id of [...this.buildings.objs.keys()]) this.buildings._remove(id); this.buildings.setSelected(null); this.buildings.setHover(null); }
    this.terrain = new TerrainData(seed, type);
    this.terrainView = new TerrainView(this.scene, this.terrain);
    this.vegetation = new Vegetation(this.scene, this.terrain);
    this.world = new World(this.terrain);
    if (state) this.world.load(state.items);
    this.buildings = new BuildingRenderer(this.scene, this.world, this.vegetation);
    if (!this.rts) {
      this.rts = new RTSCamera(this.camera, this.canvas, this.terrain);
      this.fps = new FPSController(this.camera, this.canvas, this.world);
      this.fps.onLockChange = (locked) => { if (this.mode === 'explore') this.ui.setExploreCard(!locked); };
      this.fps.onInteract = () => this.interact();
      this.tools = new BuildTools(this);
    }
    this.rts.terrain = this.terrain;
    this.fps.world = this.world;
    this.history.clear();
    this.tools.chain = null;
    this.tools.select(null);
    this.tools.setTool('select');
    if (state?.camera) this.rts.setState(state.camera);
    else this.rts.setState(this._initialView());
    if (state?.time) { this.time.day = state.time.day; this.time.hour = state.time.hour; }
    else { this.time.day = 1; this.time.hour = 9; }
    document.getElementById('overlay').value = 'normal';
    this.minimap.setTerrain(this.terrain);
    this.ui.mapName(this.terrain);
    this.onWorldChanged(false);
    this.ui.status(state ? '保存データを読み込みました' : `「${this.terrain.type.name}」を生成しました（シード：${seed}）。左のメニューから城壁を選んで築城を始めましょう`, 'ok');
  }

  // 見晴らしのよい丘を初期視点にする
  _initialView() {
    const t = this.terrain;
    let best = null, bestScore = -Infinity;
    for (let z = -120; z <= 120; z += 20) for (let x = -120; x <= 120; x += 20) {
      const k = t.cellIndex(x, z);
      if (!t.buildableAt(k)) continue;
      const score = t.heightAt(x, z) * 0.6 - t.cSlope[k] * 20 - Math.hypot(x, z) * 0.08;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    best = best || { x: 0, z: 0 };
    return { x: best.x, z: best.z, yaw: Math.PI * 0.25, pitch: 0.72, dist: 160 };
  }

  markDirty() { this.dirty = true; }

  onWorldChanged(dirty = true) {
    if (dirty) this.dirty = true;
    this.ui.totals(this.world.totals());
  }

  // ---- 保存 ----
  exportState() { return makeState(this); }
  saveTo(slot) {
    const ok = saveSlot(slot, makeState(this));
    this.ui.toast(ok ? `スロット${slot}に保存しました` : '保存できませんでした（ブラウザの保存領域が使えません）');
    if (ok) this.dirty = false;
  }
  loadFrom(slot) {
    const s = loadSlot(slot);
    if (!s) { this.ui.toast('読み込めませんでした'); return; }
    this.applyState(s);
  }
  applyState(s) { this.newMap(s.seed, s.mapType, s); }

  // ---- モード ----
  setMode(m) {
    if (m === this.mode) return;
    if (m === 'explore') {
      this.tools.cancelChain();
      this.tools.clearGhost();
      this.tools.snapRing.visible = false;
      this.rts.enabled = false;
      this.fps.enter(this.rts.target.x, this.rts.target.z, this.rts.yaw);
      this.mode = 'explore';
      this.ui.setExploreCard(true);
      this.ui.status('探索モード：自分の城を歩いて確かめましょう', 'ok');
      this.ui.hint('WASD 移動　Shift 走る　Space 跳ぶ　E 城門の開閉　F 建築モードへ');
    } else {
      this.fps.exit();
      this.mode = 'build';
      this.rts.enabled = true;
      this.rts.setState({ ...this.rts.getState(), x: this.fps.pos.x, z: this.fps.pos.z, yaw: this.fps.yaw, dist: Math.min(this.rts.goal.dist, 90) });
      this.ui.setExploreCard(false);
      this.tools.updateHint();
      this.tools.needsPreview = true;
    }
    this.ui.setModeUI(this.mode);
  }

  setSpeed(s) { this.time.speed = s; this.ui.setSpeedUI(s); }

  interact() {
    let best = null, bd = 9;
    for (const it of this.world.all()) {
      if (it.type !== 'gate') continue;
      const d = Math.hypot(it.x - this.fps.pos.x, it.z - this.fps.pos.z);
      if (d < bd) { bd = d; best = it; }
    }
    if (best) this.tools.toggleGate(best.id);
    else this.ui.toast('近くに城門がありません');
  }

  focusView() { this.canvas.focus({ preventScroll: true }); }

  // ---- 入力 ----
  _bindInput() {
    const c = this.canvas;
    let down = null;
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
      this.mouse.ndc.set((this.mouse.x / r.width) * 2 - 1, -(this.mouse.y / r.height) * 2 + 1);
      this.mouse.inside = true; this.mouse.moved = true; this.mouse.shift = e.shiftKey;
      // ポインタロック非対応時はドラッグで視点操作
      if (this.mode === 'explore' && !this.fps.locked && down && down.button === 0) {
        this.fps.yaw -= e.movementX * 0.004;
        this.fps.pitch = Math.max(-1.5, Math.min(1.5, this.fps.pitch - e.movementY * 0.004));
      }
      if (down) down.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    });
    c.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    c.addEventListener('pointerdown', (e) => {
      this.focusView();
      down = { button: e.button, x: e.clientX, y: e.clientY, moved: 0 };
    });
    c.addEventListener('pointerup', (e) => {
      if (!down || down.button !== e.button) { down = null; return; }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) + (down.moved > 12 ? down.moved : 0);
      const btn = down.button;
      down = null;
      if (moved > 6) return;
      if (this.mode === 'explore') {
        if (btn === 0 && !this.fps.locked) this.fps.lock();
        return;
      }
      if (btn === 0) this.tools.onClick(e);
      if (btn === 2) this.tools.onRightClick();
    });
    window.addEventListener('keydown', (e) => {
      if (this.modalOpen) { if (e.key === 'Escape') this.ui.closeModal(); return; }
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'KeyF' || e.code === 'Tab') {
        e.preventDefault();
        this.setMode(this.mode === 'build' ? 'explore' : 'build');
        return;
      }
      if (this.mode === 'build') {
        if (e.code === 'Space') { e.preventDefault(); this.setSpeed(this.time.speed === 0 ? (this._lastSpeed || 1) : (this._lastSpeed = this.time.speed, 0)); return; }
        if (this.tools.onKey(e)) e.preventDefault();
      }
    });
  }

  // 画面上のマウス位置にある建築物
  pickItem() {
    if (!this.mouse.inside) return null;
    this.raycaster.setFromCamera(this.mouse.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.buildings.pickables(), true);
    for (const h of hits) if (h.object.userData.itemId != null) return h.object.userData.itemId;
    const g = this._ground;
    if (g) { const it = this.world.itemAt(g.x, g.z); if (it) return it.id; }
    return null;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- メインループ ----
  start() {
    let last = performance.now();
    let mmT = 0;
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.world) {
        // 時間進行（1×で1日=4分）
        this.time.hour += dt * this.time.speed * 0.1;
        if (this.time.hour >= 24) { this.time.hour -= 24; this.time.day++; }

        if (this.mode === 'build') {
          this.rts.update(dt);
          if (this.mouse.moved && !this.modalOpen) {
            this.mouse.moved = false;
            this.raycaster.setFromCamera(this.mouse.ndc, this.camera);
            const ray = this.raycaster.ray;
            this._ground = raycastTerrain(this.terrain, ray.origin, ray.direction);
            if (this._ground && this.terrain.inBounds(this._ground.x, this._ground.z)) {
              this.tools.setCursor(this._ground, this.mouse.shift);
              this.ui.terrainInfo(this.terrain.info(this._ground.x, this._ground.z));
            } else {
              this.tools.setCursor(null, false);
            }
          }
          this.tools.update();
        } else {
          this.fps.update(dt);
        }
        this.buildings.update(dt, now / 1000);
        const target = this.mode === 'build' ? this.rts.target : this.fps.pos;
        this.env.update(this.time.hour, target, this.camera, this.mode === 'build' ? this.rts.dist : 60);
        this.renderer.render(this.scene, this.camera);

        mmT += dt;
        if (mmT > 0.15) {
          mmT = 0;
          this.ui.clock(this.time.day, this.time.hour);
          this.minimap.draw(this.world, this.rts, this.mode === 'explore' ? { x: this.fps.pos.x, z: this.fps.pos.z, yaw: this.fps.yaw } : null);
        }
        if (this.dirty && now - this.lastAutosave > 60000) {
          this.lastAutosave = now;
          if (storageAvailable()) { saveSlot('auto', makeState(this)); this.dirty = false; }
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

const game = new Game();
window.__game = game; // デバッグ用
const auto = storageAvailable() ? loadSlot('auto') : null;
if (auto) {
  game.newMap(auto.seed, auto.mapType, auto);
} else {
  game.newMap('castellum', 'hills');
}
game.start();
export { randomSeed };
