// 3D 雕塑与角色网格拓扑修复、平滑与自适应贴合管线 (Formal Edition 1.01)
// 直接读取并原地优化 assets/*.bin (BLD2 / ROL5)，无需依赖任何外部开发目录
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'assets');

const MAGIC_BLD2 = 0x32444C42;
const MAGIC_ROL5 = 0x354C4F52;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const copyAB = (buf, off, len) => Uint8Array.from(buf.subarray(off, off + len)).buffer;

function readAsset(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.readUInt32LE(0);
  if (magic !== MAGIC_BLD2 && magic !== MAGIC_ROL5) {
    throw new Error(`Unsupported magic 0x${magic.toString(16)} in ${filePath}`);
  }
  const isRol = magic === MAGIC_ROL5;
  const partCount = buf.readUInt32LE(4);
  let off = 8;
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const partId = buf.readUInt32LE(off);
    const vc = buf.readUInt32LE(off + 4);
    const ic = buf.readUInt32LE(off + 8);
    const fl = buf.readUInt32LE(off + 12);
    const b = [];
    for (let k = 0; k < 6; k++) b.push(buf.readFloatLE(off + 16 + k * 4));
    off += 40;

    const qPos = new Uint16Array(copyAB(buf, off, vc * 6));
    off += vc * 6;
    const pos = new Float32Array(vc * 3);
    const sx = (b[3] - b[0]) / 65535;
    const sy = (b[4] - b[1]) / 65535;
    const sz = (b[5] - b[2]) / 65535;
    for (let v = 0; v < vc * 3; v += 3) {
      pos[v] = b[0] + qPos[v] * sx;
      pos[v + 1] = b[1] + qPos[v + 1] * sy;
      pos[v + 2] = b[2] + qPos[v + 2] * sz;
    }

    const qNrm = new Int8Array(copyAB(buf, off, vc * 3));
    off += vc * 3;
    const nrm = new Float32Array(vc * 3);
    for (let j = 0; j < nrm.length; j++) nrm[j] = qNrm[j] / 127;

    let uv = null, skI = null, skW = null, idx;
    if (isRol) {
      const hasUV = (fl & 1) !== 0;
      const wide = (fl & 2) !== 0;
      if (hasUV) {
        const qUV = new Uint16Array(copyAB(buf, off, vc * 4));
        off += vc * 4;
        uv = new Float32Array(vc * 2);
        for (let j = 0; j < uv.length; j++) uv[j] = qUV[j] / 65535;
      }
      skI = new Uint8Array(buf.subarray(off, off + vc * 4));
      off += vc * 4;
      const qW = new Uint8Array(buf.subarray(off, off + vc * 4));
      off += vc * 4;
      skW = new Float32Array(vc * 4);
      for (let j = 0; j < skW.length; j++) skW[j] = qW[j] / 255;
      const idxBytes = ic * (wide ? 4 : 2);
      idx = wide ? new Uint32Array(copyAB(buf, off, idxBytes)) : new Uint16Array(copyAB(buf, off, idxBytes));
      off += idxBytes;
    } else {
      const idxBytes = ic * fl;
      idx = fl === 4 ? new Uint32Array(copyAB(buf, off, idxBytes)) : new Uint16Array(copyAB(buf, off, idxBytes));
      off += idxBytes;
    }
    parts.push({ partId, vc, pos, nrm, uv, skI, skW, idx, bbox: b });
  }
  if (off !== buf.length) throw new Error(`EOF mismatch in ${filePath}: ${off} !== ${buf.length}`);
  return { isRol, parts };
}

function bboxOf(pos) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < b[k]) b[k] = v;
      if (v > b[k + 3]) b[k + 3] = v;
    }
  }
  return b;
}

function quantPos(pos, b) {
  const q = new Uint16Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const span = b[k + 3] - b[k] || 1;
      q[i + k] = Math.round(clamp((pos[i + k] - b[k]) / span, 0, 1) * 65535);
    }
  }
  return q;
}

function quantNrm(n) {
  const q = new Int8Array(n.length);
  for (let i = 0; i < n.length; i++) q[i] = Math.round(clamp(n[i], -1, 1) * 127);
  return q;
}

function quantWeights(w) {
  const q = new Uint8Array(w.length);
  for (let v = 0; v < w.length; v += 4) {
    let sum = 0, big = 0;
    for (let k = 0; k < 4; k++) {
      q[v + k] = Math.round(clamp(w[v + k], 0, 1) * 255);
      sum += q[v + k];
      if (w[v + k] > w[v + big]) big = k;
    }
    q[v + big] = clamp(q[v + big] + (255 - sum), 0, 255);
  }
  return q;
}

const uBuf = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function writeAsset(filePath, isRol, parts) {
  parts.sort((a, b) => a.partId - b.partId);
  const chunks = [];
  const head = Buffer.alloc(8);
  head.writeUInt32LE(isRol ? MAGIC_ROL5 : MAGIC_BLD2, 0);
  head.writeUInt32LE(parts.length, 4);
  chunks.push(head);
  for (const p of parts) {
    const vc = p.pos.length / 3;
    const b = bboxOf(p.pos);
    const wide = vc > 65535;
    const h = Buffer.alloc(40);
    h.writeUInt32LE(p.partId, 0);
    h.writeUInt32LE(vc, 4);
    h.writeUInt32LE(p.idx.length, 8);
    if (isRol) {
      const flags = (p.uv ? 1 : 0) | (wide ? 2 : 0);
      h.writeUInt32LE(flags, 12);
    } else {
      h.writeUInt32LE(wide ? 4 : 2, 12);
    }
    for (let k = 0; k < 6; k++) h.writeFloatLE(b[k], 16 + k * 4);
    chunks.push(h, uBuf(quantPos(p.pos, b)), uBuf(quantNrm(p.nrm)));
    if (isRol) {
      if (p.uv) {
        const qUV = new Uint16Array(p.uv.length);
        for (let i = 0; i < qUV.length; i++) qUV[i] = Math.round(clamp(p.uv[i], 0, 1) * 65535);
        chunks.push(uBuf(qUV));
      }
      chunks.push(uBuf(p.skI), uBuf(quantWeights(p.skW)));
    }
    chunks.push(uBuf(wide ? new Uint32Array(p.idx) : new Uint16Array(p.idx)));
  }
  const out = Buffer.concat(chunks);
  fs.writeFileSync(filePath, out);
  return out.length;
}

function measureQuality(parts, targetPartIds) {
  let tris = 0, invDot = 0, roughDot = 0, nonMani = 0, bndEdges = 0;
  const edgeCnt = new Map();
  const posMap = new Map();
  let uvc = 0;
  const targets = parts.filter(p => targetPartIds.includes(p.partId));
  for (const p of targets) {
    const vm = new Int32Array(p.vc);
    for (let i = 0; i < p.vc; i++) {
      const k = `${Math.round(p.pos[i * 3] * 8000)},${Math.round(p.pos[i * 3 + 1] * 8000)},${Math.round(p.pos[i * 3 + 2] * 8000)}`;
      let id = posMap.get(k);
      if (id === undefined) { id = uvc++; posMap.set(k, id); }
      vm[i] = id;
    }
    for (let t = 0; t < p.idx.length; t += 3) {
      tris++;
      const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2];
      const ax = p.pos[b * 3] - p.pos[a * 3], ay = p.pos[b * 3 + 1] - p.pos[a * 3 + 1], az = p.pos[b * 3 + 2] - p.pos[a * 3 + 2];
      const bx = p.pos[c * 3] - p.pos[a * 3], by = p.pos[c * 3 + 1] - p.pos[a * 3 + 1], bz = p.pos[c * 3 + 2] - p.pos[a * 3 + 2];
      const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      const fl = Math.hypot(fx, fy, fz);
      if (fl > 1e-10) {
        const dot = (fx / fl) * p.nrm[a * 3] + (fy / fl) * p.nrm[a * 3 + 1] + (fz / fl) * p.nrm[a * 3 + 2];
        if (dot < 0) invDot++;
        if (dot < 0.5) roughDot++;
      }
      const ua = vm[a], ub = vm[b], uc = vm[c];
      for (const [u, v] of [[ua, ub], [ub, uc], [uc, ua]]) {
        const k = u < v ? `${u}_${v}` : `${v}_${u}`;
        edgeCnt.set(k, (edgeCnt.get(k) || 0) + 1);
      }
    }
  }
  for (const c of edgeCnt.values()) {
    if (c === 1) bndEdges++;
    else if (c > 2) nonMani++;
  }
  return { tris, invDot, roughDot, nonMani, bndEdges };
}

function edgeKey(u, v) {
  return u < v ? u * 1000003 + v : v * 1000003 + u;
}

function computeUnifiedNormals(uPos, tris) {
  const uvc = uPos.length / 3;
  const uNrm = new Float32Array(uvc * 3);
  for (const t of tris) {
    const a = t.u[0], b = t.u[1], c = t.u[2];
    const ax0 = uPos[a * 3], ay0 = uPos[a * 3 + 1], az0 = uPos[a * 3 + 2];
    const bx0 = uPos[b * 3], by0 = uPos[b * 3 + 1], bz0 = uPos[b * 3 + 2];
    const cx0 = uPos[c * 3], cy0 = uPos[c * 3 + 1], cz0 = uPos[c * 3 + 2];

    const abx = bx0 - ax0, aby = by0 - ay0, abz = bz0 - az0;
    const acx = cx0 - ax0, acy = cy0 - ay0, acz = cz0 - az0;
    const fx = aby * acz - abz * acy;
    const fy = abz * acx - abx * acz;
    const fz = abx * acy - aby * acx;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-10) continue;
    const unx = fx / fl, uny = fy / fl, unz = fz / fl;

    const corners = [
      [a, abx, aby, abz, acx, acy, acz],
      [b, cx0 - bx0, cy0 - by0, cz0 - bz0, -abx, -aby, -abz],
      [c, -acx, -acy, -acz, bx0 - cx0, by0 - cy0, bz0 - cz0],
    ];
    for (const [vid, ex, ey, ez, gx, gy, gz] of corners) {
      const len1 = Math.hypot(ex, ey, ez), len2 = Math.hypot(gx, gy, gz);
      if (len1 < 1e-9 || len2 < 1e-9) continue;
      const cosT = clamp((ex * gx + ey * gy + ez * gz) / (len1 * len2), -1, 1);
      const ang = Math.acos(cosT);
      uNrm[vid * 3] += unx * ang;
      uNrm[vid * 3 + 1] += uny * ang;
      uNrm[vid * 3 + 2] += unz * ang;
    }
  }
  for (let i = 0; i < uvc; i++) {
    const nx = uNrm[i * 3], ny = uNrm[i * 3 + 1], nz = uNrm[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-9 && Number.isFinite(nl)) { uNrm[i * 3] = nx / nl; uNrm[i * 3 + 1] = ny / nl; uNrm[i * 3 + 2] = nz / nl; }
    else { uNrm[i * 3] = 0; uNrm[i * 3 + 1] = 1; uNrm[i * 3 + 2] = 0; }
  }
  return uNrm;
}

// 将指定 partId 列表焊接为统一网格，在不删除任何正常表面三角形的前提下执行保细节几何平滑与法线场平滑
function processOrganicParts(asset, targetPartIds, opts) {
  const targetSet = new Set(targetPartIds);
  const targets = asset.parts.filter(p => targetSet.has(p.partId));
  const others = asset.parts.filter(p => !targetSet.has(p.partId));

  const gb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of targets) {
    for (let i = 0; i < p.vc; i++) {
      for (let k = 0; k < 3; k++) {
        const v = p.pos[i * 3 + k];
        if (v < gb[k]) gb[k] = v;
        if (v > gb[k + 3]) gb[k + 3] = v;
      }
    }
  }
  const diag = Math.hypot(gb[3] - gb[0], gb[4] - gb[1], gb[5] - gb[2]) || 1;
  const minY = gb[1], maxY = gb[4], H = maxY - minY;
  const eps = diag * (opts.weldEps || 1.5e-4);

  const buckets = new Map();
  const sumX = [], sumY = [], sumZ = [], counts = [];
  const uAttr = [];
  const attrPool = [];
  const partAttrMap = new Map();

  for (const p of targets) {
    const map = new Int32Array(p.vc);
    for (let i = 0; i < p.vc; i++) {
      const px = p.pos[i * 3], py = p.pos[i * 3 + 1], pz = p.pos[i * 3 + 2];
      const key = `${Math.round(px / eps)},${Math.round(py / eps)},${Math.round(pz / eps)}`;
      let uid = buckets.get(key);
      if (uid === undefined) {
        uid = sumX.length;
        buckets.set(key, uid);
        sumX.push(0); sumY.push(0); sumZ.push(0); counts.push(0);
        uAttr.push({ skI: p.skI ? p.skI.subarray(i * 4, i * 4 + 4) : null, skW: p.skW ? Float32Array.from(p.skW.subarray(i * 4, i * 4 + 4)) : null });
      }
      sumX[uid] += px; sumY[uid] += py; sumZ[uid] += pz; counts[uid]++;
      const aid = attrPool.length;
      attrPool.push({
        u: uid,
        uv: p.uv ? [p.uv[i * 2], p.uv[i * 2 + 1]] : null,
      });
      map[i] = aid;
    }
    partAttrMap.set(p.partId, map);
  }

  const uvc = sumX.length;
  const uPos = new Float32Array(uvc * 3);
  for (let i = 0; i < uvc; i++) {
    uPos[i * 3] = sumX[i] / counts[i];
    uPos[i * 3 + 1] = sumY[i] / counts[i];
    uPos[i * 3 + 2] = sumZ[i] / counts[i];
  }

  let tris = [];
  for (const p of targets) {
    const map = partAttrMap.get(p.partId);
    for (let t = 0; t < p.idx.length; t += 3) {
      const a0 = map[p.idx[t]], a1 = map[p.idx[t + 1]], a2 = map[p.idx[t + 2]];
      const u0 = attrPool[a0].u, u1 = attrPool[a1].u, u2 = attrPool[a2].u;
      if (u0 === u1 || u1 === u2 || u2 === u0) continue;
      tris.push({ u: [u0, u1, u2], a: [a0, a1, a2], partId: p.partId, dead: false });
    }
  }

  // 仅去除完全同向重复的零厚重叠面，绝不删减正常流形表面
  const seenDir = new Set();
  for (const t of tris) {
    const [u0, u1, u2] = t.u;
    const minU = Math.min(u0, u1, u2);
    const cyc = minU === u0 ? `${u0},${u1},${u2}` : minU === u1 ? `${u1},${u2},${u0}` : `${u2},${u0},${u1}`;
    if (seenDir.has(cyc)) t.dead = true;
    else seenDir.add(cyc);
  }
  tris = tris.filter(t => !t.dead);

  const adj = Array.from({ length: uvc }, () => new Set());
  for (let ti = 0; ti < tris.length; ti++) {
    const [a, b, c] = tris[ti].u;
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }

  // 孤立单面杂色清理（仅修正 3 条邻边都被同一种其它材质完全包围的孤立碎面）
  if (opts.fixSpecklesOnly) {
    const edgeToTris = new Map();
    for (let ti = 0; ti < tris.length; ti++) {
      const [u0, u1, u2] = tris[ti].u;
      for (const [e0, e1] of [[u0, u1], [u1, u2], [u2, u0]]) {
        const ek = edgeKey(e0, e1);
        let l = edgeToTris.get(ek);
        if (!l) { l = []; edgeToTris.set(ek, l); }
        l.push(ti);
      }
    }
    const nextIds = tris.map(t => t.partId);
    for (let ti = 0; ti < tris.length; ti++) {
      const [u0, u1, u2] = tris[ti].u;
      const cnt = new Map();
      for (const [e0, e1] of [[u0, u1], [u1, u2], [u2, u0]]) {
        for (const ni of edgeToTris.get(edgeKey(e0, e1))) {
          if (ni === ti) continue;
          const pid = tris[ni].partId;
          cnt.set(pid, (cnt.get(pid) || 0) + 1);
        }
      }
      const curCnt = cnt.get(tris[ti].partId) || 0;
      let bestPid = tris[ti].partId, bestCnt = 0;
      for (const [pid, c] of cnt.entries()) {
        if (c > bestCnt) { bestCnt = c; bestPid = pid; }
      }
      if (curCnt === 0 && bestCnt >= 2) nextIds[ti] = bestPid;
    }
    for (let ti = 0; ti < tris.length; ti++) tris[ti].partId = nextIds[ti];
  }

  // 基于最短邻边比例的温和保体积 Taubin 平滑（防止大跨度三角形拉扯局部细节产生凸包鼓包）
  const minEdge = new Float32Array(uvc);
  for (let i = 0; i < uvc; i++) {
    let me = Infinity;
    const ix = uPos[i * 3], iy = uPos[i * 3 + 1], iz = uPos[i * 3 + 2];
    for (const j of adj[i]) {
      const d = Math.hypot(uPos[j * 3] - ix, uPos[j * 3 + 1] - iy, uPos[j * 3 + 2] - iz);
      if (d > 1e-6 && d < me) me = d;
    }
    minEdge[i] = me === Infinity ? 0 : me;
  }

  const tmpPos = new Float32Array(uvc * 3);
  const taubinPass = (factor, pinFoot = false, pinBelow = null) => {
    for (let i = 0; i < uvc; i++) {
      const nbrs = adj[i];
      const px = uPos[i * 3], py = uPos[i * 3 + 1], pz = uPos[i * 3 + 2];
      if (!nbrs.size || (pinFoot && py < minY + 0.008 * H) || (pinBelow !== null && py < pinBelow)) {
        tmpPos[i * 3] = px; tmpPos[i * 3 + 1] = py; tmpPos[i * 3 + 2] = pz;
        continue;
      }
      let sx = 0, sy = 0, sz = 0, wsum = 0;
      for (const j of nbrs) {
        const jx = uPos[j * 3], jy = uPos[j * 3 + 1], jz = uPos[j * 3 + 2];
        const el = Math.hypot(jx - px, jy - py, jz - pz);
        const w = 1 / (el + 1e-4);
        sx += jx * w; sy += jy * w; sz += jz * w; wsum += w;
      }
      if (wsum <= 0) {
        tmpPos[i * 3] = px; tmpPos[i * 3 + 1] = py; tmpPos[i * 3 + 2] = pz;
        continue;
      }
      let dx = factor * (sx / wsum - px);
      let dy = factor * (sy / wsum - py);
      let dz = factor * (sz / wsum - pz);
      const maxMove = 0.12 * minEdge[i];
      const dl = Math.hypot(dx, dy, dz);
      if (dl > maxMove && dl > 1e-9) {
        const s = maxMove / dl;
        dx *= s; dy *= s; dz *= s;
      }
      tmpPos[i * 3] = px + dx; tmpPos[i * 3 + 1] = py + dy; tmpPos[i * 3 + 2] = pz + dz;
    }
    uPos.set(tmpPos);
  };
  for (let p = 0; p < (opts.taubinIters || 0); p++) {
    taubinPass(opts.lambda, opts.pinFoot, opts.pinBelow ?? null);
    taubinPass(opts.mu, opts.pinFoot, opts.pinBelow ?? null);
  }

  // 蒙皮权重平滑与跨 UV 缝统一（ROL5）
  if (asset.isRol && opts.smoothSkinIters > 0) {
    const wTmp = new Float32Array(uvc * 4);
    const iTmp = new Uint8Array(uvc * 4);
    for (let pass = 0; pass < opts.smoothSkinIters; pass++) {
      for (let i = 0; i < uvc; i++) {
        const nbrs = adj[i];
        const acc = new Float32Array(12);
        const addWeight = (skI, skW, scale) => {
          if (!skI || !skW) return;
          for (let k = 0; k < 4; k++) acc[skI[k]] += skW[k] * scale;
        };
        addWeight(uAttr[i].skI, uAttr[i].skW, 1.0);
        const nScale = nbrs.size ? (0.45 / nbrs.size) : 0;
        for (const j of nbrs) addWeight(uAttr[j].skI, uAttr[j].skW, nScale);

        const pairs = [];
        for (let b = 0; b < 12; b++) if (acc[b] > 1e-6) pairs.push([b, acc[b]]);
        pairs.sort((a, b) => b[1] - a[1]);
        let sum = 0;
        for (let k = 0; k < Math.min(4, pairs.length); k++) sum += pairs[k][1];
        for (let k = 0; k < 4; k++) {
          if (k < pairs.length && sum > 1e-6) {
            iTmp[i * 4 + k] = pairs[k][0];
            wTmp[i * 4 + k] = pairs[k][1] / sum;
          } else {
            iTmp[i * 4 + k] = 0;
            wTmp[i * 4 + k] = 0;
          }
        }
      }
      for (let i = 0; i < uvc; i++) {
        uAttr[i].skI = Uint8Array.from(iTmp.subarray(i * 4, i * 4 + 4));
        uAttr[i].skW = Float32Array.from(wTmp.subarray(i * 4, i * 4 + 4));
      }
    }
  }

  // 计算按张角加权的光滑法线 + 保折痕法线场平滑（保持轮廓锐利而不塌陷，曲面着色细腻无棱角）
  let uNrm = computeUnifiedNormals(uPos, tris);
  const nPasses = opts.normalSmoothIters !== undefined ? opts.normalSmoothIters : 3;
  const nTmp = new Float32Array(uNrm.length);
  for (let np = 0; np < nPasses; np++) {
    for (let i = 0; i < uvc; i++) {
      const nix = uNrm[i * 3], niy = uNrm[i * 3 + 1], niz = uNrm[i * 3 + 2];
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (const j of adj[i]) {
        const njx = uNrm[j * 3], njy = uNrm[j * 3 + 1], njz = uNrm[j * 3 + 2];
        const dot = nix * njx + niy * njy + niz * njz;
        if (dot >= 0.35) {
          ax += njx; ay += njy; az += njz; cnt++;
        }
      }
      if (cnt > 0) {
        const mx = nix * 0.55 + (ax / cnt) * 0.45;
        const my = niy * 0.55 + (ay / cnt) * 0.45;
        const mz = niz * 0.55 + (az / cnt) * 0.45;
        const ml = Math.hypot(mx, my, mz) || 1;
        nTmp[i * 3] = mx / ml; nTmp[i * 3 + 1] = my / ml; nTmp[i * 3 + 2] = mz / ml;
      } else {
        nTmp[i * 3] = nix; nTmp[i * 3 + 1] = niy; nTmp[i * 3 + 2] = niz;
      }
    }
    uNrm.set(nTmp);
  }

  const partMap = new Map();
  for (const t of tris) {
    let bucket = partMap.get(t.partId);
    if (!bucket) {
      bucket = { pos: [], nrm: [], uv: asset.isRol && targets[0].uv ? [] : null, skI: asset.isRol ? [] : null, skW: asset.isRol ? [] : null, idx: [], remap: new Map() };
      partMap.set(t.partId, bucket);
    }
    for (let k = 0; k < 3; k++) {
      const aid = t.a[k];
      const attr = attrPool[aid];
      const uid = attr.u;
      const key = attr.uv ? `${uid}|${Math.round(attr.uv[0] * 65535)},${Math.round(attr.uv[1] * 65535)}` : String(uid);
      let nv = bucket.remap.get(key);
      if (nv === undefined) {
        nv = bucket.pos.length / 3;
        bucket.remap.set(key, nv);
        bucket.pos.push(uPos[uid * 3], uPos[uid * 3 + 1], uPos[uid * 3 + 2]);
        bucket.nrm.push(uNrm[uid * 3], uNrm[uid * 3 + 1], uNrm[uid * 3 + 2]);
        if (bucket.uv) bucket.uv.push(attr.uv[0], attr.uv[1]);
        if (bucket.skI) {
          const ua = uAttr[uid];
          bucket.skI.push(ua.skI[0], ua.skI[1], ua.skI[2], ua.skI[3]);
          bucket.skW.push(ua.skW[0], ua.skW[1], ua.skW[2], ua.skW[3]);
        }
      }
      bucket.idx.push(nv);
    }
  }

  const rebuilt = [...partMap.entries()].sort((a, b) => a[0] - b[0]).map(([partId, b]) => ({
    partId,
    vc: b.pos.length / 3,
    pos: new Float32Array(b.pos),
    nrm: new Float32Array(b.nrm),
    uv: b.uv ? new Float32Array(b.uv) : null,
    skI: b.skI ? new Uint8Array(b.skI) : null,
    skW: b.skW ? new Float32Array(b.skW) : null,
    idx: new Uint32Array(b.idx),
  }));

  asset.parts = [...rebuilt, ...others];
  return { uPos, uvc };
}

// 眼球椭球法线平滑 & 沿眼球朝向自适应贴合平滑后的主体表面
function refitEyes(asset, bodyPartId, eyeConfig) {
  const body = asset.parts.find(p => p.partId === bodyPartId);
  if (!body) return;
  const { splitX, groups, pad, ruFactor, rvFactor, H } = eyeConfig;

  // 先对眼球自身分块的接缝法线做光滑焊接
  for (const pid of eyeConfig.allEyeParts) {
    const ep = asset.parts.find(p => p.partId === pid);
    if (!ep) continue;
    const map = new Map(), sumN = [];
    const vm = new Int32Array(ep.vc);
    for (let i = 0; i < ep.vc; i++) {
      const k = `${Math.round(ep.pos[i * 3] * 10000)},${Math.round(ep.pos[i * 3 + 1] * 10000)},${Math.round(ep.pos[i * 3 + 2] * 10000)}`;
      let id = map.get(k);
      if (id === undefined) { id = sumN.length / 3; map.set(k, id); sumN.push(0, 0, 0); }
      sumN[id * 3] += ep.nrm[i * 3]; sumN[id * 3 + 1] += ep.nrm[i * 3 + 1]; sumN[id * 3 + 2] += ep.nrm[i * 3 + 2];
      vm[i] = id;
    }
    for (let i = 0; i < ep.vc; i++) {
      const id = vm[i];
      const nx = sumN[id * 3], ny = sumN[id * 3 + 1], nz = sumN[id * 3 + 2];
      const nl = Math.hypot(nx, ny, nz) || 1;
      ep.nrm[i * 3] = nx / nl; ep.nrm[i * 3 + 1] = ny / nl; ep.nrm[i * 3 + 2] = nz / nl;
    }
  }

  for (const grp of groups) {
    const scleraPart = asset.parts.find(p => p.partId === grp.scleraPart);
    if (!scleraPart) continue;
    // 提取本侧眼白顶点并找眼白中心与前方主朝向
    const sclVerts = [];
    for (let i = 0; i < scleraPart.vc; i++) {
      const x = scleraPart.pos[i * 3];
      if (grp.side === 'all' || (grp.side === 'L' ? x < splitX : x >= splitX)) {
        sclVerts.push(i);
      }
    }
    if (!sclVerts.length) continue;

    let sx = 0, sy = 0, sz = 0, snx = 0, sny = 0, snz = 0;
    for (const i of sclVerts) {
      sx += scleraPart.pos[i * 3]; sy += scleraPart.pos[i * 3 + 1]; sz += scleraPart.pos[i * 3 + 2];
    }
    const cx = sx / sclVerts.length, cy = sy / sclVerts.length, cz = sz / sclVerts.length;
    // 用主朝向(前向 z>0 半球平均法线)近似眼球法线
    for (const i of sclVerts) {
      const nz = scleraPart.nrm[i * 3 + 2];
      if (nz > 0.25) { snx += scleraPart.nrm[i * 3]; sny += scleraPart.nrm[i * 3 + 1]; snz += nz; }
    }
    const nl = Math.hypot(snx, sny, snz) || 1;
    const nx = snx / nl, ny = sny / nl, nz = snz / nl;

    let ux = nz, uy = 0, uz = -nx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;

    // 测量当前眼白沿 N 的最大前凸距离与最大半径
    let maxScleraDn = -Infinity, maxDu = 0, maxDv = 0;
    for (const i of sclVerts) {
      const dx = scleraPart.pos[i * 3] - cx, dy = scleraPart.pos[i * 3 + 1] - cy, dz = scleraPart.pos[i * 3 + 2] - cz;
      const du = Math.abs(dx * ux + dy * uy + dz * uz);
      const dv = Math.abs(dx * vx + dy * vy + dz * vz);
      const dn = dx * nx + dy * ny + dz * nz;
      if (du > maxDu) maxDu = du;
      if (dv > maxDv) maxDv = dv;
      if (dn > maxScleraDn) maxScleraDn = dn;
    }

    // 探测平滑后身体在眼眶投影圈内的最高表面
    const ru = maxDu * (ruFactor || 0.92), rv = maxDv * (rvFactor || 0.92);
    let maxBodyDn = -Infinity;
    for (let i = 0; i < body.vc; i++) {
      const dx = body.pos[i * 3] - cx, dy = body.pos[i * 3 + 1] - cy, dz = body.pos[i * 3 + 2] - cz;
      const du = dx * ux + dy * uy + dz * uz;
      const dv = dx * vx + dy * vy + dz * vz;
      const dn = dx * nx + dy * ny + dz * nz;
      if ((du / ru) ** 2 + (dv / rv) ** 2 < 1.0 && Math.abs(dn) < 0.08 * H) {
        if (dn > maxBodyDn) maxBodyDn = dn;
      }
    }
    if (maxBodyDn === -Infinity) continue;

    const targetFrontDn = maxBodyDn + pad * H;
    const delta = clamp(targetFrontDn - maxScleraDn, -0.02 * H, 0.025 * H);

    // 联动平移本侧眼球全部分块（眼白/虹膜/黑瞳/高光）
    for (const pid of grp.parts) {
      const ep = asset.parts.find(p => p.partId === pid);
      if (!ep) continue;
      for (let i = 0; i < ep.vc; i++) {
        const x = ep.pos[i * 3];
        if (grp.side === 'all' || (grp.side === 'L' ? x < splitX : x >= splitX)) {
          ep.pos[i * 3] += nx * delta;
          ep.pos[i * 3 + 1] += ny * delta;
          ep.pos[i * 3 + 2] += nz * delta;
        }
      }
    }
  }
}

const JOBS = [
  {
    file: 'statue_naiwa.bin',
    targetParts: [0],
    opts: { weldEps: 1.5e-4, taubinIters: 2, lambda: 0.22, mu: -0.225, normalSmoothIters: 4, pinFoot: true },
    eyeConfig: {
      H: 5.2, splitX: -0.6, pad: 0.006,
      allEyeParts: [1, 2],
      groups: [
        { side: 'L', scleraPart: 1, parts: [1, 2] },
        { side: 'R', scleraPart: 1, parts: [1, 2] },
      ],
    },
  },
  {
    file: 'statue_fly_naiwa.bin',
    targetParts: [0, 5],
    opts: { weldEps: 1.5e-4, taubinIters: 3, lambda: 0.25, mu: -0.255, normalSmoothIters: 3, pinFoot: true, pinBelow: 0.27 },
    eyeConfig: {
      H: 4.6, splitX: 0.0, pad: 0.005,
      allEyeParts: [2, 3, 4],
      groups: [
        { side: 'L', scleraPart: 2, parts: [2, 3, 4] },
        { side: 'R', scleraPart: 2, parts: [2, 3, 4] },
      ],
    },
  },
  {
    file: 'god_naiwa.bin',
    targetParts: [0, 1],
    opts: { weldEps: 1.5e-4, taubinIters: 3, lambda: 0.25, mu: -0.255, normalSmoothIters: 3, pinFoot: true },
    eyeConfig: {
      H: 22.0, splitX: -0.25, pad: 0.0045,
      allEyeParts: [2, 3, 4],
      groups: [
        { side: 'L', scleraPart: 2, parts: [2, 3, 4] },
        { side: 'R', scleraPart: 2, parts: [2, 3, 4] },
      ],
    },
  },
  {
    file: 'laugh_naiwa.bin',
    targetParts: [0, 1, 2, 3],
    opts: { weldEps: 1.5e-4, taubinIters: 2, lambda: 0.22, mu: -0.225, normalSmoothIters: 4, pinFoot: true, fixSpecklesOnly: true },
    eyeConfig: null,
  },
  {
    file: 'naiwa_role.bin',
    targetParts: [0],
    opts: { weldEps: 1.5e-4, taubinIters: 3, lambda: 0.25, mu: -0.255, normalSmoothIters: 3, pinFoot: true, smoothSkinIters: 2 },
    eyeConfig: {
      H: 1.72, splitX: 0.0, pad: 0.006,
      allEyeParts: [2, 3, 4, 5],
      groups: [
        { side: 'all', scleraPart: 3, parts: [3, 5] },
        { side: 'all', scleraPart: 2, parts: [2, 4] },
      ],
    },
  },
  {
    file: 'whale_girl.bin',
    targetParts: [0],
    opts: { weldEps: 1.5e-4, taubinIters: 0, normalSmoothIters: 2, smoothSkinIters: 0 },
    eyeConfig: null,
  },
];

console.log('=== 卷心菜自由城 1.01 3D 雕塑与角色网格修复平滑 ===');
for (const job of JOBS) {
  const fp = path.join(assetsDir, job.file);
  const asset = readAsset(fp);
  const before = measureQuality(asset.parts, job.targetParts);
  processOrganicParts(asset, job.targetParts, job.opts);
  if (job.eyeConfig) refitEyes(asset, 0, job.eyeConfig);
  const bytes = writeAsset(fp, asset.isRol, asset.parts);
  const verify = readAsset(fp);
  const after = measureQuality(verify.parts, job.targetParts);
  console.log(
    `✔ ${job.file.padEnd(21)} ${(bytes / 1024).toFixed(0).padStart(4)}KB | ` +
    `tris ${before.tris}->${after.tris} | invDot<0: ${before.invDot}->${after.invDot} | ` +
    `rough<0.5: ${before.roughDot}->${after.roughDot} | nonMani: ${before.nonMani}->${after.nonMani} | deg1: ${before.bndEdges}->${after.bndEdges}`
  );
}
