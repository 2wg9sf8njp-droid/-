// 一人称探索モード：歩行、ジャンプ、段差・階段・城壁上の移動、門の開閉
import * as THREE from 'three';
import { colliderLocal, colliderTop } from '../world/world.js';

const RADIUS = 0.35, HEIGHT = 1.75, EYE = 1.62, STEP = 0.65, GRAV = 22;

export class FPSController {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vy = 0;
    this.yaw = 0; this.pitch = 0;
    this.enabled = false;
    this.keys = new Set();
    this.onGround = false;
    this.locked = false;
    this.onLockChange = null;
    this.onInteract = null;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0022));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyE' && !e.repeat) this.onInteract?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  lock() {
    try {
      const r = this.dom.requestPointerLock?.();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* 非対応環境ではドラッグ操作で代用 */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  enter(x, z, yaw) {
    this.enabled = true;
    this.yaw = yaw; this.pitch = -0.05;
    this.pos.set(x, 0, z);
    this.pos.y = this.floorAt(x, z, 1e4);
    this.vy = 0;
    this.keys.clear();
  }

  exit() { this.enabled = false; this.unlock(); }

  floorAt(x, z, feetY) {
    const t = this.world.terrain;
    let floor = Math.max(t.heightAt(x, z), t.waterLevel - 1.1);
    for (const c of this.world.collidersNear(x, z, 0)) {
      const l = colliderLocal(c, x, z);
      if (Math.abs(l.x) > c.hx || Math.abs(l.z) > c.hz) continue;
      const top = colliderTop(c, l.x, l.z);
      if (top <= feetY + STEP && top > floor) floor = top;
    }
    return floor;
  }

  blocked(x, z, feetY) {
    const t = this.world.terrain;
    if (!t.inBounds(x, z, 0.5)) return true;
    for (const c of this.world.collidersNear(x, z, RADIUS)) {
      const l = colliderLocal(c, x, z);
      const cx = Math.max(-c.hx, Math.min(c.hx, l.x)), cz = Math.max(-c.hz, Math.min(c.hz, l.z));
      const dx = l.x - cx, dz = l.z - cz;
      if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
      const top = colliderTop(c, cx, cz);
      if (c.bottom < feetY + HEIGHT && top > feetY + STEP) return true;
    }
    return false;
  }

  update(dt) {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    const t = this.world.terrain;
    const inWater = t.heightAt(this.pos.x, this.pos.z) < t.waterLevel - 0.4;
    let speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 8.5 : 4.2;
    if (inWater) speed *= 0.45;
    if (f || r) {
      const l = Math.hypot(f, r);
      f /= l; r /= l;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const mx = (-s * f + c * r) * speed * dt;
      const mz = (-c * f - s * r) * speed * dt;
      this._tryMove(mx, 0);
      this._tryMove(0, mz);
    }
    if (k.has('Space') && this.onGround) { this.vy = 6.5; this.onGround = false; }
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;
    const floor = this.floorAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= floor) {
      // 小さな段差は滑らかに登る
      if (floor - this.pos.y < STEP + 0.01 && this.onGround) this.pos.y += (floor - this.pos.y) * Math.min(1, dt * 18) + 0.0001;
      if (this.pos.y < floor) this.pos.y = floor;
      this.vy = 0; this.onGround = true;
    } else if (this.pos.y - floor > 0.05) {
      this.onGround = false;
    }
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  _tryMove(dx, dz) {
    const nx = this.pos.x + dx, nz = this.pos.z + dz;
    if (this.blocked(nx, nz, this.pos.y)) return;
    // 地形の急斜面は登れない
    const t = this.world.terrain;
    const g0 = t.heightAt(this.pos.x, this.pos.z), g1 = t.heightAt(nx, nz);
    const d = Math.hypot(dx, dz) || 1e-6;
    if (g1 > this.pos.y + 0.05 && (g1 - g0) / d > 1.25) return;
    this.pos.x = nx; this.pos.z = nz;
  }
}
