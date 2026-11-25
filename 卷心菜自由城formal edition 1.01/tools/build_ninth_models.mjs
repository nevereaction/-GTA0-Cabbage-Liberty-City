import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawAssetsBase = path.resolve(root, '..', 'eighth', 'assets');
const outDir = path.join(root, 'assets');
fs.mkdirSync(outDir, { recursive: true });

const MAGIC_BLD1 = 0x31444C42; // "BLD1" LE

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function readBinarySTL(filePath) {
  const buf = fs.readFileSync(filePath);
  const tris = buf.readUInt32LE(80);
  const expected = 84 + tris * 50;
  if (buf.length !== expected) {
    throw new Error(`Invalid binary STL ${filePath}: len=${buf.length}, expected=${expected}`);
  }
  return { buf, tris };
}

function readZipEntry(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`Invalid ZIP EOCD in ${zipPath}`);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < cdCount; i++) {
    const compMethod = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commLen;
    if (name === entryName) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      return compMethod === 0 ? compData : zlib.inflateRawSync(compData);
    }
  }
  throw new Error(`Entry ${entryName} not found in ${zipPath}`);
}

function finalizeWeldedMesh(vertCount, sumX, sumY, sumZ, counts, rawTris) {
  const positions = new Float32Array(vertCount * 3);
  let gMinX = Infinity, gMaxX = -Infinity;
  let gMinY = Infinity, gMaxY = -Infinity;
  let gMinZ = Infinity, gMaxZ = -Infinity;
  let scx = 0, scy = 0, scz = 0;

  for (let i = 0; i < vertCount; i++) {
    const px = sumX[i] / counts[i];
    const py = sumY[i] / counts[i];
    const pz = sumZ[i] / counts[i];
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    scx += px; scy += py; scz += pz;
    if (px < gMinX) gMinX = px; if (px > gMaxX) gMaxX = px;
    if (py < gMinY) gMinY = py; if (py > gMaxY) gMaxY = py;
    if (pz < gMinZ) gMinZ = pz; if (pz > gMaxZ) gMaxZ = pz;
  }

  const indices = new Uint32Array(rawTris);
  const smoothN = new Float32Array(vertCount * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const x0 = positions[i0 * 3], y0 = positions[i0 * 3 + 1], z0 = positions[i0 * 3 + 2];
    const ax = positions[i1 * 3] - x0, ay = positions[i1 * 3 + 1] - y0, az = positions[i1 * 3 + 2] - z0;
    const bx = positions[i2 * 3] - x0, by = positions[i2 * 3 + 1] - y0, bz = positions[i2 * 3 + 2] - z0;
    const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
    for (const v of [i0, i1, i2]) {
      smoothN[v * 3] += fx; smoothN[v * 3 + 1] += fy; smoothN[v * 3 + 2] += fz;
    }
  }

  const mcx = scx / vertCount, mcy = scy / vertCount, mcz = scz / vertCount;
  let dotSum = 0;
  for (let i = 0; i < vertCount; i++) {
    const nx = smoothN[i * 3], ny = smoothN[i * 3 + 1], nz = smoothN[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    dotSum += (positions[i * 3] - mcx) * (nx / nl)
      + (positions[i * 3 + 1] - mcy) * (ny / nl)
      + (positions[i * 3 + 2] - mcz) * (nz / nl);
  }
  if (dotSum < 0) {
    console.log(`  Flipped inward winding (avgDot=${(dotSum / vertCount).toFixed(4)})`);
    for (let t = 0; t < indices.length; t += 3) {
      const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
    }
    for (let i = 0; i < smoothN.length; i++) smoothN[i] = -smoothN[i];
  } else {
    console.log(`  Outward normals OK (avgDot=${(dotSum / vertCount).toFixed(4)})`);
  }

  for (let i = 0; i < vertCount; i++) {
    const nx = smoothN[i * 3], ny = smoothN[i * 3 + 1], nz = smoothN[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-8) {
      smoothN[i * 3] = nx / nl; smoothN[i * 3 + 1] = ny / nl; smoothN[i * 3 + 2] = nz / nl;
    } else {
      smoothN[i * 3] = 0; smoothN[i * 3 + 1] = 1; smoothN[i * 3 + 2] = 0;
    }
  }

  return {
    positions,
    smoothNormals: smoothN,
    indices,
    bbox: [gMinX, gMaxX, gMinY, gMaxY, gMinZ, gMaxZ],
  };
}

function weldStlMesh(stl, quantRaw, rawToAligned, targetHeight) {
  const { buf, tris } = stl;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < tris; i++) {
    const off = 84 + i * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const o = off + v * 12;
      const [ax, ay, az] = rawToAligned(buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8));
      if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
      if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
      if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
    }
  }

  const scale = targetHeight / (maxY - minY);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const buckets = new Map();
  const sumX = [], sumY = [], sumZ = [], counts = [];
  const rawTris = [];

  for (let i = 0; i < tris; i++) {
    const off = 84 + i * 50 + 12;
    const ids = [0, 0, 0];
    for (let v = 0; v < 3; v++) {
      const o = off + v * 12;
      const rx = buf.readFloatLE(o);
      const ry = buf.readFloatLE(o + 4);
      const rz = buf.readFloatLE(o + 8);
      const key = `${Math.round(rx / quantRaw)},${Math.round(ry / quantRaw)},${Math.round(rz / quantRaw)}`;
      let id = buckets.get(key);
      if (id === undefined) {
        id = sumX.length;
        buckets.set(key, id);
        sumX.push(0); sumY.push(0); sumZ.push(0); counts.push(0);
      }
      const [ax, ay, az] = rawToAligned(rx, ry, rz);
      sumX[id] += (ax - cx) * scale;
      sumY[id] += (ay - minY) * scale;
      sumZ[id] += (az - cz) * scale;
      counts[id]++;
      ids[v] = id;
    }
    if (ids[0] !== ids[1] && ids[1] !== ids[2] && ids[2] !== ids[0]) {
      rawTris.push(ids[0], ids[1], ids[2]);
    }
  }

  return finalizeWeldedMesh(sumX.length, sumX, sumY, sumZ, counts, rawTris);
}

function splitPartsSmooth(mesh, classifyTri) {
  const { positions, smoothNormals, indices } = mesh;
  const triCount = indices.length / 3;
  const partMap = new Map();

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const mcx = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3;
    const mcy = (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3;
    const mcz = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3;
    const pid = classifyTri(mcx, mcy, mcz, t);

    let bucket = partMap.get(pid);
    if (!bucket) {
      bucket = { pos: [], nrm: [], idx: [], remap: new Map() };
      partMap.set(pid, bucket);
    }

    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      let nv = bucket.remap.get(v);
      if (nv === undefined) {
        nv = bucket.pos.length / 3;
        bucket.remap.set(v, nv);
        bucket.pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        bucket.nrm.push(smoothNormals[v * 3], smoothNormals[v * 3 + 1], smoothNormals[v * 3 + 2]);
      }
      bucket.idx.push(nv);
    }
  }

  return [...partMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([partId, b]) => ({
      partId,
      positions: new Float32Array(b.pos),
      normals: new Float32Array(b.nrm),
      indices: new Uint32Array(b.idx),
    }));
}

function makeOrientedEllipsoid(cx, cy, cz, ru, rv, rn, nx, ny, nz, segU = 20, segV = 14) {
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const Nx = nx / nLen, Ny = ny / nLen, Nz = nz / nLen;
  let Ux = Nz, Uy = 0, Uz = -Nx;
  const uLen = Math.hypot(Ux, Uy, Uz) || 1;
  Ux /= uLen; Uy /= uLen; Uz /= uLen;
  const Vx = Ny * Uz - Nz * Uy;
  const Vy = Nz * Ux - Nx * Uz;
  const Vz = Nx * Uy - Ny * Ux;

  const pos = [], norm = [], idx = [];
  const stride = segU + 1;
  for (let iv = 0; iv <= segV; iv++) {
    const phi = -Math.PI / 2 + (iv / segV) * Math.PI;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    for (let iu = 0; iu <= segU; iu++) {
      const th = (iu / segU) * Math.PI * 2;
      const ct = Math.cos(th), st = Math.sin(th);
      const lu = cp * ct * ru, lv = sp * rv, ln = cp * st * rn;
      pos.push(cx + Ux * lu + Vx * lv + Nx * ln, cy + Uy * lu + Vy * lv + Ny * ln, cz + Uz * lu + Vz * lv + Nz * ln);
      const gnx = (cp * ct) / ru, gny = sp / rv, gnz = (cp * st) / rn;
      const wx = Ux * gnx + Vx * gny + Nx * gnz;
      const wy = Uy * gnx + Vy * gny + Ny * gnz;
      const wz = Uz * gnx + Vz * gny + Nz * gnz;
      const wl = Math.hypot(wx, wy, wz) || 1;
      norm.push(wx / wl, wy / wl, wz / wl);
    }
  }
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu, b = a + 1, c = a + stride, d = c + 1;
      if (iv !== 0) idx.push(a, c, b);
      if (iv !== segV - 1) idx.push(b, c, d);
    }
  }
  let dotSum = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
    const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
    const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
    const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
    dotSum += fx * (pos[i0] - cx) + fy * (pos[i0 + 1] - cy) + fz * (pos[i0 + 2] - cz);
  }
  if (dotSum < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp;
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(norm), indices: new Uint32Array(idx) };
}

function mergeProceduralParts(partId, list) {
  let vc = 0, ic = 0;
  for (const m of list) { vc += m.positions.length / 3; ic += m.indices.length; }
  const positions = new Float32Array(vc * 3);
  const normals = new Float32Array(vc * 3);
  const indices = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const m of list) {
    positions.set(m.positions, vo * 3);
    normals.set(m.normals, vo * 3);
    for (let k = 0; k < m.indices.length; k++) indices[io + k] = m.indices[k] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return { partId, positions, normals, indices };
}

function fitGreenBlackEyes(mesh, H, eyeSpecs, params) {
  const pos = mesh.positions;
  const nrm = mesh.smoothNormals;
  const vertCount = pos.length / 3;
  const greenPieces = [];
  const blackPieces = [];
  const glintPieces = [];

  for (const es of eyeSpecs) {
    let sx = 0, sy = 0, sz = 0, snx = 0, sny = 0, snz = 0, cnt = 0;
    for (let i = 0; i < vertCount; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (z > params.zMin * H && Math.hypot(x - es.tx, y - es.ty) < params.probeR * H) {
        sx += x; sy += y; sz += z;
        snx += nrm[i * 3]; sny += nrm[i * 3 + 1]; snz += nrm[i * 3 + 2];
        cnt++;
      }
    }
    if (cnt < 3) throw new Error(`Failed to probe eye surface for ${es.name} (cnt=${cnt})`);
    const ax = sx / cnt, ay = sy / cnt, az = sz / cnt;
    const nl = Math.hypot(snx, sny, snz) || 1;
    const nx = snx / nl, ny = sny / nl, nz = snz / nl;

    let ux = nz, uy = 0, uz = -nx;
    const uLen = Math.hypot(ux, uy, uz) || 1;
    ux /= uLen; uy /= uLen; uz /= uLen;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;

    const ruG = params.ruG * H, rvG = params.rvG * H, rnG = params.rnG * H;
    let maxDn = -Infinity;
    for (let i = 0; i < vertCount; i++) {
      const dx = pos[i * 3] - ax, dy = pos[i * 3 + 1] - ay, dz = pos[i * 3 + 2] - az;
      const du = dx * ux + dy * uy + dz * uz;
      const dv = dx * vx + dy * vy + dz * vz;
      const dn = dx * nx + dy * ny + dz * nz;
      if ((du / ruG) ** 2 + (dv / rvG) ** 2 < 1.0 && Math.abs(dn) < 0.06 * H) {
        if (dn > maxDn) maxDn = dn;
      }
    }

    const clearShift = maxDn > -Infinity ? Math.max(params.minShift * H, maxDn + params.pad * H - rnG) : 0;
    const gcx = ax + nx * clearShift, gcy = ay + ny * clearShift, gcz = az + nz * clearShift;
    greenPieces.push(makeOrientedEllipsoid(gcx, gcy, gcz, ruG, rvG, rnG, nx, ny, nz, 22, 14));

    const ruP = params.ruP * H, rvP = params.rvP * H, rnP = params.rnP * H;
    const pShift = clearShift + rnG - params.pupilEmbed * H;
    const pcx = ax + nx * pShift, pcy = ay + ny * pShift, pcz = az + nz * pShift;
    blackPieces.push(makeOrientedEllipsoid(pcx, pcy, pcz, ruP, rvP, rnP, nx, ny, nz, 20, 14));

    const glShift = pShift + rnP - 0.001 * H;
    const gOffU = params.glintU * H, gOffV = params.glintV * H;
    const lcx = ax + nx * glShift + ux * gOffU + vx * gOffV;
    const lcy = ay + ny * glShift + uy * gOffU + vy * gOffV;
    const lcz = az + nz * glShift + uz * gOffU + vz * gOffV;
    const rGl = params.rGlint * H;
    glintPieces.push(makeOrientedEllipsoid(lcx, lcy, lcz, rGl, rGl, params.rnGlint * H, nx, ny, nz, 12, 8));

    console.log(`  Eye ${es.name}: probed=${cnt} verts, norm=(${nx.toFixed(2)},${ny.toFixed(2)},${nz.toFixed(2)}), clearShift=${(clearShift / H).toFixed(4)}H`);
  }

  return {
    green: mergeProceduralParts(2, greenPieces),
    black: mergeProceduralParts(3, blackPieces),
    glint: mergeProceduralParts(4, glintPieces),
  };
}

function writeBld1File(outFile, bbox, parts) {
  parts.sort((a, b) => a.partId - b.partId);
  let byteLen = 4 + 4 + 24;
  for (const p of parts) {
    byteLen += 12 + p.positions.byteLength + p.normals.byteLength + p.indices.byteLength;
  }
  const buf = Buffer.allocUnsafe(byteLen);
  let off = 0;
  buf.writeUInt32LE(MAGIC_BLD1, off); off += 4;
  buf.writeUInt32LE(parts.length, off); off += 4;
  for (let i = 0; i < 6; i++) { buf.writeFloatLE(bbox[i], off); off += 4; }
  for (const p of parts) {
    buf.writeUInt32LE(p.partId, off); off += 4;
    buf.writeUInt32LE(p.positions.length / 3, off); off += 4;
    buf.writeUInt32LE(p.indices.length, off); off += 4;
    Buffer.from(p.positions.buffer, p.positions.byteOffset, p.positions.byteLength).copy(buf, off); off += p.positions.byteLength;
    Buffer.from(p.normals.buffer, p.normals.byteOffset, p.normals.byteLength).copy(buf, off); off += p.normals.byteLength;
    Buffer.from(p.indices.buffer, p.indices.byteOffset, p.indices.byteLength).copy(buf, off); off += p.indices.byteLength;
  }
  if (off !== byteLen) throw new Error(`BLD1 byte mismatch in ${outFile}: ${off} vs ${byteLen}`);
  fs.writeFileSync(outFile, buf);
  const totV = parts.reduce((s, p) => s + p.positions.length / 3, 0);
  const totT = parts.reduce((s, p) => s + p.indices.length / 3, 0);
  console.log(
    `  Saved ${path.basename(outFile)} (${(byteLen / 1024).toFixed(1)} KB) | parts=[${parts.map(p => p.partId).join(',')}] | verts=${totV}, tris=${totT} | bbox X=[${bbox[0].toFixed(2)},${bbox[1].toFixed(2)}] Y=[${bbox[2].toFixed(2)},${bbox[3].toFixed(2)}] Z=[${bbox[4].toFixed(2)},${bbox[5].toFixed(2)}]`
  );
}

/* ==================== 1. 飞鸟奶娃公园雕塑 (statue_fly_naiwa.bin) ==================== */
{
  console.log('\n[1/3] Building statue_fly_naiwa.bin (飞鸟奶娃雕塑)...');
  const H = 4.6;
  const stl = readBinarySTL(path.join(rawAssetsBase, '飞奶雕塑', 'obj_1_4b6b0cc90c72941e6a264d7708663dc9.obj.stl'));
  // [y, z, x] keeps det = +1 (right-handed), +Z front, +Y up
  const mesh = weldStlMesh(stl, 1.15, (x, y, z) => [y, z, x], H);
  const baseParts = splitPartsSmooth(mesh, (_px, py) => (py < 0.066 * H ? 5 : 0));
  const eyes = fitGreenBlackEyes(mesh, H, [
    { name: 'LeftEye(-X)',  tx: -0.099 * H, ty: 0.784 * H },
    { name: 'RightEye(+X)', tx:  0.099 * H, ty: 0.784 * H },
  ], {
    zMin: 0.14, probeR: 0.028,
    ruG: 0.036, rvG: 0.038, rnG: 0.015,
    minShift: -0.004, pad: 0.005,
    ruP: 0.022, rvP: 0.024, rnP: 0.012, pupilEmbed: 0.004,
    glintU: -0.009, glintV: 0.010, rGlint: 0.0065, rnGlint: 0.0055,
  });
  writeBld1File(path.join(outDir, 'statue_fly_naiwa.bin'), mesh.bbox, [...baseParts, eyes.green, eyes.black, eyes.glint]);
}

/* ==================== 2. 神临奶娃 (god_naiwa.bin, 22m) ==================== */
{
  console.log('\n[2/3] Building god_naiwa.bin (神临奶娃 22m)...');
  const H = 22.0;
  const stl = readBinarySTL(path.join(rawAssetsBase, '神临奶蛙', 'obj_1_奶蛙.obj.stl'));
  const mesh = weldStlMesh(stl, 1.40, (x, y, z) => [x, z, -y], H);
  const baseParts = splitPartsSmooth(mesh, (px, py, pz) => {
    const nx = px / H, ny = py / H, nz = pz / H;
    if (ny >= 0.555 && ny <= 0.855) {
      const ax = Math.abs(nx);
      if (ax > 0.228 && nz < -0.10) return 1; // 圣洁白色羽翼
      if (ax >= 0.085) {
        const zBack = -0.170 + (ny - 0.58) * 0.44 + (ax - 0.085) * 0.30;
        if (nz < zBack) return 1;
      }
    }
    return 0; // 金黄神躯
  });
  const eyes = fitGreenBlackEyes(mesh, H, [
    { name: 'LeftEye(-X)',  tx: -0.074 * H, ty: 0.923 * H },
    { name: 'RightEye(+X)', tx:  0.049 * H, ty: 0.926 * H },
  ], {
    zMin: 0.06, probeR: 0.022,
    ruG: 0.026, rvG: 0.030, rnG: 0.013,
    minShift: -0.003, pad: 0.004,
    ruP: 0.0155, rvP: 0.0185, rnP: 0.010, pupilEmbed: 0.0035,
    glintU: -0.005, glintV: 0.007, rGlint: 0.005, rnGlint: 0.0045,
  });
  writeBld1File(path.join(outDir, 'god_naiwa.bin'), mesh.bbox, [...baseParts, eyes.green, eyes.black, eyes.glint]);
}

/* ==================== 3. 捧腹大笑奶娃 (laugh_naiwa.bin, 1.65m) ==================== */
{
  console.log('\n[3/3] Building laugh_naiwa.bin (捧腹大笑多色模型)...');
  const H = 1.65;
  const quantRaw = 1.58;
  const ang = (-123 * Math.PI) / 180;
  const fx = Math.cos(ang), fy = Math.sin(ang);
  const rawToAligned = (x, y, z) => [-fy * x + fx * y, z, fx * x + fy * y]; // det = +1, face -> +Z

  const xmlBuf = readZipEntry(path.join(rawAssetsBase, '捧腹大笑', '多色和单色.3mf'), '3D/Objects/object_1.model');
  const xml = xmlBuf.toString('utf8');
  const vStart = xml.indexOf('<vertices>');
  const vEnd = xml.indexOf('</vertices>', vStart);
  const tStart = xml.indexOf('<triangles>', vEnd);
  const tEnd = xml.indexOf('</triangles>', tStart);
  if (vStart < 0 || vEnd < 0 || tStart < 0 || tEnd < 0) {
    throw new Error('Failed to locate <vertices> or <triangles> in 3MF object_1.model');
  }

  const vx = [], vy = [], vz = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  const vRe = /<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g;
  vRe.lastIndex = vStart;
  let m;
  while ((m = vRe.exec(xml)) !== null && m.index < vEnd) {
    const rx = Number(m[1]), ry = Number(m[2]), rz = Number(m[3]);
    vx.push(rx); vy.push(ry); vz.push(rz);
    const [ax, ay, az] = rawToAligned(rx, ry, rz);
    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
  }

  const origVertCount = vx.length;
  const scale = H / (maxY - minY);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  console.log(`  Parsed 3MF verts=${origVertCount}, raw H=${(maxY - minY).toFixed(2)}`);

  const buckets = new Map();
  const sumX = [], sumY = [], sumZ = [], counts = [];
  const oldToNew = new Uint32Array(origVertCount);
  for (let i = 0; i < origVertCount; i++) {
    const rx = vx[i], ry = vy[i], rz = vz[i];
    const key = `${Math.round(rx / quantRaw)},${Math.round(ry / quantRaw)},${Math.round(rz / quantRaw)}`;
    let id = buckets.get(key);
    if (id === undefined) {
      id = sumX.length;
      buckets.set(key, id);
      sumX.push(0); sumY.push(0); sumZ.push(0); counts.push(0);
    }
    const [ax, ay, az] = rawToAligned(rx, ry, rz);
    sumX[id] += (ax - cx) * scale;
    sumY[id] += (ay - minY) * scale;
    sumZ[id] += (az - cz) * scale;
    counts[id]++;
    oldToNew[i] = id;
  }

  const COLOR_MAP = { '4': 0, '8': 1, '0C': 2, '1C': 3 };
  const rawTris = [];
  const triParts = [];
  const tRe = /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"(?: paint_color="([^"]+)")?\/>/g;
  tRe.lastIndex = tStart;
  while ((m = tRe.exec(xml)) !== null && m.index < tEnd) {
    const i0 = oldToNew[Number(m[1])];
    const i1 = oldToNew[Number(m[2])];
    const i2 = oldToNew[Number(m[3])];
    if (i0 === i1 || i1 === i2 || i2 === i0) continue;
    rawTris.push(i0, i1, i2);
    triParts.push(COLOR_MAP[m[4] || '4'] ?? 0);
  }

  const mesh = finalizeWeldedMesh(sumX.length, sumX, sumY, sumZ, counts, rawTris);
  const parts = splitPartsSmooth(mesh, (_x, _y, _z, t) => triParts[t]);
  writeBld1File(path.join(outDir, 'laugh_naiwa.bin'), mesh.bbox, parts);
}
