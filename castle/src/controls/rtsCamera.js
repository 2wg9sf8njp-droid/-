// 俯瞰（建築・領地管理）カメラ：移動・回転・ズーム
import * as THREE from 'three';

export class RTSCamera {
  constructor(camera, dom, terrain) {
    this.camera = camera;
    this.dom = dom;
    this.terrain = terrain;
    this.target = new THREE.Vector3(0, 0, 0);
    this.yaw = Math.PI * 0.25;
    this.pitch = 0.75;
    this.dist = 170;
    this.goal = { yaw: this.yaw, pitch: this.pitch, dist: this.dist, x: 0, z: 0 };
    this.keys = new Set();
    this.enabled = true;
    this.drag = null;
    this._bind();
  }

  _bind() {
    const dom = this.dom;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2 || e.button === 1) {
        this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: 0 };
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.button === 2 && !e.shiftKey) {
        this.goal.yaw -= dx * 0.006;
        this.goal.pitch = Math.max(0.12, Math.min(1.45, this.goal.pitch + dy * 0.005));
      } else {
        const s = this.goal.dist * 0.0022;
        this._pan(-dx * s, dy * s);
      }
    });
    const end = (e) => {
      if (this.drag && (e.button === this.drag.button)) {
        this.lastDragMoved = this.drag.moved;
        this.drag = null;
      }
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0012);
      this.goal.dist = Math.max(12, Math.min(520, this.goal.dist * f));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _pan(right, fwd) {
    const c = Math.cos(this.goal.yaw), s = Math.sin(this.goal.yaw);
    // 前方 = カメラからターゲットへの水平方向
    const fx = -s, fz = -c;
    const rx = c, rz = -s;
    this.goal.x += rx * right + fx * fwd;
    this.goal.z += rz * right + fz * fwd;
    this._clampGoal();
  }

  _clampGoal() {
    const h = this.terrain.half + 40;
    this.goal.x = Math.max(-h, Math.min(h, this.goal.x));
    this.goal.z = Math.max(-h, Math.min(h, this.goal.z));
  }

  lookAt(x, z) { this.goal.x = x; this.goal.z = z; this._clampGoal(); }

  setState(s) {
    Object.assign(this.goal, s);
    this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; this.dist = this.goal.dist;
    this.target.x = this.goal.x; this.target.z = this.goal.z;
  }

  getState() { return { ...this.goal }; }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    if (!k.has('ControlLeft') && !k.has('ControlRight') && !k.has('MetaLeft')) {
      const sp = this.goal.dist * 0.9 * dt * (k.has('ShiftLeft') ? 2.2 : 1);
      let f = 0, r = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
      if (f || r) this._pan(r * sp, f * sp);
      if (k.has('KeyQ')) this.goal.yaw += dt * 1.4;
      if (k.has('KeyE')) this.goal.yaw -= dt * 1.4;
      if (k.has('PageUp')) this.goal.pitch = Math.min(1.45, this.goal.pitch + dt);
      if (k.has('PageDown')) this.goal.pitch = Math.max(0.12, this.goal.pitch - dt);
    }
    const a = 1 - Math.exp(-dt * 10);
    this.yaw += (this.goal.yaw - this.yaw) * a;
    this.pitch += (this.goal.pitch - this.pitch) * a;
    this.dist += (this.goal.dist - this.dist) * a;
    this.target.x += (this.goal.x - this.target.x) * a;
    this.target.z += (this.goal.z - this.target.z) * a;
    const gy = Math.max(this.terrain.heightAt(this.target.x, this.target.z), this.terrain.waterLevel);
    this.target.y += (gy - this.target.y) * (1 - Math.exp(-dt * 4));

    const cp = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const pos = new THREE.Vector3(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp2 * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    const minY = Math.max(this.terrain.heightAt(pos.x, pos.z), this.terrain.waterLevel) + 3;
    if (pos.y < minY) pos.y = minY;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }
}
