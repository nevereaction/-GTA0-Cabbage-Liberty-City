import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawBase = path.resolve(root, '..', 'fourth', 'assets', 'raw assets');
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

function weldStlMesh(stl, quantRaw, rawToAligned, targetHeight, scaleOverride = null) {
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

  const scale = scaleOverride !== null ? scaleOverride : (targetHeight / (maxY - minY));
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

  const vertCount = sumX.length;
  const positions = new Float32Array(vertCount * 3);
  let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity, gMinZ = Infinity, gMaxZ = -Infinity;
  let scx = 0, scy = 0, scz = 0;
  for (let i = 0; i < vertCount; i++) {
    const px = sumX[i] / counts[i];
    const py = sumY[i] / counts[i];
    const pz = sumZ[i] / counts[i];
    positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;
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
    scale,
    bbox: [gMinX, gMaxX, gMinY, gMaxY, gMinZ, gMaxZ],
  };
}

function splitPartsWithCreaseNormals(mesh, creaseDeg, classifyTri) {
  const { positions, indices } = mesh;
  const vertCount = positions.length / 3;
  const triCount = indices.length / 3;

  const fx = new Float32Array(triCount);
  const fy = new Float32Array(triCount);
  const fz = new Float32Array(triCount);
  const ux = new Float32Array(triCount);
  const uy = new Float32Array(triCount);
  const uz = new Float32Array(triCount);
  const adj = Array.from({ length: vertCount }, () => []);

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const x0 = positions[i0 * 3], y0 = positions[i0 * 3 + 1], z0 = positions[i0 * 3 + 2];
    const ax = positions[i1 * 3] - x0, ay = positions[i1 * 3 + 1] - y0, az = positions[i1 * 3 + 2] - z0;
    const bx = positions[i2 * 3] - x0, by = positions[i2 * 3 + 1] - y0, bz = positions[i2 * 3 + 2] - z0;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const cl = Math.hypot(cx, cy, cz) || 1;
    fx[t] = cx; fy[t] = cy; fz[t] = cz;
    ux[t] = cx / cl; uy[t] = cy / cl; uz[t] = cz / cl;
    adj[i0].push(t); adj[i1].push(t); adj[i2].push(t);
  }

  const cosThresh = Math.cos((creaseDeg * Math.PI) / 180);
  const partMap = new Map();

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const mcx = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3;
    const mcy = (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3;
    const mcz = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3;
    const pid = classifyTri(mcx, mcy, mcz, ux[t], uy[t], uz[t]);

    let bucket = partMap.get(pid);
    if (!bucket) {
      bucket = { pos: [], nrm: [], idx: [], split: new Map() };
      partMap.set(pid, bucket);
    }

    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      let nx, ny, nz;
      if (creaseDeg >= 179.9) {
        nx = mesh.smoothNormals[v * 3];
        ny = mesh.smoothNormals[v * 3 + 1];
        nz = mesh.smoothNormals[v * 3 + 2];
      } else {
        let sx = 0, sy = 0, sz = 0;
        const u0x = ux[t], u0y = uy[t], u0z = uz[t];
        const list = adj[v];
        for (let ai = 0; ai < list.length; ai++) {
          const u = list[ai];
          if (u === t || (u0x * ux[u] + u0y * uy[u] + u0z * uz[u]) >= cosThresh) {
            sx += fx[u]; sy += fy[u]; sz += fz[u];
          }
        }
        const sl = Math.hypot(sx, sy, sz);
        if (sl > 1e-8) {
          nx = sx / sl; ny = sy / sl; nz = sz / sl;
        } else {
          nx = u0x; ny = u0y; nz = u0z;
        }
      }
      const key = creaseDeg >= 179.9
        ? String(v)
        : `${v}|${Math.round(nx * 64)},${Math.round(ny * 64)},${Math.round(nz * 64)}`;
      let nv = bucket.split.get(key);
      if (nv === undefined) {
        nv = bucket.pos.length / 3;
        bucket.split.set(key, nv);
        bucket.pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        bucket.nrm.push(nx, ny, nz);
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

function writeBld1File(outFile, bbox, parts) {
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
    `  Saved ${path.basename(outFile)} (${(byteLen / 1024).toFixed(1)} KB) | parts=${parts.length} [${parts.map(p => p.partId).join(',')}] | verts=${totV}, tris=${totT} | bbox X=[${bbox[0].toFixed(2)},${bbox[1].toFixed(2)}] Y=[${bbox[2].toFixed(2)},${bbox[3].toFixed(2)}] Z=[${bbox[4].toFixed(2)},${bbox[5].toFixed(2)}]`
  );
}

/* ==================== 1. 广州塔 / 小蛮腰 (市中心彩色) ==================== */
{
  console.log('\n[1/5] Building bld_canton.bin (广州塔/小蛮腰)...');
  const stl = readBinarySTL(path.join(rawBase, '广州塔', 'GZ Tower3.stl'));
  const mesh = weldStlMesh(stl, 0.28, (x, y, z) => [x, z, -y], 132.0);
  const parts = splitPartsWithCreaseNormals(mesh, 35, (px, py, pz) => {
    if (py < 3.0) return 0; // 六边形石材台基
    if (py >= 102.8) return 8; // 顶部天线桅杆
    const swirl = Math.atan2(pz, px) / (Math.PI * 2);
    const t = clamp((py - 3.0) / 99.8 + swirl * 0.10, 0, 0.9999);
    return 1 + Math.floor(t * 7); // 7 段螺旋彩虹灯带
  });
  writeBld1File(path.join(outDir, 'bld_canton.bin'), mesh.bbox, parts);
}

/* ==================== 2. 上海环球金融中心 (玻璃幕墙 + 银亮铝合金腰线 + 钛金属顶冠 + 深色石基座) ==================== */
{
  console.log('\n[2/5] Building bld_swfc.bin (上海环球金融中心)...');
  const stl = readBinarySTL(path.join(rawBase, '上海环球金融中心', 'obj_1_shanghai-financial-center-by-miniworld3d.stl'));
  const rad = (45 * Math.PI) / 180;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  const mesh = weldStlMesh(stl, 0.45, (x, y, z) => [x * ca - y * sa, z, -(x * sa + y * ca)], 118.0);
  const parts = splitPartsWithCreaseNormals(mesh, 35, (_px, py, _pz, _nx, ny) => {
    if (py < 2.8) return 1; // 深色花岗岩基座
    if (py >= 100.5 && (py >= 113.2 || Math.abs(ny) > 0.35)) return 3; // 拉丝钛银顶部风洞框与天桥冠檐
    if (Math.abs(ny) > 0.55) return 2; // 水平铝合金层间檐线与窗框肋条
    return 0; // 蓝宝石玻璃幕墙立面
  });
  writeBld1File(path.join(outDir, 'bld_swfc.bin'), mesh.bbox, parts);
}

/* ==================== 3. 东方明珠 (玫瑰粉明珠 + 香槟银塔身 + 银色桅杆 + 深灰基座) ==================== */
{
  console.log('\n[3/5] Building bld_pearl.bin (东方明珠)...');
  const stl = readBinarySTL(path.join(rawBase, '东方明珠', 'obj_1_东方明珠.stl'));
  const mesh = weldStlMesh(stl, 0.20, (x, y, z) => [x, z, -y], null, 40.0 / 58.51);
  const parts = splitPartsWithCreaseNormals(mesh, 35, (px, py, pz) => {
    if (py < 6.0) return 2; // 多层圆形石材基座
    if (py >= 86.8) return 3; // 高耸银色广播天线桅杆
    const rXZ = Math.hypot(px, pz);
    // 全部标志性东方明珠球体：下部三颗腿球、下大球、上大球、太空舱球
    if ((py >= 12.2 && py <= 15.2 && rXZ > 6.2)
      || (py >= 23.0 && py <= 37.2 && rXZ < 9.5)
      || (py >= 66.8 && py <= 77.2 && rXZ < 7.6)
      || (py >= 82.6 && py <= 86.4 && rXZ < 4.0)) {
      return 1;
    }
    return 0; // 三根斜撑、竖向筒体与中段环形观光台
  });
  writeBld1File(path.join(outDir, 'bld_pearl.bin'), mesh.bbox, parts);
}

/* ==================== 4. 金茂大厦 (青银玻璃幕墙 + 不锈钢退台檐口 + 亮银宝塔冠顶 + 深色基座) ==================== */
{
  console.log('\n[4/5] Building bld_jinmao.bin (金茂大厦)...');
  const stl = readBinarySTL(path.join(rawBase, '金茂大厦', 'obj_1_shanghai Jin Mao Tower by Vincent Zhou.stl'));
  const mesh = weldStlMesh(stl, 0.001, (x, y, z) => [x, z, -y], 104.0);
  const parts = splitPartsWithCreaseNormals(mesh, 35, (_px, py, _pz, _nx, ny) => {
    if (py < 4.5) return 1; // 深色石材裙楼基座
    if (py >= 84.5) return 3; // 宝塔形逐级收分亮银冠顶与塔尖
    if (Math.abs(ny) > 0.55) return 2; // 不锈钢退台密檐与水平加强带
    return 0; // 高反射青银玻璃幕墙立面
  });
  writeBld1File(path.join(outDir, 'bld_jinmao.bin'), mesh.bbox, parts);
}

/* ==================== 5. 奶娃公园雕像 (黄色主体 + 亮白眼白 + 亮黑眼珠) ==================== */
{
  console.log('\n[5/5] Building statue_naiwa.bin (奶娃公园雕像)...');
  const H = 5.2;
  const stl = readBinarySTL(path.join(rawBase, '奶娃', 'obj_1_奶龙.stl'));
  const rad = (26 * Math.PI) / 180;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  const mesh = weldStlMesh(stl, 0.55, (x, y, z) => [x * ca - y * sa, z, -(x * sa + y * ca)], H);
  const bodyParts = splitPartsWithCreaseNormals(mesh, 180, () => 0);

  const pos = mesh.positions;
  const nrm = mesh.smoothNormals;
  const vertCount = pos.length / 3;
  const whitePieces = [];
  const blackPieces = [];

  // 基于实测正脸网格精确坐标自动贴合左右眼睛
  const eyeSpecs = [
    { name: 'LeftEye(-X)',  tx: -0.270 * H, ty: 0.785 * H },
    { name: 'RightEye(+X)', tx:  0.035 * H, ty: 0.858 * H },
  ];

  for (const es of eyeSpecs) {
    let sx = 0, sy = 0, sz = 0, snx = 0, sny = 0, snz = 0, cnt = 0;
    for (let i = 0; i < vertCount; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (z > 0.14 * H && Math.hypot(x - es.tx, y - es.ty) < 0.055 * H) {
        sx += x; sy += y; sz += z;
        snx += nrm[i * 3]; sny += nrm[i * 3 + 1]; snz += nrm[i * 3 + 2];
        cnt++;
      }
    }
    if (cnt < 5) throw new Error(`Failed to locate vertices for statue ${es.name}`);
    const ax = sx / cnt, ay = sy / cnt, az = sz / cnt;
    const nl = Math.hypot(snx, sny, snz) || 1;
    const nx = snx / nl, ny = sny / nl, nz = snz / nl;

    let ux = nz, uy = 0, uz = -nx;
    const uLen = Math.hypot(ux, uy, uz) || 1;
    ux /= uLen; uy /= uLen; uz /= uLen;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;

    const ruS = 0.064 * H, rvS = 0.070 * H, rnS = 0.026 * H;
    let maxDn = -Infinity;
    for (let i = 0; i < vertCount; i++) {
      const dx = pos[i * 3] - ax, dy = pos[i * 3 + 1] - ay, dz = pos[i * 3 + 2] - az;
      const du = dx * ux + dy * uy + dz * uz;
      const dv = dx * vx + dy * vy + dz * vz;
      const dn = dx * nx + dy * ny + dz * nz;
      if ((du / ruS) ** 2 + (dv / rvS) ** 2 < 1.0 && Math.abs(dn) < 0.08 * H) {
        if (dn > maxDn) maxDn = dn;
      }
    }
    const clearShift = maxDn > -Infinity ? Math.max(-0.008 * H, maxDn + 0.008 * H - rnS) : 0;
    const scx = ax + nx * clearShift, scy = ay + ny * clearShift, scz = az + nz * clearShift;
    const sclera = makeOrientedEllipsoid(scx, scy, scz, ruS, rvS, rnS, nx, ny, nz, 20, 14);

    const pShift = clearShift + rnS - 0.006 * H;
    const pcx = ax + nx * pShift + ux * 0.004 * H - vx * 0.004 * H;
    const pcy = ay + ny * pShift + uy * 0.004 * H - vy * 0.004 * H;
    const pcz = az + nz * pShift + uz * 0.004 * H - vz * 0.004 * H;
    const pupil = makeOrientedEllipsoid(pcx, pcy, pcz, 0.043 * H, 0.047 * H, 0.018 * H, nx, ny, nz, 20, 14);

    // 高光小亮点（放在眼珠左上方）
    const glint = makeOrientedEllipsoid(
      pcx - ux * 0.014 * H + vx * 0.016 * H + nx * 0.014 * H,
      pcy - uy * 0.014 * H + vy * 0.016 * H + ny * 0.014 * H,
      pcz - uz * 0.014 * H + vz * 0.016 * H + nz * 0.014 * H,
      0.011 * H, 0.011 * H, 0.010 * H, nx, ny, nz, 12, 8
    );

    console.log(`  Statue ${es.name}: anchor=(${ax.toFixed(3)},${ay.toFixed(3)},${az.toFixed(3)}), norm=(${nx.toFixed(2)},${ny.toFixed(2)},${nz.toFixed(2)}), maxDn=${maxDn.toFixed(3)}, shift=${clearShift.toFixed(3)}`);
    whitePieces.push(sclera, glint);
    blackPieces.push(pupil);
  }

  const allParts = [
    ...bodyParts,
    mergeProceduralParts(1, whitePieces),
    mergeProceduralParts(2, blackPieces),
  ];
  writeBld1File(path.join(outDir, 'statue_naiwa.bin'), mesh.bbox, allParts);
}
