// =====================================================================
//  卷心菜自由城 · Formal Edition 1.01 (16×16 拓展版图 · 卷心菜精心制作)
// =====================================================================
import * as THREE from '../lib/three.module.min.js';
window.__gameLoaded = true;

/* ============================ 工具函数 ============================ */
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, spd, dt) => a + (b - a) * (1 - Math.exp(-spd * dt));
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/* ============================ 城市参数 (16×16 拓展版图 + 滨海双码头) ============================ */
const N = 16;                // 街区数量 16×16（较 1.00 拓图 +78%）
const MID = N / 2;           // 市中心基准索引 (8)
const BLOCK = 52;            // 街区边长
const ROAD = 16;             // 道路宽度
const CELL = BLOCK + ROAD;
const SIZE = N * CELL;
const HALF = SIZE / 2;
const LANE = 3.8;            // 车道中心偏移
const EDGE = HALF + ROAD / 2;
const WALL = EDGE + 3;
const roadC = i => -HALF + i * CELL;        // 第 i 条道路中心线 (0..N)
const blockMin = j => roadC(j) + ROAD / 2;  // 第 j 个街区起点

/* ============================ 渲染器 ============================ */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.3));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
$('game').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fb8e0');
scene.fog = new THREE.Fog('#8fb8e0', 190, 1220);

// 程序化生成城市大气与天际线反射环境贴图 (IBL)，仅按需绑定到玻璃/水面/金属材质，避免全场景哑光物体高开销采样
const cityEnvMap = (function buildEnvironmentIBL() {
  const ec = document.createElement('canvas');
  ec.width = 512; ec.height = 256;
  const eg = ec.getContext('2d');
  const skyG = eg.createLinearGradient(0, 0, 0, 128);
  skyG.addColorStop(0.0, '#1e52b2');
  skyG.addColorStop(0.55, '#5fa2e8');
  skyG.addColorStop(0.88, '#b6dcf5');
  skyG.addColorStop(1.0, '#eef7ff');
  eg.fillStyle = skyG; eg.fillRect(0, 0, 512, 128);
  const gndG = eg.createLinearGradient(0, 128, 0, 256);
  gndG.addColorStop(0.0, '#44576d');
  gndG.addColorStop(0.4, '#242e3b');
  gndG.addColorStop(1.0, '#11161e');
  eg.fillStyle = gndG; eg.fillRect(0, 128, 512, 128);
  // 太阳反射亮点与蓬松云带，玻璃外立面可见天空高光扫掠
  const sg = eg.createRadialGradient(315, 86, 4, 315, 86, 72);
  sg.addColorStop(0, 'rgba(255,250,228,1)');
  sg.addColorStop(0.22, 'rgba(255,228,165,0.65)');
  sg.addColorStop(1, 'rgba(255,210,140,0)');
  eg.fillStyle = sg; eg.fillRect(240, 14, 150, 150);
  eg.fillStyle = 'rgba(255,255,255,0.42)';
  for (let i = 0; i < 24; i++) {
    eg.beginPath();
    eg.ellipse((i * 47 + 20) % 512, 92 + (i % 5) * 6, 26 + (i % 4) * 11, 6 + (i % 3) * 3, 0, 0, Math.PI * 2);
    eg.fill();
  }
  eg.fillStyle = 'rgba(255,225,160,0.22)';
  for (let i = 0; i < 65; i++) {
    eg.fillRect((i * 79) % 512, 130 + (i % 7) * 5, 3 + (i % 3), 2);
  }
  const envSrcTex = new THREE.CanvasTexture(ec);
  envSrcTex.mapping = THREE.EquirectangularReflectionMapping;
  envSrcTex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envTex = pmrem.fromEquirectangular(envSrcTex).texture;
  envSrcTex.dispose();
  pmrem.dispose();
  return envTex;
})();

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.25, 2250);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xdde8ff, 0x50483a, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -105, right: 105, top: 105, bottom: -105, near: 1, far: 440 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

const headSpot = new THREE.SpotLight(0xfff2d0, 0, 130, 0.58, 0.5, 1);
scene.add(headSpot, headSpot.target);

/* ============================ 动态立体天空（穹顶 / 日月 / 星空 / 漂浮云朵） ============================ */
const skyGroup = new THREE.Group();
scene.add(skyGroup);
const skyUniforms = {
  uTopColor:     { value: new THREE.Color('#2c66c4') },
  uMidColor:     { value: new THREE.Color('#69a8ea') },
  uHorizonColor: { value: new THREE.Color('#bdddf5') },
  uSunDir:       { value: new THREE.Vector3(0.4, 0.7, -0.5).normalize() },
  uSunGlow:      { value: 0.35 },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(1680, 32, 20),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform float uSunGlow;
      varying vec3 vWorldDir;
      void main() {
        vec3 d = normalize(vWorldDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.28, h));
        col = mix(col, uTopColor, smoothstep(0.22, 0.85, h));
        float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);
        col += vec3(1.0, 0.76, 0.45) * (pow(sunAmt, 8.0) * 0.45 * uSunGlow + pow(sunAmt, 96.0) * 0.65 * max(uSunGlow, 0.25));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
skyDome.renderOrder = -1000;
skyDome.frustumCulled = false;
skyGroup.add(skyDome);

const sunDiscMat = new THREE.MeshBasicMaterial({ color: '#fff5cf', fog: false, depthTest: true, depthWrite: false });
const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(62, 16, 12), sunDiscMat);
sunDisc.renderOrder = 1;
sunDisc.frustumCulled = false;
const sunHaloMat = new THREE.MeshBasicMaterial({ color: '#ffcf78', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, fog: false });
const sunHalo = new THREE.Mesh(new THREE.SphereGeometry(114, 16, 12), sunHaloMat);
sunHalo.renderOrder = 1;
sunHalo.frustumCulled = false;
sunDisc.add(sunHalo);
skyGroup.add(sunDisc);

const moonDiscMat = new THREE.MeshBasicMaterial({ color: '#dce8ff', fog: false, depthTest: true, depthWrite: false });
const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(44, 16, 12), moonDiscMat);
moonDisc.renderOrder = 1;
moonDisc.frustumCulled = false;
skyGroup.add(moonDisc);

const starCount = 1200;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const th = Math.random() * Math.PI * 2;
  const u = Math.random() * 0.94 + 0.05; // 上半球分布
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  starPos[i * 3] = Math.cos(th) * s * 1550;
  starPos[i * 3 + 1] = u * 1550;
  starPos[i * 3 + 2] = Math.sin(th) * s * 1550;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starsMat = new THREE.PointsMaterial({ color: '#eef4ff', size: 5.5, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthTest: true, depthWrite: false });
const starsMesh = new THREE.Points(starGeo, starsMat);
starsMesh.renderOrder = 1;
starsMesh.frustumCulled = false;
skyGroup.add(starsMesh);

// 高空 3D 积云群（绕城飘浮，直升机可在云层间穿行）
const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.88, fog: true });
const cloudPuffs = [];
for (let c = 0; c < 64; c++) {
  const cx = -1050 + Math.random() * 2100;
  const cy = 165 + Math.random() * 85;
  const cz = -1050 + Math.random() * 2100;
  const spd = 1.6 + Math.random() * 2.2;
  const n = 4 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) {
    cloudPuffs.push({
      cx, cz, y: cy + (Math.random() - 0.5) * 3.5,
      ox: (Math.random() - 0.5) * 28, oz: (Math.random() - 0.5) * 18,
      sx: 12 + Math.random() * 15, sy: 4.8 + Math.random() * 4.5, sz: 9 + Math.random() * 12,
      spd,
    });
  }
}
const cloudMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cloudMat, cloudPuffs.length);
cloudMesh.frustumCulled = false;
scene.add(cloudMesh);
const _cloudDummy = new THREE.Object3D();
function updateClouds(dt) {
  for (let i = 0; i < cloudPuffs.length; i++) {
    const cf = cloudPuffs[i];
    cf.cx += cf.spd * dt;
    if (cf.cx > 1080) cf.cx -= 2160;
    _cloudDummy.position.set(cf.cx + cf.ox, cf.y, cf.cz + cf.oz);
    _cloudDummy.scale.set(cf.sx, cf.sy, cf.sz);
    _cloudDummy.updateMatrix();
    cloudMesh.setMatrixAt(i, _cloudDummy.matrix);
  }
  cloudMesh.instanceMatrix.needsUpdate = true;
}
updateClouds(0);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ============================ 材质 ============================ */
const matCache = {};
function mat(color) {
  if (!matCache[color]) matCache[color] = new THREE.MeshLambertMaterial({ color });
  return matCache[color];
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sidewalkMat = new THREE.MeshLambertMaterial({ color: '#9a9a95' });
const asphaltMat = new THREE.MeshLambertMaterial({ color: '#2e2f33' });
const grassMat = new THREE.MeshLambertMaterial({ color: '#4d7a39' });
const parkMat = new THREE.MeshLambertMaterial({ color: '#5a8f41' });
const roofMat = new THREE.MeshLambertMaterial({ color: '#4b4b50' });
const markMat = new THREE.MeshLambertMaterial({ color: '#e6e6dc', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const glassMat = new THREE.MeshStandardMaterial({ color: '#2a3c50', roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.36, depthWrite: false });
const gaugeMat = new THREE.MeshStandardMaterial({ color: '#0c1622', emissive: '#2f9cff', emissiveIntensity: 0.7 });
const needleMat = new THREE.MeshBasicMaterial({ color: '#ff4a2a' });
const headMat = new THREE.MeshStandardMaterial({ color: '#fff8e0', emissive: '#fff2c0', emissiveIntensity: 0.3 });
const tailMat = new THREE.MeshStandardMaterial({ color: '#801010', emissive: '#ff2020', emissiveIntensity: 0.4 });
const tireMat = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 });
const lampMat = new THREE.MeshStandardMaterial({ color: '#fff6d0', emissive: '#ffd890', emissiveIntensity: 0 });
const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.6, metalness: 0.5 });

// 程序化生成窗户贴图（白天 + 夜晚发光）
function windowTextures(base, frame) {
  const S = 256;
  const day = document.createElement('canvas'), night = document.createElement('canvas');
  day.width = day.height = night.width = night.height = S;
  const g = day.getContext('2d'), n = night.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  n.fillStyle = '#000'; n.fillRect(0, 0, S, S);
  for (let i = 0; i < 600; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
    g.fillRect(Math.random() * S, Math.random() * S, 3, 3);
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const wx = x * 32 + 7, wy = y * 32 + 7;
    g.fillStyle = frame; g.fillRect(wx - 2, wy - 2, 22, 22);
    const grd = g.createLinearGradient(wx, wy, wx + 18, wy + 18);
    const tone = Math.random() * 25;
    grd.addColorStop(0, `rgb(${95 + tone},${125 + tone},${150 + tone})`);
    grd.addColorStop(1, '#1b2836');
    g.fillStyle = grd; g.fillRect(wx, wy, 18, 18);
    if (Math.random() < 0.38) {
      n.fillStyle = pick(['#ffd98a', '#ffe8b0', '#cfe0ff', '#ffc870', '#fff1d0']);
      n.fillRect(wx, wy, 18, 18);
    }
  }
  const t1 = new THREE.CanvasTexture(day), t2 = new THREE.CanvasTexture(night);
  for (const t of [t1, t2]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  return [t1, t2];
}
const BUILD_COLORS = [['#8a8f99', '#555'], ['#a08a74', '#5a4636'], ['#6f7f8c', '#3a434b'], ['#b5ad9e', '#6c6458'], ['#7a5f58', '#3e2c28'], ['#5d6670', '#2c3036'], ['#9c6b4e', '#4b2f22']];
const buildingMats = BUILD_COLORS.map(([b, f]) => {
  const [d, n] = windowTextures(b, f);
  return new THREE.MeshLambertMaterial({ map: d, emissiveMap: n, emissive: 0xffffff, emissiveIntensity: 0 });
});

// 现代摩天大楼玻璃幕墙贴图（反光玻璃窗格 + 金属窗梃/层间腰线 + 粗糙度贴图 + 夜景灯光）
function glassCurtainTextures(pal) {
  const S = 256, cols = 8, rows = 8, cw = S / cols, ch = S / rows;
  const colC = document.createElement('canvas');
  const rghC = document.createElement('canvas');
  const emC = document.createElement('canvas');
  colC.width = colC.height = rghC.width = rghC.height = emC.width = emC.height = S;
  const cg = colC.getContext('2d'), rg = rghC.getContext('2d'), eg = emC.getContext('2d');
  cg.fillStyle = pal.mullion; cg.fillRect(0, 0, S, S);
  rg.fillStyle = '#6c6c6c'; rg.fillRect(0, 0, S, S); // 金属窗梃中等粗糙 (~0.42)
  eg.fillStyle = '#000'; eg.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) {
    const floorLit = 0.22 + Math.random() * 0.45;
    // 层间横向铝板/深色腰带
    cg.fillStyle = pal.spandrel; cg.fillRect(0, r * ch, S, 5);
    rg.fillStyle = '#525252'; rg.fillRect(0, r * ch, S, 5);
    for (let c = 0; c < cols; c++) {
      const px = c * cw + 2, py = r * ch + 6, pw = cw - 4, ph = ch - 7;
      const paneShift = (Math.random() - 0.5) * 14;
      const grd = cg.createLinearGradient(px, py, px + pw, py + ph);
      grd.addColorStop(0, pal.top);
      grd.addColorStop(0.55, pal.bot);
      grd.addColorStop(1, pal.top);
      cg.fillStyle = grd; cg.fillRect(px, py, pw, ph);
      if (paneShift > 0) { cg.fillStyle = `rgba(255,255,255,${paneShift / 220})`; cg.fillRect(px, py, pw, ph); }
      else { cg.fillStyle = `rgba(0,18,38,${-paneShift / 220})`; cg.fillRect(px, py, pw, ph); }
      cg.fillStyle = 'rgba(255,255,255,0.14)';
      cg.fillRect(px + 1, py + 1, pw - 2, 2);
      // 玻璃本身高光滑低粗糙度
      rg.fillStyle = '#111111'; rg.fillRect(px, py, pw, ph);
      if (Math.random() < floorLit) {
        eg.fillStyle = pick(pal.nightCols);
        eg.fillRect(px + 1, py + 1, pw - 2, ph - 2);
      }
    }
  }
  const map = new THREE.CanvasTexture(colC);
  const rgh = new THREE.CanvasTexture(rghC);
  const em = new THREE.CanvasTexture(emC);
  map.colorSpace = THREE.SRGBColorSpace;
  em.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, rgh, em]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return [map, rgh, em];
}
const curtainGlassMats = [];
const crownGlowMats = [];
const GLASS_PALETTES = [
  { top: '#2b6ca8', bot: '#4e9bd4', mullion: '#90a4b8', spandrel: '#203247', nightCols: ['#ffe6a8', '#cce8ff', '#ffd27a', '#9fd4ff'] },
  { top: '#2a777a', bot: '#52a8a5', mullion: '#99b0b2', spandrel: '#1e3a3d', nightCols: ['#ffe8b5', '#d5f7f5', '#ffd784', '#a8e6e0'] },
  { top: '#5d7d9c', bot: '#92b6d4', mullion: '#b5c4d2', spandrel: '#2b3948', nightCols: ['#fff0c2', '#dbeeff', '#ffdca0', '#ffffff'] },
  { top: '#7f6f52', bot: '#b8a37c', mullion: '#c2b299', spandrel: '#363026', nightCols: ['#ffe49e', '#fff2ce', '#ffc96b', '#d9ecff'] },
];
const glassSkyscraperMats = GLASS_PALETTES.map(pal => {
  const [map, roughnessMap, emissiveMap] = glassCurtainTextures(pal);
  const m = new THREE.MeshStandardMaterial({
    map, roughnessMap, emissiveMap, envMap: cityEnvMap,
    emissive: 0xffffff, emissiveIntensity: 0.06,
    roughness: 0.12, metalness: 0.48, envMapIntensity: 1.85,
  });
  curtainGlassMats.push(m);
  return m;
});

function buildingGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const rx = Math.max(1, Math.round(w / 3)) / 8, rz = Math.max(1, Math.round(d / 3)) / 8, ry = Math.max(1, Math.round(h / 3.2)) / 8;
  const reps = [[rz, ry], [rz, ry], [1, 1], [1, 1], [rx, ry], [rx, ry]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * reps[f][0], uv.getY(i) * reps[f][1]);
  }
  return g;
}

/* ============================ 碰撞体（空间网格） ============================ */
const colliders = [];
const GRID = 20, grid = new Map();
const gkey = (i, k) => (i + 500) * 1000 + (k + 500);
function addCollider(b) {
  colliders.push(b);
  for (let i = Math.floor(b.x0 / GRID); i <= Math.floor(b.x1 / GRID); i++)
    for (let k = Math.floor(b.z0 / GRID); k <= Math.floor(b.z1 / GRID); k++) {
      const key = gkey(i, k);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(b);
    }
}
const _near = [];
function queryColliders(x, z, r) {
  _near.length = 0;
  const i0 = Math.floor((x - r) / GRID), i1 = Math.floor((x + r) / GRID);
  const k0 = Math.floor((z - r) / GRID), k1 = Math.floor((z + r) / GRID);
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
    const l = grid.get(gkey(i, k));
    if (l) for (const b of l) _near.push(b);
  }
  return _near;
}
// 圆形与 AABB 碰撞，直接修正 p 的位置，返回最后一次碰撞法线
function collideCircle(p, r, y = -1) {
  let hit = null;
  const list = queryColliders(p.x, p.z, r);
  for (const b of list) {
    if (y >= 0 && y >= b.h - 0.6) continue;
    if (p.x + r < b.x0 || p.x - r > b.x1 || p.z + r < b.z0 || p.z - r > b.z1) continue;
    const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    let nx, nz, pen;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
    else {
      const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bb = b.z1 - p.z, m = Math.min(l, rr, t, bb);
      if (m === l) { nx = -1; nz = 0; pen = l + r; } else if (m === rr) { nx = 1; nz = 0; pen = rr + r; }
      else if (m === t) { nx = 0; nz = -1; pen = t + r; } else { nx = 0; nz = 1; pen = bb + r; }
    }
    p.x += nx * pen; p.z += nz * pen;
    hit = { nx, nz };
  }
  return hit;
}
function pointInBuilding(x, y, z, m = 0) {
  const list = queryColliders(x, z, m);
  for (const b of list) if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m && y < b.h + m) return true;
  return false;
}
function segBlocked(x1, z1, x2, z2) {
  const d = Math.hypot(x2 - x1, z2 - z1), steps = Math.ceil(d / 2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointInBuilding(lerp(x1, x2, t), 1.2, lerp(z1, z2, t))) return true;
  }
  return false;
}
function rayBox(o, d, b) {
  let tmin = 0, tmax = 1e9;
  const axes = [[o.x, d.x, b.x0, b.x1], [o.y, d.y, 0, b.h], [o.z, d.z, b.z0, b.z1]];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
const SOUTH_PIER = { x0: -13, x1: 13, z0: EDGE, z1: WALL + 72 };
const EAST_PIER  = { x0: EDGE, x1: WALL + 84, z0: roadC(12) - 24, z1: roadC(12) + 24, roadZ: roadC(12) };
function onPier(x, z) {
  return (x >= SOUTH_PIER.x0 && x <= SOUTH_PIER.x1 && z >= SOUTH_PIER.z0 && z <= SOUTH_PIER.z1)
    || (x >= EAST_PIER.x0 && x <= EAST_PIER.x1 && z >= EAST_PIER.z0 && z <= EAST_PIER.z1);
}
function groundH(x, z) {
  if (onPier(x, z)) return 0.25;
  const j = Math.floor((x + HALF) / CELL), k = Math.floor((z + HALF) / CELL);
  if (j >= 0 && k >= 0 && j < N && k < N) {
    const lx = x - blockMin(j), lz = z - blockMin(k);
    return (lx >= 0 && lx <= BLOCK && lz >= 0 && lz <= BLOCK) ? 0.25 : 0;
  }
  if (Math.abs(x) <= WALL + 34 && Math.abs(z) <= WALL + 34) return 0;
  return -0.35;
}

/* ============================ 生成城市 (16×16 拓图 + 双码头 + 16 区块合批剔除) ============================ */
const parks = [];
const helipads = [];
const blockInfo = [];
const landmarkPlacements = [];
const harborProps = { lighthouseBeacon: null };
const LANDMARK_BLOCKS = {
  [`${MID},${MID - 1}`]:     { id: 'canton', rotY: 0, colliderHalf: 11.5, h: 132.0, podium: 'plaza', helipad: [-16.5, 16.5, Math.PI * 0.75] }, // 唯一广州塔/小蛮腰
  [`${MID - 1},${MID - 1}`]: { id: 'pearl',  rotY: 0, colliderHalf: 13.5, h: 102.5, podium: 'plaza', helipad: [16.5, 16.5, -Math.PI * 0.75] }, // 唯一东方明珠（双球红紫玻璃）
  [`${MID - 1},${MID}`]:     { id: 'swfc',   rotY: 0, colliderHalf: 12.0, h: 118.0, podium: 'dark' }, // 唯一上海环球金融中心
  [`${MID + 1},${MID - 1}`]: { id: 'jinmao', rotY: 0, colliderHalf: 10.0, h: 104.0, podium: 'dark' }, // 唯一金茂大厦
};
const HELIPAD_PLAZA_BLOCKS = {
  '12,4':  Math.PI * 0.5,  // 霓虹科技湾停机坪广场
  '5,10':  Math.PI * 0.25, // 西南奥尔德尼停机坪广场
  '13,11': -Math.PI * 0.5, // 翡翠海岸商务区停机坪广场
};
const GUARANTEED_PARKS = new Set([`${MID},${MID + 1}`, '6,8', '4,10', '11,5', '10,11', '3,4', '12,13', '7,3']);
const setupInstanced = m => { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; return m; };
const fixStatic = m => { m.matrixAutoUpdate = false; m.updateMatrix(); return m; };
const oceanMat = new THREE.MeshStandardMaterial({ color: '#174870', roughness: 0.20, metalness: 0.32, envMap: cityEnvMap, envMapIntensity: 1.25 });
const neonArchMat = new THREE.MeshBasicMaterial({ color: '#38e8ff' });
const neonArchPinkMat = new THREE.MeshBasicMaterial({ color: '#f472b6' });
(function buildCity() {
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(9200, 9200), oceanMat);
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -0.35; ocean.receiveShadow = false; scene.add(fixStatic(ocean));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry((WALL + 34) * 2, (WALL + 34) * 2), grassMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.10; ground.receiveShadow = true; scene.add(fixStatic(ground));
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(WALL * 2, WALL * 2), sidewalkMat);
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.04; outer.receiveShadow = true; scene.add(fixStatic(outer));
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(EDGE * 2, EDGE * 2), asphaltMat);
  asphalt.rotation.x = -Math.PI / 2; asphalt.position.y = 0.01; asphalt.receiveShadow = true; scene.add(fixStatic(asphalt));

  // 外围墙（南码头与东海港通道留出通行缺口）
  const wallMat = mat('#77736b');
  const addWallSeg = (x, z, w, d) => {
    const m = new THREE.Mesh(boxGeo, wallMat);
    m.scale.set(w, 2.5, d); m.position.set(x, 1.25, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(fixStatic(m));
  };
  // 西墙 & 北墙（完整）
  addWallSeg(-WALL - 1, 0, 2, WALL * 2 + 4);
  addCollider({ x0: -WALL - 30, x1: -WALL, z0: -WALL - 30, z1: WALL + 30, h: 2.5 });
  addWallSeg(0, -WALL - 1, WALL * 2 + 4, 2);
  addCollider({ x0: -WALL - 30, x1: WALL + 30, z0: -WALL - 30, z1: -WALL, h: 2.5 });
  // 南墙（在 x in [-13, 13] 处留出南码头通道）
  {
    const lenA = WALL + 2 - 13;
    addWallSeg(-13 - lenA / 2, WALL + 1, lenA, 2);
    addWallSeg(13 + lenA / 2, WALL + 1, lenA, 2);
    addCollider({ x0: -WALL - 30, x1: -13, z0: WALL, z1: WALL + 30, h: 2.5 });
    addCollider({ x0: 13, x1: WALL + 30, z0: WALL, z1: WALL + 30, h: 2.5 });
  }
  // 东墙（在 z in [roadZ - 14, roadZ + 14] 处留出翡翠海岸港通道）
  {
    const g0 = EAST_PIER.roadZ - 14, g1 = EAST_PIER.roadZ + 14;
    const lenN = g0 - (-WALL - 2), lenS = (WALL + 2) - g1;
    addWallSeg(WALL + 1, -WALL - 2 + lenN / 2, 2, lenN);
    addWallSeg(WALL + 1, g1 + lenS / 2, 2, lenS);
    addCollider({ x0: WALL, x1: WALL + 30, z0: -WALL - 30, z1: g0, h: 2.5 });
    addCollider({ x0: WALL, x1: WALL + 30, z0: g1, z1: WALL + 30, h: 2.5 });
  }

  // 滨海双码头建筑与海港基础设施（南观光码头 + 东翡翠海岸港）
  const deckWoodMat = mat('#7c5a3c');
  const pierDeckMat = mat('#4b525e');
  const railMat = mat('#d97706');
  const addStaticBox = (x, y, z, w, h, d, m, shadow = true) => {
    const mesh = new THREE.Mesh(boxGeo, typeof m === 'string' ? mat(m) : m);
    mesh.scale.set(w, h, d); mesh.position.set(x, y, z);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    scene.add(fixStatic(mesh));
    return mesh;
  };

  // 1) 南观光码头
  {
    const w = SOUTH_PIER.x1 - SOUTH_PIER.x0, l = SOUTH_PIER.z1 - SOUTH_PIER.z0;
    const cx = (SOUTH_PIER.x0 + SOUTH_PIER.x1) / 2, cz = (SOUTH_PIER.z0 + SOUTH_PIER.z1) / 2;
    addStaticBox(cx, -0.05, cz, w, 0.6, l, deckWoodMat, false);
    addStaticBox(cx, 0.26, cz, 14, 0.04, l - 2, asphaltMat, false);
    // 码头木桩与护栏碰撞体
    for (let pz = SOUTH_PIER.z0 + 6; pz <= SOUTH_PIER.z1 - 2; pz += 10) {
      addStaticBox(SOUTH_PIER.x0 + 0.6, -0.8, pz, 0.7, 2.2, 0.7, '#4a3525', false);
      addStaticBox(SOUTH_PIER.x1 - 0.6, -0.8, pz, 0.7, 2.2, 0.7, '#4a3525', false);
    }
    addStaticBox(SOUTH_PIER.x0 + 0.4, 0.65, cz, 0.5, 0.8, l, railMat, false);
    addStaticBox(SOUTH_PIER.x1 - 0.4, 0.65, cz, 0.5, 0.8, l, railMat, false);
    addStaticBox(cx, 0.65, SOUTH_PIER.z1 - 0.4, w, 0.8, 0.5, railMat, false);
    addCollider({ x0: SOUTH_PIER.x0 - 0.5, x1: SOUTH_PIER.x0 + 0.7, z0: SOUTH_PIER.z0, z1: SOUTH_PIER.z1, h: 1.5 });
    addCollider({ x0: SOUTH_PIER.x1 - 0.7, x1: SOUTH_PIER.x1 + 0.5, z0: SOUTH_PIER.z0, z1: SOUTH_PIER.z1, h: 1.5 });
    addCollider({ x0: SOUTH_PIER.x0, x1: SOUTH_PIER.x1, z0: SOUTH_PIER.z1 - 0.8, z1: SOUTH_PIER.z1 + 0.5, h: 1.5 });
    // 旁侧停泊游艇
    addStaticBox(22, 0.2, cz + 8, 5.2, 1.4, 16, '#e8edf2');
    addStaticBox(22, 1.3, cz + 7, 3.6, 1.2, 7.5, '#1d3557');
    addStaticBox(22, 1.4, cz + 7, 3.8, 0.3, 6.2, '#38d9ff', false);
  }

  // 2) 东翡翠海岸港码头（含集装箱掩体、龙门吊、灯塔、货轮与港口停机坪）
  {
    const l = EAST_PIER.x1 - EAST_PIER.x0, w = EAST_PIER.z1 - EAST_PIER.z0;
    const cx = (EAST_PIER.x0 + EAST_PIER.x1) / 2, cz = EAST_PIER.roadZ;
    addStaticBox(cx, -0.05, cz, l, 0.6, w, pierDeckMat, false);
    addStaticBox(cx - 2, 0.26, cz, l - 6, 0.04, 16, asphaltMat, false);
    addStaticBox(cx, 0.65, EAST_PIER.z0 + 0.4, l, 0.8, 0.5, railMat, false);
    addStaticBox(cx, 0.65, EAST_PIER.z1 - 0.4, l, 0.8, 0.5, railMat, false);
    addStaticBox(EAST_PIER.x1 - 0.4, 0.65, cz, 0.5, 0.8, w, railMat, false);
    addCollider({ x0: EAST_PIER.x0, x1: EAST_PIER.x1, z0: EAST_PIER.z0 - 0.5, z1: EAST_PIER.z0 + 0.7, h: 1.5 });
    addCollider({ x0: EAST_PIER.x0, x1: EAST_PIER.x1, z0: EAST_PIER.z1 - 0.7, z1: EAST_PIER.z1 + 0.5, h: 1.5 });
    addCollider({ x0: EAST_PIER.x1 - 0.8, x1: EAST_PIER.x1 + 0.5, z0: EAST_PIER.z0, z1: EAST_PIER.z1, h: 1.5 });

    // 港口集装箱掩体阵列
    const containers = [
      [574, cz - 14, 9.0, 3.2, 3.2, '#c83e37'],
      [574, cz - 14, 9.0, 3.2, 3.2, '#e07a24', 3.4],
      [586, cz - 15, 9.0, 3.2, 3.2, '#1d6fa5'],
      [582, cz + 14, 9.0, 3.2, 3.2, '#2a9d8f'],
      [596, cz + 14, 9.0, 3.2, 3.2, '#d97706'],
    ];
    for (const [bx, bz, bw, bh, bd, col, yOff = 0.25] of containers) {
      addStaticBox(bx, yOff + bh / 2, bz, bw, bh, bd, col);
      if (yOff < 1) addCollider({ x0: bx - bw / 2, x1: bx + bw / 2, z0: bz - bd / 2, z1: bz + bd / 2, h: bh + 0.3 });
    }
    // 红色港口龙门吊（跨道路上方净高 15m）
    for (const sz of [cz - 11.5, cz + 11.5]) {
      addStaticBox(600, 8.2, sz, 1.4, 16, 1.4, '#d93829');
      addCollider({ x0: 599.2, x1: 600.8, z0: sz - 0.8, z1: sz + 0.8, h: 16 });
    }
    addStaticBox(600, 16.5, cz, 2.2, 1.6, 28, '#e65100');
    addStaticBox(604, 15.2, cz + 2, 3.2, 1.6, 3.6, '#ffd43b');

    // 海港灯塔 + 旋转信标
    const lhX = EAST_PIER.x1 - 6, lhZ = EAST_PIER.z0 + 5.5;
    addStaticBox(lhX, 3.2, lhZ, 3.6, 6.0, 3.6, '#e5e7eb');
    addStaticBox(lhX, 8.2, lhZ, 2.8, 4.0, 2.8, '#dc2626');
    addStaticBox(lhX, 11.6, lhZ, 2.4, 2.8, 2.4, '#f3f4f6');
    const beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffdf6b' }));
    beaconMesh.position.set(lhX, 13.7, lhZ);
    scene.add(beaconMesh);
    harborProps.lighthouseBeacon = beaconMesh;
    addCollider({ x0: lhX - 1.9, x1: lhX + 1.9, z0: lhZ - 1.9, z1: lhZ + 1.9, h: 14 });

    // 停泊货轮
    addStaticBox(606, 0.8, EAST_PIER.z1 + 10, 38, 3.2, 10.5, '#2b3a4a');
    addStaticBox(620, 3.6, EAST_PIER.z1 + 10, 8, 3.2, 8.5, '#f1f5f9');
    addStaticBox(598, 2.8, EAST_PIER.z1 + 10, 14, 2.2, 7.0, '#b91c1c');

    // 港口停机坪
    helipads.push({ x: 620, z: cz, rotY: -Math.PI / 2 });
  }

  // 主干道霓虹迎宾龙门架（点亮城市大道天际线）
  const archCoords = [
    [roadC(MID), roadC(MID - 2) + BLOCK / 2, 0, neonArchMat],
    [roadC(MID), roadC(MID + 2) + BLOCK / 2, 0, neonArchPinkMat],
    [roadC(MID + 3) + BLOCK / 2, roadC(12), Math.PI / 2, neonArchMat],
    [roadC(MID - 3) + BLOCK / 2, roadC(4), Math.PI / 2, neonArchPinkMat],
  ];
  for (const [ax, az, rot, glowMat] of archCoords) {
    const ag = new THREE.Group();
    ag.position.set(ax, 0, az); ag.rotation.y = rot;
    for (const sx of [-9.0, 9.0]) {
      const p = new THREE.Mesh(boxGeo, mat('#1f2430')); p.scale.set(0.65, 8.2, 0.65); p.position.set(sx, 4.1, 0); ag.add(p);
      const st = new THREE.Mesh(boxGeo, glowMat); st.scale.set(0.18, 7.6, 0.72); st.position.set(sx, 4.1, 0); ag.add(st);
    }
    const bar = new THREE.Mesh(boxGeo, mat('#1f2430')); bar.scale.set(18.8, 0.75, 0.85); bar.position.set(0, 8.2, 0); ag.add(bar);
    const barGlow = new THREE.Mesh(boxGeo, glowMat); barGlow.scale.set(17.6, 0.24, 0.92); barGlow.position.set(0, 8.15, 0); ag.add(barGlow);
    scene.add(fixStatic(ag));
  }

  const dummy = new THREE.Object3D();
  const emitInstanced = (geo, material, list, cast = false, recv = true) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, material, list.length);
    for (let i = 0; i < list.length; i++) {
      const [x, y, z, sx, sy, sz, ry = 0] = list[i];
      dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.castShadow = cast; im.receiveShadow = recv;
    scene.add(setupInstanced(im));
    return im;
  };

  // 按 4×4 空间分块（16 区块）与材质分桶合批建筑，并开启视锥剔除保证 16×16 拓图丝滑 60 FPS
  const metalRoofMat = new THREE.MeshStandardMaterial({ color: '#3c434e', roughness: 0.45, metalness: 0.58, envMap: cityEnvMap, envMapIntensity: 0.8 });
  const sideBuckets = new Map();
  const roofBuckets = new Map();
  function pushQuad(b, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z, v3x, v3y, v3z, nx, ny, nz, u0, v0, u1, v1, u2, v2, u3, v3) {
    const base = b.pos.length / 3;
    b.pos.push(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z, v3x, v3y, v3z);
    b.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    b.uv.push(u0, v0, u1, v1, u2, v2, u3, v3);
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  function getBucket(map, key, matRef) {
    let b = map.get(key);
    if (!b) { b = { mat: matRef, pos: [], nrm: [], uv: [], idx: [] }; map.set(key, b); }
    return b;
  }
  function addBuildingBox(q, x, y0, z, w, h, d, sideMatKey, sideMat, isGlass) {
    const x0 = x, x1 = x + w, y1 = y0 + h, z0 = z, z1 = z + d;
    const rx = Math.max(1, Math.round(w / 3)) / 8;
    const rz = Math.max(1, Math.round(d / 3)) / 8;
    const ry = Math.max(1, Math.round(h / 3.2)) / 8;
    const sb = getBucket(sideBuckets, `${q}|${sideMatKey}`, sideMat);
    pushQuad(sb, x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, 0, 0, rz, 0, rz, ry, 0, ry);
    pushQuad(sb, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, 0, 0, rz, 0, rz, ry, 0, ry);
    pushQuad(sb, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, 0, 0, rx, 0, rx, ry, 0, ry);
    pushQuad(sb, x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, 0, 0, rx, 0, rx, ry, 0, ry);
    const rb = getBucket(roofBuckets, `${q}|${isGlass ? 1 : 0}`, isGlass ? metalRoofMat : roofMat);
    pushQuad(rb, x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1);
  }

  const sidewalks = new THREE.InstancedMesh(boxGeo, sidewalkMat, N * N);
  sidewalks.receiveShadow = true;
  let swIdx = 0;

  const plazasLight = [], plazasDark = [], parkGrasses = [];
  const pedStep1List = [], pedStep2List = [], pedRingList = [];
  const basesDark = [], basesGlass = [], spiresList = [];
  const tankLegs = [], tankBodies = [], tankCaps = [], acList = [];
  const trees = [];
  const pedStep1Geo = new THREE.CylinderGeometry(2.95, 3.25, 0.45, 20);
  const pedStep2Geo = new THREE.CylinderGeometry(2.35, 2.55, 0.85, 20);
  const pedRingGeo = new THREE.CylinderGeometry(2.42, 2.42, 0.06, 20);
  const spireGeo = new THREE.CylinderGeometry(0.08, 0.25, 10, 6);
  const tankGeo = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10);
  const tankCapGeo = new THREE.ConeGeometry(1.25, 0.9, 10);
  const M = 4.5; // 建筑距街区边缘
  for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const bx = blockMin(j), bz = blockMin(k);
    const cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
    dummy.position.set(cx, 0.125, cz); dummy.scale.set(BLOCK, 0.25, BLOCK); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    sidewalks.setMatrixAt(swIdx++, dummy.matrix);
    const cf = 1 - Math.min(1, Math.hypot(cx, cz) / (HALF * 1.1));
    const isSpawn = (j === MID && k === MID);
    const key = `${j},${k}`;
    const lm = LANDMARK_BLOCKS[key];
    const info = { j, k, park: false, rects: [] };
    blockInfo.push(info);
    if (lm) {
      (lm.podium === 'plaza' ? plazasLight : plazasDark).push([cx, 0.27, cz, BLOCK - 2 * M, 0.1, BLOCK - 2 * M]);
      const ch = lm.colliderHalf;
      addCollider({ x0: cx - ch, x1: cx + ch, z0: cz - ch, z1: cz + ch, h: lm.h });
      info.rects.push([cx - ch, cz - ch, ch * 2, ch * 2]);
      landmarkPlacements.push({ id: lm.id, x: cx, z: cz, rotY: lm.rotY });
      if (lm.helipad) helipads.push({ x: cx + lm.helipad[0], z: cz + lm.helipad[1], rotY: lm.helipad[2] });
      continue;
    }
    if (HELIPAD_PLAZA_BLOCKS[key] !== undefined) {
      plazasLight.push([cx, 0.27, cz, BLOCK - 2 * M, 0.1, BLOCK - 2 * M]);
      helipads.push({ x: cx, z: cz, rotY: HELIPAD_PLAZA_BLOCKS[key] });
      continue;
    }
    if (!isSpawn && (GUARANTEED_PARKS.has(key) || Math.random() < 0.05)) {
      info.park = true;
      parkGrasses.push([cx, 0.27, cz, BLOCK - 2 * M, 0.1, BLOCK - 2 * M]);
      pedStep1List.push([cx, 0.475, cz, 1, 1, 1]);
      pedStep2List.push([cx, 1.125, cz, 1, 1, 1]);
      pedRingList.push([cx, 1.56, cz, 1, 1, 1]);
      addCollider({ x0: cx - 2.65, x1: cx + 2.65, z0: cz - 2.65, z1: cz + 2.65, h: 6.8 });
      parks.push({ x: cx, z: cz, j, k, key });
      for (let t = 0; t < 12; t++) {
        const tx = rand(bx + M + 2, bx + BLOCK - M - 2), tz = rand(bz + M + 2, bz + BLOCK - M - 2);
        if (Math.hypot(tx - cx, tz - cz) < 4.5) continue;
        trees.push([tx, tz, rand(0.8, 1.3)]);
        addCollider({ x0: tx - 0.35, x1: tx + 0.35, z0: tz - 0.35, z1: tz + 0.35, h: 6 });
      }
      continue;
    }
    const inner = BLOCK - 2 * M, x0 = bx + M, z0 = bz + M;
    const layout = pick([1, 2, 2, 4, 4]);
    const rects = [];
    if (layout === 1) rects.push([x0, z0, inner, inner]);
    else if (layout === 2) {
      const half = (inner - 4) / 2;
      if (Math.random() < 0.5) rects.push([x0, z0, half, inner], [x0 + half + 4, z0, half, inner]);
      else rects.push([x0, z0, inner, half], [x0, z0 + half + 4, inner, half]);
    } else {
      const half = (inner - 4) / 2;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) rects.push([x0 + a * (half + 4), z0 + b * (half + 4), half, half]);
    }
    for (const [rx, rz, rw, rd] of rects) {
      const ins = Math.random() < 0.4 ? rand(0, 2) : 0;
      const w = rw - ins * 2, d = rd - ins * 2, X = rx + ins, Z = rz + ins;
      const h = rand(8, 20) + cf * cf * rand(18, 82);
      const isGlassTower = h > 34 && Math.random() < 0.58;
      const matPool = isGlassTower ? glassSkyscraperMats : buildingMats;
      const mIdx = Math.floor(Math.random() * matPool.length);
      const bm = matPool[mIdx];
      const sideKey = `${isGlassTower ? 'g' : 'b'}${mIdx}`;
      const qx = clamp(Math.floor((X + w / 2 + HALF) / (SIZE / 4)), 0, 3);
      const qz = clamp(Math.floor((Z + d / 2 + HALF) / (SIZE / 4)), 0, 3);
      const q = qx * 4 + qz;
      addBuildingBox(q, X, 0, Z, w, h, d, sideKey, bm, isGlassTower);
      // 一楼门头/裙楼底座线条
      if (w > 8 && d > 8) {
        (isGlassTower ? basesGlass : basesDark).push([X + w / 2, 1.6, Z + d / 2, w + 0.35, 3.2, d + 0.35]);
      }
      // 摩天大楼顶部退台（纽约/自由城经典剪影）
      let topH = h;
      if (h > 34 && w > 10 && d > 10) {
        const sw2 = w * 0.72, sd2 = d * 0.72, sh2 = rand(7, 15);
        addBuildingBox(q, X + (w - sw2) / 2, h, Z + (d - sd2) / 2, sw2, sh2, sd2, sideKey, bm, isGlassTower);
        topH = h + sh2;
        if (h > 55 && Math.random() < 0.6) spiresList.push([X + w / 2, topH + 5, Z + d / 2, 1, 1, 1]);
      }
      addCollider({ x0: X, x1: X + w, z0: Z, z1: Z + d, h });
      info.rects.push([X, Z, w, d]);
      // 屋顶设备（水箱 / 空调外机）
      if (h > 14 && Math.random() < 0.75) {
        if (h < 40 && Math.random() < 0.45) {
          const wx = X + w / 2 + rand(-w * 0.2, w * 0.2), wz = Z + d / 2 + rand(-d * 0.2, d * 0.2);
          tankLegs.push([wx, topH + 0.7, wz, 1.6, 1.4, 1.6]);
          tankBodies.push([wx, topH + 2.5, wz, 1, 1, 1]);
          tankCaps.push([wx, topH + 4.05, wz, 1, 1, 1]);
        } else {
          const s = rand(2, 3.6), sy = rand(1, 2.2);
          acList.push([X + w / 2 + rand(-w * 0.15, w * 0.15), topH + sy / 2, Z + d / 2 + rand(-d * 0.15, d * 0.15), s, sy, s]);
        }
      }
    }
  }
  for (const b of [...sideBuckets.values(), ...roofBuckets.values()]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, b.mat);
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = true;
    scene.add(fixStatic(m));
  }
  scene.add(setupInstanced(sidewalks));
  emitInstanced(boxGeo, mat('#9fa4ad'), plazasLight, false, true);
  emitInstanced(boxGeo, mat('#2d333d'), plazasDark, false, true);
  emitInstanced(boxGeo, parkMat, parkGrasses, false, true);
  emitInstanced(pedStep1Geo, mat('#b8b5ae'), pedStep1List, false, true);
  emitInstanced(pedStep2Geo, mat('#d2cfc7'), pedStep2List, false, true);
  emitInstanced(pedRingGeo, mat('#c8a84b'), pedRingList, false, false);
  emitInstanced(boxGeo, mat('#2c2e33'), basesDark, false, true);
  emitInstanced(boxGeo, mat('#222730'), basesGlass, false, true);
  emitInstanced(spireGeo, mat('#9aa0a8'), spiresList, false, false);
  emitInstanced(boxGeo, mat('#333'), tankLegs, false, true);
  emitInstanced(tankGeo, mat('#7a5436'), tankBodies, true, true);
  emitInstanced(tankCapGeo, mat('#4b3525'), tankCaps, false, true);
  emitInstanced(boxGeo, mat('#6a6a70'), acList, false, true);

  // 树（实例化双层树冠）
  if (trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.3, 2.6, 7), mat('#5b3e26'), trees.length);
    const crown1 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.75, 1), mat('#2d6828'), trees.length);
    const crown2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.25, 1), mat('#3a8233'), trees.length);
    trees.forEach(([x, z, s], i) => {
      dummy.position.set(x, 1.3 + 0.25, z); dummy.scale.set(1, s, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 3.0 * s + 0.4, z); dummy.scale.set(s, s * 0.95, s); dummy.rotation.y = Math.random() * 3; dummy.updateMatrix(); crown1.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x + 0.25, 4.1 * s + 0.4, z - 0.2); dummy.scale.set(s * 0.9, s * 0.9, s * 0.9); dummy.rotation.y = Math.random() * 3; dummy.updateMatrix(); crown2.setMatrixAt(i, dummy.matrix);
    });
    crown1.castShadow = crown2.castShadow = true;
    scene.add(setupInstanced(trunk), setupInstanced(crown1), setupInstanced(crown2));
  }

  // 路灯（L型挑臂）
  const lamps = [];
  for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) lamps.push([roadC(i) + ROAD / 2 + 0.7, roadC(k) + ROAD / 2 + 0.7]);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.16, 6.5, 7), poleMat, lamps.length);
  const arms = new THREE.InstancedMesh(boxGeo, poleMat, lamps.length);
  const heads = new THREE.InstancedMesh(boxGeo, lampMat, lamps.length);
  lamps.forEach(([x, z], i) => {
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.position.set(x, 3.25, z); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x - 0.55, 6.45, z - 0.55); dummy.rotation.set(0, Math.PI / 4, 0); dummy.scale.set(0.14, 0.14, 1.6); dummy.updateMatrix(); arms.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x - 0.95, 6.32, z - 0.95); dummy.rotation.set(0, Math.PI / 4, 0); dummy.scale.set(0.55, 0.16, 0.85); dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix);
    addCollider({ x0: x - 0.2, x1: x + 0.2, z0: z - 0.2, z1: z + 0.2, h: 6.5 });
  });
  scene.add(setupInstanced(poles), setupInstanced(arms), setupInstanced(heads));

  // 车道线 & 斑马线（实例化，Y=0.045）
  const marks = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) {
    const c = roadC(i), s = blockMin(j), e = s + BLOCK;
    for (let p = s + 5; p < e - 6; p += 6) { marks.push([c, p + 1.5, 0.25, 3]); marks.push([p + 1.5, c, 3, 0.25]); }
    for (const zc of [s + 1.6, e - 1.6]) for (let q = -ROAD / 2 + 1.2; q <= ROAD / 2 - 1.2; q += 1.4) {
      marks.push([c + q, zc, 0.7, 2.4]); marks.push([zc, c + q, 2.4, 0.7]);
    }
  }
  const mk = new THREE.InstancedMesh(boxGeo, markMat, marks.length);
  marks.forEach(([x, z, sx, sz], i) => {
    dummy.rotation.set(0, 0, 0); dummy.position.set(x, 0.045, z); dummy.scale.set(sx, 0.02, sz); dummy.updateMatrix(); mk.setMatrixAt(i, dummy.matrix);
  });
  mk.receiveShadow = false;
  scene.add(setupInstanced(mk));

  // 街道细节：消防栓与垃圾桶（实例化）
  const hydrants = [], bins = [];
  for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const bx = blockMin(j), bz = blockMin(k);
    hydrants.push([bx + 1.2, bz + 3.2], [bx + BLOCK - 1.2, bz + BLOCK - 3.2]);
    bins.push([bx + BLOCK - 1.2, bz + 4.5], [bx + 1.2, bz + BLOCK - 4.5]);
  }
  const hydMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 0.85, 8), mat('#c82020'), hydrants.length);
  hydrants.forEach(([x, z], i) => {
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.position.set(x, 0.67, z); dummy.updateMatrix(); hydMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(setupInstanced(hydMesh));
  const binMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.24, 0.9, 8), mat('#2d4d3a'), bins.length);
  bins.forEach(([x, z], i) => {
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.position.set(x, 0.7, z); dummy.updateMatrix(); binMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(setupInstanced(binMesh));

  // 公园长椅
  if (parks.length) {
    const benches = new THREE.InstancedMesh(boxGeo, mat('#7a4b2a'), parks.length * 4);
    let bi = 0;
    for (const p of parks) {
      for (const [ox, oz, ry] of [[-5, 0, Math.PI / 2], [5, 0, Math.PI / 2], [0, -5, 0], [0, 5, 0]]) {
        dummy.position.set(p.x + ox, 0.55, p.z + oz); dummy.rotation.set(0, ry, 0); dummy.scale.set(2.2, 0.45, 0.7); dummy.updateMatrix();
        benches.setMatrixAt(bi++, dummy.matrix);
      }
    }
    scene.add(setupInstanced(benches));
  }

  // 停机坪标记（市中心、CBD 与港口码头）
  const padMat = mat('#272b34');
  const padRingGeo = new THREE.RingGeometry(3.4, 3.85, 28);
  const padMarkMat = new THREE.MeshBasicMaterial({ color: '#ffd400', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const hp of helipads) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.5, 0.08, 24), padMat);
    base.position.set(hp.x, 0.34, hp.z); base.receiveShadow = true; scene.add(fixStatic(base));
    const ring = new THREE.Mesh(padRingGeo, padMarkMat);
    ring.rotation.x = -Math.PI / 2; ring.position.set(hp.x, 0.395, hp.z); scene.add(fixStatic(ring));
    for (const [ox, oz, sx, sz] of [[-1.1, 0, 0.42, 2.8], [1.1, 0, 0.42, 2.8], [0, 0, 2.2, 0.42]]) {
      const bar = new THREE.Mesh(boxGeo, padMarkMat);
      bar.scale.set(sx, 0.016, sz); bar.position.set(hp.x + ox, 0.405, hp.z + oz); scene.add(fixStatic(bar));
    }
  }

  // 路口红绿灯柱与信号灯
  const tlPoles = [];
  for (let i = 1; i < N; i++) for (let k = 1; k < N; k++) {
    tlPoles.push([roadC(i) - ROAD / 2 - 0.8, roadC(k) - ROAD / 2 - 0.8]);
  }
  const tlPoleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 4.8, 6), poleMat, tlPoles.length);
  const tlBoxMesh = new THREE.InstancedMesh(boxGeo, mat('#1b1b1b'), tlPoles.length);
  tlPoles.forEach(([x, z], i) => {
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.position.set(x, 2.4, z); dummy.updateMatrix(); tlPoleMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 4.6, z); dummy.scale.set(0.45, 0.9, 0.45); dummy.updateMatrix(); tlBoxMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(setupInstanced(tlPoleMesh), setupInstanced(tlBoxMesh));
})();

// 红绿灯共享材质（南北向 / 东西向）
const tlMatNS = new THREE.MeshBasicMaterial({ color: '#20ff40' });
const tlMatEW = new THREE.MeshBasicMaterial({ color: '#ff2828' });
(function addTrafficSignalBulbs() {
  const dummy = new THREE.Object3D();
  const bulbsNS = [], bulbsEW = [];
  for (let i = 1; i < N; i++) for (let k = 1; k < N; k++) {
    const x = roadC(i) - ROAD / 2 - 0.8, z = roadC(k) - ROAD / 2 - 0.8;
    bulbsNS.push([x, z + 0.25], [x, z - 0.25]);
    bulbsEW.push([x + 0.25, z], [x - 0.25, z]);
  }
  const mNS = new THREE.InstancedMesh(boxGeo, tlMatNS, bulbsNS.length);
  const mEW = new THREE.InstancedMesh(boxGeo, tlMatEW, bulbsEW.length);
  bulbsNS.forEach(([x, z], i) => { dummy.position.set(x, 4.6, z); dummy.scale.set(0.24, 0.24, 0.06); dummy.updateMatrix(); mNS.setMatrixAt(i, dummy.matrix); });
  bulbsEW.forEach(([x, z], i) => { dummy.position.set(x, 4.6, z); dummy.scale.set(0.06, 0.24, 0.24); dummy.updateMatrix(); mEW.setMatrixAt(i, dummy.matrix); });
  scene.add(setupInstanced(mNS), setupInstanced(mEW));
})();
let trafficNSGreen = true, trafficYellow = false;

/* ============================ 小地图预渲染 ============================ */
const MAPH = WALL + 95, MS = 0.72;
const mapCanvas = document.createElement('canvas');
mapCanvas.width = mapCanvas.height = Math.ceil(MAPH * 2 * MS);
const mapX = v => (v + MAPH) * MS;
(function renderMap() {
  const g = mapCanvas.getContext('2d');
  g.fillStyle = '#153a5a'; g.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  g.fillStyle = '#23422b'; g.fillRect(mapX(-WALL - 14), mapX(-WALL - 14), (WALL + 14) * 2 * MS, (WALL + 14) * 2 * MS);
  g.fillStyle = '#8d939c'; g.fillRect(mapX(-EDGE), mapX(-EDGE), EDGE * 2 * MS, EDGE * 2 * MS);
  // 双码头在小地图上的轮廓
  g.fillStyle = '#5c4b3b';
  g.fillRect(mapX(SOUTH_PIER.x0), mapX(SOUTH_PIER.z0), (SOUTH_PIER.x1 - SOUTH_PIER.x0) * MS, (SOUTH_PIER.z1 - SOUTH_PIER.z0) * MS);
  g.fillStyle = '#4c5464';
  g.fillRect(mapX(EAST_PIER.x0), mapX(EAST_PIER.z0), (EAST_PIER.x1 - EAST_PIER.x0) * MS, (EAST_PIER.z1 - EAST_PIER.z0) * MS);
  for (const b of blockInfo) {
    const x = blockMin(b.j), z = blockMin(b.k);
    g.fillStyle = b.park ? '#2f6a38' : '#2b3242';
    g.fillRect(mapX(x), mapX(z), BLOCK * MS, BLOCK * MS);
    g.fillStyle = '#3d465c';
    for (const [rx, rz, rw, rd] of b.rects) g.fillRect(mapX(rx), mapX(rz), rw * MS, rd * MS);
  }
})();

/* ============================ 粒子 & 弹道 ============================ */
const PART_N = 300, parts = [];
const partGeo = new THREE.IcosahedronGeometry(1, 0);
for (let i = 0; i < PART_N; i++) {
  const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: true }));
  m.visible = false; scene.add(m);
  parts.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, g: 0, s0: 1, grow: 0 });
}
let partIdx = 0;
function emit(x, y, z, vx, vy, vz, color, size, life, grav = 0, grow = 0) {
  const p = parts[partIdx = (partIdx + 1) % PART_N];
  p.m.position.set(x, y, z); p.vx = vx; p.vy = vy; p.vz = vz;
  p.m.material.color.set(color); p.m.material.opacity = 1;
  p.s0 = size; p.grow = grow; p.life = p.max = life; p.g = grav;
  p.m.scale.setScalar(size); p.m.visible = true;
}
function updateParticles(dt) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.m.visible = false; continue; }
    p.vy += p.g * dt;
    const pos = p.m.position;
    pos.x += p.vx * dt; pos.y += p.vy * dt; pos.z += p.vz * dt;
    if (pos.y < 0.05) { pos.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
    p.m.scale.setScalar(p.s0 + p.grow * (p.max - p.life));
    p.m.material.opacity = clamp(p.life / p.max * 1.5, 0, 1);
  }
}
const tracers = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true }));
  l.frustumCulled = false; l.visible = false; scene.add(l);
  tracers.push({ l, life: 0 });
}
let trIdx = 0;
function tracer(a, b) {
  const t = tracers[trIdx = (trIdx + 1) % tracers.length];
  const arr = t.l.geometry.attributes.position.array;
  arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
  t.l.geometry.attributes.position.needsUpdate = true;
  t.life = 0.07; t.l.visible = true; t.l.material.opacity = 1;
}
function updateTracers(dt) {
  for (const t of tracers) if (t.life > 0) {
    t.life -= dt; t.l.material.opacity = clamp(t.life / 0.07, 0, 1);
    if (t.life <= 0) t.l.visible = false;
  }
}

/* ============================ 音效 (WebAudio 合成) ============================ */
let actx = null, master, noiseBuf, engOsc, engSubOsc, engGain, engFilter, sirenOsc, sirenGain;
let heliGain, heliModGain, heliLfo, heliFilter, skidGain, skidFilter;
function initAudio() {
  if (actx) { actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 双谐波汽车引擎声
    engOsc = actx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 50;
    engSubOsc = actx.createOscillator(); engSubOsc.type = 'triangle'; engSubOsc.frequency.value = 25;
    const engSubGain = actx.createGain(); engSubGain.gain.value = 0.65;
    engFilter = actx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 500;
    engGain = actx.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilter);
    engSubOsc.connect(engSubGain).connect(engFilter);
    engFilter.connect(engGain).connect(master);
    engOsc.start(); engSubOsc.start();
    // 轮胎漂移啸叫滤波噪声
    const skidSrc = actx.createBufferSource(); skidSrc.buffer = noiseBuf; skidSrc.loop = true;
    skidFilter = actx.createBiquadFilter(); skidFilter.type = 'bandpass'; skidFilter.frequency.value = 1350; skidFilter.Q.value = 4.2;
    skidGain = actx.createGain(); skidGain.gain.value = 0;
    skidSrc.connect(skidFilter).connect(skidGain).connect(master);
    skidSrc.start();

    sirenOsc = actx.createOscillator(); sirenOsc.type = 'triangle'; sirenOsc.frequency.value = 700;
    sirenGain = actx.createGain(); sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain).connect(master); sirenOsc.start();
    // 直升机旋翼拍击声（循环噪声 + LFO 周期脉冲）
    const heliSrc = actx.createBufferSource(); heliSrc.buffer = noiseBuf; heliSrc.loop = true;
    heliFilter = actx.createBiquadFilter(); heliFilter.type = 'lowpass'; heliFilter.frequency.value = 340;
    heliModGain = actx.createGain(); heliModGain.gain.value = 0.55;
    heliLfo = actx.createOscillator(); heliLfo.type = 'sine'; heliLfo.frequency.value = 9;
    const heliLfoDepth = actx.createGain(); heliLfoDepth.gain.value = 0.45;
    heliLfo.connect(heliLfoDepth).connect(heliModGain.gain);
    heliGain = actx.createGain(); heliGain.gain.value = 0;
    heliSrc.connect(heliFilter).connect(heliModGain).connect(heliGain).connect(master);
    heliSrc.start(); heliLfo.start();
  } catch (e) { actx = null; }
}
function playNoise(dur, freq, vol, type = 'lowpass') {
  if (!actx || vol <= 0.01) return;
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = actx.createGain(); const t = actx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur);
}
function playTone(freq, dur, vol, type = 'square') {
  if (!actx) return;
  const o = actx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = actx.createGain(); const t = actx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur);
}
const sndGun = (vol = 1) => { playNoise(0.16, 2600, 0.55 * vol); playTone(90, 0.1, 0.25 * vol, 'sine'); };
function sndWeapon(id) {
  if (!actx) return;
  if (id === 'pistol') {
    playNoise(0.13, 3000, 0.48); playTone(120, 0.08, 0.22, 'sine');
  } else if (id === 'smg') {
    playNoise(0.09, 3400, 0.36); playTone(145, 0.055, 0.16, 'triangle');
  } else if (id === 'shotgun') {
    playNoise(0.28, 1750, 0.78); playTone(68, 0.16, 0.42, 'sine');
    setTimeout(() => { playNoise(0.05, 2200, 0.12, 'bandpass'); }, 220);
    setTimeout(() => { playNoise(0.06, 2600, 0.14, 'bandpass'); }, 320);
  } else if (id === 'rifle') {
    playNoise(0.15, 3200, 0.56); playTone(105, 0.09, 0.28, 'sawtooth');
  } else if (id === 'sniper') {
    playNoise(0.36, 2400, 0.85); playTone(56, 0.22, 0.48, 'sine'); playTone(220, 0.11, 0.18, 'triangle');
    setTimeout(() => { playTone(620, 0.04, 0.08, 'triangle'); }, 480);
    setTimeout(() => { playTone(480, 0.05, 0.08, 'triangle'); }, 600);
  } else {
    sndGun(0.9);
  }
}
const sndAutocannon = () => { playNoise(0.12, 1600, 0.42); playTone(82, 0.08, 0.26, 'sawtooth'); };
const sndStep = (grass = false) => { playNoise(0.045, grass ? 650 : 1200, grass ? 0.045 : 0.06); };
const sndDodge = () => { playNoise(0.20, 950, 0.22, 'bandpass'); playTone(180, 0.14, 0.09, 'sine'); };
const sndNitro = () => { playNoise(0.18, 1800, 0.18, 'bandpass'); playTone(140, 0.15, 0.10, 'sawtooth'); };
const sndHit = (head = false) => { playTone(head ? 1480 : 920, 0.048, head ? 0.18 : 0.1, 'triangle'); if (head) setTimeout(() => playTone(1960, 0.05, 0.10, 'sine'), 25); };
const sndBoom = (vol = 1) => { playNoise(1.6, 420, 1.2 * vol); playTone(45, 0.8, 0.6 * vol, 'sine'); };
const sndCrash = (vol = 1) => playNoise(0.35, 900, 0.6 * vol);
const sndPickup = () => { playTone(880, 0.1, 0.15, 'sine'); setTimeout(() => playTone(1320, 0.15, 0.15, 'sine'), 80); };
const sndShift = (up, isSport) => {
  playTone(up ? 115 : 165, 0.055, 0.15, 'triangle');
  playNoise(0.06, 520, 0.14);
  if (up && isSport) setTimeout(() => playNoise(0.1, 1800, 0.18), 40);
};
const sndEnlighten = () => {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
    setTimeout(() => playTone(f, 0.42, 0.12, 'sine'), idx * 85);
  });
};
const sndTheophanyChord = () => {
  if (!actx) return;
  [110, 164.81, 220, 329.63, 440].forEach((f, i) => {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = i < 2 ? 'triangle' : 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(i < 2 ? 0.09 : 0.065, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.9);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 3.0);
  });
};
const sndGodShatter = () => {
  if (!actx) return;
  playTone(55, 1.35, 0.42, 'sine');
  playNoise(0.95, 2200, 0.55);
  [1760, 2349, 2793, 3520, 4186].forEach((f, i) => {
    setTimeout(() => playTone(f, 0.36, 0.09, 'triangle'), i * 52);
  });
  setTimeout(() => sndEnlighten(), 2300);
};
const sndSmokePoof = () => {
  playNoise(0.26, 1100, 0.13);
  playTone(360, 0.16, 0.05, 'sine');
};
const sndLaugh = () => {
  if (!actx) return;
  [520, 630, 500, 610, 470, 580].forEach((f, idx) => {
    setTimeout(() => playTone(f, 0.095, 0.075, 'triangle'), idx * 130);
    setTimeout(() => playTone(f * 0.68, 0.105, 0.065, 'triangle'), idx * 130 + 70);
  });
};

// 柔边青烟精灵贴图与缓冲池（替换原先多边形颗粒，论道青烟轻盈如水墨云缕）
const smokeSoftTex = (function buildSoftSmokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0.0, 'rgba(220,255,250,0.95)');
  grd.addColorStop(0.35, 'rgba(158,244,228,0.62)');
  grd.addColorStop(0.7, 'rgba(110,215,198,0.22)');
  grd.addColorStop(1.0, 'rgba(90,200,185,0.0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const SMOKE_SPRITE_N = 72;
const smokeSprites = [];
for (let i = 0; i < SMOKE_SPRITE_N; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: smokeSoftTex, color: '#a5f3e6', transparent: true, opacity: 0, depthWrite: false, fog: true,
  }));
  sp.visible = false;
  scene.add(sp);
  smokeSprites.push({ sp, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 0.4, s1: 1.2, maxOp: 0.5 });
}
let smokeSpriteIdx = 0;
function emitSoftSmoke(x, y, z, vx, vy, vz, color, s0, s1, life, maxOp = 0.48) {
  const p = smokeSprites[smokeSpriteIdx = (smokeSpriteIdx + 1) % SMOKE_SPRITE_N];
  p.sp.position.set(x, y, z);
  p.sp.material.color.set(color);
  p.sp.material.opacity = 0;
  p.sp.scale.setScalar(s0);
  p.sp.visible = true;
  p.vx = vx; p.vy = vy; p.vz = vz;
  p.s0 = s0; p.s1 = s1; p.life = p.max = life; p.maxOp = maxOp;
}
const smokeWisps = [];
function spawnCyanSmoke(x, y, z, dur = 3.2, burst = true) {
  smokeWisps.push({ x, y, z, life: dur, age: 0, tick: 0, seed: Math.random() * Math.PI * 2 });
  if (burst) {
    const cols = ['#9ff6e6', '#c6fcf2', '#7de0cf'];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + rand(-0.2, 0.2);
      const sp = rand(0.28, 0.72);
      emitSoftSmoke(
        x + Math.cos(a) * 0.16, y + rand(0.05, 0.35), z + Math.sin(a) * 0.16,
        Math.cos(a) * sp, rand(1.0, 1.8), Math.sin(a) * sp,
        cols[i % cols.length], rand(0.42, 0.62), rand(1.05, 1.48), rand(1.1, 1.65), 0.52
      );
    }
  }
}
function updateSmokeWisps(dt) {
  const cols = ['#9ff6e6', '#c6fcf2', '#7de0cf'];
  for (let i = smokeWisps.length - 1; i >= 0; i--) {
    const w = smokeWisps[i];
    w.life -= dt; w.age += dt; w.tick -= dt;
    if (w.tick <= 0 && w.life > 0) {
      w.tick = 0.085;
      const a = w.age * 3.8 + w.seed;
      const r = 0.12 + w.age * 0.07;
      emitSoftSmoke(
        w.x + Math.cos(a) * r, w.y + Math.min(w.age * 0.32, 0.95), w.z + Math.sin(a) * r,
        -Math.sin(a) * 0.18 + rand(-0.08, 0.08), rand(1.25, 1.85), Math.cos(a) * 0.18 + rand(-0.08, 0.08),
        cols[Math.floor(Math.random() * cols.length)], rand(0.36, 0.50), rand(1.0, 1.45), rand(1.5, 2.2), 0.42
      );
    }
    if (w.life <= 0) smokeWisps.splice(i, 1);
  }
  for (const p of smokeSprites) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.sp.visible = false; continue; }
    const u = 1 - p.life / p.max;
    p.sp.position.x += p.vx * dt;
    p.sp.position.y += p.vy * dt;
    p.sp.position.z += p.vz * dt;
    p.vx *= Math.exp(-0.9 * dt);
    p.vz *= Math.exp(-0.9 * dt);
    p.sp.scale.setScalar(lerp(p.s0, p.s1, u));
    const fade = u < 0.2 ? (u / 0.2) : Math.pow(clamp((1 - u) / 0.8, 0, 1), 1.25);
    p.sp.material.opacity = fade * p.maxOp;
  }
}

/* ============================ 角色模型 ============================ */
function part(w, h, d, color, parent, x, y, z, shadow = false) {
  const m = new THREE.Mesh(boxGeo, mat(color));
  m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = shadow;
  parent.add(m); return m;
}
const SHIRTS = ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#34495e', '#d35400', '#16a085', '#7f8c8d', '#e84393'];
const PANTS = ['#2c3e50', '#1b1b1b', '#3d5a80', '#6d4c41', '#555555', '#2d3436'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const HAIRS = ['#1b1209', '#3b2412', '#6b4423', '#c9a15a', '#222'];
function makeHuman(shirt, pants, skin = pick(SKINS), hair = pick(HAIRS), opts = {}) {
  const g = new THREE.Group();
  const torsoPivot = new THREE.Group();
  g.add(torsoPivot);

  // 躯干 + 胸肌/夹克层次 + 腰带 + 领口
  part(0.54, 0.62, 0.29, shirt, torsoPivot, 0, 1.15, 0, true);
  part(0.46, 0.28, 0.04, shirt, torsoPivot, 0, 1.28, 0.14);
  part(0.56, 0.08, 0.31, '#1a1a1a', torsoPivot, 0, 0.84, 0);
  part(0.1, 0.07, 0.03, '#c8a850', torsoPivot, 0, 0.84, 0.16);
  part(0.21, 0.10, 0.19, skin, torsoPivot, 0, 1.49, 0);
  if (opts.vest) {
    part(0.57, 0.46, 0.33, '#171c28', torsoPivot, 0, 1.18, 0);
    part(0.10, 0.08, 0.02, '#ffd400', torsoPivot, -0.15, 1.32, 0.17); // 警徽
  }
  if (opts.tie) part(0.08, 0.32, 0.03, opts.tie, torsoPivot, 0, 1.24, 0.16);
  if (opts.apron) part(0.46, 0.56, 0.04, '#2b303a', torsoPivot, 0, 1.02, 0.16);
  if (opts.bandana) part(0.32, 0.10, 0.31, opts.bandana, torsoPivot, 0, 1.46, 0.01);
  if (opts.camera) {
    part(0.18, 0.11, 0.09, '#1a1b1f', torsoPivot, 0.06, 1.16, 0.18);
    part(0.07, 0.07, 0.07, '#4c5260', torsoPivot, 0.06, 1.16, 0.23);
  }

  // 可转动头部枢轴（五官高光 + 多样发型/帽饰）
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.54, 0);
  torsoPivot.add(headPivot);
  part(0.29, 0.32, 0.29, skin, headPivot, 0, 0.15, 0, true);
  part(0.05, 0.09, 0.06, skin, headPivot, -0.15, 0.15, 0);
  part(0.05, 0.09, 0.06, skin, headPivot, 0.15, 0.15, 0);
  part(0.04, 0.07, 0.05, skin, headPivot, 0, 0.14, 0.15);
  part(0.06, 0.038, 0.028, '#f8fafc', headPivot, -0.065, 0.18, 0.143);
  part(0.06, 0.038, 0.028, '#f8fafc', headPivot, 0.065, 0.18, 0.143);
  part(0.034, 0.036, 0.032, '#16181e', headPivot, -0.062, 0.18, 0.147);
  part(0.034, 0.036, 0.032, '#16181e', headPivot, 0.062, 0.18, 0.147);
  part(0.08, 0.018, 0.02, hair, headPivot, -0.065, 0.215, 0.148);
  part(0.08, 0.018, 0.02, hair, headPivot, 0.065, 0.215, 0.148);
  if (opts.glasses) {
    part(0.24, 0.045, 0.03, '#111520', headPivot, 0, 0.18, 0.156);
    part(0.08, 0.04, 0.032, '#38d9ff', headPivot, -0.065, 0.18, 0.157);
    part(0.08, 0.04, 0.032, '#38d9ff', headPivot, 0.065, 0.18, 0.157);
  }
  part(0.31, 0.11, 0.31, hair, headPivot, 0, 0.33, -0.01);
  part(0.31, opts.ponytail ? 0.24 : 0.17, 0.12, hair, headPivot, 0, 0.21, -0.11);
  part(0.22, 0.05, 0.22, hair, headPivot, 0, 0.39, 0);
  if (opts.cap) {
    part(0.33, 0.11, 0.34, opts.cap, headPivot, 0, 0.35, 0.01);
    part(0.30, 0.03, 0.16, '#141820', headPivot, 0, 0.30, 0.18);
  } else if (opts.fedora) {
    part(0.40, 0.03, 0.40, '#2a2b30', headPivot, 0, 0.33, 0);
    part(0.28, 0.11, 0.28, '#2a2b30', headPivot, 0, 0.39, 0);
  }

  const pivot = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); g.add(p); return p; };
  const legL = pivot(-0.14, 0.82), legR = pivot(0.14, 0.82), armL = pivot(-0.36, 1.42), armR = pivot(0.36, 1.42);
  part(0.18, 0.12, 0.21, shirt, armL, 0, -0.02, 0); part(0.18, 0.12, 0.21, shirt, armR, 0, -0.02, 0);
  part(0.21, 0.72, 0.24, pants, legL, 0, -0.36, 0, true); part(0.21, 0.72, 0.24, pants, legR, 0, -0.36, 0, true);
  part(0.22, 0.11, 0.33, '#1a1512', legL, 0, -0.76, 0.04, true); part(0.22, 0.11, 0.33, '#1a1512', legR, 0, -0.76, 0.04, true);
  part(0.155, 0.54, 0.185, shirt, armL, 0, -0.28, 0); part(0.155, 0.54, 0.185, shirt, armR, 0, -0.28, 0);
  part(0.14, 0.13, 0.15, skin, armL, 0, -0.62, 0); part(0.14, 0.13, 0.15, skin, armR, 0, -0.62, 0);
  scene.add(g);
  return { g, torsoPivot, headPivot, legL, legR, armL, armR };
}
function animHuman(hm, phase, amt, opts = {}) {
  const s = Math.sin(phase) * amt;
  const idle = amt < 0.05;
  hm.legL.rotation.x = s * 0.85; hm.legR.rotation.x = -s * 0.85;
  if (opts.flee) {
    hm.armL.rotation.x = -1.3 + s * 0.45; hm.armR.rotation.x = -1.3 - s * 0.45;
  } else {
    hm.armL.rotation.x = -s * 0.65; hm.armR.rotation.x = s * 0.65;
  }
  if (hm.torsoPivot) {
    hm.torsoPivot.position.y = idle ? Math.sin(gameTime * 2.2) * 0.008 : Math.abs(Math.sin(phase)) * 0.032 * amt;
    hm.torsoPivot.rotation.y = -s * 0.08;
    hm.torsoPivot.rotation.x = (opts.sprint ? 0.12 : 0.04 * amt) + (opts.hit ? -0.18 : 0);
  }
  if (hm.headPivot) {
    hm.headPivot.rotation.y = idle ? Math.sin(gameTime * 0.9) * 0.10 : s * 0.06;
    hm.headPivot.rotation.x = idle ? Math.sin(gameTime * 1.9) * 0.03 : 0;
  }
}

/* ============================ 哲学家 NPC 与动作神态 ============================ */
function makeSageHuman(cfg) {
  const g = new THREE.Group();
  const torsoPivot = new THREE.Group();
  g.add(torsoPivot);

  const skin = cfg.skin || '#ecc89e';
  const robe = cfg.robe;
  const trim = cfg.trim || robe;
  const pants = cfg.pants || robe;

  // 躯干与服饰层次
  part(0.56, 0.66, 0.31, robe, torsoPivot, 0, 1.15, 0, true);
  part(0.48, 0.32, 0.05, trim, torsoPivot, 0, 1.24, 0.14);
  if (cfg.sash) part(0.58, 0.10, 0.33, cfg.sash, torsoPivot, 0, 0.88, 0);
  if (cfg.robeSkirt) part(0.56, 0.58, 0.33, robe, torsoPivot, 0, 0.55, 0, true);
  if (cfg.coatTail) {
    part(0.58, 0.64, 0.10, robe, torsoPivot, 0, 0.54, -0.14, true);
    part(0.18, 0.14, 0.06, '#f4f6fa', torsoPivot, 0, 1.41, 0.15);
  }
  part(0.22, 0.09, 0.2, skin, torsoPivot, 0, 1.49, 0);

  // 可活动头部枢轴
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.54, 0);
  torsoPivot.add(headPivot);
  part(0.29, 0.32, 0.29, skin, headPivot, 0, 0.15, 0, true);
  part(0.05, 0.09, 0.06, skin, headPivot, -0.15, 0.15, 0);
  part(0.05, 0.09, 0.06, skin, headPivot, 0.15, 0.15, 0);
  part(0.04, 0.07, 0.05, skin, headPivot, 0, 0.14, 0.15);
  part(0.058, 0.036, 0.03, '#f8fafc', headPivot, -0.065, 0.18, 0.143);
  part(0.058, 0.036, 0.03, '#f8fafc', headPivot, 0.065, 0.18, 0.143);
  part(0.036, 0.036, 0.032, '#1b1b1b', headPivot, -0.064, 0.18, 0.146);
  part(0.036, 0.036, 0.032, '#1b1b1b', headPivot, 0.064, 0.18, 0.146);

  const hair = cfg.hair || '#d8d8d8';
  if (cfg.wig) {
    part(0.35, 0.14, 0.34, '#e6e8ef', headPivot, 0, 0.33, -0.01);
    part(0.36, 0.26, 0.14, '#e6e8ef', headPivot, 0, 0.18, -0.10);
  } else {
    part(0.31, 0.11, 0.31, hair, headPivot, 0, 0.33, -0.01);
    part(0.31, cfg.longHair ? 0.28 : 0.16, 0.12, hair, headPivot, 0, cfg.longHair ? 0.14 : 0.21, -0.11);
  }
  if (cfg.bun) {
    part(0.12, 0.11, 0.12, hair, headPivot, 0, 0.42, -0.04);
    part(0.26, 0.02, 0.02, '#c8a050', headPivot, 0, 0.42, -0.04);
  }
  if (cfg.laurel) {
    const wr = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.024, 6, 16), mat('#e5b83b'));
    wr.rotation.x = Math.PI / 2 - 0.15; wr.position.set(0, 0.30, 0); headPivot.add(wr);
  }
  if (cfg.beard === 'full') {
    part(0.24, 0.18, 0.14, cfg.beardCol || hair, headPivot, 0, 0.02, 0.10);
    part(0.16, 0.12, 0.10, cfg.beardCol || hair, headPivot, 0, -0.08, 0.11);
  } else if (cfg.beard === 'long') {
    part(0.22, 0.16, 0.12, cfg.beardCol || hair, headPivot, 0, 0.03, 0.11);
    part(0.13, 0.24, 0.08, cfg.beardCol || hair, headPivot, 0, -0.12, 0.12);
  } else if (cfg.beard === 'mustache') {
    part(0.20, 0.06, 0.06, cfg.beardCol || hair, headPivot, 0, 0.09, 0.155);
  } else if (cfg.beard === 'goatee') {
    part(0.12, 0.035, 0.04, hair, headPivot, 0, 0.09, 0.15);
    part(0.06, 0.08, 0.05, hair, headPivot, 0, 0.01, 0.145);
  }

  const pivot = (x, y, p = g) => { const gr = new THREE.Group(); gr.position.set(x, y, 0); p.add(gr); return gr; };
  const legL = pivot(-0.14, 0.82), legR = pivot(0.14, 0.82);
  const armL = pivot(-0.37, 1.42, torsoPivot), armR = pivot(0.37, 1.42, torsoPivot);
  part(0.21, 0.72, 0.24, pants, legL, 0, -0.36, 0, true);
  part(0.21, 0.72, 0.24, pants, legR, 0, -0.36, 0, true);
  part(0.22, 0.11, 0.33, cfg.shoe || '#3b281c', legL, 0, -0.76, 0.04, true);
  part(0.22, 0.11, 0.33, cfg.shoe || '#3b281c', legR, 0, -0.76, 0.04, true);

  const sleeveW = cfg.wideSleeve ? 0.22 : 0.16;
  part(0.18, 0.12, 0.21, robe, armL, 0, -0.02, 0); part(0.18, 0.12, 0.21, robe, armR, 0, -0.02, 0);
  part(sleeveW, 0.54, cfg.wideSleeve ? 0.25 : 0.19, robe, armL, 0, -0.28, 0);
  part(sleeveW, 0.54, cfg.wideSleeve ? 0.25 : 0.19, robe, armR, 0, -0.28, 0);
  part(0.14, 0.13, 0.15, skin, armL, 0, -0.62, 0); part(0.14, 0.13, 0.15, skin, armR, 0, -0.62, 0);

  // 哲学家专属手持/伴身法器道具（升级细腻度）
  const extras = {};
  if (cfg.prop === 'scroll') {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.40, 12), mat('#f2dfb8'));
    sc.rotation.z = 0.35; sc.position.set(0, -0.64, 0.12); armL.add(sc);
    part(0.065, 0.065, 0.065, '#d4af37', sc, 0, 0.21, 0); part(0.065, 0.065, 0.065, '#d4af37', sc, 0, -0.21, 0);
  } else if (cfg.prop === 'cup') {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.046, 0.12, 10), mat('#7a5230'));
    cup.position.set(0, -0.64, 0.11); armL.add(cup);
  } else if (cfg.prop === 'butterflies') {
    const bfs = [];
    const bfMats = [
      new THREE.MeshBasicMaterial({ color: '#ffd966', side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: '#88f3e2', side: THREE.DoubleSide }),
    ];
    for (let i = 0; i < 4; i++) {
      const bf = new THREE.Group();
      const bm = bfMats[i % 2];
      const wL = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.16), bm); wL.position.x = -0.065;
      const wR = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.16), bm); wR.position.x = 0.065;
      bf.add(wL, wR); g.add(bf);
      bfs.push({ bf, wL, wR, off: i * Math.PI * 0.5, rad: 0.68 + (i % 2) * 0.22 });
    }
    extras.butterflies = bfs;
  } else if (cfg.prop === 'crystal') {
    const cg = new THREE.Group(); cg.position.set(0, -0.60, 0.22);
    const cry = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.13, 0),
      new THREE.MeshBasicMaterial({ color: '#60efff', transparent: true, opacity: 0.90 })
    );
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.012, 6, 20), new THREE.MeshBasicMaterial({ color: '#a5f3fc' }));
    cg.add(cry, ring); armL.add(cg);
    extras.crystal = cry; extras.cryRing = ring;
  } else if (cfg.prop === 'watch') {
    const watch = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.032, 12), mat('#e8c15a'));
    watch.rotation.x = Math.PI / 2; watch.position.set(0, -0.64, 0.11);
    armL.add(watch);
  } else if (cfg.prop === 'hammer') {
    const hg = new THREE.Group(); hg.position.set(0, -0.62, 0.18);
    part(0.05, 0.05, 0.58, '#3b2416', hg, 0, 0, 0.14);
    const headMesh = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#ffca45' }));
    headMesh.scale.set(0.26, 0.15, 0.15); headMesh.position.set(0, 0, 0.44);
    hg.add(headMesh); armR.add(hg);
  }

  scene.add(g);
  return { g, torsoPivot, headPivot, legL, legR, armL, armR, extras };
}

function animPhilosopher(ph, t, talking) {
  const { sm, gesture } = ph;
  const { torsoPivot, headPivot, armL, armR, legL, legR, extras } = sm;
  const emp = talking ? 1.45 : 1.0;
  torsoPivot.position.y = Math.sin(t * 2.1) * 0.008;
  torsoPivot.rotation.set(0, 0, 0);
  headPivot.rotation.set(0, 0, 0);
  legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
  armL.rotation.set(0, 0, 0); armR.rotation.set(0, 0, 0);

  if (gesture === 'peripatetic') {
    armL.rotation.set(-0.95, 0, -0.15);
    armR.rotation.set(-0.65 + Math.sin(t * 2.4) * 0.26 * emp, 0, -0.22);
    headPivot.rotation.x = 0.08 + Math.sin(t * 1.9) * 0.10 * emp;
    torsoPivot.rotation.y = Math.sin(t * 0.9) * 0.14;
  } else if (gesture === 'socratic') {
    armL.rotation.set(-1.35 + Math.sin(t * 1.6) * 0.08, 0, 0.38);
    armR.rotation.set(-0.85 + Math.sin(t * 3.1) * 0.32 * emp, 0.25, -0.35 - Math.abs(Math.sin(t * 1.6)) * 0.25);
    headPivot.rotation.z = Math.sin(t * 1.4) * 0.18;
    headPivot.rotation.y = Math.sin(t * 2.1) * 0.16 * emp;
    torsoPivot.rotation.x = 0.06;
  } else if (gesture === 'butterfly') {
    armL.rotation.set(-0.55 + Math.sin(t * 1.3) * 0.25 * emp, 0, 0.45 + Math.cos(t * 1.3) * 0.15);
    armR.rotation.set(-0.55 - Math.sin(t * 1.3) * 0.25 * emp, 0, -0.45 - Math.cos(t * 1.3) * 0.15);
    torsoPivot.rotation.y = Math.sin(t * 0.7) * 0.22;
    headPivot.rotation.x = -0.18 + Math.sin(t * 1.1) * 0.08;
    if (extras.butterflies) {
      for (const b of extras.butterflies) {
        const a = t * 1.7 + b.off;
        b.bf.position.set(Math.cos(a) * b.rad, 1.46 + Math.sin(a * 2.2) * 0.28, Math.sin(a) * b.rad);
        b.bf.rotation.y = -a + Math.PI / 2;
        const fl = Math.sin(t * 18 + b.off) * 0.78;
        b.wL.rotation.y = fl; b.wR.rotation.y = -fl;
      }
    }
  } else if (gesture === 'cogito') {
    armL.rotation.set(-1.05, 0, -0.18);
    armR.rotation.set(-1.55 + Math.sin(t * 2.0) * 0.12 * emp, -0.25, 0.35);
    headPivot.rotation.x = 0.16 + Math.sin(t * 1.5) * 0.06;
    if (extras.crystal) {
      extras.crystal.rotation.y = t * 2.2;
      extras.crystal.rotation.x = t * 1.4;
      if (extras.cryRing) { extras.cryRing.rotation.x = t * 1.8; extras.cryRing.rotation.y = -t * 1.3; }
    }
  } else if (gesture === 'starry') {
    // 康德：使用平滑插值在「看怀表守时」与「仰望灿烂星空」之间柔和过渡，杜绝机械瞬切
    const u = clamp(Math.sin(t * 0.45) * 2.2 + 0.5, 0, 1);
    const gaze = u * u * (3 - 2 * u);
    armR.rotation.set(lerp(-0.25, -2.35 + Math.sin(t * 1.8) * 0.10 * emp, gaze), 0, lerp(-0.10, -0.20, gaze));
    armL.rotation.set(lerp(-1.25, -1.15, gaze), 0, lerp(0.20, 0.42, gaze));
    headPivot.rotation.x = lerp(0.28, -0.42, gaze);
  } else if (gesture === 'hammer') {
    const swing = Math.sin(t * 2.7);
    armR.rotation.set(-1.85 + swing * 0.48 * emp, 0, -0.28);
    armL.rotation.set(-0.55 - swing * 0.18, 0, 0.28);
    headPivot.rotation.x = -0.22 + Math.sin(t * 1.6) * 0.08;
    torsoPivot.rotation.x = -0.07;
  }
}

/* ============================ 车辆模型与座舱质感贴图 ============================ */
const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 22); wheelGeo.rotateZ(Math.PI / 2);
const rimBarrelGeo = new THREE.CylinderGeometry(0.255, 0.255, 0.264, 22); rimBarrelGeo.rotateZ(Math.PI / 2);
const rimLipGeo = new THREE.TorusGeometry(0.246, 0.020, 8, 24); rimLipGeo.rotateY(Math.PI / 2);
const rotorGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.018, 18); rotorGeo.rotateZ(Math.PI / 2);
const capGeo = new THREE.CylinderGeometry(0.060, 0.060, 0.022, 12); capGeo.rotateZ(Math.PI / 2);
const lugGeo = new THREE.CylinderGeometry(0.010, 0.010, 0.014, 6); lugGeo.rotateZ(Math.PI / 2);
const bezelRingGeo = new THREE.TorusGeometry(0.068, 0.008, 6, 20);
const knobDialGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.022, 12); knobDialGeo.rotateX(Math.PI / 2);
const pipeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 8); pipeGeo.rotateX(Math.PI / 2);
const steerRimGeo = new THREE.TorusGeometry(0.165, 0.024, 10, 24);
const knobGeo = new THREE.SphereGeometry(0.032, 10, 8);
const rimMat = new THREE.MeshStandardMaterial({ color: '#c8cdd4', roughness: 0.24, metalness: 0.86 });
const chromeMat = new THREE.MeshStandardMaterial({ color: '#dce2e8', roughness: 0.18, metalness: 0.92 });
const carTrimMat = new THREE.MeshStandardMaterial({ color: '#39404c', roughness: 0.32, metalness: 0.68 });
const carMirrorMat = new THREE.MeshStandardMaterial({ color: '#dbe5ef', roughness: 0.06, metalness: 0.96, envMap: cityEnvMap, envMapIntensity: 1.8 });

const dashDialTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#090e16'; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1e3a5f'; g.lineWidth = 5; g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i <= 24; i++) {
    const a = (Math.PI * 0.72) + (i / 24) * (Math.PI * 1.56);
    const maj = i % 3 === 0;
    const isRed = i >= 20;
    g.strokeStyle = isRed ? '#ff3b3b' : (maj ? '#e2f1ff' : 'rgba(140,205,255,0.55)');
    g.lineWidth = maj ? 4 : 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * (maj ? 88 : 97), 128 + Math.sin(a) * (maj ? 88 : 97));
    g.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110);
    g.stroke();
    if (maj) {
      g.fillStyle = isRed ? '#ff6b6b' : '#b8e1ff';
      g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i / 3), 128 + Math.cos(a) * 69, 128 + Math.sin(a) * 69);
    }
  }
  g.fillStyle = '#1a2433'; g.beginPath(); g.arc(128, 128, 18, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const dashDialMat = new THREE.MeshBasicMaterial({ map: dashDialTex });

const gpsScreenTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160;
  const g = cv.getContext('2d');
  g.fillStyle = '#09111d'; g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#15304a'; g.lineWidth = 2;
  for (let x = 24; x < 240; x += 36) { g.beginPath(); g.moveTo(x, 22); g.lineTo(x, 134); g.stroke(); }
  for (let y = 28; y < 140; y += 28) { g.beginPath(); g.moveTo(10, y); g.lineTo(246, y); g.stroke(); }
  g.strokeStyle = '#00e5ff'; g.lineWidth = 4.5;
  g.beginPath(); g.moveTo(32, 118); g.lineTo(96, 118); g.lineTo(96, 62); g.lineTo(188, 62); g.lineTo(212, 34); g.stroke();
  g.fillStyle = '#ffd400'; g.beginPath(); g.arc(96, 92, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, 256, 22); g.fillRect(0, 136, 256, 24);
  g.fillStyle = '#7be8ff'; g.font = 'bold 11px sans-serif'; g.fillText('LIBERTY NAV · 0.8 km', 8, 15);
  g.fillStyle = '#cde6ff'; g.font = '11px sans-serif'; g.fillText('FM 98.4  ♪  NIGHT CITY', 8, 152);
  g.fillStyle = '#ffd43b'; g.fillText('AC 21.5°C', 194, 152);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const gpsScreenMat = new THREE.MeshBasicMaterial({ map: gpsScreenTex });

const leatherMat = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#1c1d22'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) {
    g.fillStyle = ((x + y) & 8) ? '#23252b' : '#18191e';
    g.fillRect(x, y, 4, 4);
  }
  g.strokeStyle = '#333640'; g.lineWidth = 2; g.setLineDash([4, 3]);
  g.beginPath(); g.moveTo(0, 16); g.lineTo(128, 16); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.78, metalness: 0.05 });
})();

const CAR_COLORS = ['#b71c1c', '#0d47a1', '#e0e0e0', '#212121', '#f9a825', '#2e7d32', '#6a1b9a', '#455a64', '#8d6e63', '#c62828', '#1565c0', '#9e9e9e', '#ff7043', '#00bcd4', '#e91e63'];
const CAR_TYPES = {
  sedan:  { name: '轿车',   hp: 500, accel: 17, maxSpeed: 39, bodyH: 0.58, cabH: 0.46, cabZ: 1.9, wheelR: 0.38 },
  sport:  { name: '跑车',   hp: 480, accel: 27, maxSpeed: 56, bodyH: 0.46, cabH: 0.36, cabZ: 1.55, wheelR: 0.36, spoiler: true },
  hyper:  { name: '超跑',   hp: 520, accel: 35, maxSpeed: 68, bodyH: 0.40, cabH: 0.32, cabZ: 1.48, wheelR: 0.36, spoiler: true, hyper: true },
  suv:    { name: 'SUV',    hp: 700, accel: 16, maxSpeed: 38, bodyH: 0.72, cabH: 0.56, cabZ: 2.55, wheelR: 0.44, rack: true },
  taxi:   { name: '出租车', hp: 520, accel: 18, maxSpeed: 40, bodyH: 0.58, cabH: 0.46, cabZ: 1.9, wheelR: 0.38 },
  police: { name: '警车',   hp: 740, accel: 26, maxSpeed: 50, bodyH: 0.60, cabH: 0.46, cabZ: 1.9, wheelR: 0.38 },
};
function makeCarMesh(color, kind) {
  const cfg = CAR_TYPES[kind] || CAR_TYPES.sedan;
  const police = kind === 'police', taxi = kind === 'taxi', sport = kind === 'sport' || !!cfg.hyper, hyper = !!cfg.hyper;
  const g = new THREE.Group();
  const root = new THREE.Group(); // 用于悬挂俯仰/侧倾
  g.add(root);
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: hyper ? 0.16 : sport ? 0.22 : 0.3,
    metalness: hyper ? 0.72 : sport ? 0.60 : 0.48,
  });
  const tlMat = new THREE.MeshStandardMaterial({ color: '#801010', emissive: '#ff2020', emissiveIntensity: hyper ? 0.65 : 0.4 });
  const underglowCol = hyper ? '#00e5ff' : '#38bdf8';
  const underglowMat = new THREE.MeshBasicMaterial({ color: underglowCol, transparent: true, opacity: hyper ? 0.45 : 0, depthWrite: false });
  const baseClr = hyper ? 0.29 : sport ? 0.33 : 0.38;
  const bodyY = baseClr + cfg.bodyH / 2;
  const topY = bodyY + cfg.bodyH / 2;

  // 车身拆分：前舱 + 后备箱 + 中空座舱（地板 + 两侧车门）
  const cabFront = -0.25 + cfg.cabZ / 2, cabBack = -0.25 - cfg.cabZ / 2, cabLen = cabFront - cabBack;
  const frontLen = 2.225 - cabFront, rearLen = cabBack + 2.225;
  const addBody = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(boxGeo, bodyMat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; root.add(m); return m; };
  addBody(2.0, cfg.bodyH, frontLen, 0, bodyY, cabFront + frontLen / 2);
  addBody(2.0, cfg.bodyH, rearLen, 0, bodyY, cabBack - rearLen / 2);
  addBody(0.08, cfg.bodyH, cabLen, 0.96, bodyY, -0.25);
  addBody(0.08, cfg.bodyH, cabLen, -0.96, bodyY, -0.25);
  const floorTop = hyper ? 0.39 : sport ? 0.44 : 0.5;
  const floor = new THREE.Mesh(boxGeo, mat('#16171b')); floor.scale.set(1.86, 0.12, cabLen); floor.position.set(0, floorTop - 0.06, -0.25); root.add(floor);
  const hood = new THREE.Mesh(boxGeo, bodyMat); hood.scale.set(1.88, 0.08, 1.35); hood.position.set(0, topY + (hyper ? -0.02 : 0.03), 1.45); hood.rotation.x = hyper ? 0.13 : sport ? 0.07 : 0.02; root.add(hood);
  const trunk = new THREE.Mesh(boxGeo, bodyMat); trunk.scale.set(1.88, 0.06, 0.85); trunk.position.set(0, topY + 0.02, -1.7); root.add(trunk);

  // 流线座舱（玻璃与车顶）
  const cabY = topY + cfg.cabH / 2;
  const glass = new THREE.Mesh(boxGeo, glassMat); glass.scale.set(1.74, cfg.cabH, cfg.cabZ - 0.15); glass.position.set(0, cabY, -0.25); root.add(glass);
  const roofY = topY + cfg.cabH + 0.03;

  /* ---------- 精细第一人称车辆座舱内饰 ---------- */
  const interior = new THREE.Group(); root.add(interior);
  const s = (roofY - floorTop) / 0.95;
  const seatCol = police ? '#1b1c22' : hyper ? '#2d1216' : pick(['#3b2a20', '#23252c', '#544336', '#1c2838', '#421d20']);
  const seatZ = cabFront - 0.95 * s;
  const ip = (w, h, d, col, x, y, z, parent = interior) => { const m = new THREE.Mesh(boxGeo, typeof col === 'string' ? mat(col) : col); m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m; };

  // 顶棚、遮阳板、阅读灯总成、防眩目后视镜与雨刮器
  ip(1.66, 0.03, cfg.cabZ - 0.35, '#34363d', 0, roofY - 0.065, -0.25);
  ip(0.22, 0.025, 0.14, '#24262c', 0, roofY - 0.08, cabFront - 0.20); // 顶棚控制盒
  ip(0.06, 0.01, 0.04, '#fff4cc', -0.05, roofY - 0.095, cabFront - 0.20);
  ip(0.06, 0.01, 0.04, '#fff4cc', 0.05, roofY - 0.095, cabFront - 0.20);
  for (const sx of [-0.42, 0.42]) {
    const visor = ip(0.42, 0.018, 0.13, '#2b2d34', sx, roofY - 0.088, cabFront - 0.12);
    visor.rotation.x = 0.25;
  }
  ip(0.02, 0.07, 0.02, '#141518', 0, roofY - 0.09, cabFront - 0.10); // 后视镜支架
  ip(0.26, 0.075, 0.024, '#111216', 0, roofY - 0.125, cabFront - 0.105);
  ip(0.24, 0.062, 0.008, carMirrorMat, 0, roofY - 0.125, cabFront - 0.118); // 反光内后视镜镜面
  // 挡风玻璃下沿雨刮器
  ip(0.56, 0.018, 0.025, '#121316', -0.32, topY + 0.05, cabFront + 0.14, root).rotation.z = -0.06;
  ip(0.56, 0.018, 0.025, '#121316', 0.32, topY + 0.05, cabFront + 0.14, root).rotation.z = -0.06;

  // 多层包覆仪表台 + 副驾金属拉丝饰条 + 仪表遮光罩 + 空调出风口
  ip(1.80, 0.26 * s, 0.36, leatherMat, 0, floorTop + 0.49 * s, cabFront - 0.18);
  ip(1.74, 0.045 * s, 0.34, leatherMat, 0, floorTop + 0.64 * s, cabFront - 0.19); // 上仪表台软包边
  ip(0.72, 0.055 * s, 0.025, hyper ? '#b71c1c' : carTrimMat, -0.44, floorTop + 0.54 * s, cabFront - 0.365); // 副驾装饰面板
  ip(0.48, 0.15 * s, 0.16, leatherMat, 0.45, floorTop + 0.67 * s, cabFront - 0.31); // 驾驶仪表遮光帽檐
  ip(0.38, 0.11 * s, 0.02, '#0b0e14', 0.45, floorTop + 0.61 * s, cabFront - 0.395); // 仪表黑底面板

  // 中控台堆栈：带亮黑框 GPS 导航大屏 + 空调百叶出风口 + 3 枚金属旋钮 + 警示灯按键 + 排挡/手刹/油门刹车踏板
  ip(0.33, 0.185 * s, 0.028, '#0c0d11', 0, floorTop + 0.51 * s, cabFront - 0.365);
  ip(0.28, 0.135 * s, 0.012, gpsScreenMat, 0, floorTop + 0.52 * s, cabFront - 0.382); // GPS 实景地图中控屏
  ip(0.32, 0.04 * s, 0.02, '#13151a', 0, floorTop + 0.635 * s, cabFront - 0.365);     // 中央空调出风口
  for (const vx of [-0.08, 0.08]) ip(0.11, 0.008 * s, 0.025, carTrimMat, vx, floorTop + 0.635 * s, cabFront - 0.372);
  ip(0.14, 0.06 * s, 0.025, '#13151a', 0.78, floorTop + 0.55 * s, cabFront - 0.365);   // 驾驶侧左出风口
  ip(0.11, 0.008 * s, 0.03, carTrimMat, 0.78, floorTop + 0.55 * s, cabFront - 0.372);
  ip(0.32, 0.08 * s, 0.025, '#15171d', 0, floorTop + 0.39 * s, cabFront - 0.362);    // 空调物理控制面板
  for (const kx of [-0.085, 0, 0.085]) {
    const kn = new THREE.Mesh(knobDialGeo, rimMat); kn.position.set(kx, floorTop + 0.39 * s, cabFront - 0.376); interior.add(kn);
  }
  ip(0.03, 0.02 * s, 0.02, '#e53935', 0, floorTop + 0.605 * s, cabFront - 0.375);     // 双闪红色按钮

  // 中央地台通道 + 皮革换挡防尘罩 + 金属排挡槽框 + 双杯架 + 手刹 + 中央扶手箱
  ip(0.24, 0.14 * s, 0.96 * s, '#16171c', 0, floorTop + 0.07 * s, seatZ + 0.18 * s);
  ip(0.22, 0.04 * s, 0.34 * s, leatherMat, 0, floorTop + 0.16 * s, seatZ - 0.12 * s); // 扶手箱皮垫
  ip(0.15, 0.015, 0.18, carTrimMat, 0, floorTop + 0.145 * s, seatZ + 0.42 * s);       // 排挡金属框
  ip(0.08, 0.04 * s, 0.08, leatherMat, 0, floorTop + 0.16 * s, seatZ + 0.42 * s);     // 换挡防尘套
  for (const cz of [seatZ + 0.16 * s, seatZ + 0.25 * s]) {
    ip(0.07, 0.012, 0.07, '#090a0c', 0, floorTop + 0.145 * s, cz);                   // 双杯架
  }
  const hbrake = ip(0.026, 0.026, 0.18, '#1a1b20', -0.075, floorTop + 0.17 * s, seatZ + 0.18 * s); // 机械手刹
  hbrake.rotation.x = 0.28;
  // 金属防滑油门与刹车踏板
  ip(0.05, 0.11 * s, 0.015, rimMat, 0.36, floorTop + 0.11 * s, cabFront - 0.14).rotation.x = -0.5;
  ip(0.08, 0.08 * s, 0.015, rimMat, 0.47, floorTop + 0.12 * s, cabFront - 0.14).rotation.x = -0.5;

  // 精致内门饰板（扶手、拉手金属条、车窗按键与扬声器）
  for (const sx of [-1, 1]) {
    ip(0.055, 0.34 * s, cabLen * 0.78, leatherMat, sx * 0.90, floorTop + 0.34 * s, -0.25);
    ip(0.068, 0.07 * s, cabLen * 0.56, '#262830', sx * 0.88, floorTop + 0.35 * s, -0.25); // 门板扶手
    ip(0.02, 0.024 * s, 0.10, chromeMat, sx * 0.865, floorTop + 0.48 * s, cabFront - 0.42 * s); // 内门拉手
    ip(0.02, 0.11 * s, 0.11, '#121316', sx * 0.868, floorTop + 0.19 * s, cabFront - 0.32 * s);  // 门板音响喇叭罩
  }

  // 双筒圆盘机械仪表（带表盘刻度贴图 + 金属表圈 + 中心液晶小屏 + 红色发光指针）
  const needles = [];
  for (const gx of [0.355, 0.545]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.068 * s, 24), dashDialMat);
    face.rotation.y = Math.PI;
    face.position.set(gx, floorTop + 0.61 * s, cabFront - 0.408);
    interior.add(face);
    const bz = new THREE.Mesh(bezelRingGeo, chromeMat);
    bz.scale.setScalar(s);
    bz.position.set(gx, floorTop + 0.61 * s, cabFront - 0.409);
    interior.add(bz);
    const np = new THREE.Group(); np.position.set(gx, floorTop + 0.61 * s, cabFront - 0.413); interior.add(np);
    const nd = new THREE.Mesh(boxGeo, needleMat); nd.scale.set(0.006, 0.052 * s, 0.004); nd.position.y = 0.024 * s; np.add(nd);
    needles.push(np);
  }
  ip(0.055, 0.068 * s, 0.008, gaugeMat, 0.45, floorTop + 0.61 * s, cabFront - 0.407); // 行车电脑小屏

  // 三辐人体工学运动方向盘（9点/3点/6点金属辐条 + 换挡拨片 + 转向灯拨杆 + 12点回正红标）
  const swPivot = new THREE.Group(); swPivot.position.set(0.45, floorTop + 0.61 * s, seatZ + 0.50 * s); swPivot.rotation.x = 0.35; interior.add(swPivot);
  const steerWheel = new THREE.Group(); swPivot.add(steerWheel);
  const rim = new THREE.Mesh(steerRimGeo, leatherMat); rim.scale.setScalar(s); steerWheel.add(rim);
  ip(0.30 * s, 0.032, 0.018, carTrimMat, 0, 0, 0, steerWheel);                 // 9点/3点横辐
  ip(0.038, 0.145 * s, 0.018, carTrimMat, 0, -0.076 * s, 0, steerWheel);       // 6点下纵辐
  ip(0.095 * s, 0.088 * s, 0.032, leatherMat, 0, 0, 0.008, steerWheel);        // 中心气囊盖
  ip(0.026 * s, 0.026 * s, 0.036, '#ffd400', 0, 0, 0.012, steerWheel);         // 金属中心徽标
  ip(0.022 * s, 0.048 * s, 0.048 * s, '#ff2e3a', 0, 0.165 * s, 0, steerWheel); // 12点方向回正环
  for (const sx of [-1, 1]) {
    ip(0.032 * s, 0.085 * s, 0.008, carTrimMat, sx * 0.105 * s, 0.015 * s, 0.036, steerWheel); // 方向盘后换挡拨片
    ip(0.09, 0.014, 0.014, '#1b1c20', sx * 0.075, 0.01, 0.055, swPivot).rotation.z = -sx * 0.18; // 转向灯/雨刮拨杆
  }
  ip(0.068, 0.068, 0.28, '#151517', 0.45, floorTop + 0.57 * s, seatZ + 0.66 * s);

  // 前排桶形包裹座椅（座垫 + 靠背 + 侧翼 + 头枕）
  for (const sx of [0.45, -0.45]) {
    ip(0.50, 0.13 * s, 0.50 * s, seatCol, sx, floorTop + 0.17 * s, seatZ);
    const back = ip(0.48, 0.60 * s, 0.12, seatCol, sx, floorTop + 0.52 * s, seatZ - 0.28 * s);
    back.rotation.x = -0.14;
    for (const bx of [-0.24, 0.24]) {
      const bol = ip(0.07, 0.44 * s, 0.15, seatCol, sx + bx, floorTop + 0.48 * s, seatZ - 0.24 * s);
      bol.rotation.x = -0.14;
    }
    ip(0.28, 0.12 * s, 0.10, seatCol, sx, floorTop + 0.88 * s, seatZ - 0.33 * s);
  }
  if (cfg.cabZ >= 1.8) {
    ip(1.5, 0.13 * s, 0.45 * s, seatCol, 0, floorTop + 0.17 * s, cabBack + 0.4 * s);
    ip(1.5, 0.55 * s, 0.12, seatCol, 0, floorTop + 0.5 * s, cabBack + 0.14 * s).rotation.x = -0.12;
  }
  // 挡杆（H 档位会随档位移动）
  const gearLever = new THREE.Group(); gearLever.position.set(0, floorTop + 0.15 * s, seatZ + 0.42 * s); interior.add(gearLever);
  ip(0.022, 0.15 * s, 0.022, chromeMat, 0, 0.075 * s, 0, gearLever);
  const knob = new THREE.Mesh(knobGeo, mat(hyper ? '#e53935' : '#252830')); knob.position.y = 0.165 * s; gearLever.add(knob);
  // A 柱（挡风玻璃两侧）
  const fRake = hyper ? -0.66 : -0.58;
  for (const sx of [-0.86, 0.86]) {
    const ap = ip(0.06, cfg.cabH * 1.15, 0.06, '#18181c', sx, cabY - 0.02, cabFront + 0.12, root);
    ap.rotation.x = fRake;
  }
  // 司机（坐姿）
  const drv = new THREE.Group(); drv.position.set(0.45, floorTop, seatZ); drv.scale.setScalar(s); root.add(drv);
  const drvShirt = police ? '#1d2c5a' : pick(SHIRTS), drvSkin = pick(SKINS);
  const drvTorso = ip(0.4, 0.42, 0.22, drvShirt, 0, 0.46, -0.04, drv);
  ip(0.2, 0.22, 0.2, drvSkin, 0, 0.8, -0.02, drv);
  ip(0.21, 0.07, 0.21, police ? '#0d1530' : pick(HAIRS), 0, 0.93, -0.03, drv);
  for (const ax of [-0.15, 0.15]) {
    const arm = ip(0.08, 0.08, 0.36, drvShirt, ax, 0.56, 0.17, drv); arm.rotation.x = 0.35;
    ip(0.14, 0.12, 0.42, police ? '#111a33' : '#2c3e50', ax * 0.7, 0.26, 0.16, drv); // 大腿
  }
  const eye = { x: 0.45, y: floorTop + 0.80 * s, z: seatZ - 0.02 };
  const roof = new THREE.Mesh(boxGeo, hyper ? mat('#18191e') : bodyMat); roof.scale.set(1.78, 0.09, cfg.cabZ - 0.25); roof.position.set(0, roofY, -0.25); roof.castShadow = true; root.add(roof);
  // 倾斜前挡风玻璃 & 后挡风玻璃
  const fGlass = new THREE.Mesh(boxGeo, glassMat);
  fGlass.scale.set(1.7, cfg.cabH * (hyper ? 1.24 : 1.15), 0.06);
  fGlass.position.set(0, cabY - 0.02, -0.25 + cfg.cabZ / 2 + 0.12);
  fGlass.rotation.x = fRake; root.add(fGlass);
  const rGlass = new THREE.Mesh(boxGeo, glassMat);
  rGlass.scale.set(1.7, cfg.cabH * (hyper ? 1.22 : 1.12), 0.06);
  rGlass.position.set(0, cabY - 0.02, -0.25 - cfg.cabZ / 2 - 0.08);
  rGlass.rotation.x = kind === 'suv' ? 0.2 : hyper ? 0.74 : 0.62; root.add(rGlass);

  // 左右后视镜 + 门把手 + B 柱 + 侧裙 + 轮眉
  for (const sx of [-1, 1]) {
    const mir = new THREE.Mesh(boxGeo, hyper ? mat('#18191e') : bodyMat); mir.scale.set(0.18, 0.10, 0.14); mir.position.set(sx * 1.06, topY + 0.12, 0.62); root.add(mir);
    const h1 = new THREE.Mesh(boxGeo, chromeMat); h1.scale.set(0.05, 0.04, 0.16); h1.position.set(sx * 1.01, topY - 0.12, 0.15); root.add(h1);
    if (!hyper) {
      const h2 = new THREE.Mesh(boxGeo, chromeMat); h2.scale.set(0.05, 0.04, 0.16); h2.position.set(sx * 1.01, topY - 0.12, -0.75); root.add(h2);
    }
    const bPil = new THREE.Mesh(boxGeo, mat('#18181c')); bPil.scale.set(0.05, cfg.cabH + 0.02, 0.12); bPil.position.set(sx * 0.88, cabY, -0.25); root.add(bPil);
    const skirt = new THREE.Mesh(boxGeo, mat('#15161a')); skirt.scale.set(0.09, 0.09, 2.25); skirt.position.set(sx * 1.01, baseClr - 0.03, 0); root.add(skirt);
    for (const wz of [1.42, -1.42]) {
      const arch = new THREE.Mesh(boxGeo, mat('#1b1c20')); arch.scale.set(0.08, 0.15, 0.84); arch.position.set(sx * 1.0, cfg.wheelR + 0.32, wz); root.add(arch);
    }
  }

  // 前脸：进气格栅、LED大灯灯眉、一体尾灯带、前后保险杠、车牌、双出/四出排气管
  const grille = new THREE.Mesh(boxGeo, mat('#151618')); grille.scale.set(hyper ? 1.25 : 0.95, hyper ? 0.18 : 0.24, 0.06); grille.position.set(0, bodyY - 0.03, 2.23); root.add(grille);
  const grilleBar = new THREE.Mesh(boxGeo, hyper ? headMat : chromeMat); grilleBar.scale.set(hyper ? 1.18 : 0.9, 0.035, 0.07); grilleBar.position.set(0, bodyY - (hyper ? 0.03 : 0), 2.24); root.add(grilleBar);
  const plateF = new THREE.Mesh(boxGeo, mat('#e8e8e0')); plateF.scale.set(0.45, 0.13, 0.04); plateF.position.set(0, baseClr + 0.04, 2.27); root.add(plateF);
  const plateR = new THREE.Mesh(boxGeo, mat('#e8e8e0')); plateR.scale.set(0.45, 0.13, 0.04); plateR.position.set(0, bodyY - 0.04, -2.24); root.add(plateR);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(boxGeo, headMat); hl.scale.set(hyper ? 0.48 : 0.42, hyper ? 0.10 : 0.16, 0.06); hl.position.set(sx * 0.68, bodyY + (hyper ? 0.04 : 0.06), 2.23); root.add(hl);
    const tl = new THREE.Mesh(boxGeo, tlMat); tl.scale.set(hyper ? 0.56 : 0.44, hyper ? 0.09 : 0.15, 0.06); tl.position.set(sx * (hyper ? 0.60 : 0.66), bodyY + 0.08, -2.23); root.add(tl);
    const pipe = new THREE.Mesh(pipeGeo, chromeMat); pipe.position.set(sx * 0.62, baseClr - 0.02, -2.25); root.add(pipe);
    if (sport) {
      const pipeIn = new THREE.Mesh(pipeGeo, chromeMat); pipeIn.position.set(sx * 0.46, baseClr - 0.02, -2.25); root.add(pipeIn);
    }
  }
  if (sport) {
    const ledBar = new THREE.Mesh(boxGeo, tlMat); ledBar.scale.set(1.75, 0.04, 0.05); ledBar.position.set(0, bodyY + 0.08, -2.235); root.add(ledBar);
    const splitter = new THREE.Mesh(boxGeo, mat('#131418')); splitter.scale.set(2.08, 0.06, 0.42); splitter.position.set(0, baseClr - 0.06, 2.16); root.add(splitter);
    const diffuser = new THREE.Mesh(boxGeo, mat('#131418')); diffuser.scale.set(1.92, 0.14, 0.34); diffuser.position.set(0, baseClr - 0.02, -2.14); root.add(diffuser);
  }
  const bumper = new THREE.Mesh(boxGeo, mat('#1f1f22')); bumper.scale.set(2.05, 0.16, 4.55); bumper.position.y = baseClr + 0.02; root.add(bumper);

  // 底盘霓虹灯带（超跑常亮 & 任意车辆氮气加速时点亮）
  const ug = new THREE.Mesh(boxGeo, underglowMat);
  ug.scale.set(1.66, 0.03, 3.4);
  ug.position.set(0, 0.13, 0);
  root.add(ug);

  // 跑车/超跑：引擎进气口 + 天鹅颈尾翼
  if (cfg.spoiler) {
    const intake = new THREE.Mesh(boxGeo, mat('#151515')); intake.scale.set(0.62, 0.06, 0.46); intake.position.set(0, hyper ? roofY + 0.06 : topY + 0.04, hyper ? -0.42 : 1.35); root.add(intake);
    const sp = new THREE.Mesh(boxGeo, hyper ? mat('#141518') : bodyMat); sp.scale.set(hyper ? 2.04 : 1.9, 0.06, hyper ? 0.40 : 0.34); sp.position.set(0, topY + (hyper ? 0.32 : 0.26), -2.02); root.add(sp);
    if (hyper) {
      for (const sx of [-1.02, 1.02]) {
        const endp = new THREE.Mesh(boxGeo, bodyMat); endp.scale.set(0.04, 0.18, 0.44); endp.position.set(sx, topY + 0.30, -2.02); root.add(endp);
      }
    }
    for (const sx of [-0.62, 0.62]) {
      const leg = new THREE.Mesh(boxGeo, mat('#1b1b1b')); leg.scale.set(0.07, hyper ? 0.30 : 0.24, 0.18); leg.position.set(sx, topY + (hyper ? 0.17 : 0.14), -2.02); root.add(leg);
    }
  }
  // SUV：车顶行李架 + 后挂备胎
  if (cfg.rack) {
    for (const sx of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(boxGeo, mat('#222')); rail.scale.set(0.07, 0.08, 2.1); rail.position.set(sx, roofY + 0.08, -0.25); root.add(rail);
    }
    const spare = new THREE.Mesh(wheelGeo, tireMat); spare.rotation.y = Math.PI / 2; spare.scale.set(0.85, 0.9, 0.9); spare.position.set(0, bodyY + 0.12, -2.3); root.add(spare);
    const spareBarrel = new THREE.Mesh(rimBarrelGeo, mat('#15171c')); spareBarrel.rotation.y = Math.PI / 2; spareBarrel.scale.set(0.85, 0.9, 0.9); spareBarrel.position.copy(spare.position); root.add(spareBarrel);
    const spareLip = new THREE.Mesh(rimLipGeo, rimMat); spareLip.position.set(0, 0, -0.126); spare.add(spareLip);
  }

  // 车轮（内缩轮辋 + 金属轮唇 + 严格径向辐条 + 制动盘与红色卡钳 + 平齐中心盖与螺栓）
  const wheels = [], pivots = [];
  const ws = cfg.wheelR / 0.38;
  const barrelMat = mat('#131519');
  const spokeMat = hyper ? chromeMat : mat(sport ? '#d4dae2' : '#aab2bc');
  const rotorMat = mat('#7c8490'), caliperMat = mat('#d32f2f'), capMat = mat(hyper ? '#ffd43b' : '#23262e');
  for (const [x, z] of [[-1.01, 1.42], [1.01, 1.42], [-1.01, -1.42], [1.01, -1.42]]) {
    const p = new THREE.Group(); p.position.set(x, cfg.wheelR, z); g.add(p);
    const outSign = x < 0 ? -1 : 1;
    // 不随轮转动的刹车盘与红色卡钳（收纳在轮辋桶内，绝不穿出轮胎）
    const rotor = new THREE.Mesh(rotorGeo, rotorMat);
    rotor.scale.set(1, ws, ws); rotor.position.x = outSign * 0.035; p.add(rotor);
    const cal = new THREE.Mesh(boxGeo, caliperMat);
    cal.scale.set(0.065, 0.13 * ws, 0.095 * ws);
    cal.position.set(outSign * 0.045, 0.045 * ws, z > 0 ? -0.115 * ws : 0.115 * ws);
    p.add(cal);

    const w = new THREE.Mesh(wheelGeo, tireMat); w.scale.set(1, ws, ws); p.add(w);
    const barrel = new THREE.Mesh(rimBarrelGeo, barrelMat); w.add(barrel);
    const lip = new THREE.Mesh(rimLipGeo, rimMat); lip.position.x = outSign * 0.128; w.add(lip);

    const spokeCount = sport ? 5 : 5;
    for (let si = 0; si < spokeCount; si++) {
      const ang = (si / spokeCount) * Math.PI * 2;
      if (sport) {
        for (const split of [-0.14, 0.14]) {
          const spPivot = new THREE.Group(); spPivot.position.x = outSign * 0.124; spPivot.rotation.x = ang + split;
          const spk = new THREE.Mesh(boxGeo, spokeMat);
          spk.scale.set(0.015, 0.195, 0.022); spk.position.y = 0.132; spk.rotation.x = split * -0.5;
          spPivot.add(spk); w.add(spPivot);
        }
      } else {
        const spPivot = new THREE.Group(); spPivot.position.x = outSign * 0.124; spPivot.rotation.x = ang;
        const spk = new THREE.Mesh(boxGeo, spokeMat);
        spk.scale.set(0.016, 0.195, 0.036); spk.position.y = 0.130;
        spPivot.add(spk); w.add(spPivot);
      }
      const lugPivot = new THREE.Group(); lugPivot.position.x = outSign * 0.128; lugPivot.rotation.x = ang + (sport ? 0 : Math.PI / 5);
      const lug = new THREE.Mesh(lugGeo, chromeMat); lug.position.y = 0.036;
      lugPivot.add(lug); w.add(lugPivot);
    }
    const cap = new THREE.Mesh(capGeo, capMat); cap.position.x = outSign * 0.124; w.add(cap);
    wheels.push(w); pivots.push(p);
  }

  let lightR = null, lightB = null;
  if (police) {
    for (const sx of [-1.005, 1.005]) { const stripe = new THREE.Mesh(boxGeo, mat('#f2f2f2')); stripe.scale.set(0.03, 0.26, 2.45); stripe.position.set(sx, bodyY + 0.04, -0.1); root.add(stripe); }
    const pushBar = new THREE.Mesh(boxGeo, mat('#161618')); pushBar.scale.set(1.05, 0.34, 0.14); pushBar.position.set(0, 0.56, 2.31); root.add(pushBar);
    const barMid = new THREE.Mesh(boxGeo, mat('#d8dde2')); barMid.scale.set(0.32, 0.16, 0.28); barMid.position.set(0, roofY + 0.12, -0.25); root.add(barMid);
    lightR = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#550000' })); lightR.scale.set(0.55, 0.16, 0.28); lightR.position.set(-0.44, roofY + 0.12, -0.25); root.add(lightR);
    lightB = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#000055' })); lightB.scale.set(0.55, 0.16, 0.28); lightB.position.set(0.44, roofY + 0.12, -0.25); root.add(lightB);
  }
  if (taxi) {
    const sign = new THREE.Mesh(boxGeo, mat('#fff3b0')); sign.scale.set(0.76, 0.22, 0.32); sign.position.set(0, roofY + 0.15, -0.25); root.add(sign);
    for (const sx of [-1.005, 1.005]) { const band = new THREE.Mesh(boxGeo, mat('#1c1c1c')); band.scale.set(0.03, 0.09, 2.2); band.position.set(sx, bodyY + 0.12, -0.1); root.add(band); }
  }
  scene.add(g);
  return { g, root, bodyMat, tlMat, underglowMat, isHyper: hyper, wheels, pivots, lightR, lightB, interior, drv, drvTorso, steerWheel, needles, gearLever, eye };
}

/* ============================ 直升机模型 & 状态 ============================ */
const helis = [];
const bladeGeo = new THREE.BoxGeometry(0.18, 0.025, 4.4);
const rotorDiscGeo = new THREE.CylinderGeometry(4.5, 4.5, 0.02, 24);
const tailBladeGeo = new THREE.BoxGeometry(0.02, 0.72, 0.09);
const navRedMat = new THREE.MeshBasicMaterial({ color: '#ff2828' });
const navGreenMat = new THREE.MeshBasicMaterial({ color: '#22ff66' });
const navStrobeMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const heliGlassMat = new THREE.MeshStandardMaterial({ color: '#8cc2e8', roughness: 0.08, metalness: 0.35, envMap: cityEnvMap, envMapIntensity: 1.4, transparent: true, opacity: 0.30, depthWrite: false });

function makeHeliMesh(bodyCol = '#c62828', stripeCol = '#ffd43b') {
  const g = new THREE.Group();
  const root = new THREE.Group();
  g.add(root);

  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.28, metalness: 0.52 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: stripeCol, roughness: 0.35, metalness: 0.35 });
  const darkMat = mat('#1a1c22');
  const metalMat = rimMat;

  const hp = (sx, sy, sz, m, x, y, z, parent = root, shadow = false) => {
    const mesh = new THREE.Mesh(boxGeo, typeof m === 'string' ? mat(m) : m);
    mesh.scale.set(sx, sy, sz); mesh.position.set(x, y, z);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // 起落架滑橇与斜撑
  for (const sx of [-1, 1]) {
    hp(0.09, 0.09, 4.2, metalMat, sx * 1.12, 0.08, 0.1, root, true);
    hp(0.08, 0.08, 0.35, metalMat, sx * 1.12, 0.16, 2.25, root).rotation.x = -0.5;
    for (const sz of [-0.75, 0.95]) {
      const st = hp(0.07, 0.72, 0.07, metalMat, sx * 0.96, 0.38, sz, root);
      st.rotation.z = sx * -0.34;
    }
  }

  // 主机身（中空透明风挡座舱）
  hp(1.76, 0.22, 3.3, darkMat, 0, 0.72, 0.15, root, true);      // 座舱底盘
  hp(1.80, 0.26, 2.5, stripeMat, 0, 0.86, -0.1, root, false);    // 机身腰线饰条
  hp(1.82, 1.05, 1.55, bodyMat, 0, 1.48, -0.78, root, true);     // 后段舱壁与发动机仓
  hp(1.56, 0.55, 1.15, bodyMat, 0, 0.96, 1.85, root, true);      // 流线机头下腹
  hp(1.42, 0.34, 0.65, darkMat, 0, 1.12, 2.45, root, true).rotation.x = 0.24; // 机鼻前端
  // 双联机鼻 20mm 机炮吊舱与炮管
  const gunTips = [];
  for (const sx of [-1, 1]) {
    hp(0.18, 0.16, 0.58, darkMat, sx * 0.72, 0.82, 1.98, root);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.78, 8), rimMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(sx * 0.72, 0.82, 2.52);
    root.add(barrel);
    const tip = new THREE.Object3D();
    tip.position.set(sx * 0.72, 0.82, 2.94);
    root.add(tip);
    gunTips.push(tip);
  }
  const [gunL, gunR] = gunTips;
  // 顶部涡轴引擎整流罩与双排气口
  hp(1.24, 0.56, 2.2, bodyMat, 0, 2.18, -0.45, root, true);
  hp(0.75, 0.28, 0.9, '#23262e', 0, 2.26, 0.65, root);
  for (const sx of [-0.36, 0.36]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.55, 10), darkMat);
    ex.rotation.x = Math.PI / 2; ex.position.set(sx, 2.12, -1.65); root.add(ex);
  }
  // 两侧舱门下框与 A 柱
  for (const sx of [-1, 1]) {
    hp(0.09, 0.42, 1.6, bodyMat, sx * 0.86, 1.02, 0.78, root);
    const ap = hp(0.06, 1.08, 0.06, darkMat, sx * 0.76, 1.56, 1.56, root);
    ap.rotation.x = -0.62;
    const bp = hp(0.07, 1.0, 0.1, bodyMat, sx * 0.86, 1.56, 0.02, root);
  }
  // 透明全景风挡与左右独立侧窗玻璃（消除重合面闪烁）
  for (const sx of [-1, 1]) hp(0.04, 0.78, 1.48, heliGlassMat, sx * 0.80, 1.54, 0.78, root);
  const fGlass = hp(1.52, 1.10, 0.06, heliGlassMat, 0, 1.52, 1.62, root);
  fGlass.rotation.x = -0.62;
  hp(1.56, 0.14, 1.75, bodyMat, 0, 2.02, 0.85, root, true); // 座舱顶盖

  // 尾梁 + 垂尾 + 平尾 + 航行灯
  hp(0.46, 0.46, 4.4, bodyMat, 0, 1.62, -3.75, root, true);
  hp(0.48, 0.12, 4.1, stripeMat, 0, 1.64, -3.7, root);
  const fin = hp(0.12, 1.45, 0.82, bodyMat, 0, 2.22, -5.85, root, true);
  fin.rotation.x = -0.25;
  hp(2.15, 0.1, 0.55, stripeMat, 0, 1.66, -4.65, root, true);
  const navL = hp(0.12, 0.12, 0.16, navGreenMat, -1.12, 1.68, -4.65, root);
  const navR = hp(0.12, 0.12, 0.16, navRedMat, 1.12, 1.68, -4.65, root);
  const strobe = hp(0.14, 0.14, 0.14, navStrobeMat, 0, 2.95, -5.98, root);

  // 驾驶舱内饰（座椅 + 仪表台 + 周期变距操纵杆）
  const interior = new THREE.Group(); root.add(interior);
  for (const sx of [-0.42, 0.42]) {
    hp(0.46, 0.12, 0.46, '#23252c', sx, 0.9, 0.55, interior);
    hp(0.46, 0.62, 0.11, '#23252c', sx, 1.24, 0.30, interior).rotation.x = -0.1;
  }
  hp(1.38, 0.32, 0.42, '#17191f', 0, 1.04, 1.28, interior);
  hp(0.75, 0.22, 0.03, gaugeMat, 0.18, 1.14, 1.07, interior); // 航空仪表屏
  const cyclicStick = new THREE.Group();
  cyclicStick.position.set(0.42, 0.85, 0.92);
  interior.add(cyclicStick);
  hp(0.035, 0.42, 0.035, '#18181b', 0, 0.21, 0, cyclicStick);
  hp(0.06, 0.07, 0.08, '#ffd400', 0, 0.42, 0, cyclicStick);
  // 总距杆（随升降速度上下运动）
  const collective = new THREE.Group(); collective.position.set(0.12, 0.88, 0.62); interior.add(collective);
  hp(0.035, 0.035, 0.46, '#18181b', 0, 0, 0.2, collective);
  hp(0.05, 0.05, 0.12, '#ffd400', 0, 0, 0.46, collective);
  // 航空仪表：空速表 / 姿态仪（人工地平线）/ 高度表 / 升降速度表
  const horizonCv = document.createElement('canvas'); horizonCv.width = horizonCv.height = 128;
  {
    const g2 = horizonCv.getContext('2d');
    g2.fillStyle = '#3d8be8'; g2.fillRect(0, 0, 128, 64);
    g2.fillStyle = '#7a5230'; g2.fillRect(0, 64, 128, 64);
    g2.fillStyle = '#ffffff'; g2.fillRect(0, 62, 128, 4);
    g2.strokeStyle = 'rgba(255,255,255,0.85)'; g2.lineWidth = 2;
    for (const dy of [-26, -13, 13, 26]) {
      const w = Math.abs(dy) > 20 ? 24 : 38;
      g2.beginPath(); g2.moveTo(64 - w / 2, 64 + dy); g2.lineTo(64 + w / 2, 64 + dy); g2.stroke();
    }
  }
  const horizonTex = new THREE.CanvasTexture(horizonCv);
  horizonTex.colorSpace = THREE.SRGBColorSpace;
  horizonTex.repeat.set(0.6, 0.6); horizonTex.offset.set(0.2, 0.2);
  const cluster = new THREE.Group(); cluster.position.set(0, 1.30, 1.32); cluster.rotation.x = 0.45; interior.add(cluster);
  hp(1.32, 0.28, 0.04, '#0e0f13', 0.36, 0, 0.035, cluster);   // 仪表罩背板（朝飞行员倾斜，默认视线下沿即可看到）
  const instrFace = (x, r) => {
    const f = new THREE.Group(); f.position.set(x, 0, 0); f.rotation.y = Math.PI; cluster.add(f);
    const bezel = new THREE.Mesh(new THREE.CircleGeometry(r * 1.12, 24), mat('#0b0b0e')); bezel.position.z = -0.002; f.add(bezel);
    return f;
  };
  const makeNeedleFace = (x, r) => {
    const f = instrFace(x, r);
    f.add(new THREE.Mesh(new THREE.CircleGeometry(r, 24), gaugeMat));
    const nd = new THREE.Group(); nd.position.z = 0.004; f.add(nd);
    const nm = new THREE.Mesh(boxGeo, needleMat); nm.scale.set(0.007, r * 0.82, 0.003); nm.position.y = r * 0.41; nd.add(nm);
    return nd;
  };
  const asiNeedle = makeNeedleFace(0.10, 0.07);
  const altNeedle = makeNeedleFace(0.47, 0.07);
  const vsiNeedle = makeNeedleFace(0.63, 0.055);
  const aiFace = instrFace(0.285, 0.09);
  const horizon = new THREE.Mesh(new THREE.CircleGeometry(0.09, 28), new THREE.MeshBasicMaterial({ map: horizonTex }));
  aiFace.add(horizon);
  const aiMark = new THREE.Group(); aiMark.position.z = 0.004; aiFace.add(aiMark);
  for (const sx of [-1, 1]) { const wing = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#ffd400' })); wing.scale.set(0.034, 0.008, 0.003); wing.position.x = sx * 0.032; aiMark.add(wing); }
  { const dot = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#ffd400' })); dot.scale.set(0.01, 0.01, 0.003); aiMark.add(dot); }

  // 驾驶员模型（兼容替换为主角黄色玩偶模型）
  const drv = new THREE.Group(); drv.position.set(0.42, 0.84, 0.52); drv.scale.setScalar(0.85); root.add(drv);
  const drvTorso = hp(0.4, 0.42, 0.22, '#2d3a4a', 0, 0.46, -0.04, drv);
  hp(0.2, 0.22, 0.2, '#e0b18f', 0, 0.8, -0.02, drv);
  hp(0.22, 0.12, 0.22, '#1b1d22', 0, 0.91, -0.03, drv); // 飞行头盔
  for (const ax of [-0.15, 0.15]) hp(0.08, 0.08, 0.36, '#2d3a4a', ax, 0.56, 0.17, drv).rotation.x = 0.35;

  // 主旋翼（4 桨叶 + 透明旋转桨盘）
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 2.55, -0.1);
  root.add(mainRotor);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.36, 10), metalMat);
  mast.position.y = -0.14; mainRotor.add(mast);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 12), darkMat);
  mainRotor.add(hub);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.y = (i * Math.PI) / 2;
    const b = new THREE.Mesh(bladeGeo, darkMat); b.position.z = 2.25; b.castShadow = true;
    const tip = hp(0.18, 0.026, 0.35, stripeMat, 0, 0, 4.35, arm);
    arm.add(b, tip);
    mainRotor.add(arm);
  }
  const rotorDiscMat = new THREE.MeshBasicMaterial({ color: '#dfe8f5', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const rotorDisc = new THREE.Mesh(rotorDiscGeo, rotorDiscMat);
  mainRotor.add(rotorDisc);

  // 尾旋翼（绕 X 轴高速旋转）
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.22, 2.05, -5.98);
  root.add(tailRotor);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(tailBladeGeo, stripeMat);
    b.rotation.x = (i * Math.PI) / 2;
    tailRotor.add(b);
  }

  scene.add(g);
  return {
    g, root, bodyMat, interior, drv, drvTorso, cyclicStick,
    collective, horizon, horizonTex, asiNeedle, altNeedle, vsiNeedle,
    mainRotor, tailRotor, rotorDiscMat, navL, navR, strobe, gunL, gunR,
    eye: { x: 0.42, y: 1.50, z: 0.85 },
  };
}

function heliSupportH(x, z, curY, r = 2.4) {
  let h = groundH(x, z);
  const list = queryColliders(x, z, r);
  for (const b of list) {
    // 仅允许降落在有一定宽度的建筑屋顶（排除 0.4m 树干/路灯柱）
    if ((b.x1 - b.x0) < 6 || (b.z1 - b.z0) < 6) continue;
    if (x + r * 0.4 < b.x0 || x - r * 0.4 > b.x1 || z + r * 0.4 < b.z0 || z - r * 0.4 > b.z1) continue;
    if (curY >= b.h - 0.8 && b.h > h) h = b.h;
  }
  return h;
}

function spawnHeli(x, z, h, opts = {}) {
  const m = makeHeliMesh(opts.color || '#c62828', opts.stripe || '#ffd43b');
  const sy = heliSupportH(x, z, 2, 2.4);
  const heli = {
    ...m,
    x, y: sy, z, h,
    vx: 0, vy: 0, vz: 0, speed: 0,
    pitch: 0, roll: 0, yawVel: 0,
    rotorRpm: 0, rotorAng: 0,
    hp: 950, maxHp: 950,
    pilot: null, wreck: false, smokeT: 0, burnT: 0,
    gunCD: 0, gunAlt: 0, washT: 0,
    customDrv: null, customSkel: null,
  };
  heli.g.position.set(x, sy, z);
  heli.g.rotation.y = h;
  helis.push(heli);
  return heli;
}

function damageHeli(h, dmg) {
  if (h.wreck || dmg <= 0) return;
  const prev = h.hp;
  h.hp -= dmg;
  if (h.hp <= 0 && prev > 0) {
    h.burnT = 3.2;
    if (h === player.inHeli) showMsg('<b style="color:#ff6a3a">直升机起火！按 F 跳伞逃生！</b>', 3);
  }
}

function explodeHeli(h) {
  if (h.wreck) return;
  h.wreck = true; h.hp = 0; h.burnT = 0;
  h.bodyMat.color.set('#1b1b1b'); h.bodyMat.metalness = 0; h.bodyMat.roughness = 1;
  const P = playerAnchor();
  const dP = Math.hypot(h.x - P.x, h.z - P.z);
  sndBoom(clamp(1.2 - dP / 140, 0.15, 1));
  shake = Math.max(shake, clamp(1.3 - dP / 60, 0, 1.3));
  for (let i = 0; i < 42; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(3, 15);
    emit(h.x, h.y + 1.4, h.z, Math.cos(a) * s, rand(2, 12), Math.sin(a) * s, pick(['#ffdd55', '#ff8822', '#ff4400']), rand(0.6, 1.3), rand(0.45, 0.95), -9, 1.5);
  }
  if (h === player.inHeli) { exitHeli(true); damagePlayer(999); }
}

function fireHeliAutocannon(h) {
  h.gunCD = 0.11;
  h.g.updateMatrixWorld();
  const gun = (h.gunAlt & 1) ? h.gunL : h.gunR;
  h.gunAlt++;
  const muzzle = gun.getWorldPosition(new THREE.Vector3());
  sndAutocannon();
  shake = Math.max(shake, 0.03);
  emit(muzzle.x, muzzle.y, muzzle.z, 0, 0, 0, '#ffe980', 0.26, 0.06);

  const fx = Math.sin(h.h), fz = Math.cos(h.h);
  _o.copy(camera.position);
  camera.getWorldDirection(_d);
  const aimForward = (_d.x * fx + _d.z * fz) > 0.2;
  if (!aimForward) {
    _o.copy(muzzle);
    _d.set(fx, -0.14 + h.pitch * 0.5, fz).normalize();
  }
  _d.x += rand(-0.015, 0.015);
  _d.y += rand(-0.015, 0.015);
  _d.z += rand(-0.015, 0.015);
  _d.normalize();

  const minT = aimForward ? (fpv ? 1.8 : camera.position.distanceTo(muzzle) * 0.5) : 0.4;
  let best = 200, hit = { type: 'none' };
  for (const b of colliders) { const t = rayBox(_o, _d, b); if (t !== null && t > minT && t < best) { best = t; hit = { type: 'world' }; } }
  if (_d.y < 0) { const t = -_o.y / _d.y; if (t > minT && t < best) { best = t; hit = { type: 'world' }; } }
  for (const p of peds) {
    if (p.state === 'dead') continue;
    const t = raySphere(_o, _d, p.x, groundH(p.x, p.z) + 1.1, p.z, 0.7);
    if (t !== null && t > minT && t < best) { best = t; hit = { type: 'ped', p }; }
  }
  for (const bt of bounty.targets) {
    if (bt.dead) continue;
    const t = raySphere(_o, _d, bt.x, groundH(bt.x, bt.z) + 1.1, bt.z, 0.7);
    if (t !== null && t > minT && t < best) { best = t; hit = { type: 'bounty', bt }; }
  }
  for (const se of story.enemies) {
    if (se.dead) continue;
    const t = raySphere(_o, _d, se.x, groundH(se.x, se.z) + 1.1, se.z, 0.7);
    if (t !== null && t > minT && t < best) { best = t; hit = { type: 'story', se }; }
  }
  for (const me of mission.enemies) {
    if (me.dead) continue;
    const t = raySphere(_o, _d, me.x, groundH(me.x, me.z) + 1.1, me.z, 0.7);
    if (t !== null && t > minT && t < best) { best = t; hit = { type: 'mission', me }; }
  }
  for (const c of cars) {
    if (c.wreck) continue;
    for (const [cx, cz] of carCircles(c)) {
      const t = raySphere(_o, _d, cx, 0.9, cz, 1.3);
      if (t !== null && t > minT && t < best) { best = t; hit = { type: 'car', c }; }
    }
    if (c.copOut) {
      const t = raySphere(_o, _d, c.copX, 1.1, c.copZ, 0.7);
      if (t !== null && t > minT && t < best) { best = t; hit = { type: 'cop', c }; }
    }
  }
  for (const oh of helis) {
    if (oh === h || oh.wreck) continue;
    const t = raySphere(_o, _d, oh.x, oh.y + 1.4, oh.z, 2.5);
    if (t !== null && t > minT && t < best) { best = t; hit = { type: 'heli', h: oh }; }
  }
  const pt = _o.clone().addScaledVector(_d, best);
  tracer(muzzle, pt);

  let anyHit = false;
  if (hit.type === 'ped') { damagePed(hit.p, 65, _d.x * 3, _d.z * 3, true); anyHit = true; }
  else if (hit.type === 'bounty') { damageBountyTarget(hit.bt, 65, _d.x * 3, _d.z * 3); anyHit = true; }
  else if (hit.type === 'story') { damageStoryEnemy(hit.se, 65, _d.x * 3, _d.z * 3); anyHit = true; }
  else if (hit.type === 'mission') { damageMissionEnemy(hit.me, 65, _d.x * 3, _d.z * 3); anyHit = true; }
  else if (hit.type === 'cop') { killCop(hit.c, true); anyHit = true; }
  else if (hit.type === 'car') {
    damageCar(hit.c, 48, true); anyHit = true;
    for (let i = 0; i < 4; i++) emit(pt.x, pt.y, pt.z, rand(-4, 4), rand(0.5, 4), rand(-4, 4), '#ffd070', 0.09, 0.35, -10);
    if (hit.c.police) setMinHeat(60);
  } else if (hit.type === 'heli') {
    damageHeli(hit.h, 52); anyHit = true;
    for (let i = 0; i < 4; i++) emit(pt.x, pt.y, pt.z, rand(-4, 4), rand(0.5, 4), rand(-4, 4), '#ffd070', 0.1, 0.35, -10);
  } else if (hit.type === 'world') {
    for (let i = 0; i < 3; i++) emit(pt.x, pt.y, pt.z, rand(-2, 2), rand(0.5, 3), rand(-2, 2), '#d8cbb8', 0.12, 0.4, -7);
  }
  if (anyHit) { hitmarkerT = 0.12; hitmarkerHead = false; sndHit(false); }
  alertPeds(pt.x, pt.z, 26);
  if (policeNear(48)) setMinHeat(55);
}

function updateHelis(dt) {
  const P = playerAnchor();
  for (const h of helis) {
    const active = h.pilot === 'player' && !h.wreck && !player.dead;
    h.gunCD = Math.max(0, h.gunCD - dt);
    if (active && mouseL && running && !dialog.open && !phoneOpen && h.gunCD <= 0) {
      fireHeliAutocannon(h);
    }
    // 旋翼转速平滑升降
    h.rotorRpm = lerp(h.rotorRpm, active ? 1 : 0, Math.min(1, dt * (active ? 0.9 : 0.45)));
    h.rotorAng += dt * (h.rotorRpm > 0.02 ? 2.5 + h.rotorRpm * 26 : 0);
    h.mainRotor.rotation.y = h.rotorAng;
    h.tailRotor.rotation.x = h.rotorAng * 1.7;
    h.rotorDiscMat.opacity = clamp((h.rotorRpm - 0.45) * 0.48, 0, 0.26);
    h.strobe.visible = !h.wreck && ((Math.floor(gameTime * 3.5) % 4) === 0);

    let fwdIn = 0, yawIn = 0, upIn = 0, strafeIn = 0;
    if (active) {
      fwdIn = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      yawIn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
      upIn = (keys.Space ? 1 : 0) - (keys.ShiftLeft || keys.ShiftRight || keys.KeyC ? 1 : 0);
      strafeIn = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);
    }

    const sup = heliSupportH(h.x, h.z, h.y, 2.4);
    const airborne = h.y > sup + 0.08;

    // 垂直控制（起飞需要一定旋翼转速）
    if (active) {
      const targetVy = upIn > 0 ? (h.rotorRpm > 0.45 ? upIn * 14 * h.rotorRpm : 0) : upIn < 0 ? upIn * 11 : 0;
      h.vy = lerp(h.vy, targetVy, Math.min(1, dt * 3.5));
    } else if (h.wreck) {
      h.vy -= 18 * dt;
    } else if (airborne) {
      h.vy = lerp(h.vy, -5.5, Math.min(1, dt * 2.0)); // 跳机后缓缓自动迫降
    } else {
      h.vy = 0;
    }

    // 偏航与水平飞行推力
    if (active && (airborne || h.rotorRpm > 0.4)) {
      h.yawVel = lerp(h.yawVel, yawIn * 1.75, Math.min(1, dt * 4.5));
    } else {
      h.yawVel = lerp(h.yawVel, 0, Math.min(1, dt * 6));
    }
    h.h += h.yawVel * dt;

    const fx = Math.sin(h.h), fz = Math.cos(h.h), lx = fz, lz = -fx; // +X_local is left/right check: right hand forward +Z, left +X => (+fz, -fx)
    if (active && airborne) {
      const accel = 36 * h.rotorRpm;
      h.vx += (fx * fwdIn + lx * strafeIn * 0.6) * accel * dt;
      h.vz += (fz * fwdIn + lz * strafeIn * 0.6) * accel * dt;
    }
    const drag = airborne ? Math.exp(-0.95 * dt) : Math.exp(-5.0 * dt);
    h.vx *= drag; h.vz *= drag;
    const hSpd = Math.hypot(h.vx, h.vz);
    if (hSpd > 48) { h.vx *= 48 / hSpd; h.vz *= 48 / hSpd; }
    h.speed = Math.hypot(h.vx, h.vz, h.vy);

    h.x = clamp(h.x + h.vx * dt, -WALL - 140, WALL + 140);
    h.z = clamp(h.z + h.vz * dt, -WALL - 140, WALL + 140);
    h.y = clamp(h.y + h.vy * dt, sup, 280);

    // 与高于机身的建筑侧面碰撞
    const nearCols = queryColliders(h.x, h.z, 2.5);
    for (const b of nearCols) {
      if (h.y >= b.h - 0.8) continue;
      if (h.x + 2.3 < b.x0 || h.x - 2.3 > b.x1 || h.z + 2.3 < b.z0 || h.z - 2.3 > b.z1) continue;
      const cx = clamp(h.x, b.x0, b.x1), cz = clamp(h.z, b.z0, b.z1);
      const dx = h.x - cx, dz = h.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= 2.3 * 2.3) continue;
      let nx = 0, nz = 1, pen = 0;
      if (d2 > 1e-6) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = 2.3 - d; }
      else {
        const dl = h.x - b.x0, dr = b.x1 - h.x, dtB = h.z - b.z0, db = b.z1 - h.z, m = Math.min(dl, dr, dtB, db);
        if (m === dl) { nx = -1; nz = 0; pen = dl + 2.3; } else if (m === dr) { nx = 1; nz = 0; pen = dr + 2.3; }
        else if (m === dtB) { nx = 0; nz = -1; pen = dtB + 2.3; } else { nx = 0; nz = 1; pen = db + 2.3; }
      }
      h.x += nx * pen; h.z += nz * pen;
      const vn = h.vx * nx + h.vz * nz;
      if (vn < 0) {
        h.vx -= vn * 1.2 * nx; h.vz -= vn * 1.2 * nz;
        if (-vn > 11) {
          damageHeli(h, (-vn - 11) * 10);
          if (h === player.inHeli) { sndCrash(clamp(-vn / 28, 0.25, 1)); shake = Math.max(shake, 0.45); }
        }
      }
    }

    const supAfter = heliSupportH(h.x, h.z, h.y, 2.4);
    if (h.y <= supAfter + 0.01) {
      if (h.vy < -14 && h.wreck) explodeHeli(h);
      h.y = supAfter;
      if (h.vy < 0) h.vy = 0;
    }

    // 机身俯仰与侧倾姿态
    const targetPitch = airborne ? fwdIn * 0.26 : 0;
    const targetRoll = airborne ? (yawIn * 0.24 + strafeIn * 0.20) : 0;
    h.pitch = lerp(h.pitch, targetPitch, Math.min(1, dt * 4.5));
    h.roll = lerp(h.roll, targetRoll, Math.min(1, dt * 4.5));
    h.g.position.set(h.x, h.y, h.z);
    h.g.rotation.y = h.h;
    h.root.rotation.set(h.pitch, 0, -h.roll, 'YXZ');

    h.interior.visible = !h.wreck && (h === player.inHeli || dist2(h.x, h.z, P.x, P.z) < 95 * 95);
    h.drv.visible = !h.wreck && !!h.pilot && !(h === player.inHeli && fpv);
    if (h.interior.visible) {
      h.cyclicStick.rotation.x = h.pitch * 0.9;
      h.cyclicStick.rotation.z = h.roll * 0.9;
      h.horizon.rotation.z = -h.roll;
      h.horizonTex.offset.y = 0.2 - h.pitch * 0.9;
      h.asiNeedle.rotation.z = 2.3 - clamp(h.speed / 50, 0, 1) * 4.6;
      h.altNeedle.rotation.z = -(h.y / 100) * Math.PI * 2;
      h.vsiNeedle.rotation.z = -clamp(h.vy / 14, -1, 1) * 1.6;
      h.collective.rotation.x = -clamp(h.vy / 14, -1, 1) * 0.45;
    }

    // 低空旋翼下洗尘埃/水花
    const alt = h.y - supAfter;
    h.washT -= dt;
    if (!h.wreck && h.rotorRpm > 0.45 && alt < 12 && h.washT <= 0) {
      h.washT = lerp(0.045, 0.12, alt / 12);
      const col = supAfter <= 0.15 ? '#b8e4ff' : '#d2c6ad';
      const spd = lerp(7.5, 2.5, alt / 12);
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2, r = rand(1.4, 3.4);
        emit(h.x + Math.cos(a) * r, supAfter + 0.18, h.z + Math.sin(a) * r, Math.cos(a) * spd, rand(0.5, 1.8), Math.sin(a) * spd, col, rand(0.28, 0.55), rand(0.35, 0.65), -2, 0.6);
      }
    }

    // 损毁烟火
    h.smokeT -= dt;
    if (!h.wreck && h.hp < h.maxHp * 0.45 && h.smokeT <= 0) {
      h.smokeT = 0.08;
      emit(h.x, h.y + 2.1, h.z, rand(-0.6, 0.6), rand(1.5, 3), rand(-0.6, 0.6), h.hp < 0 ? '#ff6a10' : '#444', 0.4, 1.2, 0, 1.0);
    }
    if (!h.wreck && h.hp <= 0) {
      h.burnT -= dt;
      if (h.burnT <= 0) explodeHeli(h);
    }
  }
}

/* ============================ 武器定义 (6种) ============================ */
const WEAPONS = [
  { id: 'fist',    name: '近战连击', icon: '👊', melee: true,  cd: 0.28, dmg: 44,  headDmg: 72,  clipMax: 0,  spread: 0,     pellets: 1, reload: 0,    shake: 0.05, recoil: 0,     kick: 0,    heat: 18, twoHand: false, auto: false },
  { id: 'pistol',  name: '战术手枪', icon: '🔫', melee: false, cd: 0.19, dmg: 48,  headDmg: 112, clipMax: 17, spread: 0.010, pellets: 1, reload: 1.05, shake: 0.06, recoil: 0.020, kick: 0.32, heat: 25, twoHand: false, auto: false },
  { id: 'smg',     name: '冲锋枪',   icon: '⚡', melee: false, cd: 0.078,dmg: 27,  headDmg: 70,  clipMax: 32, spread: 0.024, pellets: 1, reload: 1.35, shake: 0.045,recoil: 0.013, kick: 0.22, heat: 25, twoHand: true,  auto: true },
  { id: 'shotgun', name: '霰弹枪',   icon: '💥', melee: false, cd: 0.68, dmg: 28,  headDmg: 52,  clipMax: 8,  spread: 0.052, pellets: 7, reload: 1.60, shake: 0.22, recoil: 0.060, kick: 0.62, heat: 38, twoHand: true,  auto: false },
  { id: 'rifle',   name: '突击步枪', icon: '🎯', melee: false, cd: 0.10, dmg: 42,  headDmg: 108, clipMax: 30, spread: 0.011, pellets: 1, reload: 1.45, shake: 0.07, recoil: 0.024, kick: 0.38, heat: 32, twoHand: true,  auto: true },
  { id: 'sniper',  name: '狙击步枪', icon: '🔭', melee: false, cd: 0.98, dmg: 155, headDmg: 340, clipMax: 5,  spread: 0.001, pellets: 1, reload: 2.00, shake: 0.26, recoil: 0.095, kick: 0.85, heat: 45, twoHand: true,  auto: false, scoped: true },
];

/* ============================ 游戏状态 ============================ */
const cars = [], peds = [], pickups = [];
const SPAWN = { x: roadC(MID) + ROAD / 2 + 1.8, z: roadC(MID) + ROAD / 2 + 12 };
const player = {
  x: SPAWN.x, z: SPAWN.z, y: 0, vy: 0, vx: 0, vz: 0, h: Math.PI, prevH: Math.PI, turnVel: 0,
  hp: 100, maxHp: 100, armor: 60, maxArmor: 100, stamina: 100, money: 350,
  wpn: 1,
  clips: [0, 17, 32, 8, 30, 5],
  ammos: [0, 136, 192, 32, 150, 20],
  reloadT: 0, fireCD: 0, punchT: 0, combo: 0, comboT: 0, laughT: 0, dodgeT: 0, dodgeCD: 0, invulnT: 0,
  coyoteT: 0, jumpBuf: 0, wasGrounded: true, landSquash: 0, stepDist: 0, waterWarnT: 0,
  inCar: null, inHeli: null, chute: false, phase: 0, moving: false,
  dead: false, deadT: 0, deadKind: '', lastShot: -10, bustT: 0, fall: 0, hm: null,
  buffs: { kantArmor: false, spinozaSpeed: false, humeHeat: false, descartesHead: false, nietzscheDmg: false, platoInsight: false },
  kills: 0, headshots: 0,
};
const inVehicle = () => !!(player.inCar || player.inHeli);
const playerAnchor = () => player.inHeli || player.inCar || player;
let yaw = Math.PI, pitch = 0.22, camYaw = Math.PI, carYawOff = 0, lastMouseT = 0, shake = 0;
let fpv = false, carPitchOff = 0, bobPhase = 0;
let recoilPitch = 0, recoilKick = 0, bloom = 0, hitmarkerT = 0, hitmarkerHead = false, camDistCur = 5.2, camShCur = 0.55;
let heat = 0, stars = 0, prevStars = 0, lostT = 0, policeSpawnT = 0, trafficT = 0;
let gameTime = 0, dayT = 0.375, night = 0, muzzleFlashT = 0;
let running = false, started = false, phoneOpen = false, codexOpen = false, headlightsOn = true;
let mouseL = false, mouseR = false;
const keys = {};
const muzzleLight = new THREE.PointLight('#ffd27d', 0, 10);
scene.add(muzzleLight);

// 玩家模型（带精细化可切换 6 武器模型 + 高空跳伞包伞衣）
player.hm = makeHuman('#3b3f46', '#22262c', '#e0b18f', '#1a1a1a');
part(0.56, 0.24, 0.32, '#5a4632', player.hm.g, 0, 1.34, 0); // 夹克翻领
const chuteGroup = new THREE.Group();
{
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
    new THREE.MeshStandardMaterial({ color: '#ff6b35', roughness: 0.65, side: THREE.DoubleSide })
  );
  dome.position.y = 3.2; chuteGroup.add(dome);
  const cordMat = mat('#ddd');
  for (const [cx, cz] of [[-1.3, 0.5], [1.3, 0.5], [-1.3, -0.5], [1.3, -0.5]]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.2, 4), cordMat);
    cord.position.set(cx * 0.45, 2.4, cz * 0.45);
    cord.lookAt(cx, 3.3, cz); cord.rotateX(Math.PI / 2);
    chuteGroup.add(cord);
  }
  chuteGroup.visible = false;
  player.hm.g.add(chuteGroup);
}
const playerAuraRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.024, 6, 28),
  new THREE.MeshBasicMaterial({ color: '#ffe078', transparent: true, opacity: 0.78 })
);
playerAuraRing.rotation.x = Math.PI / 2;
playerAuraRing.position.y = 2.18;
playerAuraRing.visible = false;
player.hm.g.add(playerAuraRing);
const wpnGunmetal   = new THREE.MeshStandardMaterial({ color: '#2b303a', roughness: 0.28, metalness: 0.78, envMap: cityEnvMap, envMapIntensity: 1.1 });
const wpnDarkSteel  = new THREE.MeshStandardMaterial({ color: '#17191f', roughness: 0.34, metalness: 0.82, envMap: cityEnvMap, envMapIntensity: 0.9 });
const wpnPolymer    = new THREE.MeshStandardMaterial({ color: '#1e2026', roughness: 0.72, metalness: 0.12 });
const wpnChrome     = new THREE.MeshStandardMaterial({ color: '#d0d7e0', roughness: 0.18, metalness: 0.94, envMap: cityEnvMap, envMapIntensity: 1.4 });
const wpnWood       = new THREE.MeshStandardMaterial({ color: '#5c3720', roughness: 0.56, metalness: 0.08 });
const wpnOlive      = new THREE.MeshStandardMaterial({ color: '#33442e', roughness: 0.64, metalness: 0.14 });
const wpnSightGreen = new THREE.MeshBasicMaterial({ color: '#38ff7a' });
const wpnSightRed   = new THREE.MeshBasicMaterial({ color: '#ff3038' });
const wpnLens       = new THREE.MeshStandardMaterial({ color: '#1e66aa', emissive: '#0c2c4d', emissiveIntensity: 0.4, roughness: 0.06, metalness: 0.65, envMap: cityEnvMap, envMapIntensity: 1.8 });
const wpnCylCache   = {};
function addWpnPart(w, h, d, m, parent, x, y, z) {
  const mesh = new THREE.Mesh(boxGeo, typeof m === 'string' ? mat(m) : m);
  mesh.scale.set(w, h, d); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function addWpnCyl(rTop, rBot, len, m, parent, x, y, z, axis = 'y', seg = 12) {
  const key = `${rTop}_${rBot}_${len}_${seg}`;
  let geo = wpnCylCache[key];
  if (!geo) { geo = new THREE.CylinderGeometry(rTop, rBot, len, seg); wpnCylCache[key] = geo; }
  const mesh = new THREE.Mesh(geo, typeof m === 'string' ? mat(m) : m);
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  else if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

const wpnMeshes = [];
{
  // 第 2 槽：战术手枪（上+Z朝上，-Y朝枪口）
  const pPistol = new THREE.Group();
  addWpnPart(0.044, 0.11, 0.072, wpnPolymer, pPistol, 0, 0.01, -0.02);       // 握把
  addWpnPart(0.048, 0.25, 0.036, wpnDarkSteel, pPistol, 0, -0.14, 0.018);    // 下套筒与导轨
  addWpnPart(0.044, 0.25, 0.034, wpnGunmetal, pPistol, 0, -0.14, 0.052);     // 金属滑套
  addWpnPart(0.022, 0.06, 0.010, wpnChrome, pPistol, 0.012, -0.12, 0.064);   // 抛壳窗
  addWpnCyl(0.011, 0.011, 0.05, wpnChrome, pPistol, 0, -0.27, 0.050, 'y', 8);// 外露枪管头
  addWpnPart(0.026, 0.05, 0.024, wpnSightRed, pPistol, 0, -0.18, -0.008);    // 激光模块
  pPistol.position.set(0, -0.66, 0.03); player.hm.armR.add(pPistol);

  // 第 3 槽：MP5 战术冲锋枪
  const pSmg = new THREE.Group();
  addWpnPart(0.054, 0.28, 0.085, wpnDarkSteel, pSmg, 0, -0.13, 0.036);       // 上下机匣
  addWpnPart(0.038, 0.10, 0.048, wpnPolymer, pSmg, 0, 0.04, 0.01);           // 折叠托
  addWpnPart(0.032, 0.055, 0.16, wpnPolymer, pSmg, 0, -0.15, -0.085);        // 弯弹匣（朝下）
  addWpnCyl(0.018, 0.018, 0.18, wpnGunmetal, pSmg, 0, -0.34, 0.048, 'y', 10);// 圆柱消音/护筒
  addWpnPart(0.034, 0.075, 0.036, wpnPolymer, pSmg, 0, -0.11, 0.095);        // 顶部红点镜框
  pSmg.position.set(0, -0.66, 0.03); player.hm.armR.add(pSmg);

  // 第 4 槽：泵动霰弹枪
  const pShotgun = new THREE.Group();
  addWpnPart(0.056, 0.24, 0.085, wpnWood, pShotgun, 0, 0.04, -0.005);        // 胡桃木枪托
  addWpnPart(0.056, 0.21, 0.085, wpnGunmetal, pShotgun, 0, -0.14, 0.032);    // 钢制机匣
  addWpnPart(0.020, 0.07, 0.026, wpnChrome, pShotgun, 0.02, -0.13, 0.045);   // 亮铬抛壳口
  addWpnCyl(0.016, 0.016, 0.48, wpnDarkSteel, pShotgun, 0, -0.44, 0.054, 'y', 10); // 长枪管
  addWpnCyl(0.014, 0.014, 0.36, wpnGunmetal, pShotgun, 0, -0.38, 0.026, 'y', 10);  // 供弹管
  addWpnPart(0.052, 0.16, 0.052, wpnWood, pShotgun, 0, -0.35, 0.012);        // 木护木拉柄
  pShotgun.position.set(0, -0.66, 0.03); player.hm.armR.add(pShotgun);

  // 第 5 槽：M4A1 突击步枪
  const pRifle = new THREE.Group();
  addWpnPart(0.048, 0.22, 0.082, wpnPolymer, pRifle, 0, 0.04, 0.012);        // 伸缩枪托
  addWpnPart(0.058, 0.22, 0.086, wpnGunmetal, pRifle, 0, -0.12, 0.036);      // 机匣
  addWpnPart(0.050, 0.20, 0.068, wpnDarkSteel, pRifle, 0, -0.30, 0.044);     // 四面导轨护木
  addWpnPart(0.034, 0.065, 0.16, wpnPolymer, pRifle, 0, -0.16, -0.082);      // STANAG 弧形弹匣
  addWpnCyl(0.012, 0.012, 0.26, wpnDarkSteel, pRifle, 0, -0.50, 0.048, 'y', 10); // 重枪管
  addWpnPart(0.040, 0.080, 0.046, wpnPolymer, pRifle, 0, -0.12, 0.102);      // 全息瞄具
  pRifle.position.set(0, -0.66, 0.03); player.hm.armR.add(pRifle);

  // 第 6 槽：AWP 狙击步枪
  const pSniper = new THREE.Group();
  addWpnPart(0.054, 0.26, 0.088, wpnOlive, pSniper, 0, 0.04, 0.006);         // 军绿枪托
  addWpnPart(0.056, 0.34, 0.076, wpnOlive, pSniper, 0, -0.18, 0.026);        // 护木底盘
  addWpnCyl(0.015, 0.015, 0.56, wpnDarkSteel, pSniper, 0, -0.54, 0.052, 'y', 10); // 浮置重管
  addWpnPart(0.034, 0.065, 0.034, wpnGunmetal, pSniper, 0, -0.82, 0.052);    // 制退器
  addWpnCyl(0.022, 0.018, 0.26, wpnDarkSteel, pSniper, 0, -0.15, 0.098, 'y', 12); // 8倍光学瞄镜
  pSniper.position.set(0, -0.66, 0.03); player.hm.armR.add(pSniper);

  wpnMeshes.push(null, pPistol, pSmg, pShotgun, pRifle, pSniper);
  wpnMeshes.forEach((m, i) => { if (m) m.visible = (i === player.wpn); });
}
const playerLaughGroup = new THREE.Group();
playerLaughGroup.visible = false;
player.hm.g.add(playerLaughGroup);
const playerBaseBodyParts = player.hm.g.children.filter(ch => ch !== player.hm.armR && ch !== chuteGroup && ch !== playerAuraRing && ch !== playerLaughGroup);
const playerBaseArmRParts = player.hm.armR.children.filter(ch => !wpnMeshes.includes(ch));
const customRoleRoot = new THREE.Group();
player.hm.g.add(customRoleRoot);
let customRoleLoaded = false;
let playerMascotRig = null;
let laughNaiwaParts = null;
const LAUGH_MATS = {
  0: new THREE.MeshStandardMaterial({ color: '#ffd642', emissive: '#d49a00', emissiveIntensity: 0.06, roughness: 0.54, metalness: 0.02 }), // 柔光黏土亮黄主体
  1: new THREE.MeshStandardMaterial({ color: '#ffea8a', emissive: '#b8861e', emissiveIntensity: 0.05, roughness: 0.56, metalness: 0.02 }), // 柔和奶油肚皮
  2: new THREE.MeshStandardMaterial({ color: '#201a1e', roughness: 0.42, metalness: 0.04 }), // 眯眼与深笑嘴部
  3: new THREE.MeshStandardMaterial({ color: '#6e4c2e', roughness: 0.58, metalness: 0.02 }), // 暖棕掌垫与脚趾
};
function populateLaughGroup(group, parts) {
  if (!parts || group.children.length > 0) return;
  for (const { partId, geo } of parts) {
    const m = new THREE.Mesh(geo, LAUGH_MATS[partId] || LAUGH_MATS[0]);
    m.castShadow = (partId === 0);
    m.receiveShadow = true;
    group.add(m);
  }
}

const PLAYER_MASCOT_COLOR = '#ffd43b';
const NAIWA_YELLOWS = ['#ffd43b', '#ffe066', '#f5c400'];
const MASCOT_PED_COLORS = ['#ff7eb6', '#5cc8ff', '#7ce38b', '#b88cff', '#ff9f43', '#ff5c5c', '#5ce6d0', '#f5f0e1'];
function pickNaiwaColor() {
  return Math.random() < 0.55 ? pick(NAIWA_YELLOWS) : pick(MASCOT_PED_COLORS);
}
const roleMatCache = {};
const ROLE_FEATURE_MATS = {
  1: new THREE.MeshStandardMaterial({ color: '#2b201b', roughness: 0.28, metalness: 0.1 }),
  2: new THREE.MeshStandardMaterial({ color: '#f8f8f8', roughness: 0.22, metalness: 0.05 }),
  3: new THREE.MeshStandardMaterial({ color: '#f8f8f8', roughness: 0.22, metalness: 0.05 }),
  4: new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.12, metalness: 0.2 }),
  5: new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.12, metalness: 0.2 }),
};
const whaleTex = new THREE.TextureLoader().load('assets/whale_girl_tex.png');
whaleTex.colorSpace = THREE.SRGBColorSpace;
whaleTex.flipY = false;
const WHALE_TEX_MAT = new THREE.MeshStandardMaterial({
  map: whaleTex, emissiveMap: whaleTex, emissive: '#ffffff', emissiveIntensity: 0.26,
  roughness: 0.68, metalness: 0.0,
});
const MASCOT_SPECS = {
  naiwa: { geos: null, bones: [[0, 0.55, 0], [0, 0.53, 0.04], [0.26, -0.25, 0.04], [-0.26, -0.25, 0.04], [0.40, 0.29, 0.02], [-0.40, 0.29, 0.02], [0, -0.17, -0.34]] },
  whale: { geos: null,
    parents: [-1, 0, 0, 0, 0, 0, 0, 1, 6],
    bones: [[0, 0.583, 0], [0, 0.356, 0], [0.105, -0.083, 0], [-0.105, -0.083, 0], [0.194, 0.259, 0.02], [-0.194, 0.259, 0.02], [0, -0.065, -0.178], [0, -0.039, -0.17], [0, -0.24, -0.20]] },
};
const playerRigKind = () => (MASCOT_SPECS.whale.geos ? 'whale' : null);
function getMascotBodyMat(color) {
  if (!roleMatCache[color]) {
    roleMatCache[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.04 });
  }
  return roleMatCache[color];
}

function createMascotRig(kind, bodyColor, castShadow = false) {
  const spec = MASCOT_SPECS[kind];
  const b = spec.bones;
  const g = new THREE.Group();
  const parents = spec.parents || [-1, 0, 0, 0, 0, 0, 0];
  const boneList = b.map(p => { const bn = new THREE.Bone(); bn.position.set(p[0], p[1], p[2]); return bn; });
  boneList.forEach((bn, i) => { if (parents[i] < 0) g.add(bn); else boneList[parents[i]].add(bn); });
  const [torso, head, legL, legR, armL, armR, tail, hairBack, tailTip] = boneList;

  const bodyMat = kind === 'whale' ? WHALE_TEX_MAT : getMascotBodyMat(bodyColor);
  const meshes = [];
  for (const { partId, geo } of spec.geos) {
    const mMat = kind === 'whale' ? WHALE_TEX_MAT : (partId === 0 ? bodyMat : ROLE_FEATURE_MATS[partId]);
    const m = new THREE.SkinnedMesh(geo, mMat);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    g.add(m);
    meshes.push(m);
  }
  g.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList);
  for (const m of meshes) m.bind(skeleton);
  return { g, kind, torsoY: b[0][1], bones: { torso, head, legL, legR, armL, armR, tail, hairBack, tailTip }, skeleton, st: null };
}

// 鲸鱼娘专属动作：帧率无关平滑阻尼 + 二阶弹性发丝与鲸尾 + 翻滚/落地缓冲/三段连击/双手持枪
function animWhaleRig(rig, phase, amtIn, opts) {
  const { torso, head, legL, legR, armL, armR, tail, hairBack, tailTip } = rig.bones;
  const dt = clamp(opts.dt || 1 / 60, 0.001, 0.06);
  const st = rig.st || (rig.st = {
    amt: 0, air: 0, aim: 0, punch: 0, sprint: 0, reload: 0, twoH: 0,
    hx: 0, hvx: 0, hz: 0, hvz: 0, ty: 0, tvy: 0, tipY: 0, tipVy: 0,
  });
  st.amt = damp(st.amt, amtIn, 12, dt);
  st.air = damp(st.air, opts.air ? 1 : 0, 15, dt);
  st.aim = damp(st.aim, opts.aiming ? 1 : 0, 14, dt);
  st.punch = damp(st.punch, opts.punch ? 1 : 0, 22, dt);
  st.sprint = damp(st.sprint, opts.sprint ? 1 : 0, 10, dt);
  st.reload = damp(st.reload, opts.reloading ? 1 : 0, 12, dt);
  st.twoH = damp(st.twoH, opts.twoHand ? 1 : 0, 14, dt);

  const w = clamp(st.amt, 0, 1.35);
  const grounded = 1 - st.air;
  const idle = clamp(1 - w * 1.6, 0, 1);
  const squash = clamp(opts.squash || 0, 0, 0.5);
  const turn = clamp(opts.turnVel || 0, -5, 5);
  const dodgeFrac = opts.dodge ? clamp(1 - opts.dodge / 0.42, 0, 1) : 0;
  const s = Math.sin(phase), c = Math.cos(phase);
  const t = gameTime;

  // 腿部：髋部步态、空中收腿、落地缓冲微屈、翻滚蜷缩
  const stride = 0.52 * Math.min(w, 1.15) * grounded;
  const crouch = squash * 0.55 + (dodgeFrac > 0 ? 0.65 : 0);
  legL.rotation.x = s * stride - 0.42 * st.air - crouch;
  legR.rotation.x = -s * stride + 0.34 * st.air - crouch * 0.85;
  legL.rotation.z = Math.max(0, c) * 0.08 * w * grounded + 0.06 * st.air;
  legR.rotation.z = -Math.max(0, -c) * 0.08 * w * grounded - 0.06 * st.air;

  // 躯干：起伏、呼吸、三段近战连击扭转、前空翻翻滚
  const bob = Math.abs(Math.sin(phase)) * 0.036 * w * grounded;
  torso.position.y = rig.torsoY + bob + Math.sin(t * 2.3) * 0.005 * idle + 0.035 * st.air - squash * 0.08;
  const combo = opts.combo || 1;
  const comboYaw = st.punch * (combo === 2 ? 0.45 : combo === 3 ? -0.85 : -0.35);
  torso.rotation.y = -s * 0.11 * w + Math.sin(t * 0.8) * 0.025 * idle + comboYaw;
  torso.rotation.z = s * 0.055 * w + Math.sin(t * 1.4) * 0.014 * idle - turn * 0.025;
  const lean = 0.04 * w + 0.12 * st.sprint + 0.14 * st.punch + squash * 0.16 - 0.06 * st.air;
  torso.rotation.x = dodgeFrac > 0 ? dodgeFrac * Math.PI * 2 : lean;

  // 头部：视野反向稳定 + 瞄准微倾 + 待机呼吸环顾
  head.rotation.y = lerp(s * 0.075 * w + Math.sin(t * 0.7) * 0.08 * idle, -torso.rotation.y * 0.4, st.aim);
  head.rotation.x = lerp(-lean * 0.6 + Math.sin(phase * 2) * 0.028 * w + Math.sin(t * 1.9) * 0.022 * idle, (opts.pitch || 0) * 0.32, st.aim);
  head.rotation.z = -s * 0.035 * w + Math.sin(t * 1.1 + 0.6) * 0.025 * idle;

  // 手臂：自然摆臂、单/双手持枪、换弹胸前收拢、三段近战挥拳
  const swing = 0.48 * Math.min(w, 1.15) * grounded;
  const pitchAim = opts.pitch || 0;
  const recoil = opts.recoil || 0;
  let lX = -s * swing - 0.30 * st.air;
  let rX = s * swing - 0.30 * st.air;
  lX = lerp(lX, -1.18 + pitchAim * 0.56 - recoil * 0.38, st.aim);
  const supportArmX = lerp(-0.55, -1.10 + pitchAim * 0.48 - recoil * 0.25, st.twoH);
  rX = lerp(rX, supportArmX, st.aim);
  if (st.reload > 0.02) {
    lX = lerp(lX, -0.82, st.reload);
    rX = lerp(rX, -0.95 + Math.sin(t * 9) * 0.12, st.reload);
  }
  if (combo === 2) {
    rX = lerp(rX, -1.55, st.punch);
    lX = lerp(lX, -0.65, st.punch);
  } else if (combo === 3) {
    lX = lerp(lX, -1.20, st.punch);
    rX = lerp(rX, -1.20, st.punch);
  } else {
    lX = lerp(lX, -1.50, st.punch);
  }
  armL.rotation.x = lX;
  armR.rotation.x = rX;
  armL.rotation.z = 0.05 + 0.04 * w + 0.34 * st.air - 0.08 * st.aim + (combo === 3 ? 0.42 * st.punch : 0);
  armR.rotation.z = -(0.05 + 0.04 * w + 0.34 * st.air) + (0.14 + 0.18 * st.twoH) * st.aim - (combo === 3 ? 0.42 * st.punch : 0);

  // 长发：二阶弹簧动力学（后飘 + 转身离心摆动 + 起伏抖动）
  const hxT = 0.10 * w + 0.10 * st.sprint + 0.25 * st.air + squash * 0.22 + Math.sin(phase * 2 - 0.9) * 0.08 * w + Math.sin(t * 1.7) * 0.03 * idle;
  const hzT = Math.sin(phase - 0.6) * 0.07 * w + Math.sin(t * 1.3 + 1.0) * 0.025 * idle - turn * 0.06;
  st.hvx += ((hxT - st.hx) * 46 - st.hvx * 8.5) * dt;
  st.hvz += ((hzT - st.hz) * 42 - st.hvz * 8.0) * dt;
  st.hx += st.hvx * dt;
  st.hz += st.hvz * dt;
  hairBack.rotation.x = st.hx;
  hairBack.rotation.z = st.hz;
  hairBack.rotation.y = -s * 0.04 * w;

  // 鲸尾与尾鳍：两段跟随弹性 + 第3段回旋尾击大幅甩尾
  const sweepTail = combo === 3 ? st.punch * 1.05 * Math.sin(t * 18) : 0;
  const tyT = Math.sin(phase - 0.7) * 0.32 * w + Math.sin(t * 2.2) * 0.20 * idle - turn * 0.09 + sweepTail;
  st.tvy += ((tyT - st.ty) * 58 - st.tvy * 7.8) * dt;
  st.ty += st.tvy * dt;
  tail.rotation.y = st.ty;
  tail.rotation.x = 0.06 + Math.cos(phase * 2) * 0.06 * w - 0.24 * st.air + squash * 0.15;

  const tipT = Math.sin(phase - 1.6) * 0.38 * w + Math.sin(t * 2.2 - 1.1) * 0.24 * idle - st.tvy * 0.06;
  st.tipVy += ((tipT - st.tipY) * 52 - st.tipVy * 7.2) * dt;
  st.tipY += st.tipVy * dt;
  tailTip.rotation.y = st.tipY;
  tailTip.rotation.x = Math.cos(phase * 2 - 1.0) * 0.13 * w;
}

function animMascotRig(rig, phase, amt, opts = {}) {
  const { torso, head, legL, legR, armL, armR, tail } = rig.bones;
  if (opts.dead) {
    torso.position.y = rig.torsoY;
    torso.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    legL.rotation.set(0, 0, 0);
    legR.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, 0);
    armR.rotation.set(0, 0, 0);
    tail.rotation.set(0, 0, 0);
    if (rig.bones.hairBack) { rig.bones.hairBack.rotation.set(0, 0, 0); rig.bones.tailTip.rotation.set(0, 0, 0); }
    return;
  }
  if (rig.kind === 'whale') { animWhaleRig(rig, phase, amt, opts); return; }
  const dt = clamp(opts.dt || 1 / 60, 0.001, 0.06);
  const st = rig.st || (rig.st = { amt: 0, flee: 0 });
  st.amt = damp(st.amt, amt, 10, dt);
  st.flee = damp(st.flee, opts.flee ? 1 : 0, 12, dt);
  const a = st.amt;
  const p = rig.kind === 'naiwa' ? phase * 1.12 : phase;
  const s = Math.sin(p) * a;
  const c = Math.cos(p) * a;
  const idle = clamp(1 - a * 4, 0, 1);
  const legAmp = rig.kind === 'naiwa' ? 0.64 : 0.56;
  const armSwing = 0.52;

  legL.rotation.x = opts.air ? -0.4 : s * legAmp;
  legR.rotation.x = opts.air ? 0.35 : -s * legAmp;
  legL.rotation.z = opts.air ? 0.08 : Math.max(0, c) * 0.10 * a;
  legR.rotation.z = opts.air ? -0.08 : -Math.max(0, -c) * 0.10 * a;

  const fleeX = -1.05 + Math.sin(p * 1.4) * 0.35;
  armL.rotation.x = lerp(opts.punch ? -1.45 : opts.aiming ? -1.15 + (opts.pitch || 0) * 0.55 : -s * armSwing, fleeX, st.flee);
  armR.rotation.x = lerp(s * armSwing, -1.05 - Math.sin(p * 1.4) * 0.35, st.flee);
  armL.rotation.z = lerp(opts.air ? 0.35 : 0.06 * a, 0.45, st.flee);
  armR.rotation.z = lerp(opts.air ? -0.35 : -0.06 * a, -0.45, st.flee);

  torso.position.y = rig.torsoY + (opts.air ? 0.04 : Math.abs(Math.sin(p)) * 0.05 * a + Math.sin(gameTime * 2.4) * 0.012 * idle);
  torso.rotation.y = -s * 0.09;
  torso.rotation.z = s * (rig.kind === 'naiwa' ? 0.085 : 0.06) + Math.sin(gameTime * 1.6) * 0.018 * idle;
  torso.rotation.x = opts.sprint ? 0.11 : (opts.punch ? 0.15 : 0.02 * a);

  head.rotation.y = s * 0.07 + Math.sin(gameTime * 0.9) * 0.06 * idle;
  head.rotation.x = Math.sin(gameTime * 2.2) * 0.025 * idle + Math.sin(p * 2) * 0.03 * a;

  const tailAmp = lerp(0.32 * a, 0.16, idle);
  tail.rotation.y = Math.sin(lerp(p * 1.05, gameTime * 2.6, idle)) * tailAmp;
  tail.rotation.x = Math.cos(p * 2) * 0.08 * a;
}

function attachMascotToPed(p) {
  if (p.mascotRig || !MASCOT_SPECS.naiwa.geos) return;
  const color = pickNaiwaColor();
  for (const ch of p.hm.g.children) ch.visible = false;
  const rig = createMascotRig('naiwa', color, false);
  p.hm.g.add(rig.g);
  p.mascotRig = rig;
}

async function loadRol2Geos(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  let off = 0;
  const magic = dv.getUint32(off, true); off += 4;
  const isRol5 = (magic === 0x354C4F52);
  const hasUV = (magic === 0x344C4F52);
  if (magic !== 0x324C4F52 && !hasUV && !isRol5) throw new Error(`Invalid ROL magic in ${url}`);
  const partCount = dv.getUint32(off, true); off += 4;
  const geos = [];
  for (let i = 0; i < partCount; i++) {
    const partId = dv.getUint32(off, true); off += 4;
    const vertCount = dv.getUint32(off, true); off += 4;
    const indexCount = dv.getUint32(off, true); off += 4;
    let positions, normals, uvs = null, skinIndices, skinWeights, indices;
    if (isRol5) {
      const flags = dv.getUint32(off, true); off += 4;
      const pHasUV = (flags & 1) !== 0;
      const wide = (flags & 2) !== 0;
      const b0 = dv.getFloat32(off, true), b1 = dv.getFloat32(off + 4, true), b2 = dv.getFloat32(off + 8, true);
      const b3 = dv.getFloat32(off + 12, true), b4 = dv.getFloat32(off + 16, true), b5 = dv.getFloat32(off + 20, true);
      off += 24;
      const qPos = new Uint16Array(buf.slice(off, off + vertCount * 6)); off += vertCount * 6;
      positions = new Float32Array(vertCount * 3);
      const sx = (b3 - b0) / 65535, sy = (b4 - b1) / 65535, sz = (b5 - b2) / 65535;
      for (let v = 0; v < vertCount * 3; v += 3) {
        positions[v]     = b0 + qPos[v]     * sx;
        positions[v + 1] = b1 + qPos[v + 1] * sy;
        positions[v + 2] = b2 + qPos[v + 2] * sz;
      }
      const qNrm = new Int8Array(buf.slice(off, off + vertCount * 3)); off += vertCount * 3;
      normals = new Float32Array(vertCount * 3);
      for (let j = 0; j < normals.length; j++) normals[j] = qNrm[j] / 127;
      if (pHasUV) {
        const qUV = new Uint16Array(buf.slice(off, off + vertCount * 4)); off += vertCount * 4;
        uvs = new Float32Array(vertCount * 2);
        for (let j = 0; j < uvs.length; j++) uvs[j] = qUV[j] / 65535;
      }
      skinIndices = new Uint16Array(new Uint8Array(buf.slice(off, off + vertCount * 4))); off += vertCount * 4;
      const qW = new Uint8Array(buf.slice(off, off + vertCount * 4)); off += vertCount * 4;
      skinWeights = new Float32Array(vertCount * 4);
      for (let j = 0; j < skinWeights.length; j++) skinWeights[j] = qW[j] / 255;
      const idxBytes = indexCount * (wide ? 4 : 2);
      indices = wide ? new Uint32Array(buf.slice(off, off + idxBytes)) : new Uint16Array(buf.slice(off, off + idxBytes));
      off += idxBytes;
    } else {
      const posBytes = vertCount * 3 * 4;
      positions = new Float32Array(buf.slice(off, off + posBytes)); off += posBytes;
      normals = new Float32Array(buf.slice(off, off + posBytes)); off += posBytes;
      if (hasUV) {
        const uvBytes = vertCount * 2 * 4;
        uvs = new Float32Array(buf.slice(off, off + uvBytes)); off += uvBytes;
      }
      const skinIdxBytes = vertCount * 4;
      skinIndices = new Uint16Array(new Uint8Array(buf.slice(off, off + skinIdxBytes))); off += skinIdxBytes;
      const skinWtBytes = vertCount * 4 * 4;
      skinWeights = new Float32Array(buf.slice(off, off + skinWtBytes)); off += skinWtBytes;
      const idxBytes = indexCount * 4;
      indices = new Uint32Array(buf.slice(off, off + idxBytes)); off += idxBytes;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    geos.push({ partId, geo });
  }
  if (off !== buf.byteLength) throw new Error(`ROL EOF mismatch in ${url}: ${off} !== ${buf.byteLength}`);
  return geos;
}

async function loadCustomPlayerRole() {
  const [naiwaRes, whaleRes] = await Promise.allSettled([
    loadRol2Geos('assets/naiwa_role.bin'),
    loadRol2Geos('assets/whale_girl.bin'),
  ]);
  if (naiwaRes.status === 'fulfilled') MASCOT_SPECS.naiwa.geos = naiwaRes.value;
  else console.warn('奶娃路人模型加载失败:', naiwaRes.reason);

  if (whaleRes.status === 'fulfilled') MASCOT_SPECS.whale.geos = whaleRes.value;
  else console.warn('鲸鱼娘主角模型加载失败，回退默认主角模型:', whaleRes.reason);

  const pKind = playerRigKind();
  if (pKind) {
    customRoleLoaded = true;
    playerMascotRig = createMascotRig(pKind, PLAYER_MASCOT_COLOR, true);
    customRoleRoot.add(playerMascotRig.g);
    for (const ch of playerBaseBodyParts) ch.visible = false;
    for (const ch of playerBaseArmRParts) ch.visible = false;
    if (pKind === 'whale') {
      player.hm.armR.position.set(0.26, 1.24, 0.10);
      playerAuraRing.position.y = 1.88;
    } else {
      player.hm.armR.position.set(0.52, 1.30, 0.14);
    }

    if (player.inCar) {
      const c = player.inCar;
      if (!c.customDrv) {
        const rig = createMascotRig(pKind, PLAYER_MASCOT_COLOR, false);
        c.customDrv = rig.g;
        c.customSkel = rig.skeleton;
        c.customDrv.scale.setScalar(pKind === 'whale' ? 0.52 : 0.46);
        c.customDrv.position.set(0, pKind === 'whale' ? 0.10 : 0.16, -0.02);
        c.drv.add(c.customDrv);
      }
      for (const ch of c.drv.children) ch.visible = (ch === c.customDrv);
    }
    if (player.inHeli) {
      const h = player.inHeli;
      if (!h.customDrv) {
        const rig = createMascotRig(pKind, PLAYER_MASCOT_COLOR, false);
        h.customDrv = rig.g;
        h.customSkel = rig.skeleton;
        h.customDrv.scale.setScalar(pKind === 'whale' ? 0.48 : 0.44);
        h.customDrv.position.set(0, pKind === 'whale' ? 0.08 : 0.14, -0.02);
        h.drv.add(h.customDrv);
      }
      for (const ch of h.drv.children) ch.visible = (ch === h.customDrv);
    }
  }
  if (MASCOT_SPECS.naiwa.geos) {
    for (const p of peds) {
      if (p.state !== 'dead' && !p.fixedOutfit && !p.mascotRig) {
        attachMascotToPed(p);
      }
    }
  }
}

const cantonBandMats = ['#00d4ff', '#3b82f6', '#8b5cf6', '#ec4899', '#ff6b6b', '#fbbf24', '#10b981']
  .map(col => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.22, roughness: 0.28, metalness: 0.42 }));
const glassTowerMats = [];
let pearlSphereMat = null, pearlSpireMat = null;

async function loadBld1Asset(url, uvScaleU = 14, uvScaleV = 16, projMode = 'box') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  let off = 0;
  const magic = dv.getUint32(off, true); off += 4;
  const isBld2 = (magic === 0x32444C42);
  if (magic !== 0x31444C42 && !isBld2) throw new Error(`Invalid BLD magic in ${url}`);
  const partCount = dv.getUint32(off, true); off += 4;
  if (!isBld2) off += 24; // BLD1 跳过全局 bbox[6]
  const geos = [];
  for (let i = 0; i < partCount; i++) {
    const partId = dv.getUint32(off, true); off += 4;
    const vertCount = dv.getUint32(off, true); off += 4;
    const indexCount = dv.getUint32(off, true); off += 4;
    let positions, normals, indices;
    if (isBld2) {
      const idxElem = dv.getUint32(off, true); off += 4;
      const b0 = dv.getFloat32(off, true), b1 = dv.getFloat32(off + 4, true), b2 = dv.getFloat32(off + 8, true);
      const b3 = dv.getFloat32(off + 12, true), b4 = dv.getFloat32(off + 16, true), b5 = dv.getFloat32(off + 20, true);
      off += 24;
      const qPos = new Uint16Array(buf.slice(off, off + vertCount * 6)); off += vertCount * 6;
      positions = new Float32Array(vertCount * 3);
      const sx = (b3 - b0) / 65535, sy = (b4 - b1) / 65535, sz = (b5 - b2) / 65535;
      for (let v = 0; v < vertCount * 3; v += 3) {
        positions[v]     = b0 + qPos[v]     * sx;
        positions[v + 1] = b1 + qPos[v + 1] * sy;
        positions[v + 2] = b2 + qPos[v + 2] * sz;
      }
      const qNrm = new Int8Array(buf.slice(off, off + vertCount * 3)); off += vertCount * 3;
      normals = new Float32Array(vertCount * 3);
      for (let j = 0; j < normals.length; j++) normals[j] = qNrm[j] / 127;
      const idxBytes = indexCount * idxElem;
      indices = idxElem === 4 ? new Uint32Array(buf.slice(off, off + idxBytes)) : new Uint16Array(buf.slice(off, off + idxBytes));
      off += idxBytes;
    } else {
      const vecBytes = vertCount * 3 * 4;
      positions = new Float32Array(buf.slice(off, off + vecBytes)); off += vecBytes;
      normals = new Float32Array(buf.slice(off, off + vecBytes)); off += vecBytes;
      const idxBytes = indexCount * 4;
      indices = new Uint32Array(buf.slice(off, off + idxBytes)); off += idxBytes;
    }

    let uvs;
    if (projMode === 'cylindrical') {
      // 柱面环绕投影 + 自动接缝劈裂，确保东方明珠球体与塔柱上的红紫玻璃幕墙无缝环绕
      const turns = 6;
      const posArr = Array.from(positions);
      const nrmArr = Array.from(normals);
      const uvArr = [];
      for (let v = 0; v < vertCount; v++) {
        const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
        const ang = Math.atan2(x, z);
        uvArr.push((ang / (Math.PI * 2) + 0.5) * turns, y / uvScaleV);
      }
      const seamClone = new Map();
      const newIdx = new Uint32Array(indices.length);
      for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
        const u0 = uvArr[i0 * 2], u1 = uvArr[i1 * 2], u2 = uvArr[i2 * 2];
        const span = Math.max(u0, u1, u2) - Math.min(u0, u1, u2);
        if (span > turns * 0.5) {
          const fixV = (vi) => {
            if (uvArr[vi * 2] >= turns * 0.5) return vi;
            let nv = seamClone.get(vi);
            if (nv === undefined) {
              nv = posArr.length / 3;
              seamClone.set(vi, nv);
              posArr.push(posArr[vi * 3], posArr[vi * 3 + 1], posArr[vi * 3 + 2]);
              nrmArr.push(nrmArr[vi * 3], nrmArr[vi * 3 + 1], nrmArr[vi * 3 + 2]);
              uvArr.push(uvArr[vi * 2] + turns, uvArr[vi * 2 + 1]);
            }
            return nv;
          };
          newIdx[t] = fixV(i0); newIdx[t + 1] = fixV(i1); newIdx[t + 2] = fixV(i2);
        } else {
          newIdx[t] = i0; newIdx[t + 1] = i1; newIdx[t + 2] = i2;
        }
      }
      positions = new Float32Array(posArr);
      normals = new Float32Array(nrmArr);
      uvs = new Float32Array(uvArr);
      indices = newIdx;
    } else {
      uvs = new Float32Array(vertCount * 2);
      for (let v = 0; v < vertCount; v++) {
        const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
        const nx = normals[v * 3], nz = normals[v * 3 + 2];
        uvs[v * 2] = (Math.abs(nx) >= Math.abs(nz) ? z : x) / uvScaleU;
        uvs[v * 2 + 1] = y / uvScaleV;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    geos.push({ partId, geo });
  }
  if (off !== buf.byteLength) throw new Error(`BLD EOF mismatch in ${url}: ${off} !== ${buf.byteLength}`);
  return geos;
}

const landmarkLODs = [];
const statueLODs = [];
function updateCityLOD() {
  const P = playerAnchor();
  for (const s of statueLODs) {
    const d2 = dist2(s.x, s.z, P.x, P.z);
    s.g.visible = d2 < 170 * 170;
    if (s.bodyMesh) s.bodyMesh.castShadow = d2 < 85 * 85;
  }
  for (const l of landmarkLODs) {
    const cs = dist2(l.x, l.z, P.x, P.z) < 155 * 155;
    for (const m of l.shadowMeshes) m.castShadow = cs;
  }
}

async function loadCityLandmarks() {
  const [swfcMap, swfcRgh, swfcEm] = glassCurtainTextures({
    top: '#2f78b8', bot: '#62b4eb', mullion: '#b8cad8', spandrel: '#243c54',
    nightCols: ['#ffe9b0', '#cce9ff', '#ffda88', '#e6f5ff'],
  });
  const swfcGlassMat = new THREE.MeshStandardMaterial({
    map: swfcMap, roughnessMap: swfcRgh, emissiveMap: swfcEm, envMap: cityEnvMap,
    emissive: 0xffffff, emissiveIntensity: 0.06,
    roughness: 0.12, metalness: 0.48, envMapIntensity: 1.85,
  });
  const swfcCrownMat = new THREE.MeshStandardMaterial({
    color: '#d4deea', emissive: '#6cb8ff', emissiveIntensity: 0.12, roughness: 0.24, metalness: 0.86, envMap: cityEnvMap, envMapIntensity: 1.4,
  });

  const [jinMap, jinRgh, jinEm] = glassCurtainTextures({
    top: '#46889e', bot: '#7fc2d4', mullion: '#cdd8e2', spandrel: '#2b4752',
    nightCols: ['#fff0be', '#d8f6ff', '#ffd984', '#ffffff'],
  });
  const jinmaoGlassMat = new THREE.MeshStandardMaterial({
    map: jinMap, roughnessMap: jinRgh, emissiveMap: jinEm, envMap: cityEnvMap,
    emissive: 0xffffff, emissiveIntensity: 0.06,
    roughness: 0.12, metalness: 0.48, envMapIntensity: 1.85,
  });
  const jinmaoCrownMat = new THREE.MeshStandardMaterial({
    color: '#e6dcc8', emissive: '#ffd27a', emissiveIntensity: 0.12, roughness: 0.22, metalness: 0.84, envMap: cityEnvMap, envMapIntensity: 1.4,
  });

  const darkGraniteMat = new THREE.MeshStandardMaterial({ color: '#2c333d', roughness: 0.65, metalness: 0.25 });
  const brushedAlumMat = new THREE.MeshStandardMaterial({ color: '#a6b3c0', roughness: 0.28, metalness: 0.78, envMap: cityEnvMap, envMapIntensity: 1.3 });
  const brushedSteelMat = new THREE.MeshStandardMaterial({ color: '#b8c2cc', roughness: 0.26, metalness: 0.82, envMap: cityEnvMap, envMapIntensity: 1.35 });

  // 东方明珠：塔腿/立柱/天线为浅灰混凝土与银钢，仅标志性的大中小三颗球体使用红紫反光玻璃幕墙
  const pearlConcreteMat = new THREE.MeshStandardMaterial({
    color: '#cbd2dc', roughness: 0.56, metalness: 0.14, envMap: cityEnvMap, envMapIntensity: 0.45,
  });
  const [pearlSphMap, pearlSphRgh, pearlSphEm] = glassCurtainTextures({
    top: '#8c175d', bot: '#df459d', mullion: '#f2cce4', spandrel: '#460a30',
    nightCols: ['#ffa4dc', '#ffe2f5', '#ffe5a8', '#ff6ec2'],
  });
  pearlSphereMat = new THREE.MeshStandardMaterial({
    map: pearlSphMap, roughnessMap: pearlSphRgh, emissiveMap: pearlSphEm, envMap: cityEnvMap,
    emissive: 0xffffff, emissiveIntensity: 0.10,
    roughness: 0.10, metalness: 0.52, envMapIntensity: 2.05,
  });
  pearlSpireMat = new THREE.MeshStandardMaterial({
    color: '#e6ecf2', emissive: '#ff4da6', emissiveIntensity: 0.18,
    roughness: 0.22, metalness: 0.85, envMap: cityEnvMap, envMapIntensity: 1.4,
  });

  curtainGlassMats.push(swfcGlassMat, jinmaoGlassMat, pearlSphereMat);
  crownGlowMats.push(swfcCrownMat, jinmaoCrownMat);

  const matSets = {
    canton: {
      0: new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.72, metalness: 0.08 }),
      1: cantonBandMats[0], 2: cantonBandMats[1], 3: cantonBandMats[2], 4: cantonBandMats[3],
      5: cantonBandMats[4], 6: cantonBandMats[5], 7: cantonBandMats[6],
      8: new THREE.MeshStandardMaterial({ color: '#e2e8f0', emissive: '#ff5252', emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.85 }),
    },
    swfc: {
      0: swfcGlassMat,
      1: darkGraniteMat,
      2: brushedAlumMat,
      3: swfcCrownMat,
    },
    pearl: {
      0: pearlConcreteMat,
      1: pearlSphereMat,
      2: new THREE.MeshStandardMaterial({ color: '#505662', roughness: 0.72, metalness: 0.16 }),
      3: pearlSpireMat,
    },
    jinmao: {
      0: jinmaoGlassMat,
      1: darkGraniteMat,
      2: brushedSteelMat,
      3: jinmaoCrownMat,
    },
    statue: {
      0: new THREE.MeshStandardMaterial({ color: '#ffd642', emissive: '#d49a00', emissiveIntensity: 0.05, roughness: 0.52, metalness: 0.03 }), // 温润哑光雕塑质感（无楼宇硬反射斑块）
      1: ROLE_FEATURE_MATS[2], // 白色眼白与高光
      2: ROLE_FEATURE_MATS[4], // 黑色亮面瞳孔
    },
    statue_fly: {
      0: new THREE.MeshStandardMaterial({ color: '#ffd642', emissive: '#d49a00', emissiveIntensity: 0.05, roughness: 0.52, metalness: 0.03 }), // 温润飞鸟奶娃雕塑
      1: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.28, metalness: 0.04 }),
      2: new THREE.MeshStandardMaterial({ color: '#24c45c', roughness: 0.24, metalness: 0.06 }), // 外圈碧绿眼眸
      3: new THREE.MeshStandardMaterial({ color: '#0d0f13', roughness: 0.12, metalness: 0.20 }), // 内圈亮黑瞳孔
      4: new THREE.MeshBasicMaterial({ color: '#ffffff' }), // 眼神高光
      5: new THREE.MeshStandardMaterial({ color: '#d4c392', roughness: 0.56, metalness: 0.12 }), // 石金底座
    },
    god_naiwa: {
      0: new THREE.MeshStandardMaterial({ color: '#ffd944', emissive: '#ffae20', emissiveIntensity: 0.42, roughness: 0.26, metalness: 0.30, envMap: cityEnvMap, envMapIntensity: 1.3 }), // 金耀神躯
      1: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f4ff', emissiveIntensity: 0.55, roughness: 0.20, metalness: 0.15 }), // 纯白天使羽翼
      2: new THREE.MeshStandardMaterial({ color: '#26d668', emissive: '#14883e', emissiveIntensity: 0.45, roughness: 0.16, metalness: 0.12 }), // 外圈翡翠圣瞳
      3: new THREE.MeshStandardMaterial({ color: '#0a0c10', roughness: 0.08, metalness: 0.28 }), // 内圈深邃黑瞳
      4: new THREE.MeshBasicMaterial({ color: '#ffffff' }), // 眼神圣光
    },
  };

  const files = [
    ['canton',      'assets/bld_canton.bin',         14, 16, 'box'],
    ['swfc',        'assets/bld_swfc.bin',           14, 16, 'box'],
    ['pearl',       'assets/bld_pearl.bin',          10, 12, 'cylindrical'],
    ['jinmao',      'assets/bld_jinmao.bin',         12, 14, 'box'],
    ['statue',      'assets/statue_naiwa.bin',       14, 16, 'box'],
    ['statue_fly',  'assets/statue_fly_naiwa.bin',   14, 16, 'box'],
    ['god_naiwa',   'assets/god_naiwa.bin',          14, 16, 'box'],
    ['laugh_naiwa', 'assets/laugh_naiwa.bin',        14, 16, 'box'],
  ];
  const loaded = {};
  const results = await Promise.allSettled(files.map(([, url, su, sv, pm]) => loadBld1Asset(url, su, sv, pm)));
  results.forEach((r, idx) => {
    const [id] = files[idx];
    if (r.status === 'fulfilled') loaded[id] = r.value;
    else console.warn(`地标/雕像模型 ${id} 加载失败:`, r.reason);
  });

  for (const pl of landmarkPlacements) {
    const parts = loaded[pl.id];
    if (!parts) continue;
    const g = new THREE.Group();
    const mats = matSets[pl.id];
    const shadowMeshes = [];
    for (const { partId, geo } of parts) {
      const m = new THREE.Mesh(geo, mats[partId] || mats[0]);
      m.castShadow = (partId === 0);
      m.receiveShadow = true;
      if (partId === 0) shadowMeshes.push(m);
      g.add(fixStatic(m));
    }
    g.position.set(pl.x, 0.28, pl.z);
    g.rotation.y = pl.rotY;
    scene.add(fixStatic(g));
    landmarkLODs.push({ x: pl.x, z: pl.z, shadowMeshes });
  }

  const statueFamily = [];
  if (loaded.statue) statueFamily.push({ parts: loaded.statue, mats: matSets.statue });
  if (loaded.statue_fly) statueFamily.push({ parts: loaded.statue_fly, mats: matSets.statue_fly });
  if (statueFamily.length > 0) {
    for (const p of parks) {
      const pickStat = statueFamily.length > 1 ? statueFamily[(p.j + p.k) % 2] : statueFamily[0];
      const g = new THREE.Group();
      let bodyMesh = null;
      for (const { partId, geo } of pickStat.parts) {
        const m = new THREE.Mesh(geo, pickStat.mats[partId] || pickStat.mats[0]);
        m.castShadow = (partId === 0);
        m.receiveShadow = true;
        if (partId === 0) bodyMesh = m;
        g.add(fixStatic(m));
      }
      g.position.set(p.x, 1.56, p.z);
      g.rotation.y = Math.atan2(-p.x, -p.z);
      scene.add(fixStatic(g));
      statueLODs.push({ x: p.x, z: p.z, g, bodyMesh });
    }
  }
  if (loaded.god_naiwa) mountGodNaiwaModel(loaded.god_naiwa, matSets.god_naiwa);
  if (loaded.laugh_naiwa) {
    laughNaiwaParts = loaded.laugh_naiwa;
    populateLaughGroup(playerLaughGroup, laughNaiwaParts);
    for (const ph of philo.list) populateLaughGroup(ph.laughGroup, laughNaiwaParts);
  }
  updateCityLOD();
}

// 第一人称武器视图模型（挂在相机上）
const fpvRig = new THREE.Group();
fpvRig.visible = false;
camera.add(fpvRig);
const fpvHolder = new THREE.Group();
fpvHolder.position.set(0.24, -0.22, -0.45);
fpvRig.add(fpvHolder);
const fpvMuzzle = new THREE.Object3D();
fpvMuzzle.position.set(0, 0.035, -0.22);
fpvHolder.add(fpvMuzzle);
const fpvMeshes = [];
{
  const fArm = '#32363f', fGlove = '#1a1c22';

  // 1. 近战拳套（战术指虎手套 + 护腕）
  const fFist = new THREE.Group();
  addWpnPart(0.078, 0.078, 0.26, fArm, fFist, 0.02, -0.05, 0.05);
  addWpnPart(0.094, 0.092, 0.115, '#d8ac8a', fFist, 0.02, -0.04, -0.13);
  addWpnPart(0.098, 0.036, 0.085, fGlove, fFist, 0.02, -0.025, -0.13);
  addWpnPart(0.102, 0.026, 0.032, wpnGunmetal, fFist, 0.02, 0.008, -0.16);

  // 2. 战术手枪（CNC金属滑套 + 铬抛壳口 + 三点绿氚光准星 + 下挂战术灯）
  const fPistol = new THREE.Group();
  addWpnPart(0.062, 0.062, 0.20, fArm, fPistol, 0, -0.08, 0.12);
  addWpnPart(0.042, 0.105, 0.058, wpnPolymer, fPistol, 0, -0.048, 0.012);
  addWpnPart(0.046, 0.026, 0.22, wpnDarkSteel, fPistol, 0, 0.002, -0.06);     // 下机匣与导轨
  addWpnPart(0.044, 0.030, 0.23, wpnGunmetal, fPistol, 0, 0.030, -0.065);     // 上滑套
  addWpnPart(0.024, 0.012, 0.048, wpnChrome, fPistol, 0.012, 0.042, -0.035);  // 亮铬抛壳口
  addWpnCyl(0.010, 0.010, 0.036, wpnChrome, fPistol, 0, 0.029, -0.19, 'z', 8);// 内枪管
  addWpnPart(0.008, 0.012, 0.010, wpnSightGreen, fPistol, 0, 0.051, -0.165);  // 前氚光准星
  addWpnPart(0.008, 0.012, 0.010, wpnSightGreen, fPistol, -0.012, 0.051, 0.035);
  addWpnPart(0.008, 0.012, 0.010, wpnSightGreen, fPistol, 0.012, 0.051, 0.035);
  addWpnPart(0.028, 0.026, 0.056, wpnDarkSteel, fPistol, 0, -0.018, -0.12);   // 下挂战术灯
  addWpnCyl(0.009, 0.009, 0.008, wpnSightRed, fPistol, 0, -0.018, -0.15, 'z', 8);

  // 3. MP5 战术冲锋枪（圆柱消音器 + 分段弯弹匣 + 斜前握把 + 开放红点镜）
  const fSmg = new THREE.Group();
  addWpnPart(0.068, 0.068, 0.22, fArm, fSmg, 0, -0.085, 0.13);
  addWpnPart(0.054, 0.072, 0.26, wpnDarkSteel, fSmg, 0, 0.012, -0.04);        // 主机匣
  addWpnPart(0.050, 0.044, 0.16, wpnPolymer, fSmg, 0, -0.002, -0.17);         // 护木
  const smgMag = addWpnPart(0.034, 0.155, 0.044, wpnPolymer, fSmg, 0, -0.095, -0.075);
  smgMag.rotation.x = 0.18;                                                   // 前倾弯弹匣
  addWpnCyl(0.019, 0.019, 0.18, wpnGunmetal, fSmg, 0, 0.016, -0.32, 'z', 12); // 消音器筒
  addWpnPart(0.032, 0.012, 0.14, wpnDarkSteel, fSmg, 0, 0.052, -0.05);        // 皮卡汀尼导轨
  addWpnPart(0.036, 0.028, 0.065, wpnDarkSteel, fSmg, 0, 0.070, -0.045);      // 红点底座
  addWpnPart(0.006, 0.024, 0.024, wpnDarkSteel, fSmg, -0.015, 0.094, -0.05);  // 瞄镜左框
  addWpnPart(0.006, 0.024, 0.024, wpnDarkSteel, fSmg, 0.015, 0.094, -0.05);   // 瞄镜右框
  addWpnPart(0.036, 0.006, 0.024, wpnDarkSteel, fSmg, 0, 0.106, -0.05);       // 瞄镜顶框
  addWpnPart(0.005, 0.005, 0.004, wpnSightRed, fSmg, 0, 0.090, -0.05);        // 红点准心

  // 4. 泵动战术霰弹枪（油润胡桃木 + 双层圆柱枪管/弹仓 + 亮铬抛壳窗 + 金属准星珠）
  const fShot = new THREE.Group();
  addWpnPart(0.068, 0.068, 0.22, fArm, fShot, 0, -0.085, 0.14);
  addWpnPart(0.056, 0.074, 0.22, wpnWood, fShot, 0, -0.022, 0.10);            // 胡桃木后托
  addWpnPart(0.058, 0.072, 0.19, wpnGunmetal, fShot, 0, 0.012, -0.05);        // 钢机匣
  addWpnPart(0.012, 0.022, 0.072, wpnChrome, fShot, 0.028, 0.024, -0.05);     // 抛壳窗口
  addWpnCyl(0.015, 0.015, 0.44, wpnDarkSteel, fShot, 0, 0.034, -0.35, 'z', 12);// 上枪管
  addWpnCyl(0.013, 0.013, 0.36, wpnGunmetal, fShot, 0, 0.002, -0.31, 'z', 10); // 下供弹管
  addWpnPart(0.014, 0.008, 0.42, wpnDarkSteel, fShot, 0, 0.052, -0.34);       // 散热瞄准肋条
  addWpnPart(0.050, 0.044, 0.17, wpnWood, fShot, 0, -0.008, -0.25);           // 泵动护木
  addWpnPart(0.006, 0.008, 0.006, wpnSightGreen, fShot, 0, 0.058, -0.54);     // 荧光前准星珠

  // 5. M4A1 突击步枪（四面战术导轨 + 弯弹匣 + 倾斜握把 + 圆柱重枪管 + EOTech全息镜）
  const fRifle = new THREE.Group();
  addWpnPart(0.065, 0.068, 0.22, fArm, fRifle, 0, -0.085, 0.15);
  addWpnPart(0.056, 0.068, 0.21, wpnPolymer, fRifle, 0, -0.018, 0.13);        // 伸缩枪托
  addWpnPart(0.056, 0.076, 0.19, wpnGunmetal, fRifle, 0, 0.012, -0.04);       // 机匣
  addWpnPart(0.010, 0.018, 0.064, wpnChrome, fRifle, 0.026, 0.024, -0.04);    // 镀铬枪机片
  const rMag = addWpnPart(0.032, 0.155, 0.056, wpnPolymer, fRifle, 0, -0.088, -0.055);
  rMag.rotation.x = 0.14;                                                     // 弧形 5.56 弹匣
  addWpnPart(0.052, 0.058, 0.19, wpnDarkSteel, fRifle, 0, 0.018, -0.22);      // 四面散热护木
  const afg = addWpnPart(0.028, 0.068, 0.032, wpnPolymer, fRifle, 0, -0.036, -0.24);
  afg.rotation.x = -0.22;                                                     // 战术前握把
  addWpnCyl(0.012, 0.012, 0.24, wpnDarkSteel, fRifle, 0, 0.024, -0.42, 'z', 10); // 长枪管
  addWpnCyl(0.016, 0.014, 0.052, wpnGunmetal, fRifle, 0, 0.024, -0.55, 'z', 8);  // 鸟笼消焰器
  addWpnPart(0.038, 0.022, 0.088, wpnDarkSteel, fRifle, 0, 0.058, -0.05);     // 全息镜底座
  addWpnPart(0.038, 0.034, 0.062, wpnPolymer, fRifle, 0, 0.082, -0.05);       // 全息防撞罩
  addWpnPart(0.026, 0.022, 0.008, wpnLens, fRifle, 0, 0.082, -0.062);         // 蓝膜镜片
  addWpnPart(0.005, 0.005, 0.005, wpnSightRed, fRifle, 0, 0.082, -0.052);     // 清晰红点

  // 6. AWP 精密狙击步枪（橄榄绿底盘 + 凹槽重管 + 制退器 + 两脚架 + 三段式 8× 光学镜）
  const fSniper = new THREE.Group();
  addWpnPart(0.065, 0.068, 0.22, fArm, fSniper, 0, -0.085, 0.15);
  addWpnPart(0.062, 0.078, 0.25, wpnOlive, fSniper, 0, -0.020, 0.12);         // 拇指孔枪托
  addWpnPart(0.048, 0.022, 0.10, wpnPolymer, fSniper, 0, 0.024, 0.12);        // 贴腮板
  addWpnPart(0.058, 0.072, 0.28, wpnOlive, fSniper, 0, 0.008, -0.10);         // 前护木底盘
  addWpnPart(0.050, 0.036, 0.15, wpnDarkSteel, fSniper, 0, 0.044, -0.05);     // 机匣顶盖
  addWpnCyl(0.014, 0.015, 0.44, wpnDarkSteel, fSniper, 0, 0.032, -0.42, 'z', 12); // 重型浮置枪管
  addWpnPart(0.036, 0.032, 0.064, wpnGunmetal, fSniper, 0, 0.032, -0.65);     // 双孔制退器
  for (const bx of [-0.024, 0.024]) addWpnCyl(0.007, 0.007, 0.14, wpnDarkSteel, fSniper, bx, -0.026, -0.28, 'z', 8); // 折叠两脚架
  addWpnCyl(0.019, 0.019, 0.12, wpnDarkSteel, fSniper, 0, 0.082, -0.05, 'z', 14); // 镜管中段
  addWpnCyl(0.024, 0.021, 0.07, wpnDarkSteel, fSniper, 0, 0.082, 0.03, 'z', 14);  // 目镜端
  addWpnCyl(0.027, 0.021, 0.09, wpnDarkSteel, fSniper, 0, 0.082, -0.15, 'z', 14); // 物镜遮光罩
  addWpnCyl(0.023, 0.023, 0.008, wpnLens, fSniper, 0, 0.082, -0.195, 'z', 14);    // 镀膜物镜

  fpvMeshes.push(fFist, fPistol, fSmg, fShot, fRifle, fSniper);
  fpvMeshes.forEach((m, i) => { m.visible = (i === player.wpn); fpvHolder.add(m); });
}

/* ============================ HUD ============================ */
const hud = {
  money: $('money'), stars: $('stars'), clock: $('clock'), district: $('district'),
  weapon: $('weapon'), mission: $('mission'), philoHud: $('philoHud'), speedo: $('speedo'),
  buffTags: $('buffTags'), storyHint: $('storyHint'), scopeOverlay: $('scopeOverlay'),
  killFeed: $('killFeed'), wpnBar: $('wpnBar'), codexPanel: $('codexPanel'),
  hp: $('hpfill'), armor: $('armorfill'), stamina: $('staminafill'),
  cross: $('crosshair'), hitmarker: $('hitmarker'),
  msg: $('msg'), big: $('bigtext'), bountySummary: $('bountySummary'), flash: $('dmgflash'),
  godflash: $('godflash'), epiphany: $('epiphany'), epTitle: $('epTitle'), epSub: $('epSub'),
  phone: $('phone'), phTime: $('phTime'), phList: $('phList'),
  bestRecord: $('bestRecord'),
  dialog: $('dialog'), dlgSpeaker: $('dlgSpeaker'), dlgRole: $('dlgRole'), dlgText: $('dlgText'), dlgChoices: $('dlgChoices'),
};
const mm = $('minimap'), mmg = mm.getContext('2d');
const lastHUD = {};
function setHTML(el, key, val) { if (el && lastHUD[key] !== val) { lastHUD[key] = val; el.innerHTML = val; } }
let msgT = 0, flashA = 0;
function showMsg(text, dur = 3) { hud.msg.innerHTML = text; hud.msg.style.opacity = 1; msgT = dur; }
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ============================ 赏金猎人模式状态 ============================ */
let gameMode = 'free'; // 'free' | 'bounty'
const bounty = {
  wave: 0, targets: [], surviveTime: 0, kills: 0, targetKills: 0, earned: 0, cooldown: 0,
  bestTime: 0, bestKills: 0,
};
try {
  const saved = JSON.parse(localStorage.getItem('liberty_bounty_best') || 'null');
  if (saved) { bounty.bestTime = saved.time || 0; bounty.bestKills = saved.kills || 0; }
} catch {}
function saveBountyBest() {
  let broke = false;
  if (bounty.surviveTime > bounty.bestTime) { bounty.bestTime = bounty.surviveTime; broke = true; }
  if (bounty.kills > bounty.bestKills) { bounty.bestKills = bounty.kills; broke = true; }
  try { localStorage.setItem('liberty_bounty_best', JSON.stringify({ time: bounty.bestTime, kills: bounty.bestKills })); } catch {}
  renderBestRecord();
  return broke;
}
function renderBestRecord() {
  if (!hud.bestRecord) return;
  hud.bestRecord.textContent = (bounty.bestTime > 0 || bounty.bestKills > 0)
    ? `🏆 赏金猎人最佳记录：存活 ${fmtTime(bounty.bestTime)} · 击杀 ${bounty.bestKills} 人`
    : '🏆 赏金猎人模式：挑战最长存活时间与最高击杀数！';
}
renderBestRecord();

function getDistrict(x, z) {
  if (z > EDGE - 2 || (x > EDGE - 2 && Math.abs(z - roadC(12)) < 48)) return '翡翠港湾 · Emerald Harbor';
  if (Math.hypot(x, z) < 165) return '自由城核心 · Midtown';
  if (x > 220 && z < -180) return '霓虹科技湾 · Neon Tech Bay';
  if (x > 260 && z >= -180) return '东海岸码头 · East Coast';
  if (Math.max(Math.abs(x), Math.abs(z)) > 430) return '滨海大道 · Waterfront';
  if (z < -150) return '阿尔冈琴 · Algonquin';
  if (z > 150) return '布洛克区 · Broker';
  if (x < -150) return '奥尔德尼 · Alderney';
  return '公爵区 · Dukes';
}

/* ============================ 通缉系统 ============================ */
function addHeat(v) { heat = Math.min(heat + v, 300); lostT = 0; }
function setMinHeat(v) { if (heat < v) heat = v; lostT = 0; }
function policeNear(r) {
  const P = playerAnchor();
  return cars.some(c => c.police && c.driver === 'police' && !c.wreck && dist2(c.x, c.z, P.x, P.z) < r * r);
}

/* ============================ 车辆 ============================ */
function spawnCar(x, z, h, opts = {}) {
  let kind = opts.kind;
  if (!kind) {
    if (opts.police) kind = 'police';
    else {
      const r = Math.random();
      kind = r < 0.11 ? 'taxi' : r < 0.17 ? 'hyper' : r < 0.34 ? 'sport' : r < 0.51 ? 'suv' : 'sedan';
    }
  }
  const police = kind === 'police';
  const cfg = CAR_TYPES[kind];
  const color = opts.color || (police ? '#16213d' : kind === 'taxi' ? '#f2c200' : pick(CAR_COLORS));
  const m = makeCarMesh(color, kind);
  const c = {
    ...m, kind, x, z, h, y: 0, ground: 0, jy: 0, jv: 0, vx: 0, vz: 0, speed: 0, prevSpeed: 0, steer: 0, pitch: 0, roll: 0,
    hp: cfg.hp, maxHp: cfg.hp, police, braking: false,
    nitro: 100, nitroActive: false,
    driver: opts.driver === undefined ? 'ai' : opts.driver, ai: null, direct: false,
    wreck: false, burnT: 0, deadT: 0, stuckT: 0, reverseT: 0, blockT: 0, ignoreT: 0,
    shootT: rand(0.5, 1.5), accel: cfg.accel + rand(-1, 1), maxSpeed: cfg.maxSpeed + rand(-1.5, 1.5),
    wheelSpin: 0, smokeT: 0, lastHitByPlayer: false,
    gear: 1, rpm: 900, shiftT: 0, shiftFlashT: 0,
    cop: null, copOut: false, copX: 0, copZ: 0, copPhase: 0,
  };
  if (police) { c.cop = makeHuman('#1d2c5a', '#111a33'); part(0.36, 0.1, 0.36, '#0d1530', c.cop.g, 0, 1.9, 0); c.cop.g.visible = false; }
  c.g.position.set(x, 0, z); c.g.rotation.y = h;
  cars.push(c);
  return c;
}
function removeCar(c) {
  scene.remove(c.g); c.bodyMat.dispose(); c.tlMat.dispose();
  if (c.underglowMat) c.underglowMat.dispose();
  if (c.lightR) c.lightR.material.dispose();
  if (c.lightB) c.lightB.material.dispose();
  if (c.customSkel) c.customSkel.dispose();
  if (c.cop) scene.remove(c.cop.g);
  const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1);
}
function neighbors(i, k) {
  const r = [];
  if (i > 0) r.push([i - 1, k]); if (i < N) r.push([i + 1, k]);
  if (k > 0) r.push([i, k - 1]); if (k < N) r.push([i, k + 1]);
  return r;
}
function aiFromPos(c) {
  const i = clamp(Math.round((c.x + HALF) / CELL), 0, N), k = clamp(Math.round((c.z + HALF) / CELL), 0, N);
  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  let best = null, bd = -Infinity;
  for (const [a, b] of neighbors(i, k)) {
    const dx = roadC(a) - roadC(i), dz = roadC(b) - roadC(k);
    const dot = (dx * fx + dz * fz) / CELL;
    if (dot > bd) { bd = dot; best = [a, b]; }
  }
  // 若车已经越过了最近路口，则直接驶向下一个路口
  const toNode = (roadC(i) - c.x) * fx + (roadC(k) - c.z) * fz;
  if (toNode > 4) {
    // 还没到路口：先开向最近路口
    const back = neighbors(i, k).reduce((acc, nb) => {
      const dot = ((roadC(nb[0]) - roadC(i)) * fx + (roadC(nb[1]) - roadC(k)) * fz);
      return dot < acc.d ? { d: dot, nb } : acc;
    }, { d: Infinity, nb: null }).nb;
    return { fi: back[0], fk: back[1], ti: i, tk: k };
  }
  return { fi: i, fk: k, ti: best[0], tk: best[1] };
}
function spawnTraffic(police, minD = 70, maxD = 190) {
  const P = playerAnchor();
  for (let tries = 0; tries < 25; tries++) {
    const i = randi(0, N), k = randi(0, N);
    const [ti, tk] = pick(neighbors(i, k));
    const ax = roadC(i), az = roadC(k), bx = roadC(ti), bz = roadC(tk);
    const dx = Math.sign(bx - ax), dz = Math.sign(bz - az);
    const t = rand(0.25, 0.75);
    const x = lerp(ax, bx, t) - dz * LANE, z = lerp(az, bz, t) + dx * LANE;
    const d = Math.sqrt(dist2(x, z, P.x, P.z));
    if (d < minD || d > maxD) continue;
    if (cars.some(c => dist2(c.x, c.z, x, z) < 100)) continue;
    const c = spawnCar(x, z, Math.atan2(dx, dz), { police, driver: police ? 'police' : 'ai' });
    c.ai = { fi: i, fk: k, ti, tk };
    c.vx = dx * 10; c.vz = dz * 10;
    return c;
  }
  return null;
}

function damageCar(c, dmg, byPlayer) {
  if (c.wreck || dmg <= 0) return;
  const prev = c.hp;
  c.hp -= dmg;
  if (byPlayer) c.lastHitByPlayer = true;
  if (c.hp <= 0 && prev > 0) {
    c.burnT = 4.5;
    if (c.driver === 'ai' || c.driver === 'police') ejectDriver(c);
    if (c === player.inCar) showMsg('<b style="color:#ff6a3a">车辆起火！快按 F 下车！</b>', 3);
  }
}
function ejectDriver(c) {
  const lx = Math.cos(c.h), lz = -Math.sin(c.h);
  const p = spawnPed({ x: c.x + lx * 1.8, z: c.z + lz * 1.8, state: 'flee', shirt: c.police ? '#1d2c5a' : undefined, pants: c.police ? '#111a33' : undefined });
  if (p) { p.tx = player.x; p.tz = player.z; }
  if (c.cop) { c.copOut = false; c.cop.g.visible = false; }
  c.driver = null;
}
function explodeCar(c) {
  c.wreck = true; c.hp = 0; c.burnT = 0; c.deadT = 0;
  c.bodyMat.color.set('#1b1b1b'); c.bodyMat.metalness = 0; c.bodyMat.roughness = 1;
  c.jv = 7;
  if (c.lightR) { c.lightR.material.color.set('#200'); c.lightB.material.color.set('#002'); }
  if (c.cop) { c.copOut = false; c.cop.g.visible = false; }
  const P = playerAnchor();
  const dP = Math.sqrt(dist2(c.x, c.z, P.x, P.z));
  sndBoom(clamp(1.2 - dP / 120, 0.1, 1));
  shake = Math.max(shake, clamp(1.2 - dP / 50, 0, 1.2));
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(3, 14);
    emit(c.x, 1.2, c.z, Math.cos(a) * s, rand(3, 12), Math.sin(a) * s, pick(['#ffdd55', '#ff8822', '#ff4400']), rand(0.5, 1.1), rand(0.4, 0.9), -9, 1.5);
  }
  for (let i = 0; i < 20; i++) emit(c.x + rand(-2, 2), rand(1, 3), c.z + rand(-2, 2), rand(-2, 2), rand(2, 5), rand(-2, 2), '#2a2a2a', rand(1, 1.6), rand(2, 3.5), 0.5, 1.5);
  if (c.lastHitByPlayer) addHeat(c.police ? 100 : 20);
  // 车里的玩家必死
  if (c === player.inCar) { exitCar(true); damagePlayer(999); }
  if (c.driver === 'ai' || c.driver === 'police') c.driver = null;
  // 范围伤害
  for (const p of peds) if (p.state !== 'dead') {
    const d = Math.sqrt(dist2(p.x, p.z, c.x, c.z));
    if (d < 7) killPed(p, (p.x - c.x) / (d + 0.1) * 12, (p.z - c.z) / (d + 0.1) * 12, c.lastHitByPlayer);
  }
  if (!inVehicle() && !player.dead && player.y < 6) {
    const d = Math.sqrt(dist2(player.x, player.z, c.x, c.z));
    if (d < 8) damagePlayer((1 - d / 8) * 90);
  }
  for (const o of cars) if (o !== c && !o.wreck) {
    const d = Math.sqrt(dist2(o.x, o.z, c.x, c.z));
    if (d < 7.5) {
      damageCar(o, 450 * (1 - d / 7.5), c.lastHitByPlayer);
      o.vx += (o.x - c.x) / (d + 0.1) * 8; o.vz += (o.z - c.z) / (d + 0.1) * 8; o.jv = 3;
    }
  }
}

const GEAR_MAX = [0, 0.22, 0.42, 0.64, 0.84, 1.04];
const GEAR_TRQ = [0, 1.32, 1.14, 0.98, 0.85, 0.72];
function carPhysics(c, inp, dt) {
  let fx = Math.sin(c.h), fz = Math.cos(c.h);
  let fs = c.vx * fx + c.vz * fz, ls = c.vx * -fz + c.vz * fx;
  const wasNitro = c.nitroActive;
  const useNitro = !!inp.nitro && !c.wreck && c.nitro > 1 && inp.throttle > 0;
  c.nitroActive = useNitro;
  if (useNitro) {
    c.nitro = Math.max(0, c.nitro - 28 * dt);
    if (!wasNitro && c === player.inCar) sndNitro();
  } else {
    c.nitro = Math.min(100, c.nitro + 11 * dt);
  }
  const maxF = c.maxSpeed + (useNitro ? (c.isHyper ? 18 : 14) : 0), maxR = 13;
  const fastCar = c.kind === 'sport' || c.isHyper;

  // 自动 5 速 + R/N 换挡与离合断动力
  const sr = Math.max(0, fs) / maxF;
  let tgtGear = c.gear;
  if (fs < -0.5 || (inp.throttle < 0 && fs <= 0.5)) tgtGear = -1;
  else if (Math.abs(fs) < 0.35 && inp.throttle <= 0) tgtGear = 0;
  else {
    if (c.gear <= 0) tgtGear = 1;
    else if (c.gear < 5 && sr > GEAR_MAX[c.gear] * 0.94 && inp.throttle > 0) tgtGear = c.gear + 1;
    else if (c.gear > 1 && sr < GEAR_MAX[c.gear - 1] * 0.74) tgtGear = c.gear - 1;
  }
  if (tgtGear !== c.gear && c.shiftT <= 0 && !c.wreck) {
    const up = tgtGear > c.gear && c.gear >= 1;
    c.gear = tgtGear;
    c.shiftT = c.isHyper ? 0.08 : c.kind === 'sport' ? 0.11 : 0.19;
    c.shiftFlashT = 0.28;
    if (c === player.inCar && (up || tgtGear >= 1)) {
      sndShift(up, fastCar);
      c.pitch = clamp(c.pitch + (up ? -0.028 : 0.022), -0.07, 0.07);
      shake = Math.max(shake, 0.035);
      if (fastCar && up && c.gear >= 2) {
        for (const s of [-0.62, 0.62]) {
          const ex = c.x - fx * 2.25 - fz * s, ez = c.z - fz * 2.25 + fx * s;
          for (let k = 0; k < 2; k++) emit(ex, c.ground + 0.36, ez, -fx * rand(3, 6) + rand(-0.5, 0.5), rand(0.2, 1), -fz * rand(3, 6) + rand(-0.5, 0.5), pick(['#ffaa30', '#60b8ff']), 0.14, 0.16);
        }
      }
    }
  }
  const shifting = c.shiftT > 0;
  if (shifting) c.shiftT = Math.max(0, c.shiftT - dt);

  if (inp.throttle > 0) {
    if (fs < -0.5) fs += 42 * inp.throttle * dt;
    else if (!shifting) {
      const nMul = useNitro ? 1.52 : 1;
      fs += c.accel * nMul * GEAR_TRQ[clamp(c.gear, 1, 5)] * (1 - clamp(sr, 0, 1) * 0.40) * inp.throttle * dt;
    }
  } else if (inp.throttle < 0) {
    const t = -inp.throttle;
    if (fs > 0.5) fs -= 42 * t * dt;
    else fs -= c.accel * 0.72 * t * dt;
  } else fs -= Math.sign(fs) * Math.min(Math.abs(fs), 4 * dt);
  if (inp.handbrake) fs -= Math.sign(fs) * Math.min(Math.abs(fs), 14 * dt);
  fs = clamp(fs, -maxR, maxF);

  if (useNitro && Math.random() < 0.75) {
    for (const s of [-0.55, 0.55]) {
      const ex = c.x - fx * 2.26 - fz * s, ez = c.z - fz * 2.26 + fx * s;
      emit(ex, c.ground + 0.34, ez, -fx * rand(5, 8), rand(0.1, 0.7), -fz * rand(5, 8), pick(['#38d9ff', '#8b5cf6', '#e0f7fa']), 0.17, 0.16);
    }
    if (c === player.inCar) shake = Math.max(shake, 0.02);
  }

  let targetRpm = 900;
  if (c.gear === 0) targetRpm = 900 + (inp.throttle > 0 ? 2200 : 0);
  else if (c.gear === -1) targetRpm = 1100 + clamp(Math.abs(fs) / maxR, 0, 1) * 4400;
  else {
    const lo = GEAR_MAX[c.gear - 1] * 0.56, hi = GEAR_MAX[c.gear];
    const band = clamp((sr - lo) / Math.max(0.08, hi - lo), 0, 1);
    targetRpm = (shifting ? 1400 : 1200 + band * 5900);
  }
  c.rpm = lerp(c.rpm, targetRpm, Math.min(1, dt * 14));
  const grip = inp.handbrake ? 1.15 : (c.wreck ? 4 : c.isHyper ? 7.4 : 6.6);
  ls *= Math.exp(-grip * dt);
  c.steer += (inp.steer - c.steer) * Math.min(1, dt * 8);
  const tf = clamp(fs / 6.5, -1, 1) * (1 - clamp(Math.abs(fs) / maxF, 0, 1) * 0.44);
  c.h += c.steer * (c.isHyper ? 2.55 : 2.35) * tf * dt * (inp.handbrake ? 1.48 : 1);
  fx = Math.sin(c.h); fz = Math.cos(c.h);
  c.vx = fx * fs - fz * ls; c.vz = fz * fs + fx * ls;
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.speed = fs;
  c.drift = Math.abs(ls);
  for (let s = -1; s <= 1; s += 2) {
    const p = { x: c.x + fx * 1.3 * s, z: c.z + fz * 1.3 * s };
    const ox = p.x, oz = p.z;
    const hit = collideCircle(p, 1.1);
    if (hit) {
      c.x += p.x - ox; c.z += p.z - oz;
      const vn = c.vx * hit.nx + c.vz * hit.nz;
      if (vn < 0) {
        c.vx -= vn * 1.3 * hit.nx; c.vz -= vn * 1.3 * hit.nz;
        c.vx *= 0.9; c.vz *= 0.9;
        const imp = -vn;
        if (imp > 7) {
          damageCar(c, (imp - 7) * 7, c === player.inCar);
          if (c === player.inCar) {
            sndCrash(clamp(imp / 30, 0.2, 1)); shake = Math.max(shake, Math.min(1, imp / 40));
            if (imp > 26) damagePlayer((imp - 26) * 0.8);
          }
          for (let i = 0; i < 5; i++) emit(c.x + fx * 2 * s, 0.8, c.z + fz * 2 * s, rand(-3, 3), rand(1, 4), rand(-3, 3), '#ffcc66', 0.08, 0.4, -10);
        }
      }
    }
  }
}

function playerCarInput() {
  return {
    throttle: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    steer: (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0),
    handbrake: !!keys.Space,
    nitro: !!(keys.ShiftLeft || keys.ShiftRight),
  };
}

function obstacleAhead(c) {
  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  const look = 6 + Math.max(0, c.speed) * 0.5;
  const test = (x, z, w) => {
    const rx = x - c.x, rz = z - c.z;
    const fd = rx * fx + rz * fz;
    if (fd < 1.5 || fd > look) return false;
    return Math.abs(-rx * fz + rz * fx) < w;
  };
  for (const o of cars) if (o !== c && test(o.x, o.z, 2.3)) return true;
  if (!inVehicle() && !player.dead && player.y < 2.2 && test(player.x, player.z, 1.8)) return true;
  for (const p of peds) if (p.state !== 'dead' && p.state !== 'walk' && test(p.x, p.z, 1.6)) return true;
  return false;
}

function aiDrive(c, dt) {
  const inp = { throttle: 0, steer: 0, handbrake: false };
  const P = playerAnchor();
  const dP = Math.sqrt(dist2(c.x, c.z, P.x, P.z));
  const chasing = c.driver === 'police' && stars > 0 && !player.dead;
  if (chasing && c.copOut) { inp.handbrake = true; inp.throttle = c.speed > 0.5 ? -1 : 0; return inp; }
  let tx, tz, target;
  const chaseSpd = 24 + stars * 4.5;
  const roadSpd = 22 + stars * 3.8;
  const directOK = chasing && dP < 38 && !segBlocked(c.x, c.z, P.x, P.z);
  if (directOK) {
    c.direct = true;
    tx = P.x; tz = P.z;
    if (player.inCar) target = chaseSpd;
    else target = dP > 18 ? Math.min(chaseSpd, 22) : dP > 9 ? 8 : 0;
  } else {
    if (!c.ai || c.direct) { c.ai = aiFromPos(c); c.direct = false; }
    const a = c.ai;
    const nx = roadC(a.ti), nz = roadC(a.tk);
    const dx = Math.sign(nx - roadC(a.fi)), dz = Math.sign(nz - roadC(a.fk));
    const off = chasing ? 0 : LANE;
    tx = nx - dz * off; tz = nz + dx * off;
    const dd = dist2(c.x, c.z, tx, tz);
    if (dd < (chasing ? 81 : 36)) {
      let nb = neighbors(a.ti, a.tk).filter(([i, k]) => !(i === a.fi && k === a.fk));
      if (!nb.length) nb = neighbors(a.ti, a.tk);
      let next;
      if (chasing) {
        next = nb.reduce((best, n) => (dist2(roadC(n[0]), roadC(n[1]), P.x, P.z) < dist2(roadC(best[0]), roadC(best[1]), P.x, P.z) ? n : best));
      } else next = pick(nb);
      a.fi = a.ti; a.fk = a.tk; a.ti = next[0]; a.tk = next[1];
    }
    target = chasing ? roadSpd : 13;
    if (dd < 22 * 22) target = Math.min(target, chasing ? 15 + stars * 0.8 : 9);
  }
  const desiredH = Math.atan2(tx - c.x, tz - c.z);
  const ad = angDiff(c.h, desiredH);
  inp.steer = clamp(ad * 2.5, -1, 1);
  if (Math.abs(ad) > 0.6) target = Math.min(target, chasing ? 14 + stars * 0.8 : 7);
  if (c.ignoreT > 0) c.ignoreT -= dt;
  else if (!chasing && obstacleAhead(c)) {
    target = 0; c.blockT += dt;
    if (c.blockT > 3) { c.ignoreT = 1.5; c.blockT = 0; }
  } else c.blockT = 0;
  // 非追捕车辆遵守路口红绿灯
  if (!chasing && c.ai && target > 0) {
    const a = c.ai;
    const nx = roadC(a.ti), nz = roadC(a.tk);
    const dx = nx - roadC(a.fi), dz = nz - roadC(a.fk);
    const movingNS = Math.abs(dz) > Math.abs(dx);
    const green = movingNS ? trafficNSGreen : !trafficNSGreen;
    if (!green) {
      const distToInter = Math.hypot(nx - c.x, nz - c.z);
      if (distToInter > 9 && distToInter < 17) target = 0;
    }
  }
  if (c.speed < target - 1) inp.throttle = 1;
  else if (c.speed > target + 1.5) inp.throttle = -0.7;
  if (target === 0 && Math.abs(c.speed) < 0.5) inp.throttle = 0;
  // 卡住了就倒车
  if (c.reverseT > 0) {
    c.reverseT -= dt; inp.throttle = -1; inp.steer = -inp.steer;
  } else if (inp.throttle > 0 && Math.abs(c.speed) < 1.2) {
    c.stuckT += dt;
    if (c.stuckT > 1.4) { c.reverseT = 1.1; c.stuckT = 0; }
  } else c.stuckT = Math.max(0, c.stuckT - dt);
  return inp;
}

function carCircles(c) {
  const fx = Math.sin(c.h) * 1.25, fz = Math.cos(c.h) * 1.25;
  return [[c.x + fx, c.z + fz], [c.x - fx, c.z - fz]];
}
function carCarCollisions() {
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (dist2(a.x, a.z, b.x, b.z) > 36) continue;
    const ca = carCircles(a), cb = carCircles(b);
    for (const [ax, az] of ca) for (const [bx, bz] of cb) {
      const dx = bx - ax, dz = bz - az, d2 = dx * dx + dz * dz;
      if (d2 >= 4.84 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = (2.2 - d) / 2;
      a.x -= nx * pen; a.z -= nz * pen; b.x += nx * pen; b.z += nz * pen;
      const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vn < 0) {
        const jimp = -1.3 * vn / 2;
        a.vx -= nx * jimp; a.vz -= nz * jimp; b.vx += nx * jimp; b.vz += nz * jimp;
        const imp = -vn;
        if (imp > 6) {
          const byP = a === player.inCar || b === player.inCar;
          damageCar(a, (imp - 6) * 6, byP); damageCar(b, (imp - 6) * 6, byP);
          if (byP) { sndCrash(clamp(imp / 30, 0.2, 1)); shake = Math.max(shake, Math.min(0.8, imp / 40)); if (imp > 30) damagePlayer((imp - 30) * 0.6); }
          if (byP && (a.police || b.police) && imp > 10) setMinHeat(50);
        }
      }
    }
  }
}
function closestOnCar(c, x, z) {
  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  const fd = clamp((x - c.x) * fx + (z - c.z) * fz, -1.0, 1.0);
  return [c.x + fx * fd, c.z + fz * fd];
}
function carPedCollisions() {
  for (const c of cars) {
    const fast = Math.abs(c.speed) > 4.5;
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    for (const p of peds) {
      if (dist2(p.x, p.z, c.x, c.z) > 16) {
        // 行人躲避玩家飞驰而来的车
        if (c === player.inCar && c.speed > 10 && p.state === 'walk') {
          const rx = p.x - c.x, rz = p.z - c.z, fd = rx * fx + rz * fz;
          if (fd > 0 && fd < 16 && Math.abs(-rx * fz + rz * fx) < 3) { p.state = 'flee'; p.fleeT = rand(3, 5); p.tx = c.x; p.tz = c.z; }
        }
        continue;
      }
      const [qx, qz] = closestOnCar(c, p.x, p.z);
      const d2 = dist2(qx, qz, p.x, p.z);
      if (d2 > 1.25 * 1.25) continue;
      if (p.state === 'dead') continue;
      if (fast) {
        killPed(p, c.vx * 0.7, c.vz * 0.7, c === player.inCar);
        if (c === player.inCar) { sndCrash(0.4); }
      } else {
        const d = Math.sqrt(d2) + 1e-4;
        p.x = qx + (p.x - qx) / d * 1.25; p.z = qz + (p.z - qz) / d * 1.25;
      }
    }
    // 车撞到步行的玩家
    if (!inVehicle() && !player.dead && player.y < 1.8 && c !== player.inCar) {
      const [qx, qz] = closestOnCar(c, player.x, player.z);
      const d2 = dist2(qx, qz, player.x, player.z);
      if (d2 < 1.3 * 1.3) {
        const d = Math.sqrt(d2) + 1e-4;
        player.x = qx + (player.x - qx) / d * 1.3; player.z = qz + (player.z - qz) / d * 1.3;
        if (Math.abs(c.speed) > 7) {
          damagePlayer(Math.abs(c.speed) * 1.4);
          player.vy = 4; player.x += c.vx * 0.15; player.z += c.vz * 0.15;
          c.vx *= 0.7; c.vz *= 0.7;
        }
      }
    }
    // 撞警察
    if (c.police) continue;
  }
  for (const pc of cars) if (pc.copOut) {
    for (const c of cars) {
      if (Math.abs(c.speed) < 6) continue;
      const [qx, qz] = closestOnCar(c, pc.copX, pc.copZ);
      if (dist2(qx, qz, pc.copX, pc.copZ) < 1.3 * 1.3) killCop(pc, c === player.inCar);
    }
  }
}

function updateCars(dt) {
  for (const c of cars) {
    let inp = { throttle: 0, steer: 0, handbrake: false };
    if (!c.wreck && c.hp > 0) {
      if (c.driver === 'player') inp = player.dead ? inp : playerCarInput();
      else if (c.driver === 'ai' || c.driver === 'police') inp = aiDrive(c, dt);
    }
    if (c.wreck || (!c.driver && Math.abs(c.speed) < 3)) inp.handbrake = true;
    c.prevSpeed = c.speed;
    carPhysics(c, inp, dt);
    c.braking = !c.wreck && ((inp.throttle < 0 && c.speed > 0.5) || inp.handbrake);
    // 视觉与悬挂俯仰/侧倾
    c.ground = lerp(c.ground, groundH(c.x, c.z), Math.min(1, dt * 10));
    c.jv -= 25 * dt; c.jy += c.jv * dt; if (c.jy < 0) { c.jy = 0; c.jv = 0; }
    c.g.position.set(c.x, c.ground + c.jy, c.z);
    c.g.rotation.y = c.h;
    const accelG = clamp((c.speed - c.prevSpeed) / Math.max(dt, 0.001), -30, 30);
    c.pitch = lerp(c.pitch, clamp(accelG * 0.0022, -0.055, 0.055), Math.min(1, dt * 8));
    c.roll = lerp(c.roll, clamp(-c.steer * c.speed * 0.0032, -0.09, 0.09), Math.min(1, dt * 8));
    c.root.rotation.x = c.pitch;
    c.root.rotation.z = c.roll;
    c.tlMat.emissiveIntensity = c.wreck ? 0 : (c.braking ? 2.4 : 0.3 + night * 1.2);
    if (c.underglowMat) {
      c.underglowMat.opacity = c.wreck ? 0 : c.nitroActive ? 0.88 : c.isHyper ? (0.36 + night * 0.44) : 0;
      c.underglowMat.color.set(c.nitroActive ? '#40c4ff' : (c.isHyper ? '#00e5ff' : '#38bdf8'));
    }
    // 漂移/急刹轮胎烟雾
    if (!c.wreck && (c.drift > 5 || (inp.handbrake && Math.abs(c.speed) > 10)) && Math.random() < 0.45) {
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      emit(c.x - fx * 1.4 + rand(-0.6, 0.6), c.ground + 0.2, c.z - fz * 1.4 + rand(-0.6, 0.6), rand(-0.6, 0.6), rand(0.6, 1.5), rand(-0.6, 0.6), '#ddd', 0.28, 0.7, 0, 0.9);
    }
    const wr = CAR_TYPES[c.kind] ? CAR_TYPES[c.kind].wheelR : 0.38;
    c.wheelSpin += c.speed * dt / wr;
    for (const w of c.wheels) w.rotation.x = c.wheelSpin;
    c.pivots[0].rotation.y = c.pivots[1].rotation.y = c.steer * 0.5;
    if (c.shiftFlashT > 0) c.shiftFlashT = Math.max(0, c.shiftFlashT - dt);
    const P = playerAnchor();
    c.interior.visible = !c.wreck && (c === player.inCar || dist2(c.x, c.z, P.x, P.z) < 75 * 75);
    c.drv.visible = !c.wreck && !!c.driver && !c.copOut && !(c === player.inCar && fpv);
    if (c.interior.visible) {
      c.steerWheel.rotation.z = -c.steer * 2.1;
      c.needles[0].rotation.z = lerp(2.1, -2.1, clamp((c.rpm - 800) / 6300, 0, 1));
      c.needles[1].rotation.z = lerp(2.1, -2.1, clamp(Math.abs(c.speed) / c.maxSpeed, 0, 1));
      const gPos = { '-1': [-0.22, -0.18], 0: [0, 0], 1: [0.22, 0.18], 2: [-0.22, 0.18], 3: [0.22, 0], 4: [-0.22, 0], 5: [0.22, -0.18] }[c.gear] || [0, 0];
      c.gearLever.rotation.x = lerp(c.gearLever.rotation.x, gPos[0], Math.min(1, dt * 16));
      c.gearLever.rotation.z = lerp(c.gearLever.rotation.z, gPos[1], Math.min(1, dt * 16));
    }
    if (c.police && !c.wreck) {
      const on = c.driver === 'police' && stars > 0;
      const ph = Math.floor(gameTime * 6) % 2;
      c.lightR.material.color.set(on && ph ? '#ff2020' : '#550000');
      c.lightB.material.color.set(on && !ph ? '#2060ff' : '#000055');
    }
    // 损坏特效
    c.smokeT -= dt;
    if (!c.wreck && c.hp > 0 && c.hp < c.maxHp * 0.4 && c.smokeT <= 0) {
      c.smokeT = 0.08;
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      emit(c.x + fx * 1.8, 1.2, c.z + fz * 1.8, rand(-0.5, 0.5), rand(1.5, 3), rand(-0.5, 0.5), c.hp < c.maxHp * 0.2 ? '#333' : '#999', 0.3, 1.2, 0, 0.9);
    }
    if (!c.wreck && c.hp <= 0) {
      c.burnT -= dt;
      if (c.smokeT <= 0) {
        c.smokeT = 0.03;
        const fx = Math.sin(c.h), fz = Math.cos(c.h);
        emit(c.x + fx * 1.6 + rand(-0.6, 0.6), 1.2, c.z + fz * 1.6 + rand(-0.6, 0.6), rand(-0.4, 0.4), rand(2, 4), rand(-0.4, 0.4), pick(['#ffb030', '#ff6a10', '#ffd060']), 0.35, 0.5, 0, 0.3);
        emit(c.x + fx * 1.6, 1.8, c.z + fz * 1.6, rand(-0.5, 0.5), rand(2, 3), rand(-0.5, 0.5), '#222', 0.4, 1.6, 0, 1.0);
      }
      if (c.burnT <= 0) explodeCar(c);
    }
    if (c.wreck) {
      c.deadT += dt;
      if (c.deadT < 15 && c.smokeT <= 0) { c.smokeT = 0.12; emit(c.x, 1.4, c.z, rand(-0.4, 0.4), rand(1.5, 2.5), rand(-0.4, 0.4), '#2b2b2b', 0.5, 2.2, 0, 1.0); }
    }
  }
  carCarCollisions();
  carPedCollisions();
}

/* ============================ 警察（下车执法） ============================ */
function npcShoot(fx, fy, fz) {
  if (godActive()) return;
  const P = playerAnchor();
  const tx = P.x, ty = player.inHeli ? P.y + 1.4 : player.inCar ? 1.0 : groundH(player.x, player.z) + player.y + 1.3, tz = P.z;
  const d = Math.hypot(tx - fx, ty - fy, tz - fz);
  if (d > 75) return;
  const steps = Math.ceil(d / 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointInBuilding(lerp(fx, tx, t), lerp(fy, ty, t), lerp(fz, tz, t))) return;
  }
  const acc = (0.32 + 0.07 * stars) * clamp(1.25 - d / 35, 0.2, 1);
  const hit = Math.random() < acc;
  const miss = hit ? 0 : 1;
  const end = new THREE.Vector3(tx + rand(-1.5, 1.5) * miss, ty + rand(-0.5, 1) * miss, tz + rand(-1.5, 1.5) * miss);
  tracer(new THREE.Vector3(fx, fy, fz), end);
  emit(fx, fy, fz, 0, 0, 0, '#ffe080', 0.12, 0.06);
  sndGun(clamp(1 - d / 70, 0.1, 0.7));
  if (hit) {
    if (player.inHeli) { damageHeli(player.inHeli, 16); damagePlayer(1.0); }
    else if (player.inCar) { damageCar(player.inCar, 18, false); damagePlayer(1.5); }
    else { damagePlayer(rand(6, 11)); for (let i = 0; i < 4; i++) emit(player.x, ty, player.z, rand(-2, 2), rand(0, 3), rand(-2, 2), '#8a0000', 0.07, 0.5, -9); }
  }
}
function killCop(c, byPlayer) {
  if (!c.copOut) return;
  c.copOut = false; c.cop.g.visible = false;
  c.driver = null;
  const p = spawnPed({ x: c.copX, z: c.copZ, shirt: '#1d2c5a', pants: '#111a33', state: 'walk' });
  if (p) { p.h = c.cop.g.rotation.y; killPed(p, rand(-2, 2), rand(-2, 2), false); }
  if (byPlayer) {
    if (gameMode === 'bounty') bounty.kills++;
    addHeat(60); showMsg('击倒警察！通缉等级上升', 2);
  }
}
function updateCops(dt) {
  let close = false;
  const P = playerAnchor();
  for (const c of cars) {
    if (!c.police || !c.cop) continue;
    const chasing = c.driver === 'police' && stars > 0 && !player.dead && !c.wreck && c.hp > 0;
    const d = Math.sqrt(dist2(c.x, c.z, P.x, P.z));
    if (!c.copOut) {
      if (chasing && d < 22 && Math.abs(c.speed) < 1.2 && (!inVehicle() || (player.inCar && Math.abs(player.inCar.speed) < 3))) {
        c.copOut = true;
        c.shootT = rand(1.1, 1.8);
        c.copX = c.x + Math.cos(c.h) * 1.7; c.copZ = c.z - Math.sin(c.h) * 1.7;
        const pt = { x: c.copX, z: c.copZ }; collideCircle(pt, 0.4); c.copX = pt.x; c.copZ = pt.z;
        c.cop.g.visible = true;
      } else if (chasing && stars >= 3 && d < 24) {
        // 高通缉：开车时也会开枪
        c.shootT -= dt;
        if (c.shootT <= 0) { c.shootT = rand(0.9, 1.7); npcShoot(c.x, 1.6, c.z); }
      }
      continue;
    }
    if (!chasing || d > 40) { c.copOut = false; c.cop.g.visible = false; continue; }
    const dx = P.x - c.copX, dz = P.z - c.copZ, dd = Math.hypot(dx, dz) + 1e-4;
    let moving = false;
    if (stars === 1 && dd > 1.3) {
      c.copX += dx / dd * 3.6 * dt; c.copZ += dz / dd * 3.6 * dt; moving = true;
      const pt = { x: c.copX, z: c.copZ }; collideCircle(pt, 0.4); c.copX = pt.x; c.copZ = pt.z;
    } else if (stars >= 2 && dd > 22) {
      c.copX += dx / dd * 3.5 * dt; c.copZ += dz / dd * 3.5 * dt; moving = true;
      const pt = { x: c.copX, z: c.copZ }; collideCircle(pt, 0.4); c.copX = pt.x; c.copZ = pt.z;
    }
    const hm = c.cop;
    hm.g.position.set(c.copX, groundH(c.copX, c.copZ), c.copZ);
    hm.g.rotation.y = Math.atan2(dx, dz);
    if (moving) { c.copPhase += dt * 9; animHuman(hm, c.copPhase, 1); } else animHuman(hm, 0, 0);
    if (stars === 1) {
      hm.armR.rotation.x = -0.8;
      if (dd < 1.9 && !(player.inHeli && player.inHeli.y > 2.5) && player.y <= 3) close = true;
    } else {
      hm.armR.rotation.x = -Math.PI / 2;
      c.shootT -= dt;
      if (c.shootT <= 0) {
        c.shootT = rand(0.75, 1.45);
        hm.g.updateMatrixWorld();
        const mz = hm.armR.localToWorld(new THREE.Vector3(0, -0.8, 0));
        npcShoot(mz.x, mz.y, mz.z);
      }
    }
  }
  if (close) {
    player.bustT += dt;
    if (player.bustT > 0.4 && player.bustT - dt <= 0.4) showMsg('🚔 警方正在实施逮捕！快挣脱或上车逃离！', 1.8);
    if (player.bustT > 2.2) killPlayer('BUSTED');
  } else player.bustT = Math.max(0, player.bustT - dt);
}

/* ============================ 行人 ============================ */
const RL = BLOCK - 3.6, RP = 4 * RL;
function ringOrigin(j, k) { return [blockMin(j) + 1.8, blockMin(k) + 1.8]; }
function ringPos(j, k, t) {
  t = ((t % RP) + RP) % RP;
  const [x0, z0] = ringOrigin(j, k);
  if (t < RL) return [x0 + t, z0];
  if (t < 2 * RL) return [x0 + RL, z0 + t - RL];
  if (t < 3 * RL) return [x0 + RL - (t - 2 * RL), z0 + RL];
  return [x0, z0 + RL - (t - 3 * RL)];
}
function nearestRing(x, z) {
  const j = clamp(Math.floor((x + HALF) / CELL), 0, N - 1), k = clamp(Math.floor((z + HALF) / CELL), 0, N - 1);
  const [x0, z0] = ringOrigin(j, k);
  const cx = clamp(x, x0, x0 + RL), cz = clamp(z, z0, z0 + RL);
  const dl = cx - x0, dr = x0 + RL - cx, dtp = cz - z0, db = z0 + RL - cz, m = Math.min(dl, dr, dtp, db);
  let t;
  if (m === dtp) t = cx - x0; else if (m === dr) t = RL + (cz - z0); else if (m === db) t = 2 * RL + (x0 + RL - cx); else t = 3 * RL + (z0 + RL - cz);
  const [px, pz] = ringPos(j, k, t);
  return { j, k, t, x: px, z: pz };
}
function spawnPed(opts = {}) {
  let x, z, j = 0, k = 0, t = 0;
  if (opts.x !== undefined) { x = opts.x; z = opts.z; const r = nearestRing(x, z); j = r.j; k = r.k; t = r.t; }
  else {
    const P = playerAnchor();
    const minD = opts.minD ?? 50;
    for (let tries = 0; tries < 20; tries++) {
      j = randi(0, N - 1); k = randi(0, N - 1); t = rand(0, RP);
      [x, z] = ringPos(j, k, t);
      const d = Math.sqrt(dist2(x, z, P.x, P.z));
      if (d > minD && d < 140) break;
      x = undefined;
    }
    if (x === undefined) return null;
  }
  const hm = makeHuman(opts.shirt || pick(SHIRTS), opts.pants || pick(PANTS));
  const p = {
    hm, x, z, h: 0, j, k, t, dir: Math.random() < 0.5 ? 1 : -1, speed: rand(1.2, 1.8),
    state: opts.state || 'walk', hp: 60, fleeT: rand(5, 8), tx: x, tz: z, wob: rand(-0.5, 0.5),
    phase: Math.random() * 6, deadT: 0, vx: 0, vz: 0, fall: 0, rx: 0, rz: 0,
    fixedOutfit: !!opts.shirt, mascotRig: null,
  };
  if (!opts.shirt && MASCOT_SPECS.naiwa.geos) attachMascotToPed(p);
  hm.g.position.set(x, groundH(x, z), z);
  peds.push(p);
  return p;
}
function removePed(p) {
  scene.remove(p.hm.g);
  if (p.mascotRig) p.mascotRig.skeleton.dispose();
  const i = peds.indexOf(p); if (i >= 0) peds.splice(i, 1);
}
function alertPeds(x, z, r) {
  for (const p of peds) if (p.state !== 'dead' && dist2(p.x, p.z, x, z) < r * r) {
    p.state = 'flee'; p.fleeT = rand(5, 9); p.tx = x; p.tz = z; p.wob = rand(-0.6, 0.6);
  }
}
function killPed(p, kx, kz, byPlayer) {
  if (p.state === 'dead') return;
  p.state = 'dead'; p.deadT = 0; p.vx = kx; p.vz = kz; p.fall = 0; p.hp = 0;
  for (let i = 0; i < 10; i++) emit(p.x, 1.0, p.z, rand(-2, 2) + kx * 0.1, rand(0.5, 3), rand(-2, 2) + kz * 0.1, '#8a0000', 0.08, 0.6, -9);
  if (byPlayer) {
    if (gameMode === 'bounty') bounty.kills++;
    addHeat(policeNear(65) ? 45 : 22); alertPeds(p.x, p.z, 30);
  }
  if (Math.random() < 0.6) spawnPickup('cash', p.x + rand(-0.5, 0.5), p.z + rand(-0.5, 0.5), randi(5, 60));
}
function damagePed(p, dmg, kx, kz, byPlayer) {
  p.hp -= dmg;
  for (let i = 0; i < 6; i++) emit(p.x, 1.2, p.z, rand(-1.5, 1.5) + kx, rand(0, 2), rand(-1.5, 1.5) + kz, '#9a0000', 0.07, 0.5, -9);
  if (p.hp <= 0) killPed(p, kx * 3, kz * 3, byPlayer);
  else { p.state = 'flee'; p.fleeT = rand(6, 10); p.tx = player.x; p.tz = player.z; }
}
function updatePeds(dt) {
  for (const p of peds) {
    const hm = p.hm;
    if (p.state === 'dead') {
      p.deadT += dt;
      p.fall = Math.min(1, p.fall + dt * 3);
      p.x += p.vx * dt; p.z += p.vz * dt;
      const k = Math.exp(-dt * 4); p.vx *= k; p.vz *= k;
      collideCircle(p, 0.4);
      hm.g.position.set(p.x, groundH(p.x, p.z) + 0.17 * p.fall, p.z);
      hm.g.rotation.set(-Math.PI / 2 * p.fall, p.h, 0, 'YXZ');
      if (p.mascotRig) animMascotRig(p.mascotRig, 0, 0, { dead: true });
      else animHuman(hm, 0, 0);
      continue;
    }
    let moved = false, spd = 0;
    if (p.state === 'walk') {
      p.t += p.dir * p.speed * dt;
      const [x, z] = ringPos(p.j, p.k, p.t);
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > 1e-6) p.h = Math.atan2(dx, dz);
      p.x = x; p.z = z; moved = true; spd = p.speed;
      if (Math.random() < dt * 0.03) p.dir *= -1;
    } else if (p.state === 'flee') {
      p.fleeT -= dt;
      let dx = p.x - p.tx, dz = p.z - p.tz;
      const d = Math.hypot(dx, dz) + 1e-4;
      const a = Math.atan2(dx / d, dz / d) + p.wob;
      p.h += angDiff(p.h, a) * Math.min(1, dt * 6);
      p.x += Math.sin(p.h) * 7 * dt; p.z += Math.cos(p.h) * 7 * dt;
      const hit = collideCircle(p, 0.4);
      if (hit) p.wob += rand(-1, 1) * dt * 10;
      moved = true; spd = 7;
      if (p.fleeT <= 0) { p.state = 'return'; const r = nearestRing(p.x, p.z); Object.assign(p, { j: r.j, k: r.k, t: r.t, rx: r.x, rz: r.z }); }
    } else if (p.state === 'return') {
      const dx = p.rx - p.x, dz = p.rz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.4) p.state = 'walk';
      else {
        p.h = Math.atan2(dx, dz);
        p.x += dx / d * 2 * dt; p.z += dz / d * 2 * dt;
        if (collideCircle(p, 0.4)) { const r = nearestRing(p.x, p.z); Object.assign(p, { j: r.j, k: r.k, t: r.t, rx: r.x, rz: r.z }); }
        moved = true; spd = 2;
      }
    }
    // 不和玩家重叠
    if (!inVehicle() && player.y < 2.2) {
      const d2 = dist2(p.x, p.z, player.x, player.z);
      if (d2 < 0.8 * 0.8 && d2 > 1e-6) {
        const d = Math.sqrt(d2); p.x = player.x + (p.x - player.x) / d * 0.8; p.z = player.z + (p.z - player.z) / d * 0.8;
      }
    }
    // 远距行人裁剪：高空飞行或远处街头跳过高耗骨骼蒙皮计算
    const Pa = playerAnchor();
    const pd2 = dist2(p.x, p.z, Pa.x, Pa.z);
    hm.g.visible = pd2 < 145 * 145;
    if (pd2 < 95 * 95) {
      p.phase += dt * spd * 2.4;
      const pedAmt = moved ? Math.min(1, spd / 3 + 0.35) : 0;
      if (p.mascotRig) animMascotRig(p.mascotRig, p.phase, pedAmt, { flee: p.state === 'flee' });
      else animHuman(hm, p.phase, moved ? Math.min(1, spd / 3 + 0.3) : 0);
    }
    hm.g.position.set(p.x, groundH(p.x, p.z), p.z);
    hm.g.rotation.y = p.h;
  }
}

/* ============================ 拾取物 ============================ */
function spawnPickup(type, x, z, value) {
  let mesh;
  if (type === 'cash') {
    mesh = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: '#3bd16f', emissive: '#1a7a3a', emissiveIntensity: 0.6 }));
    mesh.scale.set(0.5, 0.25, 0.3);
  } else if (type === 'armor') {
    mesh = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: '#3a90ff', emissive: '#104a99', emissiveIntensity: 0.7 }));
    mesh.scale.set(0.55, 0.65, 0.32);
  } else if (type === 'ammo') {
    mesh = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: '#ffd400', emissive: '#997700', emissiveIntensity: 0.6 }));
    mesh.scale.set(0.55, 0.35, 0.4);
  } else {
    mesh = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: '#ff3040', emissive: '#aa0010', emissiveIntensity: 0.8 });
    const a = new THREE.Mesh(boxGeo, m); a.scale.set(0.8, 0.25, 0.25);
    const b = new THREE.Mesh(boxGeo, m); b.scale.set(0.25, 0.8, 0.25);
    mesh.add(a, b);
  }
  mesh.position.set(x, 0.8, z); scene.add(mesh);
  const pk = { mesh, x, z, type, value, active: true, respawnT: 0, life: (type === 'cash' || type === 'ammo') ? 45 : Infinity };
  pickups.push(pk);
  return pk;
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    pk.life -= dt;
    if (pk.life <= 0) { scene.remove(pk.mesh); pickups.splice(i, 1); continue; }
    if (!pk.active) { pk.respawnT -= dt; if (pk.respawnT <= 0) { pk.active = true; pk.mesh.visible = true; } continue; }
    pk.mesh.rotation.y += dt * 2;
    pk.mesh.position.y = groundH(pk.x, pk.z) + 0.8 + Math.sin(gameTime * 3 + i) * 0.15;
    if (player.dead || inVehicle() || player.y > 2.2) continue;
    if (dist2(pk.x, pk.z, player.x, player.z) < 1.6 * 1.6) {
      if (pk.type === 'cash') {
        player.money += pk.value; showMsg(`+$${pk.value}`, 1.2); sndPickup();
        scene.remove(pk.mesh); pickups.splice(i, 1);
      } else if (pk.type === 'ammo') {
        player.ammos[1] += 34; player.ammos[2] += 64; player.ammos[3] += 16; player.ammos[4] += 60; player.ammos[5] += 10;
        showMsg('全武器弹药补给！', 1.4); sndPickup();
        scene.remove(pk.mesh); pickups.splice(i, 1);
      } else if (pk.type === 'armor' && player.armor < player.maxArmor) {
        player.armor = player.maxArmor; showMsg(`防弹衣 +${player.maxArmor}`, 1.5); sndPickup();
        pk.active = false; pk.mesh.visible = false; pk.respawnT = 75;
      } else if (pk.type === 'health' && player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + 50); showMsg('生命值恢复', 1.5); sndPickup();
        pk.active = false; pk.mesh.visible = false; pk.respawnT = 60;
      }
    }
  }
}

/* ============================ 支线任务系统 (6类动态任务) ============================ */
const markerMat = new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
const beamMat = new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.15, depthWrite: false });
const marker = new THREE.Group();
marker.add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.4, 28, 1, true), markerMat));
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 120, 10, 1, true), beamMat); beam.position.y = 60; marker.add(beam);
marker.visible = false; scene.add(marker);
const MISSION_TYPES = [
  { id: 'express',    name: '快车闪送',   text: '把加急包裹送到指定交接点（第 1 站）' },
  { id: 'intercept',  name: '飞车截停',   text: '追上并逼停/摧毁红色嫌疑跑车！' },
  { id: 'hideout',    name: '清剿据点',   text: '铲除标记处的武装黑帮团伙' },
  { id: 'airdrop',    name: '停机坪空投', text: '驾直升机或跳伞前往高空/港口空投区领取补给' },
  { id: 'race',       name: '霓虹竞速',   text: '依次穿过 4 个环城计时检查点！' },
  { id: 'rendezvous', name: '港口暗哨',   text: '赶往翡翠港湾接应线人并带回加密芯片' },
];
const mission = {
  active: false, x: 0, y: 0, z: 0, time: 0, reward: 0, cooldown: 3, type: null, done: 0, streak: 0,
  step: 0, totalSteps: 1, car: null, enemies: [], checkpoints: [], subText: '',
};
function clearMissionExtras() {
  for (const e of mission.enemies) if (e.hm) scene.remove(e.hm.g);
  mission.enemies.length = 0;
  mission.car = null;
  mission.checkpoints.length = 0;
  markerMat.color.set('#ffd400');
  beamMat.color.set('#ffd400');
}
function pickStreetSpot(minD = 130, maxD = 540) {
  const P = playerAnchor();
  for (let tries = 0; tries < 60; tries++) {
    const i = randi(1, N - 1), k = randi(1, N - 1);
    const x = roadC(i) + (Math.random() < 0.5 ? 1 : -1) * (ROAD / 2 + 1.8);
    const z = roadC(k) + (Math.random() < 0.5 ? 1 : -1) * (ROAD / 2 + 1.8);
    if (Math.abs(x) > EDGE - 8 || Math.abs(z) > EDGE - 8) continue;
    const d = Math.sqrt(dist2(x, z, P.x, P.z));
    if (d >= minD && d <= maxD) return { x, z, d };
  }
  return { x: roadC(MID + 2), z: roadC(MID - 2), d: 180 };
}
function newMission() {
  clearMissionExtras();
  const P = playerAnchor();
  const kind = pick(MISSION_TYPES);
  let x = 0, y = 0, z = 0, time = 45, reward = 220, step = 0, totalSteps = 1, subText = kind.text;

  if (kind.id === 'airdrop') {
    const pads = [
      { x: 620, y: 1.8, z: roadC(12), name: '翡翠东码头停机坪' },
      { x: 0, y: 1.8, z: 608, name: '南滨观光栈桥末端' },
    ];
    for (const h of helipads) if (Math.abs(h.x) < EDGE) pads.push({ x: h.x, y: groundH(h.x, h.z) + 0.5, z: h.z, name: '城市停机坪' });
    const chosen = pads.find(p => dist2(p.x, p.z, P.x, P.z) > 120 * 120) || pads[0];
    x = chosen.x; z = chosen.z; y = chosen.y;
    const d = Math.hypot(x - P.x, z - P.z);
    time = Math.round(d / 10 + 48);
    reward = Math.round((300 + d * 1.4) / 10) * 10;
    subText = `前往【${chosen.name}】抢收空投箱`;
    markerMat.color.set('#38d9ff'); beamMat.color.set('#38d9ff');
  } else if (kind.id === 'rendezvous') {
    const spot = Math.random() < 0.5 ? { x: 0, z: 616, name: '南滨栈桥端头' } : { x: 606, z: roadC(12), name: '翡翠港东码头' };
    x = spot.x; z = spot.z; y = groundH(x, z);
    const d = Math.hypot(x - P.x, z - P.z);
    time = Math.round(d / 11 + 40);
    reward = 380;
    totalSteps = 2;
    subText = `赶往${spot.name}取得暗哨芯片 (1/2)`;
    markerMat.color.set('#00e5ff'); beamMat.color.set('#00e5ff');
  } else if (kind.id === 'race') {
    const cps = [];
    let ci = randi(2, N - 2), ck = randi(2, N - 2);
    for (let s = 0; s < 4; s++) {
      const nb = neighbors(ci, ck);
      [ci, ck] = pick(nb);
      cps.push({ x: roadC(ci), z: roadC(ck) });
    }
    mission.checkpoints.push(...cps);
    x = cps[0].x; z = cps[0].z; y = 0;
    totalSteps = 4; time = 34; reward = 460;
    subText = '极速穿过霓虹检查点 (1/4)';
    markerMat.color.set('#a855f7'); beamMat.color.set('#a855f7');
  } else if (kind.id === 'intercept') {
    const sp = pickStreetSpot(100, 260);
    const car = spawnCar(sp.x, sp.z, Math.random() * Math.PI * 2, { kind: 'sport', color: '#e53935', driver: 'ai' });
    car.maxSpeed = 38; car.ai = aiFromPos(car);
    mission.car = car;
    x = car.x; z = car.z; y = 0;
    time = 70; reward = 440;
    subText = '追踪并逼停或摧毁红色目标跑车！';
    markerMat.color.set('#ff3838'); beamMat.color.set('#ff3838');
  } else if (kind.id === 'hideout') {
    const sp = pickStreetSpot(110, 340);
    x = sp.x; z = sp.z; y = groundH(x, z);
    for (let k = 0; k < 3; k++) {
      const pt = { x: x + (k - 1) * 4.5, z: z + (k % 2 ? 4 : -4) };
      collideCircle(pt, 0.5);
      const hm = makeHuman('#3d151d', '#141418');
      part(0.1, 0.34, 0.14, '#1a1a1a', hm.armR, 0, -0.76, 0.06);
      const halo = new THREE.Mesh(enemyHaloGeo, enemyHaloMat);
      halo.rotation.x = Math.PI / 2; halo.position.y = 2.25; hm.g.add(halo);
      hm.g.position.set(pt.x, groundH(pt.x, pt.z), pt.z);
      mission.enemies.push({ hm, halo, x: pt.x, z: pt.z, h: 0, hp: 95, maxHp: 95, speed: 3.4, phase: k * 2, shootT: rand(0.7, 1.4), dead: false, deadT: 0, fall: 0, vx: 0, vz: 0 });
    }
    time = 75; reward = 420;
    subText = '清剿红紫标记处的 3 名武装分子';
    markerMat.color.set('#ff4060'); beamMat.color.set('#ff4060');
  } else {
    const sp = pickStreetSpot(140, 480);
    x = sp.x; z = sp.z; y = groundH(x, z);
    totalSteps = 2;
    time = Math.round(sp.d / 11 + 32);
    reward = Math.round((200 + sp.d * 1.4) / 10) * 10;
    subText = '加急闪送第一站：赶往黄色光柱 (1/2)';
  }

  Object.assign(mission, { active: true, x, y, z, time, reward, type: kind, step, totalSteps, subText });
  marker.position.set(x, y, z); marker.visible = true;
  showMsg(`新任务【${kind.name}】：${subText}`, 4);
}
function damageMissionEnemy(e, dmg, kx, kz) {
  if (e.dead) return;
  e.hp -= dmg;
  for (let i = 0; i < 6; i++) emit(e.x, 1.2, e.z, rand(-1.5, 1.5) + kx, rand(0, 2), rand(-1.5, 1.5) + kz, '#9a0000', 0.07, 0.5, -9);
  if (e.hp <= 0) {
    e.dead = true; e.deadT = 0; e.fall = 0; e.hp = 0;
    e.halo.visible = false;
    spawnPickup('cash', e.x + rand(-0.4, 0.4), e.z + rand(-0.4, 0.4), randi(40, 80));
  }
}
function completeMission() {
  mission.streak++;
  const mult = (player.buffs.platoInsight ? 1.3 : 1.0) * (1 + Math.min(0.5, (mission.streak - 1) * 0.1));
  const pay = Math.round((mission.reward * mult) / 10) * 10;
  player.money += pay; mission.done++;
  showMsg(`<b style="color:#ffd400">任务完成！(连胜×${mission.streak})</b> +$${pay}`, 3.5);
  sndPickup();
  clearMissionExtras();
  mission.active = false; marker.visible = false; mission.cooldown = 4;
}
function updateMission(dt) {
  if (player.dead || gameMode !== 'free') return;
  if (!mission.active) { mission.cooldown -= dt; if (mission.cooldown <= 0) newMission(); return; }
  mission.time -= dt;
  marker.children[0].scale.setScalar(1 + Math.sin(gameTime * 4) * 0.05);
  const P = playerAnchor();
  const curY = player.inHeli ? player.inHeli.y : groundH(P.x, P.z) + player.y;

  if (mission.type.id === 'intercept' && mission.car) {
    const mc = mission.car;
    mission.x = mc.x; mission.z = mc.z; mission.y = groundH(mc.x, mc.z);
    marker.position.set(mc.x, mission.y, mc.z);
    const closeStop = dist2(P.x, P.z, mc.x, mc.z) < 7.5 * 7.5 && Math.abs(mc.speed) < 3.5;
    if (mc.wreck || mc.driver === 'player' || closeStop) {
      mc.driver = null;
      completeMission(); return;
    }
  } else if (mission.type.id === 'hideout') {
    let alive = 0;
    for (let i = mission.enemies.length - 1; i >= 0; i--) {
      const e = mission.enemies[i];
      if (e.dead) {
        e.deadT += dt; e.fall = Math.min(1, e.fall + dt * 3);
        e.hm.g.position.set(e.x, groundH(e.x, e.z) + 0.17 * e.fall, e.z);
        e.hm.g.rotation.set(-Math.PI / 2 * e.fall, e.h, 0, 'YXZ');
        animHuman(e.hm, 0, 0);
        continue;
      }
      alive++;
      e.halo.rotation.z += dt * 3.5;
      const dx = P.x - e.x, dz = P.z - e.z, dd = Math.hypot(dx, dz) + 1e-4;
      e.h = Math.atan2(dx, dz);
      if (dd > 15 && dd < 55) {
        e.x += dx / dd * e.speed * dt; e.z += dz / dd * e.speed * dt;
        collideCircle(e, 0.45);
      }
      e.phase += dt * 5;
      animHuman(e.hm, e.phase, dd > 15 && dd < 55 ? 0.85 : 0);
      e.hm.armR.rotation.x = -Math.PI / 2;
      e.hm.g.position.set(e.x, groundH(e.x, e.z), e.z);
      e.hm.g.rotation.y = e.h;
      if (dd < 34) {
        e.shootT -= dt;
        if (e.shootT <= 0) {
          e.shootT = rand(0.85, 1.5);
          e.hm.g.updateMatrixWorld();
          const mz = e.hm.armR.localToWorld(new THREE.Vector3(0, -0.8, 0));
          npcShoot(mz.x, mz.y, mz.z);
        }
      }
    }
    mission.subText = `剩余武装分子：${alive} 人`;
    if (alive === 0) { completeMission(); return; }
  } else {
    const rad = mission.type.id === 'race' ? 7.0 : 3.6;
    const altOk = mission.type.id === 'airdrop' ? Math.abs(curY - mission.y) < 4.5 : (curY < 9);
    if (dist2(P.x, P.z, mission.x, mission.z) < rad * rad && altOk) {
      mission.step++;
      if (mission.step >= mission.totalSteps) {
        if (mission.type.id === 'airdrop') {
          player.ammos[4] += 40; player.ammos[5] += 8; player.armor = Math.min(player.maxArmor, player.armor + 40);
        }
        completeMission(); return;
      }
      sndPickup();
      if (mission.type.id === 'race') {
        const next = mission.checkpoints[mission.step];
        mission.x = next.x; mission.z = next.z; mission.time += 12;
        mission.subText = `极速穿过霓虹检查点 (${mission.step + 1}/4)`;
      } else if (mission.type.id === 'rendezvous') {
        const drop = pickStreetSpot(160, 420);
        mission.x = drop.x; mission.z = drop.z; mission.y = groundH(drop.x, drop.z);
        mission.time += 28;
        setMinHeat(110);
        mission.subText = '芯片已拿到，甩开追兵送回安全交接点 (2/2)！';
      } else {
        const drop = pickStreetSpot(140, 380);
        mission.x = drop.x; mission.z = drop.z; mission.y = groundH(drop.x, drop.z);
        mission.time += 22;
        mission.subText = '加急闪送终点站：送达最后一程 (2/2)！';
      }
      marker.position.set(mission.x, mission.y, mission.z);
      showMsg(`✓ 阶段推进！${mission.subText}`, 3);
    }
  }
  if (mission.time <= 0) {
    mission.streak = 0;
    showMsg('<b style="color:#ff5050">任务失败：超时（连胜中断）</b>', 3);
    clearMissionExtras();
    mission.active = false; marker.visible = false; mission.cooldown = 5;
  }
}

/* ============================ 赏金猎人系统 ============================ */
const bountyRingGeo = new THREE.TorusGeometry(0.45, 0.06, 8, 20);
const bountyRingMat = new THREE.MeshBasicMaterial({ color: '#ff2e3a' });
function clearBountyTargets() {
  for (const t of bounty.targets) scene.remove(t.hm.g);
  bounty.targets.length = 0;
}
function spawnBountyWave() {
  bounty.wave++;
  const count = Math.min(4, 1 + Math.floor((bounty.wave - 1) / 2));
  const P = playerAnchor();
  for (let n = 0; n < count; n++) {
    let x = 0, z = 0;
    for (let tries = 0; tries < 30; tries++) {
      const j = randi(0, N - 1), k = randi(0, N - 1);
      [x, z] = ringPos(j, k, rand(0, RP));
      const d = Math.sqrt(dist2(x, z, P.x, P.z));
      if (d > 45 && d < 125 && !pointInBuilding(x, 1, z, 0.5)) break;
    }
    const hm = makeHuman(pick(['#8e1b1b', '#222226', '#4a1b5a']), '#141418');
    part(0.1, 0.34, 0.14, '#1a1a1a', hm.armR, 0, -0.76, 0.06);
    const halo = new THREE.Mesh(bountyRingGeo, bountyRingMat);
    halo.rotation.x = Math.PI / 2; halo.position.y = 2.25; hm.g.add(halo);
    hm.g.position.set(x, groundH(x, z), z);
    bounty.targets.push({
      hm, halo, x, z, h: 0, hp: 90 + bounty.wave * 20, maxHp: 90 + bounty.wave * 20,
      speed: rand(3.2, 4.6), phase: Math.random() * 6, shootT: rand(0.6, 1.5),
      dead: false, deadT: 0, fall: 0, vx: 0, vz: 0, reward: 250 + bounty.wave * 100,
    });
  }
  showMsg(`🎯 <b style="color:#ff4040">第 ${bounty.wave} 波赏金目标</b> 已出现（${count} 人）！`, 3.5);
}
function killBountyTarget(t, kx, kz) {
  if (t.dead) return;
  t.dead = true; t.deadT = 0; t.fall = 0; t.hp = 0; t.vx = kx; t.vz = kz;
  t.halo.visible = false;
  bounty.kills++; bounty.targetKills++;
  bounty.earned += t.reward;
  player.money += t.reward;
  player.hp = Math.min(100, player.hp + 15);
  player.armor = Math.min(100, player.armor + 10);
  for (let i = 0; i < 12; i++) emit(t.x, 1.1, t.z, rand(-2, 2) + kx * 0.1, rand(0.5, 3), rand(-2, 2) + kz * 0.1, '#8a0000', 0.09, 0.6, -9);
  spawnPickup('ammo', t.x + rand(-0.6, 0.6), t.z + rand(-0.6, 0.6), 1);
  sndPickup();
  showMsg(`🎯 击杀赏金目标！<b style="color:#7fdc6a">+$${t.reward}</b>`, 2.5);
}
function damageBountyTarget(t, dmg, kx, kz) {
  if (t.dead) return;
  t.hp -= dmg;
  for (let i = 0; i < 6; i++) emit(t.x, 1.2, t.z, rand(-1.5, 1.5) + kx, rand(0, 2), rand(-1.5, 1.5) + kz, '#9a0000', 0.07, 0.5, -9);
  if (t.hp <= 0) killBountyTarget(t, kx * 3, kz * 3);
}
function updateBounty(dt) {
  if (gameMode !== 'bounty') return;
  if (!player.dead) bounty.surviveTime += dt;
  const P = playerAnchor();
  let alive = 0;
  for (let i = bounty.targets.length - 1; i >= 0; i--) {
    const t = bounty.targets[i];
    if (t.dead) {
      t.deadT += dt;
      t.fall = Math.min(1, t.fall + dt * 3);
      t.x += t.vx * dt; t.z += t.vz * dt;
      const k = Math.exp(-dt * 4); t.vx *= k; t.vz *= k;
      collideCircle(t, 0.4);
      t.hm.g.position.set(t.x, groundH(t.x, t.z) + 0.17 * t.fall, t.z);
      t.hm.g.rotation.set(-Math.PI / 2 * t.fall, t.h, 0, 'YXZ');
      animHuman(t.hm, 0, 0);
      if (t.deadT > 15) { scene.remove(t.hm.g); bounty.targets.splice(i, 1); }
      continue;
    }
    alive++;
    t.halo.rotation.z += dt * 3;
    t.halo.position.y = 2.25 + Math.sin(gameTime * 4 + i) * 0.08;
    // 车辆撞击赏金目标
    for (const c of cars) {
      if (dist2(c.x, c.z, t.x, t.z) > 16) continue;
      const [qx, qz] = closestOnCar(c, t.x, t.z);
      if (dist2(qx, qz, t.x, t.z) < 1.3 * 1.3 && Math.abs(c.speed) > 5) {
        damageBountyTarget(t, Math.abs(c.speed) * 4, c.vx * 0.5, c.vz * 0.5);
      }
    }
    if (t.dead || player.dead) continue;
    const dx = P.x - t.x, dz = P.z - t.z, dd = Math.hypot(dx, dz) + 1e-4;
    t.h = Math.atan2(dx, dz);
    let moved = false;
    if (dd > 18) {
      t.x += dx / dd * t.speed * dt; t.z += dz / dd * t.speed * dt;
      collideCircle(t, 0.45); moved = true;
    }
    t.phase += dt * t.speed * 2.3;
    animHuman(t.hm, t.phase, moved ? 0.9 : 0);
    t.hm.armR.rotation.x = -Math.PI / 2;
    t.hm.g.position.set(t.x, groundH(t.x, t.z), t.z);
    t.hm.g.rotation.y = t.h;
    if (dd < 38) {
      t.shootT -= dt;
      if (t.shootT <= 0) {
        t.shootT = rand(0.75, 1.45);
        t.hm.g.updateMatrixWorld();
        const mz = t.hm.armR.localToWorld(new THREE.Vector3(0, -0.8, 0));
        npcShoot(mz.x, mz.y, mz.z);
      }
    }
  }
  if (!player.dead && alive === 0) {
    bounty.cooldown -= dt;
    if (bounty.cooldown <= 0) { spawnBountyWave(); bounty.cooldown = 2.0; }
  }
}

/* ============================ 主线剧情 (8幕 + 6位NPC + 3结局) ============================ */
const story = { stage: 0, soldToElena: false, freeHealUsed: false, ending: null, baiDiscount: false, enemies: [] };
const storyNpcs = [];
const dialog = { open: false, npc: null, text: '', choices: [], isSage: false, isGod: false, philoCompleted: false };
const npcHaloGeo = new THREE.TorusGeometry(0.42, 0.05, 8, 20);
const enemyHaloGeo = new THREE.TorusGeometry(0.45, 0.055, 8, 20);
const enemyHaloMat = new THREE.MeshBasicMaterial({ color: '#c44dff' });

function storyTargetId() {
  if (story.stage === 0 || story.stage === 4) return 'roman';
  if (story.stage === 1) return 'viktor';
  if (story.stage === 2) return 'tony';
  if (story.stage === 5) return 'chen';
  if (story.stage === 7) return 'elena';
  return null;
}

function storyHintText() {
  const hints = [
    '主线 [1/8] 与表哥 罗曼(R) 对话开启自由城之夜',
    '主线 [2/8] 去西北角找线人 老维克多(V) 查探黑账线索',
    '主线 [3/8] 去东区找修车师 托尼(T) 取出工具箱黑账',
    '主线 [4/8] 击溃“铁锤”伊万及其打手，夺回欠条',
    '主线 [5/8] 将“铁锤”黑账带回中城区给 罗曼(R)',
    '主线 [6/8] 赴翡翠东码头见 陈船长(C)，追查“黑曜石”幕后金主',
    '主线 [7/8] 翡翠港码头的火并：击溃“黑曜石”克劳斯！',
    '主线 [8/8] 终局抉择：把加密芯片交给 艾琳(E) / 老维克多(V) / 白博士(D)',
    story.ending === 'truth' ? '✦ 主线完结 ·【黎明头版】：你让正义与真相照亮自由城'
      : story.ending === 'syndicate' ? '✦ 主线完结 ·【暗夜教父】：自由城地下秩序尽归你掌控'
      : story.ending === 'ascend' ? '✦ 主线完结 ·【霓虹飞升】：科技bay的生物芯片觉醒完毕' : '',
  ];
  return hints[clamp(story.stage, 0, 8)] || '';
}

function initStoryNpcs() {
  const defs = [
    { id: 'roman',  mapTag: 'R', name: '罗曼',     role: '表哥 · 出租车行老板',     x: blockMin(MID) + 2.4,         z: blockMin(MID) + 6.0,          shirt: '#8b5a2b', pants: '#2c3e50', skin: '#e0ac69', hair: '#22150c' },
    { id: 'viktor', mapTag: 'V', name: '老维克多', role: '中城区 · 地下线人',       x: blockMin(MID - 1) + BLOCK - 2.4, z: blockMin(MID - 1) + BLOCK - 8.0, shirt: '#37414a', pants: '#18191c', skin: '#f1c27d', hair: '#9a9a9a' },
    { id: 'tony',   mapTag: 'T', name: '托尼',     role: '东区 · 改装修车师',       x: blockMin(MID + 1) + 2.4,     z: blockMin(MID) + 14.0,         shirt: '#1d4e89', pants: '#22262c', skin: '#c68642', hair: '#1b1209' },
    { id: 'elena',  mapTag: 'E', name: '艾琳',     role: '自由城时报 · 调查记者',   x: blockMin(MID - 1) + BLOCK - 2.4, z: blockMin(MID + 1) + 8.0,        shirt: '#8e2438', pants: '#1b1b1f', skin: '#ffdbac', hair: '#3b2412' },
    { id: 'chen',   mapTag: 'C', name: '陈船长',   role: '翡翠港湾 · 资深领港员',   x: 568.0,                       z: 261.5,                        shirt: '#15324c', pants: '#1b2230', skin: '#d9a473', hair: '#dcdcdc' },
    { id: 'bai',    mapTag: 'D', name: '白博士',   role: '霓虹科技湾 · 首席研究员', x: blockMin(12) + 2.8,         z: blockMin(3) + 10.0,           shirt: '#e8eef5', pants: '#263238', skin: '#f2cba7', hair: '#1a1c22' },
  ];
  for (const d of defs) {
    const hm = makeHuman(d.shirt, d.pants, d.skin, d.hair);
    if (d.id === 'chen') part(0.28, 0.08, 0.30, '#0f2035', hm.headPivot, 0, 0.25, 0.02);
    if (d.id === 'bai') part(0.32, 0.06, 0.06, '#00e5ff', hm.headPivot, 0, 0.08, 0.14);
    const pt = { x: d.x, z: d.z };
    collideCircle(pt, 0.45);
    const haloMat = new THREE.MeshBasicMaterial({ color: '#38d9ff' });
    const halo = new THREE.Mesh(npcHaloGeo, haloMat);
    halo.rotation.x = Math.PI / 2; halo.position.y = 2.22;
    hm.g.add(halo);
    hm.g.position.set(pt.x, groundH(pt.x, pt.z), pt.z);
    storyNpcs.push({ ...d, x: pt.x, z: pt.z, hm, halo, haloMat, h: 0 });
  }
}

function spawnStorySquad(specs, cx, cz, msgText) {
  for (const e of story.enemies) scene.remove(e.hm.g);
  story.enemies.length = 0;
  for (const sp of specs) {
    const pt = { x: cx + sp.ox, z: cz + sp.oz };
    collideCircle(pt, 0.5);
    const hm = makeHuman(sp.shirt, '#141418');
    part(0.1, 0.34, 0.14, '#1a1a1a', hm.armR, 0, -0.76, 0.06);
    const halo = new THREE.Mesh(enemyHaloGeo, enemyHaloMat);
    halo.rotation.x = Math.PI / 2; halo.position.y = 2.25; hm.g.add(halo);
    hm.g.position.set(pt.x, groundH(pt.x, pt.z), pt.z);
    story.enemies.push({
      hm, halo, name: sp.name, x: pt.x, z: pt.z, h: 0,
      hp: sp.hp, maxHp: sp.hp, speed: sp.speed || 3.6, phase: Math.random() * 6,
      shootT: rand(0.7, 1.4), dead: false, deadT: 0, fall: 0, vx: 0, vz: 0,
    });
  }
  showMsg(msgText, 4.5);
}
function spawnStoryAmbush(cx, cz) {
  spawnStorySquad([
    { name: '铁锤手下', ox: -10, oz: 10, hp: 90, shirt: '#2a2233' },
    { name: '铁锤手下', ox: 10, oz: 12, hp: 90, shirt: '#2a2233' },
    { name: '“铁锤”伊万', ox: 0, oz: 16, hp: 185, shirt: '#6a1b29' },
  ], cx, cz, '⚔️ “铁锤”伊万带人埋伏在附近！消灭全部 3 名打手！');
}
function spawnHarborBoss() {
  spawnStorySquad([
    { name: '黑曜石雇佣兵', ox: -6, oz: -6, hp: 110, shirt: '#1a2330', speed: 3.8 },
    { name: '黑曜石雇佣兵', ox: -6, oz: 6, hp: 110, shirt: '#1a2330', speed: 3.8 },
    { name: '黑曜石突击手', ox: 6, oz: -5, hp: 135, shirt: '#2f1a30', speed: 4.1 },
    { name: '“黑曜石”克劳斯', ox: 10, oz: 0, hp: 360, shirt: '#881337', speed: 4.0 },
  ], 592, roadC(12), '⚔️ <b style="color:#ff4560">翡翠港终极头目</b> “黑曜石”克劳斯现身码头！全员警戒！');
}

function killStoryEnemy(e, kx, kz) {
  if (e.dead) return;
  e.dead = true; e.deadT = 0; e.fall = 0; e.hp = 0; e.vx = kx; e.vz = kz;
  e.halo.visible = false;
  if (gameMode === 'bounty') bounty.kills++;
  for (let i = 0; i < 12; i++) emit(e.x, 1.1, e.z, rand(-2, 2) + kx * 0.1, rand(0.5, 3), rand(-2, 2) + kz * 0.1, '#8a0000', 0.08, 0.6, -9);
  spawnPickup('cash', e.x + rand(-0.4, 0.4), e.z + rand(-0.4, 0.4), randi(40, 80));
  if (story.enemies.every(x => x.dead)) {
    if (story.stage === 3) {
      story.stage = 4;
      player.money += 400;
      sndPickup();
      showMsg('🏆 击溃“铁锤”！已夺回欠条（+$400），回去找 <b style="color:#ffd400">罗曼 (R)</b>！', 5);
    } else if (story.stage === 6) {
      story.stage = 7;
      player.money += 1200;
      player.ammos[4] += 60; player.ammos[5] += 10;
      sndPickup();
      showMsg('💎 击溃“黑曜石”克劳斯（+$1200）！拿着加密芯片前往 <b>艾琳(E)/维克多(V)/白博士(D)</b> 决定结局！', 6);
    }
  }
}

function damageStoryEnemy(e, dmg, kx, kz) {
  if (e.dead) return;
  e.hp -= dmg;
  for (let i = 0; i < 6; i++) emit(e.x, 1.2, e.z, rand(-1.5, 1.5) + kx, rand(0, 2), rand(-1.5, 1.5) + kz, '#9a0000', 0.07, 0.5, -9);
  if (e.hp <= 0) killStoryEnemy(e, kx * 3, kz * 3);
}

function setDialog(text, choices, style = '') {
  dialog.text = text;
  dialog.choices = choices;
  hud.dialog.className = style;
  hud.dlgSpeaker.textContent = dialog.npc.name;
  hud.dlgRole.textContent = dialog.npc.role;
  hud.dlgText.textContent = text;
  hud.dlgChoices.innerHTML = choices.map((c, i) => `<div class="dlg-opt" data-idx="${i}"><b>[${i + 1}]</b>${c.label}</div>`).join('');
  hud.dialog.style.display = 'block';
}

function closeDialog() {
  const laughSage = (dialog.isSage && dialog.philoCompleted && dialog.npc) ? dialog.npc : null;
  dialog.open = false;
  dialog.npc = null;
  dialog.isSage = false;
  dialog.isGod = false;
  dialog.philoCompleted = false;
  hud.dialog.className = '';
  hud.dialog.style.display = 'none';
  if (laughSage) triggerPhiloLaugh(laughSage);
}

function chooseDialog(idx) {
  if (!dialog.open || idx < 0 || idx >= dialog.choices.length) return;
  playTone(620, 0.04, 0.08, 'sine');
  dialog.choices[idx].action();
}

function openDialog(npc) {
  dialog.open = true; dialog.npc = npc; dialog.isSage = false; dialog.isGod = false; dialog.philoCompleted = false;
  phoneOpen = false; codexOpen = false; mouseL = mouseR = false;
  playTone(540, 0.05, 0.08, 'sine');
  const id = npc.id;
  if (id === 'roman') {
    if (story.stage === 0) {
      setDialog('“表弟！你总算来自由城了！我原本指望靠出租车行养老，没想到布洛克的高利贷‘铁锤’伊万用假合同勒索我……更蹊跷的是，他背后似乎还连着东海码头的走私网。先去中城区西北角找老线人【老维克多(V)】打听虚实！”', [
        { label: '放心，我去会会老维克多（接下主线，+$250 启动费）', action: () => {
          story.stage = 1; player.money += 250; sndPickup();
          setDialog('“拿着这 250 块，门口那辆跑车随便开！按 Shift 还能喷射氮气，按 J 随时查看哲学与剧情手记。小心别撞见巡逻警车！”', [
            { label: '明白，马上出发', action: closeDialog },
          ]);
        }},
        { label: '我先逛逛自由城，待会儿再接手', action: closeDialog },
      ]);
    } else if (story.stage >= 1 && story.stage <= 3) {
      const hint = story.stage === 1 ? '去中城区找【老维克多(V)】！' : story.stage === 2 ? '去东区找修车师【托尼(T)】取回账本！' : '解决托尼车行外的“铁锤”打手！';
      setDialog(`“怎么样，表弟？${hint}”`, [{ label: '正在处理中', action: closeDialog }]);
    } else if (story.stage === 4) {
      setDialog('“天啊，你真把‘铁锤’踢出街区了？！而且账本扉页居然写着【翡翠东码头 2 号栈桥 · 黑曜石货轮】！车行保住了，表弟——但这帮家伙更大的秘密在海港！”', [
        { label: '收下谢礼，准备继续深挖港口幕后金主（+$800 + 金色超跑）', action: () => {
          story.stage = 5; player.money += 800; sndPickup();
          const cx = blockMin(MID) - 3.6, cz = blockMin(MID) + 6.0;
          const gift = spawnCar(cx, cz, Math.PI, { kind: 'hyper', color: '#ffd400', driver: null });
          gift.ai = null; gift.maxSpeed = 68; gift.accel = 35;
          setDialog('“这 800 块和外面停着的那辆金色定制超跑归你了！下一步去东海岸尽头的【翡翠东码头(C)】找老领港员陈船长，他认得‘黑曜石’号货轮！”', [
            { label: '好，下一站翡翠港码头！', action: closeDialog },
          ]);
        }},
      ]);
    } else if (story.stage >= 5 && story.stage < 8) {
      setDialog('“黑曜石那帮家伙可比铁锤狠十倍，记得去找维克多买足防弹衣与步枪/狙击弹药再上港口栈桥！”', [{ label: '记住了，表哥', action: closeDialog }]);
    } else {
      setDialog('“自由城现在人人都在传你的传奇故事！车行大门永远向你敞开！”', [{ label: '干杯，罗曼！', action: closeDialog }]);
    }
  } else if (id === 'viktor') {
    const opts = [];
    if (story.stage === 1) {
      opts.push({ label: '罗曼派我来查“铁锤”黑账（推进主线）', action: () => {
        story.stage = 2; sndPickup();
        setDialog('“‘铁锤’不过是个收债的白手套，他的流水账都锁在东区【托尼(T)】修车工具箱后头，据说账本背面还关联到东北方霓虹科技湾失窃的神经芯片。去拿账本吧，当心盯梢！”', [
          { label: '明白，前往东区找托尼', action: closeDialog },
        ]);
      }});
    }
    if (story.stage === 7) {
      opts.push({ label: '【终局选择 · 地下教父】把“黑曜石”加密芯片交由维克多接管航线（+$2200）', action: () => {
        story.stage = 8; story.ending = 'syndicate'; story.soldToElena = true;
        player.money += 2200; player.ammos[4] += 90; player.ammos[5] += 15;
        sndEnlighten();
        setDialog('“漂亮！有了这份港口清关密钥，从明天起布洛克到阿尔冈琴所有地下航线全归我们掌控！以后你在城里需要弹药，我永远给你留最顶级的突击步枪与 AWP 补给！”', [
          { label: '自由城的暗夜，从此改姓', action: closeDialog },
        ]);
      }});
    }
    opts.push({ label: '花 $120 补满护甲与全六类武器弹药（含步枪/狙击）', action: () => {
      if (player.money < 120) { showMsg('金钱不足（需 $120）', 2); closeDialog(); return; }
      player.money -= 120; player.armor = player.maxArmor;
      player.ammos[1] += 68; player.ammos[2] += 128; player.ammos[3] += 24; player.ammos[4] += 90; player.ammos[5] += 15;
      sndPickup(); showMsg('全套黑市军火已备齐！', 2); closeDialog();
    }});
    opts.push({ label: '打听自由城三大势力的底细', action: () => {
      setDialog('“中城区讲究体面与资本，霓虹科技湾的白博士天天折腾意识芯片，翡翠港湾则藏着整个城市的命门。你只要手里攥着真筹码，各方都得敬你三分。”', [
        { label: '受教了，老维克多', action: closeDialog },
      ]);
    }});
    opts.push({ label: '告辞', action: closeDialog });
    setDialog('“自由城的水深得看不见底。要打听黑市情报，还是挑几箱真家伙上路？”', opts);
  } else if (id === 'tony') {
    const opts = [];
    if (story.stage === 2) {
      opts.push({ label: '罗曼和维克多让我来取工具箱后的黑账！', action: () => {
        story.stage = 3;
        spawnStoryAmbush(npc.x, npc.z);
        setDialog('“坏了，兄弟！‘铁锤’亲自带着人堵门了！账本你拿好，咱俩先迎战解决那三个杂碎！”', [
          { label: '拔枪迎敌！', action: closeDialog },
        ]);
      }});
    }
    opts.push({ label: '花 $90 修理附近车辆 + 涡轮与氮气极限调校', action: () => {
      const near = cars.find(c => !c.wreck && dist2(c.x, c.z, player.x, player.z) < 16 * 16);
      if (!near) { showMsg('附近 16 米内没有可改装的车辆', 2); closeDialog(); return; }
      if (player.money < 90) { showMsg('金钱不足（需 $90）', 2); closeDialog(); return; }
      player.money -= 90; near.hp = near.maxHp; near.nitro = 100;
      near.maxSpeed = Math.min(76, near.maxSpeed + 7); near.accel = Math.min(40, near.accel + 5);
      sndPickup(); showMsg('🔧 车辆已满血修复并升级了竞赛级涡轮与满槽氮气！', 2.5); closeDialog();
    }});
    opts.push({ label: '聊聊改车秘诀', action: () => {
      setDialog('“驾驶超跑的时候按住 Shift 激活双涡轮氮气，配合空格手刹切入弯心——这才是自由城夜间飙车的极乐体验！”', [
        { label: '改天带你兜两圈！', action: closeDialog },
      ]);
    }});
    setDialog(story.stage === 2 ? '“嘘……别声张，账本就在气动扳手盒后边——等下，街角怎么来了几辆黑车？”' : '“欢迎来到东区街头改装厂！撞瘪了还是想压榨更大马力？”', opts);
  } else if (id === 'chen') {
    const opts = [];
    if (story.stage === 5) {
      opts.push({ label: '陈船长，我在追查“黑曜石”号上的违禁军火与芯片（触发码头Boss战）', action: () => {
        story.stage = 6;
        spawnHarborBoss();
        setDialog('“那帮雇佣兵此刻就在前方集装箱龙门吊下拆封货柜，领头的叫‘黑曜石’克劳斯，火力极猛！我替你把海港警卫引开，快用步枪或狙击枪清场！”', [
          { label: '收到，前往龙门吊集装箱区！', action: closeDialog },
        ]);
      }});
    }
    opts.push({ label: '免费领取一份码头应急补给（如弹药紧缺时可用）', action: () => {
      player.ammos[1] += 34; player.ammos[4] += 30; player.ammos[5] += 5;
      sndPickup(); showMsg('⚓ 码头水手赠与你步枪与狙击应急弹匣', 2.2); closeDialog();
    }});
    opts.push({ label: '聊聊翡翠港湾的海风与老船', action: () => {
      setDialog('“你在码头旁看见的那座灯塔和龙门吊，见证了自由城五十年兴衰。无论岸上的霓虹摩天楼多高，粮食、能源与秘密最后总要靠海运进出。”', [{ label: '海风确实让人清醒', action: closeDialog }]);
    }});
    setDialog(story.stage === 5 ? '“海风里混着硝烟味……年轻人，你手里拿的账本，上面印的是那艘停泊在东码头的黑曜石货轮标记！”' : '“潮水涨得正猛，栈桥尽头还停着救援直升机，需要出海观光随时找我。”', opts);
  } else if (id === 'elena') {
    const opts = [];
    if (story.stage === 7) {
      opts.push({ label: '【终局选择 · 黎明头版】把“黑曜石”全套洗钱与军火证据刊登头版（+$1500）', action: () => {
        story.stage = 8; story.ending = 'truth'; story.soldToElena = true;
        player.money += 1500; player.armor = player.maxArmor; sndEnlighten();
        setDialog('“难以置信……这不仅能送克劳斯的后台入狱，还能逼市政厅彻底清算海港黑幕！明天早报将铭记你的勇气，以后你随时可来我这儿免费医疗整备！”', [
          { label: '让真相彻照这座城市', action: closeDialog },
        ]);
      }});
    } else if (story.stage >= 4 && !story.soldToElena) {
      opts.push({ label: '把“铁锤”早期黑账副本卖给她作预热稿（+$500）', action: () => {
        story.soldToElena = true; player.money += 500; sndPickup();
        setDialog('“太精彩了！这组高利贷流水正好做连载第一期！若你以后能搞到港口大鱼‘黑曜石’的核心账密，记得优先考虑报社！”', [
          { label: '合作愉快', action: closeDialog },
        ]);
      }});
    }
    if (!story.freeHealUsed || story.ending === 'truth') {
      opts.push({ label: '包扎治疗（免费回满生命值）', action: () => {
        story.freeHealUsed = true; player.hp = player.maxHp; sndPickup();
        showMsg('❤️ 艾琳帮你处理好伤口，生命已回满', 2); closeDialog();
      }});
    } else {
      opts.push({ label: '花 $50 购买战地急救包（回满生命）', action: () => {
        if (player.money < 50) { showMsg('金钱不足（需 $50）', 2); closeDialog(); return; }
        player.money -= 50; player.hp = player.maxHp; sndPickup(); showMsg('❤️ 生命值已回满', 2); closeDialog();
      }});
    }
    opts.push({ label: '聊聊东方明珠塔畔的新闻追踪', action: () => {
      setDialog('“我注意到紫红玻璃穹顶的东方明珠夜里信号异常活跃——财团与港口的暗线比我们想的还要深。保重，朋友！”', [{ label: '多保重，艾琳', action: closeDialog }]);
    }});
    setDialog('“我是《自由城时报》记者艾琳。新闻自由和真相，总需要有人冒着枪林弹雨守住。”', opts);
  } else if (id === 'bai') {
    const opts = [];
    if (story.stage === 7) {
      opts.push({ label: '【终局选择 · 霓虹飞升】将加密芯片交给白博士修复开源神经协议（+$1200 + 上限突破 + 定制超跑）', action: () => {
        story.stage = 8; story.ending = 'ascend'; story.baiDiscount = true;
        player.money += 1200; player.maxHp = 130; player.hp = 130; player.stamina = 100;
        spawnCar(npc.x - 10, npc.z + 8, Math.PI, { kind: 'hyper', color: '#00e5ff', driver: null });
        sndEnlighten();
        setDialog('“你竟然把被劫走的‘苍穹’芯片完好带回来了！神经阻尼与体能阈值已全部为你解锁（生命上限+30，手机呼叫半价，门外为你备好了极光涂装超跑）！”', [
          { label: '科技与自由同在！', action: closeDialog },
        ]);
      }});
    }
    opts.push({ label: '花 $140 进行体外神经纳米恢复（回满血甲体力）', action: () => {
      if (player.money < 140) { showMsg('金钱不足（需 $140）', 2); closeDialog(); return; }
      player.money -= 140; player.hp = player.maxHp; player.armor = player.maxArmor; player.stamina = 100;
      sndPickup(); showMsg('🧬 纳米修复完成，全状态满格！', 2.2); closeDialog();
    }});
    opts.push({ label: '探讨城市全息幕墙与意识边界', action: () => {
      setDialog('“当东方明珠和摩天大楼把夜空映成流光溢彩时，我在想——究竟是算法统治人，还是清醒的心智在定义算法？或许你该去听听那六位街头哲学家的观点。”', [{ label: '很深邃的问题，白博士', action: closeDialog }]);
    }});
    setDialog('“你好，我是霓虹科技湾实验室的白博士。这片区聚集着全城最先锋的光学幕墙与仿生技术。”', opts);
  }
}

function updateStory(dt) {
  const P = playerAnchor();
  const tgtId = storyTargetId();
  for (const n of storyNpcs) {
    const isTgt = (gameMode === 'free' && (n.id === tgtId || (story.stage === 7 && (n.id === 'elena' || n.id === 'viktor' || n.id === 'bai'))));
    n.haloMat.color.set(isTgt ? '#ffd400' : '#38d9ff');
    n.halo.rotation.z += dt * (isTgt ? 4 : 2);
    n.halo.position.y = 2.22 + Math.sin(gameTime * 3.5) * 0.07;
    n.halo.scale.setScalar(isTgt ? 1.15 + Math.sin(gameTime * 6) * 0.1 : 0.9);
    const d2 = dist2(n.x, n.z, P.x, P.z);
    if (d2 < 12 * 12) {
      const targetH = Math.atan2(P.x - n.x, P.z - n.z);
      n.h += angDiff(n.h, targetH) * Math.min(1, dt * 6);
      n.hm.g.rotation.y = n.h;
    }
    if (dialog.open && dialog.npc === n) animHuman(n.hm, gameTime * 5, 0.35);
    else animHuman(n.hm, 0, 0);
  }
  for (let i = story.enemies.length - 1; i >= 0; i--) {
    const e = story.enemies[i];
    if (e.dead) {
      e.deadT += dt;
      e.fall = Math.min(1, e.fall + dt * 3);
      e.x += e.vx * dt; e.z += e.vz * dt;
      const k = Math.exp(-dt * 4); e.vx *= k; e.vz *= k;
      collideCircle(e, 0.4);
      e.hm.g.position.set(e.x, groundH(e.x, e.z) + 0.17 * e.fall, e.z);
      e.hm.g.rotation.set(-Math.PI / 2 * e.fall, e.h, 0, 'YXZ');
      animHuman(e.hm, 0, 0);
      if (e.deadT > 18) { scene.remove(e.hm.g); story.enemies.splice(i, 1); }
      continue;
    }
    e.halo.rotation.z += dt * 3.5;
    for (const c of cars) {
      if (dist2(c.x, c.z, e.x, e.z) > 16) continue;
      const [qx, qz] = closestOnCar(c, e.x, e.z);
      if (dist2(qx, qz, e.x, e.z) < 1.3 * 1.3 && Math.abs(c.speed) > 5) {
        damageStoryEnemy(e, Math.abs(c.speed) * 4, c.vx * 0.5, c.vz * 0.5);
      }
    }
    if (e.dead || player.dead) continue;
    const dx = P.x - e.x, dz = P.z - e.z, dd = Math.hypot(dx, dz) + 1e-4;
    e.h = Math.atan2(dx, dz);
    let moved = false;
    if (dd > 14) {
      e.x += dx / dd * e.speed * dt; e.z += dz / dd * e.speed * dt;
      collideCircle(e, 0.45); moved = true;
    }
    e.phase += dt * e.speed * 2.2;
    animHuman(e.hm, e.phase, moved ? 0.9 : 0);
    e.hm.armR.rotation.x = -Math.PI / 2;
    e.hm.g.position.set(e.x, groundH(e.x, e.z), e.z);
    e.hm.g.rotation.y = e.h;
    if (dd < 36) {
      e.shootT -= dt;
      if (e.shootT <= 0) {
        e.shootT = rand(0.75, 1.4);
        e.hm.g.updateMatrixWorld();
        const mz = e.hm.armR.localToWorld(new THREE.Vector3(0, -0.8, 0));
        npcShoot(mz.x, mz.y, mz.z);
      }
    }
  }
}

/* ============================ 哲学家系统 (3段式深度辩难 + 永久被动 + 手记) 与【神临 · 上帝之死】 ============================ */
const philo = { met: new Set(), total: 6, list: [], notes: new Map() };
const sageHaloGeo = new THREE.TorusGeometry(0.42, 0.045, 8, 22);
const PHILOSOPHER_DEFS = [
  {
    id: 'aristotle',
    name: '亚里士多德',
    role: '吕克昂学园 · 漫步学派创始人',
    mark: '【实证与中道】',
    buffKey: 'platoInsight',
    buffShort: '📜 中道 +30%任务奖',
    codexNote: '美德不在极端的放纵或禁欲之中，而在理性审慎的中道习惯里；形式寓于具体世界，行动即实证。',
    gesture: 'peripatetic',
    x: blockMin(MID) + 4.5,
    z: blockMin(MID - 1) + BLOCK - 3.5,
    cfg: { robe: '#efe6cf', trim: '#d4af37', sash: '#b8860b', hair: '#5a4030', beard: 'full', laurel: true, robeSkirt: true, shoe: '#7a5230', prop: 'scroll' },
    s1: {
      text: '“吾爱吾师，吾更爱真理。柏拉图仰望天界的理念，但我指向大地——秩序就在眼前的砖石、车轮与人的抉择里。穿梭这座喧嚣都市，你认为美德究竟从何而来？”',
      choices: [
        { label: '勇气与自由都不应走向鲁莽或怯懦，节制中道才是常态', reply: '“善哉！过犹不及——勇气正是怯懦与鲁莽之间的黄金中道。但这中道从不是呆板的折中，而是因时制宜的实践智慧。”' },
        { label: '脱离实践的空谈只是幻影，真理必须在双手与双眼里被验证', reply: '“正是如此！形式寓于质料，秩序就镶嵌在这座城市的血脉中，而不必逃到云层之上另造一个天国。”' },
      ],
    },
    s2: {
      text: '“既然知晓了中道与实证，那么面对滚滚而来的金钱、枪火与权力，你会让灵魂追逐哪一种终极目的（Eudaimonia）？”',
      choices: [
        { label: '金钱与载具只是工具，清醒践行美德的活动本身即是幸福', reply: '“深刻！把工具误认作目的，正是俗世烦恼的根源。当你掌握方向盘与判断力，幸福便是卓越心灵的充沛运作。”' },
        { label: '先经受混乱试炼，再用冷静经验雕琢可信赖的规则与技艺', reply: '“老练而务实！美德就像造琴或驾车——不是靠祈祷天降，而是靠一次次准确抉择养成的第二天性。”' },
      ],
    },
    s3Text: '“你已将实践理性融入行止，今后无论街头差事还是风浪抉择，都能稳住重心、识破虚妄。”',
    afterText: '“你已将实证的理性刻入骨血，不再奢望虚无的庇护——这便是哲学成熟的第一步。”',
  },
  {
    id: 'socrates',
    name: '苏格拉底',
    role: '雅典牛虻 · 助产士法辩士',
    mark: '【自知无知】',
    buffKey: 'humeHeat',
    buffShort: '🦉 思辨 -40%通缉热',
    codexNote: '未经审视的人生不值得过；真正的智慧始于承认自己尚且无知，并在追问中照见成见的漏洞。',
    gesture: 'socratic',
    x: blockMin(MID - 1) + 4.5,
    z: blockMin(MID - 1) + BLOCK - 4.0,
    cfg: { robe: '#d8d5cc', trim: '#b4afa3', hair: '#d8d8d8', beard: 'long', beardCol: '#e4e4e4', robeSkirt: true, shoe: '#6b4f3a', prop: 'cup' },
    s1: {
      text: '“未经审视的人生不值得过。这座城人人都以为自己通晓金钱、正义与生死。年轻人，我只反问你一句：当警笛骤响，你当真懂得什么是‘正义’吗？”',
      choices: [
        { label: '正义也许随强者利益和法律条文不断流变，我尚无定论', reply: '“哈哈！承认自己尚未掌握定论，可比满口空洞定义诚实得多！德尔斐神谕称我最明智，只因我清楚自己一无所知。”' },
        { label: '我不敢自称全知，只想通过不断追问把虚假成见剥干净', reply: '“好一根清醒的牛虻！我的‘助产术’不能替你生出真理，却能戳破虚胖的假说。”' },
      ],
    },
    s2: {
      text: '“那么再来第二问：倘若全城舆论、强权乃至天上的神谕都一致声称一桩错事为真，你愿随大流求生，还是愿像饮鸩般守住灵魂的整全？”',
      choices: [
        { label: '不受质疑的盲从才是真正的死去，我宁可清醒追问到底', reply: '“多么清亮的话语！当恐惧与盲信失去对你的支配，就连世间最嚣张的秩序也留不住你的真我。”' },
        { label: '我会拆穿它逻辑里的矛盾，让虚张声势者不攻自破', reply: '“犀利！真正无法动摇的不是傲慢，而是随时准备好接受反驳却依然站立的理性。”' },
      ],
    },
    s3Text: '“收下这枚自知无知之印：在混乱与追捕面前保持冷静头脑，纷争自然会比寻常人更快退潮。”',
    afterText: '“原来你心中的‘神’，竟经不住你自己这一番苏格拉底式的反诘——多么畅快的觉醒！”',
  },
  {
    id: 'zhuangzi',
    name: '庄子',
    role: '南华真人 · 齐物逍遥游',
    mark: '【齐物逍遥】',
    buffKey: 'spinozaSpeed',
    buffShort: '🦋 逍遥 +14%移速/双倍体能',
    codexNote: '天地与我并生，而万物与我为一；卸下功利与恐惧的桎梏，心游物外方得大逍遥。',
    gesture: 'butterfly',
    x: blockMin(MID) + 12.0,
    z: blockMin(MID + 1) + 12.0,
    cfg: { robe: '#2b7a78', trim: '#8fd3c8', sash: '#e6c86e', hair: '#2a2a2e', bun: true, beard: 'long', robeSkirt: true, wideSleeve: true, shoe: '#2b2b2b', prop: 'butterflies' },
    s1: {
      text: '“昔者庄周梦为胡蝶，栩栩然胡蝶也；俄然觉，则蘧蘧然周也。楼宇万仞、车流滚滚，你看这金蝶掠过枝头——若一切皆在流转，人又何必苦苦画地为牢？”',
      choices: [
        { label: '若能放下狭隘分别心，山海与自身本无边界之分', reply: '“至矣！以道观之，物无贵贱；高悬云端的摩天塔与巷口野草，同沐一轮风月。”' },
        { label: '无论身在梦中还是醒时，重要的是心不被外物牵着走', reply: '“妙极！不以物喜，不以物役，外物滚滚而过，心境却自澄澈。”' },
      ],
    },
    s2: {
      text: '“再问你一桩：若前方有千丈深渊或高空长风，大鹏水击三千里而扶摇直上，你奔跑穿行于红尘之间，靠的是蛮力还是乘御天地之气？”',
      choices: [
        { label: '顺势而动、无所滞碍，步履与呼吸自然轻快如风', reply: '“善！乘天地之正，而御六气之辩——当你不再与沉重的执念较劲，天地便是你的翼。”' },
        { label: '既可直上云霄跳伞俯瞰全城，亦可微服市井听潮汐拍岸', reply: '“哈哈！巨鹏可上九万里，游鱼自乐于濠梁，这才是齐物而逍遥！”' },
      ],
    },
    s3Text: '“轻风绕踵而生：自此你奔走腾挪愈发轻盈（移速提升、体能回复翻倍），万物莫能羁绊。”',
    afterText: '“蝴蝶未尝飞走，神光亦未尝真来——大梦既觉，天地与你并生，而万物与你为一。”',
  },
  {
    id: 'descartes',
    name: '笛卡尔',
    role: '理性主义先驱 · 沉思者',
    mark: '【理性基石】',
    buffKey: 'descartesHead',
    buffShort: '💎 我思 +30%爆头伤害',
    codexNote: '普遍怀疑之后唯一不可动摇的阿基米德支点是“我思故我在”；清晰分明之观念指引精确裁决。',
    gesture: 'cogito',
    x: blockMin(MID - 1) + 12.0,
    z: blockMin(MID) + 4.0,
    cfg: { robe: '#1d2d44', trim: '#3e5c76', coatTail: true, pants: '#171d26', hair: '#2c1e16', longHair: true, beard: 'goatee', shoe: '#18181b', prop: 'crystal' },
    s1: {
      text: '“试着彻底怀疑眼前的霓虹、大厦，乃至感官传递给你的一切光影。假设有个全能骗子在欺骗你，究竟什么是哪怕在恶魔欺妄下也绝对确凿的基点？”',
      choices: [
        { label: '无论如何被欺骗，正在怀疑与思考着的“我”无可置疑（我思故我在）', reply: '“精确如几何证明！这就是寻找整个世界秩序的阿基米德支点——只要我在思考，存在便牢不可破。”' },
        { label: '只要把复杂世界拆解成最清晰分明的几何直线，真理便无处遁形', reply: '“好一条解析方法论！剥离混沌表象后，万物尽是清晰的坐标与因果。”' },
      ],
    },
    s2: {
      text: '“既然确立了清晰与分明的理性为准绳，在混乱交锋与瞬息万变的街道里，你如何从纷繁假象中直指要害？”',
      choices: [
        { label: '目光如镜，锁定最核心的一点一击定音，绝不被杂音动摇', reply: '“干脆利落！当心智剔除了犹豫与模糊，准星与思想便在同一个维度重叠。”' },
        { label: '不再祈求虚妄奇迹庇护，而用明晰理智自我论证与行动', reply: '“没错！昔日靠外部神意担保的确定性，今朝尽归清醒的心智本身。”' },
      ],
    },
    s3Text: '“清晰观念已凝为棱镜：你的洞察与精准裁决力大增（爆头伤害 +30%），穿透一切迷雾。”',
    afterText: '“看啊，当理性达到极致，连天上的幻影也不得不向‘我思’折射出它虚幻的本质。”',
  },
  {
    id: 'kant',
    name: '康德',
    role: '哥尼斯堡哲人 · 批判与道德律',
    mark: '【星空与律令】',
    buffKey: 'kantArmor',
    buffShort: '⭐ 律令 护甲上限提至140',
    codexNote: '头顶的灿烂星空与心中的道德法则令人敬畏；人是目的而非工具，人为自己的理性立法。',
    gesture: 'starry',
    x: blockMin(MID + 1) + 4.0,
    z: blockMin(MID - 1) + 14.0,
    cfg: { robe: '#5c2432', trim: '#9c4c5e', coatTail: true, pants: '#2a2228', wig: true, skin: '#f1d4b8', shoe: '#1a1618', prop: 'watch' },
    s1: {
      text: '“有两样东西，我愈是持久而深入地思索，就愈令心灵充满常新而增进的敬畏——头顶的灿烂星空，与心中的道德律！你认为，人之所以可贵，依据是什么？”',
      choices: [
        { label: '人永远是目的本身，绝不可沦为任何神权、暴利或他人的工具', reply: '“壮哉！这句话应当镌刻在自由城每一座灯塔之上——唯有尊严没有等价交换物。”' },
        { label: '世界现象的规律本由先天理性统摄，人心原是自然的立法者', reply: '“多么精彩的‘哥白尼式革命’！规律不是来自顺从外物，而是出自理性的统合。”' },
      ],
    },
    s2: {
      text: '“那么试想：如果没有天堂的赏赐，也没有地狱的惩罚，在这无神监护的自由夜色里，你还会遵守对人对己的法则吗？”',
      choices: [
        { label: '正因没有外部鞭笞与贿赂，出自自由意志的自律才最崇高', reply: '“精彩极了！定言令式的光辉正在于无条件——不为利益，只因它配得上作为理性存在的你。”' },
        { label: '秩序不在遥远神坛，而在我每次不肯退让的底线与骨气里', reply: '“坚定如钟表匠的心律！有此内在护盾，何惧外城风雷！”' },
      ],
    },
    s3Text: '“理性尊严为你铸就无形坚甲：护甲上限跃升至 140 并即刻充盈，足以直面暴风骤雨。”',
    afterText: '“你心中那片星空已比任何神坛更为辽阔——敬畏不再朝向云端，而朝向清醒的人格。”',
  },
  {
    id: 'nietzsche',
    name: '尼采',
    role: '查拉图斯特拉代言人 · 重估一切价值',
    mark: '【超人与破晓】',
    buffKey: 'nietzscheDmg',
    buffShort: '🔨 巨锤 全伤害 +20%',
    codexNote: '上帝已死！与其向虚无祈祷救赎，不如以创造性的强力意志赋予大地以意义，自我超越。',
    gesture: 'hammer',
    x: blockMin(MID - 2) + BLOCK - 8.0,
    z: blockMin(MID) + 8.0,
    cfg: { robe: '#1f2026', trim: '#383a44', coatTail: true, pants: '#141519', hair: '#4a3525', beard: 'mustache', beardCol: '#4a3525', skin: '#e8c4a0', shoe: '#121215', prop: 'hammer' },
    s1: {
      text: '“听见远方的巨响了吗？人们习惯把畏惧和软弱供奉上云端，呼唤一位救世主；却不肯正视那声宣言——‘上帝已死！’当偶像倒塌，难道你要陷入虚无主义的灰烬？”',
      choices: [
        { label: '偶像破碎不是末日，而是人类夺回创造意义权柄的黎明！', reply: '“哈哈！好狂暴而明朗的笑声！唯有穿过旧神墓地的人，才懂得大地才是意义唯一的热土！”' },
        { label: '连“上帝”本身，也不过是人思想炽热到极点时向外投射的虚影', reply: '“震耳欲聋的直觉！当你连投射者自身都看穿，那场海市蜃楼就已注定崩毁！”' },
      ],
    },
    s2: {
      text: '“再听一问，查拉图斯特拉的同行者：假如你的人生与每一次抉择、痛苦、欢笑都将如永恒轮回般无限重演，你依然会骄傲地喊出‘就是这样，我意愿它再来一遍’吗？”',
      choices: [
        { label: '是的！我将毫无保留地肯定当下每一瞬间，活成重估价值的超人', reply: '“这便是最高的肯定（Amor Fati）——热爱命运本身！你的脊梁已铸入雷霆！”' },
        { label: '我用这柄哲学之锤砸碎陈腐枷锁，把怯懦留给昨天！', reply: '“挥锤吧！旧碑既碎，整片新天新地都在你足下呼啸！”' },
      ],
    },
    s3Text: '“哲学巨锤注力于你臂膀：全武器与近战威力永恒提升 +20%，集齐六贤即赴市中心迎候神临！”',
    afterText: '“看看你自己吧！神像已碎成星屑归于你的胸膛，你已跨越深渊，达到了哲学上的出神入化。”',
  },
];

function applyPhiloBuff(def) {
  if (!def || !def.buffKey) return;
  player.buffs[def.buffKey] = true;
  if (def.buffKey === 'kantArmor') {
    player.maxArmor = 140;
    player.armor = Math.min(player.maxArmor, player.armor + 40);
  }
  philo.notes.set(def.id, { name: def.name, mark: def.mark, buff: def.buffShort, note: def.codexNote });
}

function initPhilosophers() {
  for (const def of PHILOSOPHER_DEFS) {
    const pt = { x: def.x, z: def.z };
    collideCircle(pt, 0.55);
    const sm = makeSageHuman(def.cfg);
    const sageParts = [...sm.g.children];
    const laughGroup = new THREE.Group();
    laughGroup.visible = false;
    sm.g.add(laughGroup);
    if (laughNaiwaParts) populateLaughGroup(laughGroup, laughNaiwaParts);

    const haloMat = new THREE.MeshBasicMaterial({ color: '#c084fc', side: THREE.DoubleSide });
    const halo = new THREE.Mesh(sageHaloGeo, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 2.26;
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 6, 18), new THREE.MeshBasicMaterial({ color: '#ffd400' }));
    halo.add(innerRing);
    sm.g.add(halo);
    sm.g.position.set(pt.x, groundH(pt.x, pt.z), pt.z);
    const h = Math.atan2(-pt.x, -pt.z);
    sm.g.rotation.y = h;
    philo.list.push({ ...def, x: pt.x, z: pt.z, h, sm, sageParts, laughGroup, laughT: 0, halo, haloMat, phase: Math.random() * 10 });
  }
}

function triggerPhiloLaugh(ph) {
  if (!ph || player.dead || inVehicle() || godActive()) return;
  ph.laughT = 3.4;
  player.laughT = 3.4;
  ph.h = Math.atan2(player.x - ph.x, player.z - ph.z);
  ph.sm.g.rotation.y = ph.h;
  player.h = yaw = Math.atan2(ph.x - player.x, ph.z - player.z);
  const py = groundH(player.x, player.z) + player.y;
  const sy = groundH(ph.x, ph.z);
  spawnCyanSmoke(ph.x, sy + 0.9, ph.z, 3.2, true);
  spawnCyanSmoke(player.x, py + 0.9, player.z, 3.2, true);
  spawnCyanSmoke((ph.x + player.x) * 0.5, (sy + py) * 0.5 + 0.7, (ph.z + player.z) * 0.5, 3.4, true);
  sndSmokePoof();
  sndLaugh();
  showMsg(`💨 柔青瑞霭缭绕升起，你与${ph.name}相视会心捧腹！`, 3.0);
}

function updatePhilosophers(dt) {
  const P = playerAnchor();
  for (const ph of philo.list) {
    const met = philo.met.has(ph.id);
    ph.haloMat.color.set(met ? '#ffd400' : '#c084fc');
    ph.halo.rotation.z += dt * (met ? 1.5 : 3.2);
    ph.halo.position.y = 2.26 + Math.sin(gameTime * 3.0 + ph.phase) * 0.06;
    ph.halo.scale.setScalar(met ? 0.85 : 1.05 + Math.sin(gameTime * 4.5 + ph.phase) * 0.08);
    if (ph.laughT > 0) {
      ph.laughT = Math.max(0, ph.laughT - dt);
      const targetH = Math.atan2(P.x - ph.x, P.z - ph.z);
      ph.h += angDiff(ph.h, targetH) * Math.min(1, dt * 6);
      ph.sm.g.rotation.y = ph.h;
      const inE = clamp((3.4 - ph.laughT) / 0.35, 0, 1);
      const outE = clamp(ph.laughT / 0.45, 0, 1);
      const env = (inE * inE * (3 - 2 * inE)) * (outE * outE * (3 - 2 * outE));
      if (ph.laughGroup.children.length > 0) {
        for (const sp of ph.sageParts) sp.visible = false;
        ph.laughGroup.visible = true;
        const lt = gameTime + ph.phase;
        const sq = Math.sin(lt * 7.2) * 0.018 * env;
        ph.laughGroup.rotation.x = (-0.14 + Math.sin(lt * 7.2) * 0.075) * env;
        ph.laughGroup.rotation.z = Math.sin(lt * 3.6) * 0.05 * env;
        ph.laughGroup.position.y = (0.5 - 0.5 * Math.cos(lt * 7.2)) * 0.045 * env;
        ph.laughGroup.scale.set(1 + sq, 1 - sq * 1.1, 1 + sq);
      } else {
        ph.sm.torsoPivot.rotation.x = (0.28 + Math.sin((gameTime + ph.phase) * 7.2) * 0.09) * env;
        ph.sm.headPivot.rotation.x = (-0.18 + Math.sin((gameTime + ph.phase) * 7.2) * 0.09) * env;
      }
      if (ph.laughT === 0) {
        ph.laughGroup.visible = false;
        ph.laughGroup.rotation.set(0, 0, 0); ph.laughGroup.position.y = 0; ph.laughGroup.scale.set(1, 1, 1);
        for (const sp of ph.sageParts) sp.visible = true;
        spawnCyanSmoke(ph.x, groundH(ph.x, ph.z) + 1.0, ph.z, 1.4, false);
      }
      continue;
    }
    const d2 = dist2(ph.x, ph.z, P.x, P.z);
    if (d2 > 42 * 42) continue;
    if (d2 < 11 * 11) {
      const targetH = Math.atan2(P.x - ph.x, P.z - ph.z);
      ph.h += angDiff(ph.h, targetH) * Math.min(1, dt * 5);
      ph.sm.g.rotation.y = ph.h;
    }
    const talking = dialog.open && dialog.npc === ph;
    animPhilosopher(ph, gameTime + ph.phase, talking);
  }
}

function openPhilosopherDialog(ph) {
  dialog.open = true; dialog.npc = ph; dialog.isSage = true; dialog.isGod = false; dialog.philoCompleted = false;
  phoneOpen = false; codexOpen = false; mouseL = mouseR = false;
  playTone(580, 0.06, 0.08, 'sine');

  const stage3Finish = reply2 => {
    dialog.philoCompleted = true;
    const isNew = !philo.met.has(ph.id);
    applyPhiloBuff(ph);
    if (isNew) {
      philo.met.add(ph.id);
      player.money += 180;
      sndEnlighten();
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(1.5, 4.5);
        emit(ph.x, groundH(ph.x, ph.z) + 1.4, ph.z, Math.cos(a) * sp, rand(1.5, 5.0), Math.sin(a) * sp, i % 2 ? '#ffd400' : '#c084fc', 0.09, 0.85, -3);
      }
      setDialog(`${reply2}\n\n✦ 领悟【${ph.mark}】${ph.s3Text}\n🎁 获得永久加护：${ph.buffShort}（+$180 · 进度 ${philo.met.size}/${philo.total}，按 J 可随时重读哲学手记）`, [
        {
          label: philo.met.size >= philo.total ? '六贤哲思已圆融，迎接【神临】（前往市中心金色光柱）' : '铭记此道，继续寻访诸贤',
          action: () => {
            closeDialog();
            if (philo.met.size >= philo.total && god.stage === 'locked') unlockTheophany();
          },
        },
      ], 'sage');
    } else {
      setDialog(`${reply2}\n\n✦ 永久加护持续生效：${ph.buffShort}`, [{ label: '受教了，后会有期', action: closeDialog }], 'sage');
    }
  };

  const startDialectic = () => {
    setDialog(ph.s1.text, ph.s1.choices.map(c1 => ({
      label: c1.label,
      action: () => {
        setDialog(`${c1.reply}\n\n${ph.s2.text}`, ph.s2.choices.map(c2 => ({
          label: c2.label,
          action: () => stage3Finish(c2.reply),
        })), 'sage');
      },
    })), 'sage');
  };

  if (god.stage === 'transcended') {
    setDialog(`${ph.afterText}\n\n（按 J 可随时打开自由城哲学与主线手记）`, [
      { label: `重温与${ph.name}的三重哲思辩难`, action: startDialectic },
      { label: '点头致意，告别离去', action: () => { dialog.philoCompleted = true; closeDialog(); } },
    ], 'sage');
    return;
  }

  startDialectic();
}

const GOD_POS = { x: 0, z: 0 };
const god = {
  stage: 'locked', // 'locked' | 'ready' | 'descending' | 'enlightening' | 'shattering' | 'transcended'
  t: 0,
  skyBlend: 0,
  flashA: 0,
  rewarded: false,
  beacon: null,
  pillarMat: null,
  ringGround: null,
  figure: null,
  modelRoot: null,
  mandala: null,
  baseRing: null,
  rings: [],
  light: null,
  fillLight: null,
  shardsMesh: null,
  shards: [],
};
const godActive = () => god.stage === 'descending' || god.stage === 'enlightening' || god.stage === 'shattering';

function mountGodNaiwaModel(parts, mats) {
  if (!god.modelRoot || !parts) return;
  while (god.modelRoot.children.length) god.modelRoot.remove(god.modelRoot.children[0]);
  for (const { partId, geo } of parts) {
    const m = new THREE.Mesh(geo, mats[partId] || mats[0]);
    m.castShadow = false;
    m.receiveShadow = false;
    god.modelRoot.add(m);
  }
}

function initGodRig() {
  // 1. 市中心神临信标光柱
  const beacon = new THREE.Group();
  beacon.position.set(GOD_POS.x, 0.06, GOD_POS.z);
  const pillarMat = new THREE.MeshBasicMaterial({
    color: '#ffe38a', transparent: true, opacity: 0.24,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 5.0, 210, 16, 1, true), pillarMat);
  pillar.position.y = 105;
  beacon.add(pillar);
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#ffd447', transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const r1 = new THREE.Mesh(new THREE.RingGeometry(6.8, 7.8, 36), ringMat);
  r1.rotation.x = -Math.PI / 2; r1.position.y = 0.04;
  const r2 = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.6, 36), ringMat);
  r2.rotation.x = -Math.PI / 2; r2.position.y = 0.05;
  beacon.add(r1, r2);
  beacon.visible = false;
  scene.add(beacon);
  god.beacon = beacon; god.pillarMat = pillarMat; god.ringGround = beacon;

  // 2. 22 米超巨神临奶娃 + 十二道金光背轮 + 三重天球星环 + 莲华底座光阵
  const fig = new THREE.Group();
  fig.position.set(GOD_POS.x, 84, GOD_POS.z);
  fig.visible = false;
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffd944', emissive: '#ffae20', emissiveIntensity: 0.55, roughness: 0.24, metalness: 0.32 });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#ffd447', emissive: '#ffb82e', emissiveIntensity: 1.45, roughness: 0.16, metalness: 0.86 });
  const rayMat = new THREE.MeshBasicMaterial({ color: '#ffe885', transparent: true, opacity: 0.82 });

  const modelRoot = new THREE.Group();
  const fbBody = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 5.2, 16, 12), bodyMat);
  fbBody.position.y = 8.0;
  const fbHead = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), bodyMat);
  fbHead.position.y = 18.2;
  modelRoot.add(fbBody, fbHead);
  fig.add(modelRoot);
  god.modelRoot = modelRoot;

  // 脑后十二道神光曼荼罗背环
  const mandala = new THREE.Group();
  mandala.position.set(0, 20.6, -2.2);
  const outerHalo = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.20, 8, 40), goldMat);
  const innerHalo = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.11, 8, 32), goldMat);
  const glowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(7.5, 32),
    new THREE.MeshBasicMaterial({ color: '#ffdf78', transparent: true, opacity: 0.20, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  mandala.add(outerHalo, innerHalo, glowDisc);
  const rayGeo = new THREE.BoxGeometry(0.18, 4.4, 0.08);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const ray = new THREE.Mesh(rayGeo, rayMat);
    ray.position.set(Math.cos(a) * 5.4, Math.sin(a) * 5.4, 0);
    ray.rotation.z = a - Math.PI / 2;
    mandala.add(ray);
  }
  fig.add(mandala);
  god.mandala = mandala;

  // 圣莲底环
  const baseRing = new THREE.Mesh(
    new THREE.RingGeometry(5.0, 6.4, 36),
    new THREE.MeshBasicMaterial({ color: '#ffdf6b', transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  baseRing.rotation.x = -Math.PI / 2;
  baseRing.position.set(0, 0.35, 0);
  fig.add(baseRing);
  god.baseRing = baseRing;

  // 三重宏伟星环（含中环十二枚神文晶棱）
  const ringSpecs = [
    [9.6,  0.18, 12.2, [0.42, 0, 0]],
    [12.4, 0.15, 12.2, [-0.48, 0.5, 0]],
    [15.2, 0.12, 12.2, [0.22, -0.4, 0.4]],
  ];
  const glyphGeo = new THREE.OctahedronGeometry(0.45, 0);
  ringSpecs.forEach(([r, tube, py, rot], idx) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 44), goldMat);
    ring.position.y = py;
    ring.rotation.set(rot[0], rot[1], rot[2]);
    if (idx === 1) {
      for (let k = 0; k < 12; k++) {
        const ga = (k / 12) * Math.PI * 2;
        const gMesh = new THREE.Mesh(glyphGeo, rayMat);
        gMesh.position.set(Math.cos(ga) * r, Math.sin(ga) * r, 0);
        ring.add(gMesh);
      }
    }
    fig.add(ring);
    god.rings.push(ring);
  });
  scene.add(fig);
  god.figure = fig;

  const light = new THREE.PointLight('#ffe29c', 0, 185);
  light.position.set(GOD_POS.x, 22, GOD_POS.z + 8);
  const fillLight = new THREE.PointLight('#fff4d2', 0, 95);
  fillLight.position.set(GOD_POS.x, 22, GOD_POS.z + 14);
  scene.add(light, fillLight);
  god.light = light;
  god.fillLight = fillLight;

  // 3. “上帝之死”破碎星晶（80 个 InstancedMesh，单次绘制调用）
  const SHARD_N = 80;
  const sm = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.75, 0), new THREE.MeshBasicMaterial({ color: '#ffe794' }), SHARD_N);
  sm.frustumCulled = false;
  sm.visible = false;
  scene.add(sm);
  god.shardsMesh = sm;
  for (let i = 0; i < SHARD_N; i++) {
    god.shards.push({
      x: 0, y: 15, z: 0, vx: 0, vy: 0, vz: 0,
      sx: 0, sy: 0, sz: 0, rx: 0, ry: 0, rz: 0,
      spX: rand(-6, 6), spY: rand(-6, 6), spZ: rand(-6, 6), scale: rand(0.65, 1.75),
    });
  }
}

function unlockTheophany() {
  if (god.stage !== 'locked') return;
  god.stage = 'ready';
  if (god.beacon) god.beacon.visible = true;
  sndTheophanyChord();
  showMsg('✦ <b style="color:#ffd400">六贤齐鸣 · 神临已解锁！</b> 前往市中心金色光柱 (E) 直面神临奶娃', 6);
}

function startTheophany() {
  if (player.dead || godActive()) return;
  if (player.inCar) exitCar(true);
  if (player.inHeli) exitHeli(true);
  player.chute = false; chuteGroup.visible = false;
  player.laughT = 0;
  phoneOpen = false; closeDialog();
  heat = 0; stars = 0; prevStars = 0; lostT = 0;
  mouseL = mouseR = false;
  player.x = GOD_POS.x;
  player.z = GOD_POS.z + 20.0;
  player.y = 0; player.vy = 0;
  player.h = Math.PI;
  yaw = camYaw = Math.PI;
  pitch = -0.22;
  player.hm.g.visible = !fpv;
  player.hm.g.position.set(player.x, groundH(player.x, player.z), player.z);
  player.hm.g.rotation.set(0, Math.PI, 0);

  god.stage = 'descending';
  god.t = 0;
  if (god.beacon) god.beacon.visible = true;
  if (god.figure) { god.figure.visible = true; god.figure.position.set(GOD_POS.x, 84, GOD_POS.z); }
  if (god.shardsMesh) god.shardsMesh.visible = false;
  hud.epiphany.style.opacity = 0;
  sndTheophanyChord();
  showMsg('✦ 天穹裂开万丈金光，神临奶娃正携圣翼降临市中心……', 3.4);
}

function triggerGodBackdoor() {
  if (player.dead) { showMsg('请等待重生后再开启神临时刻', 2); return; }
  if (godActive()) { showMsg('神临仪式正在进行中！', 1.8); return; }
  for (const ph of philo.list) philo.met.add(ph.id);
  showMsg('✦ 六贤哲思瞬息贯通，正前往市中心开启【神临】！', 3);
  startTheophany();
}

function openGodDialog() {
  dialog.open = true;
  dialog.npc = { id: 'deity', name: '至高神影 · 圣翼奶娃', role: '✦ 四重神启终幕 ✦' };
  dialog.isSage = false;
  dialog.isGod = true;
  dialog.philoCompleted = false;
  mouseL = mouseR = false;

  const act4 = () => {
    setDialog(
      '“既已勘破外在偶像之相，神格与神坛便失去了全部重量。从此没有天外的立法者替你承担自由——苍穹归星辰，街道归行人，一切意义归于清醒、创造而自由的你！”',
      [{ label: '见证神之破碎（上帝已死 · 万念归心）', action: triggerGodShatter }],
      'god'
    );
  };
  const act3 = () => {
    setDialog(
      '“……哈哈哈！好一记直刺天心的破空之问！睁眼看看这二十二米圣翼与万丈荣光罢：倘若我并非施舍奖罚的暴君，那么你心中的道德律还因恐惧而立，还是因人本身的尊严而立？”',
      [
        { label: '“人为自己立法；人的尊严不需要任何神谕背书”', action: act4 },
        { label: '“我无惧永恒轮回，愿以自我意志重估万物的价值！”', action: act4 },
      ],
      'god'
    );
  };
  const act2 = () => {
    setDialog(
      '“诚然如此！亚里士多德落回大地，苏格拉底刺破成见，庄周齐万物而化蝶，笛卡尔守住‘我思’的支点，康德仰望头顶星空，尼采抡起巨锤。\n\n你眼前这座【神临奶娃】，原是你思想抵达出神入化之境时，城市天幕为你映出的自我倒影！”',
      [
        { label: '“既然神影不过是我理性的倒影，请归还我创造自己的天空”', action: act3 },
        { label: '“原是如此——大梦初醒，世间万物与我并生为一”', action: act3 },
      ],
      'god'
    );
  };
  setDialog(
    '“远道而来的求道者……六贤的火炬已在你胸臆共鸣，如今光柱贯通自由城天穹。当你直面这道降临于市中心的圣翼之影，你向虚空究竟所求何物？”',
    [
      { label: '“我不求赐福——你是造物主，还是我内心投射的幻影？”', action: act2 },
      { label: '“若理性、律令与逍遥皆由心生，云端为何还需立着神明？”', action: act2 },
    ],
    'god'
  );
}

function triggerGodShatter() {
  closeDialog();
  god.stage = 'shattering';
  god.t = 0;
  god.flashA = 1.0;
  shake = Math.max(shake, 0.9);
  if (god.figure) god.figure.visible = false;
  if (god.fillLight) god.fillLight.intensity = 0;
  sndGodShatter();

  const cx = GOD_POS.x, cy = 15.5, cz = GOD_POS.z;
  for (let i = 0; i < god.shards.length; i++) {
    const s = god.shards[i];
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(rand(-0.85, 0.85));
    const rad = rand(1.4, 6.6);
    s.x = cx + Math.sin(ph) * Math.cos(th) * rad;
    s.y = cy + Math.cos(ph) * rad * 2.1;
    s.z = cz + Math.sin(ph) * Math.sin(th) * rad;
    const spd = rand(10, 26);
    s.vx = Math.sin(ph) * Math.cos(th) * spd;
    s.vy = Math.cos(ph) * spd * 0.7 + rand(2, 7);
    s.vz = Math.sin(ph) * Math.sin(th) * spd;
    s.rx = rand(0, 6); s.ry = rand(0, 6); s.rz = rand(0, 6);
  }
  if (god.shardsMesh) god.shardsMesh.visible = true;
  for (let i = 0; i < 48; i++) {
    const a = Math.random() * Math.PI * 2, spd = rand(4, 15);
    emit(cx, cy, cz, Math.cos(a) * spd, rand(-2, 10), Math.sin(a) * spd, i % 3 === 0 ? '#ffffff' : '#ffd866', rand(0.25, 0.55), rand(0.9, 1.8), -3.5);
  }
  hud.epTitle.textContent = '上 帝 已 死';
  hud.epSub.textContent = '外在的偶像与神格轰然崩解，金光碎作万千星晶……';
  hud.epiphany.style.opacity = 1;
}

const _shardDummy = new THREE.Object3D();
function updateGod(dt) {
  if (god.flashA > 0) god.flashA = Math.max(0, god.flashA - dt * 0.9);
  hud.godflash.style.opacity = god.flashA;

  if (god.beacon && god.beacon.visible) {
    god.beacon.rotation.y += dt * 0.9;
    god.pillarMat.opacity = god.stage === 'shattering'
      ? Math.max(0, 0.24 * (1 - god.t / 1.5))
      : 0.18 + Math.sin(gameTime * 3.0) * 0.06;
  }

  if (god.stage === 'descending') {
    god.t += dt;
    const k = clamp(god.t / 3.6, 0, 1);
    const ease = 1 - Math.pow(1 - k, 3);
    god.skyBlend = lerp(god.skyBlend, 1.0, Math.min(1, dt * 2.0));
    god.figure.position.y = lerp(84, 4.2, ease);
    god.figure.rotation.y = Math.sin(gameTime * 0.7) * 0.16;
    god.light.intensity = ease * 120;
    god.light.position.set(GOD_POS.x, god.figure.position.y + 13, GOD_POS.z + 8);
    if (god.fillLight) {
      god.fillLight.intensity = ease * 42;
      god.fillLight.position.set(GOD_POS.x, god.figure.position.y + 17, GOD_POS.z + 15);
    }
    if (god.mandala) god.mandala.rotation.z += dt * 0.35;
    if (god.baseRing) god.baseRing.rotation.z -= dt * 0.5;
    for (let i = 0; i < god.rings.length; i++) {
      god.rings[i].rotation.x += dt * (0.8 + i * 0.35) * (i % 2 ? 1 : -1);
      god.rings[i].rotation.y += dt * (1.1 + i * 0.25);
    }
    if (Math.random() < 0.25) {
      const a = Math.random() * Math.PI * 2, r = rand(4, 11);
      emit(GOD_POS.x + Math.cos(a) * r, god.figure.position.y + rand(2, 18), GOD_POS.z + Math.sin(a) * r, rand(-0.4, 0.4), rand(1.5, 3.8), rand(-0.4, 0.4), '#ffe894', rand(0.16, 0.30), rand(1.0, 1.8), 0.3, -0.05);
    }
    if (k >= 1) {
      god.stage = 'enlightening';
      openGodDialog();
    }
  } else if (god.stage === 'enlightening') {
    god.skyBlend = lerp(god.skyBlend, 1.0, Math.min(1, dt * 2));
    god.figure.position.y = 4.2 + Math.sin(gameTime * 1.6) * 0.55;
    god.figure.rotation.y = Math.sin(gameTime * 0.55) * 0.13;
    god.light.position.set(GOD_POS.x, god.figure.position.y + 13, GOD_POS.z + 8);
    if (god.fillLight) god.fillLight.position.set(GOD_POS.x, god.figure.position.y + 17, GOD_POS.z + 15);
    if (god.mandala) god.mandala.rotation.z += dt * 0.35;
    if (god.baseRing) god.baseRing.rotation.z -= dt * 0.5;
    for (let i = 0; i < god.rings.length; i++) {
      god.rings[i].rotation.x += dt * (0.9 + i * 0.3) * (i % 2 ? 1 : -1);
      god.rings[i].rotation.y += dt * (1.2 + i * 0.2);
    }
    if (Math.random() < 0.22) {
      const a = Math.random() * Math.PI * 2, r = rand(4, 11);
      emit(GOD_POS.x + Math.cos(a) * r, god.figure.position.y + rand(2, 19), GOD_POS.z + Math.sin(a) * r, rand(-0.3, 0.3), rand(1.2, 3.0), rand(-0.3, 0.3), '#ffe894', rand(0.15, 0.28), rand(1.1, 1.9), 0.3, -0.04);
    }
  } else if (god.stage === 'shattering') {
    god.t += dt;
    if (god.fillLight) god.fillLight.intensity = 0;
    const px = player.x, py = groundH(player.x, player.z) + 1.35, pz = player.z;
    if (god.t < 2.2) {
      const drag = Math.exp(-2.8 * dt);
      for (const s of god.shards) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        s.vx *= drag; s.vy *= drag; s.vz *= drag;
        s.rx += s.spX * dt; s.ry += s.spY * dt; s.rz += s.spZ * dt;
      }
      god.light.intensity = Math.max(0, 120 * (1 - god.t / 2.2));
    } else {
      if (hud.epTitle.textContent !== '神 本 无 相') {
        hud.epTitle.textContent = '神 本 无 相';
        hud.epSub.textContent = '神明从来并不存在——那是你出神入化的哲学思想，在天地间照见了你自己。';
      }
      if (god.beacon) god.beacon.visible = false;
      const p = clamp((god.t - 2.2) / 3.6, 0, 1);
      const pull = clamp(dt * (2.6 + p * 7.5), 0, 1);
      for (let i = 0; i < god.shards.length; i++) {
        const s = god.shards[i];
        const ang = gameTime * 4.0 + i * 0.5;
        const orbR = (1 - p) * 2.4;
        const tx = px + Math.cos(ang) * orbR, ty = py + (1 - p) * 1.4, tz = pz + Math.sin(ang) * orbR;
        s.x = lerp(s.x, tx, pull);
        s.y = lerp(s.y, ty, pull);
        s.z = lerp(s.z, tz, pull);
        s.rx += s.spX * dt * 2.2; s.ry += s.spY * dt * 2.2;
      }
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2;
        emit(px + Math.cos(a) * 1.4, py + rand(-0.4, 0.9), pz + Math.sin(a) * 1.4, rand(-0.8, 0.8), rand(0.8, 2.2), rand(-0.8, 0.8), '#ffe588', 0.14, 0.65, -0.5);
      }
      if (god.t >= 5.6) hud.epiphany.style.opacity = 0;
    }

    const fadeScale = god.t < 2.2 ? 1.0 : clamp(1 - (god.t - 2.2) / 3.6, 0.04, 1.0);
    for (let i = 0; i < god.shards.length; i++) {
      const s = god.shards[i];
      _shardDummy.position.set(s.x, s.y, s.z);
      _shardDummy.rotation.set(s.rx, s.ry, s.rz);
      _shardDummy.scale.setScalar(s.scale * fadeScale);
      _shardDummy.updateMatrix();
      god.shardsMesh.setMatrixAt(i, _shardDummy.matrix);
    }
    god.shardsMesh.instanceMatrix.needsUpdate = true;

    if (god.t >= 6.2) {
      god.stage = 'transcended';
      god.shardsMesh.visible = false;
      god.light.intensity = 0;
      if (god.fillLight) god.fillLight.intensity = 0;
      hud.epiphany.style.opacity = 0;
      player.hp = player.maxHp; player.armor = player.maxArmor; player.stamina = 100;
      if (!god.rewarded) {
        god.rewarded = true;
        player.money += 2000;
        player.ammos[1] += 68; player.ammos[2] += 128; player.ammos[3] += 32; player.ammos[4] += 90; player.ammos[5] += 15;
        showMsg('✦ <b style="color:#ffd400">出神入化！</b> 神格已碎、万念归心（卷心菜精心制作 · +$2000 · 全属性补满）', 5.5);
      } else {
        showMsg('✦ 重温【神临 · 上帝之死】完毕，心境澄明！', 3.2);
      }
    }
  } else {
    if (god.skyBlend > 0.001) god.skyBlend = Math.max(0, god.skyBlend - dt * 0.8);
    if (god.light) god.light.intensity = 0;
    if (god.fillLight) god.fillLight.intensity = 0;
  }

  playerAuraRing.visible = god.stage === 'transcended' && !inVehicle() && !player.dead && !fpv;
  if (playerAuraRing.visible) playerAuraRing.rotation.z += dt * 1.4;
}

/* ============================ 玩家 ============================ */
function damagePlayer(d) {
  if (player.dead || godActive() || player.invulnT > 0) return;
  flashA = Math.min(0.9, flashA + d / 25);
  if (player.armor > 0) {
    const abs = Math.min(player.armor, d);
    player.armor -= abs; d -= abs;
  }
  player.hp -= d;
  if (player.hp <= 0) { player.hp = 0; killPlayer('WASTED'); }
}
function killPlayer(kind) {
  if (player.dead) return;
  if (player.inCar) exitCar(true);
  if (player.inHeli) exitHeli(true);
  player.chute = false; chuteGroup.visible = false;
  player.dead = true; player.deadT = 0; player.deadKind = kind; player.fall = 0;
  phoneOpen = false; codexOpen = false;
  if (hud.codexPanel) hud.codexPanel.style.display = 'none';
  if (hud.scopeOverlay) hud.scopeOverlay.style.display = 'none';
  closeDialog();
  fpvRig.visible = false;
  player.hm.g.visible = true;
  hud.big.textContent = kind; hud.big.className = kind === 'WASTED' ? 'wasted' : 'busted'; hud.big.style.display = 'block';
  canvas.style.filter = 'grayscale(0.85) contrast(1.1)';
  if (kind === 'BUSTED') player.hm.armL.rotation.x = player.hm.armR.rotation.x = -Math.PI;
  if (mission.active) { clearMissionExtras(); mission.active = false; marker.visible = false; mission.cooldown = 8; }
  if (gameMode === 'bounty') {
    const broke = saveBountyBest();
    hud.bountySummary.style.display = 'block';
    hud.bountySummary.innerHTML = `
      <div style="color:#ffd400;font-weight:900;font-size:20px;margin-bottom:4px">🎯 赏金猎人结算 ${broke ? '<span style="color:#7fdc6a">【新纪录！】</span>' : ''}</div>
      <div>存活时间：<b style="color:#fff">${fmtTime(bounty.surviveTime)}</b></div>
      <div>总击杀数：<b style="color:#ff5c58">${bounty.kills} 人</b>（赏金目标 ${bounty.targetKills} 人）</div>
      <div>到达波次：<b>第 ${bounty.wave} 波</b> · 赚取赏金：<b style="color:#7fdc6a">$${bounty.earned}</b></div>
    `;
  }
}
function resetBountyRun() {
  clearBountyTargets();
  bounty.wave = 0; bounty.surviveTime = 0; bounty.kills = 0; bounty.targetKills = 0; bounty.earned = 0; bounty.cooldown = 0.5;
  player.hp = player.maxHp; player.armor = player.maxArmor; player.stamina = 100;
  player.clips = [0, 17, 32, 8, 30, 5];
  player.ammos = [0, 170, 256, 48, 180, 25];
}
function respawn() {
  const kind = player.deadKind;
  const fee = gameMode === 'bounty' ? 0 : (kind === 'WASTED' ? Math.min(player.money, 100) : Math.min(player.money, 200));
  player.money -= fee;
  Object.assign(player, {
    dead: false, hp: player.maxHp, stamina: 100, x: SPAWN.x, z: SPAWN.z, y: 0, vy: 0, vx: 0, vz: 0,
    h: Math.PI, prevH: Math.PI, turnVel: 0, bustT: 0, fall: 0, reloadT: 0, punchT: 0,
    combo: 0, comboT: 0, dodgeT: 0, dodgeCD: 0, invulnT: 0, landSquash: 0, chute: false,
  });
  chuteGroup.visible = false;
  if (gameMode === 'bounty') {
    resetBountyRun();
  } else if (kind === 'BUSTED') {
    player.clips = [0, 17, 0, 0, 0, 0]; player.ammos = [0, 51, 0, 0, 0, 0]; player.armor = 0;
  }
  heat = 0; stars = 0; prevStars = 0; lostT = 0;
  yaw = camYaw = Math.PI; pitch = 0.22;
  player.hm.g.rotation.set(0, Math.PI, 0);
  player.hm.g.visible = !fpv;
  hud.big.style.display = 'none'; hud.bountySummary.style.display = 'none'; canvas.style.filter = '';
  if (gameMode === 'bounty') showMsg('🎯 新一轮赏金挑战开始！活下去并消灭目标！', 3.5);
  else showMsg(kind === 'WASTED' ? `你在医院醒来，支付医药费 $${fee}` : `你被保释出狱，罚款 $${fee}，重武器被没收`, 4);
}
function switchWeapon(idx) {
  idx = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
  if (idx === player.wpn) return;
  player.wpn = idx; player.reloadT = 0;
  wpnMeshes.forEach((m, i) => { if (m) m.visible = (i === idx); });
  fpvMeshes.forEach((m, i) => { if (m) m.visible = (i === idx); });
  fpvMuzzle.position.set(0, 0.035, idx === 5 ? -0.60 : idx === 4 ? -0.48 : idx === 3 ? -0.45 : idx === 2 ? -0.34 : -0.22);
  if (hud.scopeOverlay) hud.scopeOverlay.style.display = 'none';
  showMsg(`${WEAPONS[idx].icon} ${WEAPONS[idx].name}`, 1.2);
}
function toggleFPV() {
  fpv = !fpv;
  carPitchOff = 0;
  if (!inVehicle() && !player.dead) player.hm.g.visible = !fpv;
  showMsg(fpv ? '👁 第一人称视角' : '🎥 第三人称视角', 1.4);
}
function enterHeli(h) {
  h.pilot = 'player';
  h.drvTorso.material = mat('#3b3f46');
  const pKind = playerRigKind();
  if (customRoleLoaded && pKind) {
    if (!h.customDrv) {
      const rig = createMascotRig(pKind, PLAYER_MASCOT_COLOR, false);
      h.customDrv = rig.g;
      h.customSkel = rig.skeleton;
      h.customDrv.scale.setScalar(pKind === 'whale' ? 0.48 : 0.44);
      h.customDrv.position.set(0, pKind === 'whale' ? 0.08 : 0.14, -0.02);
      h.drv.add(h.customDrv);
    }
    for (const ch of h.drv.children) ch.visible = (ch === h.customDrv);
  }
  player.inHeli = h;
  player.chute = false;
  chuteGroup.visible = false;
  player.hm.g.visible = false;
  fpvRig.visible = false;
  camYaw = h.h; carYawOff = 0; carPitchOff = 0;
  showMsg('🚁 <b>空格</b>上升 · <b>Shift/C</b>下降 · <b>WSAD</b>飞行 · <b>Q/E</b>侧移 · <b>F</b>跳伞/下机', 4.5);
}
function exitHeli(force) {
  const h = player.inHeli;
  if (!h) return;
  const lx = Math.cos(h.h), lz = -Math.sin(h.h);
  let x = h.x + lx * 2.5, z = h.z + lz * 2.5;
  if (pointInBuilding(x, h.y + 0.8, z, 0.45)) { x = h.x - lx * 2.5; z = h.z - lz * 2.5; }
  player.x = clamp(x, -WALL + 2, WALL - 2);
  player.z = clamp(z, -WALL + 2, WALL - 2);
  collideCircle(player, 0.45, h.y + 0.5);
  const gH = groundH(player.x, player.z);
  const sup = heliSupportH(player.x, player.z, h.y + 0.5, 0.45);
  player.y = Math.max(sup - gH, h.y - gH);
  player.vy = 0;
  if (h.pilot === 'player') h.pilot = null;
  if (h.customDrv) {
    for (const ch of h.drv.children) ch.visible = (ch !== h.customDrv);
  }
  player.inHeli = null;
  player.hm.g.visible = !fpv;
  carPitchOff = 0;
  yaw = fpv ? h.h : camYaw;
  if (!force && (gH + player.y) - sup > 5.0) {
    player.chute = true;
    chuteGroup.visible = !fpv;
    player.vy = -2.5;
    showMsg('☂ 高空跳伞！WASD 滑翔控制落点', 2.8);
  } else {
    player.chute = false;
    chuteGroup.visible = false;
  }
}
function toggleCar() {
  if (player.dead) return;
  if (player.inCar) { exitCar(false); return; }
  if (player.inHeli) { exitHeli(false); return; }
  const py = groundH(player.x, player.z) + player.y;
  let bestHeli = null, bdHeli = 6.5 * 6.5;
  for (const h of helis) {
    if (h.wreck) continue;
    if (Math.abs(h.y - py) > 3.5) continue;
    const d = dist2(h.x, h.z, player.x, player.z);
    if (d < bdHeli) { bdHeli = d; bestHeli = h; }
  }
  let best = null, bd = 4.5 * 4.5;
  if (player.y < 2.5) {
    for (const c of cars) {
      if (c.wreck) continue;
      const d = dist2(c.x, c.z, player.x, player.z);
      if (d < bd) { bd = d; best = c; }
    }
  }
  if (bestHeli && (!best || bdHeli <= bd * 1.4)) { enterHeli(bestHeli); return; }
  if (!best) return;
  if (best.driver === 'ai' || best.driver === 'police') {
    const wasPolice = best.driver === 'police';
    ejectDriver(best);
    if (wasPolice) { addHeat(60); showMsg('你抢了一辆警车！', 2); }
    else { if (policeNear(40)) setMinHeat(50); showMsg('抢车！', 1.5); }
    alertPeds(best.x, best.z, 15);
  }
  best.driver = 'player'; best.ai = null;
  best.drvTorso.material = mat('#3b3f46');
  const pKind = playerRigKind();
  if (customRoleLoaded && pKind) {
    if (!best.customDrv) {
      const rig = createMascotRig(pKind, PLAYER_MASCOT_COLOR, false);
      best.customDrv = rig.g;
      best.customSkel = rig.skeleton;
      best.customDrv.scale.setScalar(pKind === 'whale' ? 0.52 : 0.46);
      best.customDrv.position.set(0, pKind === 'whale' ? 0.10 : 0.16, -0.02);
      best.drv.add(best.customDrv);
    }
    for (const ch of best.drv.children) ch.visible = (ch === best.customDrv);
  }
  player.inCar = best;
  player.hm.g.visible = false;
  fpvRig.visible = false;
  camYaw = yaw; carYawOff = 0; carPitchOff = 0;
}
function exitCar(force) {
  const c = player.inCar;
  if (!c) return;
  const lx = Math.cos(c.h), lz = -Math.sin(c.h);
  let x = c.x + lx * 1.9, z = c.z + lz * 1.9;
  if (pointInBuilding(x, 1, z, 0.4)) { x = c.x - lx * 1.9; z = c.z - lz * 1.9; }
  player.x = x; player.z = z; collideCircle(player, 0.45);
  player.h = c.h; player.y = 0; player.vy = 0;
  if (c.driver === 'player') c.driver = null;
  if (c.customDrv) {
    for (const ch of c.drv.children) ch.visible = (ch !== c.customDrv);
  }
  player.inCar = null;
  player.hm.g.visible = !fpv;
  carPitchOff = 0;
  yaw = fpv ? c.h : camYaw;
  if (!force && Math.abs(c.speed) > 12) { damagePlayer(Math.abs(c.speed) * 0.8); showMsg('跳车！', 1.2); }
}
function startReload() {
  const w = WEAPONS[player.wpn];
  if (w.melee || player.reloadT > 0 || player.clips[player.wpn] >= w.clipMax || player.ammos[player.wpn] <= 0 || inVehicle()) return;
  player.reloadT = w.reload;
  playTone(300, 0.05, 0.1); setTimeout(() => playTone(500, 0.05, 0.1), w.reload * 700);
}
let killFeedT = 0;
function showKillFeed(txt) {
  if (!hud.killFeed) return;
  hud.killFeed.innerHTML = txt;
  hud.killFeed.style.opacity = 1;
  killFeedT = 1.65;
}
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
function playerShoot() {
  if (player.reloadT > 0 || player.fireCD > 0 || inVehicle() || player.dead || player.dodgeT > 0.12) return;
  const w = WEAPONS[player.wpn];
  const dmgMul = player.buffs.nietzscheDmg ? 1.2 : 1.0;
  const headMul = player.buffs.descartesHead ? 1.3 : 1.0;
  if (w.melee) {
    player.combo = player.comboT > 0 ? (player.combo % 3) + 1 : 1;
    player.comboT = 0.85;
    player.fireCD = player.combo === 3 ? w.cd * 1.25 : w.cd;
    player.punchT = player.combo === 3 ? 0.30 : 0.22;
    player.h = yaw;
    playNoise(0.08, player.combo === 3 ? 520 : 720, player.combo === 3 ? 0.32 : 0.25);
    const fx = Math.sin(player.h), fz = Math.cos(player.h);
    const range = player.combo === 3 ? 3.2 : 2.4;
    const cone = player.combo === 3 ? -0.2 : 0.32;
    const mDmg = Math.round(w.dmg * (player.combo === 3 ? 1.5 : player.combo === 2 ? 1.15 : 1.0) * dmgMul);
    if (player.combo === 3) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        emit(player.x + Math.cos(a) * 1.4, groundH(player.x, player.z) + player.y + 0.9, player.z + Math.sin(a) * 1.4, Math.cos(a) * 4, 0.8, Math.sin(a) * 4, '#38d9ff', 0.16, 0.28);
      }
    }
    let hitAny = false;
    for (const p of peds) {
      if (p.state === 'dead') continue;
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d + 1e-4) > cone) {
        const wasAlive = p.state !== 'dead';
        damagePed(p, mDmg, fx * 2.8, fz * 2.8, true);
        if (wasAlive && p.state === 'dead') { player.kills++; showKillFeed(`👊 ${player.combo === 3 ? '鲸尾旋踢' : '近战终结'}!`); }
        hitAny = true;
      }
    }
    for (const c of cars) if (c.copOut) {
      const dx = c.copX - player.x, dz = c.copZ - player.z, d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d + 1e-4) > cone) { killCop(c, true); player.kills++; showKillFeed('👊 击倒警员!'); hitAny = true; }
    }
    for (const t of bounty.targets) if (!t.dead) {
      const dx = t.x - player.x, dz = t.z - player.z, d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d + 1e-4) > cone) {
        damageBountyTarget(t, mDmg, fx * 2.8, fz * 2.8);
        if (t.dead) { player.kills++; showKillFeed('👊 赏金终结!'); }
        hitAny = true;
      }
    }
    for (const se of story.enemies) if (!se.dead) {
      const dx = se.x - player.x, dz = se.z - player.z, d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d + 1e-4) > cone) {
        damageStoryEnemy(se, mDmg, fx * 2.8, fz * 2.8);
        if (se.dead) { player.kills++; showKillFeed(`👊 击倒 ${se.name}!`); }
        hitAny = true;
      }
    }
    for (const me of mission.enemies) if (!me.dead) {
      const dx = me.x - player.x, dz = me.z - player.z, d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d + 1e-4) > cone) {
        damageMissionEnemy(me, mDmg, fx * 2.8, fz * 2.8);
        if (me.dead) { player.kills++; showKillFeed('👊 清除据点打手!'); }
        hitAny = true;
      }
    }
    if (hitAny) { playTone(player.combo === 3 ? 150 : 120, 0.08, 0.25, 'sine'); if (policeNear(26)) setMinHeat(50); }
    return;
  }
  if (player.clips[player.wpn] <= 0) {
    if (player.ammos[player.wpn] > 0) startReload();
    else { playTone(200, 0.05, 0.1); player.fireCD = 0.3; }
    return;
  }
  player.clips[player.wpn]--; player.fireCD = w.cd; player.lastShot = gameTime;
  player.h = yaw;
  sndWeapon(w.id);
  shake = Math.max(shake, w.shake);
  // 真实后坐力与准星扩散
  const rMul = mouseR ? 0.65 : 1;
  pitch = clamp(pitch - w.recoil * rMul, -0.6, 1.2);
  recoilPitch += w.recoil * rMul;
  yaw += rand(-w.recoil * 0.26, w.recoil * 0.26);
  recoilKick = Math.min(0.85, recoilKick + w.kick);
  bloom = Math.min(18, bloom + (w.id === 'shotgun' ? 12 : w.id === 'sniper' ? 10 : w.id === 'smg' ? 4.2 : w.id === 'rifle' ? 4.8 : 5.5));
  let muzzle;
  if (fpv || (w.scoped && mouseR)) {
    camera.updateMatrixWorld();
    muzzle = w.scoped && mouseR ? camera.localToWorld(new THREE.Vector3(0.08, -0.08, -0.5)) : fpvMuzzle.getWorldPosition(new THREE.Vector3());
  } else {
    player.hm.g.updateMatrixWorld();
    muzzle = player.hm.armR.localToWorld(new THREE.Vector3(0, -0.98, 0.06));
  }
  muzzleLight.position.copy(muzzle);
  muzzleLight.intensity = (w.id === 'sniper' || w.id === 'shotgun') ? 3.2 : 1.9;
  muzzleFlashT = 0.055;
  emit(muzzle.x, muzzle.y, muzzle.z, 0, 0, 0, '#ffe680', w.id === 'sniper' ? 0.25 : 0.18, 0.055);
  // 抛弹壳粒子
  if (w.id !== 'shotgun' || player.clips[player.wpn] >= 0) {
    const rx = -Math.cos(player.h), rz = Math.sin(player.h);
    emit(muzzle.x, muzzle.y + 0.05, muzzle.z, rx * rand(1.5, 2.8) + rand(-0.4, 0.4), rand(1.8, 3.0), rz * rand(1.5, 2.8) + rand(-0.4, 0.4), '#e5c158', 0.035, 0.45, -12);
  }
  const baseDir = new THREE.Vector3(); camera.getWorldDirection(baseDir);
  const spread = (w.scoped && mouseR ? 0.05 : mouseR ? 0.4 : 1) * w.spread + bloom * (w.scoped && mouseR ? 0.0001 : 0.0006);
  const minT = (fpv || (w.scoped && mouseR)) ? 0.2 : camera.position.distanceTo(new THREE.Vector3(player.x, groundH(player.x, player.z) + player.y + 1.5, player.z)) + 0.5;
  let anyHit = false, anyHead = false;
  const maxRange = w.id === 'sniper' ? 320 : w.id === 'rifle' ? 220 : w.id === 'shotgun' ? 58 : 165;
  for (let pel = 0; pel < w.pellets; pel++) {
    _o.copy(camera.position);
    _d.copy(baseDir);
    _d.x += rand(-spread, spread); _d.y += rand(-spread, spread); _d.z += rand(-spread, spread); _d.normalize();
    let best = maxRange, hit = { type: 'none' };
    for (const b of colliders) { const t = rayBox(_o, _d, b); if (t !== null && t > minT && t < best) { best = t; hit = { type: 'world' }; } }
    if (_d.y < 0) { const t = -_o.y / _d.y; if (t > minT && t < best) { best = t; hit = { type: 'world' }; } }
    for (const p of peds) {
      if (p.state === 'dead') continue;
      for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.26]]) {
        const t = raySphere(_o, _d, p.x, groundH(p.x, p.z) + y, p.z, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'ped', p, head: y > 1.6 }; }
      }
    }
    for (const bt of bounty.targets) {
      if (bt.dead) continue;
      for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.26]]) {
        const t = raySphere(_o, _d, bt.x, groundH(bt.x, bt.z) + y, bt.z, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'bounty', bt, head: y > 1.6 }; }
      }
    }
    for (const se of story.enemies) {
      if (se.dead) continue;
      for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.26]]) {
        const t = raySphere(_o, _d, se.x, groundH(se.x, se.z) + y, se.z, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'story', se, head: y > 1.6 }; }
      }
    }
    for (const me of mission.enemies) {
      if (me.dead) continue;
      for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.26]]) {
        const t = raySphere(_o, _d, me.x, groundH(me.x, me.z) + y, me.z, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'mission', me, head: y > 1.6 }; }
      }
    }
    for (const c of cars) {
      if (c.wreck) continue;
      for (const [cx, cz] of carCircles(c)) {
        const t = raySphere(_o, _d, cx, 0.9, cz, 1.15);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'car', c }; }
      }
      if (c.copOut) for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.26]]) {
        const t = raySphere(_o, _d, c.copX, y, c.copZ, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'cop', c, head: y > 1.6 }; }
      }
    }
    for (const h of helis) {
      if (h.wreck) continue;
      const t = raySphere(_o, _d, h.x, h.y + 1.4, h.z, 2.3);
      if (t !== null && t > minT && t < best) { best = t; hit = { type: 'heli', h }; }
    }
    const pt = _o.clone().addScaledVector(_d, best);
    tracer(muzzle, pt);
    const dmg = Math.round((hit.head ? w.headDmg * headMul : w.dmg) * dmgMul);
    if (hit.type === 'ped') {
      const wasAlive = hit.p.state !== 'dead';
      damagePed(hit.p, dmg, _d.x * 2, _d.z * 2, true);
      anyHit = true; if (hit.head) anyHead = true;
      if (wasAlive && hit.p.state === 'dead') { player.kills++; if (hit.head) { player.headshots++; showKillFeed('💀 精准爆头!'); } }
    } else if (hit.type === 'bounty') {
      damageBountyTarget(hit.bt, dmg, _d.x * 2, _d.z * 2);
      anyHit = true; if (hit.head) anyHead = true;
      if (hit.bt.dead) { player.kills++; if (hit.head) player.headshots++; showKillFeed(hit.head ? '💀 赏金爆头击杀!' : '🎯 击杀赏金目标!'); }
    } else if (hit.type === 'story') {
      damageStoryEnemy(hit.se, dmg, _d.x * 2, _d.z * 2);
      anyHit = true; if (hit.head) anyHead = true;
      if (hit.se.dead) { player.kills++; if (hit.head) player.headshots++; showKillFeed(hit.head ? `💀 爆头 ${hit.se.name}!` : `⚔️ 击杀 ${hit.se.name}`); }
    } else if (hit.type === 'mission') {
      damageMissionEnemy(hit.me, dmg, _d.x * 2, _d.z * 2);
      anyHit = true; if (hit.head) anyHead = true;
      if (hit.me.dead) { player.kills++; if (hit.head) player.headshots++; showKillFeed(hit.head ? '💀 据点爆头!' : '⚔️ 击倒暴徒!'); }
    } else if (hit.type === 'car') {
      damageCar(hit.c, dmg * 0.78, true);
      for (let i = 0; i < 3; i++) emit(pt.x, pt.y, pt.z, rand(-3, 3), rand(0, 3), rand(-3, 3), '#ffd070', 0.06, 0.3, -10);
      if (hit.c.police) setMinHeat(50);
      if (hit.c.driver === 'ai' && hit.c.ai) hit.c.ignoreT = 3;
    } else if (hit.type === 'heli') {
      damageHeli(hit.h, dmg * 0.72); anyHit = true;
      for (let i = 0; i < 3; i++) emit(pt.x, pt.y, pt.z, rand(-3, 3), rand(0, 3), rand(-3, 3), '#ffd070', 0.06, 0.3, -10);
    } else if (hit.type === 'cop') {
      killCop(hit.c, true); anyHit = true; if (hit.head) anyHead = true;
      player.kills++; if (hit.head) player.headshots++; showKillFeed(hit.head ? '💀 警员爆头击倒!' : '★ 击倒警员!');
    } else if (hit.type === 'world') for (let i = 0; i < 2; i++) emit(pt.x, pt.y, pt.z, rand(-1, 1), rand(0, 2), rand(-1, 1), '#bbb', 0.06, 0.4, -6);
  }
  if (anyHit) { hitmarkerT = 0.14; hitmarkerHead = anyHead; sndHit(anyHead); }
  alertPeds(player.x, player.z, 28);
  if (policeNear(42)) setMinHeat(50);
}
function startPlayerDodge() {
  if (inVehicle() || player.dead || dialog.open || codexOpen || godActive() || player.chute) return;
  if (player.dodgeT > 0 || player.dodgeCD > 0 || player.stamina < 28) {
    if (player.stamina < 28) showMsg('体能不足，无法翻滚', 0.9);
    return;
  }
  player.stamina = Math.max(0, player.stamina - 28);
  player.dodgeT = 0.42; player.dodgeCD = 0.82; player.invulnT = 0.38; player.laughT = 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
  let dx = 0, dz = 0;
  if (keys.KeyW || keys.ArrowUp) { dx += fx; dz += fz; }
  if (keys.KeyS || keys.ArrowDown) { dx -= fx; dz -= fz; }
  if (keys.KeyD || keys.ArrowRight) { dx += rx; dz += rz; }
  if (keys.KeyA || keys.ArrowLeft) { dx -= rx; dz -= rz; }
  const dl = Math.hypot(dx, dz);
  if (dl > 0.05) { dx /= dl; dz /= dl; } else { dx = fx; dz = fz; }
  player.vx = dx * 12.8; player.vz = dz * 12.8;
  player.h = Math.atan2(dx, dz);
  sndDodge();
  const gy = groundH(player.x, player.z) + player.y;
  for (let i = 0; i < 7; i++) emit(player.x + rand(-0.3, 0.3), gy + 0.25, player.z + rand(-0.3, 0.3), -dx * rand(1, 3), rand(0.4, 1.5), -dz * rand(1, 3), '#7be8ff', 0.14, 0.35);
}
function horn() {
  if (!player.inCar) return;
  playTone(380, 0.35, 0.12, 'square'); playTone(475, 0.35, 0.08, 'square');
  const c = player.inCar, fx = Math.sin(c.h), fz = Math.cos(c.h);
  for (const p of peds) if (p.state === 'walk') {
    const rx = p.x - c.x, rz = p.z - c.z, fd = rx * fx + rz * fz;
    if (fd > 0 && fd < 20 && Math.abs(-rx * fz + rz * fx) < 5) { p.state = 'flee'; p.fleeT = rand(2, 4); p.tx = c.x; p.tz = c.z; }
  }
}
function updatePlayer(dt) {
  const hm = player.hm;
  if (muzzleFlashT > 0) {
    muzzleFlashT = Math.max(0, muzzleFlashT - dt);
    if (muzzleFlashT <= 0) muzzleLight.intensity = 0;
  }
  player.fireCD -= dt;
  if (player.punchT > 0) player.punchT -= dt;
  if (player.dodgeCD > 0) player.dodgeCD = Math.max(0, player.dodgeCD - dt);
  if (player.invulnT > 0) player.invulnT = Math.max(0, player.invulnT - dt);
  if (player.dodgeT > 0) player.dodgeT = Math.max(0, player.dodgeT - dt);
  if (player.comboT > 0) { player.comboT = Math.max(0, player.comboT - dt); if (player.comboT <= 0) player.combo = 0; }
  if (player.landSquash > 0) player.landSquash = Math.max(0, player.landSquash - dt * 3.2);
  if (player.jumpBuf > 0) player.jumpBuf = Math.max(0, player.jumpBuf - dt);
  if (player.waterWarnT > 0) player.waterWarnT = Math.max(0, player.waterWarnT - dt);

  if (player.reloadT > 0) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) {
      const w = WEAPONS[player.wpn];
      const n = Math.min(w.clipMax - player.clips[player.wpn], player.ammos[player.wpn]);
      player.clips[player.wpn] += n; player.ammos[player.wpn] -= n;
    }
  }
  if (player.dead) {
    player.laughT = 0; playerLaughGroup.visible = false;
    player.deadT += dt;
    if (playerMascotRig) animMascotRig(playerMascotRig, 0, 0, { dead: true });
    if (player.deadKind === 'WASTED') {
      player.fall = Math.min(1, player.fall + dt * 2.5);
      hm.g.rotation.set(-Math.PI / 2 * player.fall, player.h, 0, 'YXZ');
      hm.g.position.set(player.x, groundH(player.x, player.z) + 0.17 * player.fall, player.z);
    }
    if (player.deadT > 4.5) respawn();
    return;
  }
  if (player.inCar) {
    const c = player.inCar;
    player.x = c.x; player.z = c.z; player.y = 0; player.vx = 0; player.vz = 0;
    chuteGroup.visible = false;
    player.laughT = 0; playerLaughGroup.visible = false;
    player.stamina = Math.min(100, player.stamina + 20 * dt);
    return;
  }
  if (player.inHeli) {
    const h = player.inHeli;
    player.x = h.x; player.z = h.z; player.y = Math.max(0, h.y - groundH(h.x, h.z)); player.vx = 0; player.vz = 0;
    chuteGroup.visible = false;
    player.laughT = 0; playerLaughGroup.visible = false;
    player.stamina = Math.min(100, player.stamina + 20 * dt);
    return;
  }
  if (godActive() || dialog.open || codexOpen) {
    player.moving = false; player.vx = 0; player.vz = 0;
    player.laughT = 0; playerLaughGroup.visible = false;
    animHuman(hm, 0, 0);
    if (playerMascotRig) animMascotRig(playerMascotRig, 0, 0, { dt });
    customRoleRoot.visible = customRoleLoaded;
    for (const m of playerBaseBodyParts) m.visible = !customRoleLoaded;
    for (const m of playerBaseArmRParts) m.visible = !customRoleLoaded;
    wpnMeshes.forEach((m, i) => { if (m) m.visible = (i === player.wpn); });
    chuteGroup.visible = false;
    hm.g.visible = !fpv;
    return;
  }
  const wasPlayerLaughing = player.laughT > 0;
  if (wasPlayerLaughing) {
    if (mouseL) player.laughT = 0;
    else {
      player.laughT = Math.max(0, player.laughT - dt);
      if (player.laughT === 0) {
        spawnCyanSmoke(player.x, groundH(player.x, player.z) + player.y + 1.0, player.z, 1.4, false);
      }
    }
  }
  const isLaughing = player.laughT > 0 && playerLaughGroup.children.length > 0 && !inVehicle() && !player.dead && !godActive();
  playerLaughGroup.visible = isLaughing;
  customRoleRoot.visible = customRoleLoaded && !isLaughing;
  for (const m of playerBaseBodyParts) m.visible = !customRoleLoaded && !isLaughing;
  for (const m of playerBaseArmRParts) m.visible = !customRoleLoaded && !isLaughing;
  wpnMeshes.forEach((m, i) => { if (m) m.visible = !isLaughing && (i === player.wpn); });
  if (isLaughing) {
    const lt = gameTime + 1.1;
    const inE = clamp((3.4 - player.laughT) / 0.35, 0, 1);
    const outE = clamp(player.laughT / 0.45, 0, 1);
    const env = (inE * inE * (3 - 2 * inE)) * (outE * outE * (3 - 2 * outE));
    const sq = Math.sin(lt * 7.2) * 0.018 * env;
    playerLaughGroup.rotation.x = (-0.14 + Math.sin(lt * 7.2) * 0.075) * env;
    playerLaughGroup.rotation.z = Math.sin(lt * 3.6) * 0.05 * env;
    playerLaughGroup.position.y = (0.5 - 0.5 * Math.cos(lt * 7.2)) * 0.045 * env;
    playerLaughGroup.scale.set(1 + sq, 1 - sq * 1.1, 1 + sq);
  }
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) { mx += fx; mz += fz; }
  if (keys.KeyS || keys.ArrowDown) { mx -= fx; mz -= fz; }
  if (keys.KeyD || keys.ArrowRight) { mx += rx; mz += rz; }
  if (keys.KeyA || keys.ArrowLeft) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  player.moving = len > 0 || player.dodgeT > 0;
  const aiming = !player.chute && !player.dodgeT && (mouseR || gameTime - player.lastShot < 0.6);
  const wantSprint = (keys.ShiftLeft || keys.ShiftRight) && len > 0 && !mouseR && !player.chute && player.stamina > 1.5;
  if (wantSprint) player.stamina = Math.max(0, player.stamina - 14 * dt);
  else if (player.dodgeT <= 0) player.stamina = Math.min(100, player.stamina + (player.buffs.spinozaSpeed ? 36 : 18) * dt);

  const spdBonus = player.buffs.spinozaSpeed ? 1.14 : 1.0;
  const targetSpd = (player.chute ? 9.5 : mouseR ? 3.2 : wantSprint ? 10.6 : 5.5) * spdBonus;
  if (player.dodgeT > 0) {
    player.vx = damp(player.vx, 0, 1.5, dt);
    player.vz = damp(player.vz, 0, 1.5, dt);
  } else {
    const tx = len > 0 ? (mx / len) * targetSpd : 0;
    const tz = len > 0 ? (mz / len) * targetSpd : 0;
    const accelRate = player.chute ? 6 : (len > 0 ? 18 : 22);
    player.vx = damp(player.vx, tx, accelRate, dt);
    player.vz = damp(player.vz, tz, accelRate, dt);
  }
  player.x += player.vx * dt;
  player.z += player.vz * dt;
  const moveSpd = Math.hypot(player.vx, player.vz);
  if (moveSpd > 0.25) {
    player.phase += dt * moveSpd * 2.15;
    bobPhase += dt * moveSpd * 1.75;
    if (!aiming && !fpv && player.dodgeT <= 0 && len > 0) {
      player.h += angDiff(player.h, Math.atan2(mx, mz)) * Math.min(1, dt * 13);
    }
  }
  if (aiming || fpv) player.h = fpv ? yaw : player.h + angDiff(player.h, yaw) * Math.min(1, dt * 22);
  player.turnVel = angDiff(player.prevH, player.h) / Math.max(dt, 0.001);
  player.prevH = player.h;

  // 跳跃（土狼时间 + 跳跃缓冲 + 落地缓冲）、高空跳伞、屋顶着陆、海港落水保护
  const gH = groundH(player.x, player.z);
  const worldY = gH + player.y;
  const sup = (player.y > 0.5 || player.chute) ? heliSupportH(player.x, player.z, worldY, 0.45) : gH;
  const supRel = sup - gH;
  const onGround = !player.chute && player.y <= supRel + 0.05;
  if (onGround) player.coyoteT = 0.12;
  else player.coyoteT = Math.max(0, player.coyoteT - dt);

  if (onGround && moveSpd > 1.2 && !player.dodgeT) {
    player.stepDist += moveSpd * dt;
    if (player.stepDist > (wantSprint ? 1.85 : 1.55)) {
      player.stepDist = 0;
      sndStep(gH >= 0.2);
    }
  }

  if (player.chute) {
    player.vy = lerp(player.vy, -5.0, Math.min(1, dt * 4));
    player.y += player.vy * dt;
    if (player.y <= supRel + 0.05) {
      player.y = supRel; player.vy = 0; player.chute = false; chuteGroup.visible = false;
      player.landSquash = 0.35;
      showMsg('安全着陆！', 1.4);
    }
  } else {
    if ((keys.Space || player.jumpBuf > 0) && player.coyoteT > 0 && player.vy <= 0.5) {
      player.vy = 6.0; player.coyoteT = 0; player.jumpBuf = 0; sndStep(false);
    }
    if (keys.Space && !onGround && player.vy < -9 && player.y - supRel > 6) {
      player.chute = true; chuteGroup.visible = !fpv;
      showMsg('☂ 已开伞！WASD 滑翔控制落点', 2);
    }
    player.vy -= 15.5 * dt; player.y += player.vy * dt;
    if (player.y < supRel) {
      if (!player.wasGrounded && player.vy < -4.5) {
        player.landSquash = clamp((-player.vy - 4.0) / 14, 0.12, 0.45);
        sndStep(gH >= 0.2);
      }
      if (player.vy < -16) damagePlayer((-player.vy - 14) * 4.2);
      player.y = supRel; player.vy = 0;
    }
  }
  player.wasGrounded = player.y <= supRel + 0.06;

  // 滨海落水托底（防止跌出深海无法回到陆地/码头）
  if (gH < -0.1 && player.y <= 0.1) {
    emit(player.x, 0.15, player.z, rand(-1.5, 1.5), rand(1, 2.5), rand(-1.5, 1.5), '#b8e4ff', 0.22, 0.4);
    if (player.waterWarnT <= 0) { player.waterWarnT = 2.0; playNoise(0.2, 650, 0.16); showMsg('🌊 跌入港湾海水！正协助你游回岸边…', 1.8); }
    const backLen = Math.hypot(player.x, player.z) || 1;
    player.x -= (player.x / backLen) * 5 * dt;
    player.z -= (player.z / backLen) * 5 * dt;
    if (Math.max(Math.abs(player.x), Math.abs(player.z)) > WALL + 100) {
      player.x = clamp(player.x, -WALL + 2, WALL - 2);
      player.z = clamp(player.z, -WALL + 2, WALL - 2);
    }
  }

  collideCircle(player, 0.45, groundH(player.x, player.z) + player.y);
  for (const c of cars) {
    if (dist2(c.x, c.z, player.x, player.z) > 16) continue;
    if (player.y > 1.5) continue;
    const [qx, qz] = closestOnCar(c, player.x, player.z);
    const d2 = dist2(qx, qz, player.x, player.z);
    if (d2 < 1.3 * 1.3 && d2 > 1e-6) { const d = Math.sqrt(d2); player.x = qx + (player.x - qx) / d * 1.3; player.z = qz + (player.z - qz) / d * 1.3; }
  }
  if (mouseL && !player.chute) playerShoot();
  // 后坐力平滑回正
  if (recoilPitch > 0) {
    const rec = Math.min(recoilPitch, dt * 0.14);
    pitch = clamp(pitch + rec, -0.6, 1.2);
    recoilPitch -= rec;
  }
  recoilKick = Math.max(0, recoilKick - dt * 3.5);
  bloom = Math.max(0, bloom - dt * 28);
  if (moveSpd > 0.6) bloom = Math.max(bloom, wantSprint ? 7 : 3);
  // 动画
  const animSpdAmt = moveSpd > 0.4 ? (wantSprint ? 1.22 : 0.85) : 0;
  animHuman(hm, player.phase, animSpdAmt);
  if (playerMascotRig) {
    animMascotRig(playerMascotRig, player.phase, animSpdAmt, {
      dt,
      sprint: wantSprint,
      aiming: aiming && !WEAPONS[player.wpn].melee,
      twoHand: !!WEAPONS[player.wpn].twoHand,
      reloading: player.reloadT > 0,
      pitch,
      recoil: recoilKick,
      punch: player.punchT > 0,
      combo: player.combo,
      air: !onGround,
      dodge: player.dodgeT,
      squash: player.landSquash,
      turnVel: player.turnVel,
    });
    if (playerMascotRig.kind === 'whale') {
      const aimNow = aiming && !WEAPONS[player.wpn].melee;
      hm.armR.position.y = damp(hm.armR.position.y, aimNow ? 0.98 : 1.16, 12, dt);
    }
  }
  if (player.chute) {
    hm.armL.rotation.x = hm.armR.rotation.x = -2.4;
    if (playerMascotRig) {
      playerMascotRig.bones.armL.rotation.x = playerMascotRig.bones.armR.rotation.x = -2.0;
    }
  } else if (player.punchT > 0) { hm.armR.rotation.x = -Math.PI * 0.75; }
  else if (aiming && !WEAPONS[player.wpn].melee) { hm.armR.rotation.x = -Math.PI / 2 + pitch * 0.8 - recoilKick * 0.5; hm.armL.rotation.x = -Math.PI / 2.4 + pitch * 0.8 - recoilKick * 0.25; }
  else if (player.reloadT > 0) { hm.armR.rotation.x = -0.9; hm.armL.rotation.x = -1.1; }
  if (!onGround) { hm.legL.rotation.x = -0.5; hm.legR.rotation.x = 0.3; }
  chuteGroup.visible = player.chute && !inVehicle() && !player.dead && !fpv;
  hm.g.visible = !inVehicle() && (!fpv || player.dead);
  hm.g.position.set(player.x, groundH(player.x, player.z) + player.y, player.z);
  hm.g.rotation.set(0, player.h, 0);
}

/* ============================ 摄像机 ============================ */
const _from = new THREE.Vector3(), _to = new THREE.Vector3(), _tmp = new THREE.Vector3(), _look = new THREE.Vector3();
let camLeanX = 0;
function camCollide(from, to) {
  const steps = 14;
  let lastT = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    _tmp.copy(from).lerp(to, t);
    if (_tmp.y < 0.3 || pointInBuilding(_tmp.x, _tmp.y, _tmp.z, 0.35)) break;
    lastT = t;
  }
  return to.clone().sub(from).multiplyScalar(lastT).add(from);
}
function updateCamera(dt) {
  let targetFov = 65;
  if (godActive()) {
    fpvRig.visible = false;
    const a = Math.sin(gameTime * 0.25) * 0.28;
    _to.set(GOD_POS.x + Math.sin(a) * 32, 5.2, GOD_POS.z + 34);
    camera.position.lerp(_to, Math.min(1, dt * 3.5));
    const lookY = god.stage === 'descending' ? clamp(god.figure.position.y + 11.5, 14, 64) : 16.5;
    _look.set(GOD_POS.x, lookY, GOD_POS.z);
    camera.lookAt(_look);
    targetFov = god.stage === 'shattering' ? 78 : 70;
  } else if (player.inCar && fpv && !player.dead) {
    fpvRig.visible = false;
    const c = player.inCar;
    if (gameTime - lastMouseT > 1.5) {
      carYawOff *= Math.exp(-dt * 2.5);
      carPitchOff *= Math.exp(-dt * 2.5);
    }
    c.g.updateMatrixWorld();
    // 驾驶舱体验：转向/加速时头部随惯性轻微偏移 + 引擎/路面微震 + 视线预判弯道 + 车身侧倾同步
    const spdK = clamp(Math.abs(c.speed) / 30, 0, 1);
    const leanX = clamp(-c.steer * c.speed * 0.0013, -0.05, 0.05);
    const shakeY = Math.sin(gameTime * 43) * 0.0016 * spdK + Math.sin(gameTime * 17 + 1.3) * 0.0012 * spdK;
    const pushZ = clamp(-c.pitch * 1.6, -0.06, 0.06);
    camLeanX = lerp(camLeanX, leanX, Math.min(1, dt * 6));
    _from.set(c.eye.x + camLeanX, c.eye.y + shakeY, c.eye.z + pushZ);
    c.root.localToWorld(_from);
    camera.position.copy(_from);
    const lookYaw = c.h + carYawOff;
    const lookPitch = clamp(carPitchOff - c.pitch * 0.5, -0.5, 0.55);
    yaw = lookYaw;
    const camLookYaw = lookYaw + clamp(c.steer * 0.12 * spdK, -0.12, 0.12);
    _look.set(
      _from.x + Math.sin(camLookYaw) * Math.cos(lookPitch) * 10,
      _from.y - Math.sin(lookPitch) * 10,
      _from.z + Math.cos(camLookYaw) * Math.cos(lookPitch) * 10,
    );
    camera.lookAt(_look);
    camera.rotateZ(-c.root.rotation.z * 0.9);
    targetFov = 72 + Math.abs(c.speed) * 0.25;
  } else if (player.inCar) {
    fpvRig.visible = false;
    const c = player.inCar;
    if (gameTime - lastMouseT > 1.2) carYawOff *= Math.exp(-dt * 2.5);
    camYaw += angDiff(camYaw, c.h + carYawOff) * Math.min(1, dt * 3.5);
    yaw = camYaw;
    const dist = 8.5 + Math.abs(c.speed) * 0.05;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    _from.set(c.x, c.ground + 1.8, c.z);
    _to.set(c.x - fx * dist, c.ground + 3.4, c.z - fz * dist);
    camera.position.copy(camCollide(_from, _to));
    _look.set(c.x + Math.sin(c.h) * 3, c.ground + 1.3, c.z + Math.cos(c.h) * 3);
    camera.lookAt(_look);
    targetFov = 65 + Math.abs(c.speed) * 0.3;
  } else if (player.inHeli && fpv && !player.dead) {
    fpvRig.visible = false;
    const h = player.inHeli;
    if (gameTime - lastMouseT > 1.5) {
      carYawOff *= Math.exp(-dt * 2.5);
      carPitchOff *= Math.exp(-dt * 2.5);
    }
    h.g.updateMatrixWorld();
    // 直升机驾驶舱：旋翼低频震动 + 随机身倾斜同步 + 偏航预判
    const rpm = h.rotorRpm || 0;
    const hShakeX = (Math.sin(gameTime * 47) * 0.0022 + Math.sin(gameTime * 11) * 0.0012) * rpm;
    const hShakeY = (Math.sin(gameTime * 61 + 0.7) * 0.0026 + Math.sin(gameTime * 9 + 2.0) * 0.0015) * rpm;
    _from.set(h.eye.x + hShakeX, h.eye.y + hShakeY, h.eye.z);
    h.root.localToWorld(_from);
    camera.position.copy(_from);
    const lookYaw = h.h + carYawOff;
    const lookPitch = clamp(carPitchOff + h.pitch * 0.65, -0.55, 0.65);
    yaw = lookYaw;
    const camLookYaw = lookYaw + clamp(h.yawVel * 0.07, -0.12, 0.12);
    _look.set(
      _from.x + Math.sin(camLookYaw) * Math.cos(lookPitch) * 10,
      _from.y - Math.sin(lookPitch) * 10,
      _from.z + Math.cos(camLookYaw) * Math.cos(lookPitch) * 10,
    );
    camera.lookAt(_look);
    camera.rotateZ(-h.root.rotation.z * 0.85);
    targetFov = 75 + h.speed * 0.15;
  } else if (player.inHeli) {
    fpvRig.visible = false;
    const h = player.inHeli;
    if (gameTime - lastMouseT > 1.2) carYawOff *= Math.exp(-dt * 2.5);
    camYaw += angDiff(camYaw, h.h + carYawOff) * Math.min(1, dt * 3.5);
    yaw = camYaw;
    const dist = 13.5 + h.speed * 0.08;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    _from.set(h.x, h.y + 2.2, h.z);
    _to.set(h.x - fx * dist, Math.max(0.8, h.y + 4.8 + carPitchOff * 6), h.z - fz * dist);
    camera.position.copy(camCollide(_from, _to));
    _look.set(h.x + Math.sin(h.h) * 4.5, h.y + 1.6, h.z + Math.cos(h.h) * 4.5);
    camera.lookAt(_look);
    targetFov = 68 + h.speed * 0.2;
  } else if (fpv && !player.dead) {
    const w = WEAPONS[player.wpn];
    const scoped = !!w.scoped && mouseR && !dialog.open && !codexOpen;
    if (hud.scopeOverlay) hud.scopeOverlay.style.display = scoped ? 'block' : 'none';
    fpvRig.visible = !scoped;
    player.hm.g.visible = false;
    const aiming = mouseR && !dialog.open && !codexOpen;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const gy = groundH(player.x, player.z) + player.y - player.landSquash * 0.25;
    const bobY = (player.moving && !scoped) ? Math.sin(bobPhase) * 0.035 : 0;
    const bobX = (player.moving && !scoped) ? Math.cos(bobPhase * 0.5) * 0.015 : 0;
    camera.position.set(player.x, gy + 1.66 + bobY, player.z);
    _look.set(player.x + fx * cp * 10, gy + 1.66 + bobY - sp * 10, player.z + fz * cp * 10);
    camera.lookAt(_look);
    targetFov = scoped ? 26 : aiming ? 54 : 74;
    // 更新第一人称武器视图模型位置与动画（含呼吸微摆与步态8字晃动）
    const swayMul = aiming ? 0.25 : 1.0;
    const idleX = Math.sin(gameTime * 1.6) * 0.003 * swayMul;
    const idleY = Math.cos(gameTime * 3.2) * 0.0025 * swayMul;
    const tx = (aiming && !w.melee ? 0.06 : 0.24) + idleX;
    const ty = (aiming && !w.melee ? -0.17 : -0.22) - (player.reloadT > 0 ? 0.14 : 0) + idleY;
    const tz = (aiming && !w.melee ? -0.38 : -0.45) + recoilKick * 0.08 - (player.punchT > 0 ? Math.sin(player.punchT / 0.22 * Math.PI) * 0.25 : 0);
    fpvHolder.position.x = lerp(fpvHolder.position.x, tx + bobX, Math.min(1, dt * 16));
    fpvHolder.position.y = lerp(fpvHolder.position.y, ty + bobY * 0.4, Math.min(1, dt * 16));
    fpvHolder.position.z = lerp(fpvHolder.position.z, tz, Math.min(1, dt * 20));
    fpvHolder.rotation.x = lerp(fpvHolder.rotation.x, recoilKick * 0.25 - (player.reloadT > 0 ? 0.45 : 0), Math.min(1, dt * 18));
  } else {
    fpvRig.visible = false;
    const w = WEAPONS[player.wpn];
    const scoped = !inVehicle() && !player.dead && !dialog.open && !codexOpen && !!w.scoped && mouseR;
    if (hud.scopeOverlay) hud.scopeOverlay.style.display = scoped ? 'block' : 'none';
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const gy = groundH(player.x, player.z) + player.y - player.landSquash * 0.25;
    if (scoped) {
      player.hm.g.visible = false;
      camera.position.set(player.x, gy + 1.66, player.z);
      _look.set(player.x + fx * cp * 10, gy + 1.66 - sp * 10, player.z + fz * cp * 10);
      camera.lookAt(_look);
      targetFov = 26;
    } else {
      if (!inVehicle() && !player.dead) player.hm.g.visible = true;
      const aiming = mouseR && !player.dead;
      camDistCur = lerp(camDistCur, aiming ? 2.8 : 5.2, Math.min(1, dt * 10));
      camShCur = lerp(camShCur, aiming ? 0.85 : 0.55, Math.min(1, dt * 10));
      _from.set(player.x + rx * camShCur, gy + 1.65, player.z + rz * camShCur);
      _to.set(_from.x - fx * camDistCur * cp, _from.y + camDistCur * sp + 0.2, _from.z - fz * camDistCur * cp);
      camera.position.copy(camCollide(_from, _to));
      _look.set(_from.x + fx * cp * 10, _from.y - sp * 10 + 0.2, _from.z + fz * cp * 10);
      camera.lookAt(_look);
      targetFov = aiming ? 48 : 65;
    }
  }
  if (inVehicle() && hud.scopeOverlay) hud.scopeOverlay.style.display = 'none';
  if (shake > 0) {
    camera.position.x += rand(-1, 1) * shake * 0.3; camera.position.y += rand(-1, 1) * shake * 0.3;
    shake = Math.max(0, shake - dt * 2.5);
  }
  skyGroup.position.copy(camera.position);
  camera.near = fpv ? 0.15 : player.inHeli ? 0.6 : 0.25;
  camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 8));
  camera.updateProjectionMatrix();
}

/* ============================ 昼夜循环 ============================ */
const skyDay = new THREE.Color('#8fb8e0'), skyNight = new THREE.Color('#060a17'), skyDusk = new THREE.Color('#e0895a');
const skyTopDay = new THREE.Color('#255ec2'), skyTopNight = new THREE.Color('#040814'), skyTopDusk = new THREE.Color('#342a5c');
const skyMidDay = new THREE.Color('#66a6ea'), skyMidNight = new THREE.Color('#0b1428'), skyMidDusk = new THREE.Color('#b65b5e');
const skyHorDay = new THREE.Color('#c2e0f6'), skyHorNight = new THREE.Color('#132038'), skyHorDusk = new THREE.Color('#f0955a');
const cloudDayCol = new THREE.Color('#ffffff'), cloudNightCol = new THREE.Color('#3b4a68'), cloudDuskCol = new THREE.Color('#f7b58a');
const skyGodTop = new THREE.Color('#090c22'), skyGodMid = new THREE.Color('#271d48'), skyGodHor = new THREE.Color('#d89a42');
const _sunDir = new THREE.Vector3();
function updateDay(dt) {
  dayT = (dayT + dt / 360) % 1; // 6 分钟一天
  const ph = dayT * Math.PI * 2;
  const elev = -Math.cos(ph);
  const day = clamp(elev * 1.6 + 0.45, 0, 1);
  night = 1 - day;
  const dusk = Math.max(0, 1 - Math.abs(elev) * 3.4);
  sun.intensity = 0.12 + 2.3 * day;
  hemi.intensity = 0.3 + 0.75 * day;
  const sky = scene.background;
  sky.copy(skyNight).lerp(skyDay, day);
  sky.lerp(skyDusk, Math.max(0, 1 - Math.abs(elev) * 3.2) * 0.45);
  scene.fog.color.copy(sky);

  // 动态天空散射穹顶、太阳/月亮、星空与飘动云层（适配 16x16 版图）
  skyUniforms.uTopColor.value.copy(skyTopNight).lerp(skyTopDay, day).lerp(skyTopDusk, dusk * 0.6);
  skyUniforms.uMidColor.value.copy(skyMidNight).lerp(skyMidDay, day).lerp(skyMidDusk, dusk * 0.65);
  skyUniforms.uHorizonColor.value.copy(skyHorNight).lerp(skyHorDay, day).lerp(skyHorDusk, dusk * 0.72);
  if (god.skyBlend > 0.001) {
    skyUniforms.uTopColor.value.lerp(skyGodTop, god.skyBlend * 0.85);
    skyUniforms.uMidColor.value.lerp(skyGodMid, god.skyBlend * 0.75);
    skyUniforms.uHorizonColor.value.lerp(skyGodHor, god.skyBlend * 0.65);
  }
  _sunDir.set(Math.sin(ph), elev, 0.55).normalize();
  skyUniforms.uSunDir.value.copy(_sunDir);
  skyUniforms.uSunGlow.value = clamp(dusk * 0.9 + day * 0.45 + god.skyBlend * 0.55, 0.05, 1.2);
  sunDisc.position.copy(_sunDir).multiplyScalar(1450);
  sunDisc.visible = elev > -0.16;
  sunDiscMat.color.setRGB(1, 0.88 + 0.08 * day, 0.68 + 0.14 * day);
  moonDisc.position.copy(_sunDir).multiplyScalar(-1450);
  moonDisc.visible = elev < 0.16;
  starsMat.opacity = Math.max(clamp((night - 0.3) * 1.3, 0, 0.92), god.skyBlend * 0.85);
  cloudMat.color.copy(cloudNightCol).lerp(cloudDayCol, day).lerp(cloudDuskCol, dusk * 0.6);
  oceanMat.envMapIntensity = lerp(1.25, 0.35, night);
  updateClouds(dt);
  if (harborProps.lighthouseBeacon) harborProps.lighthouseBeacon.rotation.y += dt * 1.4;

  for (const m of buildingMats) m.emissiveIntensity = night * 1.1;
  for (const m of glassTowerMats) m.emissiveIntensity = 0.05 + night * 0.55;
  for (const m of curtainGlassMats) {
    m.emissiveIntensity = 0.06 + night * 1.15;
    m.envMapIntensity = lerp(1.85, 0.55, night);
  }
  for (const m of crownGlowMats) m.emissiveIntensity = 0.12 + night * 0.9;
  for (let i = 0; i < cantonBandMats.length; i++) {
    cantonBandMats[i].emissiveIntensity = 0.22 + night * (0.95 + 0.35 * Math.sin(gameTime * 1.8 - i * 0.7));
  }
  if (pearlSphereMat) pearlSphereMat.emissiveIntensity = 0.14 + night * (1.05 + 0.18 * Math.sin(gameTime * 2.2));
  if (pearlSpireMat) pearlSpireMat.emissiveIntensity = 0.18 + night * 0.85;
  lampMat.emissiveIntensity = night * 3;
  headMat.emissiveIntensity = 0.3 + night * 2.5;
  gaugeMat.emissiveIntensity = 0.55 + night * 1.1;
  tailMat.emissiveIntensity = 0.4 + night * 1.5;
  const P = playerAnchor();
  // 按阴影贴图纹素步长吸附平行光，抑制飞行/行驶时的阴影边缘抖动闪烁
  const snap = 210 / 1024;
  const sx = Math.round(P.x / snap) * snap;
  const sz = Math.round(P.z / snap) * snap;
  const py = player.inHeli ? Math.round(clamp(P.y, 0, 140) / 2) * 2 : 0;
  sun.position.set(sx + Math.sin(ph) * 90, py + 55 + Math.max(elev, 0.25) * 135, sz + 60);
  sun.target.position.set(sx, py, sz);
  // 夜间/手动车灯与直升机高空探照灯
  if (player.inCar && !player.inCar.wreck && headlightsOn && night > 0.15) {
    const c = player.inCar, fx = Math.sin(c.h), fz = Math.cos(c.h);
    headSpot.intensity = 65 * Math.max(night, 0.5);
    headSpot.position.set(c.x + fx * 2.3, c.ground + 1, c.z + fz * 2.3);
    headSpot.target.position.set(c.x + fx * 22, 0, c.z + fz * 22);
  } else if (player.inHeli && !player.inHeli.wreck && headlightsOn && night > 0.1) {
    const h = player.inHeli, fx = Math.sin(h.h), fz = Math.cos(h.h);
    headSpot.intensity = 95 * Math.max(night, 0.65);
    headSpot.position.set(h.x + fx * 2.8, h.y + 0.9, h.z + fz * 2.8);
    headSpot.target.position.set(h.x + fx * 34, Math.max(0, h.y - 24), h.z + fz * 34);
  } else headSpot.intensity = 0;
}

/* ============================ 刷新/回收 NPC ============================ */
function populate(dt) {
  const P = playerAnchor();
  trafficT -= dt;
  if (trafficT <= 0) {
    trafficT = 0.4;
    // 回收远处的车
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (c === player.inCar) continue;
      const d2 = dist2(c.x, c.z, P.x, P.z);
      if (d2 > 360 * 360 || (c.wreck && c.deadT > 25 && d2 > 90 * 90)) removeCar(c);
    }
    const traffic = cars.filter(c => !c.wreck && (c.driver === 'ai' || (c.driver === 'police' && stars === 0))).length;
    if (traffic < 24) spawnTraffic(Math.random() < 0.07, 95, 290);
    // 回收行人
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      const d2 = dist2(p.x, p.z, P.x, P.z);
      if (d2 > 160 * 160 || (p.state === 'dead' && p.deadT > 45)) removePed(p);
    }
    if (peds.filter(p => p.state !== 'dead').length < 38) spawnPed();
  }
  // 警察增援（带接警延迟、阶梯出警上限与更真实的远距增援）
  if (stars > 0 && !player.dead) {
    policeSpawnT -= dt;
    const desired = [0, 1, 2, 3, 4, 5][stars];
    const spawnCD = [0, 12, 9, 7.5, 6, 5][stars];
    const chasing = cars.filter(c => c.driver === 'police' && !c.wreck && c.hp > 0).length;
    if (chasing < desired && policeSpawnT <= 0) {
      policeSpawnT = spawnCD;
      spawnTraffic(true, 125, 240);
    }
  }
}

/* ============================ 通缉更新 ============================ */
function updateWanted(dt) {
  stars = heat <= 0 ? 0 : Math.min(5, Math.ceil(heat / 50 - 1e-6));
  if (prevStars === 0 && stars >= 1) {
    const P = playerAnchor();
    const nearbyCop = cars.some(c => c.police && c.driver === 'police' && !c.wreck && dist2(c.x, c.z, P.x, P.z) < 75 * 75);
    policeSpawnT = Math.max(policeSpawnT, nearbyCop ? 3.5 : 7.0);
    showMsg('📻 警方接到报警，巡逻警车正在调派途中…', 2.6);
  }
  prevStars = stars;
  if (stars > 0 && !player.dead && !godActive()) {
    const P = playerAnchor();
    const seen = !(player.inHeli && player.inHeli.y > 65) && cars.some(c => c.police && c.driver === 'police' && !c.wreck && dist2(c.x, c.z, P.x, P.z) < 75 * 75 && !segBlocked(c.x, c.z, P.x, P.z));
    if (seen) lostT = 0;
    else {
      lostT += dt * (player.buffs.humeHeat ? 1.4 : 1.0);
      if (lostT > 10) {
        heat = Math.max(0, (stars - 1) * 50); lostT = 0;
        if (heat === 0) showMsg('<b style="color:#7fdc6a">你摆脱了警察的追捕</b>', 3);
      }
    }
  }
}

/* ============================ HUD 绘制 ============================ */
function drawMinimap() {
  const W = 200, C = W / 2;
  const P = playerAnchor();
  mmg.save();
  mmg.clearRect(0, 0, W, W);
  mmg.beginPath(); mmg.arc(C, C, C, 0, Math.PI * 2); mmg.clip();
  mmg.fillStyle = '#153a5a'; mmg.fillRect(0, 0, W, W);
  mmg.translate(C, C);
  const rot = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));
  mmg.rotate(rot);
  const zoom = player.inHeli ? (0.78 + Math.max(0, 0.28 - player.inHeli.speed * 0.005)) : player.inCar ? (0.95 + Math.max(0, 0.40 - Math.abs(player.inCar.speed) * 0.009)) : 1.45;
  mmg.scale(zoom, zoom);
  mmg.translate(-mapX(P.x), -mapX(P.z));
  mmg.drawImage(mapCanvas, 0, 0);
  // 任务点、竞速后续路点与据点敌人
  if (gameMode === 'free' && mission.active) {
    if (mission.type.id === 'race') {
      for (let i = mission.step + 1; i < mission.checkpoints.length; i++) {
        mmg.fillStyle = 'rgba(168,85,247,0.6)';
        mmg.beginPath(); mmg.arc(mapX(mission.checkpoints[i].x), mapX(mission.checkpoints[i].z), 4.5 / zoom, 0, Math.PI * 2); mmg.fill();
      }
    }
    for (const me of mission.enemies) if (!me.dead) {
      mmg.fillStyle = '#ff4060'; mmg.beginPath(); mmg.arc(mapX(me.x), mapX(me.z), 4.8 / zoom, 0, Math.PI * 2); mmg.fill();
    }
    mmg.fillStyle = mission.type.id === 'intercept' ? '#ff3838' : mission.type.id === 'race' ? '#a855f7' : '#ffd400';
    mmg.beginPath(); mmg.arc(mapX(mission.x), mapX(mission.z), 6.2 / zoom, 0, Math.PI * 2); mmg.fill();
  }
  // 剧情 NPC (6人: R,V,T,E,C,D) 与敌人
  if (gameMode === 'free') {
    const tgtId = storyTargetId();
    for (const n of storyNpcs) {
      const isTgt = n.id === tgtId || (story.stage === 7 && (n.id === 'elena' || n.id === 'viktor' || n.id === 'bai'));
      mmg.fillStyle = isTgt ? '#ffd400' : '#38d9ff';
      mmg.beginPath(); mmg.arc(mapX(n.x), mapX(n.z), (isTgt ? 7.2 : 5.5) / zoom, 0, Math.PI * 2); mmg.fill();
      mmg.strokeStyle = '#000'; mmg.lineWidth = 1.2 / zoom; mmg.stroke();
      mmg.fillStyle = '#000'; mmg.font = `bold ${Math.max(8, Math.round(9 / zoom))}px sans-serif`;
      mmg.textAlign = 'center'; mmg.textBaseline = 'middle';
      mmg.fillText(n.mapTag, mapX(n.x), mapX(n.z));
    }
    for (const se of story.enemies) if (!se.dead) {
      mmg.fillStyle = '#c44dff'; mmg.beginPath(); mmg.arc(mapX(se.x), mapX(se.z), 5.2 / zoom, 0, Math.PI * 2); mmg.fill();
    }
  }
  // 哲学家 NPC 与市中心神临信标
  for (const ph of philo.list) {
    const met = philo.met.has(ph.id);
    mmg.fillStyle = met ? '#ffd400' : '#c084fc';
    mmg.beginPath(); mmg.arc(mapX(ph.x), mapX(ph.z), (met ? 4.5 : 6.8) / zoom, 0, Math.PI * 2); mmg.fill();
    mmg.strokeStyle = '#000'; mmg.lineWidth = 1.2 / zoom; mmg.stroke();
    if (!met) {
      mmg.fillStyle = '#fff'; mmg.font = `bold ${Math.max(8, Math.round(9.5 / zoom))}px sans-serif`;
      mmg.textAlign = 'center'; mmg.textBaseline = 'middle';
      mmg.fillText('Φ', mapX(ph.x), mapX(ph.z));
    }
  }
  if (god.stage === 'ready') {
    const pulse = 7.5 + Math.sin(gameTime * 6) * 1.8;
    mmg.fillStyle = '#ffe066';
    mmg.beginPath(); mmg.arc(mapX(GOD_POS.x), mapX(GOD_POS.z), pulse / zoom, 0, Math.PI * 2); mmg.fill();
    mmg.strokeStyle = '#fff'; mmg.lineWidth = 1.6 / zoom; mmg.stroke();
    mmg.fillStyle = '#111'; mmg.font = `bold ${Math.max(9, Math.round(10 / zoom))}px sans-serif`;
    mmg.textAlign = 'center'; mmg.textBaseline = 'middle';
    mmg.fillText('✦', mapX(GOD_POS.x), mapX(GOD_POS.z));
  }
  // 赏金目标点
  if (gameMode === 'bounty') {
    for (const bt of bounty.targets) if (!bt.dead) {
      mmg.fillStyle = '#ff2e3a'; mmg.beginPath(); mmg.arc(mapX(bt.x), mapX(bt.z), 5.5 / zoom, 0, Math.PI * 2); mmg.fill();
      mmg.strokeStyle = '#fff'; mmg.lineWidth = 1.2 / zoom; mmg.stroke();
    }
  }
  // 拾取物
  for (const pk of pickups) if (pk.active) {
    mmg.fillStyle = pk.type === 'cash' ? '#3bd16f' : pk.type === 'armor' ? '#3a90ff' : pk.type === 'ammo' ? '#ffd400' : '#ff3040';
    mmg.fillRect(mapX(pk.x) - 2, mapX(pk.z) - 2, 4, 4);
  }
  // 停机坪与直升机
  for (const hp of helipads) {
    mmg.strokeStyle = '#ffd400'; mmg.lineWidth = 1.6 / zoom;
    mmg.beginPath(); mmg.arc(mapX(hp.x), mapX(hp.z), 5.2 / zoom, 0, Math.PI * 2); mmg.stroke();
  }
  for (const h of helis) {
    if (h === player.inHeli || h.wreck) continue;
    mmg.fillStyle = '#38e8ff';
    mmg.beginPath(); mmg.arc(mapX(h.x), mapX(h.z), 6.2 / zoom, 0, Math.PI * 2); mmg.fill();
    mmg.strokeStyle = '#000'; mmg.lineWidth = 1.2 / zoom; mmg.stroke();
    mmg.fillStyle = '#04121c'; mmg.font = `bold ${Math.max(8, Math.round(9 / zoom))}px sans-serif`;
    mmg.textAlign = 'center'; mmg.textBaseline = 'middle';
    mmg.fillText('H', mapX(h.x), mapX(h.z));
  }
  // 车辆
  for (const c of cars) {
    if (c === player.inCar) continue;
    if (c.police && c.driver === 'police' && stars > 0) mmg.fillStyle = Math.floor(gameTime * 6) % 2 ? '#ff3030' : '#3070ff';
    else if (c.wreck) continue;
    else if (!c.driver) mmg.fillStyle = '#9ad'; else continue;
    mmg.beginPath(); mmg.arc(mapX(c.x), mapX(c.z), 3.5 / zoom, 0, Math.PI * 2); mmg.fill();
  }
  // 玩家箭头
  const h = player.inHeli ? player.inHeli.h : player.inCar ? player.inCar.h : player.h;
  mmg.translate(mapX(P.x), mapX(P.z));
  const ax = Math.sin(h), az = Math.cos(h), s = 8 / zoom;
  mmg.fillStyle = '#fff'; mmg.strokeStyle = '#000'; mmg.lineWidth = 1.5 / zoom;
  mmg.beginPath();
  mmg.moveTo(ax * s * 1.3, az * s * 1.3);
  mmg.lineTo(-ax * s * 0.7 + az * s * 0.8, -az * s * 0.7 - ax * s * 0.8);
  mmg.lineTo(-ax * s * 0.3, -az * s * 0.3);
  mmg.lineTo(-ax * s * 0.7 - az * s * 0.8, -az * s * 0.7 + ax * s * 0.8);
  mmg.closePath(); mmg.fill(); mmg.stroke();
  mmg.restore();
  // 任务/剧情/赏金方向（小地图边缘）
  let edgeTarget = null, edgeColor = '#ffd400';
  if (gameMode === 'free') {
    const aliveSe = story.enemies.find(e => !e.dead);
    const aliveMe = mission.active ? mission.enemies.find(e => !e.dead) : null;
    if (aliveSe) { edgeTarget = aliveSe; edgeColor = '#c44dff'; }
    else if (aliveMe) { edgeTarget = aliveMe; edgeColor = '#ff4060'; }
    else if (god.stage === 'ready') { edgeTarget = GOD_POS; edgeColor = '#ffd400'; }
    else if (mission.active) edgeTarget = mission;
    else {
      const tid = storyTargetId();
      if (tid) { edgeTarget = storyNpcs.find(n => n.id === tid); edgeColor = '#38d9ff'; }
    }
  } else if (gameMode === 'bounty') {
    let bestD = Infinity;
    for (const bt of bounty.targets) if (!bt.dead) {
      const d = dist2(bt.x, bt.z, P.x, P.z);
      if (d < bestD) { bestD = d; edgeTarget = bt; edgeColor = '#ff2e3a'; }
    }
  }
  if (edgeTarget) {
    const dx = edgeTarget.x - P.x, dz = edgeTarget.z - P.z;
    const px = dx * MS * zoom, pz = dz * MS * zoom;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    let sx = px * cr - pz * sr, sy = px * sr + pz * cr;
    const L = Math.hypot(sx, sy);
    if (L > C - 8) {
      sx = sx / L * (C - 8); sy = sy / L * (C - 8);
      mmg.fillStyle = edgeColor; mmg.beginPath(); mmg.arc(C + sx, C + sy, 6, 0, Math.PI * 2); mmg.fill();
      mmg.strokeStyle = '#000'; mmg.lineWidth = 1.5; mmg.stroke();
    }
  }
}
const phoneCost = p => (story.baiDiscount ? Math.round(p * 0.5) : p);
function renderCodex() {
  if (!hud.codexPanel) return;
  hud.codexPanel.style.display = codexOpen ? 'block' : 'none';
  if (!codexOpen) return;
  const cards = PHILOSOPHER_DEFS.map(def => {
    const unlocked = philo.met.has(def.id);
    const note = philo.notes.get(def.id);
    return `<div class="cx-card ${unlocked ? 'done' : ''}">
      <div style="font-weight:bold;color:${unlocked ? '#ffd400' : '#94a3b8'};margin-bottom:4px">${def.name} · ${def.mark}</div>
      ${unlocked && note
        ? `<div style="color:#b6f5e8;font-size:12px;margin-bottom:4px">${note.buff}</div><div style="opacity:.9">${note.note}</div>`
        : `<div style="opacity:.65">尚未论道（前往小地图紫色 <b>Φ</b> 标记寻找）</div>`}
    </div>`;
  }).join('');
  const endTag = story.ending === 'truth' ? '【黎明头版】' : story.ending === 'syndicate' ? '【暗夜教父】' : story.ending === 'ascend' ? '【霓虹飞升】' : '进行中';
  hud.codexPanel.innerHTML = `
    <h3><span>📖 自由城手记 · 哲思与主线 (${philo.met.size}/${philo.total})</span><span id="codexClose" style="cursor:pointer;font-size:13px;color:#ffd400;border:1px solid rgba(255,212,0,.45);padding:3px 10px;border-radius:6px">关闭 [J / Q]</span></h3>
    <h4>主线进程 · ${endTag}</h4>
    <div class="cx-card done" style="margin-bottom:8px">${storyHintText() || '自由探索全城中'} · 主线 NPC：罗曼(R) / 维克多(V) / 托尼(T) / 艾琳(E) / 陈船长(C) / 白博士(D)</div>
    <h4>战绩统计</h4>
    <div class="cx-card" style="margin-bottom:8px">击杀敌人：<b>${player.kills}</b>（爆头 <b>${player.headshots}</b>） · 支线完成：<b>${mission.done}</b> 次 · 当前连胜：<b>${mission.streak}</b> · 哲思状态：<b>${god.stage === 'transcended' ? '出神入化' : `${philo.met.size}/6`}</b></div>
    <h4>六贤哲思手记 & 永久加护</h4>
    <div class="cx-grid">${cards}</div>
  `;
}
function renderPhone() {
  hud.phone.style.display = phoneOpen ? 'block' : 'none';
  if (!phoneOpen) return;
  const hh = Math.floor(dayT * 24), mi = Math.floor((dayT * 24 - hh) * 60);
  hud.phTime.textContent = `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  const bribe = stars > 0 ? `$${phoneCost(stars * 200)}` : '无通缉';
  setHTML(hud.phList, 'phList', `
    <div class="ph-it" data-act="1"><span>1. 刷新支线任务</span><b>免费</b></div>
    <div class="ph-it" data-act="2"><span>2. 贿赂消星</span><b>${bribe}</b></div>
    <div class="ph-it" data-act="3"><span>3. 空降定制超跑</span><b>$${phoneCost(180)}</b></div>
    <div class="ph-it" data-act="4"><span>4. 补充全6类弹药</span><b>$${phoneCost(100)}</b></div>
    <div class="ph-it" data-act="5"><span>5. 呼叫救援直升机</span><b>$${phoneCost(200)}</b></div>
    <div class="ph-it" data-act="6"><span>6. ${god.stage === 'transcended' ? '✦ 重温神临时刻' : '✦ 直通神临时刻'}</span><b style="color:#ffd400">免费</b></div>
    <div class="ph-it" data-act="7"><span>7. 打开哲学与主线手记</span><b style="color:#38d9ff">J 键</b></div>
  `);
}
function phoneAction(n) {
  if (!phoneOpen || player.dead) return;
  if (n === 1) {
    clearMissionExtras(); mission.active = false; marker.visible = false; newMission(); phoneOpen = false;
  } else if (n === 2) {
    if (stars <= 0) { showMsg('当前没有通缉星级', 1.5); return; }
    const cost = phoneCost(stars * 200);
    if (player.money < cost) { showMsg(`金钱不足（需要 $${cost}）`, 2); return; }
    player.money -= cost; heat = 0; stars = 0; prevStars = 0; lostT = 0;
    showMsg(`花费 $${cost} 摆平了警察`, 2.5); sndPickup(); phoneOpen = false;
  } else if (n === 3) {
    const cost = phoneCost(180);
    if (player.money < cost) { showMsg(`金钱不足（需要 $${cost}）`, 2); return; }
    const P = playerAnchor();
    const x = P.x + Math.sin(yaw) * 7, z = P.z + Math.cos(yaw) * 7;
    if (pointInBuilding(x, 1, z, 1.5)) { showMsg('附近空间太窄，换个空旷位置', 2); return; }
    player.money -= cost;
    const c = spawnCar(x, z, yaw, { kind: 'hyper', driver: null });
    c.ai = null;
    showMsg('🏎️ 霓虹超跑已空降送达！按 Shift 触发氮气加速', 2.4); sndPickup(); phoneOpen = false;
  } else if (n === 4) {
    const cost = phoneCost(100);
    if (player.money < cost) { showMsg(`金钱不足（需要 $${cost}）`, 2); return; }
    player.money -= cost;
    player.ammos[1] += 51; player.ammos[2] += 96; player.ammos[3] += 24; player.ammos[4] += 90; player.ammos[5] += 15;
    showMsg('全 6 类武器弹药已补充！', 2); sndPickup(); phoneOpen = false;
  } else if (n === 5) {
    const cost = phoneCost(200);
    if (player.money < cost) { showMsg(`金钱不足（需要 $${cost}）`, 2); return; }
    const P = playerAnchor();
    let sx = null, sz = null;
    for (const dist of [11, 14, 8]) {
      for (const ang of [0, 0.6, -0.6, 1.3, -1.3, Math.PI]) {
        const tx = P.x + Math.sin(yaw + ang) * dist, tz = P.z + Math.cos(yaw + ang) * dist;
        if (Math.abs(tx) < EDGE - 4 && Math.abs(tz) < EDGE - 4 && !pointInBuilding(tx, 1, tz, 2.8)) {
          sx = tx; sz = tz; break;
        }
      }
      if (sx !== null) break;
    }
    if (sx === null) { showMsg('附近空间太窄，无法空降直升机', 2); return; }
    player.money -= cost;
    spawnHeli(sx, sz, yaw, { color: '#c62828', stripe: '#ffd43b' });
    showMsg('🚁 双机炮直升机已空降到前方！', 2.5); sndPickup(); phoneOpen = false;
  } else if (n === 6) {
    phoneOpen = false;
    triggerGodBackdoor();
  } else if (n === 7) {
    phoneOpen = false;
    codexOpen = true;
    renderCodex();
  }
}
function updateHUD(dt) {
  const P = playerAnchor();
  setHTML(hud.money, 'money', '$' + player.money.toLocaleString());
  const hh = Math.floor(dayT * 24), mi = Math.floor((dayT * 24 - hh) * 60);
  setHTML(hud.clock, 'clock', `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`);
  setHTML(hud.district, 'district', getDistrict(P.x, P.z));
  let st = '';
  for (let i = 0; i < 5; i++) st += `<span class="${i < stars ? 'on' : ''}">★</span>`;
  setHTML(hud.stars, 'stars', st);
  hud.stars.classList.toggle('flash', stars > 0 && lostT > 0.5 && Math.floor(gameTime * 3) % 2 === 0);
  const w = WEAPONS[player.wpn];
  setHTML(hud.weapon, 'weapon', inVehicle() ? (player.inHeli ? '🚁 20mm 双联机炮 · 左键射击' : '') : w.melee ? `${w.icon} ${w.name}` : player.reloadT > 0 ? `${w.icon} ${w.name} <span style="color:#ffd400">换弹中...</span>` : `${w.icon} ${w.name} ${player.clips[player.wpn]} / ${player.ammos[player.wpn]}`);
  if (hud.buffTags) {
    const activeBuffs = PHILOSOPHER_DEFS.filter(d => player.buffs[d.buffKey]).map(d => d.buffShort.split(' ')[0]);
    setHTML(hud.buffTags, 'buffTags', activeBuffs.length ? `✦ ${activeBuffs.join(' · ')}` : '');
  }
  if (hud.wpnBar) {
    if (inVehicle() || player.dead || codexOpen) {
      hud.wpnBar.style.display = 'none';
    } else {
      hud.wpnBar.style.display = 'flex';
      const slots = WEAPONS.map((wp, i) => `<div class="wpn-slot ${i === player.wpn ? 'active' : ''}">${i + 1} ${wp.icon}${wp.melee ? '' : ` ${player.clips[i]}`}</div>`).join('');
      setHTML(hud.wpnBar, 'wpnBar', slots);
    }
  }
  if (hud.storyHint) {
    const sh = gameMode === 'free' ? storyHintText() : '';
    hud.storyHint.style.display = sh ? 'block' : 'none';
    if (sh) setHTML(hud.storyHint, 'storyHint', sh);
  }
  hud.hp.style.width = clamp(player.hp / player.maxHp * 100, 0, 100) + '%';
  hud.hp.style.background = player.hp < 30 ? '#e53935' : '';
  hud.armor.style.width = clamp(player.armor / player.maxArmor * 100, 0, 100) + '%';
  if (hud.stamina) hud.stamina.style.width = clamp(player.stamina, 0, 100) + '%';

  const scoped = !inVehicle() && !player.dead && !dialog.open && !codexOpen && !!w.scoped && mouseR;
  hud.cross.style.display = inVehicle() || player.chute || player.dead || scoped || codexOpen ? 'none' : 'block';
  if (!inVehicle() && !player.chute && !player.dead && !scoped) {
    const gap = (mouseR ? -3 : 0) + bloom * 0.65;
    const ch = hud.cross.children;
    ch[0].style.transform = `translateY(${-gap}px)`;
    ch[1].style.transform = `translateY(${gap}px)`;
    ch[2].style.transform = `translateX(${-gap}px)`;
    ch[3].style.transform = `translateX(${gap}px)`;
  }
  if (hitmarkerT > 0) {
    hitmarkerT -= dt;
    hud.hitmarker.style.opacity = clamp(hitmarkerT / 0.14, 0, 1);
    hud.hitmarker.className = hitmarkerHead ? 'head' : '';
  } else hud.hitmarker.style.opacity = 0;
  if (killFeedT > 0 && hud.killFeed) {
    killFeedT -= dt;
    hud.killFeed.style.opacity = clamp(killFeedT / 0.35, 0, 1);
  }
  if (player.inCar) {
    const c = player.inCar;
    const hpPct = Math.max(0, Math.round(c.hp / c.maxHp * 100));
    const cname = CAR_TYPES[c.kind]?.name || '车辆';
    const gLabel = c.gear === -1 ? 'R' : c.gear === 0 ? 'N' : String(c.gear);
    const rpmPct = Math.round(clamp((c.rpm - 800) / 6300, 0, 1) * 100);
    const nPct = Math.round(clamp(c.nitro, 0, 100));
    setHTML(hud.speedo, 'speedo', `${Math.round(Math.abs(c.speed) * 3.6)} <small>km/h</small><span class="gear-badge ${c.shiftFlashT > 0 ? 'shift' : ''}">${gLabel}</span><div class="rpm-wrap"><div class="rpm-fill ${c.rpm > 5800 ? 'red' : ''}" style="width:${rpmPct}%"></div></div><div class="nitro-wrap"><div class="nitro-fill" style="width:${nPct}%"></div></div><small style="color:${c.nitroActive ? '#38f2ff' : hpPct < 35 ? '#ff6050' : '#ccc'}">${cname} · 车况 ${hpPct}% · Shift 氮气 ${nPct}% · V 视角</small>`);
  } else if (player.inHeli) {
    const h = player.inHeli;
    const hpPct = Math.max(0, Math.round(h.hp / h.maxHp * 100));
    const hSpd = Math.round(Math.hypot(h.vx, h.vz) * 3.6);
    const alt = Math.max(0, Math.round(h.y));
    const rpmPct = Math.round(clamp(h.rotorRpm, 0, 1) * 100);
    setHTML(hud.speedo, 'speedo', `${hSpd} <small>km/h</small><span class="gear-badge">ALT ${alt}m</span><div class="rpm-wrap"><div class="rpm-fill ${h.rotorRpm > 0.85 ? 'red' : ''}" style="width:${rpmPct}%"></div></div><small style="color:${hpPct < 35 ? '#ff6050' : '#ccc'}">直升机 · 机体 ${hpPct}% · 左键机炮 · V视角 · F跳伞</small>`);
  } else if (player.chute) {
    const alt = Math.max(0, Math.round(groundH(player.x, player.z) + player.y));
    setHTML(hud.speedo, 'speedo', `ALT ${alt}m <span class="gear-badge">☂ 滑翔</span><small style="color:#ffd400">WASD 控制方向</small>`);
  } else setHTML(hud.speedo, 'speedo', '');
  renderPhone();
  if (gameMode === 'bounty') {
    hud.mission.style.display = 'block';
    hud.mission.style.borderLeftColor = '#ff2e3a';
    const alive = bounty.targets.filter(t => !t.dead);
    let nearStr = '即将刷新下一波...';
    if (alive.length) {
      const minD = Math.min(...alive.map(t => Math.round(Math.sqrt(dist2(P.x, P.z, t.x, t.z)))));
      nearStr = `第 <b>${bounty.wave}</b> 波 · 剩余 <b style="color:#ff5c58">${alive.length}</b> 名 · 最近 <b>${minD}m</b>`;
    }
    setHTML(hud.mission, 'mission', `
      <b style="color:#ff4040">🎯 赏金猎人模式</b><br>
      ⏱ 存活时间：<b>${fmtTime(bounty.surviveTime)}</b> · 💀 击杀数：<b style="color:#ffd400">${bounty.kills}</b>（目标 ${bounty.targetKills}）<br>
      ${nearStr}<br>
      <span style="font-size:13px;opacity:.8">🏆 最佳：${fmtTime(Math.max(bounty.bestTime, bounty.surviveTime))} · ${Math.max(bounty.bestKills, bounty.kills)} 杀</span>
    `);
  } else if (mission.active) {
    hud.mission.style.display = 'block';
    hud.mission.style.borderLeftColor = '#ffd400';
    const d = Math.round(Math.sqrt(dist2(P.x, P.z, mission.x, mission.z)));
    const stTag = mission.streak > 0 ? ` <b style="color:#38d9ff">[连胜×${mission.streak}]</b>` : '';
    setHTML(hud.mission, 'mission', `<b style="color:#ffd400">【${mission.type.name}】</b>${stTag}${mission.subText || mission.type.text}<br>距离 ${d}m · 剩余 <b style="color:${mission.time < 15 ? '#ff5050' : '#fff'}">${Math.ceil(mission.time)}s</b> · 奖励 <b style="color:#7fdc6a">$${mission.reward}</b>`);
  } else hud.mission.style.display = 'none';
  if (hud.philoHud) {
    const pText = god.stage === 'transcended'
      ? '✦ 哲学境界：<b style="color:#ffd400">出神入化</b>（神本无相 · 6/6 · <b>J 手记</b>）'
      : (god.stage === 'ready' || godActive())
        ? '✦ <b style="color:#ffd400">神临已解锁！</b> 前往市中心金色光柱 (按 E)'
        : `🧠 哲思印记 <b>${philo.met.size}/${philo.total}</b> · 寻找紫色 <b style="color:#d8b4fe">Φ</b> 贤者 · <b>J</b> 手记`;
    setHTML(hud.philoHud, 'philoHud', pText);
  }
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) hud.msg.style.opacity = 0; }
  flashA = Math.max(0, flashA - dt * 1.5);
  hud.flash.style.opacity = Math.max(flashA, player.hp < 25 && !player.dead ? 0.25 + Math.sin(gameTime * 6) * 0.15 : 0);
  // 交互提示
  if (!player.dead && !dialog.open && !codexOpen && !godActive() && msgT <= 0) {
    const nearShrine = god.stage === 'ready' && dist2(GOD_POS.x, GOD_POS.z, player.x, player.z) < 15 * 15;
    if (inVehicle()) {
      if (nearShrine) { hud.msg.innerHTML = '按 <b>F</b> 下车/离机后，按 <b>E</b> 直面 <b style="color:#ffd400">市中心【神临】</b>'; hud.msg.style.opacity = 1; }
    } else {
      const py = groundH(player.x, player.z) + player.y;
      const nearSage = philo.list.find(ph => dist2(ph.x, ph.z, player.x, player.z) < 4.2 * 4.2 && player.y < 2.2);
      const nearNpc = storyNpcs.find(n => dist2(n.x, n.z, player.x, player.z) < 3.6 * 3.6 && player.y < 2.2);
      const nearHeli = helis.find(h => !h.wreck && Math.abs(h.y - py) < 3.5 && dist2(h.x, h.z, player.x, player.z) < 6.5 * 6.5);
      const near = player.y < 2.5 ? cars.find(c => !c.wreck && dist2(c.x, c.z, player.x, player.z) < 4.5 * 4.5) : null;
      if (nearShrine) { hud.msg.innerHTML = '按 <b>E</b> 直面 <b style="color:#ffd400">市中心【神临】</b>'; hud.msg.style.opacity = 1; }
      else if (nearSage) { hud.msg.innerHTML = `按 <b>E</b> 与哲学家 <b style="color:#e4b8ff">${nearSage.name}</b> 论道`; hud.msg.style.opacity = 1; }
      else if (nearNpc) { hud.msg.innerHTML = `按 <b>E</b> 与 <b>${nearNpc.name}</b> 对话`; hud.msg.style.opacity = 1; }
      else if (nearHeli) { hud.msg.innerHTML = '按 <b>F</b> 驾驶直升机'; hud.msg.style.opacity = 1; }
      else if (near) { hud.msg.innerHTML = near.driver ? '按 <b>F</b> 抢车' : '按 <b>F</b> 上车'; hud.msg.style.opacity = 1; }
      else hud.msg.style.opacity = 0;
    }
  }
  mmT -= dt;
  if (mmT <= 0) { mmT = running ? 0.05 : 0.1; drawMinimap(); }
}

/* ============================ 音频更新 ============================ */
function updateAudio() {
  if (!actx) return;
  const t = actx.currentTime;
  if (player.inCar && running) {
    const c = player.inCar;
    const r = clamp((c.rpm - 800) / 6300, 0, 1);
    const freq = 42 + r * 145 + (c.isHyper ? 34 : c.kind === 'sport' ? 22 : 0) + (c.nitroActive ? 24 : 0);
    const vol = c.shiftT > 0 ? 0.03 : c.nitroActive ? 0.11 : 0.08;
    engGain.gain.setTargetAtTime(vol, t, 0.05);
    engOsc.frequency.setTargetAtTime(freq, t, 0.04);
    if (engSubOsc) engSubOsc.frequency.setTargetAtTime(freq * 0.5, t, 0.04);
    engFilter.frequency.setTargetAtTime(280 + r * 680 + (c.nitroActive ? 260 : 0), t, 0.06);
    if (skidGain) {
      const skidding = !c.wreck && (c.drift > 3.5 || (c.braking && Math.abs(c.speed) > 9));
      skidGain.gain.setTargetAtTime(skidding ? clamp((c.drift + Math.abs(c.speed) * 0.15) * 0.008, 0.02, 0.085) : 0, t, 0.05);
    }
  } else {
    engGain.gain.setTargetAtTime(0, t, 0.1);
    if (skidGain) skidGain.gain.setTargetAtTime(0, t, 0.05);
  }
  let nearest = Infinity;
  const P = playerAnchor();
  if (stars > 0) for (const c of cars) if (c.police && c.driver === 'police' && !c.wreck) nearest = Math.min(nearest, Math.sqrt(dist2(c.x, c.z, P.x, P.z)));
  const sv = running && nearest < 150 ? 0.05 * (1 - nearest / 150) : 0;
  sirenGain.gain.setTargetAtTime(sv, t, 0.1);
  sirenOsc.frequency.setTargetAtTime(750 + Math.sin(gameTime * 4) * 280, t, 0.02);
  if (heliGain) {
    let bestVol = 0, bestRpm = 0;
    if (running) {
      const py = player.inHeli ? player.inHeli.y : groundH(player.x, player.z) + player.y;
      for (const h of helis) {
        if (h.wreck || h.rotorRpm < 0.03) continue;
        const d = h === player.inHeli ? 0 : Math.hypot(h.x - P.x, h.y - py, h.z - P.z);
        if (d > 120) continue;
        const att = h === player.inHeli ? 1 : (1 - d / 120);
        const vol = h.rotorRpm * 0.14 * att;
        if (vol > bestVol) { bestVol = vol; bestRpm = h.rotorRpm; }
      }
    }
    heliGain.gain.setTargetAtTime(bestVol, t, 0.08);
    heliLfo.frequency.setTargetAtTime(3 + bestRpm * 11.5, t, 0.06);
    heliFilter.frequency.setTargetAtTime(180 + bestRpm * 340, t, 0.08);
  }
}

/* ============================ 输入 ============================ */
hud.dlgChoices.addEventListener('click', e => {
  const opt = e.target.closest('.dlg-opt');
  if (opt && opt.dataset.idx !== undefined) chooseDialog(Number(opt.dataset.idx));
});
hud.phList.addEventListener('click', e => {
  const it = e.target.closest('.ph-it');
  if (it && it.dataset.act !== undefined) phoneAction(Number(it.dataset.act));
});
if (hud.codexPanel) {
  hud.codexPanel.addEventListener('click', e => {
    if (e.target.id === 'codexClose') { codexOpen = false; renderCodex(); }
  });
}
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!running || e.repeat) return;
  if (dialog.open) {
    if (e.code === 'KeyQ') { if (!dialog.isGod) closeDialog(); return; }
    if ((e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') && dialog.choices.length === 1) { chooseDialog(0); return; }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4') {
      chooseDialog(Number(e.code.slice(5)) - 1);
    }
    return;
  }
  if (e.code === 'KeyJ') {
    codexOpen = !codexOpen; phoneOpen = false; mouseL = mouseR = false;
    renderCodex();
    playTone(codexOpen ? 640 : 440, 0.05, 0.07, 'sine');
    return;
  }
  if (codexOpen) {
    if (e.code === 'KeyQ' || e.code === 'Escape') { codexOpen = false; renderCodex(); }
    return;
  }
  if (godActive()) return;
  if (e.code === 'Space' && !inVehicle() && !player.dead) player.jumpBuf = 0.14;
  if (e.code === 'KeyQ' && !inVehicle() && !player.dead) { startPlayerDodge(); return; }
  if (e.code === 'KeyE' && !inVehicle() && !player.dead && player.y < 2.2) {
    if (god.stage === 'ready' && dist2(GOD_POS.x, GOD_POS.z, player.x, player.z) < 15 * 15) { startTheophany(); return; }
    const nearSage = philo.list.find(ph => dist2(ph.x, ph.z, player.x, player.z) < 4.2 * 4.2);
    if (nearSage) { openPhilosopherDialog(nearSage); return; }
    const nearNpc = storyNpcs.find(n => dist2(n.x, n.z, player.x, player.z) < 3.6 * 3.6);
    if (nearNpc) { openDialog(nearNpc); return; }
  }
  if (e.code === 'KeyV') toggleFPV();
  if (e.code === 'KeyF' || e.code === 'Enter') toggleCar();
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyH') horn();
  if (e.code === 'KeyL' && inVehicle()) {
    headlightsOn = !headlightsOn;
    showMsg(headlightsOn ? (player.inHeli ? '探照灯已开启' : '车灯已开启') : (player.inHeli ? '探照灯已关闭' : '车灯已关闭'), 1);
  }
  if (e.code === 'KeyT') { phoneOpen = !phoneOpen; playTone(phoneOpen ? 700 : 480, 0.06, 0.08, 'sine'); }
  if (e.code >= 'Digit1' && e.code <= 'Digit7') {
    const n = Number(e.code.slice(5));
    if (phoneOpen) phoneAction(n);
    else if (!inVehicle() && n <= 6) switchWeapon(n - 1);
  }
});
document.addEventListener('wheel', e => {
  if (!running || dialog.open || codexOpen || inVehicle() || player.dead) return;
  switchWeapon(player.wpn + (e.deltaY > 0 ? 1 : -1));
}, { passive: true });
document.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('mousedown', e => {
  if (!running) { canvas.requestPointerLock(); return; }
  if (dialog.open || codexOpen) return;
  if (e.button === 0) mouseL = true;
  if (e.button === 2) mouseR = true;
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousemove', e => {
  if (!running || dialog.open || codexOpen) return;
  const mx = clamp(e.movementX, -150, 150), my = clamp(e.movementY, -150, 150);
  if (inVehicle()) {
    if (fpv) {
      carYawOff = clamp(carYawOff - mx * 0.0028, -1.45, 1.45);
      carPitchOff = clamp(carPitchOff + my * 0.0022, -0.35, 0.45);
    } else {
      carYawOff -= mx * 0.003;
    }
    lastMouseT = gameTime;
  } else {
    const scopedNow = !player.dead && !!WEAPONS[player.wpn].scoped && mouseR;
    const sens = scopedNow ? 0.00095 : 0.0024;
    yaw -= mx * sens; pitch = clamp(pitch + my * sens * 0.92, -0.6, 1.2);
  }
});
function startMode(mode) {
  initAudio();
  if (mode !== gameMode || !started) {
    gameMode = mode;
    if (mode === 'bounty') {
      clearMissionExtras(); mission.active = false; marker.visible = false;
      resetBountyRun();
      heat = 0; stars = 0; prevStars = 0; lostT = 0;
      showMsg('🎯 <b style="color:#ff4040">赏金猎人模式</b>：尽可能存活并消灭红点赏金目标！', 4.5);
    } else {
      clearBountyTargets();
      if (!started) showMsg('欢迎来到 <b style="color:#ffd400">卷心菜自由城 v1.01</b>！1-6换枪 / Q翻滚 / Shift氮气 / J手记 / 去翡翠港湾或找街头六贤论道！', 5.5);
      else showMsg('已切换至 <b style="color:#ffd400">自由模式</b>', 2);
    }
  }
  canvas.requestPointerLock();
}
document.addEventListener('pointerlockchange', () => {
  running = document.pointerLockElement === canvas;
  $('menu').style.display = running ? 'none' : 'flex';
  if (!running) {
    mouseL = mouseR = false; for (const k in keys) keys[k] = false;
    if (gameMode === 'bounty' && started) saveBountyBest();
  } else if (!started) {
    started = true;
  }
  $('startBtn').textContent = (started && gameMode === 'free') ? '继续自由模式' : '自由模式';
  $('bountyBtn').textContent = (started && gameMode === 'bounty') ? '🎯 继续赏金模式' : '🎯 赏金猎人模式';
});
$('startBtn').addEventListener('click', () => startMode('free'));
$('bountyBtn').addEventListener('click', () => startMode('bounty'));

/* ============================ 初始化 ============================ */
// 出生点旁边停放一辆极光超跑
{
  const c = spawnCar(roadC(MID) + LANE + 0.8, SPAWN.z + 2, Math.PI, { kind: 'hyper', color: '#00e5ff', driver: null });
  c.ai = null;
}
const HELI_LIVERIES = [
  { color: '#c62828', stripe: '#ffd43b' },
  { color: '#1565c0', stripe: '#f5f7fa' },
  { color: '#0f766e', stripe: '#fbbf24' },
  { color: '#6a1b9a', stripe: '#38d9ff' },
  { color: '#1e293b', stripe: '#ef4444' },
  { color: '#b45309', stripe: '#fef08a' },
];
helipads.forEach((hp, idx) => {
  if (idx < HELI_LIVERIES.length) spawnHeli(hp.x, hp.z, hp.rotY, HELI_LIVERIES[idx]);
});
for (let i = 0; i < 24; i++) spawnTraffic(Math.random() < 0.07, 25, 280);
for (let i = 0; i < 38; i++) spawnPed({ minD: 6 });
parks.forEach((p, i) => {
  spawnPickup('health', p.x - 4, p.z + 4, 50);
  if (i % 2 === 0) spawnPickup('armor', p.x + 4, p.z + 4, 100);
});
spawnPickup('ammo', SPAWN.x - 3, SPAWN.z - 2, 1);
initStoryNpcs();
initPhilosophers();
initGodRig();
loadCustomPlayerRole();
loadCityLandmarks();
player.hm.g.position.set(player.x, 0.25, player.z);
player.hm.g.rotation.y = player.h;

/* ============================ 主循环 ============================ */
const clock = new THREE.Clock();
let lodT = 0, mmT = 0;
function updateTrafficLights() {
  const cyc = gameTime % 24;
  trafficNSGreen = cyc < 12;
  trafficYellow = (cyc > 10 && cyc < 12) || cyc > 22;
  tlMatNS.color.set(trafficNSGreen ? (trafficYellow ? '#ffcc00' : '#20ff40') : '#ff2828');
  tlMatEW.color.set(!trafficNSGreen ? (trafficYellow ? '#ffcc00' : '#20ff40') : '#ff2828');
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (running) {
    gameTime += dt;
    updateTrafficLights();
    updateDay(dt);
    updatePlayer(dt);
    updateCars(dt);
    updateHelis(dt);
    updateCops(dt);
    updatePeds(dt);
    updateWanted(dt);
    populate(dt);
    updateMission(dt);
    updateBounty(dt);
    updateStory(dt);
    updatePhilosophers(dt);
    updateSmokeWisps(dt);
    updateGod(dt);
    updatePickups(dt);
    updateParticles(dt);
    updateTracers(dt);
    if ((lodT -= dt) <= 0) { lodT = 0.2; updateCityLOD(); }
  }
  updateCamera(running ? dt : 0);
  updateHUD(running ? dt : 0);
  updateAudio();
  renderer.render(scene, camera);
}
updateDay(0);
loop();
