// 资源压缩打包：把开发期的高精度二进制模型转换为体积更小的发布格式
//   BLD1 (建筑/雕像)  -> BLD2  : 顶点 uint16 量化(按分块包围盒) + 法线 int8 + 索引 uint16
//   ROL2 / ROL4 (骨骼角色) -> ROL5 : 顶点 uint16 + 法线 int8 + UV uint16 + 蒙皮 uint8
// 用法: node pack_assets.mjs --in <含 *.bin 的目录> --whale <含 whale_girl.bin 的目录> --out <发布 assets 目录>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const inDir = arg('--in');
const whaleDir = arg('--whale');
const outDir = arg('--out');
if (!inDir || !outDir) { console.error('缺少 --in / --out 参数'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const MAGIC_BLD1 = 0x31444C42, MAGIC_BLD2 = 0x32444C42;
const MAGIC_ROL2 = 0x324C4F52, MAGIC_ROL4 = 0x344C4F52, MAGIC_ROL5 = 0x354C4F52;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function bboxOf(pos) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; }
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
const u16 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function readBLD1(buf) {
  let off = 4;
  const partCount = buf.readUInt32LE(off); off += 4; off += 24;
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const partId = buf.readUInt32LE(off); off += 4;
    const vc = buf.readUInt32LE(off); off += 4;
    const ic = buf.readUInt32LE(off); off += 4;
    const pos = new Float32Array(vc * 3); for (let k = 0; k < pos.length; k++) pos[k] = buf.readFloatLE(off + k * 4); off += vc * 12;
    const nrm = new Float32Array(vc * 3); for (let k = 0; k < nrm.length; k++) nrm[k] = buf.readFloatLE(off + k * 4); off += vc * 12;
    const idx = new Uint32Array(ic); for (let k = 0; k < ic; k++) idx[k] = buf.readUInt32LE(off + k * 4); off += ic * 4;
    parts.push({ partId, vc, pos, nrm, idx });
  }
  return parts;
}
function writeBLD2(parts) {
  const chunks = [];
  const head = Buffer.alloc(8); head.writeUInt32LE(MAGIC_BLD2, 0); head.writeUInt32LE(parts.length, 4); chunks.push(head);
  for (const p of parts) {
    const b = bboxOf(p.pos);
    const wide = p.vc > 65535;
    const h = Buffer.alloc(40);
    h.writeUInt32LE(p.partId, 0); h.writeUInt32LE(p.vc, 4); h.writeUInt32LE(p.idx.length, 8); h.writeUInt32LE(wide ? 4 : 2, 12);
    for (let k = 0; k < 6; k++) h.writeFloatLE(b[k], 16 + k * 4);
    chunks.push(h, u16(quantPos(p.pos, b)), u16(quantNrm(p.nrm)), u16(wide ? new Uint32Array(p.idx) : new Uint16Array(p.idx)));
  }
  return Buffer.concat(chunks);
}

function readROL(buf) {
  const magic = buf.readUInt32LE(0);
  const hasUV = magic === MAGIC_ROL4;
  let off = 4;
  const partCount = buf.readUInt32LE(off); off += 4;
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const partId = buf.readUInt32LE(off); off += 4;
    const vc = buf.readUInt32LE(off); off += 4;
    const ic = buf.readUInt32LE(off); off += 4;
    const pos = new Float32Array(vc * 3); for (let k = 0; k < pos.length; k++) pos[k] = buf.readFloatLE(off + k * 4); off += vc * 12;
    const nrm = new Float32Array(vc * 3); for (let k = 0; k < nrm.length; k++) nrm[k] = buf.readFloatLE(off + k * 4); off += vc * 12;
    let uv = null;
    if (hasUV) { uv = new Float32Array(vc * 2); for (let k = 0; k < uv.length; k++) uv[k] = buf.readFloatLE(off + k * 4); off += vc * 8; }
    const skI = new Uint8Array(buf.subarray(off, off + vc * 4)); off += vc * 4;
    const skW = new Float32Array(vc * 4); for (let k = 0; k < skW.length; k++) skW[k] = buf.readFloatLE(off + k * 4); off += vc * 16;
    const idx = new Uint32Array(ic); for (let k = 0; k < ic; k++) idx[k] = buf.readUInt32LE(off + k * 4); off += ic * 4;
    parts.push({ partId, vc, pos, nrm, uv, skI, skW, idx });
  }
  return parts;
}
function quantWeights(w) {
  const q = new Uint8Array(w.length);
  for (let v = 0; v < w.length; v += 4) {
    let sum = 0, big = 0;
    for (let k = 0; k < 4; k++) { q[v + k] = Math.round(clamp(w[v + k], 0, 1) * 255); sum += q[v + k]; if (w[v + k] > w[v + big]) big = k; }
    q[v + big] = clamp(q[v + big] + (255 - sum), 0, 255);
  }
  return q;
}
function writeROL5(parts) {
  const chunks = [];
  const head = Buffer.alloc(8); head.writeUInt32LE(MAGIC_ROL5, 0); head.writeUInt32LE(parts.length, 4); chunks.push(head);
  for (const p of parts) {
    const b = bboxOf(p.pos);
    const wide = p.vc > 65535;
    const flags = (p.uv ? 1 : 0) | (wide ? 2 : 0);
    const h = Buffer.alloc(40);
    h.writeUInt32LE(p.partId, 0); h.writeUInt32LE(p.vc, 4); h.writeUInt32LE(p.idx.length, 8); h.writeUInt32LE(flags, 12);
    for (let k = 0; k < 6; k++) h.writeFloatLE(b[k], 16 + k * 4);
    chunks.push(h, u16(quantPos(p.pos, b)), u16(quantNrm(p.nrm)));
    if (p.uv) { const q = new Uint16Array(p.uv.length); for (let i = 0; i < q.length; i++) q[i] = Math.round(clamp(p.uv[i], 0, 1) * 65535); chunks.push(u16(q)); }
    chunks.push(u16(p.skI), u16(quantWeights(p.skW)), u16(wide ? new Uint32Array(p.idx) : new Uint16Array(p.idx)));
  }
  return Buffer.concat(chunks);
}

const BLD_FILES = ['bld_canton', 'bld_jinmao', 'bld_pearl', 'bld_swfc', 'statue_naiwa', 'statue_fly_naiwa', 'god_naiwa', 'laugh_naiwa'];
const ROL_FILES = ['naiwa_role'];
let totalIn = 0, totalOut = 0;
const report = (name, a, b) => { totalIn += a; totalOut += b; console.log(`  ${name.padEnd(22)} ${(a / 1024).toFixed(0).padStart(6)} KB -> ${(b / 1024).toFixed(0).padStart(6)} KB  (${(100 * b / a).toFixed(0)}%)`); };

for (const n of BLD_FILES) {
  const src = fs.readFileSync(path.join(inDir, `${n}.bin`));
  if (src.readUInt32LE(0) !== MAGIC_BLD1) throw new Error(`${n} 不是 BLD1`);
  const out = writeBLD2(readBLD1(src));
  fs.writeFileSync(path.join(outDir, `${n}.bin`), out);
  report(n, src.length, out.length);
}
for (const n of ROL_FILES) {
  const src = fs.readFileSync(path.join(inDir, `${n}.bin`));
  const out = writeROL5(readROL(src));
  fs.writeFileSync(path.join(outDir, `${n}.bin`), out);
  report(n, src.length, out.length);
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
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}
function optimizePng(srcBuf) {
  let off = 8, w = 0, h = 0;
  const idats = [];
  while (off < srcBuf.length) {
    const len = srcBuf.readUInt32BE(off);
    const type = srcBuf.toString('ascii', off + 4, off + 8);
    const chunk = srcBuf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = chunk.readUInt32BE(0); h = chunk.readUInt32BE(4); }
    else if (type === 'IDAT') idats.push(chunk);
    off += 12 + len;
  }
  const rawIn = zlib.inflateSync(Buffer.concat(idats));
  const stride = w * 3;
  const rgb = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = rawIn[y * (stride + 1)];
    const rowIn = rawIn.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const rowOff = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? rgb[rowOff + i - 3] : 0;
      const b = y > 0 ? rgb[rowOff - stride + i] : 0;
      const c = (y > 0 && i >= 3) ? rgb[rowOff - stride + i - 3] : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? ((a + b) >> 1) : f === 4 ? paeth(a, b, c) : 0;
      rgb[rowOff + i] = ((rowIn[i] + pred) & 0xff) & 0xfc;
    }
  }
  const rawOut = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    rawOut[y * (stride + 1)] = 4; // Paeth filter
    const rowOff = y * stride, outOff = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? rgb[rowOff + i - 3] : 0;
      const b = y > 0 ? rgb[rowOff - stride + i] : 0;
      const c = (y > 0 && i >= 3) ? rgb[rowOff - stride + i - 3] : 0;
      rawOut[outOff + i] = (rgb[rowOff + i] - paeth(a, b, c)) & 0xff;
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const idat = zlib.deflateSync(rawOut, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

if (whaleDir) {
  const src = fs.readFileSync(path.join(whaleDir, 'whale_girl.bin'));
  const out = writeROL5(readROL(src));
  fs.writeFileSync(path.join(outDir, 'whale_girl.bin'), out);
  report('whale_girl', src.length, out.length);
  const texPath = path.join(whaleDir, 'whale_girl_tex.png');
  if (fs.existsSync(texPath)) {
    const texSrc = fs.readFileSync(texPath);
    const texOut = optimizePng(texSrc);
    fs.writeFileSync(path.join(outDir, 'whale_girl_tex.png'), texOut);
    report('whale_girl_tex.png', texSrc.length, texOut.length);
  }
}
console.log(`合计: ${(totalIn / 1048576).toFixed(2)} MB -> ${(totalOut / 1048576).toFixed(2)} MB`);
