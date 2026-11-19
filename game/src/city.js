// Solara Bay: one deterministic, texture-driven city block grid on a 470 metre coast.
// buildCity(scene) is called once. Everything is generated from the seed in config and a few
// integer hashes, so two runs build the same streets, towers, palms and traffic lights.
//
// Budget: ~30 draw calls (one merged mesh per surface family), ~20 canvas textures at 128-256px,
// one InstancedMesh per prop family. No external files, no per-frame work after the build.
import {CITY, COLORS} from './config.js';

/* ------------------------------------------------------------------ frame */

const SIZE = CITY.size;          // 470
const ROAD = CITY.road;          // 11
const BLOCK = CITY.block;        // 34
const HALF = SIZE / 2;           // 235
const RH = ROAD / 2;             // 5.5
const CORE = 8.1;                // half width of a block's buildable core
const SEA_Z = -230;              // waterline
const BEACH_Z = -209.5;          // north edge of the coast road
const SOUTH = 236;
const ANISO = 4;

const LINES = [];                // road centre lines, -204 .. 204
const CENTERS = [];              // block centres, -187 .. 187
for (let i = -6; i <= 6; i++) LINES.push(i * BLOCK);
for (let i = 0; i < 12; i++) CENTERS.push(-187 + i * BLOCK);

const DISTRICTS = [
  {name: 'Downtown', color: 0x9dbbb2, center: {x: 0, z: 0}, bounds: {minX: -110, maxX: 110, minZ: -116, maxZ: 116}},
  {name: 'Docks', color: 0xc09a6d, center: {x: -172, z: 0}, bounds: {minX: -235, maxX: -110, minZ: -116, maxZ: 116}},
  {name: 'Suburbs', color: 0xe8c99b, center: {x: 0, z: 176}, bounds: {minX: -235, maxX: 235, minZ: 116, maxZ: 236}},
  {name: 'Industrial', color: 0xa0a294, center: {x: 172, z: 0}, bounds: {minX: 110, maxX: 235, minZ: -116, maxZ: 116}},
  {name: 'Beach Park', color: 0xf2d6a2, center: {x: -110, z: -174}, bounds: {minX: -235, maxX: 40, minZ: -235, maxZ: -116}},
  {name: 'Marina', color: 0xd0917a, center: {x: 140, z: -174}, bounds: {minX: 40, maxX: 235, minZ: -235, maxZ: -116}}
];

function districtAt(x, z) {
  if (z < -116) return x > 40 ? 'Marina' : 'Beach Park';
  if (z > 116) return 'Suburbs';
  if (x < -110) return 'Docks';
  if (x > 110) return 'Industrial';
  return 'Downtown';
}

/* ------------------------------------------------------- deterministic noise */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(i, j, salt) {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ---------------------------------------------------------------- textures */

const TEX_CACHE = {};
function canvasTexture(key, size, paint) {
  const cached = TEX_CACHE[key];
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d', {alpha: false});
  paint(g, size, mulberry32(0x51ed + key.length * 131));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
  TEX_CACHE[key] = t;
  return t;
}
function speckle(g, s, r, n, palette, alpha) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.35 + r() * 0.65);
    g.fillStyle = palette[(r() * palette.length) | 0];
    const w = 0.7 + r() * 1.9;
    g.fillRect(r() * s, r() * s, w, w);
  }
  g.globalAlpha = 1;
}

function makeTextures() {
  const T = {};
  T.asphalt = canvasTexture('asphalt', 256, (g, s, r) => {
    g.fillStyle = '#414849'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 2600, ['#5c6363', '#2f3637', '#6d7270', '#33393a', '#4a5152'], 0.5);
    for (let i = 0; i < 7; i++) {
      g.globalAlpha = 0.10;
      g.fillStyle = i % 2 ? '#2b3233' : '#596061';
      g.fillRect(r() * s, r() * s, 20 + r() * 70, 14 + r() * 52);
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(22,27,28,.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      let x = r() * s, y = r() * s;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 30; y += r() * 22; g.lineTo(x, y); }
      g.stroke();
    }
    // centre line dashes: the tile is 16 units long and 11 wide, u runs across the road
    g.fillStyle = '#e6d9ad';
    g.fillRect(s / 2 - 3, 18, 6, 44);
    g.fillRect(s / 2 - 3, s / 2 + 18, 6, 44);
    g.globalAlpha = 0.25; g.fillStyle = '#7d8482';
    g.fillRect(s / 2 - 1, 0, 2, s); g.globalAlpha = 1;
  });

  T.sidewalk = canvasTexture('sidewalk', 256, (g, s, r) => {
    g.fillStyle = '#a8a493'; g.fillRect(0, 0, s, s);
    const q = s / 2;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      g.fillStyle = (x + y) % 2 ? '#a29e8e' : '#ada898';
      g.fillRect(x * q + 2, y * q + 2, q - 4, q - 4);
      g.strokeStyle = 'rgba(86,84,74,.4)'; g.lineWidth = 2;
      g.strokeRect(x * q + 2, y * q + 2, q - 4, q - 4);
    }
    speckle(g, s, r, 1600, ['#8e8a7c', '#bdb8a5', '#7d7a6d'], 0.3);
    for (let i = 0; i < 8; i++) {
      g.globalAlpha = 0.07; g.fillStyle = '#5d5b50';
      g.beginPath(); g.arc(r() * s, r() * s, 4 + r() * 16, 0, 6.3); g.fill();
    }
    g.globalAlpha = 1;
  });

  T.plaza = canvasTexture('plaza', 256, (g, s, r) => {
    g.fillStyle = '#b3ada0'; g.fillRect(0, 0, s, s);
    const q = s / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = ['#b8b2a4', '#ada798', '#c0baab', '#a8a294'][(r() * 4) | 0];
      g.fillRect(x * q + 1, y * q + 1, q - 2, q - 2);
    }
    g.strokeStyle = 'rgba(120,117,105,.5)'; g.lineWidth = 1.5;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * q, 0); g.lineTo(i * q, s); g.stroke(); g.beginPath(); g.moveTo(0, i * q); g.lineTo(s, i * q); g.stroke(); }
    speckle(g, s, r, 900, ['#9a9587', '#c7c1b2'], 0.25);
  });

  T.sand = canvasTexture('sand', 256, (g, s, r) => {
    g.fillStyle = '#e2c496'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 5000, ['#d5b484', '#efd9ae', '#c9a878', '#f4e2bb'], 0.5);
    g.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      g.globalAlpha = 0.12 + r() * 0.1;
      g.strokeStyle = r() < 0.5 ? '#f6e6c2' : '#c4a173';
      g.beginPath();
      const y = r() * s;
      g.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin((x + i * 30) * 0.03) * 4);
      g.stroke();
    }
    g.globalAlpha = 1;
  });

  T.water = canvasTexture('water', 256, (g, s, r) => {
    g.fillStyle = '#2f7f88'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      g.globalAlpha = 0.05 + r() * 0.10;
      g.strokeStyle = r() < 0.55 ? '#8fd0c9' : '#1e5f68';
      g.lineWidth = 1 + r() * 2.5;
      const y = r() * s;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin((x + i * 41) * 0.045) * 5);
      g.stroke();
    }
    g.globalAlpha = 0.16; g.fillStyle = '#bfe7dd';
    for (let i = 0; i < 22; i++) g.fillRect(r() * s, r() * s, 6 + r() * 22, 1.5);
    g.globalAlpha = 1;
  });

  T.grass = canvasTexture('grass', 256, (g, s, r) => {
    g.fillStyle = '#4f7448'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 3000, ['#426a3d', '#5d8452', '#6b9159', '#3b5f37'], 0.55);
    g.lineWidth = 1;
    for (let i = 0; i < 500; i++) {
      g.globalAlpha = 0.25;
      g.strokeStyle = r() < 0.5 ? '#729a5f' : '#3a5a34';
      const x = r() * s, y = r() * s;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 3); g.stroke();
    }
    g.globalAlpha = 1;
  });

  // Facade tiles are 2 bays across x 2 floors: a 3.2m window bay.
  T.facadeGlass = canvasTexture('facadeGlass', 256, (g, s, r) => {
    g.fillStyle = '#31474d'; g.fillRect(0, 0, s, s);
    const q = s / 2;
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
      const x = bx * q, y = by * q;
      g.fillStyle = '#4a6165'; g.fillRect(x, y, q, q);
      const gx = x + 5, gy = y + 6, gw = q - 10, gh = q - 12;
      const v = r();
      const grad = g.createLinearGradient(gx, gy, gx + gw, gy + gh);
      if (v < 0.07) { grad.addColorStop(0, '#ffd89b'); grad.addColorStop(1, '#c3843f'); }
      else if (v < 0.17) { grad.addColorStop(0, '#a9dad4'); grad.addColorStop(1, '#5d8f95'); }
      else { grad.addColorStop(0, '#436f74'); grad.addColorStop(1, '#244046'); }
      g.fillStyle = grad; g.fillRect(gx, gy, gw, gh);
      g.globalAlpha = 0.16; g.fillStyle = '#d5efea';
      g.beginPath(); g.moveTo(gx, gy + gh); g.lineTo(gx + gw * 0.5, gy); g.lineTo(gx + gw * 0.78, gy); g.lineTo(gx, gy + gh * 0.58); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#1d3136';
      g.fillRect(gx + gw / 2 - 1.5, gy, 3, gh);
      g.fillRect(gx, gy + gh / 2 - 1.5, gw, 3);
      g.fillStyle = 'rgba(160,190,188,.25)'; g.fillRect(gx, gy, gw, 2);
    }
    g.fillStyle = 'rgba(18,32,36,.6)'; g.fillRect(0, 0, s, 3); g.fillRect(0, s / 2, s, 3);
  });

  T.facadeStone = canvasTexture('facadeStone', 256, (g, s, r) => {
    g.fillStyle = '#b8b1a2'; g.fillRect(0, 0, s, s);
    const q = s / 2;
    speckle(g, s, r, 900, ['#c4bdad', '#a9a293', '#cfc8b8'], 0.35);
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
      const x = bx * q, y = by * q;
      g.fillStyle = 'rgba(120,113,99,.35)'; g.fillRect(x + 6, y + 52, q - 12, 4);
      const gx = x + 17, gy = y + 16, gw = q - 34, gh = q - 52;
      g.fillStyle = '#5d6a6c'; g.fillRect(gx - 3, gy - 3, gw + 6, gh + 6);
      const lit = r() < 0.12;
      g.fillStyle = lit ? '#f2c383' : '#31484f';
      g.fillRect(gx, gy, gw, gh);
      if (!lit) { g.globalAlpha = 0.25; g.fillStyle = '#9dc2c0'; g.fillRect(gx, gy, gw, gh * 0.4); g.globalAlpha = 1; }
      g.fillStyle = '#8c8677'; g.fillRect(gx - 5, gy + gh + 3, gw + 10, 5);
      g.fillStyle = 'rgba(40,52,54,.5)'; g.fillRect(gx + gw / 2 - 1, gy, 2, gh);
    }
    g.fillStyle = 'rgba(150,143,128,.5)'; g.fillRect(0, 0, s, 4); g.fillRect(0, s / 2, s, 4);
  });

  T.facadeStucco = canvasTexture('facadeStucco', 256, (g, s, r) => {
    g.fillStyle = '#e9dcc4'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 1400, ['#ded0b6', '#f2e6d0', '#d6c7ab'], 0.4);
    const q = s / 2;
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
      const x = bx * q, y = by * q;
      const gx = x + 30, gy = y + 24, gw = q - 60, gh = q - 56;
      g.fillStyle = '#3f4f50'; g.fillRect(gx - 2, gy - 2, gw + 4, gh + 4);
      const lit = r() < 0.08;
      g.fillStyle = lit ? '#f7c98f' : '#54706f';
      g.fillRect(gx, gy, gw, gh);
      g.fillStyle = '#f6efdf'; g.fillRect(gx - 4, gy + gh / 2 - 1.5, gw + 8, 3);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(gx, gy, gw, 2);
      g.fillStyle = '#cdbfa6'; g.fillRect(gx - 5, gy + gh + 3, gw + 10, 4);
    }
    g.fillStyle = 'rgba(180,166,140,.45)'; g.fillRect(0, 0, s, 3); g.fillRect(0, s / 2, s, 3);
  });

  T.facadeBrick = canvasTexture('facadeBrick', 256, (g, s, r) => {
    g.fillStyle = '#8f5342'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 8) {
      for (let x = (y / 8) % 2 ? -6 : 0; x < s; x += 16) {
        g.fillStyle = ['#9a5d4a', '#8a4f3f', '#a4664f', '#7f4838'][(r() * 4) | 0];
        g.fillRect(x + 1, y + 1, 14, 6);
      }
      g.fillStyle = 'rgba(212,196,178,.55)'; g.fillRect(0, y, s, 1);
    }
    const q = s / 2;
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
      const x = bx * q, y = by * q;
      const gx = x + 26, gy = y + 22, gw = q - 52, gh = q - 50;
      g.fillStyle = '#d8cdb8'; g.fillRect(gx - 5, gy - 5, gw + 10, gh + 10);
      const lit = r() < 0.1;
      g.fillStyle = lit ? '#f4c085' : '#3b5155';
      g.fillRect(gx, gy, gw, gh);
      g.fillStyle = '#cdbfa4'; g.fillRect(gx - 4, gy - 12, gw + 8, 5);
      g.fillStyle = 'rgba(30,44,46,.45)'; g.fillRect(gx, gy, gw, 2);
    }
    g.fillStyle = 'rgba(50,34,30,.45)'; g.fillRect(0, 0, s, 4); g.fillRect(0, s / 2, s, 4);
  });

  T.corrugated = canvasTexture('corrugated', 256, (g, s, r) => {
    g.fillStyle = '#8d9391'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 8) {
      g.fillStyle = (x / 8) % 2 ? '#969c99' : '#7f8583';
      g.fillRect(x, 0, 8, s);
      g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x + 1, 0, 2, s);
      g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x + 6, 0, 2, s);
    }
    for (let i = 0; i < 26; i++) {
      g.globalAlpha = 0.05 + r() * 0.09;
      g.fillStyle = r() < 0.5 ? '#6f5138' : '#4c5350';
      g.fillRect(((r() * s) | 0) & ~7, r() * s * 0.6, 3 + r() * 4, 20 + r() * 90);
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(60,66,64,.5)';
    for (let y = 4; y < s; y += 32) for (let x = 4; x < s; x += 16) g.fillRect(x, y, 2, 2);
  });

  T.roofGravel = canvasTexture('roofGravel', 128, (g, s, r) => {
    g.fillStyle = '#6d6c65'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 2200, ['#7c7b73', '#5a5953', '#88867d', '#4f4e49'], 0.6);
    g.strokeStyle = 'rgba(48,48,44,.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
    for (let i = 0; i < 4; i++) {
      g.globalAlpha = 0.10; g.fillStyle = '#8d8b80';
      g.fillRect(r() * s, r() * s, 20 + r() * 40, 14 + r() * 30);
    }
    g.globalAlpha = 1;
  });

  T.roofTile = canvasTexture('roofTile', 128, (g, s, r) => {
    g.fillStyle = '#a86048'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 12) {
      g.fillStyle = '#8e4d38'; g.fillRect(0, y + 9, s, 3);
      for (let x = (y / 12) % 2 ? -8 : 0; x < s; x += 16) {
        g.fillStyle = ['#b5664b', '#a85c43', '#c07253', '#9a523c'][(r() * 4) | 0];
        g.fillRect(x + 1, y + 1, 14, 8);
        g.fillStyle = 'rgba(255,220,190,.18)'; g.fillRect(x + 1, y + 1, 14, 2);
      }
    }
    speckle(g, s, r, 400, ['#7d4533', '#c8805f'], 0.25);
  });

  T.roofMetal = canvasTexture('roofMetal', 128, (g, s, r) => {
    g.fillStyle = '#7d827e'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 8) { g.fillStyle = (x / 8) % 2 ? '#878c88' : '#727773'; g.fillRect(x, 0, 8, s); }
    for (let i = 0; i < 14; i++) { g.globalAlpha = 0.08; g.fillStyle = '#5d4b38'; g.fillRect(r() * s, r() * s, 4 + r() * 14, 6 + r() * 30); }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(60,64,60,.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  });

  T.boardwalk = canvasTexture('boardwalk', 256, (g, s, r) => {
    for (let i = 0; i < 8; i++) {
      const y = i * 32;
      g.fillStyle = ['#9a7c58', '#8d704f', '#a5855f', '#94764f'][(r() * 4) | 0];
      g.fillRect(0, y, s, 30);
      g.fillStyle = 'rgba(58,44,30,.7)'; g.fillRect(0, y + 30, s, 2);
      g.globalAlpha = 0.25;
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = r() < 0.5 ? '#6f5638' : '#b8996f';
        g.beginPath(); const yy = y + 3 + r() * 24; g.moveTo(0, yy); g.lineTo(s, yy + (r() - 0.5) * 3); g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(40,32,22,.6)';
      g.fillRect(6, y + 6, 2, 2); g.fillRect(s - 8, y + 6, 2, 2);
      g.fillRect(6, y + 22, 2, 2); g.fillRect(s - 8, y + 22, 2, 2);
    }
  });

  T.concrete = canvasTexture('concrete', 128, (g, s, r) => {
    g.fillStyle = '#b2afa4'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 1400, ['#a5a297', '#c1beb2', '#96948a'], 0.4);
    g.strokeStyle = 'rgba(120,117,108,.4)'; g.lineWidth = 1.5;
    g.strokeRect(2, 2, s - 4, s - 4);
    for (let i = 0; i < 5; i++) {
      g.globalAlpha = 0.08; g.fillStyle = '#6f6d64';
      g.beginPath(); g.arc(r() * s, r() * s, 4 + r() * 14, 0, 6.3); g.fill();
    }
    g.globalAlpha = 1;
  });

  // Four in-world ads in one 256px atlas (2x2 quadrants of 128).
  T.ads = canvasTexture('ads', 256, (g, s) => {
    const ad = (x, y, bg, fg, accent, lines) => {
      g.fillStyle = bg; g.fillRect(x, y, 128, 128);
      g.fillStyle = accent; g.fillRect(x, y, 128, 12);
      g.fillStyle = accent; g.fillRect(x, y + 116, 128, 12);
      g.fillStyle = fg;
      g.textAlign = 'center';
      lines.forEach((t, i) => {
        g.font = i === 0 ? '800 27px system-ui, sans-serif' : '600 17px system-ui, sans-serif';
        g.fillText(t, x + 64, y + 44 + i * 28, 116);
      });
      g.fillStyle = accent;
      g.fillRect(x + 18, y + 100, 92, 3);
    };
    ad(0, 0, '#10232b', '#ffe6b0', '#e8a34b', ['NIGHT', 'FREIGHT CO.']);
    ad(128, 0, '#2a1030', '#ffd9f2', '#ff5fa8', ['VICE 88.1', 'ALL NIGHT']);
    ad(0, 128, '#12282a', '#ffe9c0', '#57c7bd', ['PELICAN', 'MOTEL · VACANCY']);
    ad(128, 128, '#301a12', '#ffdca8', '#ff8a4c', ['SALT & IRON', 'MARINA BAR']);
  });

  return T;
}

/* ------------------------------------------------------------------ material */

let MAT = null;
function materials() {
  if (MAT) return MAT;
  const T = makeTextures();
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  MAT = {
    road: std({map: T.asphalt, roughness: 0.95, metalness: 0.0, vertexColors: true}),
    walk: std({map: T.sidewalk, roughness: 0.92, vertexColors: true}),
    plaza: std({map: T.plaza, roughness: 0.9, vertexColors: true}),
    sand: std({map: T.sand, roughness: 0.98, vertexColors: true}),
    water: std({map: T.water, color: 0x9fd8d6, roughness: 0.42, metalness: 0.15}),
    pool: std({color: 0x3d8f9c, roughness: 0.16, metalness: 0.3}),
    grass: std({map: T.grass, roughness: 0.95, vertexColors: true}),
    paint: std({color: 0xeee0b6, roughness: 0.85}),
    board: std({map: T.boardwalk, roughness: 0.9, vertexColors: true}),
    glass: std({map: T.facadeGlass, roughness: 0.38, metalness: 0.28, vertexColors: true}),
    stone: std({map: T.facadeStone, roughness: 0.8, metalness: 0.04, vertexColors: true}),
    stucco: std({map: T.facadeStucco, roughness: 0.86, vertexColors: true}),
    brick: std({map: T.facadeBrick, roughness: 0.88, vertexColors: true}),
    metal: std({map: T.corrugated, roughness: 0.62, metalness: 0.35, vertexColors: true}),
    concrete: std({map: T.concrete, roughness: 0.9, vertexColors: true}),
    roofDark: std({map: T.roofGravel, roughness: 0.95, vertexColors: true}),
    roofTile: std({map: T.roofTile, roughness: 0.9, vertexColors: true}),
    roofMetal: std({map: T.roofMetal, roughness: 0.6, metalness: 0.35, vertexColors: true}),
    ads: new THREE.MeshBasicMaterial({map: T.ads, side: THREE.DoubleSide})
  };
  MAT.ads.map.repeat.set(1, 1);
  return MAT;
}

/* --------------------------------------------------------------- geometry */

function emptyGeo() { return {p: [], n: [], u: [], c: [], i: []}; }

// One quad, with explicit UVs, a flat normal and a flat colour. Winding is CCW from outside.
function quadRaw(b, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz,
  au, av, bu, bv, cu, cv, du, dv, nx, ny, nz, cr, cg, cb) {
  const k = b.p.length / 3;
  b.p.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
  b.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
  b.u.push(au, av, bu, bv, cu, cv, du, dv);
  b.c.push(cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb);
  b.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
}
function triRaw(b, ax, ay, az, bx, by, bz, cx, cy, cz,
  au, av, bu, bv, cu, cv, nx, ny, nz, cr, cg, cb) {
  const k = b.p.length / 3;
  b.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  b.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  b.u.push(au, av, bu, bv, cu, cv);
  b.c.push(cr, cg, cb, cr, cg, cb, cr, cg, cb);
  b.i.push(k, k + 1, k + 2);
}

// Four walls of an axis-aligned box; uv runs in world units so window bays never stretch.
function boxSides(b, x0, x1, y0, y1, z0, z1, c, tile, uo, vo) {
  const w = x1 - x0, d = z1 - z0, h = y1 - y0, k = 1 / tile;
  const cr = c[0], cg = c[1], cb = c[2];
  quadRaw(b, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
    uo, vo, uo + w * k, vo, uo + w * k, vo + h * k, uo, vo + h * k, 0, 0, 1, cr, cg, cb);
  quadRaw(b, x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0,
    uo, vo, uo + w * k, vo, uo + w * k, vo + h * k, uo, vo + h * k, 0, 0, -1, cr, cg, cb);
  quadRaw(b, x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1,
    uo, vo, uo + d * k, vo, uo + d * k, vo + h * k, uo, vo + h * k, 1, 0, 0, cr, cg, cb);
  quadRaw(b, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0,
    uo, vo, uo + d * k, vo, uo + d * k, vo + h * k, uo, vo + h * k, -1, 0, 0, cr, cg, cb);
}
function boxTop(b, x0, x1, y, z0, z1, c, tile, ox, oz) {
  const k = 1 / tile;
  ox = ox || 0; oz = oz || 0;
  quadRaw(b, x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0,
    x0 * k + ox, z0 * k + oz, x0 * k + ox, z1 * k + oz, x1 * k + ox, z1 * k + oz, x1 * k + ox, z0 * k + oz,
    0, 1, 0, c[0], c[1], c[2]);
}
// Ground rectangle with uv in world units.
function groundQuad(b, x0, x1, z0, z1, y, tile, c) {
  const k = 1 / tile;
  quadRaw(b, x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0,
    x0 * k, z0 * k, x0 * k, z1 * k, x1 * k, z1 * k, x1 * k, z0 * k,
    0, 1, 0, c[0], c[1], c[2]);
}

// Colour helpers (three multiplies vertex colour into the map).
const COL_CACHE = {};
function col(hex) {
  let c = COL_CACHE[hex];
  if (!c) { const t = new THREE.Color(hex); c = COL_CACHE[hex] = [t.r, t.g, t.b]; }
  return c;
}
const TINTS_G = [col(0xffffff), col(0xdfe9e6), col(0xc9d8d6), col(0xf0e6d2), col(0xb9cfd0), col(0xf6efe4)];
const TINTS_S = [col(0xffffff), col(0xe8dcc4), col(0xd9c9ae), col(0xf2e7d1), col(0xcfc6b4), col(0xe4d3b4)];
const HOUSE_TINTS = [col(0xf6e6cd), col(0xe8cbb0), col(0xf2d9a8), col(0xd8e2d2), col(0xf0c7b4), col(0xe2d5c0), col(0xcfdfe0)];
const PASTELS = [col(0xf2c9a0), col(0xd7e2cf), col(0xf0b9a3), col(0xe8d9b0), col(0xc4d9d4), col(0xf4dcc0)];
const ROOF_TINTS = [col(0xffffff), col(0xe8d2c0), col(0xd6c0ac), col(0xf0ddca)];
const CONTAINERS = [0xc65a3e, 0x3f7f8c, 0xcf9a3a, 0x4c6f52, 0x8b4a5e, 0xb6b3a6, 0x2f5f8a, 0xd9d3c2];
const AWNING_COLS = [col(0xd4573f), col(0x2f8b86), col(0xe0a03a), col(0x8a5a9b), col(0x3f6f9c)];
const LEAF = [col(0x4f7a45), col(0x63894b), col(0x486b3e), col(0x77995a)];
const FROND = [col(0x6d8f46), col(0x7d9c4e), col(0x5f803e), col(0x8aa85a)];
const CAR_COLS = [0xd6553f, 0x3f6f9c, 0xd9c274, 0x8f9a8c, 0xe8e3d8, 0x26343a, 0x7a3f52];

/* --------------------------------------------------------------- city state */

let SCENE = null;
let B = null;
let INST = null;
let COLLIDERS = null;
let WALKS = null;
let TLIGHTS = null;
let MARKS = null;
let COUNT = 0;

function collider(minX, minZ, maxX, maxZ, minY, maxY) {
  COLLIDERS.push({minX, maxX, minZ, maxZ, minY, maxY});
}
function addInst(kind, x, y, z, sx, sy, sz, color, ry, rx, rz) {
  INST[kind].push({x, y, z, sx, sy, sz, c: color, ry: ry || 0, rx: rx || 0, rz: rz || 0});
}
function propBox(x, z, y0, w, h, d, color, ry, rx, rz) {
  addInst('box', x, y0 + h / 2, z, w, h, d, color, ry, rx, rz);
}
function propCyl(x, z, y0, dia, h, color) {
  addInst('cyl', x, y0 + h / 2, z, dia, h, dia, color);
}
function propCone(x, z, y0, dia, h, color) {
  addInst('cone', x, y0 + h / 2, z, dia, h, dia, color);
}

/* ------------------------------------------------------------- small props */

function lamp(x, z, dx, dz) {
  propCyl(x, z, 0, 0.26, 6.2, 0x333d40);
  const ry = Math.atan2(-dz, dx);
  propBox(x + dx * 0.95, z + dz * 0.95, 5.9, 1.9, 0.16, 0.22, 0x333d40, ry);
  addInst('bulb', x + dx * 1.75, 5.78, z + dz * 1.75, 0.55, 0.34, 0.55, 0xffd79a);
  propBox(x, z, 0, 0.5, 0.12, 0.5, 0x2c3538);
}

function bench(x, z, ry) {
  const c = 0x6b5236;
  propBox(x, z, 0.42, 2.2, 0.14, 0.62, c, ry);
  propBox(x - Math.sin(ry) * 0.26, z - Math.cos(ry) * 0.26, 0.56, 2.2, 0.5, 0.1, c, ry);
  const ox = Math.cos(ry) * 0.85, oz = -Math.sin(ry) * 0.85;
  propBox(x - ox, z - oz, 0, 0.12, 0.44, 0.5, 0x3a3d3a, ry);
  propBox(x + ox, z + oz, 0, 0.12, 0.44, 0.5, 0x3a3d3a, ry);
}

function bin(x, z) {
  propCyl(x, z, 0, 0.62, 0.95, 0x3e5146);
  propCyl(x, z, 0.95, 0.7, 0.1, 0x2c3a33);
}

function hydrant(x, z) {
  propCyl(x, z, 0, 0.34, 0.72, 0xb8452f);
  propBox(x, z, 0.72, 0.62, 0.12, 0.2, 0xb8452f);
  propCyl(x, z, 0.84, 0.2, 0.12, 0x8f3324);
}

function planter(x, z, salt) {
  propBox(x, z, 0, 1.7, 0.62, 1.7, 0x9c988c);
  addInst('sphere', x, 0.95, z, 1.7, 1.3, 1.7, LEAF[(hash3(salt, 1, 17) * LEAF.length) | 0]);
}

function tree(x, z, salt) {
  const h = 3.2 + hash3(salt, 1, 151) * 2.4;
  propCyl(x, z, 0, 0.34, h, 0x6d5138);
  const s = 2.4 + hash3(salt, 2, 157) * 1.6;
  addInst('sphere', x, h + s * 0.32, z, s * 1.1, s * 1.25, s * 1.1,
    LEAF[(hash3(salt, 3, 163) * LEAF.length) | 0]);
}

function palm(x, z, salt) {
  const h = 5.4 + hash3(salt, 1, 171) * 4.6;
  addInst('cyl', x, h / 2, z, 0.4, h, 0.4, 0x8b6f4e);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + hash3(salt, k, 173) * 0.55;
    addInst('frond', x, h - 0.25, z, 1, 1, 1, FROND[(hash3(salt, k, 177) * FROND.length) | 0], a);
  }
  addInst('sphere', x, h - 0.15, z, 0.55, 0.45, 0.55, 0x6b5a3a);
}

/* -------------------------------------------------------------- blocks */

function sidewalkRing(cx, cz) {
  const o = 11.5, i = CORE, y = 0.16;
  const c = col(0xffffff);
  const parts = [
    [cx - o, cx + o, cz - o, cz - i],
    [cx - o, cx + o, cz + i, cz + o],
    [cx - o, cx - i, cz - i, cz + i],
    [cx + i, cx + o, cz - i, cz + i]
  ];
  for (const p of parts) {
    boxSides(B.walk, p[0], p[1], 0, y, p[2], p[3], c, 2.4, 0, 0);
    boxTop(B.walk, p[0], p[1], y, p[2], p[3], c, 2.4);
  }
  WALKS.push({x: cx, z: cz, minX: cx - o, maxX: cx + o, minZ: cz - o, maxZ: cz + o, y});
}

function plazaPave(cx, cz) {
  groundQuad(B.plaza, cx - CORE, cx + CORE, cz - CORE, cz + CORE, 0.03, 3, col(0xffffff));
}
function grassPave(cx, cz) {
  groundQuad(B.grass, cx - CORE, cx + CORE, cz - CORE, cz + CORE, 0.03, 7, col(0xffffff));
}

/* ------------------------------------------------------------- downtown */

function tower(cx, cz, w, d, h, seed, core) {
  const glassy = hash3(seed, 3, 41) < 0.52;
  const b = glassy ? B.glass : B.stone;
  const tint = TINTS_G[(hash3(seed, 4, 43) * TINTS_G.length) | 0];
  const uo = hash3(seed, 5, 47) * 9;
  const pw = w + 1.1, pd = d + 1.1;
  const podH = 4.2 + hash3(seed, 6, 49) * 2.4;

  boxSides(b, cx - pw / 2, cx + pw / 2, 0, podH, cz - pd / 2, cz + pd / 2, tint, 6.4, uo, 0);
  boxTop(B.roofDark, cx - pw / 2, cx + pw / 2, podH, cz - pd / 2, cz + pd / 2, col(0x8b8a80), 4);
  // shopfront band on the podium so the base does not read as a blank plinth
  propBox(cx, cz + pd / 2 + 0.1, 0, pw * 0.92, 3.0, 0.18, 0x2f3f42);

  const h1 = Math.max(podH + 5, h * (0.5 + hash3(seed, 7, 53) * 0.2));
  boxSides(b, cx - w / 2, cx + w / 2, podH, h1, cz - d / 2, cz + d / 2, tint, 6.4, uo, 0);
  boxTop(B.roofDark, cx - w / 2, cx + w / 2, h1, cz - d / 2, cz + d / 2, col(0x83827a), 4);

  const w2 = w * (0.74 + hash3(seed, 8, 59) * 0.1);
  const d2 = d * (0.74 + hash3(seed, 8, 59) * 0.1);
  const h2 = Math.min(h - 3, h1 + (h - h1) * 0.55);
  if (h2 > h1 + 2) {
    boxSides(b, cx - w2 / 2, cx + w2 / 2, h1, h2, cz - d2 / 2, cz + d2 / 2, tint, 6.4, uo, 0);
    boxTop(B.roofDark, cx - w2 / 2, cx + w2 / 2, h2, cz - d2 / 2, cz + d2 / 2, col(0x83827a), 4);
  }
  const w3 = w2 * 0.66, d3 = d2 * 0.66;
  if (h > h2 + 2.5) {
    boxSides(b, cx - w3 / 2, cx + w3 / 2, h2, h, cz - d3 / 2, cz + d3 / 2, tint, 6.4, uo, 0);
    boxTop(B.roofDark, cx - w3 / 2, cx + w3 / 2, h, cz - d3 / 2, cz + d3 / 2, col(0x83827a), 4);
    // crown band
    boxSides(B.concrete, cx - w3 / 2 - 0.35, cx + w3 / 2 + 0.35, h - 1.1, h + 0.45,
      cz - d3 / 2 - 0.35, cz + d3 / 2 + 0.35, col(0xd8d4c8), 4, 0, 0);
    boxTop(B.concrete, cx - w3 / 2 - 0.35, cx + w3 / 2 + 0.35, h + 0.45,
      cz - d3 / 2 - 0.35, cz + d3 / 2 + 0.35, col(0xd8d4c8), 4);
  }

  const roofY = h + (h > h2 + 2.5 ? 0.45 : 0);
  const units = 1 + ((hash3(seed, 9, 61) * 3) | 0);
  for (let k = 0; k < units; k++) {
    const bx = cx + (hash3(seed, 10 + k, 67) - 0.5) * Math.max(1, w3 - 3);
    const bz = cz + (hash3(seed, 20 + k, 71) - 0.5) * Math.max(1, d3 - 3);
    propBox(bx, bz, roofY, 1.5 + hash3(seed, k, 73) * 1.7, 0.9 + hash3(seed, k, 79) * 0.9, 1.4, 0x9a9c95);
  }
  if (h > 46 && hash3(seed, 8, 79) < 0.8) {
    const ah = 7 + hash3(seed, 11, 83) * 9;
    propBox(cx, cz, roofY + 0.9, 0.2, ah, 0.2, 0x8a8d86);
    addInst('bulb', cx, roofY + 0.9 + ah, cz, 0.42, 0.42, 0.42, 0xff6a5a);
  }
  if (!glassy && h > 12 && h < 48 && hash3(seed, 13, 89) < 0.55) {
    for (let y = 6; y < h - 2.5; y += 3.4) {
      propBox(cx, cz + d / 2 + 0.6, y, w * 0.44, 0.12, 1.15, 0x3c3f3d);
      propBox(cx, cz + d / 2 + 1.12, y + 0.55, w * 0.44, 0.95, 0.08, 0x3c3f3d);
    }
  }
  collider(cx - pw / 2, cz - pd / 2, cx + pw / 2, cz + pd / 2, 0, h);
  COUNT++;
}

function downtownBlock(cx, cz, i, j) {
  plazaPave(cx, cz);
  if (i === 5 && j === 5) { viceTower(cx, cz); return; }
  const core = Math.abs(cx) < 72 && Math.abs(cz) < 72;
  const r = (k) => hash3(i, j, 100 + k);
  const p = r(1);
  if (p < 0.46) {
    const w = 10.4 + r(3) * 4.4, d = 10.4 + r(4) * 4.4;
    const h = core ? 44 + r(5) * 48 : 17 + r(6) * 24;
    tower(cx + (r(7) - 0.5) * 1.2, cz + (r(8) - 0.5) * 1.2, w, d, h, i * 97 + j, core);
  } else if (p < 0.78) {
    const h1 = core ? 34 + r(9) * 40 : 14 + r(10) * 20;
    const h2 = core ? 30 + r(11) * 46 : 14 + r(12) * 22;
    tower(cx - 4.3, cz + (r(13) - 0.5) * 0.6, 7.2, 13.2, h1, i * 97 + j + 1, core);
    tower(cx + 4.3, cz + (r(14) - 0.5) * 0.6, 7.2, 13.2, h2, i * 97 + j + 2, core);
  } else {
    for (let a = 0; a < 2; a++) for (let bb = 0; bb < 2; bb++) {
      const h = core ? 22 + r(15 + a * 2 + bb) * 34 : 11 + r(15 + a * 2 + bb) * 15;
      tower(cx - 4.3 + a * 8.6, cz - 4.3 + bb * 8.6, 7.4, 7.4, h, i * 97 + j + 3 + a * 2 + bb, false);
    }
  }
}

function viceTower(cx, cz) {
  const b = B.glass;
  const tint = col(0xd8ece8);
  boxSides(b, cx - 8, cx + 8, 0, 12, cz - 8, cz + 8, tint, 6.4, 2.2, 0);
  boxSides(B.stone, cx - 8.4, cx + 8.4, 0, 1.4, cz - 8.4, cz + 8.4, col(0xd6cfbd), 4, 0, 0);
  boxTop(B.roofDark, cx - 8.4, cx + 8.4, 12, cz - 8.4, cz + 8.4, col(0x87867d), 4);
  boxSides(b, cx - 6.4, cx + 6.4, 12, 58, cz - 6.4, cz + 6.4, tint, 6.4, 2.2, 0);
  boxTop(B.roofDark, cx - 6.4, cx + 6.4, 58, cz - 6.4, cz + 6.4, col(0x87867d), 4);
  boxSides(b, cx - 5.1, cx + 5.1, 58, 88, cz - 5.1, cz + 5.1, tint, 6.4, 2.2, 0);
  boxTop(B.roofDark, cx - 5.1, cx + 5.1, 88, cz - 5.1, cz + 5.1, col(0x87867d), 4);
  boxSides(b, cx - 3.6, cx + 3.6, 88, 106, cz - 3.6, cz + 3.6, tint, 6.4, 2.2, 0);
  boxSides(B.concrete, cx - 4.1, cx + 4.1, 104.5, 107.2, cz - 4.1, cz + 4.1, col(0xe2dccb), 4, 0, 0);
  boxTop(B.concrete, cx - 4.1, cx + 4.1, 107.2, cz - 4.1, cz + 4.1, col(0xe2dccb), 4);
  propCyl(cx, cz, 107.2, 1.0, 10, 0xb9bdb6);
  propBox(cx, cz, 116, 0.25, 9, 0.25, 0xd9d6cc);
  addInst('bulb', cx, 125.4, cz, 0.7, 0.7, 0.7, 0xff6a5a);
  // plaza furniture around the tower
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    planter(cx + Math.cos(a) * 6.4, cz + Math.sin(a) * 6.4, k + 40);
  }
  collider(cx - 8.4, cz - 8.4, cx + 8.4, cz + 8.4, 0, 126);
  COUNT++;
  MARKS.push({name: 'Vice Tower', x: cx, z: cz, district: 'Downtown'});
}

/* -------------------------------------------------------------- suburbs */

function gableRoof(cx, cz, w, d, y0, rise, c, wallBuf, wallTint) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, zc = cz, yr = y0 + rise;
  const len = Math.hypot(d / 2, rise), ny = (d / 2) / len, nz = rise / len, t = 2.2;
  quadRaw(B.roofTile, x0, y0, z1, x1, y0, z1, x1, yr, zc, x0, yr, zc,
    x0 / t, 0, x1 / t, 0, x1 / t, len / t, x0 / t, len / t, 0, ny, nz, c[0], c[1], c[2]);
  quadRaw(B.roofTile, x1, y0, z0, x0, y0, z0, x0, yr, zc, x1, yr, zc,
    x1 / t, 0, x0 / t, 0, x0 / t, len / t, x1 / t, len / t, 0, ny, -nz, c[0], c[1], c[2]);
  triRaw(wallBuf, x0, y0, z0, x0, y0, z1, x0, yr, zc,
    z0 / t, 0, z1 / t, 0, (z0 + z1) / 2 / t, rise / t, -1, 0, 0,
    wallTint[0], wallTint[1], wallTint[2]);
  triRaw(wallBuf, x1, y0, z1, x1, y0, z0, x1, yr, zc,
    z1 / t, 0, z0 / t, 0, (z0 + z1) / 2 / t, rise / t, 1, 0, 0,
    wallTint[0], wallTint[1], wallTint[2]);
  // ridge cap
  propBox(cx, cz, yr - 0.12, w + 0.12, 0.22, 0.5, 0x8c4c37);
}

function house(cx, cz, salt, front) {
  const r = (k) => hash3(salt, k, 131);
  const w = 4.5 + r(1) * 1.0, d = 4.3 + r(2) * 1.0;
  const two = r(3) > 0.45;
  const h = two ? 5.9 : 3.1;
  const tint = HOUSE_TINTS[(r(4) * HOUSE_TINTS.length) | 0];
  const buf = r(5) < 0.68 ? B.stucco : B.brick;
  const fz = cz + front * (d / 2 + 0.75);
  boxSides(buf, cx - w / 2, cx + w / 2, 0, h, cz - d / 2, cz + d / 2, tint, 4.8, r(6) * 3, 0);
  gableRoof(cx, cz, w + 0.7, d + 0.9, h, 1.65 + r(7) * 0.9, ROOF_TINTS[(r(8) * ROOF_TINTS.length) | 0], buf, tint);
  // door + porch
  propBox(cx, fz - front * 0.32, 0, 1.0, 2.0, 0.16, 0x5d4433);
  propBox(cx, fz, 0.1, 2.8, 0.22, 1.5, 0xbdb29c);
  propBox(cx, fz, 2.55, 3.0, 0.16, 1.7, tint);
  propCyl(cx - 1.18, fz + front * 0.45, 0.1, 0.16, 2.5, 0xe9e2d2);
  propCyl(cx + 1.18, fz + front * 0.45, 0.1, 0.16, 2.5, 0xe9e2d2);
  if (r(9) < 0.55) propBox(cx + w * 0.28, cz - d * 0.18, h + 0.5, 0.66, 1.7, 0.66, 0x9c6a58);
  // driveway to the street and a picket fence either side of it
  const edgeZ = cz + front * 4.05;
  groundQuad(B.plaza, cx - 1.15, cx + 1.15, Math.min(edgeZ, edgeZ - front * 3.2), Math.max(edgeZ, edgeZ - front * 3.2), 0.055, 3, col(0xd9d3c4));
  const ex = 4.0;
  const seg = 2.9;
  propBox(cx - ex + seg / 2 - 0.6, fz + front * 0.9, 0.05, seg, 0.85, 0.09, 0xe6dfcd);
  propBox(cx + ex - seg / 2 + 0.6, fz + front * 0.9, 0.05, seg, 0.85, 0.09, 0xe6dfcd);
  propBox(cx - 1.6, fz + front * 0.9, 0.5, 0.12, 0.45, 0.12, 0xe6dfcd);
  propBox(cx + 1.6, fz + front * 0.9, 0.5, 0.12, 0.45, 0.12, 0xe6dfcd);
  collider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0, h + 2.4);
  COUNT++;
}

function pelicanMotel(cx, cz) {
  plazaPave(cx, cz);
  const b = B.stucco, tint = col(0xf4dfc0);
  for (const side of [-1, 1]) {
    const x = cx + side * 5.4;
    boxSides(b, x - 3.6, x + 3.6, 0, 6.4, cz - 7.6, cz + 1.2, tint, 4.8, 0.5, 0);
    boxSides(B.concrete, x - 3.9, x + 3.9, 6.4, 7.0, cz - 7.9, cz + 1.5, col(0xd8cbb2), 3, 0, 0);
    boxTop(B.roofDark, x - 3.9, x + 3.9, 7.0, cz - 7.9, cz + 1.5, col(0x8b8478), 4);
    for (let yy = 3.4; yy < 6.2; yy += 2.9) {
      propBox(x, cz + 1.5, yy, 3.0, 0.14, 1.1, 0x6b5540);
      propBox(x, cz + 2.05, yy + 0.5, 3.0, 0.85, 0.08, 0x6b5540);
    }
    collider(x - 3.9, cz - 7.9, x + 3.9, cz + 1.5, 0, 7);
    COUNT++;
  }
  groundQuad(B.plaza, cx - 6.4, cx + 6.4, cz + 1.5, cz + 7.2, 0.06, 3, col(0xcfc8b8));
  // rooftop sign facing the street
  propBox(cx - 2.6, cz + 5.2, 0, 0.3, 7.2, 0.3, 0x3d4442);
  propBox(cx + 2.6, cz + 5.2, 0, 0.3, 7.2, 0.3, 0x3d4442);
  billboardPanel(cx, 6.3, cz + 5.2, 7.2, 2.6, 0, 2);
  // pool and palms
  groundQuad(B.water, cx - 3.2, cx + 3.2, cz + 2.2, cz + 6.0, 0.08, 6, col(0xbfe6e0));
  propBox(cx, cz + 6.25, 0.06, 7.0, 0.16, 0.3, 0xe4dccb);
  palm(cx - 7.2, cz + 4.0, 12);
  palm(cx + 7.2, cz + 4.0, 13);
  MARKS.push({name: 'Pelican Motel', x: cx, z: cz, district: 'Suburbs'});
}

function suburbBlock(cx, cz, i, j) {
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
    const lx = cx - 4.05 + a * 8.1, lz = cz - 4.05 + b * 8.1;
    groundQuad(B.grass, lx - 4.05, lx + 4.05, lz - 4.05, lz + 4.05, 0.03, 7, col(0xffffff));
    house(lx, lz, i * 131 + j * 17 + a * 5 + b * 3, b === 0 ? -1 : 1);
    if (hash3(i, j, 190 + a * 2 + b) < 0.55) {
      tree(lx + (a ? -3.1 : 3.1), lz + (b ? 3.1 : -3.1), i * 31 + j * 7 + a * 2 + b);
    }
  }
}

/* ---------------------------------------------------------------- docks */

function warehouse(cx, cz, w, d, h, salt) {
  const tint = [col(0xffffff), col(0xd9e0dc), col(0xe6d3b4), col(0xc3ccc8)][(hash3(salt, 1, 191) * 4) | 0];
  boxSides(B.metal, cx - w / 2, cx + w / 2, 0, h, cz - d / 2, cz + d / 2, tint, 4, hash3(salt, 2, 193) * 6, 0);
  boxTop(B.roofMetal, cx - w / 2, cx + w / 2, h, cz - d / 2, cz + d / 2, col(0x878c88), 4);
  for (let k = 0; k < 3; k++) {
    propBox(cx, cz - d / 3 + k * d / 3, h + 0.1, w * 0.92, 0.32, 0.55, 0xb9bdba);
  }
  const doors = 2 + ((hash3(salt, 3, 197) * 2) | 0);
  for (let k = 0; k < doors; k++) {
    const dx = cx - w / 2 + ((k + 0.5) * w) / doors;
    propBox(dx, cz + d / 2 + 0.14, 0, w / doors - 1.3, 4.6, 0.26, 0x59605d);
    propBox(dx, cz + d / 2 + 0.3, 4.5, w / doors - 0.9, 0.28, 0.5, 0xc9c7ba);
  }
  propBox(cx, cz + d / 2 + 1.2, 0, w * 0.92, 0.95, 2.4, 0xa8a496);
  collider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0, h);
  COUNT++;
}

function containerStack(x, z, salt, tall) {
  const n = 1 + ((hash3(salt, 1, 201) * tall) | 0);
  for (let k = 0; k < n; k++) {
    const tint = CONTAINERS[(hash3(salt, k, 203) * CONTAINERS.length) | 0];
    addInst('container', x + (hash3(salt, k, 207) - 0.5) * 0.25, 1.32 + k * 2.64, z,
      6, 2.6, 2.5, tint, hash3(salt, k, 209) < 0.25 ? Math.PI / 2 : 0);
  }
  collider(x - 3.1, z - 1.4, x + 3.1, z + 1.4, 0, 1.3 + n * 2.64);
}

function crane(x, z, h) {
  const c = 0xd0a03c;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    propBox(x + sx * 3.4, z + sz * 3.4, 0, 0.7, h, 0.7, c);
  }
  propBox(x, z, h - 0.8, 7.8, 0.8, 0.8, c);
  propBox(x, z, h - 0.8, 0.8, 0.8, 7.8, c);
  propBox(x + 4.6, z, h - 0.4, 12, 0.7, 0.7, c);
  propBox(x + 9.6, z, h - 3.4, 0.1, 3.0, 0.1, 0x55584f);
  propBox(x + 9.6, z, h - 3.9, 0.7, 0.7, 0.7, 0x9a8a4a);
  propBox(x + 0.4, z, h - 0.4, 2.4, 1.6, 2.2, 0x8a6b34);
  collider(x - 4, z - 4, x + 4, z + 4, 0, h);
}

function docksBlock(cx, cz, i, j) {
  const r = (k) => hash3(i, j, 200 + k);
  const w = 13.4, d = 9.2;
  warehouse(cx, cz + 2.4, w, d, 8.5 + r(1) * 4.5, i * 131 + j);
  const n = 3 + ((r(2) * 3) | 0);
  for (let k = 0; k < n; k++) {
    containerStack(cx - 6.2 + k * 4.1, cz - 6.2, i * 71 + j * 13 + k, 3);
  }
  propBox(cx + 6.4, cz - 2.4, 0, 2.6, 1.0, 2.6, 0x9d998c);
  for (let k = 0; k < 2; k++) propBox(cx + 5.4 + k * 1.5, cz + 6.6, 0, 1.3, 0.9, 1.3, 0x8d7a5a);
  if (r(3) < 0.4) crane(cx, cz - 6.0, 15 + r(4) * 5);
}

/* ------------------------------------------------------------ industrial */

function tank(x, z, rad, h, tint) {
  propCyl(x, z, 0, rad * 2, h, tint);
  propCone(x, z, h, rad * 2.15, rad * 1.15, tint);
  for (let k = 1; k < 3; k++) propCyl(x, z, k * (h / 3), rad * 2.05, 0.25, 0x8d918a);
  propBox(x + rad + 0.15, z, 0, 0.12, h, 0.5, 0x777b74);
  collider(x - rad, z - rad, x + rad, z + rad, 0, h + rad);
}

function chimney(x, z, h) {
  propCyl(x, z, 0, 2.6, h, 0xb2a596);
  for (let k = 1; k < 4; k++) propCyl(x, z, (k * h) / 4, 2.75, 0.6, 0x8c8175);
  propCyl(x, z, h, 2.9, 0.5, 0x6f6659);
  collider(x - 1.4, z - 1.4, x + 1.4, z + 1.4, 0, h);
}

function shed(cx, cz, w, d, h, salt) {
  const tint = [col(0xffffff), col(0xdfe3e0), col(0xd3cdbb), col(0xc8d0cc)][(hash3(salt, 1, 301) * 4) | 0];
  boxSides(B.concrete, cx - w / 2, cx + w / 2, 0, h, cz - d / 2, cz + d / 2, tint, 5, hash3(salt, 2, 303) * 5, 0);
  boxTop(B.roofMetal, cx - w / 2, cx + w / 2, h, cz - d / 2, cz + d / 2, col(0x8a8f8b), 4);
  propBox(cx, cz, h + 0.05, w * 0.96, 0.5, 0.7, 0x9aa09c);
  for (let k = 0; k < 4; k++) {
    propBox(cx - w * 0.36 + k * (w * 0.24), cz - d * 0.2, h + 0.35, w * 0.14, 0.35, d * 0.42, 0xcfe0dc);
  }
  const doors = 2;
  for (let k = 0; k < doors; k++) {
    const dx = cx - w / 2 + ((k + 0.5) * w) / doors;
    propBox(dx, cz + d / 2 + 0.1, 0, 3.4, 4.4, 0.22, 0x5b625f);
  }
  collider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0, h);
  COUNT++;
}

function industrialBlock(cx, cz, i, j) {
  const r = (k) => hash3(i, j, 300 + k);
  const w = 10 + r(1) * 3.2, d = 9 + r(2) * 3.4;
  shed(cx + (r(3) - 0.5) * 1.6, cz + 2.6, w, d, 6.5 + r(4) * 4.2, i * 131 + j);
  if (r(5) < 0.55) {
    tank(cx - 5.4, cz - 5.6, 2.0 + r(6) * 0.9, 7 + r(7) * 4, 0xd8d3c4);
    if (r(8) < 0.6) tank(cx - 0.4, cz - 6.0, 1.5 + r(9) * 0.6, 5.5 + r(10) * 3, 0xc9cdc6);
  } else {
    chimney(cx - 4.6, cz - 5.4, 18 + r(11) * 12);
  }
  // pipe rack along the block edge
  for (let k = 0; k < 3; k++) {
    propBox(cx + 4.4, cz - 6.4 + k * 1.4, 0.4, 0.5, 3.4, 0.5, 0x9a9d95);
  }
  propBox(cx + 4.4, cz - 5.0, 3.6, 0.35, 0.35, 4.4, 0xb0b3aa);
  propBox(cx + 4.4, cz - 5.0, 2.6, 0.28, 0.28, 4.4, 0x8d8f86);
}

/* ----------------------------------------------------------- beach park */

function kiosk(cx, cz, w, d, h, salt) {
  const tint = PASTELS[(hash3(salt, 1, 401) * PASTELS.length) | 0];
  boxSides(B.stucco, cx - w / 2, cx + w / 2, 0, h, cz - d / 2, cz + d / 2, tint, 4.8, 0, 0);
  boxSides(B.roofTile, cx - w / 2 - 0.8, cx + w / 2 + 0.8, h, h + 0.5, cz - d / 2 - 0.8, cz + d / 2 + 0.8,
    col(0xb2643f), 2.2, 0, 0);
  boxTop(B.roofTile, cx - w / 2 - 0.8, cx + w / 2 + 0.8, h + 0.5, cz - d / 2 - 0.8, cz + d / 2 + 0.8, col(0xffffff), 2.2);
  propBox(cx, cz + d / 2 + 0.55, 2.2, w * 0.9, 0.14, 1.3, 0xd4573f);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    propCyl(cx + sx * (w / 2 - 0.3), cz + sz * (d / 2 - 0.3), 0, 0.2, 0.2 + h - 0.4, 0xe8e0ce);
  }
  collider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0, h);
  COUNT++;
}

function lifeguard(x, z, salt) {
  const y = 2.3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) propCyl(x + sx * 1.1, z + sz * 1.1, 0, 0.22, y, 0xe4dccb);
  propBox(x, z, y, 2.8, 0.16, 2.8, 0xd8cbb0);
  boxSides(B.stucco, x - 1.2, x + 1.2, y + 0.16, y + 2.2, z - 1.2, z + 1.2, col(0xf1e6cf), 3, 0, 0);
  boxSides(B.roofTile, x - 1.7, x + 1.7, y + 2.2, y + 2.6, z - 1.7, z + 1.7, col(0xc26a45), 2, 0, 0);
  boxTop(B.roofTile, x - 1.7, x + 1.7, y + 2.6, z - 1.7, z + 1.7, col(0xffffff), 2);
  propBox(x, z + 1.9, 0, 1.0, 0.16, 3.4, 0xb6a992, 0, -0.32, 0);
  collider(x - 1.7, z - 1.7, x + 1.7, z + 1.7, 0, y + 2.6);
  COUNT++;
}

function beachBlock(cx, cz, i, j) {
  const r = (k) => hash3(i, j, 400 + k);
  grassPave(cx, cz);
  groundQuad(B.plaza, cx - CORE, cx + CORE, cz + 3.4, cz + 5.3, 0.05, 3, col(0xffffff));
  if (r(1) < 0.62) kiosk(cx - 2.6 + r(2) * 2.4, cz - 2.2, 4.4, 3.4, 3.1, i * 17 + j);
  for (let k = 0; k < 3; k++) palm(cx - 6.6 + k * 6.6, cz - 7.2, i * 13 + j * 7 + k);
  if (r(3) < 0.7) bench(cx + 4.6, cz + 4.2, 0);
  if (r(4) < 0.5) bin(cx - 5.6, cz + 4.4);
  if (r(5) < 0.4) tree(cx + 6.2, cz + 6.0, i * 23 + j);
}

/* --------------------------------------------------------------- marina */

function marinaBuilding(cx, cz, w, d, h, salt) {
  const r = (k) => hash3(salt, k, 500);
  const buf = r(1) < 0.55 ? B.stucco : B.brick;
  const tint = PASTELS[(r(2) * PASTELS.length) | 0];
  boxSides(buf, cx - w / 2, cx + w / 2, 0, h, cz - d / 2, cz + d / 2, tint, 4.8, r(3) * 4, 0);
  boxSides(B.concrete, cx - w / 2 - 0.25, cx + w / 2 + 0.25, h - 0.7, h + 0.3, cz - d / 2 - 0.25, cz + d / 2 + 0.25,
    col(0xe0d7c3), 4, 0, 0);
  boxTop(B.roofDark, cx - w / 2 - 0.25, cx + w / 2 + 0.25, h + 0.3, cz - d / 2 - 0.25, cz + d / 2 + 0.25, col(0x8b8478), 4);
  for (let y = 3.2; y < h - 1.2; y += 3.1) {
    propBox(cx, cz + d / 2 + 0.55, y, w * 0.82, 0.14, 1.1, 0x6e5a45);
    propBox(cx, cz + d / 2 + 1.06, y + 0.55, w * 0.82, 0.85, 0.08, 0x4a4034);
    const nc = r(y) < 0.4 ? 2 : 1;
    for (let k = 0; k < nc; k++) planter(cx - w * 0.3 + k * 1.9, cz + d / 2 + 0.9, salt + y + k);
  }
  const awn = AWNING_COLS[(r(4) * AWNING_COLS.length) | 0];
  addInst('box', cx, 2.75, cz + d / 2 + 0.72, w * 0.78, 0.12, 1.5, awn, 0, -0.16, 0);
  propBox(cx, cz + d / 2 + 0.28, 0, w * 0.72, 2.4, 0.12, 0x2c3a3c);
  collider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0, h);
  COUNT++;
}

function marinaBlock(cx, cz, i, j) {
  plazaPave(cx, cz);
  const r = (k) => hash3(i, j, 600 + k);
  marinaBuilding(cx - 4.1, cz - 4.0, 7.4, 7.2, 8.5 + r(1) * 4.5, i * 17 + j * 3);
  marinaBuilding(cx + 4.1, cz + 4.0, 7.4, 7.2, 7.5 + r(2) * 5.0, i * 17 + j * 3 + 1);
  if (r(3) < 0.5) palm(cx + 6.9, cz - 6.9, i * 5 + j);
  if (r(4) < 0.4) bench(cx - 6.6, cz + 6.9, Math.PI / 2);
}

/* --------------------------------------------------------- street furniture */

function billboardPanel(x, y, z, w, h, ry, adIndex) {
  const u0 = (adIndex % 2) * 0.5, v0 = adIndex < 2 ? 0.5 : 0;
  const ex = Math.cos(ry) * w / 2, ez = -Math.sin(ry) * w / 2;
  quadRaw(B.ads,
    x - ex, y - h / 2, z - ez, x + ex, y - h / 2, z + ez, x + ex, y + h / 2, z + ez, x - ex, y + h / 2, z - ez,
    u0, v0, u0 + 0.5, v0, u0 + 0.5, v0 + 0.5, u0, v0 + 0.5,
    Math.sin(ry), 0, Math.cos(ry), 1, 1, 1);
}

function billboard(cx, cz, side, adIndex) {
  const ry = side === 'n' ? Math.PI : side === 's' ? 0 : side === 'w' ? -Math.PI / 2 : Math.PI / 2;
  const off = 10.4;
  const x = side === 'w' ? cx - off : side === 'e' ? cx + off : cx + 3.4;
  const z = side === 'n' ? cz - off : side === 's' ? cz + off : cz;
  const hx = Math.cos(ry) * 2.9, hz = -Math.sin(ry) * 2.9;
  propBox(x - hx, z - hz, 0, 0.32, 5.8, 0.32, 0x4b504c);
  propBox(x + hx, z + hz, 0, 0.32, 5.8, 0.32, 0x4b504c);
  billboardPanel(x, 6.9, z, 7.4, 3.9, ry, adIndex);
  propBox(x, z, 4.95, 7.8, 0.2, 0.24, 0x3f4440, ry);
  const ux = Math.abs(Math.cos(ry)) * 3.9 + Math.abs(Math.sin(ry)) * 0.5;
  const uz = Math.abs(Math.sin(ry)) * 3.9 + Math.abs(Math.cos(ry)) * 0.5;
  collider(x - ux, z - uz, x + ux, z + uz, 0, 9);
}

function busStop(x, z, ry) {
  propBox(x - 2.1, z, 0, 0.2, 2.7, 0.2, 0x4a4f4c, ry);
  propBox(x + 2.1, z, 0, 0.2, 2.7, 0.2, 0x4a4f4c, ry);
  propBox(x, z, 2.7, 4.6, 0.18, 1.8, 0x3f4a4a, ry);
  propBox(x, z - 0.75, 0.3, 4.2, 2.2, 0.1, 0x9fc4c0, ry);
  propBox(x, z, 0.4, 3.4, 0.14, 0.55, 0x6b5236, ry);
  collider(x - 2.4, z - 1.1, x + 2.4, z + 1.1, 0, 3);
}

function trafficLight(ax, az, flip) {
  const sx = flip ? -1 : 1, sz = flip ? -1 : 1;
  const px = ax + 7.0 * sx, pz = az + 7.0 * sz;
  propCyl(px, pz, 0, 0.34, 5.4, 0x39423c);
  const armLen = 6.0;
  propBox(px - (armLen / 2) * sx, pz, 5.15, armLen, 0.2, 0.2, 0x39423c);
  const hx = px - (armLen - 0.6) * sx;
  propBox(hx, pz, 4.2, 0.55, 1.35, 0.45, 0x2f3a33);
  const lens = flip ? 'lensR' : 'lensG';
  addInst(lens, hx, 4.75, pz + 0.26 * sz, 0.26, 0.26, 0.26, 0xffffff);
  propBox(hx, pz + 0.32 * sz, 5.02, 0.5, 0.09, 0.34, 0x2a332c);
  TLIGHTS.push({x: px, z: pz, orientation: flip ? Math.PI : 0, axis: flip ? 'z' : 'x'});
}

function blockFurniture(cx, cz, i, j, district) {
  const r = (k) => hash3(i, j, 700 + k);
  lamp(cx, cz - 10.9, 0, -1);
  lamp(cx, cz + 10.9, 0, 1);
  lamp(cx - 10.9, cz, -1, 0);
  lamp(cx + 10.9, cz, 1, 0);
  bench(cx - 4.6 + r(1) * 2.0, cz + 10.5, 0);
  if (r(2) < 0.7) bin(cx + 6.2, cz + 10.4);
  if (r(3) < 0.5) hydrant(cx - 9.9, cz + 4.2);
  if ((district === 'Downtown' || district === 'Marina') && r(4) < 0.55) planter(cx + 9.7, cz - 4.0, i * 7 + j);
  if (r(5) < 0.1 && district !== 'Beach Park') busStop(cx + 4.0, cz - 10.5, 0);
  if (r(6) < 0.12 && district === 'Downtown') bench(cx + 10.5, cz + 2.2, -Math.PI / 2);
}

/* ------------------------------------------------------------ roads and sea */

function roadQuad(alongX, at) {
  const c = col(0xffffff);
  if (alongX) {
    const x0 = -HALF, x1 = HALF, z0 = at - RH, z1 = at + RH, y = 0.02;
    quadRaw(B.road, x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0,
      0, x0 / 16, 1, x0 / 16, 1, x1 / 16, 0, x1 / 16, 0, 1, 0, c[0], c[1], c[2]);
  } else {
    const x0 = at - RH, x1 = at + RH, z0 = -212, z1 = SOUTH, y = 0.045;
    quadRaw(B.road, x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0,
      0, z0 / 16, 0, z1 / 16, 1, z1 / 16, 1, z0 / 16, 0, 1, 0, c[0], c[1], c[2]);
  }
}

function roadGrid() {
  for (const at of LINES) {
    roadQuad(true, at);
    roadQuad(false, at);
  }
  // crosswalks a few metres off each intersection, on the 121 inner junctions
  const white = col(0xf2e8c8);
  for (let i = 0; i < LINES.length; i++) for (let j = 0; j < LINES.length; j++) {
    const ax = LINES[i], az = LINES[j];
    if (Math.abs(ax) > 170 || Math.abs(az) > 170) continue;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const o = -4.4 + k * 2.2;
        // across the north-south road
        crossStripe(ax + o, az + side * 7.2, 1.3, 2.6, white);
        // across the east-west road
        crossStripe(ax + side * 7.2, az + o, 2.6, 1.3, white);
      }
    }
  }
}
function crossStripe(x, z, w, d, c) {
  const y = 0.085;
  quadRaw(B.paint, x - w / 2, y, z - d / 2, x - w / 2, y, z + d / 2, x + w / 2, y, z + d / 2, x + w / 2, y, z - d / 2,
    0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, c[0], c[1], c[2]);
}

function terrain() {
  const ground = col(0xd7c3a0);
  // land slab, water, beach, boardwalk, grass verges
  groundQuad(B.sand, -HALF, HALF, SEA_Z, SOUTH, 0, 12, ground);
  // the outer margin reads as packed sand/scrub
  groundQuad(B.sand, -HALF, HALF, SEA_Z, BEACH_Z - 0.3, 0.045, 8, col(0xffffff));
  groundQuad(B.board, -203, 203, -216.2, BEACH_Z - 0.4, 0.12, 2, col(0xffffff));
  // surf line just off the sand
  groundQuad(B.paint, -HALF, HALF, SEA_Z - 1.1, SEA_Z + 0.05, -0.42, 6, col(0xdff3ec));
  // distant country south of the grid so the horizon is not raw background
  groundQuad(B.grass, -420, 420, SOUTH, 620, -0.3, 40, col(0x9aa887));
  for (let k = 0; k < 6; k++) {
    const hx = -260 + k * 110, hz = 330 + (k % 3) * 34;
    propCone(hx, hz, -0.3, 150 + (k % 3) * 40, 26 + (k % 4) * 9, 0x93a189);
  }
}

/* ------------------------------------------------------------ waterfront */

function boat(x, z, ry, hull) {
  addInst('box', x, 0.15, z, 7.2, 1.3, 2.6, hull, ry);
  addInst('box', x - 0.7, 1.1, z, 2.6, 1.4, 1.9, 0xf0ebdd, ry);
  addInst('cyl', x + 1.8, 3.4, z, 0.1, 6.2, 0.1, 0xcfd3cd, ry);
  addInst('box', x + 0.4, 0.85, z, 6.4, 0.18, 2.8, 0xe8e2d2, ry);
}

function pier(px) {
  groundQuad(B.board, px - 2.2, px + 2.2, -262, SEA_Z - 0.5, 0.16, 2, col(0xffffff));
  for (let z = -258; z <= SEA_Z - 6; z += 8) {
    propCyl(px - 2.0, z, -1.4, 0.32, 2.0, 0x6b5842);
    propCyl(px + 2.0, z, -1.4, 0.32, 2.0, 0x6b5842);
  }
  for (let z = -258; z <= SEA_Z - 6; z += 8) propBox(px, z, 0.28, 4.6, 0.12, 0.2, 0x6f5a42);
}

function waterfront() {
  const lum = col(0xf0e6d2);
  for (const px of [62, 92, 122, 152]) {
    pier(px);
    for (let k = 0; k < 2; k++) {
      const bz = -248 + k * 14;
      boat(px - 5.0, bz, 0.02, 0xe8e4d6);
      boat(px + 5.0, bz + 5, Math.PI + 0.02, CAR_COLS[(k + px) % CAR_COLS.length]);
    }
  }
  // marina quay + bollards
  groundQuad(B.plaza, 40, 210, SEA_Z - 2.6, SEA_Z + 0.4, 0.07, 3, col(0xffffff));
  for (let x = 44; x < 208; x += 9) propBox(x, SEA_Z - 1.4, 0.03, 0.55, 0.75, 0.55, 0x4d5450);
  // breakwater rocks and the lighthouse
  for (let x = -30; x <= 210; x += 6.4) {
    addInst('sphere', x, -0.25, -268 + Math.sin(x * 0.1) * 2.4, 7 + hash3(x, 1, 9) * 4, 5 + hash3(x, 2, 9) * 3,
      7 + hash3(x, 3, 9) * 4, 0x8d8b80);
  }
  const lx = 188, lz = -268;
  propCyl(lx, lz, -0.8, 7.4, 2.4, 0xd9d3c2);
  for (let k = 0; k < 4; k++) {
    propCyl(lx, lz, 1.4 + k * 5.1, 4.6 - k * 0.42, 5.2, k % 2 ? 0xc45c46 : 0xf0e9da);
  }
  propCyl(lx, lz, 21.8, 5.6, 0.4, 0x414a46);
  propCyl(lx, lz, 22.2, 3.2, 2.2, 0x33454a);
  propCone(lx, lz, 24.4, 3.9, 1.7, 0x2f3b3e);
  addInst('bulb', lx, 23.6, lz, 1.3, 1.3, 1.3, 0xffe2a0);
  MARKS.push({name: 'Solara Light', x: lx, z: lz, district: 'Marina'});
  MARKS.push({name: 'Causeway Pier', x: 122, z: -244, district: 'Marina'});

  // beach life: umbrellas, towels, lifeguard towers
  for (let k = 0; k < 22; k++) {
    const x = -196 + k * 18 + hash3(k, 1, 31) * 6;
    const z = -222 + hash3(k, 2, 37) * 5;
    propCyl(x, z, 0.05, 0.1, 2.1, 0xe8e2d0);
    propCone(x, z, 1.95, 3.0, 1.0, [0xd4573f, 0x2f8b86, 0xe0a03a, 0xf0dfc4][(hash3(k, 3, 41) * 4) | 0]);
    addInst('box', x + 1.4, 0.1, z + 0.6, 1.1, 0.08, 1.9, [0x5f8fb0, 0xd4735c, 0xe2d3a8][(hash3(k, 4, 43) * 3) | 0]);
  }
  lifeguard(-150, -223, 1);
  lifeguard(-35, -224, 2);
  lifeguard(70, -222, 3);
  MARKS.push({name: 'Solara Boardwalk', x: 0, z: -212, district: 'Beach Park'});
  // promenade palms and benches along the boardwalk
  for (let x = -196; x <= 196; x += 12.5) {
    palm(x, -218.6, x | 0);
    if ((x / 12.5) % 3 === 0) bench(x + 5, -212.6, Math.PI);
  }
  for (let x = -196; x <= 196; x += 24) propCyl(x, -210.2, 0, 0.24, 4.2, 0x333d40);
  // outer edge greenery
  for (let z = -190; z <= 226; z += 26) {
    palm(-221, z, z | 0);
    palm(221, z, z + 7);
  }
  for (let x = -200; x <= 200; x += 26) palm(x, 224, x | 0);
  MARKS.push({name: 'Pelican Docks', x: -172, z: 0, district: 'Docks'});
}

/* ---------------------------------------------------------- district fill */

function landmarkRefinery(cx, cz) {
  plazaPave(cx, cz);
  shed(cx, cz + 2, 12, 9, 8, 99);
  chimney(cx - 5.5, cz - 6, 34);
  chimney(cx - 1.5, cz - 6, 28);
  tank(cx + 5.4, cz - 5.6, 2.6, 11, 0xd9d4c5);
  tank(cx + 7.4, cz + 6.2, 1.8, 8, 0xc4c9c3);
  for (let k = 0; k < 4; k++) propCyl(cx + 2.4, cz + 5.4 - k * 2.4, 0.4, 0.4, 6 + k, 0x9fa39b);
  MARKS.push({name: 'Amalgam Refinery', x: cx, z: cz, district: 'Industrial'});
}

function cityFill() {
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const cx = CENTERS[i], cz = CENTERS[j];
    const d = districtAt(cx, cz);
    sidewalkRing(cx, cz);
    if (d === 'Downtown') downtownBlock(cx, cz, i, j);
    else if (d === 'Suburbs') {
      if (i === 6 && j === 10) pelicanMotel(cx, cz);
      else suburbBlock(cx, cz, i, j);
    } else if (d === 'Docks') docksBlock(cx, cz, i, j);
    else if (d === 'Industrial') {
      if (i === 9 && j === 6) landmarkRefinery(cx, cz);
      else industrialBlock(cx, cz, i, j);
    } else if (d === 'Beach Park') beachBlock(cx, cz, i, j);
    else marinaBlock(cx, cz, i, j);
    blockFurniture(cx, cz, i, j, d);
  }
  // traffic lights on every junction
  for (let i = 0; i < LINES.length; i++) for (let j = 0; j < LINES.length; j++) {
    trafficLight(LINES[i], LINES[j], (i + j) % 2 === 1);
  }
  // billboards at the edges of a handful of blocks
  const bills = [[4, 0, 'n', 0], [8, 0, 'n', 1], [0, 4, 'w', 2], [11, 6, 'e', 3],
    [2, 11, 's', 1], [9, 11, 's', 0], [0, 8, 'w', 3], [11, 2, 'e', 2], [6, 4, 'n', 0], [4, 8, 'n', 1]];
  for (const [i, j, s, ad] of bills) billboard(CENTERS[i], CENTERS[j], s, ad);
}

/* ------------------------------------------------------------ spawn data */

function spawnPoints() {
  const cars = [], peds = [];
  for (let k = 0; k < LINES.length; k++) {
    const at = LINES[k];
    for (let n = 0; n < 3; n++) {
      const p = -150 + n * 130 + ((k * 37) % 40);
      cars.push({x: p, z: at + 2.7, angle: Math.PI / 2});
      cars.push({x: at - 2.7, z: p + 20, angle: 0});
    }
  }
  for (let k = 0; k < 48; k++) {
    const i = 1 + ((hash3(k, 1, 900) * 10) | 0), j = 1 + ((hash3(k, 2, 901) * 10) | 0);
    peds.push({
      x: CENTERS[i] + (hash3(k, 3, 902) - 0.5) * 19,
      z: CENTERS[j] + (hash3(k, 4, 903) - 0.5) * 19
    });
  }
  return {cars, peds};
}

/* -------------------------------------------------------------- assembly */

function flushGeometry() {
  const M = materials();
  const defs = [
    ['road', M.road], ['walk', M.walk], ['plaza', M.plaza], ['sand', M.sand],
    ['paint', M.paint], ['grass', M.grass], ['board', M.board], ['concrete', M.concrete],
    ['glass', M.glass], ['stone', M.stone], ['stucco', M.stucco], ['brick', M.brick],
    ['metal', M.metal], ['roofDark', M.roofDark], ['roofTile', M.roofTile], ['roofMetal', M.roofMetal],
    ['water', M.pool]
  ];
  for (const [key, mat] of defs) {
    const b = B[key];
    if (!b || !b.i.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    g.setIndex(b.i);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = 'city_' + key;
    m.castShadow = key !== 'road' && key !== 'walk' && key !== 'plaza' && key !== 'sand' &&
      key !== 'paint' && key !== 'grass' && key !== 'board' && key !== 'concrete' && key !== 'water';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    SCENE.add(m);
  }
  // ocean is its own translucent-ish slab, kept out of the vertex-colour batch
  const waterGeo = new THREE.PlaneGeometry(1, 1);
  const sea = new THREE.Mesh(waterGeo, M.water);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.55, -330);
  sea.scale.set(640, 200, 1);
  sea.receiveShadow = false;
  sea.name = 'city_sea';
  SCENE.add(sea);
  // billboard panels use the atlas material, so they get their own batch
  if (B.ads && B.ads.i.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.ads.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.ads.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.ads.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.ads.c, 3));
    g.setIndex(B.ads.i);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, M.ads);
    m.name = 'city_ads';
    SCENE.add(m);
  }
}

function makeFrondGeometry() {
  const g = new THREE.PlaneGeometry(3.4, 0.9, 6, 1);
  g.translate(1.7, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const t = Math.max(0, Math.min(1, x / 3.4));
    p.setY(i, y * (1 - t * 0.9) + Math.sin(t * 1.9) * 0.95 - t * t * 1.9);
    p.setZ(i, Math.sin(t * Math.PI) * 0.2);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function flushInstances() {
  const M = materials();
  const propMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.72, metalness: 0.12});
  const foliage = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.88, flatShading: true});
  const frondMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, flatShading: true});
  const containerMat = new THREE.MeshStandardMaterial({map: TEX_CACHE.corrugated, roughness: 0.62, metalness: 0.32});
  const bulbMat = new THREE.MeshStandardMaterial({color: 0x2a2418, emissive: 0xffd08a, emissiveIntensity: 1.5, roughness: 0.4});
  const redMat = new THREE.MeshStandardMaterial({color: 0x40100e, emissive: 0xff3a2a, emissiveIntensity: 1.4, roughness: 0.4});
  const greenMat = new THREE.MeshStandardMaterial({color: 0x0c2a18, emissive: 0x3dff9a, emissiveIntensity: 1.2, roughness: 0.4});
  const defs = {
    box: {g: new THREE.BoxGeometry(1, 1, 1), m: propMat, recv: true},
    cyl: {g: new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1), m: propMat, recv: true},
    cone: {g: new THREE.ConeGeometry(0.5, 1, 10, 1), m: propMat, recv: false},
    sphere: {g: new THREE.IcosahedronGeometry(0.5, 1), m: foliage, recv: false},
    frond: {g: makeFrondGeometry(), m: frondMat, recv: false},
    container: {g: new THREE.BoxGeometry(1, 1, 1), m: containerMat, recv: true, tint: true},
    bulb: {g: new THREE.SphereGeometry(0.5, 7, 5), m: bulbMat, recv: false},
    lensR: {g: new THREE.SphereGeometry(0.5, 8, 6), m: redMat, recv: false},
    lensG: {g: new THREE.SphereGeometry(0.5, 8, 6), m: greenMat, recv: false}
  };
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), c = new THREE.Color();
  for (const key in defs) {
    const list = INST[key];
    if (!list || !list.length) continue;
    const def = defs[key];
    const mesh = new THREE.InstancedMesh(def.g, def.m, list.length);
    mesh.name = 'prop_' + key;
    let coloured = false;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      e.set(o.rx, o.ry, o.rz);
      q.setFromEuler(e);
      pos.set(o.x, o.y, o.z);
      scl.set(o.sx, o.sy, o.sz);
      mtx.compose(pos, q, scl);
      mesh.setMatrixAt(i, mtx);
      if (key === 'container') {
        const t = o.c || COLORS.sea;
        mesh.setColorAt(i, c.setHex(t));
        coloured = true;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (coloured && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = !!def.recv;
    mesh.frustumCulled = false;
    SCENE.add(mesh);
  }
}

/* --------------------------------------------------------------- build */

export function buildCity(scene) {
  SCENE = scene;
  B = {
    road: emptyGeo(), walk: emptyGeo(), plaza: emptyGeo(), sand: emptyGeo(), paint: emptyGeo(),
    grass: emptyGeo(), board: emptyGeo(), glass: emptyGeo(), stone: emptyGeo(), stucco: emptyGeo(),
    brick: emptyGeo(), metal: emptyGeo(), concrete: emptyGeo(), roofDark: emptyGeo(),
    roofTile: emptyGeo(), roofMetal: emptyGeo(), water: emptyGeo(), ads: emptyGeo()
  };
  INST = {box: [], cyl: [], cone: [], sphere: [], frond: [], container: [], bulb: [], lensR: [], lensG: []};
  COLLIDERS = [];
  WALKS = [];
  TLIGHTS = [];
  MARKS = [];
  COUNT = 0;

  terrain();
  roadGrid();
  cityFill();
  waterfront();
  flushGeometry();
  flushInstances();

  return {
    size: SIZE,
    block: BLOCK,
    districts: DISTRICTS,
    buildings: COUNT,
    colliders: COLLIDERS,
    roadLines: LINES.map((at) => ({axis: 'x', at})).concat(LINES.map((at) => ({axis: 'z', at}))),
    sidewalks: WALKS,
    spawnPoints: spawnPoints(),
    landmarks: MARKS,
    trafficLights: TLIGHTS,
    districtAt,
    meshCount: scene.children.length
  };
}