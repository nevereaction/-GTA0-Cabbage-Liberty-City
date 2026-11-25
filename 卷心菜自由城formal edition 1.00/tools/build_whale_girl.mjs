import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// 用法: node build_whale_girl.mjs --src3mf <白色小鱼deep.3mf> --ref <1000x750 RGBA 原画> --out <输出目录>
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const src3mfPath = arg('--src3mf', 'G:\\vibe的好玩的\\ninth\\assets\\鲸鱼娘主角\\白色小鱼deep.3mf');
const rgbaPath = arg('--ref', 'C:\\Users\\admin\\.gemini\\antigravity\\brain\\9308993a-8a01-4c62-93d4-a45496c658d7\\scratch\\ref_whale_1000x750.rgba');
const outDir = arg('--out', 'C:\\Users\\admin\\.gemini\\antigravity\\brain\\9308993a-8a01-4c62-93d4-a45496c658d7\\scratch\\whale_out');
fs.mkdirSync(outDir, { recursive: true });

const MAGIC_ROL4 = 0x344C4F52; // "ROL4" LE: pos + norm + uv + skin + idx
const H = 1.62;
const Z_SHIFT = -0.055 * H;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smoothstep(a, b, v) {
  const t = a < b ? clamp((v - a) / (b - a), 0, 1) : clamp((a - v) / (a - b), 0, 1);
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
    const cm = buf.readUInt16LE(off + 10);
    const cs = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28);
    const el = buf.readUInt16LE(off + 30);
    const cl = buf.readUInt16LE(off + 32);
    const lo = buf.readUInt32LE(off + 42);
    const nm = buf.subarray(off + 46, off + 46 + nl).toString('utf8');
    off += 46 + nl + el + cl;
    if (nm === entryName) {
      const lnl = buf.readUInt16LE(lo + 26);
      const lel = buf.readUInt16LE(lo + 28);
      const d = buf.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + cs);
      return cm === 0 ? d : zlib.inflateRawSync(d);
    }
  }
  throw new Error(`Entry ${entryName} not found in ${zipPath}`);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePngRGB(filePath, w, h, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  fs.writeFileSync(filePath, Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]));
}

/* ==================== 1. Build Clean 1024x1024 3-View Texture Atlas ==================== */
function evalPiecewiseY(ny, pts) {
  if (ny <= pts[0][0]) {
    const s = (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]);
    return pts[0][1] + (ny - pts[0][0]) * s;
  }
  for (let i = 1; i < pts.length; i++) {
    if (ny <= pts[i][0] || i === pts.length - 1) {
      const [y0, p0] = pts[i - 1], [y1, p1] = pts[i];
      const t = (ny - y0) / (y1 - y0);
      return p0 + (p1 - p0) * t;
    }
  }
  return pts[pts.length - 1][1];
}

function buildPanelBuffer(srcRgba, srcW, srcH, crop) {
  // Crop/mirror into padded local buffer width pw x srcH
  const pw = crop.w;
  const ph = srcH;
  const rgb = new Uint8Array(pw * ph * 3);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      let sx = crop.x0 + x;
      // Optional clean boundary clipping for neighboring panels & edge symmetry repair
      let blank = false;
      if (crop.filterPixel) {
        const res = crop.filterPixel(sx, y);
        if (res === null) blank = true;
        else sx = res;
      }
      if (!blank && sx >= 0 && sx < srcW) {
        const si = (y * srcW + sx) * 4;
        const di = (y * pw + x) * 3;
        rgb[di] = srcRgba[si];
        rgb[di + 1] = srcRgba[si + 1];
        rgb[di + 2] = srcRgba[si + 2];
      }
    }
  }

  // Optional clean-up of Front raised fists + cuff rings (replaced smoothly with midnight-navy sleeves)
  if (crop.cleanFists) {
    const cx = crop.frontCxLocal;
    for (let y = 326; y <= 394; y++) {
      for (let x = 0; x < pw; x++) {
        const dx = Math.abs(x - cx);
        if (dx < 44 || dx > 96) continue;
        const di = (y * pw + x) * 3;
        const r = rgb[di], g = rgb[di + 1], b = rgb[di + 2];
        const isBlueHair = b > r + 42 && b > 115;
        const isDarkBg = r + g + b < 45;
        if (isBlueHair || isDarkBg) continue;
        // Replace peach fist + pale cuff ring over the shoulders cleanly with shaded navy sleeve
        const isWarmOrPale = (r > 135 && r - b > 12) || (r > 195 && g > 195 && b > 195 && dx > 48);
        if (isWarmOrPale || (r < 95 && g < 95 && b < 110 && dx > 48 && dx < 88 && y > 334 && y < 386)) {
          const shade = clamp(1.0 - (y - 326) / 145, 0.78, 1.0);
          rgb[di] = Math.round(28 * shade);
          rgb[di + 1] = Math.round(47 * shade);
          rgb[di + 2] = Math.round(112 * shade);
        }
      }
    }
  }

  // Flood-fill exterior dark background from border pixels (protects dark eyes/lineart inside!)
  const isBG = new Uint8Array(pw * ph);
  const queue = new Int32Array(pw * ph);
  let qHead = 0, qTail = 0;
  const tryEnqueue = (x, y) => {
    const idx = y * pw + x;
    if (isBG[idx]) return;
    const di = idx * 3;
    if (rgb[di] < 24 && rgb[di + 1] < 24 && rgb[di + 2] < 24) {
      isBG[idx] = 1;
      queue[qTail++] = idx;
    }
  };
  for (let x = 0; x < pw; x++) { tryEnqueue(x, 0); tryEnqueue(x, ph - 1); }
  for (let y = 0; y < ph; y++) { tryEnqueue(0, y); tryEnqueue(pw - 1, y); }
  while (qHead < qTail) {
    const cur = queue[qHead++];
    const cx = cur % pw, cy = (cur / pw) | 0;
    if (cx > 0) tryEnqueue(cx - 1, cy);
    if (cx + 1 < pw) tryEnqueue(cx + 1, cy);
    if (cy > 0) tryEnqueue(cx, cy - 1);
    if (cy + 1 < ph) tryEnqueue(cx, cy + 1);
  }

  // Also strip outer 1px anti-aliased black silhouette halo adjacent to exterior BG
  const isHalo = new Uint8Array(pw * ph);
  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      const idx = y * pw + x;
      if (isBG[idx]) continue;
      const di = idx * 3;
      const lum = rgb[di] + rgb[di + 1] + rgb[di + 2];
      if (lum < 75 && (isBG[idx - 1] || isBG[idx + 1] || isBG[idx - pw] || isBG[idx + pw])) {
        isHalo[idx] = 1;
      }
    }
  }
  for (let i = 0; i < isHalo.length; i++) if (isHalo[i]) isBG[i] = 1;

  // 65 passes of 8-neighbor foreground edge dilation + clean deep-blue fallback
  let valid = new Uint8Array(pw * ph);
  for (let i = 0; i < valid.length; i++) valid[i] = isBG[i] ? 0 : 1;
  for (let pass = 0; pass < 65; pass++) {
    const nextValid = new Uint8Array(valid);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const idx = y * pw + x;
        if (valid[idx]) continue;
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= ph) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= pw) continue;
            const nIdx = yy * pw + xx;
            if (valid[nIdx]) {
              sr += rgb[nIdx * 3]; sg += rgb[nIdx * 3 + 1]; sb += rgb[nIdx * 3 + 2];
              cnt++;
            }
          }
        }
        if (cnt > 0) {
          rgb[idx * 3] = Math.round(sr / cnt);
          rgb[idx * 3 + 1] = Math.round(sg / cnt);
          rgb[idx * 3 + 2] = Math.round(sb / cnt);
          nextValid[idx] = 1;
        }
      }
    }
    valid = nextValid;
  }
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i]) { rgb[i * 3] = 32; rgb[i * 3 + 1] = 94; rgb[i * 3 + 2] = 228; }
  }

  return { w: pw, h: ph, rgb };
}

function samplePanelBilinear(panel, fx, fy) {
  const x = clamp(fx, 0, panel.w - 1);
  const y = clamp(fy, 0, panel.h - 1);
  const x0 = Math.floor(x), x1 = Math.min(panel.w - 1, x0 + 1);
  const y0 = Math.floor(y), y1 = Math.min(panel.h - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const i00 = (y0 * panel.w + x0) * 3, i10 = (y0 * panel.w + x1) * 3;
  const i01 = (y1 * panel.w + x0) * 3, i11 = (y1 * panel.w + x1) * 3;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  return [
    Math.round(panel.rgb[i00] * w00 + panel.rgb[i10] * w10 + panel.rgb[i01] * w01 + panel.rgb[i11] * w11),
    Math.round(panel.rgb[i00 + 1] * w00 + panel.rgb[i10 + 1] * w10 + panel.rgb[i01 + 1] * w01 + panel.rgb[i11 + 1] * w11),
    Math.round(panel.rgb[i00 + 2] * w00 + panel.rgb[i10 + 2] * w10 + panel.rgb[i01 + 2] * w01 + panel.rgb[i11 + 2] * w11),
  ];
}

function generateAtlas() {
  console.log('Generating 1024x1024 3-view texture atlas...');
  const srcRgba = fs.readFileSync(rgbaPath);
  const srcW = 1000, srcH = 750;

  // Front padded [-28..344] -> w=372; left edge x<9 mirrored symmetrically across cx=136.5
  const frontPanel = buildPanelBuffer(srcRgba, srcW, srcH, {
    x0: -28, w: 372,
    cleanFists: true,
    frontCxLocal: 136.5 - (-28),
    filterPixel: (sx, y) => {
      if (sx < 9) return Math.round(2 * 136.5 - sx);
      if (sx > 338 && y > 355) return null; // avoid catching Side skirt/hair bleed
      return sx;
    },
  });

  // Side [345..704] -> w=360; clip trailing Front hair curl at x<356, y in 350..515
  const sidePanel = buildPanelBuffer(srcRgba, srcW, srcH, {
    x0: 345, w: 360,
    filterPixel: (sx, y) => {
      if (sx < 357 && y > 350 && y < 520) return null;
      if (sx > 696) return null;
      return sx;
    },
  });

  // Back padded [676..1026] -> w=350; right edge x>988 mirrored symmetrically across cx=870.0
  const backPanel = buildPanelBuffer(srcRgba, srcW, srcH, {
    x0: 676, w: 350,
    filterPixel: (sx, y) => {
      if (sx > 988) return Math.round(2 * 870.0 - sx);
      if (sx < 698 && y > 500) return null; // avoid Side whale tail tip entering Back lower left
      return sx;
    },
  });

  // Control points (ny -> exact pixel Y in source image)
  const frontYMap = [
    [0.000, 728.0],
    [0.240, 566.0],
    [0.445, 422.0],
    [0.568, 330.0],
    [0.585, 312.0],
    [0.628, 285.0],
    [0.691, 240.4],
    [1.000, 36.0],
  ];
  const sideYMap = [
    [0.000, 726.0],
    [0.240, 564.0],
    [0.445, 422.0],
    [0.585, 314.0],
    [0.691, 230.5],
    [1.000, 38.0],
  ];
  const backYMap = [
    [0.000, 728.0],
    [0.240, 566.0],
    [0.445, 422.0],
    [0.691, 240.4],
    [1.000, 36.0],
  ];

  const AW = 1024, AH = 1024;
  const atlas = Buffer.alloc(AW * AH * 3);
  const cols = [
    { x0: 4,   x1: 336, panel: frontPanel, xOff: -28, mapX: (u) => 136.5 + (-0.30 + u * 0.60) * 596.0, yMap: frontYMap },
    { x0: 345, x1: 677, panel: sidePanel,  xOff: 345, mapX: (u) => 502.0 - (0.28 - u * 0.60) * 678.0,  yMap: sideYMap },
    { x0: 686, x1: 1018, panel: backPanel, xOff: 676, mapX: (u) => 870.0 + (-0.30 + u * 0.60) * 602.0, yMap: backYMap },
  ];

  for (let y = 0; y < AH; y++) {
    const vNorm = clamp((1019 - y) / 1015, 0, 1);
    const ny = -0.02 + vNorm * 1.04;
    for (let x = 0; x < AW; x++) {
      // Pick closest column (so gutters copy edge color seamlessly)
      let c = cols[0];
      if (x >= 341 && x < 682) c = cols[1];
      else if (x >= 682) c = cols[2];
      const uNorm = clamp((x - c.x0) / (c.x1 - c.x0), 0, 1);
      const srcX = c.mapX(uNorm) - c.xOff;
      const srcY = evalPiecewiseY(ny, c.yMap);
      const [r, g, b] = samplePanelBilinear(c.panel, srcX, srcY);
      const o = (y * AW + x) * 3;
      atlas[o] = r; atlas[o + 1] = g; atlas[o + 2] = b;
    }
  }

  const texOut = path.join(outDir, 'whale_girl_tex.png');
  writePngRGB(texOut, AW, AH, atlas);
  console.log(`  Saved ${path.basename(texOut)} (${(fs.statSync(texOut).size / 1024).toFixed(1)} KB, 1024x1024)`);
  return atlas;
}

/* ==================== 2. Extract, Smooth & UV-Unwrap Comp #2 to ROL4 ==================== */
function computeAreaNormals(pos, idx) {
  const vc = pos.length / 3;
  const nrm = new Float32Array(vc * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    const x0 = pos[i0 * 3], y0 = pos[i0 * 3 + 1], z0 = pos[i0 * 3 + 2];
    const ax = pos[i1 * 3] - x0, ay = pos[i1 * 3 + 1] - y0, az = pos[i1 * 3 + 2] - z0;
    const bx = pos[i2 * 3] - x0, by = pos[i2 * 3 + 1] - y0, bz = pos[i2 * 3 + 2] - z0;
    const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
    for (const v of [i0, i1, i2]) { nrm[v * 3] += fx; nrm[v * 3 + 1] += fy; nrm[v * 3 + 2] += fz; }
  }
  for (let i = 0; i < vc; i++) {
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-8) { nrm[i * 3] = nx / nl; nrm[i * 3 + 1] = ny / nl; nrm[i * 3 + 2] = nz / nl; }
    else { nrm[i * 3] = 0; nrm[i * 3 + 1] = 1; nrm[i * 3 + 2] = 0; }
  }
  return nrm;
}

function taubinSmooth(pos, idx, iters = 2, lambda = 0.35, mu = -0.36) {
  const vc = pos.length / 3;
  const adj = Array.from({ length: vc }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  const tmp = new Float32Array(pos.length);
  const step = (factor) => {
    for (let i = 0; i < vc; i++) {
      const nbrs = adj[i];
      if (!nbrs.size) { tmp[i * 3] = pos[i * 3]; tmp[i * 3 + 1] = pos[i * 3 + 1]; tmp[i * 3 + 2] = pos[i * 3 + 2]; continue; }
      let sx = 0, sy = 0, sz = 0;
      for (const j of nbrs) { sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2]; }
      const n = nbrs.size;
      tmp[i * 3] = pos[i * 3] + factor * (sx / n - pos[i * 3]);
      tmp[i * 3 + 1] = pos[i * 3 + 1] + factor * (sy / n - pos[i * 3 + 1]);
      tmp[i * 3 + 2] = pos[i * 3 + 2] + factor * (sz / n - pos[i * 3 + 2]);
    }
    pos.set(tmp);
  };
  for (let k = 0; k < iters; k++) { step(lambda); step(mu); }
}

function vertexUV(chartId, nx, ny, nz) {
  let ax;
  if (chartId === 0) ax = 4 + clamp((nx + 0.30) / 0.60, 0, 1) * 332;
  else if (chartId === 1) ax = 345 + clamp((0.28 - nz) / 0.60, 0, 1) * 332;
  else ax = 686 + clamp((-nx + 0.30) / 0.60, 0, 1) * 332;
  const ay = 1019 - clamp((ny + 0.02) / 1.04, 0, 1) * 1015;
  return [ax / 1024, ay / 1024];
}

const NUM_BONES = 9; // torso, head, legL, legR, armL, armR, tail, hairBack, tailTip

// 贴图取色：用原画颜色区分「蓝色头发」与「深蓝衣物」，让头发独立飘动、不拖拽袖子
function atlasColor(atlas, u, v) {
  const x = clamp(Math.round(u * 1023), 0, 1023), y = clamp(Math.round(v * 1023), 0, 1023);
  const o = (y * 1024 + x) * 3;
  return [atlas[o], atlas[o + 1], atlas[o + 2]];
}

function computeWhaleSkinWeights(positions, uvs, atlas) {
  const vertCount = positions.length / 3;
  const skinIndices = new Uint8Array(vertCount * 4);
  const skinWeights = new Float32Array(vertCount * 4);
  const boneHits = new Int32Array(NUM_BONES);
  let hairCount = 0;

  for (let i = 0; i < vertCount; i++) {
    const nx = positions[i * 3] / H;
    const ny = positions[i * 3 + 1] / H;
    const nz = positions[i * 3 + 2] / H;          // 已含 Z_SHIFT
    const nzu = nz + 0.055;                         // 未平移坐标
    const ax = Math.abs(nx);

    const [cr, cg, cb] = atlasColor(atlas, uvs[i * 2], uvs[i * 2 + 1]);
    let isHair = cb > 150 && cb > cr + 85 && cg > 55 && cr < 150;
    if (nzu > 0.10 && ny < 0.62 && ax < 0.08) isHair = false;   // 领口宝石不是头发
    if (ny < 0.22) isHair = false;
    if (ny > 0.62 && nzu > -0.02) isHair = false;               // 刘海/发箍/头顶随头部整体运动

    const ws = new Float32Array(NUM_BONES);
    if (isHair) {
      hairCount++;
      const tHair = smoothstep(0.64, 0.50, ny);               // 越往下越自由摆动
      ws[7] = tHair;
      ws[1] = 1 - tHair;
    } else {
      const wHead = smoothstep(0.565, 0.625, ny);
      const tailRegion = smoothstep(-0.095, -0.145, nz) * (1 - smoothstep(0.28, 0.36, ny)) * (1 - smoothstep(0.08, 0.13, ax));
      const tipK = smoothstep(0.26, 0.13, ny);
      const legMask = (1 - smoothstep(0.17, 0.42, ny)) * smoothstep(-0.10, -0.05, nz);
      const sideL = smoothstep(-0.035, 0.035, nx);
      const armBand = smoothstep(0.35, 0.395, ny) * (1 - smoothstep(0.53, 0.585, ny)) * smoothstep(-0.10, -0.02, nz);
      ws[1] = wHead;
      ws[6] = tailRegion * (1 - tipK);
      ws[8] = tailRegion * tipK;
      ws[2] = legMask * sideL;
      ws[3] = legMask * (1 - sideL);
      ws[4] = armBand * smoothstep(0.100, 0.150, nx);
      ws[5] = armBand * smoothstep(-0.100, -0.150, nx);
    }
    let wApp = 0;
    for (let b = 1; b < NUM_BONES; b++) wApp += ws[b];
    if (wApp > 1) { for (let b = 1; b < NUM_BONES; b++) ws[b] /= wApp; ws[0] = 0; }
    else ws[0] = 1 - wApp;

    const pairs = Array.from(ws, (w, b) => [b, w]).sort((a, b) => b[1] - a[1]);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += pairs[k][1];
    if (sum < 1e-6) { skinIndices[i * 4] = 0; skinWeights[i * 4] = 1; boneHits[0]++; }
    else {
      for (let k = 0; k < 4; k++) {
        const b = pairs[k][0], w = pairs[k][1] / sum;
        skinIndices[i * 4 + k] = b; skinWeights[i * 4 + k] = w;
        if (w > 0.1) boneHits[b]++;
      }
    }
  }
  console.log(`  Hair-classified vertices: ${hairCount}/${vertCount}`);
  return { skinIndices, skinWeights, boneHits };
}

const atlasRGB = generateAtlas();

console.log('\nExtracting Comp #2 from:', src3mfPath);
const xml = readZipEntry(src3mfPath, '3D/3dmodel.model').toString('utf8');
const vStart = xml.indexOf('<vertices>'), vEnd = xml.indexOf('</vertices>', vStart);
const tStart = xml.indexOf('<triangles>', vEnd), tEnd = xml.indexOf('</triangles>', tStart);

const vx = [], vy = [], vz = [];
const vRe = /<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g;
vRe.lastIndex = vStart;
let m;
while ((m = vRe.exec(xml)) !== null && m.index < vEnd) { vx.push(Number(m[1])); vy.push(Number(m[2])); vz.push(Number(m[3])); }
const origVertCount = vx.length;
const parent = new Int32Array(origVertCount);
for (let i = 0; i < origVertCount; i++) parent[i] = i;
function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
function unite(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

const triList = [];
const tRe = /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g;
tRe.lastIndex = tStart;
while ((m = tRe.exec(xml)) !== null && m.index < tEnd) {
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
  unite(a, b); unite(b, c);
  triList.push(a, b, c);
}

const comps = new Map();
for (let i = 0; i < origVertCount; i++) {
  const r = find(i);
  let s = comps.get(r);
  if (!s) { s = { root: r, minX: Infinity, cnt: 0 }; comps.set(r, s); }
  s.cnt++;
  if (vx[i] < s.minX) s.minX = vx[i];
}
const targetRoot = [...comps.values()].sort((a, b) => a.minX - b.minX)[2].root;

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < origVertCount; i++) {
  if (find(i) !== targetRoot) continue;
  const ax = -vx[i], ay = vz[i], az = vy[i];
  if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
  if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
  if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
}
const scale = H / (maxY - minY);
const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;

const quantRaw = 0.96;
const buckets = new Map();
const sumX = [], sumY = [], sumZ = [], counts = [];
const oldToNew = new Int32Array(origVertCount).fill(-1);
for (let i = 0; i < origVertCount; i++) {
  if (find(i) !== targetRoot) continue;
  const rx = vx[i], ry = vy[i], rz = vz[i];
  const key = `${Math.round(rx / quantRaw)},${Math.round(ry / quantRaw)},${Math.round(rz / quantRaw)}`;
  let id = buckets.get(key);
  if (id === undefined) { id = sumX.length; buckets.set(key, id); sumX.push(0); sumY.push(0); sumZ.push(0); counts.push(0); }
  sumX[id] += (-rx - cx0) * scale;
  sumY[id] += (rz - minY) * scale;
  sumZ[id] += (ry - cz0) * scale;
  counts[id]++;
  oldToNew[i] = id;
}

const rawTris = [];
for (let t = 0; t < triList.length; t += 3) {
  const i0 = oldToNew[triList[t]];
  if (i0 < 0) continue;
  const i1 = oldToNew[triList[t + 1]], i2 = oldToNew[triList[t + 2]];
  if (i0 === i1 || i1 === i2 || i2 === i0) continue;
  rawTris.push(i0, i1, i2);
}

const weldV = sumX.length;
const wPos = new Float32Array(weldV * 3);
let scx = 0, scy = 0, scz = 0;
for (let i = 0; i < weldV; i++) {
  const px = sumX[i] / counts[i], py = sumY[i] / counts[i], pz = sumZ[i] / counts[i];
  wPos[i * 3] = px; wPos[i * 3 + 1] = py; wPos[i * 3 + 2] = pz;
  scx += px; scy += py; scz += pz;
}
const wIdx = new Uint32Array(rawTris);

// Check outward winding first, flip BEFORE smoothing if needed
let wNrm = computeAreaNormals(wPos, wIdx);
const mcx = scx / weldV, mcy = scy / weldV, mcz = scz / weldV;
let dotSum = 0;
for (let i = 0; i < weldV; i++) {
  dotSum += (wPos[i * 3] - mcx) * wNrm[i * 3] + (wPos[i * 3 + 1] - mcy) * wNrm[i * 3 + 1] + (wPos[i * 3 + 2] - mcz) * wNrm[i * 3 + 2];
}
if (dotSum < 0) {
  console.log(`Flipping inward winding (avgDot=${(dotSum / weldV).toFixed(4)})`);
  for (let t = 0; t < wIdx.length; t += 3) { const tmp = wIdx[t + 1]; wIdx[t + 1] = wIdx[t + 2]; wIdx[t + 2] = tmp; }
} else {
  console.log(`Outward normals OK (avgDot=${(dotSum / weldV).toFixed(4)})`);
}

// Porcelain-smooth Taubin filter (2 iterations, zero shrinkage)
taubinSmooth(wPos, wIdx, 2, 0.35, -0.36);
wNrm = computeAreaNormals(wPos, wIdx);

// Assign triangles to Charts (0=Front, 1=Side, 2=Back) and split UV seam vertices cleanly
const triCharts = [0, 0, 0];
const outPos = [], outNrm = [], outUv = [], outIdx = [];
const seamMap = new Map();

for (let t = 0; t < wIdx.length; t += 3) {
  const i0 = wIdx[t], i1 = wIdx[t + 1], i2 = wIdx[t + 2];
  const mx = (wPos[i0 * 3] + wPos[i1 * 3] + wPos[i2 * 3]) / (3 * H);
  const my = (wPos[i0 * 3 + 1] + wPos[i1 * 3 + 1] + wPos[i2 * 3 + 1]) / (3 * H);
  const mz = (wPos[i0 * 3 + 2] + wPos[i1 * 3 + 2] + wPos[i2 * 3 + 2]) / (3 * H);

  const ax = wPos[i1 * 3] - wPos[i0 * 3], ay = wPos[i1 * 3 + 1] - wPos[i0 * 3 + 1], az = wPos[i1 * 3 + 2] - wPos[i0 * 3 + 2];
  const bx = wPos[i2 * 3] - wPos[i0 * 3], by = wPos[i2 * 3 + 1] - wPos[i0 * 3 + 1], bz = wPos[i2 * 3 + 2] - wPos[i0 * 3 + 2];
  const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const fny = fy / fl, fnz = fz / fl;

  const isTail = (my < 0.35 && mz < -0.055);
  const isTailBelly = (isTail && fny < -0.18);
  const isSideArmHand = (Math.abs(mx) > 0.112 && my >= 0.355 && my <= 0.555 && mz > 0.020 && mz < 0.145);
  const isWhaleEar = (Math.abs(mx) > 0.185 && my > 0.68 && my < 0.82);
  const isBackHairCurtain = (my >= 0.37 && my <= 0.56 && Math.abs(mx) > 0.085 && mz < -0.03 && fnz < 0.15);

  let chart = 1; // Side default
  if (isTail) {
    chart = isTailBelly ? 1 : (Math.abs(fnz) < 0.25 ? 1 : 2);
  } else if (isBackHairCurtain) {
    chart = 2;
  } else if (!isWhaleEar && !isSideArmHand) {
    if (my >= 0.57 && my <= 0.77 && Math.abs(mx) < 0.135 && mz > 0.06 && fnz > -0.10) chart = 0; // Entire front face oval
    else if (my > 0.77 && my <= 0.85 && mz > 0.08 && fnz > 0.08) chart = 0; // Forehead bangs
    else if (my >= 0.55 && my <= 0.62 && Math.abs(mx) < 0.11 && mz > 0.08 && fny < -0.35) chart = 0; // Under chin
    else if (fnz >= 0.32) chart = 0;
    else if (fnz <= -0.32) chart = 2;
  }
  triCharts[chart]++;

  for (const v of [i0, i1, i2]) {
    const key = v * 3 + chart;
    let nv = seamMap.get(key);
    if (nv === undefined) {
      nv = outPos.length / 3;
      seamMap.set(key, nv);
      const vx0 = wPos[v * 3], vy0 = wPos[v * 3 + 1], vz0 = wPos[v * 3 + 2];
      outPos.push(vx0, vy0, vz0);
      outNrm.push(wNrm[v * 3], wNrm[v * 3 + 1], wNrm[v * 3 + 2]);
      const [u, vv] = vertexUV(chart, vx0 / H, vy0 / H, vz0 / H);
      outUv.push(u, vv);
    }
    outIdx.push(nv);
  }
}

const finalPos = new Float32Array(outPos);
const finalNrm = new Float32Array(outNrm);
const finalUv = new Float32Array(outUv);
const finalIdx = new Uint32Array(outIdx);
const finalVc = finalPos.length / 3;

// Center standing torso/legs over (0,0) AFTER UV assignment
for (let i = 0; i < finalVc; i++) finalPos[i * 3 + 2] += Z_SHIFT;

const skin = computeWhaleSkinWeights(finalPos, finalUv, atlasRGB);
const BONE_NAMES = ['torso', 'head', 'legL', 'legR', 'armL', 'armR', 'tail', 'hairBack', 'tailTip'];
console.log(`Chart split tris: Front=${triCharts[0]}, Side=${triCharts[1]}, Back=${triCharts[2]} | Total=${finalIdx.length / 3} tris, ${finalVc} verts`);
console.log('Whale bone coverage (>0.1 weight):', BONE_NAMES.map((bn, bi) => `${bn}=${skin.boneHits[bi]}`).join(', '));

// Write ROL4 binary
const outFile = path.join(outDir, 'whale_girl.bin');
const byteLen = 8 + 12 + finalPos.byteLength + finalNrm.byteLength + finalUv.byteLength + skin.skinIndices.byteLength + skin.skinWeights.byteLength + finalIdx.byteLength;
const buf = Buffer.allocUnsafe(byteLen);
let off = 0;
buf.writeUInt32LE(MAGIC_ROL4, off); off += 4;
buf.writeUInt32LE(1, off); off += 4;
buf.writeUInt32LE(0, off); off += 4;
buf.writeUInt32LE(finalVc, off); off += 4;
buf.writeUInt32LE(finalIdx.length, off); off += 4;
Buffer.from(finalPos.buffer, finalPos.byteOffset, finalPos.byteLength).copy(buf, off); off += finalPos.byteLength;
Buffer.from(finalNrm.buffer, finalNrm.byteOffset, finalNrm.byteLength).copy(buf, off); off += finalNrm.byteLength;
Buffer.from(finalUv.buffer, finalUv.byteOffset, finalUv.byteLength).copy(buf, off); off += finalUv.byteLength;
Buffer.from(skin.skinIndices.buffer, skin.skinIndices.byteOffset, skin.skinIndices.byteLength).copy(buf, off); off += skin.skinIndices.byteLength;
Buffer.from(skin.skinWeights.buffer, skin.skinWeights.byteOffset, skin.skinWeights.byteLength).copy(buf, off); off += skin.skinWeights.byteLength;
Buffer.from(finalIdx.buffer, finalIdx.byteOffset, finalIdx.byteLength).copy(buf, off); off += finalIdx.byteLength;
if (off !== byteLen) throw new Error(`Byte mismatch: ${off} vs ${byteLen}`);
fs.writeFileSync(outFile, buf);
console.log(`Saved ${path.basename(outFile)} (${(byteLen / 1024).toFixed(1)} KB)`);
