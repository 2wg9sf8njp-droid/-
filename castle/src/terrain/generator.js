// 地形生成：シード値から標高・地表属性・資源・農業適性などを決定的に生成する（描画とは独立）
import { hashSeed, mulberry32, Simplex2, smoothstep, lerp, clamp } from '../core/rng.js';

export const MAP_SIZE = 400;     // m
export const CELL = 2;           // m / セル
export const N = MAP_SIZE / CELL; // セル数（1辺）
export const WATER_LEVEL = 0;

export const SURFACE = { WATER: 0, SHORE: 1, GRASS: 2, FERTILE: 3, FOREST: 4, ROCK: 5, CLIFF: 6 };
export const SURFACE_NAME = ['水域', '河岸・砂地', '草原', '農耕適地', '森林', '岩場', '崖'];
export const LANDFORM = { RIVER: 0, SEA: 1, VALLEY: 2, PLAIN: 3, HILL: 4, MOUNTAIN: 5 };
export const LANDFORM_NAME = ['河川', '海', '谷・川沿い', '平野', '丘陵', '山岳'];

export const MAP_TYPES = {
  hills: {
    name: '丘陵の領地', desc: '起伏に富む丘と森、川が流れる標準的な地形',
    undulation: 5, hillAmp: 30, hillBias: 0.05, mountainAmp: 34, mountainBias: -0.05,
    cliff: 0.75, river: true, riverWidth: 7, valleyWidth: 38, valleyFlatten: 0.75, meander: 70,
    forestBias: 0.02,
  },
  river: {
    name: '河川沿いの領地', desc: '広い川と氾濫原の平地。川を天然の堀として使える',
    undulation: 4, hillAmp: 13, hillBias: -0.05, mountainAmp: 20, mountainBias: -0.2,
    cliff: 0.35, river: true, riverWidth: 13, valleyWidth: 75, valleyFlatten: 0.9, meander: 90,
    forestBias: 0.0,
  },
  mountain: {
    name: '山城の領地', desc: '中央に険しい岩山がそびえる。崖に囲まれた天然の要害',
    undulation: 5, hillAmp: 18, hillBias: 0.0, mountainAmp: 45, mountainBias: 0.0,
    cliff: 1.0, river: true, riverWidth: 6, valleyWidth: 30, valleyFlatten: 0.6, meander: 50,
    centralHill: 42, forestBias: 0.06,
  },
  coast: {
    name: '海沿いの領地', desc: '一方が海に面した海岸台地。海食崖と入り江',
    undulation: 5, hillAmp: 18, hillBias: 0.0, mountainAmp: 26, mountainBias: -0.15,
    cliff: 0.9, river: true, riverWidth: 6, valleyWidth: 30, valleyFlatten: 0.7, meander: 50,
    coast: true, forestBias: 0.02,
  },
};

function createGenerator(seed, typeKey) {
  const P = MAP_TYPES[typeKey] || MAP_TYPES.hills;
  const rand = mulberry32(hashSeed(seed + '|' + typeKey));
  const nz = [];
  for (let i = 0; i < 10; i++) nz.push(new Simplex2(rand));
  const S = MAP_SIZE;

  const hillCx = (rand() - 0.5) * S * 0.25;
  const hillCz = (rand() - 0.5) * S * 0.25;

  // 海岸線
  let coast = null;
  if (P.coast) {
    const a = rand() * Math.PI * 2;
    coast = { c: Math.cos(a), s: Math.sin(a), off: S * 0.22 };
  }

  // 河川（折れ線）
  let river = null;
  if (P.river) {
    let ang = rand() * Math.PI;
    if (coast) ang = Math.atan2(coast.s, coast.c); // 海へ流れ込む向き
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const nx = -uz, nzv = ux;
    let off0 = (rand() - 0.5) * S * 0.4;
    if (P.centralHill) off0 = (rand() < 0.5 ? -1 : 1) * S * 0.3;
    const ph = rand() * 10;
    const pts = [];
    for (let t = -1000; t <= 1000; t += 6) {
      const lat = off0 + nz[8].fbm(t * 0.0028, 7.7, 3) * P.meander + Math.sin(t * 0.011 + ph) * P.meander * 0.25;
      pts.push({ x: ux * t + nx * lat, z: uz * t + nzv * lat });
    }
    // 10区間ごとのBBoxで高速化
    const chunks = [];
    for (let i = 0; i < pts.length - 1; i += 10) {
      const seg = pts.slice(i, Math.min(i + 11, pts.length));
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const p of seg) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
      chunks.push({ seg, minX, minZ, maxX, maxZ });
    }
    river = { pts, chunks };
  }

  function riverDist(x, z) {
    if (!river) return 9999;
    let best = Infinity;
    for (const c of river.chunks) {
      const dx = Math.max(c.minX - x, 0, x - c.maxX);
      const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
      if (dx * dx + dz * dz > best * best) continue;
      const s = c.seg;
      for (let i = 0; i < s.length - 1; i++) {
        const ax = s[i].x, az = s[i].z, bx = s[i + 1].x, bz = s[i + 1].z;
        const ex = bx - ax, ez = bz - az;
        let t = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
        if (d < best) best = d;
      }
    }
    return best;
  }

  function height(x, z, out) {
    let h = 4;
    h += nz[0].fbm(x * 0.003, z * 0.003, 4) * P.undulation;
    let hill = nz[1].fbm(x * 0.0075 + 31.7, z * 0.0075 - 12.3, 5);
    hill = Math.max(0, hill + P.hillBias);
    h += Math.pow(hill, 1.4) * P.hillAmp;
    // 山岳（局所マスク＋マップ外の遠景山脈）
    let mm = smoothstep(0.15, 0.55, nz[2].fbm(x * 0.0018, z * 0.0018, 2) + P.mountainBias);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    mm = Math.max(mm, smoothstep(S * 0.7, S * 1.6, edge) * 1.6);
    h += nz[3].ridged(x * 0.005, z * 0.005, 5) * mm * P.mountainAmp;
    if (P.centralHill) {
      const d = Math.hypot(x - hillCx, z - hillCz);
      const g = Math.exp(-(d * d) / (2 * 55 * 55));
      h += P.centralHill * g * (0.85 + 0.15 * nz[4].noise(x * 0.02, z * 0.02));
    }
    // 崖（段丘化）
    const cm = smoothstep(0.08, 0.38, nz[5].fbm(x * 0.004 + 50, z * 0.004, 3)) * P.cliff;
    if (cm > 0.001 && h > 5) {
      const k = 7;
      const t = h / k, fl = Math.floor(t), fr = t - fl;
      const st = smoothstep(0.36, 0.64, fr);
      h = lerp(h, (fl + st) * k, cm);
    }
    // 水面より上に持ち上げる（ソフトプラス）
    h = 1.6 + 2 * Math.log(1 + Math.exp((h - 1.6) / 2));
    // 河川と谷
    const rd = riverDist(x, z);
    if (river) {
      const w = P.riverWidth * (1 + 0.25 * nz[6].noise(x * 0.01, z * 0.01));
      const valley = 1 - smoothstep(w, w + P.valleyWidth, rd);
      const flood = 2.2;
      h = lerp(h, flood + (h - flood) * 0.2, valley * P.valleyFlatten);
      const channel = 1 - smoothstep(w * 0.5, w, rd);
      h = lerp(h, -2.4, channel);
    }
    let sea = 0;
    if (coast) {
      const sd = x * coast.c + z * coast.s - coast.off + nz[7].fbm(x * 0.006, z * 0.006, 3) * 35;
      sea = smoothstep(-4, 26, sd);
      h = lerp(h, -7, sea);
    }
    if (out) { out.riverDist = rd; out.sea = sea; }
    return h;
  }

  function aux(x, z) {
    return {
      forest: nz[6].fbm(x * 0.011 + 200, z * 0.011, 4) + P.forestBias,
      fert: nz[7].fbm(x * 0.006 - 90, z * 0.006 + 40, 3),
      rock: nz[9].fbm(x * 0.02, z * 0.02, 2),
      detail: nz[9].noise(x * 0.08, z * 0.08),
    };
  }

  return { P, height, aux, riverDist };
}

export class TerrainData {
  constructor(seed, typeKey) {
    this.seed = String(seed);
    this.typeKey = MAP_TYPES[typeKey] ? typeKey : 'hills';
    this.type = MAP_TYPES[this.typeKey];
    this.size = MAP_SIZE;
    this.half = MAP_SIZE / 2;
    this.n = N;
    this.cell = CELL;
    this.vn = N + 1;
    this.waterLevel = WATER_LEVEL;
    this.gen = createGenerator(this.seed, this.typeKey);
    this._generate();
  }

  _generate() {
    const { vn, n, cell, half } = this;
    const g = this.gen;
    this.heights = new Float32Array(vn * vn);
    this.vRiver = new Float32Array(vn * vn);
    this.vSea = new Float32Array(vn * vn);
    const tmp = {};
    for (let j = 0; j < vn; j++) {
      for (let i = 0; i < vn; i++) {
        const x = -half + i * cell, z = -half + j * cell;
        const k = j * vn + i;
        this.heights[k] = g.height(x, z, tmp);
        this.vRiver[k] = tmp.riverDist;
        this.vSea[k] = tmp.sea;
      }
    }
    const nc = n * n;
    this.cType = new Uint8Array(nc);
    this.cLand = new Uint8Array(nc);
    this.cH = new Float32Array(nc);
    this.cSlope = new Float32Array(nc);
    this.cFert = new Float32Array(nc);
    this.cWood = new Float32Array(nc);
    this.cStone = new Float32Array(nc);
    this.cForestN = new Float32Array(nc);
    this.cDetail = new Float32Array(nc);
    const P = g.P;
    const H = this.heights;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const h00 = H[j * vn + i], h10 = H[j * vn + i + 1], h01 = H[(j + 1) * vn + i], h11 = H[(j + 1) * vn + i + 1];
        const h = (h00 + h10 + h01 + h11) / 4;
        const sx = (h10 + h11 - h00 - h01) / (2 * cell);
        const sz = (h01 + h11 - h00 - h10) / (2 * cell);
        const slope = Math.hypot(sx, sz);
        const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
        const a = g.aux(x, z);
        const rd = (this.vRiver[j * vn + i] + this.vRiver[(j + 1) * vn + i + 1]) / 2;
        const sea = (this.vSea[j * vn + i] + this.vSea[(j + 1) * vn + i + 1]) / 2;
        const minH = Math.min(h00, h10, h01, h11);
        this.cH[k] = h; this.cSlope[k] = slope; this.cForestN[k] = a.forest; this.cDetail[k] = a.detail;

        let fert = clamp(1 - slope * 4.5, 0, 1) * (0.62 + 0.38 * a.fert);
        if (P.river) fert += 0.25 * (1 - smoothstep(P.riverWidth, P.riverWidth + P.valleyWidth * 1.4, rd));
        fert -= smoothstep(18, 35, h) * 0.5;
        fert = clamp(fert, 0, 1);
        this.cFert[k] = fert;

        let t;
        if (h < 0.15 || minH < -0.6) t = SURFACE.WATER;
        else if (h < 1.5) t = SURFACE.SHORE;
        else if (slope > 1.1) t = SURFACE.CLIFF;
        else if (slope > 0.62 || (h > 32 && a.rock > -0.15)) t = SURFACE.ROCK;
        else if (a.forest > 0.12 && slope < 0.62 && h < 42) t = SURFACE.FOREST;
        else if (fert > 0.6) t = SURFACE.FERTILE;
        else t = SURFACE.GRASS;
        this.cType[k] = t;

        let lf;
        if (t === SURFACE.WATER) lf = sea > 0.5 ? LANDFORM.SEA : LANDFORM.RIVER;
        else if (P.river && rd < P.riverWidth + P.valleyWidth) lf = LANDFORM.VALLEY;
        else if (h > 26) lf = LANDFORM.MOUNTAIN;
        else if (slope < 0.1 && h < 12) lf = LANDFORM.PLAIN;
        else lf = LANDFORM.HILL;
        this.cLand[k] = lf;

        this.cWood[k] = t === SURFACE.FOREST ? Math.round(60 + clamp(a.forest, 0, 0.6) * 300) : (t === SURFACE.GRASS ? 5 : 0);
        this.cStone[k] = t === SURFACE.CLIFF ? 220 : t === SURFACE.ROCK ? Math.round(90 + clamp(a.rock + 0.5, 0, 1) * 80) : 0;
      }
    }
  }

  inBounds(x, z, margin = 0) {
    return x >= -this.half + margin && x <= this.half - margin && z >= -this.half + margin && z <= this.half - margin;
  }

  // メッシュの三角形分割と一致する補間
  heightAt(x, z) {
    const { half, cell, vn, n } = this;
    let fx = (x + half) / cell, fz = (z + half) / cell;
    if (fx < 0) fx = 0; if (fz < 0) fz = 0;
    if (fx > n - 1e-4) fx = n - 1e-4; if (fz > n - 1e-4) fz = n - 1e-4;
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const H = this.heights;
    const ha = H[j * vn + i], hb = H[j * vn + i + 1], hc = H[(j + 1) * vn + i], hd = H[(j + 1) * vn + i + 1];
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  cellIndex(x, z) {
    const i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  surfaceAt(x, z) {
    const k = this.cellIndex(x, z);
    return k < 0 ? -1 : this.cType[k];
  }

  slopeAt(x, z) {
    const k = this.cellIndex(x, z);
    return k < 0 ? 0 : this.cSlope[k];
  }

  moveCost(k) {
    const t = this.cType[k];
    if (t === SURFACE.WATER) return Infinity;
    let c = 1 + this.cSlope[k] * 2.2;
    if (t === SURFACE.FOREST) c += 0.6;
    if (t === SURFACE.SHORE) c += 0.3;
    if (t === SURFACE.CLIFF) c += 6;
    return c;
  }

  buildableAt(k) {
    const t = this.cType[k];
    return t !== SURFACE.WATER && t !== SURFACE.CLIFF;
  }

  info(x, z) {
    const k = this.cellIndex(x, z);
    if (k < 0) return null;
    const slope = this.cSlope[k];
    const t = this.cType[k];
    const mc = this.moveCost(k);
    let build;
    if (!this.buildableAt(k)) build = '不可';
    else if (slope > 0.35) build = '困難（急斜面）';
    else if (slope > 0.15) build = '可（傾斜地）';
    else build = '良好（平坦）';
    return {
      height: this.heightAt(x, z),
      slopeDeg: Math.atan(slope) * 180 / Math.PI,
      surface: SURFACE_NAME[t],
      landform: LANDFORM_NAME[this.cLand[k]],
      build,
      wood: this.cWood[k],
      stone: this.cStone[k],
      fert: this.cFert[k],
      moveCost: mc,
    };
  }
}
