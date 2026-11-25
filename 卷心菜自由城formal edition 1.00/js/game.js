// =====================================================================
//  自由城 LIBERTY MINI —— 基础类 GTA4 小游戏 (Three.js)
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
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/* ============================ 城市参数 ============================ */
const N = 12;                // 街区数量 N x N（扩展城市版图）
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('game').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fb8e0');
scene.fog = new THREE.Fog('#8fb8e0', 160, 920);

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

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.25, 1650);
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
  new THREE.SphereGeometry(1200, 32, 20),
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
const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(48, 16, 12), sunDiscMat);
sunDisc.renderOrder = 1;
sunDisc.frustumCulled = false;
const sunHaloMat = new THREE.MeshBasicMaterial({ color: '#ffcf78', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, fog: false });
const sunHalo = new THREE.Mesh(new THREE.SphereGeometry(88, 16, 12), sunHaloMat);
sunHalo.renderOrder = 1;
sunHalo.frustumCulled = false;
sunDisc.add(sunHalo);
skyGroup.add(sunDisc);

const moonDiscMat = new THREE.MeshBasicMaterial({ color: '#dce8ff', fog: false, depthTest: true, depthWrite: false });
const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(34, 16, 12), moonDiscMat);
moonDisc.renderOrder = 1;
moonDisc.frustumCulled = false;
skyGroup.add(moonDisc);

const starCount = 900;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const th = Math.random() * Math.PI * 2;
  const u = Math.random() * 0.94 + 0.05; // 上半球分布
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  starPos[i * 3] = Math.cos(th) * s * 1120;
  starPos[i * 3 + 1] = u * 1120;
  starPos[i * 3 + 2] = Math.sin(th) * s * 1120;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starsMat = new THREE.PointsMaterial({ color: '#eef4ff', size: 4.5, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthTest: true, depthWrite: false });
const starsMesh = new THREE.Points(starGeo, starsMat);
starsMesh.renderOrder = 1;
starsMesh.frustumCulled = false;
skyGroup.add(starsMesh);

// 高空 3D 积云群（绕城飘浮，直升机可在云层间穿行）
const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.88, fog: true });
const cloudPuffs = [];
for (let c = 0; c < 48; c++) {
  const cx = -750 + Math.random() * 1500;
  const cy = 160 + Math.random() * 75;
  const cz = -750 + Math.random() * 1500;
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
    if (cf.cx > 780) cf.cx -= 1560;
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
function groundH(x, z) {
  const j = Math.floor((x + HALF) / CELL), k = Math.floor((z + HALF) / CELL);
  if (j < 0 || k < 0 || j >= N || k >= N) return 0;
  const lx = x - blockMin(j), lz = z - blockMin(k);
  return (lx >= 0 && lx <= BLOCK && lz >= 0 && lz <= BLOCK) ? 0.25 : 0;
}

/* ============================ 生成城市 ============================ */
const parks = [];
const helipads = [];
const blockInfo = [];
const landmarkPlacements = [];
const LANDMARK_BLOCKS = {
  '6,5': { id: 'canton', rotY: 0,           colliderHalf: 11.5, h: 132.0, podium: 'plaza', helipad: [-16.5, 16.5, Math.PI * 0.75] }, // 市中心广州塔/小蛮腰（玩家出生正前方）
  '5,5': { id: 'pearl',  rotY: 0,           colliderHalf: 13.5, h: 102.5, podium: 'plaza', helipad: [16.5, 16.5, -Math.PI * 0.75] }, // 东方明珠
  '5,6': { id: 'swfc',   rotY: 0,           colliderHalf: 12.0, h: 118.0, podium: 'dark' }, // 上海环球金融中心
  '7,5': { id: 'jinmao', rotY: 0,           colliderHalf: 10.0, h: 104.0, podium: 'dark' }, // 金茂大厦
  '4,4': { id: 'jinmao', rotY: Math.PI / 2, colliderHalf: 10.0, h: 104.0, podium: 'dark' },
  '7,7': { id: 'swfc',   rotY: Math.PI / 2, colliderHalf: 12.0, h: 118.0, podium: 'dark' },
  '4,7': { id: 'jinmao', rotY: 0,           colliderHalf: 10.0, h: 104.0, podium: 'dark' },
  '8,3': { id: 'swfc',   rotY: 0,           colliderHalf: 12.0, h: 118.0, podium: 'plaza', helipad: [16.5, -16.5, -Math.PI * 0.25] }, // 北CBD环球金融中心+停机坪
  '3,8': { id: 'swfc',   rotY: Math.PI / 2, colliderHalf: 12.0, h: 118.0, podium: 'plaza', helipad: [-16.5, -16.5, Math.PI * 0.25] }, // 南CBD环球金融中心+停机坪
  '9,6': { id: 'jinmao', rotY: Math.PI / 2, colliderHalf: 10.0, h: 104.0, podium: 'dark' },
  '2,4': { id: 'jinmao', rotY: 0,           colliderHalf: 10.0, h: 104.0, podium: 'dark' },
};
const GUARANTEED_PARKS = new Set(['6,7', '4,6', '2,8', '9,3', '8,9']);
const setupInstanced = m => { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; return m; };
const fixStatic = m => { m.matrixAutoUpdate = false; m.updateMatrix(); return m; };
const oceanMat = new THREE.MeshStandardMaterial({ color: '#174870', roughness: 0.20, metalness: 0.32, envMap: cityEnvMap, envMapIntensity: 1.25 });
(function buildCity() {
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(6500, 6500), oceanMat);
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -0.35; ocean.receiveShadow = false; scene.add(fixStatic(ocean));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry((WALL + 34) * 2, (WALL + 34) * 2), grassMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.10; ground.receiveShadow = true; scene.add(fixStatic(ground));
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(WALL * 2, WALL * 2), sidewalkMat);
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.04; outer.receiveShadow = true; scene.add(fixStatic(outer));
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(EDGE * 2, EDGE * 2), asphaltMat);
  asphalt.rotation.x = -Math.PI / 2; asphalt.position.y = 0.01; asphalt.receiveShadow = true; scene.add(fixStatic(asphalt));

  // 外围墙
  const wallMat = mat('#77736b');
  for (const [x, z, w, d] of [[WALL + 1, 0, 2, WALL * 2 + 4], [-WALL - 1, 0, 2, WALL * 2 + 4], [0, WALL + 1, WALL * 2 + 4, 2], [0, -WALL - 1, WALL * 2 + 4, 2]]) {
    const m = new THREE.Mesh(boxGeo, wallMat); m.scale.set(w, 2.5, d); m.position.set(x, 1.25, z); m.castShadow = m.receiveShadow = true; scene.add(fixStatic(m));
  }
  addCollider({ x0: WALL, x1: WALL + 30, z0: -WALL - 30, z1: WALL + 30, h: 2.5 });
  addCollider({ x0: -WALL - 30, x1: -WALL, z0: -WALL - 30, z1: WALL + 30, h: 2.5 });
  addCollider({ x0: -WALL - 30, x1: WALL + 30, z0: WALL, z1: WALL + 30, h: 2.5 });
  addCollider({ x0: -WALL - 30, x1: WALL + 30, z0: -WALL - 30, z1: -WALL, h: 2.5 });

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

  // 按城市 4 象限与材质分桶合批所有建筑几何体，将 ~1400 次绘制降为 ~50 次
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
  const pedStep1Geo = new THREE.CylinderGeometry(2.6, 2.85, 0.45, 16);
  const pedStep2Geo = new THREE.CylinderGeometry(1.95, 2.15, 0.85, 16);
  const pedRingGeo = new THREE.CylinderGeometry(2.02, 2.02, 0.06, 16);
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
    const isSpawn = (j === 6 && k === 6);
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
    if (!isSpawn && (GUARANTEED_PARKS.has(key) || Math.random() < 0.05)) {
      info.park = true;
      parkGrasses.push([cx, 0.27, cz, BLOCK - 2 * M, 0.1, BLOCK - 2 * M]);
      pedStep1List.push([cx, 0.475, cz, 1, 1, 1]);
      pedStep2List.push([cx, 1.125, cz, 1, 1, 1]);
      pedRingList.push([cx, 1.56, cz, 1, 1, 1]);
      addCollider({ x0: cx - 2.35, x1: cx + 2.35, z0: cz - 2.35, z1: cz + 2.35, h: 6.8 });
      parks.push({ x: cx, z: cz, j, k, key });
      for (let t = 0; t < 12; t++) {
        const tx = rand(bx + M + 2, bx + BLOCK - M - 2), tz = rand(bz + M + 2, bz + BLOCK - M - 2);
        if (Math.hypot(tx - cx, tz - cz) < 4) continue;
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
      const h = rand(8, 18) + cf * cf * rand(15, 76);
      const isGlassTower = h > 34 && Math.random() < 0.55;
      const matPool = isGlassTower ? glassSkyscraperMats : buildingMats;
      const mIdx = Math.floor(Math.random() * matPool.length);
      const bm = matPool[mIdx];
      const sideKey = `${isGlassTower ? 'g' : 'b'}${mIdx}`;
      const q = (X + w / 2 >= 0 ? 2 : 0) + (Z + d / 2 >= 0 ? 1 : 0);
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

  // 停机坪标记（市中心与 CBD 广场角，各标层错开高度）
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
const MAPH = WALL + 30, MS = 1.0;
const mapCanvas = document.createElement('canvas');
mapCanvas.width = mapCanvas.height = Math.ceil(MAPH * 2 * MS);
const mapX = v => (v + MAPH) * MS;
(function renderMap() {
  const g = mapCanvas.getContext('2d');
  g.fillStyle = '#153a5a'; g.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  g.fillStyle = '#23422b'; g.fillRect(mapX(-WALL - 14), mapX(-WALL - 14), (WALL + 14) * 2 * MS, (WALL + 14) * 2 * MS);
  g.fillStyle = '#8d939c'; g.fillRect(mapX(-EDGE), mapX(-EDGE), EDGE * 2 * MS, EDGE * 2 * MS);
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
let actx = null, master, noiseBuf, engOsc, engGain, engFilter, sirenOsc, sirenGain;
let heliGain, heliModGain, heliLfo, heliFilter;
function initAudio() {
  if (actx) { actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    engOsc = actx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 50;
    engFilter = actx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 500;
    engGain = actx.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilter).connect(engGain).connect(master); engOsc.start();
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
function playNoise(dur, freq, vol) {
  if (!actx || vol <= 0.01) return;
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
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
const sndHit = (head = false) => { playTone(head ? 1350 : 900, 0.045, head ? 0.16 : 0.1, 'triangle'); };
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

const smokeWisps = [];
function spawnCyanSmoke(x, y, z, dur = 3.2, burst = true) {
  smokeWisps.push({ x, y, z, life: dur, age: 0, tick: 0, seed: Math.random() * Math.PI * 2 });
  if (burst) {
    const cols = ['#88ebd8', '#b2f5e8', '#65cbb9'];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2);
      const sp = rand(0.35, 0.85);
      emit(
        x + Math.cos(a) * 0.18, y + rand(0.0, 0.35), z + Math.sin(a) * 0.18,
        Math.cos(a) * sp, rand(1.1, 2.0), Math.sin(a) * sp,
        cols[i % cols.length], rand(0.16, 0.28), rand(1.0, 1.5), 0.22, 0.22
      );
    }
  }
}
function updateSmokeWisps(dt) {
  const cols = ['#88ebd8', '#b2f5e8', '#65cbb9'];
  for (let i = smokeWisps.length - 1; i >= 0; i--) {
    const w = smokeWisps[i];
    w.life -= dt;
    w.age += dt;
    w.tick -= dt;
    if (w.tick <= 0 && w.life > 0) {
      w.tick = 0.09;
      const a = w.age * 3.8 + w.seed;
      const r = 0.14 + w.age * 0.08;
      emit(
        w.x + Math.cos(a) * r, w.y + Math.min(w.age * 0.35, 1.0), w.z + Math.sin(a) * r,
        -Math.sin(a) * 0.22 + rand(-0.1, 0.1), rand(1.45, 2.05), Math.cos(a) * 0.22 + rand(-0.1, 0.1),
        cols[Math.floor(Math.random() * cols.length)], rand(0.13, 0.20), rand(1.6, 2.2), 0.26, 0.24
      );
    }
    if (w.life <= 0) smokeWisps.splice(i, 1);
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
function makeHuman(shirt, pants, skin = pick(SKINS), hair = pick(HAIRS)) {
  const g = new THREE.Group();
  // 躯干 + 胸肌层次 + 腰带 + 领口
  part(0.54, 0.62, 0.29, shirt, g, 0, 1.15, 0, true);
  part(0.46, 0.28, 0.04, shirt, g, 0, 1.28, 0.14); // 胸口层次
  part(0.56, 0.08, 0.31, '#1a1a1a', g, 0, 0.84, 0);
  part(0.1, 0.07, 0.03, '#c8a850', g, 0, 0.84, 0.16); // 皮带扣
  part(0.22, 0.09, 0.2, skin, g, 0, 1.49, 0);
  // 头部 + 耳朵 + 鼻梁 + 五官 + 立体发型
  part(0.29, 0.32, 0.29, skin, g, 0, 1.69, 0, true);
  part(0.05, 0.09, 0.06, skin, g, -0.15, 1.69, 0);
  part(0.05, 0.09, 0.06, skin, g, 0.15, 1.69, 0);
  part(0.04, 0.07, 0.05, skin, g, 0, 1.68, 0.15); // 鼻梁
  part(0.05, 0.035, 0.03, '#1b1b1b', g, -0.065, 1.72, 0.145);
  part(0.05, 0.035, 0.03, '#1b1b1b', g, 0.065, 1.72, 0.145);
  part(0.31, 0.11, 0.31, hair, g, 0, 1.87, -0.01);
  part(0.31, 0.17, 0.12, hair, g, 0, 1.75, -0.11);
  part(0.22, 0.05, 0.22, hair, g, 0, 1.93, 0); // 发顶层次
  const pivot = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); g.add(p); return p; };
  const legL = pivot(-0.14, 0.82), legR = pivot(0.14, 0.82), armL = pivot(-0.36, 1.42), armR = pivot(0.36, 1.42);
  // 肩部圆润 + 裤腿 + 膝盖/鞋袜层次
  part(0.18, 0.12, 0.21, shirt, armL, 0, -0.02, 0); part(0.18, 0.12, 0.21, shirt, armR, 0, -0.02, 0);
  part(0.21, 0.72, 0.24, pants, legL, 0, -0.36, 0, true); part(0.21, 0.72, 0.24, pants, legR, 0, -0.36, 0, true);
  part(0.22, 0.11, 0.33, '#1a1512', legL, 0, -0.76, 0.04, true); part(0.22, 0.11, 0.33, '#1a1512', legR, 0, -0.76, 0.04, true);
  // 手臂 + 袖口 + 手掌
  part(0.155, 0.54, 0.185, shirt, armL, 0, -0.28, 0); part(0.155, 0.54, 0.185, shirt, armR, 0, -0.28, 0);
  part(0.14, 0.13, 0.15, skin, armL, 0, -0.62, 0); part(0.14, 0.13, 0.15, skin, armR, 0, -0.62, 0);
  scene.add(g);
  return { g, legL, legR, armL, armR };
}
function animHuman(hm, phase, amt) {
  const s = Math.sin(phase) * amt;
  hm.legL.rotation.x = s * 0.8; hm.legR.rotation.x = -s * 0.8;
  hm.armL.rotation.x = -s * 0.6; hm.armR.rotation.x = s * 0.6;
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
    part(0.18, 0.14, 0.06, '#f4f6fa', torsoPivot, 0, 1.41, 0.15); // 领结/蕾丝领口
  }
  part(0.22, 0.09, 0.2, skin, torsoPivot, 0, 1.49, 0);

  // 可活动头部枢轴（支持低头沉思、仰望星空、点头反诘）
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.54, 0);
  torsoPivot.add(headPivot);
  part(0.29, 0.32, 0.29, skin, headPivot, 0, 0.15, 0, true);
  part(0.05, 0.09, 0.06, skin, headPivot, -0.15, 0.15, 0);
  part(0.05, 0.09, 0.06, skin, headPivot, 0.15, 0.15, 0);
  part(0.04, 0.07, 0.05, skin, headPivot, 0, 0.14, 0.15);
  part(0.05, 0.035, 0.03, '#1b1b1b', headPivot, -0.065, 0.18, 0.145);
  part(0.05, 0.035, 0.03, '#1b1b1b', headPivot, 0.065, 0.18, 0.145);

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
    part(0.26, 0.02, 0.02, '#c8a050', headPivot, 0, 0.42, -0.04); // 发簪
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

  // 哲学家专属手持/伴身法器道具
  const extras = {};
  if (cfg.prop === 'scroll') {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.38, 10), mat('#f2dfb8'));
    sc.rotation.z = 0.35; sc.position.set(0, -0.64, 0.12); armL.add(sc);
    part(0.06, 0.06, 0.06, '#d4af37', sc, 0, 0.20, 0); part(0.06, 0.06, 0.06, '#d4af37', sc, 0, -0.20, 0);
  } else if (cfg.prop === 'cup') {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.045, 0.11, 8), mat('#7a5230'));
    cup.position.set(0, -0.64, 0.11); armL.add(cup);
  } else if (cfg.prop === 'butterflies') {
    const bfs = [];
    const bfMat = new THREE.MeshBasicMaterial({ color: '#ffd966', side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const bf = new THREE.Group();
      const wL = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18), bfMat); wL.position.x = -0.07;
      const wR = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18), bfMat); wR.position.x = 0.07;
      bf.add(wL, wR);
      g.add(bf);
      bfs.push({ bf, wL, wR, off: i * Math.PI });
    }
    extras.butterflies = bfs;
  } else if (cfg.prop === 'crystal') {
    const cry = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      new THREE.MeshBasicMaterial({ color: '#60efff', wireframe: false, transparent: true, opacity: 0.88 })
    );
    cry.position.set(0, -0.60, 0.22);
    armL.add(cry);
    extras.crystal = cry;
  } else if (cfg.prop === 'watch') {
    const watch = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), mat('#e8c15a'));
    watch.rotation.x = Math.PI / 2; watch.position.set(0, -0.64, 0.11);
    armL.add(watch);
  } else if (cfg.prop === 'hammer') {
    const hg = new THREE.Group();
    hg.position.set(0, -0.62, 0.18);
    part(0.05, 0.05, 0.56, '#3b2416', hg, 0, 0, 0.14);
    const headMesh = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#ffca45' }));
    headMesh.scale.set(0.24, 0.14, 0.14); headMesh.position.set(0, 0, 0.42);
    hg.add(headMesh);
    armR.add(hg);
  }

  scene.add(g);
  return { g, torsoPivot, headPivot, legL, legR, armL, armR, extras };
}

function animPhilosopher(ph, t, talking) {
  const { sm, gesture } = ph;
  const { torsoPivot, headPivot, armL, armR, legL, legR, extras } = sm;
  const emp = talking ? 1.45 : 1.0;
  torsoPivot.rotation.set(0, 0, 0);
  headPivot.rotation.set(0, 0, 0);
  legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
  armL.rotation.set(0, 0, 0); armR.rotation.set(0, 0, 0);

  if (gesture === 'peripatetic') {
    // 亚里士多德：左手捧卷宗，右手指向大地论证经验实证，稳重踱步点头
    armL.rotation.set(-0.95, 0, -0.15);
    armR.rotation.set(-0.65 + Math.sin(t * 2.4) * 0.26 * emp, 0, -0.22);
    headPivot.rotation.x = 0.08 + Math.sin(t * 1.9) * 0.10 * emp;
    torsoPivot.rotation.y = Math.sin(t * 0.9) * 0.14;
  } else if (gesture === 'socratic') {
    // 苏格拉底：左手托腮沉思，右手反诘摊掌，歪头追问
    armL.rotation.set(-1.35 + Math.sin(t * 1.6) * 0.08, 0, 0.38);
    armR.rotation.set(-0.85 + Math.sin(t * 3.1) * 0.32 * emp, 0.25, -0.35 - Math.abs(Math.sin(t * 1.6)) * 0.25);
    headPivot.rotation.z = Math.sin(t * 1.4) * 0.18;
    headPivot.rotation.y = Math.sin(t * 2.1) * 0.16 * emp;
    torsoPivot.rotation.x = 0.06;
  } else if (gesture === 'butterfly') {
    // 庄子：广袖舒展舞动、仰望逍遥，金色蝴蝶环绕飞舞
    armL.rotation.set(-0.55 + Math.sin(t * 1.3) * 0.25 * emp, 0, 0.45 + Math.cos(t * 1.3) * 0.15);
    armR.rotation.set(-0.55 - Math.sin(t * 1.3) * 0.25 * emp, 0, -0.45 - Math.cos(t * 1.3) * 0.15);
    torsoPivot.rotation.y = Math.sin(t * 0.7) * 0.22;
    headPivot.rotation.x = -0.18 + Math.sin(t * 1.1) * 0.08;
    if (extras.butterflies) {
      for (const b of extras.butterflies) {
        const a = t * 1.8 + b.off;
        b.bf.position.set(Math.cos(a) * 0.78, 1.48 + Math.sin(a * 2.1) * 0.25, Math.sin(a) * 0.78);
        b.bf.rotation.y = -a + Math.PI / 2;
        const fl = Math.sin(t * 18 + b.off) * 0.75;
        b.wL.rotation.y = fl; b.wR.rotation.y = -fl;
      }
    }
  } else if (gesture === 'cogito') {
    // 笛卡尔：右手点眉沉思“我思”，左手捧起自旋几何晶体
    armL.rotation.set(-1.05, 0, -0.18);
    armR.rotation.set(-1.55 + Math.sin(t * 2.0) * 0.12 * emp, -0.25, 0.35);
    headPivot.rotation.x = 0.16 + Math.sin(t * 1.5) * 0.06;
    if (extras.crystal) {
      extras.crystal.rotation.y = t * 2.2;
      extras.crystal.rotation.x = t * 1.4;
    }
  } else if (gesture === 'starry') {
    // 康德：周期性看表守时 -> 随后右手肃穆指向高空星空、左手按胸、仰首赞叹道德律
    const cyc = (t * 0.45) % (Math.PI * 2);
    const gaze = Math.sin(cyc) > -0.2 ? 1 : 0;
    if (gaze) {
      armR.rotation.set(-2.35 + Math.sin(t * 1.8) * 0.10 * emp, 0, -0.20);
      armL.rotation.set(-1.15, 0, 0.42); // 按胸
      headPivot.rotation.x = -0.42; // 仰望星空
    } else {
      armL.rotation.set(-1.25, 0, 0.20); // 看怀表
      armR.rotation.set(-0.25, 0, -0.10);
      headPivot.rotation.x = 0.28;
    }
  } else if (gesture === 'hammer') {
    // 尼采：高擎“哲学之锤”昂首叩问偶像与天穹
    const swing = Math.sin(t * 2.7);
    armR.rotation.set(-1.85 + swing * 0.48 * emp, 0, -0.28);
    armL.rotation.set(-0.55 - swing * 0.18, 0, 0.28);
    headPivot.rotation.x = -0.22 + Math.sin(t * 1.6) * 0.08;
    torsoPivot.rotation.x = -0.07;
  }
}

/* ============================ 车辆模型 ============================ */
const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 16); wheelGeo.rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.295, 12); rimGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.31, 8); hubGeo.rotateZ(Math.PI / 2);
const pipeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 8); pipeGeo.rotateX(Math.PI / 2);
const steerRimGeo = new THREE.TorusGeometry(0.16, 0.022, 6, 18);
const knobGeo = new THREE.SphereGeometry(0.035, 8, 6);
const rimMat = new THREE.MeshStandardMaterial({ color: '#c8cdd4', roughness: 0.25, metalness: 0.85 });
const chromeMat = new THREE.MeshStandardMaterial({ color: '#d8dde2', roughness: 0.2, metalness: 0.9 });
const CAR_COLORS = ['#b71c1c', '#0d47a1', '#e0e0e0', '#212121', '#f9a825', '#2e7d32', '#6a1b9a', '#455a64', '#8d6e63', '#c62828', '#1565c0', '#9e9e9e', '#ff7043'];
const CAR_TYPES = {
  sedan:  { name: '轿车',   hp: 500, accel: 17, maxSpeed: 39, bodyH: 0.58, cabH: 0.46, cabZ: 1.9, wheelR: 0.38 },
  sport:  { name: '跑车',   hp: 460, accel: 25, maxSpeed: 54, bodyH: 0.46, cabH: 0.36, cabZ: 1.55, wheelR: 0.36, spoiler: true },
  suv:    { name: 'SUV',    hp: 680, accel: 15, maxSpeed: 36, bodyH: 0.72, cabH: 0.56, cabZ: 2.55, wheelR: 0.44, rack: true },
  taxi:   { name: '出租车', hp: 520, accel: 18, maxSpeed: 40, bodyH: 0.58, cabH: 0.46, cabZ: 1.9, wheelR: 0.38 },
  police: { name: '警车',   hp: 720, accel: 24, maxSpeed: 48, bodyH: 0.60, cabH: 0.46, cabZ: 1.9, wheelR: 0.38 },
};
function makeCarMesh(color, kind) {
  const cfg = CAR_TYPES[kind] || CAR_TYPES.sedan;
  const police = kind === 'police', taxi = kind === 'taxi';
  const g = new THREE.Group();
  const root = new THREE.Group(); // 用于悬挂俯仰/侧倾
  g.add(root);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.48 });
  const tlMat = new THREE.MeshStandardMaterial({ color: '#801010', emissive: '#ff2020', emissiveIntensity: 0.4 });
  const bodyY = 0.38 + cfg.bodyH / 2;
  const topY = bodyY + cfg.bodyH / 2;

  // 车身拆分：前舱 + 后备箱 + 中空座舱（地板 + 两侧车门），这样车里能放内饰
  const cabFront = -0.25 + cfg.cabZ / 2, cabBack = -0.25 - cfg.cabZ / 2, cabLen = cabFront - cabBack;
  const frontLen = 2.225 - cabFront, rearLen = cabBack + 2.225;
  const addBody = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(boxGeo, bodyMat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; root.add(m); return m; };
  addBody(2.0, cfg.bodyH, frontLen, 0, bodyY, cabFront + frontLen / 2);
  addBody(2.0, cfg.bodyH, rearLen, 0, bodyY, cabBack - rearLen / 2);
  addBody(0.08, cfg.bodyH, cabLen, 0.96, bodyY, -0.25);
  addBody(0.08, cfg.bodyH, cabLen, -0.96, bodyY, -0.25);
  const floorTop = 0.5;
  const floor = new THREE.Mesh(boxGeo, mat('#202126')); floor.scale.set(1.86, 0.12, cabLen); floor.position.set(0, floorTop - 0.06, -0.25); root.add(floor);
  const hood = new THREE.Mesh(boxGeo, bodyMat); hood.scale.set(1.88, 0.08, 1.35); hood.position.set(0, topY + 0.03, 1.45); root.add(hood);
  const trunk = new THREE.Mesh(boxGeo, bodyMat); trunk.scale.set(1.88, 0.06, 0.85); trunk.position.set(0, topY + 0.02, -1.7); root.add(trunk);

  // 流线座舱（倾斜前后挡风玻璃 + 侧窗 + 车顶）
  const cabY = topY + cfg.cabH / 2;
  const glass = new THREE.Mesh(boxGeo, glassMat); glass.scale.set(1.74, cfg.cabH, cfg.cabZ - 0.15); glass.position.set(0, cabY, -0.25); root.add(glass);
  const roofY = topY + cfg.cabH + 0.03;

  /* ---------- 车辆内饰（近距离才显示，节省性能） ---------- */
  const interior = new THREE.Group(); root.add(interior);
  const s = (roofY - floorTop) / 0.95; // 内饰比例（按座舱高度缩放）
  const seatCol = police ? '#1c1c20' : pick(['#3b2a20', '#25262b', '#5a4a3a', '#1f2a3a', '#4a1f1f']);
  const seatZ = cabFront - 0.95 * s;
  const ip = (w, h, d, col, x, y, z, parent = interior) => { const m = new THREE.Mesh(boxGeo, typeof col === 'string' ? mat(col) : col); m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m; };
  // 顶棚、仪表台、中控
  ip(1.66, 0.03, cfg.cabZ - 0.35, '#3d3d44', 0, roofY - 0.065, -0.25);
  ip(1.8, 0.26 * s, 0.36, '#1c1d21', 0, floorTop + 0.5 * s, cabFront - 0.18);
  ip(1.7, 0.03, 0.3, '#2a2b30', 0, floorTop + 0.64 * s, cabFront - 0.2);           // 仪表台面
  ip(0.5, 0.1 * s, 0.14, '#141416', 0.45, floorTop + 0.66 * s, cabFront - 0.33);    // 仪表罩
  ip(0.32, 0.16 * s, 0.03, '#0d0d10', 0, floorTop + 0.5 * s, cabFront - 0.37);     // 中控屏幕框
  ip(0.26, 0.11 * s, 0.01, gaugeMat, 0, floorTop + 0.51 * s, cabFront - 0.385);    // 中控屏幕
  ip(0.22, 0.14 * s, 0.75 * s, '#18181b', 0, floorTop + 0.07 * s, seatZ + 0.1);    // 中央扶手箱
  ip(0.25, 0.07, 0.02, '#111', 0, roofY - 0.12, cabFront - 0.1);                   // 车内后视镜
  for (const sx of [-1, 1]) {
    ip(0.05, 0.14 * s, cabLen * 0.72, '#23242a', sx * 0.9, floorTop + 0.36 * s, -0.25); // 车门内扶手饰板
  }
  // 仪表盘（转速表 + 时速表）+ 红区 + 指针
  const needles = [];
  for (const gx of [0.34, 0.56]) {
    ip(0.15, 0.12 * s, 0.01, gaugeMat, gx, floorTop + 0.62 * s, cabFront - 0.405);
    if (gx === 0.56) ip(0.03, 0.05 * s, 0.012, '#e53935', gx + 0.052, floorTop + 0.61 * s, cabFront - 0.408);
    const np = new THREE.Group(); np.position.set(gx, floorTop + 0.6 * s, cabFront - 0.413); interior.add(np);
    const nd = new THREE.Mesh(boxGeo, needleMat); nd.scale.set(0.008, 0.055 * s, 0.004); nd.position.y = 0.026 * s; np.add(nd);
    needles.push(np);
  }
  // 方向盘（可随转向转动）+ 12点回正红标 + 金属中心标 + 转向柱
  const swPivot = new THREE.Group(); swPivot.position.set(0.45, floorTop + 0.62 * s, seatZ + 0.5 * s); swPivot.rotation.x = 0.35; interior.add(swPivot);
  const steerWheel = new THREE.Group(); swPivot.add(steerWheel);
  const rim = new THREE.Mesh(steerRimGeo, mat('#121214')); rim.scale.setScalar(s); steerWheel.add(rim);
  ip(0.3 * s, 0.03, 0.02, '#1b1b1e', 0, 0, 0, steerWheel);
  ip(0.03, 0.15 * s, 0.02, '#1b1b1e', 0, -0.075 * s, 0, steerWheel);
  ip(0.08, 0.08, 0.03, '#2b2b30', 0, 0, 0.01, steerWheel); // 喇叭盖
  ip(0.028 * s, 0.028 * s, 0.034, '#ffd400', 0, 0, 0.012, steerWheel); // 方向盘中心金标
  ip(0.026 * s, 0.048 * s, 0.048 * s, '#ff2e3a', 0, 0.16 * s, 0, steerWheel); // 12点钟方向红色回正环
  ip(0.06, 0.06, 0.3, '#151517', 0.45, floorTop + 0.58 * s, seatZ + 0.66 * s);
  // 前排两张座椅（坐垫 + 靠背 + 头枕）
  for (const sx of [0.45, -0.45]) {
    ip(0.5, 0.13 * s, 0.5 * s, seatCol, sx, floorTop + 0.17 * s, seatZ);
    const back = ip(0.5, 0.6 * s, 0.12, seatCol, sx, floorTop + 0.52 * s, seatZ - 0.28 * s);
    back.rotation.x = -0.14;
    ip(0.28, 0.12 * s, 0.1, seatCol, sx, floorTop + 0.88 * s, seatZ - 0.33 * s);
  }
  // 后排长椅（座舱够长才放）
  if (cfg.cabZ >= 1.8) {
    ip(1.5, 0.13 * s, 0.45 * s, seatCol, 0, floorTop + 0.17 * s, cabBack + 0.4 * s);
    ip(1.5, 0.55 * s, 0.12, seatCol, 0, floorTop + 0.5 * s, cabBack + 0.14 * s).rotation.x = -0.12;
  }
  // 挡杆（H 档位会随档位移动）
  const gearLever = new THREE.Group(); gearLever.position.set(0, floorTop + 0.15 * s, seatZ + 0.42 * s); interior.add(gearLever);
  ip(0.025, 0.16 * s, 0.025, '#1c1c1c', 0, 0.08 * s, 0, gearLever);
  const knob = new THREE.Mesh(knobGeo, mat('#b8b8b8')); knob.position.y = 0.17 * s; gearLever.add(knob);
  // A 柱（挡风玻璃两侧）
  for (const sx of [-0.86, 0.86]) {
    const ap = ip(0.06, cfg.cabH * 1.15, 0.06, '#18181c', sx, cabY - 0.02, cabFront + 0.12, root);
    ap.rotation.x = -0.58;
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
  const eye = { x: 0.45, y: floorTop + 0.8 * s, z: seatZ - 0.02 };
  const roof = new THREE.Mesh(boxGeo, bodyMat); roof.scale.set(1.78, 0.09, cfg.cabZ - 0.25); roof.position.set(0, roofY, -0.25); roof.castShadow = true; root.add(roof);
  // 倾斜前挡风玻璃 & 后挡风玻璃
  const fGlass = new THREE.Mesh(boxGeo, glassMat);
  fGlass.scale.set(1.7, cfg.cabH * 1.15, 0.06);
  fGlass.position.set(0, cabY - 0.02, -0.25 + cfg.cabZ / 2 + 0.12);
  fGlass.rotation.x = -0.58; root.add(fGlass);
  const rGlass = new THREE.Mesh(boxGeo, glassMat);
  rGlass.scale.set(1.7, cfg.cabH * 1.12, 0.06);
  rGlass.position.set(0, cabY - 0.02, -0.25 - cfg.cabZ / 2 - 0.08);
  rGlass.rotation.x = kind === 'suv' ? 0.2 : 0.62; root.add(rGlass);

  // 左右后视镜 + 门把手 + A/B/C 柱框架
  for (const sx of [-1, 1]) {
    const mir = new THREE.Mesh(boxGeo, bodyMat); mir.scale.set(0.18, 0.11, 0.14); mir.position.set(sx * 1.06, topY + 0.14, 0.62); root.add(mir);
    // 门把手
    const h1 = new THREE.Mesh(boxGeo, chromeMat); h1.scale.set(0.05, 0.05, 0.16); h1.position.set(sx * 1.01, topY - 0.12, 0.15); root.add(h1);
    const h2 = new THREE.Mesh(boxGeo, chromeMat); h2.scale.set(0.05, 0.05, 0.16); h2.position.set(sx * 1.01, topY - 0.12, -0.75); root.add(h2);
    // B 柱
    const bPil = new THREE.Mesh(boxGeo, mat('#18181c')); bPil.scale.set(0.05, cfg.cabH + 0.02, 0.12); bPil.position.set(sx * 0.88, cabY, -0.25); root.add(bPil);
    // 轮眉（前后轮上方装饰护板）
    for (const wz of [1.42, -1.42]) {
      const arch = new THREE.Mesh(boxGeo, mat('#1b1c20')); arch.scale.set(0.08, 0.16, 0.82); arch.position.set(sx * 1.0, cfg.wheelR + 0.34, wz); root.add(arch);
    }
  }

  // 前脸：进气格栅、大灯、前后保险杠、车牌、排气管
  const grille = new THREE.Mesh(boxGeo, mat('#181818')); grille.scale.set(0.95, 0.24, 0.06); grille.position.set(0, bodyY - 0.02, 2.23); root.add(grille);
  const grilleBar = new THREE.Mesh(boxGeo, chromeMat); grilleBar.scale.set(0.9, 0.04, 0.07); grilleBar.position.set(0, bodyY, 2.24); root.add(grilleBar);
  const plateF = new THREE.Mesh(boxGeo, mat('#e8e8e0')); plateF.scale.set(0.45, 0.14, 0.04); plateF.position.set(0, 0.46, 2.27); root.add(plateF);
  const plateR = new THREE.Mesh(boxGeo, mat('#e8e8e0')); plateR.scale.set(0.45, 0.14, 0.04); plateR.position.set(0, bodyY - 0.04, -2.24); root.add(plateR);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(boxGeo, headMat); hl.scale.set(0.42, 0.16, 0.06); hl.position.set(sx * 0.68, bodyY + 0.06, 2.23); root.add(hl);
    const tl = new THREE.Mesh(boxGeo, tlMat); tl.scale.set(0.44, 0.15, 0.06); tl.position.set(sx * 0.66, bodyY + 0.08, -2.23); root.add(tl);
    const pipe = new THREE.Mesh(pipeGeo, chromeMat); pipe.position.set(sx * 0.62, 0.36, -2.25); root.add(pipe);
  }
  const bumper = new THREE.Mesh(boxGeo, mat('#1f1f22')); bumper.scale.set(2.05, 0.18, 4.55); bumper.position.y = 0.42; root.add(bumper);

  // 跑车：进气口 + 双层尾翼
  if (cfg.spoiler) {
    const intake = new THREE.Mesh(boxGeo, mat('#151515')); intake.scale.set(0.6, 0.06, 0.45); intake.position.set(0, topY + 0.07, 1.35); root.add(intake);
    const sp = new THREE.Mesh(boxGeo, bodyMat); sp.scale.set(1.9, 0.07, 0.34); sp.position.set(0, topY + 0.26, -2.02); root.add(sp);
    for (const sx of [-0.65, 0.65]) {
      const leg = new THREE.Mesh(boxGeo, mat('#1b1b1b')); leg.scale.set(0.08, 0.24, 0.2); leg.position.set(sx, topY + 0.14, -2.02); root.add(leg);
    }
  }
  // SUV：车顶行李架 + 后挂备胎
  if (cfg.rack) {
    for (const sx of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(boxGeo, mat('#222')); rail.scale.set(0.07, 0.08, 2.1); rail.position.set(sx, roofY + 0.08, -0.25); root.add(rail);
    }
    const spare = new THREE.Mesh(wheelGeo, tireMat); spare.rotation.y = Math.PI / 2; spare.scale.set(0.85, 0.9, 0.9); spare.position.set(0, bodyY + 0.12, -2.3); root.add(spare);
    const spareRim = new THREE.Mesh(rimGeo, rimMat); spareRim.rotation.y = Math.PI / 2; spareRim.scale.set(0.85, 0.9, 0.9); spareRim.position.copy(spare.position); root.add(spareRim);
  }

  // 车轮 + 金属轮毂 + 轮轴盖
  const wheels = [], pivots = [];
  const ws = cfg.wheelR / 0.38;
  for (const [x, z] of [[-1.01, 1.42], [1.01, 1.42], [-1.01, -1.42], [1.01, -1.42]]) {
    const p = new THREE.Group(); p.position.set(x, cfg.wheelR, z); g.add(p);
    const w = new THREE.Mesh(wheelGeo, tireMat); w.scale.set(1, ws, ws); p.add(w);
    const rim = new THREE.Mesh(rimGeo, rimMat); rim.scale.set(1, ws, ws); w.add(rim);
    const hub = new THREE.Mesh(hubGeo, mat('#222')); hub.scale.set(1, ws, ws); w.add(hub);
    wheels.push(w); pivots.push(p);
  }

  let lightR = null, lightB = null;
  if (police) {
    for (const sx of [-1.005, 1.005]) { const stripe = new THREE.Mesh(boxGeo, mat('#f2f2f2')); stripe.scale.set(0.03, 0.26, 2.45); stripe.position.set(sx, bodyY + 0.04, -0.1); root.add(stripe); }
    // 前防撞牛栏杆
    const pushBar = new THREE.Mesh(boxGeo, mat('#161618')); pushBar.scale.set(1.05, 0.34, 0.14); pushBar.position.set(0, 0.56, 2.31); root.add(pushBar);
    // 警灯支架
    const barMid = new THREE.Mesh(boxGeo, mat('#d8dde2')); barMid.scale.set(0.32, 0.16, 0.28); barMid.position.set(0, roofY + 0.12, -0.25); root.add(barMid);
    lightR = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#550000' })); lightR.scale.set(0.55, 0.16, 0.28); lightR.position.set(-0.44, roofY + 0.12, -0.25); root.add(lightR);
    lightB = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: '#000055' })); lightB.scale.set(0.55, 0.16, 0.28); lightB.position.set(0.44, roofY + 0.12, -0.25); root.add(lightB);
  }
  if (taxi) {
    const sign = new THREE.Mesh(boxGeo, mat('#fff3b0')); sign.scale.set(0.76, 0.22, 0.32); sign.position.set(0, roofY + 0.15, -0.25); root.add(sign);
    for (const sx of [-1.005, 1.005]) { const band = new THREE.Mesh(boxGeo, mat('#1c1c1c')); band.scale.set(0.03, 0.09, 2.2); band.position.set(sx, bodyY + 0.12, -0.1); root.add(band); }
  }
  scene.add(g);
  return { g, root, bodyMat, tlMat, wheels, pivots, lightR, lightB, interior, drv, drvTorso, steerWheel, needles, gearLever, eye };
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
    mainRotor, tailRotor, rotorDiscMat, navL, navR, strobe,
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
    hp: 900, maxHp: 900,
    pilot: null, wreck: false, smokeT: 0, burnT: 0,
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

function updateHelis(dt) {
  const P = playerAnchor();
  for (const h of helis) {
    const active = h.pilot === 'player' && !h.wreck && !player.dead;
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

/* ============================ 武器定义 ============================ */
const WEAPONS = [
  { id: 'fist',    name: '拳头',   icon: '👊', melee: true,  cd: 0.36, dmg: 38, headDmg: 55,  clipMax: 0,  spread: 0,     pellets: 1, reload: 0,   shake: 0.05, recoil: 0,     kick: 0,    heat: 20 },
  { id: 'pistol',  name: '手枪',   icon: '🔫', melee: false, cd: 0.21, dmg: 45, headDmg: 105, clipMax: 17, spread: 0.012, pellets: 1, reload: 1.1, shake: 0.07, recoil: 0.022, kick: 0.35, heat: 30 },
  { id: 'smg',     name: '冲锋枪', icon: '⚡', melee: false, cd: 0.085,dmg: 25, headDmg: 68,  clipMax: 30, spread: 0.028, pellets: 1, reload: 1.4, shake: 0.05, recoil: 0.015, kick: 0.25, heat: 25 },
  { id: 'shotgun', name: '霰弹枪', icon: '💥', melee: false, cd: 0.72, dmg: 26, headDmg: 48,  clipMax: 8,  spread: 0.058, pellets: 6, reload: 1.7, shake: 0.24, recoil: 0.065, kick: 0.65, heat: 40 },
];

/* ============================ 游戏状态 ============================ */
const cars = [], peds = [], pickups = [];
const SPAWN = { x: roadC(6) + ROAD / 2 + 1.8, z: roadC(6) + ROAD / 2 + 12 };
const player = {
  x: SPAWN.x, z: SPAWN.z, y: 0, vy: 0, h: Math.PI, hp: 100, armor: 50, money: 300,
  wpn: 1,
  clips: [0, 17, 30, 8],
  ammos: [0, 136, 180, 32],
  reloadT: 0, fireCD: 0, punchT: 0, laughT: 0, inCar: null, inHeli: null, chute: false, phase: 0, moving: false,
  dead: false, deadT: 0, deadKind: '', lastShot: -10, bustT: 0, fall: 0, hm: null,
};
const inVehicle = () => !!(player.inCar || player.inHeli);
const playerAnchor = () => player.inHeli || player.inCar || player;
let yaw = Math.PI, pitch = 0.22, camYaw = Math.PI, carYawOff = 0, lastMouseT = 0, shake = 0;
let fpv = false, carPitchOff = 0, bobPhase = 0;
let recoilPitch = 0, recoilKick = 0, bloom = 0, hitmarkerT = 0, hitmarkerHead = false, camDistCur = 5.2, camShCur = 0.55;
let heat = 0, stars = 0, lostT = 0, policeSpawnT = 0, trafficT = 0;
let gameTime = 0, dayT = 0.375, night = 0;
let running = false, started = false, phoneOpen = false, headlightsOn = true;
let mouseL = false, mouseR = false;
const keys = {};

// 玩家模型（带精细化可切换武器模型 + 高空跳伞包伞衣）
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
const wpnMeshes = [];
{
  const pPistol = new THREE.Group();
  part(0.06, 0.12, 0.08, '#1a1a1a', pPistol, 0, 0, 0);
  part(0.06, 0.24, 0.07, '#2c2f36', pPistol, 0, -0.14, 0.04);
  pPistol.position.set(0, -0.66, 0.03); player.hm.armR.add(pPistol);

  const pSmg = new THREE.Group();
  part(0.08, 0.3, 0.12, '#1f2126', pSmg, 0, -0.12, 0.05);
  part(0.05, 0.18, 0.06, '#141414', pSmg, 0, -0.18, 0.14); // 弹匣
  part(0.04, 0.16, 0.04, '#333', pSmg, 0, -0.32, 0.05);   // 枪管
  pSmg.position.set(0, -0.66, 0.03); player.hm.armR.add(pSmg);

  const pShotgun = new THREE.Group();
  part(0.08, 0.24, 0.1, '#5a3821', pShotgun, 0, 0.02, 0.01);  // 木质枪托
  part(0.08, 0.22, 0.11, '#25272b', pShotgun, 0, -0.14, 0.03); // 机匣
  part(0.05, 0.42, 0.05, '#1c1d20', pShotgun, 0, -0.4, 0.05);  // 长枪管
  part(0.07, 0.2, 0.07, '#5a3821', pShotgun, 0, -0.34, 0.02);  // 护木
  pShotgun.position.set(0, -0.66, 0.03); player.hm.armR.add(pShotgun);

  wpnMeshes.push(null, pPistol, pSmg, pShotgun);
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
  0: new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.35, metalness: 0.10 }), // 亮黄主体
  1: new THREE.MeshStandardMaterial({ color: '#ffea7c', roughness: 0.36, metalness: 0.08 }), // 淡黄肚皮与额纹
  2: new THREE.MeshStandardMaterial({ color: '#121216', roughness: 0.16, metalness: 0.18 }), // 眯眼与大笑口腔
  3: new THREE.MeshStandardMaterial({ color: '#4e3926', roughness: 0.45, metalness: 0.06 }), // 深棕手掌与脚趾
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

// 鲸鱼娘专属动作：平滑过渡 + 步态/呼吸/发丝与鲸尾的跟随摆动（解决新模型套用旧动作的僵硬感）
function animWhaleRig(rig, phase, amtIn, opts) {
  const { torso, head, legL, legR, armL, armR, tail, hairBack, tailTip } = rig.bones;
  const st = rig.st || (rig.st = { amt: 0, air: 0, aim: 0, punch: 0, sprint: 0, hx: 0, hz: 0, ty: 0, tipY: 0, hx0: 0 });
  st.amt += (amtIn - st.amt) * 0.2;
  st.air += ((opts.air ? 1 : 0) - st.air) * 0.25;
  st.aim += ((opts.aiming ? 1 : 0) - st.aim) * 0.22;
  st.punch += ((opts.punch ? 1 : 0) - st.punch) * 0.35;
  st.sprint += ((opts.sprint ? 1 : 0) - st.sprint) * 0.15;
  const w = clamp(st.amt, 0, 1.3);
  const grounded = 1 - st.air;
  const idle = clamp(1 - w * 1.6, 0, 1);
  const s = Math.sin(phase), c = Math.cos(phase);
  const t = gameTime;

  // 腿：髋部摆动 + 外展，空中收腿
  const stride = 0.5 * Math.min(w, 1.15) * grounded;
  legL.rotation.x = s * stride - 0.42 * st.air;
  legR.rotation.x = -s * stride + 0.32 * st.air;
  legL.rotation.z = Math.max(0, c) * 0.07 * w * grounded + 0.05 * st.air;
  legR.rotation.z = -Math.max(0, -c) * 0.07 * w * grounded - 0.05 * st.air;

  // 躯干：起伏、左右摇摆、扭转与前倾（待机呼吸）
  const bob = Math.abs(Math.sin(phase)) * 0.034 * w * grounded;
  torso.position.y = rig.torsoY + bob + Math.sin(t * 2.3) * 0.004 * idle + 0.035 * st.air;
  torso.rotation.y = -s * 0.1 * w + Math.sin(t * 0.8) * 0.02 * idle;
  torso.rotation.z = s * 0.05 * w + Math.sin(t * 1.4) * 0.012 * idle;
  const lean = 0.04 * w + 0.11 * st.sprint + 0.12 * st.punch - 0.05 * st.air;
  torso.rotation.x = lean;

  // 头：反向稳定 + 轻点头 + 待机环顾
  head.rotation.y = s * 0.075 * w + Math.sin(t * 0.7) * 0.07 * idle;
  head.rotation.x = -lean * 0.6 + Math.sin(phase * 2) * 0.028 * w + Math.sin(t * 1.9) * 0.02 * idle;
  head.rotation.z = -s * 0.035 * w + Math.sin(t * 1.1 + 0.6) * 0.025 * idle;

  // 手臂：自然摆动；持枪瞄准时左臂（持枪侧）抬起、另一只手辅助托枪
  const swing = 0.46 * Math.min(w, 1.15) * grounded;
  const pitchAim = opts.pitch || 0;
  const recoil = opts.recoil || 0;
  let lX = -s * swing - 0.3 * st.air;
  let rX = s * swing - 0.3 * st.air;
  lX = lerp(lX, -1.15 + pitchAim * 0.55 - recoil * 0.35, st.aim);
  rX = lerp(rX, -0.95 + pitchAim * 0.4 - recoil * 0.2, st.aim * 0.85);
  lX = lerp(lX, -1.45, st.punch);
  armL.rotation.x = lX;
  armR.rotation.x = rX;
  armL.rotation.z = 0.05 + 0.04 * w + 0.35 * st.air - 0.1 * st.aim;
  armR.rotation.z = -(0.05 + 0.04 * w + 0.35 * st.air - 0.15 * st.aim);

  // 长发：滞后跟随（奔跑向后飘 + 起伏 + 待机微摆）
  const hxT = 0.09 * w + 0.08 * st.sprint + 0.22 * st.air + Math.sin(phase * 2 - 0.9) * 0.07 * w + Math.sin(t * 1.7) * 0.03 * idle;
  const hzT = Math.sin(phase - 0.6) * 0.07 * w + Math.sin(t * 1.3 + 1.0) * 0.025 * idle;
  st.hx += (hxT - st.hx) * 0.16;
  st.hz += (hzT - st.hz) * 0.16;
  hairBack.rotation.x = st.hx;
  hairBack.rotation.z = st.hz;
  hairBack.rotation.y = -s * 0.04 * w;

  // 鲸尾：两段式甩尾
  const tyT = Math.sin(phase - 0.7) * 0.3 * w + Math.sin(t * 2.2) * 0.2 * idle;
  st.ty += (tyT - st.ty) * 0.3;
  tail.rotation.y = st.ty;
  tail.rotation.x = 0.06 + Math.cos(phase * 2) * 0.06 * w - 0.22 * st.air;
  const tipT = Math.sin(phase - 1.6) * 0.36 * w + Math.sin(t * 2.2 - 1.1) * 0.24 * idle;
  st.tipY += (tipT - st.tipY) * 0.25;
  tailTip.rotation.y = st.tipY;
  tailTip.rotation.x = Math.cos(phase * 2 - 1.0) * 0.12 * w;
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
  const p = rig.kind === 'naiwa' ? phase * 1.15 : phase;
  const s = Math.sin(p) * amt;
  const c = Math.cos(p) * amt;
  const idle = amt <= 0.05;
  const legAmp = rig.kind === 'whale' ? 0.52 : rig.kind === 'naiwa' ? 0.68 : 0.58;
  const armSwing = rig.kind === 'whale' ? 0.42 : 0.55;

  // 双腿交替迈步 + 抬脚外展
  legL.rotation.x = opts.air ? -0.4 : s * legAmp;
  legR.rotation.x = opts.air ? 0.35 : -s * legAmp;
  legL.rotation.z = opts.air ? 0.08 : Math.max(0, c) * 0.1 * amt;
  legR.rotation.z = opts.air ? -0.08 : -Math.max(0, -c) * 0.1 * amt;

  // 双臂摆动 / 逃跑 / 瞄准 / 挥拳
  if (opts.flee) {
    armL.rotation.x = -1.1 + s * 0.4; armR.rotation.x = -1.1 - s * 0.4;
    armL.rotation.z = 0.45; armR.rotation.z = -0.45;
  } else {
    armL.rotation.x = -s * armSwing;
    armR.rotation.x = s * armSwing;
    armL.rotation.z = opts.air ? 0.35 : 0.06 * amt;
    armR.rotation.z = opts.air ? -0.35 : -0.06 * amt;
    if (opts.punch) armL.rotation.x = -1.45;
    else if (opts.aiming) armL.rotation.x = -1.15 + (opts.pitch || 0) * 0.55 - (opts.recoil || 0) * 0.35;
  }

  // 躯干上下起伏、轻微扭转与前倾
  torso.position.y = rig.torsoY + (opts.air ? 0.04 : Math.abs(Math.sin(p)) * 0.055 * amt);
  torso.rotation.y = -s * 0.09;
  torso.rotation.z = s * (rig.kind === 'naiwa' ? 0.08 : 0.06);
  torso.rotation.x = opts.sprint ? 0.11 : (opts.punch ? 0.15 : 0);

  // 头部随步态微稳与待机呼吸
  head.rotation.y = s * 0.07;
  head.rotation.x = idle ? Math.sin(gameTime * 2.2) * 0.025 : Math.sin(p * 2) * 0.03 * amt;

  // 尾巴自然摆动
  const tailAmp = rig.kind === 'whale' ? (idle ? 0.22 : 0.42 * amt) : (idle ? 0.14 : 0.34 * amt);
  tail.rotation.y = Math.sin(idle ? gameTime * 2.8 : p * 1.05) * tailAmp;
  tail.rotation.x = Math.cos(p * 2) * 0.08 * amt;
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

async function loadBld1Asset(url, uvScaleU = 14, uvScaleV = 16) {
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
    // 基于位置与法线的盒式投影生成 UV，供高清玻璃幕墙与窗棂材质映射
    const uvs = new Float32Array(vertCount * 2);
    for (let v = 0; v < vertCount; v++) {
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      const nx = normals[v * 3], nz = normals[v * 3 + 2];
      uvs[v * 2] = (Math.abs(nx) >= Math.abs(nz) ? z : x) / uvScaleU;
      uvs[v * 2 + 1] = y / uvScaleV;
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
    s.g.visible = d2 < 150 * 150;
    if (s.bodyMesh) s.bodyMesh.castShadow = d2 < 75 * 75;
  }
  for (const l of landmarkLODs) {
    const cs = dist2(l.x, l.z, P.x, P.z) < 145 * 145;
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

  const pearlBodyMat = new THREE.MeshStandardMaterial({ color: '#e2e7ef', emissive: '#354860', emissiveIntensity: 0.04, roughness: 0.28, metalness: 0.45, envMap: cityEnvMap, envMapIntensity: 1.25 });
  pearlSphereMat = new THREE.MeshStandardMaterial({
    color: '#e45290', emissive: '#ff388c', emissiveIntensity: 0.14,
    roughness: 0.12, metalness: 0.42, envMap: cityEnvMap, envMapIntensity: 1.6,
  });
  pearlSpireMat = new THREE.MeshStandardMaterial({ color: '#eef2f7', emissive: '#ff3a4a', emissiveIntensity: 0.18, roughness: 0.20, metalness: 0.85, envMap: cityEnvMap, envMapIntensity: 1.35 });

  glassTowerMats.push(pearlBodyMat);
  curtainGlassMats.push(swfcGlassMat, jinmaoGlassMat);
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
      0: pearlBodyMat,
      1: pearlSphereMat,
      2: new THREE.MeshStandardMaterial({ color: '#535c68', roughness: 0.68, metalness: 0.15 }),
      3: pearlSpireMat,
    },
    jinmao: {
      0: jinmaoGlassMat,
      1: darkGraniteMat,
      2: brushedSteelMat,
      3: jinmaoCrownMat,
    },
    statue: {
      0: new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.36, metalness: 0.14 }), // 黄色奶娃公园雕像
      1: ROLE_FEATURE_MATS[2], // 白色眼白与高光
      2: ROLE_FEATURE_MATS[4], // 黑色亮面瞳孔
    },
    statue_fly: {
      0: new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.34, metalness: 0.12 }), // 亮黄飞鸟奶娃雕塑
      1: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.24, metalness: 0.05 }),
      2: new THREE.MeshStandardMaterial({ color: '#24c45c', roughness: 0.22, metalness: 0.08 }), // 外圈碧绿眼眸
      3: new THREE.MeshStandardMaterial({ color: '#0d0f13', roughness: 0.10, metalness: 0.22 }), // 内圈亮黑瞳孔
      4: new THREE.MeshBasicMaterial({ color: '#ffffff' }), // 眼神高光
      5: new THREE.MeshStandardMaterial({ color: '#d4c392', roughness: 0.52, metalness: 0.18 }), // 石金底座
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
    ['canton',      'assets/bld_canton.bin',         14, 16],
    ['swfc',        'assets/bld_swfc.bin',           14, 16],
    ['pearl',       'assets/bld_pearl.bin',          14, 16],
    ['jinmao',      'assets/bld_jinmao.bin',         12, 14],
    ['statue',      'assets/statue_naiwa.bin',       14, 16],
    ['statue_fly',  'assets/statue_fly_naiwa.bin',   14, 16],
    ['god_naiwa',   'assets/god_naiwa.bin',          14, 16],
    ['laugh_naiwa', 'assets/laugh_naiwa.bin',        14, 16],
  ];
  const loaded = {};
  const results = await Promise.allSettled(files.map(([, url, su, sv]) => loadBld1Asset(url, su, sv)));
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
  const fpPart = (w, h, d, col, parent, x, y, z) => {
    const m = new THREE.Mesh(boxGeo, mat(col));
    m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m;
  };
  const fFist = new THREE.Group();
  fpPart(0.08, 0.08, 0.26, '#3b3f46', fFist, 0.02, -0.05, 0.04);
  fpPart(0.095, 0.095, 0.11, '#e0b18f', fFist, 0.02, -0.04, -0.14);

  const fPistol = new THREE.Group();
  fpPart(0.065, 0.065, 0.2, '#3b3f46', fPistol, 0, -0.08, 0.1);
  fpPart(0.05, 0.1, 0.065, '#19191c', fPistol, 0, -0.04, 0.01);
  fpPart(0.045, 0.045, 0.22, '#2d3038', fPistol, 0, 0.025, -0.06);
  fpPart(0.014, 0.016, 0.016, '#ffd400', fPistol, 0, 0.055, -0.15);

  const fSmg = new THREE.Group();
  fpPart(0.07, 0.07, 0.22, '#3b3f46', fSmg, 0, -0.08, 0.12);
  fpPart(0.06, 0.085, 0.28, '#1e2025', fSmg, 0, 0.01, -0.05);
  fpPart(0.038, 0.15, 0.048, '#121215', fSmg, 0, -0.09, -0.06);
  fpPart(0.026, 0.026, 0.16, '#353840', fSmg, 0, 0.02, -0.25);

  const fShot = new THREE.Group();
  fpPart(0.07, 0.07, 0.22, '#3b3f46', fShot, 0, -0.08, 0.14);
  fpPart(0.06, 0.075, 0.22, '#5a3821', fShot, 0, -0.02, 0.1);
  fpPart(0.065, 0.075, 0.18, '#24262b', fShot, 0, 0.01, -0.06);
  fpPart(0.028, 0.028, 0.42, '#1a1b1f', fShot, 0, 0.032, -0.34);
  fpPart(0.024, 0.024, 0.34, '#2a2c32', fShot, 0, 0.002, -0.3);
  fpPart(0.055, 0.048, 0.18, '#5a3821', fShot, 0, -0.01, -0.24);

  fpvMeshes.push(fFist, fPistol, fSmg, fShot);
  fpvMeshes.forEach((m, i) => { m.visible = (i === player.wpn); fpvHolder.add(m); });
}

/* ============================ HUD ============================ */
const hud = {
  money: $('money'), stars: $('stars'), clock: $('clock'), district: $('district'),
  weapon: $('weapon'), mission: $('mission'), philoHud: $('philoHud'), speedo: $('speedo'),
  hp: $('hpfill'), armor: $('armorfill'), cross: $('crosshair'), hitmarker: $('hitmarker'),
  msg: $('msg'), big: $('bigtext'), bountySummary: $('bountySummary'), flash: $('dmgflash'),
  godflash: $('godflash'), epiphany: $('epiphany'), epTitle: $('epTitle'), epSub: $('epSub'),
  phone: $('phone'), phTime: $('phTime'), phList: $('phList'),
  bestRecord: $('bestRecord'),
  dialog: $('dialog'), dlgSpeaker: $('dlgSpeaker'), dlgRole: $('dlgRole'), dlgText: $('dlgText'), dlgChoices: $('dlgChoices'),
};
const mm = $('minimap'), mmg = mm.getContext('2d');
const lastHUD = {};
function setHTML(el, key, val) { if (lastHUD[key] !== val) { lastHUD[key] = val; el.innerHTML = val; } }
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
  if (Math.max(Math.abs(x), Math.abs(z)) > 340) return '滨海大道 · Waterfront';
  if (Math.hypot(x, z) < 135) return '中城区 · Midtown';
  if (z < -120) return '阿尔冈琴 · Algonquin';
  if (z > 120) return '布洛克区 · Broker';
  if (x < -120) return '奥尔德尼 · Alderney';
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
      kind = r < 0.12 ? 'taxi' : r < 0.28 ? 'sport' : r < 0.46 ? 'suv' : 'sedan';
    }
  }
  const police = kind === 'police';
  const cfg = CAR_TYPES[kind];
  const color = opts.color || (police ? '#16213d' : kind === 'taxi' ? '#f2c200' : pick(CAR_COLORS));
  const m = makeCarMesh(color, kind);
  const c = {
    ...m, kind, x, z, h, y: 0, ground: 0, jy: 0, jv: 0, vx: 0, vz: 0, speed: 0, prevSpeed: 0, steer: 0, pitch: 0, roll: 0,
    hp: cfg.hp, maxHp: cfg.hp, police, braking: false,
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
  const maxF = c.maxSpeed, maxR = 12;

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
    c.shiftT = c.kind === 'sport' ? 0.11 : 0.19;
    c.shiftFlashT = 0.28;
    if (c === player.inCar && (up || tgtGear >= 1)) {
      sndShift(up, c.kind === 'sport');
      c.pitch = clamp(c.pitch + (up ? -0.028 : 0.022), -0.07, 0.07);
      shake = Math.max(shake, 0.035);
      if (c.kind === 'sport' && up && c.gear >= 2) {
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
    if (fs < -0.5) fs += 40 * inp.throttle * dt;
    else if (!shifting) fs += c.accel * GEAR_TRQ[clamp(c.gear, 1, 5)] * (1 - clamp(sr, 0, 1) * 0.42) * inp.throttle * dt;
  } else if (inp.throttle < 0) {
    const t = -inp.throttle;
    if (fs > 0.5) fs -= 40 * t * dt;
    else fs -= c.accel * 0.7 * t * dt;
  } else fs -= Math.sign(fs) * Math.min(Math.abs(fs), 4 * dt);
  if (inp.handbrake) fs -= Math.sign(fs) * Math.min(Math.abs(fs), 14 * dt);
  fs = clamp(fs, -maxR, maxF);

  let targetRpm = 900;
  if (c.gear === 0) targetRpm = 900 + (inp.throttle > 0 ? 2200 : 0);
  else if (c.gear === -1) targetRpm = 1100 + clamp(Math.abs(fs) / maxR, 0, 1) * 4400;
  else {
    const lo = GEAR_MAX[c.gear - 1] * 0.56, hi = GEAR_MAX[c.gear];
    const band = clamp((sr - lo) / Math.max(0.08, hi - lo), 0, 1);
    targetRpm = (shifting ? 1400 : 1200 + band * 5900);
  }
  c.rpm = lerp(c.rpm, targetRpm, Math.min(1, dt * 14));
  const grip = inp.handbrake ? 1.0 : (c.wreck ? 4 : 6.5);
  ls *= Math.exp(-grip * dt);
  c.steer += (inp.steer - c.steer) * Math.min(1, dt * 7);
  const tf = clamp(fs / 7, -1, 1) * (1 - clamp(Math.abs(fs) / maxF, 0, 1) * 0.5);
  c.h += c.steer * 2.3 * tf * dt * (inp.handbrake ? 1.5 : 1);
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
  const directOK = chasing && dP < 38 && !segBlocked(c.x, c.z, P.x, P.z);
  if (directOK) {
    c.direct = true;
    tx = P.x; tz = P.z;
    if (player.inCar) target = 46;
    else target = dP > 18 ? 26 : dP > 9 ? 8 : 0;
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
    target = chasing ? 40 : 13;
    if (dd < 22 * 22) target = Math.min(target, chasing ? 17 : 9);
  }
  const desiredH = Math.atan2(tx - c.x, tz - c.z);
  const ad = angDiff(c.h, desiredH);
  inp.steer = clamp(ad * 2.5, -1, 1);
  if (Math.abs(ad) > 0.6) target = Math.min(target, chasing ? 16 : 7);
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
    // 漂移/急刹轮胎烟雾
    if (!c.wreck && (c.drift > 5 || (inp.handbrake && Math.abs(c.speed) > 10)) && Math.random() < 0.45) {
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      emit(c.x - fx * 1.4 + rand(-0.6, 0.6), c.ground + 0.2, c.z - fz * 1.4 + rand(-0.6, 0.6), rand(-0.6, 0.6), rand(0.6, 1.5), rand(-0.6, 0.6), '#ddd', 0.28, 0.7, 0, 0.9);
    }
    c.wheelSpin += c.speed * dt / 0.38;
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
      if (chasing && d < 30 && Math.abs(c.speed) < 1.2 && (!inVehicle() || (player.inCar && Math.abs(player.inCar.speed) < 3))) {
        c.copOut = true;
        c.copX = c.x + Math.cos(c.h) * 1.7; c.copZ = c.z - Math.sin(c.h) * 1.7;
        const pt = { x: c.copX, z: c.copZ }; collideCircle(pt, 0.4); c.copX = pt.x; c.copZ = pt.z;
        c.cop.g.visible = true;
      } else if (chasing && stars >= 3 && d < 24) {
        // 高通缉：开车时也会开枪
        c.shootT -= dt;
        if (c.shootT <= 0) { c.shootT = rand(0.8, 1.6); npcShoot(c.x, 1.6, c.z); }
      }
      continue;
    }
    if (!chasing || d > 40) { c.copOut = false; c.cop.g.visible = false; continue; }
    const dx = P.x - c.copX, dz = P.z - c.copZ, dd = Math.hypot(dx, dz) + 1e-4;
    let moving = false;
    if (stars === 1 && dd > 1.3) {
      c.copX += dx / dd * 4.4 * dt; c.copZ += dz / dd * 4.4 * dt; moving = true;
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
        c.shootT = rand(0.6, 1.3);
        hm.g.updateMatrixWorld();
        const mz = hm.armR.localToWorld(new THREE.Vector3(0, -0.8, 0));
        npcShoot(mz.x, mz.y, mz.z);
      }
    }
  }
  if (close) {
    player.bustT += dt;
    if (player.bustT > 1.3) killPlayer('BUSTED');
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
    addHeat(40); alertPeds(p.x, p.z, 30);
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
        player.ammos[1] += 34; player.ammos[2] += 60; player.ammos[3] += 16;
        showMsg('弹药补给！', 1.4); sndPickup();
        scene.remove(pk.mesh); pickups.splice(i, 1);
      } else if (pk.type === 'armor' && player.armor < 100) {
        player.armor = 100; showMsg('防弹衣 +100', 1.5); sndPickup();
        pk.active = false; pk.mesh.visible = false; pk.respawnT = 75;
      } else if (pk.type === 'health' && player.hp < 100) {
        player.hp = Math.min(100, player.hp + 50); showMsg('生命值恢复', 1.5); sndPickup();
        pk.active = false; pk.mesh.visible = false; pk.respawnT = 60;
      }
    }
  }
}

/* ============================ 任务系统 ============================ */
const markerMat = new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
const beamMat = new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.15, depthWrite: false });
const marker = new THREE.Group();
marker.add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.4, 28, 1, true), markerMat));
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 120, 10, 1, true), beamMat); beam.position.y = 60; marker.add(beam);
marker.visible = false; scene.add(marker);
const MISSION_TYPES = [
  { name: '送货', text: '把包裹送到黄色标记处' },
  { name: '接头', text: '赶去和线人接头' },
  { name: '取钱', text: '去黄色标记处收保护费' },
  { name: '逃跑路线', text: '踩点：开车去标记处确认路线' },
];
const mission = { active: false, x: 0, z: 0, time: 0, reward: 0, cooldown: 3, type: null, done: 0 };
function newMission() {
  const P = playerAnchor();
  for (let tries = 0; tries < 50; tries++) {
    const i = randi(0, N - 1), k = randi(0, N - 1);
    const x = roadC(i) + (Math.random() < 0.5 ? 1 : -1) * (ROAD / 2 + 1.8);
    const z = roadC(k) + (Math.random() < 0.5 ? 1 : -1) * (ROAD / 2 + 1.8);
    if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) continue;
    const d = Math.sqrt(dist2(x, z, P.x, P.z));
    if (d < 140 || d > 520) continue;
    Object.assign(mission, { active: true, x, z, time: Math.round(d / 11 + 28), reward: Math.round((150 + d * 1.6) / 10) * 10, type: pick(MISSION_TYPES) });
    marker.position.set(x, groundH(x, z), z); marker.visible = true;
    showMsg(`新任务【${mission.type.name}】：${mission.type.text}`, 4);
    return;
  }
}
function updateMission(dt) {
  if (player.dead || gameMode !== 'free') return;
  if (!mission.active) { mission.cooldown -= dt; if (mission.cooldown <= 0) newMission(); return; }
  mission.time -= dt;
  marker.children[0].scale.setScalar(1 + Math.sin(gameTime * 4) * 0.05);
  const P = playerAnchor();
  const groundAlt = player.inHeli ? player.inHeli.y : groundH(P.x, P.z) + player.y;
  if (dist2(P.x, P.z, mission.x, mission.z) < 3.2 * 3.2 && groundAlt < 8) {
    player.money += mission.reward; mission.done++;
    showMsg(`<b style="color:#ffd400">任务完成！</b> +$${mission.reward}`, 3); sndPickup();
    mission.active = false; marker.visible = false; mission.cooldown = 4;
  } else if (mission.time <= 0) {
    showMsg('<b style="color:#ff5050">任务失败：超时</b>', 3);
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

/* ============================ 剧情 NPC 与对话系统 ============================ */
const story = { stage: 0, soldToElena: false, freeHealUsed: false, enemies: [] };
const storyNpcs = [];
const dialog = { open: false, npc: null, text: '', choices: [], isSage: false, isGod: false, philoCompleted: false };
const npcHaloGeo = new THREE.TorusGeometry(0.42, 0.05, 8, 20);
const enemyHaloGeo = new THREE.TorusGeometry(0.45, 0.055, 8, 20);
const enemyHaloMat = new THREE.MeshBasicMaterial({ color: '#c44dff' });

function storyTargetId() {
  if (story.stage === 0 || story.stage === 4) return 'roman';
  if (story.stage === 1) return 'viktor';
  if (story.stage === 2) return 'tony';
  return null;
}

function initStoryNpcs() {
  const defs = [
    { id: 'roman',  mapTag: 'R', name: '罗曼',     role: '表哥 · 出租车行老板', x: blockMin(6) + 2.4,         z: blockMin(6) + 6.0,          shirt: '#8b5a2b', pants: '#2c3e50', skin: '#e0ac69', hair: '#22150c' },
    { id: 'viktor', mapTag: 'V', name: '老维克多', role: '中城区 · 地下线人',   x: blockMin(5) + BLOCK - 2.4, z: blockMin(5) + BLOCK - 8.0,  shirt: '#37414a', pants: '#18191c', skin: '#f1c27d', hair: '#9a9a9a' },
    { id: 'tony',   mapTag: 'T', name: '托尼',     role: '东区 · 改装修车师',   x: blockMin(7) + 2.4,         z: blockMin(6) + 14.0,         shirt: '#1d4e89', pants: '#22262c', skin: '#c68642', hair: '#1b1209' },
    { id: 'elena',  mapTag: 'E', name: '艾琳',     role: '自由城时报 · 调查记者', x: blockMin(5) + BLOCK - 2.4, z: blockMin(7) + 8.0,        shirt: '#8e2438', pants: '#1b1b1f', skin: '#ffdbac', hair: '#3b2412' },
  ];
  for (const d of defs) {
    const hm = makeHuman(d.shirt, d.pants, d.skin, d.hair);
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

function spawnStoryAmbush(cx, cz) {
  for (const e of story.enemies) scene.remove(e.hm.g);
  story.enemies.length = 0;
  const specs = [
    { name: '铁锤手下', ox: -10, oz: 10, hp: 90,  shirt: '#2a2233' },
    { name: '铁锤手下', ox: 10,  oz: 12, hp: 90,  shirt: '#2a2233' },
    { name: '“铁锤”伊万', ox: 0, oz: 16, hp: 170, shirt: '#6a1b29' },
  ];
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
      hp: sp.hp, maxHp: sp.hp, speed: 3.6, phase: Math.random() * 6,
      shootT: rand(0.7, 1.4), dead: false, deadT: 0, fall: 0, vx: 0, vz: 0,
    });
  }
  showMsg('⚔️ “铁锤”伊万带人埋伏在附近！消灭全部 3 名打手！', 4.5);
}

function killStoryEnemy(e, kx, kz) {
  if (e.dead) return;
  e.dead = true; e.deadT = 0; e.fall = 0; e.hp = 0; e.vx = kx; e.vz = kz;
  e.halo.visible = false;
  if (gameMode === 'bounty') bounty.kills++;
  for (let i = 0; i < 12; i++) emit(e.x, 1.1, e.z, rand(-2, 2) + kx * 0.1, rand(0.5, 3), rand(-2, 2) + kz * 0.1, '#8a0000', 0.08, 0.6, -9);
  spawnPickup('cash', e.x + rand(-0.4, 0.4), e.z + rand(-0.4, 0.4), randi(40, 80));
  if (story.enemies.every(x => x.dead)) {
    story.stage = 4;
    player.money += 400;
    sndPickup();
    showMsg('🏆 击溃“铁锤”！已夺回罗曼的欠条（+$400），快回去找 <b style="color:#ffd400">罗曼 (R)</b>！', 5);
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
  hud.dlgChoices.innerHTML = choices.map((c, i) => `<div class="dlg-opt"><b>[${i + 1}]</b>${c.label}</div>`).join('');
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
  phoneOpen = false; mouseL = mouseR = false;
  playTone(540, 0.05, 0.08, 'sine');
  const id = npc.id;
  if (id === 'roman') {
    if (story.stage === 0) {
      setDialog('“表弟！你总算下船来自由城了！我本来想好好经营出租车行，结果被布洛克区的高利贷‘铁锤’套路了一笔假账。你先去中城区西北角找老线人【老维克多(V)】，他手里有内幕！”', [
        { label: '放心，我去会会老维克多（接下线索，+$200 启动费）', action: () => {
          story.stage = 1; player.money += 200; sndPickup();
          setDialog('“拿着这 200 块路费，门口那辆跑车随便开。记住按 V 能切第一人称驾驶，小心别惹到条子！”', [
            { label: '明白，马上出发', action: closeDialog },
          ]);
        }},
        { label: '我先在城里逛逛，待会再来', action: closeDialog },
      ]);
    } else if (story.stage >= 1 && story.stage <= 3) {
      const hint = story.stage === 1 ? '去中城区找【老维克多(V)】打听消息！' : story.stage === 2 ? '去东区找修车师【托尼(T)】拿账本！' : '快把托尼那儿的“铁锤”打手解决掉！';
      setDialog(`“怎么样，事情有进展吗？${hint}”`, [{ label: '正在处理中', action: closeDialog }]);
    } else if (story.stage === 4) {
      setDialog('“天哪，你真把‘铁锤’的欠条抢回来了？！而且听说还有他洗钱的黑账！车行总算保住了，表弟你真是自由城的传奇！”', [
        { label: '自家人客气什么（完成故事：+$800 + 赠送金色定制跑车）', action: () => {
          story.stage = 5; player.money += 800; sndPickup();
          const cx = blockMin(6) - 3.6, cz = blockMin(6) + 6.0;
          const gift = spawnCar(cx, cz, Math.PI, { kind: 'sport', color: '#ffd400', driver: null });
          gift.ai = null; gift.maxSpeed = 60; gift.accel = 28;
          setDialog('“这 800 块加上路边这辆金色特调跑车归你了！如果账本副本还在手里，西南边记者【艾琳(E)】正高价收猛料呢。”', [
            { label: '太棒了，自由城是我们的了！', action: closeDialog },
          ]);
        }},
      ]);
    } else {
      setDialog('“现在车行生意红火得很！随时按 F 上我的跑车去兜风，或者按 T 用手机接零活。”', [
        { label: '祝你生意兴隆，表哥', action: closeDialog },
      ]);
    }
  } else if (id === 'viktor') {
    if (story.stage === 1) {
      setDialog('“罗曼派你来的？嘘，小声点……‘铁锤’伊万根本不是普通债主，他利用东区修车厂洗黑钱。真账本就藏在东区大道【托尼(T)】的修车工具箱后头。”', [
        { label: '我这就去找托尼拿账本（推进剧情）', action: () => {
          story.stage = 2; sndPickup();
          setDialog('“小心点，那片区可能有他的打手盯梢。顺便看看我这批刚到港的黑市货？”', [
            { label: '去东区找托尼', action: closeDialog },
            { label: '花 $100 补满护甲与全武器弹药', action: () => {
              if (player.money < 100) { showMsg('金钱不足（需 $100）', 2); closeDialog(); return; }
              player.money -= 100; player.armor = 100; player.ammos[1] += 68; player.ammos[2] += 120; player.ammos[3] += 24;
              sndPickup(); showMsg('已买齐黑市装备！', 2); closeDialog();
            }},
          ]);
        }},
      ]);
    } else {
      setDialog('“自由城的水深着呢。高楼背后全是交易，活着的人才能笑到最后。需要买点家伙防身吗？”', [
        { label: '花 $100 补满护甲与全武器弹药', action: () => {
          if (player.money < 100) { showMsg('金钱不足（需 $100）', 2); closeDialog(); return; }
          player.money -= 100; player.armor = 100; player.ammos[1] += 68; player.ammos[2] += 120; player.ammos[3] += 24;
          sndPickup(); showMsg('黑市补给已就位！', 2); closeDialog();
        }},
        { label: '听听关于自由城的传闻', action: () => {
          setDialog('“二十年前阿尔冈琴和布洛克还是码头工人的天下，现在全归了地产大亨和黑帮。如果你把‘铁锤’的黑账交给记者艾琳，能把警局里几个收黑钱的家伙一起拉下水。”', [
            { label: '谢了，老维克多', action: closeDialog },
          ]);
        }},
        { label: '告辞', action: closeDialog },
      ]);
    }
  } else if (id === 'tony') {
    const opts = [];
    if (story.stage === 2) {
      opts.push({ label: '我是罗曼和维克多派来的，把黑账交出来！', action: () => {
        story.stage = 3;
        spawnStoryAmbush(npc.x, npc.z);
        setDialog('“太晚了兄弟！‘铁锤’的手下刚嗅到风声堵到街口了！账本给你，快拿起家伙干翻那三个家伙！”', [
          { label: '交给我来摆平！', action: closeDialog },
        ]);
      }});
    }
    opts.push({ label: '花 $80 修理并性能改装附近的车辆（满耐久 + 极速提升）', action: () => {
      const near = cars.find(c => !c.wreck && dist2(c.x, c.z, player.x, player.z) < 16 * 16);
      if (!near) { showMsg('附近 16 米内没有可改装的车辆', 2); closeDialog(); return; }
      if (player.money < 80) { showMsg('金钱不足（需 $80）', 2); closeDialog(); return; }
      player.money -= 80; near.hp = near.maxHp; near.maxSpeed = Math.min(72, near.maxSpeed + 6); near.accel = Math.min(34, near.accel + 4);
      sndPickup(); showMsg('🔧 车辆已满血修复并完成涡轮调校！', 2.5); closeDialog();
    }});
    opts.push({ label: '随便聊聊', action: () => {
      setDialog('“听这引擎声、感受一下换挡瞬间的推背感——在自由城开好车可比走夜路安全多了。按 V 坐进驾驶舱看看仪表盘，那才是真男人的浪漫！”', [
        { label: '手艺不错，回头见', action: closeDialog },
      ]);
    }});
    setDialog(story.stage === 2 ? '“嘘……别在街上大声喊！你是来拿工具箱后面那本黑账的？”' : '“欢迎来到东区街头改装站，哥们！车撞坏了随时开过来！”', opts);
  } else if (id === 'elena') {
    const opts = [];
    if (story.stage >= 4 && !story.soldToElena) {
      opts.push({ label: '把“铁锤”的黑账副本交给她曝光（+$500）', action: () => {
        story.soldToElena = true; player.money += 500; sndPickup();
        setDialog('“天啊……这份交易流水足以让半个市政厅睡不着觉！明天的自由城头版绝对震撼全城！这 500 块是报酬，注意安全！”', [
          { label: '真相总要见光', action: closeDialog },
        ]);
      }});
    }
    if (!story.freeHealUsed) {
      opts.push({ label: '我受了点伤，能帮忙包扎一下吗？（免费恢复满血）', action: () => {
        story.freeHealUsed = true; player.hp = 100; sndPickup();
        showMsg('❤️ 艾琳帮你包扎了伤口，生命值已满', 2); closeDialog();
      }});
    } else {
      opts.push({ label: '花 $50 买一份急救包（恢复满血）', action: () => {
        if (player.money < 50) { showMsg('金钱不足（需 $50）', 2); closeDialog(); return; }
        player.money -= 50; player.hp = 100; sndPickup(); showMsg('❤️ 生命值已回满', 2); closeDialog();
      }});
    }
    opts.push({ label: '聊聊你正在调查的报道', action: () => {
      setDialog('“我花了半年追踪自由城五大区的走私线——阿尔冈琴的西装大佬和布洛克区的帮派其实共用同一个金主。如果弄到实锤证据，一定要拿来给我！”', [
        { label: '我会留意的', action: closeDialog },
      ]);
    }});
    setDialog('“你好，我是自由城时报的艾琳。小心点，这街区最近不太平，警笛声比海鸥叫得还勤。”', opts);
  }
}

function updateStory(dt) {
  const P = playerAnchor();
  const tgtId = storyTargetId();
  for (const n of storyNpcs) {
    const isTgt = (gameMode === 'free' && n.id === tgtId);
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

/* ============================ 哲学家系统与【神临 · 上帝之死】 ============================ */
const philo = { met: new Set(), total: 6, list: [] };
const sageHaloGeo = new THREE.TorusGeometry(0.42, 0.045, 8, 22);
const PHILOSOPHER_DEFS = [
  {
    id: 'aristotle',
    name: '亚里士多德',
    role: '吕克昂学园 · 漫步学派创始人',
    mark: '【实证与中道】',
    gesture: 'peripatetic',
    x: blockMin(6) + 4.5,
    z: blockMin(5) + BLOCK - 3.5,
    cfg: { robe: '#efe6cf', trim: '#d4af37', sash: '#b8860b', hair: '#5a4030', beard: 'full', laurel: true, robeSkirt: true, shoe: '#7a5230', prop: 'scroll' },
    intro: '“吾爱吾师，吾更爱真理。柏拉图仰望天上的理念，但我指向大地——秩序就在眼前的砖石、车轮与万物的中道之中。穿梭都市喧嚣，你可看清了自己的美德所在？”',
    choices: [
      { label: '纵欲或冷漠皆是失衡，我想在欲望与克制间寻得中道', reply: '“善哉！勇气乃怯懦与鲁莽之中道，自由亦非放纵。美德不是天外神谕，而是人在每日选择中践行的习惯。”' },
      { label: '真理必须经由双眼与双手实证，而非盲从虚幻教条', reply: '“正是如此！形式寓于质料之中，你脚下的世界本身即是真实，何必向虚空另寻一位高高在上的造物主？”' },
    ],
    afterText: '“你已将实证的理性刻入骨血，不再奢望虚无的庇护——这便是哲学成熟的第一步。”',
  },
  {
    id: 'socrates',
    name: '苏格拉底',
    role: '雅典牛虻 · 助产士法辩士',
    mark: '【自知无知】',
    gesture: 'socratic',
    x: blockMin(5) + 4.5,
    z: blockMin(5) + BLOCK - 4.0,
    cfg: { robe: '#d8d5cc', trim: '#b4afa3', hair: '#d8d8d8', beard: 'long', beardCol: '#e4e4e4', robeSkirt: true, shoe: '#6b4f3a', prop: 'cup' },
    intro: '“未经审视的人生不值得过。这座城里人人都以为自己通晓金钱、正义与生死。年轻人，我只反问你一句：你果真认识你自己吗？”',
    choices: [
      { label: '承认自己的无知与局限，才是真正智慧的起点', reply: '“哈哈！德尔斐神谕称我最明智，只因我清楚自己一无所知。当你学会怀疑现成的答案，你的思想便不再受他人摆布。”' },
      { label: '即便我所知甚少，也绝不停止质疑一切权威与信条', reply: '“好一根清醒的牛虻！记住，不被拷问的信念不过是酣睡；唯有追问不止的灵魂，才能在破晓中自立。”' },
    ],
    afterText: '“原来你心中的‘神’，竟经不住你自己这一番苏格拉底式的反诘——多么畅快的觉醒！”',
  },
  {
    id: 'zhuangzi',
    name: '庄子',
    role: '南华真人 · 齐物逍遥游',
    mark: '【齐物逍遥】',
    gesture: 'butterfly',
    x: blockMin(6) + 12.0,
    z: blockMin(7) + 12.0,
    cfg: { robe: '#2b7a78', trim: '#8fd3c8', sash: '#e6c86e', hair: '#2a2a2e', bun: true, beard: 'long', robeSkirt: true, wideSleeve: true, shoe: '#2b2b2b', prop: 'butterflies' },
    intro: '“昔者庄周梦为胡蝶，栩栩然胡蝶也；俄然觉，则蘧蘧然周也。楼宇万仞、车流滚滚，你看这金蝶掠过枝头——万物齐一，贵贱神俗原不过执念之分。”',
    choices: [
      { label: '放下狭隘分别心，天地万物原与自我同气连枝', reply: '“至矣！以道观之，物无贵贱；当你心无所待、神游物外，又何须在自己头顶供奉另一位高悬的主宰？”' },
      { label: '若尘世犹如大梦，唯有醒着的自由意志才是真', reply: '“妙极！不知周之梦为胡蝶与，胡蝶之梦为周与？当你觉察到‘神’亦是心梦所化，万物尽在你胸臆之间。”' },
    ],
    afterText: '“蝴蝶未尝飞走，神光亦未尝真来——大梦既觉，天地与你并生，而万物与你为一。”',
  },
  {
    id: 'descartes',
    name: '笛卡尔',
    role: '理性主义先驱 · 沉思者',
    mark: '【理性基石】',
    gesture: 'cogito',
    x: blockMin(5) + 12.0,
    z: blockMin(6) + 4.0,
    cfg: { robe: '#1d2d44', trim: '#3e5c76', coatTail: true, pants: '#171d26', hair: '#2c1e16', longHair: true, beard: 'goatee', shoe: '#18181b', prop: 'crystal' },
    intro: '“试着彻底怀疑眼前的霓虹、大厦，乃至你的躯体。就算有一切幻象在欺骗你，总有一件事绝无可能被欺骗——那就是正在怀疑、正在思考的‘我’！我思，故我在。”',
    choices: [
      { label: '外物皆可存疑，唯独清醒思考着的心智确凿无疑', reply: '“精确如几何证明！当一切外部迷雾被理性清除，真正支撑世界秩序的，不是幽暗的盲信，而是你清明的理性。”' },
      { label: '我不仅由思考确立存在，更将以意志重构世界法则', reply: '“好！理性既是映照万物的晶石，也是你手中的罗盘。当你自己成为确凿不移的支点，天幕自会为你敞开。”' },
    ],
    afterText: '“看啊，当理性达到极致，连天上的幻影也不得不向‘我思’折射出它虚幻的本质。”',
  },
  {
    id: 'kant',
    name: '康德',
    role: '哥尼斯堡哲人 · 批判与道德律',
    mark: '【星空与律令】',
    gesture: 'starry',
    x: blockMin(7) + 4.0,
    z: blockMin(5) + 14.0,
    cfg: { robe: '#5c2432', trim: '#9c4c5e', coatTail: true, pants: '#2a2228', wig: true, skin: '#f1d4b8', shoe: '#1a1618', prop: 'watch' },
    intro: '“有两样东西，我愈是持久地凝思，就愈令心灵充满敬畏与惊奇——那便是头顶的灿烂星空，和心中的道德法则！请永远把人当作目的本身，而非任何神祇或权力的工具。”',
    choices: [
      { label: '无需神明赏罚，人的尊严与自律本身就是最高律令', reply: '“壮哉！道德律从不需要借来天神的鞭子或诱饵。当你凭自己的理性为自己立法时，人方才展现出比神更崇高的自由。”' },
      { label: '星辰按规律运行，而世界的立法者原是人的先天理性', reply: '“深刻！不是心智去卑微地符合神设的教条，而是大千世界的秩序本就在你内在理性的光芒中被建立起来。”' },
    ],
    afterText: '“你心中那片星空已比任何神坛更为辽阔——敬畏不再朝向云端，而朝向清醒的人格。”',
  },
  {
    id: 'nietzsche',
    name: '尼采',
    role: '查拉图斯特拉代言人 · 重估一切价值',
    mark: '【超人与破晓】',
    gesture: 'hammer',
    x: blockMin(4) + BLOCK - 8.0,
    z: blockMin(6) + 8.0,
    cfg: { robe: '#1f2026', trim: '#383a44', coatTail: true, pants: '#141519', hair: '#4a3525', beard: 'mustache', beardCol: '#4a3525', skin: '#e8c4a0', shoe: '#121215', prop: 'hammer' },
    intro: '“听见远方的钟声了吗？人们惯于仰望苍穹乞求恩典，却不敢直视那个震耳欲聋的宣告——‘上帝已死！’是我们亲手用清醒与勇气杀死了旧神。举起这把哲学之锤，准备成为超越平庸的‘超人’吗？”',
    choices: [
      { label: '旧神既死，意义与价值便由清醒的我亲手创造', reply: '“正是这阵破晓的狂风！别为昔日的虚妄哀悼——既然天空空了，那就站在大地上，成为你自己的立法者吧！”' },
      { label: '神或许从未真实存在，不过是思想登峰造极时投下的虚影', reply: '“啊……你竟然提前听见了雷声！当你集齐六贤之思踏入市中心广场，那道神影将在你眼前彻底粉碎！”' },
    ],
    afterText: '“看看你自己吧！神像已碎成星屑归于你的胸膛，你已跨越深渊，达到了哲学上的出神入化。”',
  },
];

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
  showMsg(`💨 一缕青烟袅袅升起，你与${ph.name}相视捧腹大笑！`, 3.0);
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
      if (ph.laughGroup.children.length > 0) {
        for (const sp of ph.sageParts) sp.visible = false;
        ph.laughGroup.visible = true;
        const lt = gameTime + ph.phase;
        const sq = Math.sin(lt * 16) * 0.055;
        ph.laughGroup.rotation.x = Math.sin(lt * 16) * 0.14 - 0.05;
        ph.laughGroup.rotation.z = Math.sin(lt * 8.5) * 0.10;
        ph.laughGroup.position.y = Math.abs(Math.sin(lt * 12)) * 0.11;
        ph.laughGroup.scale.set(1 + sq, 1 - sq * 1.15, 1 + sq);
      } else {
        ph.sm.torsoPivot.rotation.x = 0.35 + Math.sin((gameTime + ph.phase) * 15) * 0.15;
        ph.sm.headPivot.rotation.x = -0.22 + Math.sin((gameTime + ph.phase) * 18) * 0.16;
      }
      if (ph.laughT === 0) {
        ph.laughGroup.visible = false;
        for (const sp of ph.sageParts) sp.visible = true;
        for (let k = 0; k < 5; k++) {
          emit(ph.x + rand(-0.22, 0.22), groundH(ph.x, ph.z) + rand(0.9, 1.4), ph.z + rand(-0.22, 0.22), rand(-0.35, 0.35), rand(0.8, 1.4), rand(-0.35, 0.35), '#8beede', 0.14, 0.9, 0.25, 0.14);
        }
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
  phoneOpen = false; mouseL = mouseR = false;
  playTone(580, 0.06, 0.08, 'sine');
  const finishDiscourse = reply => {
    dialog.philoCompleted = true;
    const isNew = !philo.met.has(ph.id);
    if (isNew) {
      philo.met.add(ph.id);
      player.money += 150;
      sndEnlighten();
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(1.5, 4.5);
        emit(ph.x, groundH(ph.x, ph.z) + 1.4, ph.z, Math.cos(a) * sp, rand(1.5, 5.0), Math.sin(a) * sp, i % 2 ? '#ffd400' : '#c084fc', 0.09, 0.85, -3);
      }
      setDialog(`${reply}\n\n✦ 领悟哲学印记 ${ph.mark}（+$150 · 进度 ${philo.met.size}/${philo.total}）`, [
        {
          label: philo.met.size >= philo.total ? '六贤哲思已圆融，迎接【神临】（前往市中心光柱）' : '铭记此道，继续寻访诸贤',
          action: () => {
            closeDialog();
            if (philo.met.size >= philo.total && god.stage === 'locked') unlockTheophany();
          },
        },
      ], 'sage');
    } else {
      setDialog(reply, [{ label: '受教了，后会有期', action: closeDialog }], 'sage');
    }
  };

  if (god.stage === 'transcended') {
    setDialog(`${ph.afterText}\n\n（按 T → 6 或 Shift+G 可随时在市中心重温【神临 · 上帝之死】）`, [
      { label: `重温${ph.name}的核心哲学辩难`, action: () => {
        setDialog(ph.intro, ph.choices.map(ch => ({ label: ch.label, action: () => finishDiscourse(ch.reply) })), 'sage');
      }},
      { label: '点头致意，告别离去', action: () => { dialog.philoCompleted = true; closeDialog(); } },
    ], 'sage');
    return;
  }

  setDialog(ph.intro, ph.choices.map(ch => ({
    label: ch.label,
    action: () => finishDiscourse(ch.reply),
  })), 'sage');
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
  heat = 0; stars = 0; lostT = 0;
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
  if (player.dead) { showMsg('请等待重生后再使用神临捷径', 2); return; }
  if (godActive()) { showMsg('神临仪式正在进行中！', 1.8); return; }
  for (const ph of philo.list) philo.met.add(ph.id);
  showMsg('⚡ <b style="color:#ffd400">【快捷后门】</b> 六贤哲思瞬息贯通，直赴市中心迎接神临！', 3);
  startTheophany();
}

function openGodDialog() {
  dialog.open = true;
  dialog.npc = { id: 'deity', name: '至高神影 · 圣翼奶娃', role: '✦ 超然神启 ✦' };
  dialog.isSage = false;
  dialog.isGod = true;
  dialog.philoCompleted = false;
  mouseL = mouseR = false;

  const act3 = () => {
    setDialog(
      '“既已勘破此相，神格便再无存在的理由。天地本无外在于你的主宰——神将碎灭，从此山海归于清醒的你。”',
      [{ label: '见证神之破碎（上帝已死 · 万念归心）', action: triggerGodShatter }],
      'god'
    );
  };
  const act2 = () => {
    setDialog(
      '“……哈哈哈！好一个彻底清醒的追问！你看清这万丈金光与圣洁白翼之中降临的‘神明’罢——吾本无名，亦无造物之权。\n\n你眼前降临的‘神临奶娃’，不过是你自己经历了实证、怀疑、逍遥、理性、律令与重估之后，思想达到【出神入化】的境界时，在这座自由城天幕中映出的你自己的倒影。”',
      [{ label: '原来……神明从来只是我自己的倒影', action: act3 }],
      'god'
    );
  };
  setDialog(
    '“凡人……亚里士多德的中道、苏格拉底的反诘、庄周的蝴蝶、笛卡尔的我思、康德的星空与尼采的巨锤，六道火光已尽数汇于你心。如今你感召神临于市中心，向神明求取何物？”',
    [
      { label: '“你究竟是外在的造物主，还是我心中投射出的幻影？”', action: act2 },
      { label: '“若星空、理性与价值皆在我心，何须天外另有神明？”', action: act2 },
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
      player.hp = 100; player.armor = 100;
      if (!god.rewarded) {
        god.rewarded = true;
        player.money += 2000;
        player.ammos[1] += 68; player.ammos[2] += 120; player.ammos[3] += 32;
        showMsg('✦ <b style="color:#ffd400">出神入化！</b> 神格已碎、万念归心（卷心菜精心制作 · +$2000 · 全属性补满 · T→6可随时重温）', 5.5);
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
  if (player.dead || godActive()) return;
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
  phoneOpen = false;
  closeDialog();
  fpvRig.visible = false;
  player.hm.g.visible = true;
  hud.big.textContent = kind; hud.big.className = kind === 'WASTED' ? 'wasted' : 'busted'; hud.big.style.display = 'block';
  canvas.style.filter = 'grayscale(0.85) contrast(1.1)';
  if (kind === 'BUSTED') player.hm.armL.rotation.x = player.hm.armR.rotation.x = -Math.PI;
  if (mission.active) { mission.active = false; marker.visible = false; mission.cooldown = 8; }
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
  player.hp = 100; player.armor = 100;
  player.clips = [0, 17, 30, 8];
  player.ammos = [0, 170, 240, 48];
}
function respawn() {
  const kind = player.deadKind;
  const fee = gameMode === 'bounty' ? 0 : (kind === 'WASTED' ? Math.min(player.money, 100) : Math.min(player.money, 200));
  player.money -= fee;
  Object.assign(player, { dead: false, hp: 100, x: SPAWN.x, z: SPAWN.z, y: 0, vy: 0, h: Math.PI, bustT: 0, fall: 0, reloadT: 0, punchT: 0, chute: false });
  chuteGroup.visible = false;
  if (gameMode === 'bounty') {
    resetBountyRun();
  } else if (kind === 'BUSTED') {
    player.clips = [0, 17, 0, 0]; player.ammos = [0, 51, 0, 0]; player.armor = 0;
  }
  heat = 0; stars = 0; lostT = 0;
  yaw = camYaw = Math.PI; pitch = 0.22;
  player.hm.g.rotation.set(0, Math.PI, 0);
  player.hm.g.visible = !fpv;
  hud.big.style.display = 'none'; hud.bountySummary.style.display = 'none'; canvas.style.filter = '';
  if (gameMode === 'bounty') showMsg('🎯 新一轮赏金挑战开始！活下去并消灭目标！', 3.5);
  else showMsg(kind === 'WASTED' ? `你在医院醒来，支付医药费 $${fee}` : `你被保释出狱，罚款 $${fee}，武器被没收`, 4);
}
function switchWeapon(idx) {
  idx = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
  if (idx === player.wpn) return;
  player.wpn = idx; player.reloadT = 0;
  wpnMeshes.forEach((m, i) => { if (m) m.visible = (i === idx); });
  fpvMeshes.forEach((m, i) => { if (m) m.visible = (i === idx); });
  fpvMuzzle.position.set(0, 0.035, idx === 3 ? -0.56 : idx === 2 ? -0.36 : -0.22);
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
    else { if (policeNear(55)) setMinHeat(50); showMsg('抢车！', 1.5); }
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
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
function playerShoot() {
  if (player.reloadT > 0 || player.fireCD > 0 || inVehicle() || player.dead) return;
  const w = WEAPONS[player.wpn];
  if (w.melee) {
    player.fireCD = w.cd; player.punchT = 0.22; player.h = yaw;
    playNoise(0.08, 700, 0.25);
    const fx = Math.sin(player.h), fz = Math.cos(player.h);
    let hitAny = false;
    for (const p of peds) {
      if (p.state === 'dead') continue;
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * fx + dz * fz) / (d + 1e-4) > 0.35) {
        damagePed(p, w.dmg, fx * 2.5, fz * 2.5, true); hitAny = true;
      }
    }
    for (const c of cars) if (c.copOut) {
      const dx = c.copX - player.x, dz = c.copZ - player.z, d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * fx + dz * fz) / (d + 1e-4) > 0.35) { killCop(c, true); hitAny = true; }
    }
    for (const t of bounty.targets) if (!t.dead) {
      const dx = t.x - player.x, dz = t.z - player.z, d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * fx + dz * fz) / (d + 1e-4) > 0.35) { damageBountyTarget(t, w.dmg, fx * 2.5, fz * 2.5); hitAny = true; }
    }
    for (const se of story.enemies) if (!se.dead) {
      const dx = se.x - player.x, dz = se.z - player.z, d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * fx + dz * fz) / (d + 1e-4) > 0.35) { damageStoryEnemy(se, w.dmg, fx * 2.5, fz * 2.5); hitAny = true; }
    }
    if (hitAny) { playTone(120, 0.08, 0.25, 'sine'); if (policeNear(35)) setMinHeat(50); }
    return;
  }
  if (player.clips[player.wpn] <= 0) {
    if (player.ammos[player.wpn] > 0) startReload();
    else { playTone(200, 0.05, 0.1); player.fireCD = 0.3; }
    return;
  }
  player.clips[player.wpn]--; player.fireCD = w.cd; player.lastShot = gameTime;
  player.h = yaw;
  sndGun(w.id === 'shotgun' ? 1.3 : w.id === 'smg' ? 0.7 : 1);
  shake = Math.max(shake, w.shake);
  // 真实后坐力与准星扩散
  const rMul = mouseR ? 0.65 : 1;
  pitch = clamp(pitch - w.recoil * rMul, -0.6, 1.2);
  recoilPitch += w.recoil * rMul;
  yaw += rand(-w.recoil * 0.3, w.recoil * 0.3);
  recoilKick = Math.min(0.85, recoilKick + w.kick);
  bloom = Math.min(18, bloom + (w.id === 'shotgun' ? 12 : w.id === 'smg' ? 4.5 : 6));
  let muzzle;
  if (fpv) {
    camera.updateMatrixWorld();
    muzzle = fpvMuzzle.getWorldPosition(new THREE.Vector3());
  } else {
    player.hm.g.updateMatrixWorld();
    muzzle = player.hm.armR.localToWorld(new THREE.Vector3(0, -0.98, 0.06));
  }
  emit(muzzle.x, muzzle.y, muzzle.z, 0, 0, 0, '#ffe680', 0.18, 0.05);
  // 抛弹壳粒子
  if (w.id !== 'shotgun' || player.clips[player.wpn] >= 0) {
    const rx = -Math.cos(player.h), rz = Math.sin(player.h);
    emit(muzzle.x, muzzle.y + 0.05, muzzle.z, rx * rand(1.5, 2.8) + rand(-0.4, 0.4), rand(1.8, 3.0), rz * rand(1.5, 2.8) + rand(-0.4, 0.4), '#e5c158', 0.035, 0.45, -12);
  }
  const baseDir = new THREE.Vector3(); camera.getWorldDirection(baseDir);
  const spread = (mouseR ? 0.4 : 1) * w.spread + bloom * 0.0006;
  const minT = fpv ? 0.2 : camera.position.distanceTo(new THREE.Vector3(player.x, groundH(player.x, player.z) + player.y + 1.5, player.z)) + 0.5;
  let anyHit = false, anyHead = false;
  for (let pel = 0; pel < w.pellets; pel++) {
    _o.copy(camera.position);
    _d.copy(baseDir);
    _d.x += rand(-spread, spread); _d.y += rand(-spread, spread); _d.z += rand(-spread, spread); _d.normalize();
    let best = w.id === 'shotgun' ? 55 : 160, hit = { type: 'none' };
    for (const b of colliders) { const t = rayBox(_o, _d, b); if (t !== null && t > minT && t < best) { best = t; hit = { type: 'world' }; } }
    if (_d.y < 0) { const t = -_o.y / _d.y; if (t > minT && t < best) { best = t; hit = { type: 'world' }; } }
    for (const p of peds) {
      if (p.state === 'dead') continue;
      for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.25]]) {
        const t = raySphere(_o, _d, p.x, groundH(p.x, p.z) + y, p.z, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'ped', p, head: y > 1.6 }; }
      }
    }
    for (const bt of bounty.targets) {
      if (bt.dead) continue;
      for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.25]]) {
        const t = raySphere(_o, _d, bt.x, groundH(bt.x, bt.z) + y, bt.z, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'bounty', bt, head: y > 1.6 }; }
      }
    }
    for (const se of story.enemies) {
      if (se.dead) continue;
      for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.25]]) {
        const t = raySphere(_o, _d, se.x, groundH(se.x, se.z) + y, se.z, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'story', se, head: y > 1.6 }; }
      }
    }
    for (const c of cars) {
      if (c.wreck) continue;
      for (const [cx, cz] of carCircles(c)) {
        const t = raySphere(_o, _d, cx, 0.9, cz, 1.15);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'car', c }; }
      }
      if (c.copOut) for (const [y, r] of [[0.7, 0.45], [1.35, 0.4], [1.7, 0.25]]) {
        const t = raySphere(_o, _d, c.copX, y, c.copZ, r);
        if (t !== null && t > minT && t < best) { best = t; hit = { type: 'cop', c }; }
      }
    }
    for (const h of helis) {
      if (h.wreck) continue;
      const t = raySphere(_o, _d, h.x, h.y + 1.4, h.z, 2.3);
      if (t !== null && t > minT && t < best) { best = t; hit = { type: 'heli', h }; }
    }
    const pt = _o.clone().addScaledVector(_d, best);
    tracer(muzzle, pt);
    if (hit.type === 'ped') { damagePed(hit.p, hit.head ? w.headDmg : w.dmg, _d.x * 2, _d.z * 2, true); anyHit = true; if (hit.head) anyHead = true; }
    else if (hit.type === 'bounty') { damageBountyTarget(hit.bt, hit.head ? w.headDmg : w.dmg, _d.x * 2, _d.z * 2); anyHit = true; if (hit.head) anyHead = true; }
    else if (hit.type === 'story') { damageStoryEnemy(hit.se, hit.head ? w.headDmg : w.dmg, _d.x * 2, _d.z * 2); anyHit = true; if (hit.head) anyHead = true; }
    else if (hit.type === 'car') {
      damageCar(hit.c, w.dmg * 0.75, true);
      for (let i = 0; i < 3; i++) emit(pt.x, pt.y, pt.z, rand(-3, 3), rand(0, 3), rand(-3, 3), '#ffd070', 0.06, 0.3, -10);
      if (hit.c.police) setMinHeat(50);
      if (hit.c.driver === 'ai' && hit.c.ai) hit.c.ignoreT = 3;
    } else if (hit.type === 'heli') {
      damageHeli(hit.h, w.dmg * 0.7); anyHit = true;
      for (let i = 0; i < 3; i++) emit(pt.x, pt.y, pt.z, rand(-3, 3), rand(0, 3), rand(-3, 3), '#ffd070', 0.06, 0.3, -10);
    } else if (hit.type === 'cop') { killCop(hit.c, true); anyHit = true; }
    else if (hit.type === 'world') for (let i = 0; i < 2; i++) emit(pt.x, pt.y, pt.z, rand(-1, 1), rand(0, 2), rand(-1, 1), '#bbb', 0.06, 0.4, -6);
  }
  if (anyHit) { hitmarkerT = 0.14; hitmarkerHead = anyHead; sndHit(anyHead); }
  alertPeds(player.x, player.z, 28);
  if (policeNear(45)) setMinHeat(50);
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
  player.fireCD -= dt;
  if (player.punchT > 0) player.punchT -= dt;
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
    player.x = c.x; player.z = c.z; player.y = 0;
    chuteGroup.visible = false;
    player.laughT = 0; playerLaughGroup.visible = false;
    return;
  }
  if (player.inHeli) {
    const h = player.inHeli;
    player.x = h.x; player.z = h.z; player.y = Math.max(0, h.y - groundH(h.x, h.z));
    chuteGroup.visible = false;
    player.laughT = 0; playerLaughGroup.visible = false;
    return;
  }
  if (godActive()) {
    player.moving = false;
    player.laughT = 0; playerLaughGroup.visible = false;
    animHuman(hm, 0, 0);
    if (playerMascotRig) animMascotRig(playerMascotRig, 0, 0);
    customRoleRoot.visible = customRoleLoaded;
    for (const m of playerBaseBodyParts) m.visible = !customRoleLoaded;
    for (const m of playerBaseArmRParts) m.visible = !customRoleLoaded;
    wpnMeshes.forEach((m, i) => { if (m) m.visible = (i === player.wpn); });
    chuteGroup.visible = false;
    hm.g.visible = !fpv;
    return;
  }
  if (dialog.open) {
    player.moving = false;
    player.laughT = 0; playerLaughGroup.visible = false;
    customRoleRoot.visible = customRoleLoaded;
    for (const m of playerBaseBodyParts) m.visible = !customRoleLoaded;
    for (const m of playerBaseArmRParts) m.visible = !customRoleLoaded;
    wpnMeshes.forEach((m, i) => { if (m) m.visible = (i === player.wpn); });
    animHuman(hm, 0, 0);
    if (playerMascotRig) animMascotRig(playerMascotRig, 0, 0);
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
        const gBase = groundH(player.x, player.z) + player.y;
        for (let k = 0; k < 5; k++) {
          emit(player.x + rand(-0.22, 0.22), gBase + rand(0.9, 1.4), player.z + rand(-0.22, 0.22), rand(-0.35, 0.35), rand(0.8, 1.4), rand(-0.35, 0.35), '#8beede', 0.14, 0.9, 0.25, 0.14);
        }
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
    const lt = gameTime * 1.1 + 1.2;
    const sq = Math.sin(lt * 16) * 0.055;
    playerLaughGroup.rotation.x = Math.sin(lt * 16) * 0.14 - 0.05;
    playerLaughGroup.rotation.z = Math.sin(lt * 8.5) * 0.10;
    playerLaughGroup.position.y = Math.abs(Math.sin(lt * 12)) * 0.11;
    playerLaughGroup.scale.set(1 + sq, 1 - sq * 1.15, 1 + sq);
  }
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) { mx += fx; mz += fz; }
  if (keys.KeyS || keys.ArrowDown) { mx -= fx; mz -= fz; }
  if (keys.KeyD || keys.ArrowRight) { mx += rx; mz += rz; }
  if (keys.KeyA || keys.ArrowLeft) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  player.moving = len > 0;
  const aiming = !player.chute && (mouseR || gameTime - player.lastShot < 0.6);
  const spd = player.chute ? 9.0 : mouseR ? 3.2 : keys.ShiftLeft || keys.ShiftRight ? 10 : 5.2;
  if (len > 0) {
    mx /= len; mz /= len;
    player.x += mx * spd * dt; player.z += mz * spd * dt;
    player.phase += dt * spd * 2.2;
    bobPhase += dt * spd * 1.8;
    if (!aiming && !fpv) player.h += angDiff(player.h, Math.atan2(mx, mz)) * Math.min(1, dt * 12);
  }
  if (aiming || fpv) player.h = fpv ? yaw : player.h + angDiff(player.h, yaw) * Math.min(1, dt * 20);
  // 跳跃 / 高空跳伞滑翔 / 屋顶着陆
  const gH = groundH(player.x, player.z);
  const worldY = gH + player.y;
  const sup = (player.y > 0.5 || player.chute) ? heliSupportH(player.x, player.z, worldY, 0.45) : gH;
  const supRel = sup - gH;
  const onGround = !player.chute && player.y <= supRel + 0.05;
  if (player.chute) {
    player.vy = lerp(player.vy, -5.0, Math.min(1, dt * 4));
    player.y += player.vy * dt;
    if (player.y <= supRel + 0.05) {
      player.y = supRel; player.vy = 0; player.chute = false; chuteGroup.visible = false;
      showMsg('安全着陆！', 1.4);
    }
  } else {
    if (keys.Space && onGround && player.vy <= 0) player.vy = 5.5;
    if (keys.Space && !onGround && player.vy < -9 && player.y - supRel > 6) {
      player.chute = true; chuteGroup.visible = !fpv;
      showMsg('☂ 已开伞！WASD 滑翔控制落点', 2);
    }
    player.vy -= 15 * dt; player.y += player.vy * dt;
    if (player.y < supRel) {
      if (player.vy < -15) damagePlayer((-player.vy - 13) * 4.5);
      player.y = supRel; player.vy = 0;
    }
  }
  collideCircle(player, 0.45, groundH(player.x, player.z) + player.y);
  // 与车辆碰撞
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
  if (len > 0) bloom = Math.max(bloom, spd > 6 ? 7 : 3);
  // 动画
  animHuman(hm, player.phase, len > 0 ? (spd > 6 ? 1.2 : 0.8) : 0);
  if (playerMascotRig) {
    const moveAmt = len > 0 ? (spd > 6 ? 1.25 : 0.85) : 0;
    animMascotRig(playerMascotRig, player.phase, moveAmt, {
      sprint: spd > 6 && len > 0,
      aiming: aiming && !WEAPONS[player.wpn].melee,
      pitch,
      recoil: recoilKick,
      punch: player.punchT > 0,
      air: !onGround,
    });
    if (playerMascotRig.kind === 'whale') {
      // 持枪臂枢轴随姿态升降：瞄准时抬到胸前，平时垂在手边
      const aimNow = aiming && !WEAPONS[player.wpn].melee;
      hm.armR.position.y = lerp(hm.armR.position.y, aimNow ? 0.98 : 1.16, Math.min(1, dt * 12));
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
    fpvRig.visible = true;
    const aiming = mouseR && !dialog.open;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const gy = groundH(player.x, player.z) + player.y;
    const bobY = player.moving ? Math.sin(bobPhase) * 0.035 : 0;
    const bobX = player.moving ? Math.cos(bobPhase * 0.5) * 0.015 : 0;
    camera.position.set(player.x, gy + 1.66 + bobY, player.z);
    _look.set(player.x + fx * cp * 10, gy + 1.66 + bobY - sp * 10, player.z + fz * cp * 10);
    camera.lookAt(_look);
    targetFov = aiming ? 54 : 74;
    // 更新第一人称武器视图模型位置与动画
    const tx = aiming && !WEAPONS[player.wpn].melee ? 0.06 : 0.24;
    const ty = (aiming && !WEAPONS[player.wpn].melee ? -0.17 : -0.22) - (player.reloadT > 0 ? 0.14 : 0);
    const tz = (aiming && !WEAPONS[player.wpn].melee ? -0.38 : -0.45) + recoilKick * 0.08 - (player.punchT > 0 ? Math.sin(player.punchT / 0.22 * Math.PI) * 0.25 : 0);
    fpvHolder.position.x = lerp(fpvHolder.position.x, tx + bobX, Math.min(1, dt * 16));
    fpvHolder.position.y = lerp(fpvHolder.position.y, ty + bobY * 0.4, Math.min(1, dt * 16));
    fpvHolder.position.z = lerp(fpvHolder.position.z, tz, Math.min(1, dt * 20));
    fpvHolder.rotation.x = lerp(fpvHolder.rotation.x, recoilKick * 0.25 - (player.reloadT > 0 ? 0.45 : 0), Math.min(1, dt * 18));
  } else {
    fpvRig.visible = false;
    const aiming = mouseR && !player.dead;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
    camDistCur = lerp(camDistCur, aiming ? 2.8 : 5.2, Math.min(1, dt * 10));
    camShCur = lerp(camShCur, aiming ? 0.85 : 0.55, Math.min(1, dt * 10));
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const gy = groundH(player.x, player.z) + player.y;
    _from.set(player.x + rx * camShCur, gy + 1.65, player.z + rz * camShCur);
    _to.set(_from.x - fx * camDistCur * cp, _from.y + camDistCur * sp + 0.2, _from.z - fz * camDistCur * cp);
    camera.position.copy(camCollide(_from, _to));
    _look.set(_from.x + fx * cp * 10, _from.y - sp * 10 + 0.2, _from.z + fz * cp * 10);
    camera.lookAt(_look);
    targetFov = aiming ? 48 : 65;
  }
  if (shake > 0) {
    camera.position.x += rand(-1, 1) * shake * 0.3; camera.position.y += rand(-1, 1) * shake * 0.3;
    shake = Math.max(0, shake - dt * 2.5);
  }
  skyGroup.position.copy(camera.position);
  camera.near = fpv ? 0.15 : player.inHeli ? 0.6 : 0.25;
  camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 6));
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

  // 动态天空散射穹顶、太阳/月亮、星空与飘动云层
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
  sunDisc.position.copy(_sunDir).multiplyScalar(1050);
  sunDisc.visible = elev > -0.16;
  sunDiscMat.color.setRGB(1, 0.88 + 0.08 * day, 0.68 + 0.14 * day);
  moonDisc.position.copy(_sunDir).multiplyScalar(-1050);
  moonDisc.visible = elev < 0.16;
  starsMat.opacity = Math.max(clamp((night - 0.3) * 1.3, 0, 0.92), god.skyBlend * 0.85);
  cloudMat.color.copy(cloudNightCol).lerp(cloudDayCol, day).lerp(cloudDuskCol, dusk * 0.6);
  oceanMat.envMapIntensity = lerp(1.25, 0.35, night);
  updateClouds(dt);

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
    if (traffic < 24) spawnTraffic(Math.random() < 0.12, 95, 290);
    // 回收行人
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      const d2 = dist2(p.x, p.z, P.x, P.z);
      if (d2 > 160 * 160 || (p.state === 'dead' && p.deadT > 45)) removePed(p);
    }
    if (peds.filter(p => p.state !== 'dead').length < 38) spawnPed();
  }
  // 警察增援
  if (stars > 0 && !player.dead) {
    policeSpawnT -= dt;
    const desired = [0, 2, 3, 4, 5, 7][stars];
    const chasing = cars.filter(c => c.driver === 'police' && !c.wreck && c.hp > 0).length;
    if (chasing < desired && policeSpawnT <= 0) {
      policeSpawnT = 2.5;
      spawnTraffic(true, 80, 170);
    }
  }
}

/* ============================ 通缉更新 ============================ */
function updateWanted(dt) {
  stars = heat <= 0 ? 0 : Math.min(5, Math.ceil(heat / 50 - 1e-6));
  if (stars > 0 && !player.dead && !godActive()) {
    const P = playerAnchor();
    const seen = !(player.inHeli && player.inHeli.y > 65) && cars.some(c => c.police && c.driver === 'police' && !c.wreck && dist2(c.x, c.z, P.x, P.z) < 75 * 75 && !segBlocked(c.x, c.z, P.x, P.z));
    if (seen) lostT = 0;
    else {
      lostT += dt;
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
  // 任务点
  if (gameMode === 'free' && mission.active) {
    mmg.fillStyle = '#ffd400'; mmg.beginPath(); mmg.arc(mapX(mission.x), mapX(mission.z), 6 / zoom, 0, Math.PI * 2); mmg.fill();
  }
  // 剧情 NPC 与伏击敌人
  if (gameMode === 'free') {
    const tgtId = storyTargetId();
    for (const n of storyNpcs) {
      const isTgt = n.id === tgtId;
      mmg.fillStyle = isTgt ? '#ffd400' : '#38d9ff';
      mmg.beginPath(); mmg.arc(mapX(n.x), mapX(n.z), (isTgt ? 7 : 5.5) / zoom, 0, Math.PI * 2); mmg.fill();
      mmg.strokeStyle = '#000'; mmg.lineWidth = 1.2 / zoom; mmg.stroke();
      mmg.fillStyle = '#000'; mmg.font = `bold ${Math.max(8, Math.round(9 / zoom))}px sans-serif`;
      mmg.textAlign = 'center'; mmg.textBaseline = 'middle';
      mmg.fillText(n.mapTag, mapX(n.x), mapX(n.z));
    }
    for (const se of story.enemies) if (!se.dead) {
      mmg.fillStyle = '#c44dff'; mmg.beginPath(); mmg.arc(mapX(se.x), mapX(se.z), 5 / zoom, 0, Math.PI * 2); mmg.fill();
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
    if (aliveSe) { edgeTarget = aliveSe; edgeColor = '#c44dff'; }
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
function renderPhone() {
  hud.phone.style.display = phoneOpen ? 'block' : 'none';
  if (!phoneOpen) return;
  const hh = Math.floor(dayT * 24), mi = Math.floor((dayT * 24 - hh) * 60);
  hud.phTime.textContent = `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  const bribe = stars > 0 ? `$${stars * 200}` : '无通缉';
  setHTML(hud.phList, 'phList', `
    <div class="ph-it"><span>1. 刷新任务</span><b>免费</b></div>
    <div class="ph-it"><span>2. 贿赂消星</span><b>${bribe}</b></div>
    <div class="ph-it"><span>3. 呼叫跑车</span><b>$150</b></div>
    <div class="ph-it"><span>4. 补充弹药</span><b>$100</b></div>
    <div class="ph-it"><span>5. 呼叫直升机</span><b>$200</b></div>
    <div class="ph-it"><span>6. ${god.stage === 'transcended' ? '✦ 重温神临时刻' : '✦ 捷径：直通神临'}</span><b style="color:#ffd400">免费</b></div>
  `);
}
function phoneAction(n) {
  if (!phoneOpen || player.dead) return;
  if (n === 1) {
    mission.active = false; marker.visible = false; newMission(); phoneOpen = false;
  } else if (n === 2) {
    if (stars <= 0) { showMsg('当前没有通缉星级', 1.5); return; }
    const cost = stars * 200;
    if (player.money < cost) { showMsg(`金钱不足（需要 $${cost}）`, 2); return; }
    player.money -= cost; heat = 0; stars = 0; lostT = 0;
    showMsg(`花费 $${cost} 摆平了警察`, 2.5); sndPickup(); phoneOpen = false;
  } else if (n === 3) {
    if (player.money < 150) { showMsg('金钱不足（需要 $150）', 2); return; }
    const P = playerAnchor();
    const x = P.x + Math.sin(yaw) * 7, z = P.z + Math.cos(yaw) * 7;
    if (pointInBuilding(x, 1, z, 1.5)) { showMsg('附近空间太窄，换个空旷位置', 2); return; }
    player.money -= 150;
    const c = spawnCar(x, z, yaw, { kind: 'sport', driver: null });
    c.ai = null;
    showMsg('跑车已送达！', 2); sndPickup(); phoneOpen = false;
  } else if (n === 4) {
    if (player.money < 100) { showMsg('金钱不足（需要 $100）', 2); return; }
    player.money -= 100;
    player.ammos[1] += 51; player.ammos[2] += 90; player.ammos[3] += 24;
    showMsg('全武器弹药已补充！', 2); sndPickup(); phoneOpen = false;
  } else if (n === 5) {
    if (player.money < 200) { showMsg('金钱不足（需要 $200）', 2); return; }
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
    player.money -= 200;
    spawnHeli(sx, sz, yaw, { color: '#c62828', stripe: '#ffd43b' });
    showMsg('🚁 直升机已空降到前方！', 2.5); sndPickup(); phoneOpen = false;
  } else if (n === 6) {
    phoneOpen = false;
    triggerGodBackdoor();
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
  setHTML(hud.weapon, 'weapon', inVehicle() ? '' : w.melee ? `${w.icon} ${w.name}` : player.reloadT > 0 ? `${w.icon} ${w.name} <span style="color:#ffd400">换弹中...</span>` : `${w.icon} ${w.name} ${player.clips[player.wpn]} / ${player.ammos[player.wpn]}`);
  hud.hp.style.width = clamp(player.hp, 0, 100) + '%';
  hud.hp.style.background = player.hp < 30 ? '#e53935' : '';
  hud.armor.style.width = clamp(player.armor, 0, 100) + '%';
  hud.cross.style.display = inVehicle() || player.chute || player.dead ? 'none' : 'block';
  if (!inVehicle() && !player.chute && !player.dead) {
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
  if (player.inCar) {
    const c = player.inCar;
    const hpPct = Math.max(0, Math.round(c.hp / c.maxHp * 100));
    const cname = CAR_TYPES[c.kind]?.name || '车辆';
    const gLabel = c.gear === -1 ? 'R' : c.gear === 0 ? 'N' : String(c.gear);
    const rpmPct = Math.round(clamp((c.rpm - 800) / 6300, 0, 1) * 100);
    setHTML(hud.speedo, 'speedo', `${Math.round(Math.abs(c.speed) * 3.6)} <small>km/h</small><span class="gear-badge ${c.shiftFlashT > 0 ? 'shift' : ''}">${gLabel}</span><div class="rpm-wrap"><div class="rpm-fill ${c.rpm > 5800 ? 'red' : ''}" style="width:${rpmPct}%"></div></div><small style="color:${hpPct < 35 ? '#ff6050' : '#ccc'}">${cname} · 车况 ${hpPct}% · V 视角</small>`);
  } else if (player.inHeli) {
    const h = player.inHeli;
    const hpPct = Math.max(0, Math.round(h.hp / h.maxHp * 100));
    const hSpd = Math.round(Math.hypot(h.vx, h.vz) * 3.6);
    const alt = Math.max(0, Math.round(h.y));
    const rpmPct = Math.round(clamp(h.rotorRpm, 0, 1) * 100);
    setHTML(hud.speedo, 'speedo', `${hSpd} <small>km/h</small><span class="gear-badge">ALT ${alt}m</span><div class="rpm-wrap"><div class="rpm-fill ${h.rotorRpm > 0.85 ? 'red' : ''}" style="width:${rpmPct}%"></div></div><small style="color:${hpPct < 35 ? '#ff6050' : '#ccc'}">直升机 · 机体 ${hpPct}% · V视角 · F跳伞</small>`);
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
    setHTML(hud.mission, 'mission', `<b style="color:#ffd400">【${mission.type.name}】</b>${mission.type.text}<br>距离 ${d}m · 剩余 <b style="color:${mission.time < 15 ? '#ff5050' : '#fff'}">${Math.ceil(mission.time)}s</b> · 奖励 <b style="color:#7fdc6a">$${mission.reward}</b>`);
  } else hud.mission.style.display = 'none';
  if (hud.philoHud) {
    const pText = god.stage === 'transcended'
      ? '✦ 哲学境界：<b style="color:#ffd400">出神入化</b>（神本无相 · 6/6）'
      : (god.stage === 'ready' || godActive())
        ? '✦ <b style="color:#ffd400">神临已解锁！</b> 前往市中心金色光柱 (按 E)'
        : `🧠 哲思印记 <b>${philo.met.size}/${philo.total}</b> · 寻找紫色 <b style="color:#d8b4fe">Φ</b> 贤者（Shift+G 捷径）`;
    setHTML(hud.philoHud, 'philoHud', pText);
  }
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) hud.msg.style.opacity = 0; }
  flashA = Math.max(0, flashA - dt * 1.5);
  hud.flash.style.opacity = Math.max(flashA, player.hp < 25 && !player.dead ? 0.25 + Math.sin(gameTime * 6) * 0.15 : 0);
  // 提示
  if (!player.dead && !dialog.open && !godActive() && msgT <= 0) {
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
    const freq = 42 + r * 145 + (c.kind === 'sport' ? 22 : 0);
    engGain.gain.setTargetAtTime(c.shiftT > 0 ? 0.03 : 0.08, t, 0.05);
    engOsc.frequency.setTargetAtTime(freq, t, 0.04);
    engFilter.frequency.setTargetAtTime(280 + r * 620, t, 0.06);
  } else engGain.gain.setTargetAtTime(0, t, 0.1);
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
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F9'].includes(e.code)) e.preventDefault();
  if (!running || e.repeat) return;
  if (dialog.open) {
    if (e.code === 'KeyQ') { if (!dialog.isGod) closeDialog(); return; }
    if ((e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') && dialog.choices.length === 1) { chooseDialog(0); return; }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4') {
      chooseDialog(Number(e.code.slice(5)) - 1);
    }
    return;
  }
  if ((e.code === 'KeyG' && e.shiftKey) || e.code === 'F9') { triggerGodBackdoor(); return; }
  if (godActive()) return;
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
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4' || e.code === 'Digit5' || e.code === 'Digit6') {
    const n = Number(e.code.slice(5));
    if (phoneOpen) phoneAction(n);
    else if (!inVehicle() && n <= 4) switchWeapon(n - 1);
  }
});
document.addEventListener('wheel', e => {
  if (!running || dialog.open || inVehicle() || player.dead) return;
  switchWeapon(player.wpn + (e.deltaY > 0 ? 1 : -1));
}, { passive: true });
document.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('mousedown', e => {
  if (!running) { canvas.requestPointerLock(); return; }
  if (dialog.open) return;
  if (e.button === 0) mouseL = true;
  if (e.button === 2) mouseR = true;
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousemove', e => {
  if (!running || dialog.open) return;
  const mx = clamp(e.movementX, -150, 150), my = clamp(e.movementY, -150, 150);
  if (inVehicle()) {
    if (fpv) {
      carYawOff = clamp(carYawOff - mx * 0.0028, -1.45, 1.45);
      carPitchOff = clamp(carPitchOff + my * 0.0022, -0.35, 0.45);
    } else {
      carYawOff -= mx * 0.003;
    }
    lastMouseT = gameTime;
  } else { yaw -= mx * 0.0024; pitch = clamp(pitch + my * 0.0022, -0.6, 1.2); }
});
function startMode(mode) {
  initAudio();
  if (mode !== gameMode || !started) {
    gameMode = mode;
    if (mode === 'bounty') {
      mission.active = false; marker.visible = false;
      resetBountyRun();
      heat = 0; stars = 0; lostT = 0;
      showMsg('🎯 <b style="color:#ff4040">赏金猎人模式</b>：尽可能存活并消灭红点赏金目标！', 4.5);
    } else {
      clearBountyTargets();
      if (!started) showMsg('欢迎来到 <b style="color:#ffd400">卷心菜自由城</b>（卷心菜精心制作）！找辆车或去广场停机坪驾驶直升机 (F)，按 T 打开手机可随时呼叫跑车/直升机', 5);
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
// 出生点旁边停一辆跑车
{
  const c = spawnCar(roadC(6) + LANE + 0.8, SPAWN.z + 2, Math.PI, { kind: 'sport', driver: null });
  c.ai = null;
}
const HELI_LIVERIES = [
  { color: '#c62828', stripe: '#ffd43b' },
  { color: '#1565c0', stripe: '#f5f7fa' },
  { color: '#0f766e', stripe: '#fbbf24' },
];
helipads.forEach((hp, idx) => {
  if (idx < HELI_LIVERIES.length) spawnHeli(hp.x, hp.z, hp.rotY, HELI_LIVERIES[idx]);
});
for (let i = 0; i < 24; i++) spawnTraffic(Math.random() < 0.12, 25, 280);
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
