// ミニマップ：地形（陰影付き）・建築物・カメラ位置。クリック／ドラッグでカメラ移動
import { SURFACE } from '../terrain/generator.js';

const COLS = {
  [SURFACE.WATER]: [64, 98, 112], [SURFACE.SHORE]: [160, 150, 116], [SURFACE.GRASS]: [112, 138, 78],
  [SURFACE.FERTILE]: [150, 152, 90], [SURFACE.FOREST]: [62, 90, 50], [SURFACE.ROCK]: [134, 130, 112], [SURFACE.CLIFF]: [96, 90, 80],
};

export class Minimap {
  constructor(canvas, onPick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.base = null;
    let down = false;
    const pick = (e) => {
      const r = canvas.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      if (this.terrain) this.onPick(-this.terrain.half + u * this.terrain.size, -this.terrain.half + v * this.terrain.size);
    };
    canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); pick(e); });
    canvas.addEventListener('pointermove', (e) => { if (down) pick(e); });
    canvas.addEventListener('pointerup', () => { down = false; });
  }

  setTerrain(t) {
    this.terrain = t;
    const n = t.n;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const col = COLS[t.cType[k]];
      // 北西からの陰影
      const hL = t.cH[j * n + Math.max(0, i - 1)], hU = t.cH[Math.max(0, j - 1) * n + i];
      const shade = Math.max(0.6, Math.min(1.35, 1 + ((t.cH[k] - hL) + (t.cH[k] - hU)) * 0.12));
      const p = k * 4;
      img.data[p] = col[0] * shade; img.data[p + 1] = col[1] * shade; img.data[p + 2] = col[2] * shade; img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.base = c;
  }

  draw(world, cam, fpsPos) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const t = this.terrain;
    if (!this.base) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, W, H);
    const sx = (x) => ((x + t.half) / t.size) * W;
    const sz = (z) => ((z + t.half) / t.size) * H;
    for (const it of world.all()) {
      if (it.type === 'road') {
        ctx.strokeStyle = 'rgba(170,140,100,0.95)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx(it.ax), sz(it.az)); ctx.lineTo(sx(it.bx), sz(it.bz)); ctx.stroke();
      }
    }
    for (const it of world.all()) {
      if (it.type === 'wall') {
        ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = Math.max(2, (it.thickness / t.size) * W * 1.2);
        ctx.beginPath(); ctx.moveTo(sx(it.ax), sz(it.az)); ctx.lineTo(sx(it.bx), sz(it.bz)); ctx.stroke();
      }
    }
    for (const it of world.all()) {
      if (it.type === 'wall' || it.type === 'road') continue;
      const d = world.der(it.id);
      ctx.fillStyle = it.type === 'gate' ? '#c08a4a' : it.type === 'keep' ? '#ffd76a' : it.type.startsWith('tower') ? '#f2eee2' : '#b46a52';
      ctx.beginPath();
      d.poly.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sz(p.z)) : ctx.moveTo(sx(p.x), sz(p.z))));
      ctx.closePath(); ctx.fill();
    }
    // 視点
    const px = fpsPos ? fpsPos.x : cam.target.x, pz = fpsPos ? fpsPos.z : cam.target.z;
    const yaw = fpsPos ? fpsPos.yaw : cam.yaw;
    ctx.save();
    ctx.translate(sx(px), sz(pz));
    ctx.rotate(-yaw);
    ctx.fillStyle = '#ffde7a'; ctx.strokeStyle = '#2a2016'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    if (!fpsPos) {
      // 表示範囲の目安
      const r = Math.max(6, Math.min(70, (cam.dist / t.size) * W * 0.7));
      ctx.strokeStyle = 'rgba(255,222,122,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx(px), sz(pz), r, 0, Math.PI * 2); ctx.stroke();
    }
  }
}
