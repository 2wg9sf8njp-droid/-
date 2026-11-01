// 2D (XZ平面) の幾何ユーティリティ。回転は three.js の rotation.y と同じ規約。
// ローカル(lx,lz) → ワールド: x = cx + lx*cos + lz*sin,  z = cz - lx*sin + lz*cos

export function toWorld(cx, cz, rot, lx, lz) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

export function toLocal(cx, cz, rot, px, pz) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = px - cx, dz = pz - cz;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

// 線分 a→b の向きを rotation.y に変換（ローカル+Xが線分方向）
export function segRot(ax, az, bx, bz) {
  return Math.atan2(-(bz - az), bx - ax);
}

export function rectPoly(cx, cz, w, d, rot) {
  const hw = w / 2, hd = d / 2;
  return [
    toWorld(cx, cz, rot, -hw, -hd),
    toWorld(cx, cz, rot, hw, -hd),
    toWorld(cx, cz, rot, hw, hd),
    toWorld(cx, cz, rot, -hw, hd),
  ];
}

export function circlePoly(cx, cz, r, n = 14) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return pts;
}

// 線分の太さを持つ矩形（両端を shrink だけ縮める）
export function segmentPoly(ax, az, bx, bz, width, shrink = 0) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / len, uz = dz / len;
  const s = Math.min(shrink, len / 2 - 0.05);
  const a2x = ax + ux * s, a2z = az + uz * s;
  const b2x = bx - ux * s, b2z = bz - uz * s;
  const nx = -uz * width / 2, nz = ux * width / 2;
  return [
    { x: a2x + nx, z: a2z + nz },
    { x: b2x + nx, z: b2z + nz },
    { x: b2x - nx, z: b2z - nz },
    { x: a2x - nx, z: a2z - nz },
  ];
}

export function polyBBox(poly) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ };
}

export function bboxOverlap(a, b, pad = 0) {
  return a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minZ - pad <= b.maxZ && a.maxZ + pad >= b.minZ;
}

// 凸多角形同士の分離軸判定（tol: 接触程度は重複とみなさない）
export function polysOverlap(A, B, tol = 0.05) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      const nx = -(p2.z - p1.z), nz = p2.x - p1.x;
      const l = Math.hypot(nx, nz) || 1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const q of A) { const d = (q.x * nx + q.z * nz) / l; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (const q of B) { const d = (q.x * nx + q.z * nz) / l; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      if (maxA - tol <= minB || maxB - tol <= minA) return false;
    }
  }
  return true;
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// 線分交差。交差すれば {t,u}（各線分上のパラメータ）
export function segIntersect(p1x, p1z, p2x, p2z, p3x, p3z, p4x, p4z) {
  const d = (p2x - p1x) * (p4z - p3z) - (p2z - p1z) * (p4x - p3x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3x - p1x) * (p4z - p3z) - (p3z - p1z) * (p4x - p3x)) / d;
  const u = ((p3x - p1x) * (p2z - p1z) - (p3z - p1z) * (p2x - p1x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

// 点と線分の最近点
export function projectOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t, z = az + dz * t;
  return { t, x, z, dist: Math.hypot(px - x, pz - z), len: Math.sqrt(l2) };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}
