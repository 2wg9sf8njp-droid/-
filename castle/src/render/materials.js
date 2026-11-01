// 手続き生成テクスチャと共有マテリアル（外部画像アセットに依存しない）
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, rand, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rand() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

// 石積み（512px = 4m）
function stoneTexture(seed = 1, base = [150, 143, 128]) {
  const rand = mulberry32(seed);
  const c = canvas(512, 512), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(96,90,80)';
  ctx.fillRect(0, 0, 512, 512);
  let y = 0;
  const rows = [56, 64, 52, 60, 58, 64, 54, 52, 52];
  let ri = 0;
  while (y < 512) {
    let rh = rows[ri++ % rows.length];
    if (y + rh > 512) rh = 512 - y;
    let x = -Math.floor(rand() * 80);
    while (x < 512) {
      const bw = 70 + Math.floor(rand() * 90);
      const v = (rand() - 0.5) * 34;
      const r = base[0] + v + (rand() - 0.5) * 10, g = base[1] + v, b = base[2] + v - (rand() * 8);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      const draw = (xx) => {
        ctx.fillRect(xx + 2, y + 2, bw - 4, rh - 4);
        const grd = ctx.createLinearGradient(0, y, 0, y + rh);
        grd.addColorStop(0, 'rgba(255,255,255,0.10)');
        grd.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = grd;
        ctx.fillRect(xx + 2, y + 2, bw - 4, rh - 4);
      };
      draw(x);
      if (x + bw > 512) draw(x - 512);
      x += bw;
    }
    y += rh;
  }
  speckle(ctx, 512, 512, rand, 9000, 0.18);
  return tex(c);
}

function planksTexture() {
  const rand = mulberry32(7);
  const c = canvas(256, 256), ctx = c.getContext('2d');
  for (let x = 0; x < 256; x += 32) {
    const v = (rand() - 0.5) * 24;
    ctx.fillStyle = `rgb(${(112 + v) | 0},${(82 + v) | 0},${(54 + v) | 0})`;
    ctx.fillRect(x, 0, 32, 256);
    ctx.fillStyle = 'rgba(30,20,10,0.6)';
    ctx.fillRect(x, 0, 2, 256);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(40,25,10,${0.15 * rand()})`;
      ctx.fillRect(x + 3 + rand() * 27, 0, 1, 256);
    }
  }
  return tex(c);
}

// 木組み（ハーフティンバー）の漆喰壁：1面に1枚貼る
function timberTexture() {
  const c = canvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#d9cfb8';
  ctx.fillRect(0, 0, 256, 256);
  const rand = mulberry32(3);
  speckle(ctx, 256, 256, rand, 3000, 0.12);
  ctx.fillStyle = '#4a3624';
  const beam = 12;
  ctx.fillRect(0, 0, 256, beam);
  ctx.fillRect(0, 256 - beam, 256, beam);
  ctx.fillRect(0, 120, 256, beam);
  for (const x of [0, 84, 168, 244]) ctx.fillRect(x, 0, beam, 256);
  ctx.lineWidth = 10; ctx.strokeStyle = '#4a3624';
  ctx.beginPath();
  ctx.moveTo(6, 126); ctx.lineTo(90, 6);
  ctx.moveTo(250, 126); ctx.lineTo(174, 6);
  ctx.moveTo(90, 250); ctx.lineTo(174, 132);
  ctx.stroke();
  // 窓
  ctx.fillStyle = '#2a2018';
  ctx.fillRect(110, 160, 36, 46);
  ctx.fillStyle = '#4a3624';
  ctx.fillRect(126, 160, 4, 46);
  return tex(c, false);
}

function roofTileTexture() {
  const rand = mulberry32(11);
  const c = canvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#5c3326';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    const off = (y / 16) % 2 ? 8 : 0;
    for (let x = -16; x < 256; x += 16) {
      const v = (rand() - 0.5) * 30;
      ctx.fillStyle = `rgb(${(132 + v) | 0},${(70 + v * 0.6) | 0},${(52 + v * 0.4) | 0})`;
      ctx.fillRect(x + off + 1, y + 1, 14, 13);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + off + 1, y + 12, 14, 2);
    }
  }
  return tex(c);
}

function thatchTexture() {
  const rand = mulberry32(13);
  const c = canvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#7d6a43';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = (rand() - 0.5) * 50;
    ctx.strokeStyle = `rgba(${(150 + v) | 0},${(126 + v) | 0},${(78 + v) | 0},0.7)`;
    ctx.lineWidth = 1 + rand();
    const x = rand() * 256, y = rand() * 256;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 3, y + 10 + rand() * 14); ctx.stroke();
  }
  for (let y = 0; y < 256; y += 32) { ctx.fillStyle = 'rgba(40,30,15,0.25)'; ctx.fillRect(0, y, 256, 3); }
  return tex(c);
}

function slateTexture() {
  const rand = mulberry32(17);
  const c = canvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#2c3036';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 14) {
    const off = (y / 14) % 2 ? 9 : 0;
    for (let x = -18; x < 256; x += 18) {
      const v = (rand() - 0.5) * 22;
      ctx.fillStyle = `rgb(${(78 + v) | 0},${(84 + v) | 0},${(94 + v) | 0})`;
      ctx.fillRect(x + off + 1, y + 1, 16, 12);
    }
  }
  return tex(c);
}

function dirtTexture() {
  const rand = mulberry32(19);
  const c = canvas(256, 256), ctx = c.getContext('2d');
  ctx.fillStyle = '#7b6648';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, rand, 12000, 0.3);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(150,140,120,${0.5 * rand()})`;
    ctx.beginPath(); ctx.arc(rand() * 256, rand() * 256, 1 + rand() * 3, 0, 7); ctx.fill();
  }
  return tex(c);
}

// 地面の細部ノイズ（頂点カラーに乗算）
function groundDetailTexture() {
  const rand = mulberry32(23);
  const c = canvas(256, 256), ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 205 + rand() * 50;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 400; i++) {
    const v = Math.floor(170 + rand() * 85);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath(); ctx.arc(rand() * 256, rand() * 256, 2 + rand() * 8, 0, 7); ctx.fill();
  }
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

let MATS = null;

export function getMaterials() {
  if (MATS) return MATS;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
  const stoneTex = stoneTexture(5);
  const darkTex = stoneTexture(9, [118, 112, 100]);
  MATS = {
    stone: std({ map: stoneTex }),
    stoneDark: std({ map: darkTex }),
    wood: std({ map: planksTexture() }),
    timber: std({ map: timberTexture() }),
    roofTile: std({ map: roofTileTexture() }),
    thatch: std({ map: thatchTexture(), roughness: 1 }),
    slate: std({ map: slateTexture(), roughness: 0.8 }),
    dirt: std({ map: dirtTexture(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 1 }),
    iron: std({ color: 0x3a3a3c, roughness: 0.6, metalness: 0.4 }),
    flag: new THREE.MeshStandardMaterial({ color: 0x8e2a22, roughness: 0.9, side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({ color: 0x3a5e66, roughness: 0.25, metalness: 0.1 }),
    ghostOk: new THREE.MeshBasicMaterial({ color: 0x7fd36b, transparent: true, opacity: 0.5, depthWrite: false }),
    ghostBad: new THREE.MeshBasicMaterial({ color: 0xe0503c, transparent: true, opacity: 0.5, depthWrite: false }),
    groundDetail: groundDetailTexture(),
  };
  return MATS;
}
