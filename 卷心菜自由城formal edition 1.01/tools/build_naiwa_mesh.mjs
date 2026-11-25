import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCALE = 1.72 / 27.28;
const MAGIC_ROL2 = 0x324C4F52; // "ROL2" LE

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function smoothstep(a, b, v) {
  const t = a < b
    ? clamp((v - a) / (b - a), 0, 1)
    : clamp((a - v) / (a - b), 0, 1);
  return t * t * (3 - 2 * t);
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

function parse3mfMesh(xmlBuf) {
  const xml = xmlBuf.toString('utf8');
  const vStart = xml.indexOf('<vertices>');
  const vEnd = xml.indexOf('</vertices>', vStart);
  const tStart = xml.indexOf('<triangles>', vEnd);
  const tEnd = xml.indexOf('</triangles>', tStart);
  if (vStart < 0 || vEnd < 0 || tStart < 0 || tEnd < 0) {
    throw new Error('Failed to locate <vertices> or <triangles> in 3MF model XML');
  }

  // 解析顶点
  const vXml = xml.slice(vStart, vEnd);
  const vx = [], vy = [], vz = [];
  const vRe = /<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g;
  let m;
  while ((m = vRe.exec(vXml)) !== null) {
    vx.push(Number(m[1]));
    vy.push(Number(m[2]));
    vz.push(Number(m[3]));
  }
  const origVertCount = vx.length;
  const origPos = new Float32Array(origVertCount * 3);
  for (let i = 0; i < origVertCount; i++) {
    origPos[i * 3] = vx[i];
    origPos[i * 3 + 1] = vy[i];
    origPos[i * 3 + 2] = vz[i];
  }

  // 解析三角面
  const tXml = xml.slice(tStart, tEnd);
  const tList = [];
  const tRe = /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g;
  while ((m = tRe.exec(tXml)) !== null) {
    tList.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  const origTris = new Uint32Array(tList);
  return { origPos, origTris };
}

function toGame(x, y, z) {
  return [x * SCALE, (z + 13.64) * SCALE, -y * SCALE];
}

function computeSkinWeights(positions) {
  const vertCount = positions.length / 3;
  const skinIndices = new Uint8Array(vertCount * 4);
  const skinWeights = new Float32Array(vertCount * 4);
  const boneHits = new Int32Array(7);

  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    const wHead = smoothstep(0.98, 1.16, y);
    const wTail = smoothstep(-0.32, -0.46, z) * (1 - smoothstep(0.55, 0.78, y));
    const legMask = 1 - smoothstep(0.18, 0.36, y);
    const wLegL = legMask * smoothstep(0.02, 0.16, x);
    const wLegR = legMask * smoothstep(-0.02, -0.16, x);
    const armBand = smoothstep(0.42, 0.56, y) * (1 - smoothstep(0.86, 1.00, y));
    const wArmL = armBand * smoothstep(0.36, 0.50, x);
    const wArmR = armBand * smoothstep(-0.36, -0.50, x);

    const ws = [0, wHead, wLegL, wLegR, wArmL, wArmR, wTail];
    const wApp = wHead + wLegL + wLegR + wArmL + wArmR + wTail;
    if (wApp > 1) {
      for (let b = 1; b < 7; b++) ws[b] /= wApp;
      ws[0] = 0;
    } else {
      ws[0] = 1 - wApp;
    }

    const pairs = ws.map((w, b) => [b, w]).sort((a, b) => b[1] - a[1]);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += pairs[k][1];
    if (sum < 1e-6) {
      skinIndices[i * 4] = 0;
      skinWeights[i * 4] = 1;
      boneHits[0]++;
    } else {
      for (let k = 0; k < 4; k++) {
        const b = pairs[k][0];
        const w = pairs[k][1] / sum;
        skinIndices[i * 4 + k] = b;
        skinWeights[i * 4 + k] = w;
        if (w > 0.1) boneHits[b]++;
      }
    }
  }
  return { skinIndices, skinWeights, boneHits };
}

function bindHeadOnly(vertCount) {
  const skinIndices = new Uint8Array(vertCount * 4);
  const skinWeights = new Float32Array(vertCount * 4);
  for (let i = 0; i < vertCount; i++) {
    skinIndices[i * 4] = 1; // Bone 1 = head
    skinWeights[i * 4] = 1;
  }
  return { skinIndices, skinWeights };
}

function makeOrientedEllipsoid(cx, cy, cz, ru, rv, rn, nx, ny, nz, segU = 18, segV = 12) {
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const Nx = nx / nLen, Ny = ny / nLen, Nz = nz / nLen;
  // U = normalize(cross([0, 1, 0], N)) = normalize([Nz, 0, -Nx])
  let Ux = Nz, Uy = 0, Uz = -Nx;
  const uLen = Math.hypot(Ux, Uy, Uz) || 1;
  Ux /= uLen; Uy /= uLen; Uz /= uLen;
  // V = cross(N, U)
  const Vx = Ny * Uz - Nz * Uy;
  const Vy = Nz * Ux - Nx * Uz;
  const Vz = Nx * Uy - Ny * Ux;

  const pos = [];
  const norm = [];
  const idx = [];
  const stride = segU + 1;

  for (let iv = 0; iv <= segV; iv++) {
    const phi = -Math.PI / 2 + (iv / segV) * Math.PI;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    for (let iu = 0; iu <= segU; iu++) {
      const th = (iu / segU) * Math.PI * 2;
      const ct = Math.cos(th), st = Math.sin(th);
      const lu = cp * ct * ru;
      const lv = sp * rv;
      const ln = cp * st * rn;

      pos.push(
        cx + Ux * lu + Vx * lv + Nx * ln,
        cy + Uy * lu + Vy * lv + Ny * ln,
        cz + Uz * lu + Vz * lv + Nz * ln
      );

      const gnx = (cp * ct) / ru;
      const gny = sp / rv;
      const gnz = (cp * st) / rn;
      const wx = Ux * gnx + Vx * gny + Nx * gnz;
      const wy = Uy * gnx + Vy * gny + Ny * gnz;
      const wz = Uz * gnx + Vz * gny + Nz * gnz;
      const wl = Math.hypot(wx, wy, wz) || 1;
      norm.push(wx / wl, wy / wl, wz / wl);
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if (iv !== 0) idx.push(a, c, b);
      if (iv !== segV - 1) idx.push(b, c, d);
    }
  }

  // 校验三角形绕序与局部法线一致朝外
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

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    indices: new Uint32Array(idx),
  };
}

function mergeMeshParts(list) {
  let totalVerts = 0, totalIdx = 0;
  for (const m of list) {
    totalVerts += m.positions.length / 3;
    totalIdx += m.indices.length;
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIdx);
  let vOff = 0, iOff = 0;
  for (const m of list) {
    positions.set(m.positions, vOff * 3);
    normals.set(m.normals, vOff * 3);
    for (let k = 0; k < m.indices.length; k++) {
      indices[iOff + k] = m.indices[k] + vOff;
    }
    vOff += m.positions.length / 3;
    iOff += m.indices.length;
  }
  const { skinIndices, skinWeights } = bindHeadOnly(totalVerts);
  return { positions, normals, skinIndices, skinWeights, indices };
}

const xmlBuf = readZipEntry(path.join(root, 'targetted role', 'naiwa', '奶龙.3mf'), '3D/Objects/object_1.model');
const { origPos, origTris } = parse3mfMesh(xmlBuf);
const origVertCount = origPos.length / 3;
const origTriCount = origTris.length / 3;
console.log(`Parsed 3MF object_1: origVerts=${origVertCount}, origTris=${origTriCount}`);

const VOXEL = 0.52;
const vox = VOXEL * SCALE;
const buckets = new Map();
const sumX = [], sumY = [], sumZ = [], counts = [];
const oldToNew = new Uint32Array(origVertCount);

for (let i = 0; i < origVertCount; i++) {
  const [gx, gy, gz] = toGame(origPos[i * 3], origPos[i * 3 + 1], origPos[i * 3 + 2]);
  const bx = Math.floor(gx / vox);
  const by = Math.floor(gy / vox);
  const bz = Math.floor(gz / vox);
  const key = `${bx},${by},${bz}`;
  let idx = buckets.get(key);
  if (idx === undefined) {
    idx = sumX.length;
    buckets.set(key, idx);
    sumX.push(0); sumY.push(0); sumZ.push(0); counts.push(0);
  }
  sumX[idx] += gx; sumY[idx] += gy; sumZ[idx] += gz; counts[idx]++;
  oldToNew[i] = idx;
}

const vertCount = sumX.length;
const positions = new Float32Array(vertCount * 3);
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
let sumCx = 0, sumCy = 0, sumCz = 0;
for (let i = 0; i < vertCount; i++) {
  const px = sumX[i] / counts[i];
  const py = sumY[i] / counts[i];
  const pz = sumZ[i] / counts[i];
  positions[i * 3] = px;
  positions[i * 3 + 1] = py;
  positions[i * 3 + 2] = pz;
  sumCx += px; sumCy += py; sumCz += pz;
  if (px < minX) minX = px; if (px > maxX) maxX = px;
  if (py < minY) minY = py; if (py > maxY) maxY = py;
  if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
}

const idxList = [];
for (let i = 0; i < origTriCount; i++) {
  const i0 = oldToNew[origTris[i * 3]];
  const i1 = oldToNew[origTris[i * 3 + 1]];
  const i2 = oldToNew[origTris[i * 3 + 2]];
  if (i0 === i1 || i1 === i2 || i2 === i0) continue;
  idxList.push(i0, i1, i2);
}
const indices = new Uint32Array(idxList);

const normals = new Float32Array(vertCount * 3);
for (let t = 0; t < indices.length; t += 3) {
  const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
  const x0 = positions[i0 * 3], y0 = positions[i0 * 3 + 1], z0 = positions[i0 * 3 + 2];
  const ax = positions[i1 * 3] - x0, ay = positions[i1 * 3 + 1] - y0, az = positions[i1 * 3 + 2] - z0;
  const bx = positions[i2 * 3] - x0, by = positions[i2 * 3 + 1] - y0, bz = positions[i2 * 3 + 2] - z0;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  for (const idx of [i0, i1, i2]) {
    normals[idx * 3] += nx;
    normals[idx * 3 + 1] += ny;
    normals[idx * 3 + 2] += nz;
  }
}
for (let i = 0; i < vertCount; i++) {
  const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
  const len = Math.hypot(nx, ny, nz);
  if (len > 1e-8) {
    normals[i * 3] = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;
  } else {
    normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;
  }
}

// 校验平均法线朝外
const cx = sumCx / vertCount, cy = sumCy / vertCount, cz = sumCz / vertCount;
let dotSum = 0;
for (let i = 0; i < vertCount; i++) {
  dotSum += (positions[i * 3] - cx) * normals[i * 3]
    + (positions[i * 3 + 1] - cy) * normals[i * 3 + 1]
    + (positions[i * 3 + 2] - cz) * normals[i * 3 + 2];
}
if (dotSum < 0) {
  console.log('Flipping inward normals / triangle winding...');
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
  }
  for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
} else {
  console.log(`Outward normals verified (avg dot=${(dotSum / vertCount).toFixed(4)})`);
}

const { skinIndices, skinWeights, boneHits } = computeSkinWeights(positions);
const BONE_NAMES = ['torso', 'head', 'legL', 'legR', 'armL', 'armR', 'tail'];
console.log('Naiwa bone coverage (>0.1 weight):', BONE_NAMES.map((bn, bi) => `${bn}=${boneHits[bi]}`).join(', '));

// 构建贴合奶龙雕琢眼窝的白色眼白 + 黑色眼珠 + 眼神高光（100% 绑定至 head 骨骼）
const parts = [{ partId: 0, positions, normals, skinIndices, skinWeights, indices }];
for (const s of [1, -1]) {
  const nLen = Math.hypot(0.422, 0.101, 0.901);
  const nx = (0.422 * s) / nLen, ny = 0.101 / nLen, nz = 0.901 / nLen;
  let ux = nz, uy = 0, uz = -nx;
  const uLen = Math.hypot(ux, uy, uz) || 1;
  ux /= uLen; uy /= uLen; uz /= uLen;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  // 检查体素化后的身体顶点在眼球区域沿法线方向的最高点，确保不穿模露黄
  const sx0 = s * 0.190, sy0 = 1.466, sz0 = 0.415;
  const ruS = 0.068, rvS = 0.080, rnS = 0.032;
  let maxBodyDot = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const dx = positions[i * 3] - sx0;
    const dy = positions[i * 3 + 1] - sy0;
    const dz = positions[i * 3 + 2] - sz0;
    const du = dx * ux + dy * uy + dz * uz;
    const dv = dx * vx + dy * vy + dz * vz;
    const dn = dx * nx + dy * ny + dz * nz;
    if ((du / ruS) ** 2 + (dv / rvS) ** 2 < 1.0 && Math.abs(dn) < 0.08) {
      if (dn > maxBodyDot) maxBodyDot = dn;
    }
  }
  // 确保眼白前沿高于身体最高点至少 +0.010，瞳孔前沿高于眼白至少 +0.010
  const scleraShift = maxBodyDot > -Infinity ? Math.max(0, maxBodyDot + 0.011 - rnS) : 0;
  const scx = sx0 + nx * scleraShift;
  const scy = sy0 + ny * scleraShift;
  const scz = sz0 + nz * scleraShift;

  const pcx = s * 0.192 + nx * (scleraShift + 0.004);
  const pcy = 1.454 + ny * (scleraShift + 0.004);
  const pcz = 0.431 + nz * (scleraShift + 0.004);

  const sclera = makeOrientedEllipsoid(scx, scy, scz, ruS, rvS, rnS, nx, ny, nz, 20, 14);
  const glint = makeOrientedEllipsoid(
    pcx - 0.018 + vx * 0.022 + nx * 0.020,
    pcy + vy * 0.022 + ny * 0.020,
    pcz + vz * 0.022 + nz * 0.020,
    0.013, 0.013, 0.013, nx, ny, nz, 12, 8
  );
  const pupil = makeOrientedEllipsoid(pcx, pcy, pcz, 0.049, 0.056, 0.022, nx, ny, nz, 20, 14);

  console.log(
    `Eye (${s > 0 ? '+X' : '-X'}) bodyMaxDn=${maxBodyDot.toFixed(4)} scleraShift=${scleraShift.toFixed(4)} | scleraFrontDn=${((scx - sx0) * nx + (scy - sy0) * ny + (scz - sz0) * nz + rnS).toFixed(4)}`
  );

  const whitePart = mergeMeshParts([sclera, glint]);
  const blackPart = mergeMeshParts([pupil]);
  parts.push({ partId: s > 0 ? 2 : 3, ...whitePart });
  parts.push({ partId: s > 0 ? 4 : 5, ...blackPart });
}

// 写出 ROL2 格式 assets/naiwa_role.bin
const outDir = path.join(root, 'assets');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'naiwa_role.bin');
let byteLen = 8;
for (const p of parts) {
  byteLen += 12 + p.positions.byteLength + p.normals.byteLength + p.skinIndices.byteLength + p.skinWeights.byteLength + p.indices.byteLength;
}
const outBuf = Buffer.allocUnsafe(byteLen);
let off = 0;
outBuf.writeUInt32LE(MAGIC_ROL2, off); off += 4;
outBuf.writeUInt32LE(parts.length, off); off += 4;
for (const p of parts) {
  const vc = p.positions.length / 3;
  outBuf.writeUInt32LE(p.partId, off); off += 4;
  outBuf.writeUInt32LE(vc, off); off += 4;
  outBuf.writeUInt32LE(p.indices.length, off); off += 4;
  Buffer.from(p.positions.buffer, p.positions.byteOffset, p.positions.byteLength).copy(outBuf, off); off += p.positions.byteLength;
  Buffer.from(p.normals.buffer, p.normals.byteOffset, p.normals.byteLength).copy(outBuf, off); off += p.normals.byteLength;
  Buffer.from(p.skinIndices.buffer, p.skinIndices.byteOffset, p.skinIndices.byteLength).copy(outBuf, off); off += p.skinIndices.byteLength;
  Buffer.from(p.skinWeights.buffer, p.skinWeights.byteOffset, p.skinWeights.byteLength).copy(outBuf, off); off += p.skinWeights.byteLength;
  Buffer.from(p.indices.buffer, p.indices.byteOffset, p.indices.byteLength).copy(outBuf, off); off += p.indices.byteLength;
}
if (off !== byteLen) throw new Error(`Byte length mismatch: off=${off} vs ${byteLen}`);
fs.writeFileSync(outFile, outBuf);

const totalVerts = parts.reduce((s, p) => s + p.positions.length / 3, 0);
const totalTris = parts.reduce((s, p) => s + p.indices.length / 3, 0);
console.log(
  `Saved ${outFile}: ${(byteLen / 1024).toFixed(1)} KB | parts=${parts.length} | verts=${totalVerts}, tris=${totalTris} | Game bbox X=[${minX.toFixed(3)}, ${maxX.toFixed(3)}] Y=[${minY.toFixed(3)}, ${maxY.toFixed(3)}] Z=[${minZ.toFixed(3)}, ${maxZ.toFixed(3)}]`
);
