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
const ROAD_HALF = ROAD / 2;      // 5.5
const CORE = 8.1;                // half width of a block's buildable core
const SEA_Z = -230;              // waterline
const BEACH_Z = -209.5;          // north edge of the coast road
const SOUTH = 236;
const ANISO = 4;
const WALK_OUTER = 11.5;         // outer edge of the sidewalk ring
const WALK_Y = 0.16;             // sidewalk slab height
const ROAD_TILE = 16;            // asphalt tile length in world units

const LINES = [];                // road centre lines, -204 .. 204
const CENTERS = [];              // block centres, -187 .. 187
for (let lineIndex = -6; lineIndex <= 6; lineIndex++) LINES.push(lineIndex * BLOCK);
for (let centerIndex = 0; centerIndex < 12; centerIndex++) CENTERS.push(-187 + centerIndex * BLOCK);

const DISTRICTS = [
  {name: 'Downtown', color: 0x9dbbb2, center: {x: 0, z: 0}, bounds: {minX: -110, maxX: 110, minZ: -116, maxZ: 116}},
  {name: 'Docks', color: 0xc09a6d, center: {x: -172, z: 0}, bounds: {minX: -235, maxX: -110, minZ: -116, maxZ: 116}},
  {name: 'Suburbs', color: 0xe8c99b, center: {x: 0, z: 176}, bounds: {minX: -235, maxX: 235, minZ: 116, maxZ: 236}},
  {name: 'Industrial', color: 0xa0a294, center: {x: 172, z: 0}, bounds: {minX: 110, maxX: 235, minZ: -116, maxZ: 116}},
  {name: 'Beach Park', color: 0xf2d6a2, center: {x: -110, z: -174}, bounds: {minX: -235, maxX: 40, minZ: -235, maxZ: -116}},
  {name: 'Marina', color: 0xd0917a, center: {x: 140, z: -174}, bounds: {minX: 40, maxX: 235, minZ: -235, maxZ: -116}}
];

function districtAt(positionX, positionZ) {
  if (positionZ < -116) return positionX > 40 ? 'Marina' : 'Beach Park';
  if (positionZ > 116) return 'Suburbs';
  if (positionX < -110) return 'Docks';
  if (positionX > 110) return 'Industrial';
  return 'Downtown';
}

/* ------------------------------------------------------- deterministic noise */

const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_DIVISOR = 4294967296;

function mulberry32(seed) {
  let state = seed;
  return function () {
    state |= 0; state = (state + MULBERRY_INCREMENT) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_DIVISOR;
  };
}
function hash3(gridX, gridZ, salt) {
  let hash = Math.imul(gridX | 0, 374761393) + Math.imul(gridZ | 0, 668265263) + Math.imul(salt | 0, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1103515245);
  hash ^= hash >>> 16;
  return (hash >>> 0) / UINT32_DIVISOR;
}

/* ---------------------------------------------------------------- textures */

const TEX_CACHE = {};
function canvasTexture(key, size, paint) {
  const cached = TEX_CACHE[key];
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', {alpha: false});
  paint(ctx, size, mulberry32(0x51ed + key.length * 131));
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = ANISO;
  if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
  TEX_CACHE[key] = texture;
  return texture;
}
function speckle(ctx, size, random, count, palette, alpha) {
  for (let speckIndex = 0; speckIndex < count; speckIndex++) {
    ctx.globalAlpha = alpha * (0.35 + random() * 0.65);
    ctx.fillStyle = palette[(random() * palette.length) | 0];
    const speckSize = 0.7 + random() * 1.9;
    ctx.fillRect(random() * size, random() * size, speckSize, speckSize);
  }
  ctx.globalAlpha = 1;
}

function makeTextures() {
  const textures = {};
  textures.asphalt = canvasTexture('asphalt', 256, (ctx, size, random) => {
    ctx.fillStyle = '#414849'; ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, 2600, ['#5c6363', '#2f3637', '#6d7270', '#33393a', '#4a5152'], 0.5);
    for (let patchIndex = 0; patchIndex < 7; patchIndex++) {
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = patchIndex % 2 ? '#2b3233' : '#596061';
      ctx.fillRect(random() * size, random() * size, 20 + random() * 70, 14 + random() * 52);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(22,27,28,.55)'; ctx.lineWidth = 1.2;
    for (let crackIndex = 0; crackIndex < 5; crackIndex++) {
      ctx.beginPath();
      let crackX = random() * size, crackY = random() * size;
      ctx.moveTo(crackX, crackY);
      for (let segment = 0; segment < 5; segment++) { crackX += (random() - 0.5) * 30; crackY += random() * 22; ctx.lineTo(crackX, crackY); }
      ctx.stroke();
    }
    // centre line dashes: the tile is 16 units long and 11 wide, u runs across the road
    ctx.fillStyle = '#e6d9ad';
    ctx.fillRect(size / 2 - 3, 18, 6, 44);
    ctx.fillRect(size / 2 - 3, size / 2 + 18, 6, 44);
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#7d8482';
    ctx.fillRect(size / 2 - 1, 0, 2, size); ctx.globalAlpha = 1;
  });

  textures.sidewalk = canvasTexture('sidewalk', 256, (ctx, size, random) => {
    ctx.fillStyle = '#a8a493'; ctx.fillRect(0, 0, size, size);
    const slab = size / 2;
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
      ctx.fillStyle = (col + row) % 2 ? '#a29e8e' : '#ada898';
      ctx.fillRect(col * slab + 2, row * slab + 2, slab - 4, slab - 4);
      ctx.strokeStyle = 'rgba(86,84,74,.4)'; ctx.lineWidth = 2;
      ctx.strokeRect(col * slab + 2, row * slab + 2, slab - 4, slab - 4);
    }
    speckle(ctx, size, random, 1600, ['#8e8a7c', '#bdb8a5', '#7d7a6d'], 0.3);
    for (let stainIndex = 0; stainIndex < 8; stainIndex++) {
      ctx.globalAlpha = 0.07; ctx.fillStyle = '#5d5b50';
      ctx.beginPath(); ctx.arc(random() * size, random() * size, 4 + random() * 16, 0, 6.3); ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  textures.plaza = canvasTexture('plaza', 256, (ctx, size, random) => {
    ctx.fillStyle = '#b3ada0'; ctx.fillRect(0, 0, size, size);
    const paver = size / 4;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      ctx.fillStyle = ['#b8b2a4', '#ada798', '#c0baab', '#a8a294'][(random() * 4) | 0];
      ctx.fillRect(col * paver + 1, row * paver + 1, paver - 2, paver - 2);
    }
    ctx.strokeStyle = 'rgba(120,117,105,.5)'; ctx.lineWidth = 1.5;
    for (let gridLine = 0; gridLine <= 4; gridLine++) { ctx.beginPath(); ctx.moveTo(gridLine * paver, 0); ctx.lineTo(gridLine * paver, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, gridLine * paver); ctx.lineTo(size, gridLine * paver); ctx.stroke(); }
    speckle(ctx, size, random, 900, ['#9a9587', '#c7c1b2'], 0.25);
  });

  textures.sand = canvasTexture('sand', 256, (ctx, size, random) => {
    ctx.fillStyle = '#e2c496'; ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, 5000, ['#d5b484', '#efd9ae', '#c9a878', '#f4e2bb'], 0.5);
    ctx.lineWidth = 2;
    for (let rippleIndex = 0; rippleIndex < 16; rippleIndex++) {
      ctx.globalAlpha = 0.12 + random() * 0.1;
      ctx.strokeStyle = random() < 0.5 ? '#f6e6c2' : '#c4a173';
      ctx.beginPath();
      const rippleY = random() * size;
      ctx.moveTo(0, rippleY);
      for (let stepX = 0; stepX <= size; stepX += 16) ctx.lineTo(stepX, rippleY + Math.sin((stepX + rippleIndex * 30) * 0.03) * 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  textures.water = canvasTexture('water', 256, (ctx, size, random) => {
    ctx.fillStyle = '#2f7f88'; ctx.fillRect(0, 0, size, size);
    for (let waveIndex = 0; waveIndex < 40; waveIndex++) {
      ctx.globalAlpha = 0.05 + random() * 0.10;
      ctx.strokeStyle = random() < 0.55 ? '#8fd0c9' : '#1e5f68';
      ctx.lineWidth = 1 + random() * 2.5;
      const waveY = random() * size;
      ctx.beginPath(); ctx.moveTo(0, waveY);
      for (let stepX = 0; stepX <= size; stepX += 8) ctx.lineTo(stepX, waveY + Math.sin((stepX + waveIndex * 41) * 0.045) * 5);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.16; ctx.fillStyle = '#bfe7dd';
    for (let glintIndex = 0; glintIndex < 22; glintIndex++) ctx.fillRect(random() * size, random() * size, 6 + random() * 22, 1.5);
    ctx.globalAlpha = 1;
  });

  textures.grass = canvasTexture('grass', 256, (ctx, size, random) => {
    ctx.fillStyle = '#4f7448'; ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, 3000, ['#426a3d', '#5d8452', '#6b9159', '#3b5f37'], 0.55);
    ctx.lineWidth = 1;
    for (let bladeIndex = 0; bladeIndex < 500; bladeIndex++) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = random() < 0.5 ? '#729a5f' : '#3a5a34';
      const bladeX = random() * size, bladeY = random() * size;
      ctx.beginPath(); ctx.moveTo(bladeX, bladeY); ctx.lineTo(bladeX + (random() - 0.5) * 3, bladeY - 2 - random() * 3); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  // Facade tiles are 2 bays across x 2 floors: a 3.2m window bay.
  textures.facadeGlass = canvasTexture('facadeGlass', 256, (ctx, size, random) => {
    ctx.fillStyle = '#31474d'; ctx.fillRect(0, 0, size, size);
    const bay = size / 2;
    for (let bayRow = 0; bayRow < 2; bayRow++) for (let bayCol = 0; bayCol < 2; bayCol++) {
      const bayX = bayCol * bay, bayY = bayRow * bay;
      ctx.fillStyle = '#4a6165'; ctx.fillRect(bayX, bayY, bay, bay);
      const windowX = bayX + 5, windowY = bayY + 6, windowWidth = bay - 10, windowHeight = bay - 12;
      const variant = random();
      const gradient = ctx.createLinearGradient(windowX, windowY, windowX + windowWidth, windowY + windowHeight);
      if (variant < 0.07) { gradient.addColorStop(0, '#ffd89b'); gradient.addColorStop(1, '#c3843f'); }
      else if (variant < 0.17) { gradient.addColorStop(0, '#a9dad4'); gradient.addColorStop(1, '#5d8f95'); }
      else { gradient.addColorStop(0, '#436f74'); gradient.addColorStop(1, '#244046'); }
      ctx.fillStyle = gradient; ctx.fillRect(windowX, windowY, windowWidth, windowHeight);
      ctx.globalAlpha = 0.16; ctx.fillStyle = '#d5efea';
      ctx.beginPath(); ctx.moveTo(windowX, windowY + windowHeight); ctx.lineTo(windowX + windowWidth * 0.5, windowY); ctx.lineTo(windowX + windowWidth * 0.78, windowY); ctx.lineTo(windowX, windowY + windowHeight * 0.58); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1d3136';
      ctx.fillRect(windowX + windowWidth / 2 - 1.5, windowY, 3, windowHeight);
      ctx.fillRect(windowX, windowY + windowHeight / 2 - 1.5, windowWidth, 3);
      ctx.fillStyle = 'rgba(160,190,188,.25)'; ctx.fillRect(windowX, windowY, windowWidth, 2);
    }
    ctx.fillStyle = 'rgba(18,32,36,.6)'; ctx.fillRect(0, 0, size, 3); ctx.fillRect(0, size / 2, size, 3);
  });

  textures.facadeStone = canvasTexture('facadeStone', 256, (ctx, size, random) => {
    ctx.fillStyle = '#b8b1a2'; ctx.fillRect(0, 0, size, size);
    const bay = size / 2;
    speckle(ctx, size, random, 900, ['#c4bdad', '#a9a293', '#cfc8b8'], 0.35);
    for (let bayRow = 0; bayRow < 2; bayRow++) for (let bayCol = 0; bayCol < 2; bayCol++) {
      const bayX = bayCol * bay, bayY = bayRow * bay;
      ctx.fillStyle = 'rgba(120,113,99,.35)'; ctx.fillRect(bayX + 6, bayY + 52, bay - 12, 4);
      const windowX = bayX + 17, windowY = bayY + 16, windowWidth = bay - 34, windowHeight = bay - 52;
      ctx.fillStyle = '#5d6a6c'; ctx.fillRect(windowX - 3, windowY - 3, windowWidth + 6, windowHeight + 6);
      const lit = random() < 0.12;
      ctx.fillStyle = lit ? '#f2c383' : '#31484f';
      ctx.fillRect(windowX, windowY, windowWidth, windowHeight);
      if (!lit) { ctx.globalAlpha = 0.25; ctx.fillStyle = '#9dc2c0'; ctx.fillRect(windowX, windowY, windowWidth, windowHeight * 0.4); ctx.globalAlpha = 1; }
      ctx.fillStyle = '#8c8677'; ctx.fillRect(windowX - 5, windowY + windowHeight + 3, windowWidth + 10, 5);
      ctx.fillStyle = 'rgba(40,52,54,.5)'; ctx.fillRect(windowX + windowWidth / 2 - 1, windowY, 2, windowHeight);
    }
    ctx.fillStyle = 'rgba(150,143,128,.5)'; ctx.fillRect(0, 0, size, 4); ctx.fillRect(0, size / 2, size, 4);
  });

  textures.facadeStucco = canvasTexture('facadeStucco', 256, (ctx, size, random) => {
    ctx.fillStyle = '#e9dcc4'; ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, 1400, ['#ded0b6', '#f2e6d0', '#d6c7ab'], 0.4);
    const bay = size / 2;
    for (let bayRow = 0; bayRow < 2; bayRow++) for (let bayCol = 0; bayCol < 2; bayCol++) {
      const bayX = bayCol * bay, bayY = bayRow * bay;
      const windowX = bayX + 30, windowY = bayY + 24, windowWidth = bay - 60, windowHeight = bay - 56;
      ctx.fillStyle = '#3f4f50'; ctx.fillRect(windowX - 2, windowY - 2, windowWidth + 4, windowHeight + 4);
      const lit = random() < 0.08;
      ctx.fillStyle = lit ? '#f7c98f' : '#54706f';
      ctx.fillRect(windowX, windowY, windowWidth, windowHeight);
      ctx.fillStyle = '#f6efdf'; ctx.fillRect(windowX - 4, windowY + windowHeight / 2 - 1.5, windowWidth + 8, 3);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(windowX, windowY, windowWidth, 2);
      ctx.fillStyle = '#cdbfa6'; ctx.fillRect(windowX - 5, windowY + windowHeight + 3, windowWidth + 10, 4);
    }
    ctx.fillStyle = 'rgba(180,166,140,.45)'; ctx.fillRect(0, 0, size, 3); ctx.fillRect(0, size / 2, size, 3);
  });

  textures.facadeBrick = canvasTexture('facadeBrick', 256, (ctx, size, random) => {
    ctx.fillStyle = '#8f5342'; ctx.fillRect(0, 0, size, size);
    for (let brickY = 0; brickY < size; brickY += 8) {
      for (let brickX = (brickY / 8) % 2 ? -6 : 0; brickX < size; brickX += 16) {
        ctx.fillStyle = ['#9a5d4a', '#8a4f3f', '#a4664f', '#7f4838'][(random() * 4) | 0];
        ctx.fillRect(brickX + 1, brickY + 1, 14, 6);
      }
      ctx.fillStyle = 'rgba(212,196,178,.55)'; ctx.fillRect(0, brickY, size, 1);
    }
    const bay = size / 2;
    for (let bayRow = 0; bayRow < 2; bayRow++) for (let bayCol = 0; bayCol < 2; bayCol++) {
      const bayX = bayCol * bay, bayY = bayRow * bay;
      const windowX = bayX + 26, windowY = bayY + 22, windowWidth = bay - 52, windowHeight = bay - 50;
      ctx.fillStyle = '#d8cdb8'; ctx.fillRect(windowX - 5, windowY - 5, windowWidth + 10, windowHeight + 10);
      const lit = random() < 0.1;
      ctx.fillStyle = lit ? '#f4c085' : '#3b5155';
      ctx.fillRect(windowX, windowY, windowWidth, windowHeight);
      ctx.fillStyle = '#cdbfa4'; ctx.fillRect(windowX - 4, windowY - 12, windowWidth + 8, 5);
      ctx.fillStyle = 'rgba(30,44,46,.45)'; ctx.fillRect(windowX, windowY, windowWidth, 2);
    }
    ctx.fillStyle = 'rgba(50,34,30,.45)'; ctx.fillRect(0, 0, size, 4); ctx.fillRect(0, size / 2, size, 4);
  });

  textures.corrugated = canvasTexture('corrugated', 256, (ctx, size, random) => {
    ctx.fillStyle = '#8d9391'; ctx.fillRect(0, 0, size, size);
    for (let ribX = 0; ribX < size; ribX += 8) {
      ctx.fillStyle = (ribX / 8) % 2 ? '#969c99' : '#7f8583';
      ctx.fillRect(ribX, 0, 8, size);
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(ribX + 1, 0, 2, size);
      ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(ribX + 6, 0, 2, size);
    }
    for (let rustIndex = 0; rustIndex < 26; rustIndex++) {
      ctx.globalAlpha = 0.05 + random() * 0.09;
      ctx.fillStyle = random() < 0.5 ? '#6f5138' : '#4c5350';
      ctx.fillRect(((random() * size) | 0) & ~7, random() * size * 0.6, 3 + random() * 4, 20 + random() * 90);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(60,66,64,.5)';
    for (let rivetY = 4; rivetY < size; rivetY += 32) for (let rivetX = 4; rivetX < size; rivetX += 16) ctx.fillRect(rivetX, rivetY, 2, 2);
  });

  textures.roofGravel = canvasTexture('roofGravel', 128, (ctx, size, random) => {
    ctx.fillStyle = '#6d6c65'; ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, 2200, ['#7c7b73', '#5a5953', '#88867d', '#4f4e49'], 0.6);
    ctx.strokeStyle = 'rgba(48,48,44,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke();
    for (let patchIndex = 0; patchIndex < 4; patchIndex++) {
      ctx.globalAlpha = 0.10; ctx.fillStyle = '#8d8b80';
      ctx.fillRect(random() * size, random() * size, 20 + random() * 40, 14 + random() * 30);
    }
    ctx.globalAlpha = 1;
  });

  textures.roofTile = canvasTexture('roofTile', 128, (ctx, size, random) => {
    ctx.fillStyle = '#a86048'; ctx.fillRect(0, 0, size, size);
    for (let tileY = 0; tileY < size; tileY += 12) {
      ctx.fillStyle = '#8e4d38'; ctx.fillRect(0, tileY + 9, size, 3);
      for (let tileX = (tileY / 12) % 2 ? -8 : 0; tileX < size; tileX += 16) {
        ctx.fillStyle = ['#b5664b', '#a85c43', '#c07253', '#9a523c'][(random() * 4) | 0];
        ctx.fillRect(tileX + 1, tileY + 1, 14, 8);
        ctx.fillStyle = 'rgba(255,220,190,.18)'; ctx.fillRect(tileX + 1, tileY + 1, 14, 2);
      }
    }
    speckle(ctx, size, random, 400, ['#7d4533', '#c8805f'], 0.25);
  });

  textures.roofMetal = canvasTexture('roofMetal', 128, (ctx, size, random) => {
    ctx.fillStyle = '#7d827e'; ctx.fillRect(0, 0, size, size);
    for (let ribX = 0; ribX < size; ribX += 8) { ctx.fillStyle = (ribX / 8) % 2 ? '#878c88' : '#727773'; ctx.fillRect(ribX, 0, 8, size); }
    for (let rustIndex = 0; rustIndex < 14; rustIndex++) { ctx.globalAlpha = 0.08; ctx.fillStyle = '#5d4b38'; ctx.fillRect(random() * size, random() * size, 4 + random() * 14, 6 + random() * 30); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(60,64,60,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
  });

  textures.boardwalk = canvasTexture('boardwalk', 256, (ctx, size, random) => {
    for (let plankIndex = 0; plankIndex < 8; plankIndex++) {
      const plankY = plankIndex * 32;
      ctx.fillStyle = ['#9a7c58', '#8d704f', '#a5855f', '#94764f'][(random() * 4) | 0];
      ctx.fillRect(0, plankY, size, 30);
      ctx.fillStyle = 'rgba(58,44,30,.7)'; ctx.fillRect(0, plankY + 30, size, 2);
      ctx.globalAlpha = 0.25;
      for (let grainIndex = 0; grainIndex < 7; grainIndex++) {
        ctx.strokeStyle = random() < 0.5 ? '#6f5638' : '#b8996f';
        ctx.beginPath(); const grainY = plankY + 3 + random() * 24; ctx.moveTo(0, grainY); ctx.lineTo(size, grainY + (random() - 0.5) * 3); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(40,32,22,.6)';
      ctx.fillRect(6, plankY + 6, 2, 2); ctx.fillRect(size - 8, plankY + 6, 2, 2);
      ctx.fillRect(6, plankY + 22, 2, 2); ctx.fillRect(size - 8, plankY + 22, 2, 2);
    }
  });

  textures.concrete = canvasTexture('concrete', 128, (ctx, size, random) => {
    ctx.fillStyle = '#b2afa4'; ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, 1400, ['#a5a297', '#c1beb2', '#96948a'], 0.4);
    ctx.strokeStyle = 'rgba(120,117,108,.4)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(2, 2, size - 4, size - 4);
    for (let stainIndex = 0; stainIndex < 5; stainIndex++) {
      ctx.globalAlpha = 0.08; ctx.fillStyle = '#6f6d64';
      ctx.beginPath(); ctx.arc(random() * size, random() * size, 4 + random() * 14, 0, 6.3); ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  // Four in-world ads in one 256px atlas (2x2 quadrants of 128).
  textures.ads = canvasTexture('ads', 256, (ctx, size) => {
    const ad = (originX, originY, bgColor, textColor, accentColor, lines) => {
      ctx.fillStyle = bgColor; ctx.fillRect(originX, originY, 128, 128);
      ctx.fillStyle = accentColor; ctx.fillRect(originX, originY, 128, 12);
      ctx.fillStyle = accentColor; ctx.fillRect(originX, originY + 116, 128, 12);
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      lines.forEach((lineText, lineIndex) => {
        ctx.font = lineIndex === 0 ? '800 27px system-ui, sans-serif' : '600 17px system-ui, sans-serif';
        ctx.fillText(lineText, originX + 64, originY + 44 + lineIndex * 28, 116);
      });
      ctx.fillStyle = accentColor;
      ctx.fillRect(originX + 18, originY + 100, 92, 3);
    };
    ad(0, 0, '#10232b', '#ffe6b0', '#e8a34b', ['NIGHT', 'FREIGHT CO.']);
    ad(128, 0, '#2a1030', '#ffd9f2', '#ff5fa8', ['VICE 88.1', 'ALL NIGHT']);
    ad(0, 128, '#12282a', '#ffe9c0', '#57c7bd', ['PELICAN', 'MOTEL · VACANCY']);
    ad(128, 128, '#301a12', '#ffdca8', '#ff8a4c', ['SALT & IRON', 'MARINA BAR']);
  });

  return textures;
}

/* ------------------------------------------------------------------ material */

let MATERIALS = null;
function materials() {
  if (MATERIALS) return MATERIALS;
  const textures = makeTextures();
  const standard = (opts) => new THREE.MeshStandardMaterial(opts);
  MATERIALS = {
    road: standard({map: textures.asphalt, roughness: 0.95, metalness: 0.0, vertexColors: true}),
    walk: standard({map: textures.sidewalk, roughness: 0.92, vertexColors: true}),
    plaza: standard({map: textures.plaza, roughness: 0.9, vertexColors: true}),
    sand: standard({map: textures.sand, roughness: 0.98, vertexColors: true}),
    water: standard({map: textures.water, color: 0x9fd8d6, roughness: 0.42, metalness: 0.15}),
    pool: standard({color: 0x3d8f9c, roughness: 0.16, metalness: 0.3}),
    grass: standard({map: textures.grass, roughness: 0.95, vertexColors: true}),
    paint: standard({color: 0xeee0b6, roughness: 0.85}),
    board: standard({map: textures.boardwalk, roughness: 0.9, vertexColors: true}),
    glass: standard({map: textures.facadeGlass, roughness: 0.38, metalness: 0.28, vertexColors: true}),
    stone: standard({map: textures.facadeStone, roughness: 0.8, metalness: 0.04, vertexColors: true}),
    stucco: standard({map: textures.facadeStucco, roughness: 0.86, vertexColors: true}),
    brick: standard({map: textures.facadeBrick, roughness: 0.88, vertexColors: true}),
    metal: standard({map: textures.corrugated, roughness: 0.62, metalness: 0.35, vertexColors: true}),
    concrete: standard({map: textures.concrete, roughness: 0.9, vertexColors: true}),
    roofDark: standard({map: textures.roofGravel, roughness: 0.95, vertexColors: true}),
    roofTile: standard({map: textures.roofTile, roughness: 0.9, vertexColors: true}),
    roofMetal: standard({map: textures.roofMetal, roughness: 0.6, metalness: 0.35, vertexColors: true}),
    ads: new THREE.MeshBasicMaterial({map: textures.ads, side: THREE.DoubleSide})
  };
  MATERIALS.ads.map.repeat.set(1, 1);
  return MATERIALS;
}

/* --------------------------------------------------------------- geometry */

function emptyGeo() { return {positions: [], normals: [], uvs: [], colors: [], indices: []}; }

// One quad, with explicit UVs, a flat normal and a flat colour. Winding is CCW from outside.
function quadRaw(buffer, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz,
  au, av, bu, bv, cu, cv, du, dv, nx, ny, nz, colorR, colorG, colorB) {
  const baseIndex = buffer.positions.length / 3;
  buffer.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
  buffer.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
  buffer.uvs.push(au, av, bu, bv, cu, cv, du, dv);
  buffer.colors.push(colorR, colorG, colorB, colorR, colorG, colorB, colorR, colorG, colorB, colorR, colorG, colorB);
  buffer.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
}
function triRaw(buffer, ax, ay, az, bx, by, bz, cx, cy, cz,
  au, av, bu, bv, cu, cv, nx, ny, nz, colorR, colorG, colorB) {
  const baseIndex = buffer.positions.length / 3;
  buffer.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  buffer.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  buffer.uvs.push(au, av, bu, bv, cu, cv);
  buffer.colors.push(colorR, colorG, colorB, colorR, colorG, colorB, colorR, colorG, colorB);
  buffer.indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
}

// Four walls of an axis-aligned box; uv runs in world units so window bays never stretch.
function boxSides(buffer, minX, maxX, minY, maxY, minZ, maxZ, color, tile, uvOffsetU, uvOffsetV) {
  const width = maxX - minX, depth = maxZ - minZ, height = maxY - minY, uvScale = 1 / tile;
  const colorR = color[0], colorG = color[1], colorB = color[2];
  quadRaw(buffer, minX, minY, maxZ, maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ,
    uvOffsetU, uvOffsetV, uvOffsetU + width * uvScale, uvOffsetV, uvOffsetU + width * uvScale, uvOffsetV + height * uvScale, uvOffsetU, uvOffsetV + height * uvScale, 0, 0, 1, colorR, colorG, colorB);
  quadRaw(buffer, maxX, minY, minZ, minX, minY, minZ, minX, maxY, minZ, maxX, maxY, minZ,
    uvOffsetU, uvOffsetV, uvOffsetU + width * uvScale, uvOffsetV, uvOffsetU + width * uvScale, uvOffsetV + height * uvScale, uvOffsetU, uvOffsetV + height * uvScale, 0, 0, -1, colorR, colorG, colorB);
  quadRaw(buffer, maxX, minY, maxZ, maxX, minY, minZ, maxX, maxY, minZ, maxX, maxY, maxZ,
    uvOffsetU, uvOffsetV, uvOffsetU + depth * uvScale, uvOffsetV, uvOffsetU + depth * uvScale, uvOffsetV + height * uvScale, uvOffsetU, uvOffsetV + height * uvScale, 1, 0, 0, colorR, colorG, colorB);
  quadRaw(buffer, minX, minY, minZ, minX, minY, maxZ, minX, maxY, maxZ, minX, maxY, minZ,
    uvOffsetU, uvOffsetV, uvOffsetU + depth * uvScale, uvOffsetV, uvOffsetU + depth * uvScale, uvOffsetV + height * uvScale, uvOffsetU, uvOffsetV + height * uvScale, -1, 0, 0, colorR, colorG, colorB);
}
function boxTop(buffer, minX, maxX, topY, minZ, maxZ, color, tile, offsetU, offsetV) {
  const uvScale = 1 / tile;
  offsetU = offsetU || 0; offsetV = offsetV || 0;
  quadRaw(buffer, minX, topY, minZ, minX, topY, maxZ, maxX, topY, maxZ, maxX, topY, minZ,
    minX * uvScale + offsetU, minZ * uvScale + offsetV, minX * uvScale + offsetU, maxZ * uvScale + offsetV, maxX * uvScale + offsetU, maxZ * uvScale + offsetV, maxX * uvScale + offsetU, minZ * uvScale + offsetV,
    0, 1, 0, color[0], color[1], color[2]);
}
// Ground rectangle with uv in world units.
function groundQuad(buffer, minX, maxX, minZ, maxZ, height, tile, color) {
  const uvScale = 1 / tile;
  quadRaw(buffer, minX, height, minZ, minX, height, maxZ, maxX, height, maxZ, maxX, height, minZ,
    minX * uvScale, minZ * uvScale, minX * uvScale, maxZ * uvScale, maxX * uvScale, maxZ * uvScale, maxX * uvScale, minZ * uvScale,
    0, 1, 0, color[0], color[1], color[2]);
}

// Colour helpers (three multiplies vertex colour into the map).
const COL_CACHE = {};
function col(hex) {
  let rgb = COL_CACHE[hex];
  if (!rgb) { const threeColor = new THREE.Color(hex); rgb = COL_CACHE[hex] = [threeColor.r, threeColor.g, threeColor.b]; }
  return rgb;
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
let BUFFERS = null;
let INSTANCES = null;
let COLLIDERS = null;
let WALKS = null;
let TRAFFIC_LIGHTS = null;
let LANDMARKS = null;
let BUILDING_COUNT = 0;

function collider(minX, minZ, maxX, maxZ, minY, maxY) {
  COLLIDERS.push({minX, maxX, minZ, maxZ, minY, maxY});
}
function addInst(kind, x, y, z, scaleX, scaleY, scaleZ, color, rotY, rotX, rotZ) {
  INSTANCES[kind].push({x, y, z, scaleX, scaleY, scaleZ, color, rotY: rotY || 0, rotX: rotX || 0, rotZ: rotZ || 0});
}
function propBox(x, z, baseY, width, height, depth, color, rotY, rotX, rotZ) {
  addInst('box', x, baseY + height / 2, z, width, height, depth, color, rotY, rotX, rotZ);
}
function propCyl(x, z, baseY, diameter, height, color) {
  addInst('cyl', x, baseY + height / 2, z, diameter, height, diameter, color);
}
function propCone(x, z, baseY, diameter, height, color) {
  addInst('cone', x, baseY + height / 2, z, diameter, height, diameter, color);
}

/* ------------------------------------------------------------- small props */

function lamp(x, z, armX, armZ) {
  propCyl(x, z, 0, 0.26, 6.2, 0x333d40);
  const armYaw = Math.atan2(-armZ, armX);
  propBox(x + armX * 0.95, z + armZ * 0.95, 5.9, 1.9, 0.16, 0.22, 0x333d40, armYaw);
  addInst('bulb', x + armX * 1.75, 5.78, z + armZ * 1.75, 0.55, 0.34, 0.55, 0xffd79a);
  propBox(x, z, 0, 0.5, 0.12, 0.5, 0x2c3538);
}

function bench(x, z, yaw) {
  const woodColor = 0x6b5236;
  propBox(x, z, 0.42, 2.2, 0.14, 0.62, woodColor, yaw);
  propBox(x - Math.sin(yaw) * 0.26, z - Math.cos(yaw) * 0.26, 0.56, 2.2, 0.5, 0.1, woodColor, yaw);
  const legOffsetX = Math.cos(yaw) * 0.85, legOffsetZ = -Math.sin(yaw) * 0.85;
  propBox(x - legOffsetX, z - legOffsetZ, 0, 0.12, 0.44, 0.5, 0x3a3d3a, yaw);
  propBox(x + legOffsetX, z + legOffsetZ, 0, 0.12, 0.44, 0.5, 0x3a3d3a, yaw);
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
  const trunkHeight = 3.2 + hash3(salt, 1, 151) * 2.4;
  propCyl(x, z, 0, 0.34, trunkHeight, 0x6d5138);
  const canopySize = 2.4 + hash3(salt, 2, 157) * 1.6;
  addInst('sphere', x, trunkHeight + canopySize * 0.32, z, canopySize * 1.1, canopySize * 1.25, canopySize * 1.1,
    LEAF[(hash3(salt, 3, 163) * LEAF.length) | 0]);
}

function palm(x, z, salt) {
  const trunkHeight = 5.4 + hash3(salt, 1, 171) * 4.6;
  addInst('cyl', x, trunkHeight / 2, z, 0.4, trunkHeight, 0.4, 0x8b6f4e);
  for (let frondIndex = 0; frondIndex < 7; frondIndex++) {
    const frondAngle = (frondIndex / 7) * Math.PI * 2 + hash3(salt, frondIndex, 173) * 0.55;
    addInst('frond', x, trunkHeight - 0.25, z, 1, 1, 1, FROND[(hash3(salt, frondIndex, 177) * FROND.length) | 0], frondAngle);
  }
  addInst('sphere', x, trunkHeight - 0.15, z, 0.55, 0.45, 0.55, 0x6b5a3a);
}

/* -------------------------------------------------------------- blocks */

function sidewalkRing(centerX, centerZ) {
  const outer = WALK_OUTER, inner = CORE, walkY = WALK_Y;
  const white = col(0xffffff);
  const parts = [
    [centerX - outer, centerX + outer, centerZ - outer, centerZ - inner],
    [centerX - outer, centerX + outer, centerZ + inner, centerZ + outer],
    [centerX - outer, centerX - inner, centerZ - inner, centerZ + inner],
    [centerX + inner, centerX + outer, centerZ - inner, centerZ + inner]
  ];
  for (const part of parts) {
    boxSides(BUFFERS.walk, part[0], part[1], 0, walkY, part[2], part[3], white, 2.4, 0, 0);
    boxTop(BUFFERS.walk, part[0], part[1], walkY, part[2], part[3], white, 2.4);
  }
  WALKS.push({x: centerX, z: centerZ, minX: centerX - outer, maxX: centerX + outer, minZ: centerZ - outer, maxZ: centerZ + outer, y: walkY});
}

function plazaPave(centerX, centerZ) {
  groundQuad(BUFFERS.plaza, centerX - CORE, centerX + CORE, centerZ - CORE, centerZ + CORE, 0.03, 3, col(0xffffff));
}
function grassPave(centerX, centerZ) {
  groundQuad(BUFFERS.grass, centerX - CORE, centerX + CORE, centerZ - CORE, centerZ + CORE, 0.03, 7, col(0xffffff));
}

/* ------------------------------------------------------------- downtown */

function tower(centerX, centerZ, width, depth, height, seed, core) {
  const glassy = hash3(seed, 3, 41) < 0.52;
  const wallBuffer = glassy ? BUFFERS.glass : BUFFERS.stone;
  const tint = TINTS_G[(hash3(seed, 4, 43) * TINTS_G.length) | 0];
  const uvOffset = hash3(seed, 5, 47) * 9;
  const podiumWidth = width + 1.1, podiumDepth = depth + 1.1;
  const podiumHeight = 4.2 + hash3(seed, 6, 49) * 2.4;

  boxSides(wallBuffer, centerX - podiumWidth / 2, centerX + podiumWidth / 2, 0, podiumHeight, centerZ - podiumDepth / 2, centerZ + podiumDepth / 2, tint, 6.4, uvOffset, 0);
  boxTop(BUFFERS.roofDark, centerX - podiumWidth / 2, centerX + podiumWidth / 2, podiumHeight, centerZ - podiumDepth / 2, centerZ + podiumDepth / 2, col(0x8b8a80), 4);
  // shopfront band on the podium so the base does not read as a blank plinth
  propBox(centerX, centerZ + podiumDepth / 2 + 0.1, 0, podiumWidth * 0.92, 3.0, 0.18, 0x2f3f42);

  const firstTierHeight = Math.max(podiumHeight + 5, height * (0.5 + hash3(seed, 7, 53) * 0.2));
  boxSides(wallBuffer, centerX - width / 2, centerX + width / 2, podiumHeight, firstTierHeight, centerZ - depth / 2, centerZ + depth / 2, tint, 6.4, uvOffset, 0);
  boxTop(BUFFERS.roofDark, centerX - width / 2, centerX + width / 2, firstTierHeight, centerZ - depth / 2, centerZ + depth / 2, col(0x83827a), 4);

  const secondTierWidth = width * (0.74 + hash3(seed, 8, 59) * 0.1);
  const secondTierDepth = depth * (0.74 + hash3(seed, 8, 59) * 0.1);
  const secondTierHeight = Math.min(height - 3, firstTierHeight + (height - firstTierHeight) * 0.55);
  if (secondTierHeight > firstTierHeight + 2) {
    boxSides(wallBuffer, centerX - secondTierWidth / 2, centerX + secondTierWidth / 2, firstTierHeight, secondTierHeight, centerZ - secondTierDepth / 2, centerZ + secondTierDepth / 2, tint, 6.4, uvOffset, 0);
    boxTop(BUFFERS.roofDark, centerX - secondTierWidth / 2, centerX + secondTierWidth / 2, secondTierHeight, centerZ - secondTierDepth / 2, centerZ + secondTierDepth / 2, col(0x83827a), 4);
  }
  const topTierWidth = secondTierWidth * 0.66, topTierDepth = secondTierDepth * 0.66;
  if (height > secondTierHeight + 2.5) {
    boxSides(wallBuffer, centerX - topTierWidth / 2, centerX + topTierWidth / 2, secondTierHeight, height, centerZ - topTierDepth / 2, centerZ + topTierDepth / 2, tint, 6.4, uvOffset, 0);
    boxTop(BUFFERS.roofDark, centerX - topTierWidth / 2, centerX + topTierWidth / 2, height, centerZ - topTierDepth / 2, centerZ + topTierDepth / 2, col(0x83827a), 4);
    // crown band
    boxSides(BUFFERS.concrete, centerX - topTierWidth / 2 - 0.35, centerX + topTierWidth / 2 + 0.35, height - 1.1, height + 0.45,
      centerZ - topTierDepth / 2 - 0.35, centerZ + topTierDepth / 2 + 0.35, col(0xd8d4c8), 4, 0, 0);
    boxTop(BUFFERS.concrete, centerX - topTierWidth / 2 - 0.35, centerX + topTierWidth / 2 + 0.35, height + 0.45,
      centerZ - topTierDepth / 2 - 0.35, centerZ + topTierDepth / 2 + 0.35, col(0xd8d4c8), 4);
  }

  const roofY = height + (height > secondTierHeight + 2.5 ? 0.45 : 0);
  const roofUnits = 1 + ((hash3(seed, 9, 61) * 3) | 0);
  for (let unitIndex = 0; unitIndex < roofUnits; unitIndex++) {
    const unitX = centerX + (hash3(seed, 10 + unitIndex, 67) - 0.5) * Math.max(1, topTierWidth - 3);
    const unitZ = centerZ + (hash3(seed, 20 + unitIndex, 71) - 0.5) * Math.max(1, topTierDepth - 3);
    propBox(unitX, unitZ, roofY, 1.5 + hash3(seed, unitIndex, 73) * 1.7, 0.9 + hash3(seed, unitIndex, 79) * 0.9, 1.4, 0x9a9c95);
  }
  if (height > 46 && hash3(seed, 8, 79) < 0.8) {
    const antennaHeight = 7 + hash3(seed, 11, 83) * 9;
    propBox(centerX, centerZ, roofY + 0.9, 0.2, antennaHeight, 0.2, 0x8a8d86);
    addInst('bulb', centerX, roofY + 0.9 + antennaHeight, centerZ, 0.42, 0.42, 0.42, 0xff6a5a);
  }
  if (!glassy && height > 12 && height < 48 && hash3(seed, 13, 89) < 0.55) {
    for (let balconyY = 6; balconyY < height - 2.5; balconyY += 3.4) {
      propBox(centerX, centerZ + depth / 2 + 0.6, balconyY, width * 0.44, 0.12, 1.15, 0x3c3f3d);
      propBox(centerX, centerZ + depth / 2 + 1.12, balconyY + 0.55, width * 0.44, 0.95, 0.08, 0x3c3f3d);
    }
  }
  collider(centerX - podiumWidth / 2, centerZ - podiumDepth / 2, centerX + podiumWidth / 2, centerZ + podiumDepth / 2, 0, height);
  BUILDING_COUNT++;
}

function downtownBlock(centerX, centerZ, blockI, blockJ) {
  plazaPave(centerX, centerZ);
  if (blockI === 5 && blockJ === 5) { viceTower(centerX, centerZ); return; }
  const core = Math.abs(centerX) < 72 && Math.abs(centerZ) < 72;
  const roll = (salt) => hash3(blockI, blockJ, 100 + salt);
  const layoutRoll = roll(1);
  if (layoutRoll < 0.46) {
    const width = 10.4 + roll(3) * 4.4, depth = 10.4 + roll(4) * 4.4;
    const height = core ? 44 + roll(5) * 48 : 17 + roll(6) * 24;
    tower(centerX + (roll(7) - 0.5) * 1.2, centerZ + (roll(8) - 0.5) * 1.2, width, depth, height, blockI * 97 + blockJ, core);
  } else if (layoutRoll < 0.78) {
    const firstHeight = core ? 34 + roll(9) * 40 : 14 + roll(10) * 20;
    const secondHeight = core ? 30 + roll(11) * 46 : 14 + roll(12) * 22;
    tower(centerX - 4.3, centerZ + (roll(13) - 0.5) * 0.6, 7.2, 13.2, firstHeight, blockI * 97 + blockJ + 1, core);
    tower(centerX + 4.3, centerZ + (roll(14) - 0.5) * 0.6, 7.2, 13.2, secondHeight, blockI * 97 + blockJ + 2, core);
  } else {
    for (let rowIndex = 0; rowIndex < 2; rowIndex++) for (let colIndex = 0; colIndex < 2; colIndex++) {
      const height = core ? 22 + roll(15 + rowIndex * 2 + colIndex) * 34 : 11 + roll(15 + rowIndex * 2 + colIndex) * 15;
      tower(centerX - 4.3 + rowIndex * 8.6, centerZ - 4.3 + colIndex * 8.6, 7.4, 7.4, height, blockI * 97 + blockJ + 3 + rowIndex * 2 + colIndex, false);
    }
  }
}

function viceTower(centerX, centerZ) {
  const glassBuffer = BUFFERS.glass;
  const tint = col(0xd8ece8);
  boxSides(glassBuffer, centerX - 8, centerX + 8, 0, 12, centerZ - 8, centerZ + 8, tint, 6.4, 2.2, 0);
  boxSides(BUFFERS.stone, centerX - 8.4, centerX + 8.4, 0, 1.4, centerZ - 8.4, centerZ + 8.4, col(0xd6cfbd), 4, 0, 0);
  boxTop(BUFFERS.roofDark, centerX - 8.4, centerX + 8.4, 12, centerZ - 8.4, centerZ + 8.4, col(0x87867d), 4);
  boxSides(glassBuffer, centerX - 6.4, centerX + 6.4, 12, 58, centerZ - 6.4, centerZ + 6.4, tint, 6.4, 2.2, 0);
  boxTop(BUFFERS.roofDark, centerX - 6.4, centerX + 6.4, 58, centerZ - 6.4, centerZ + 6.4, col(0x87867d), 4);
  boxSides(glassBuffer, centerX - 5.1, centerX + 5.1, 58, 88, centerZ - 5.1, centerZ + 5.1, tint, 6.4, 2.2, 0);
  boxTop(BUFFERS.roofDark, centerX - 5.1, centerX + 5.1, 88, centerZ - 5.1, centerZ + 5.1, col(0x87867d), 4);
  boxSides(glassBuffer, centerX - 3.6, centerX + 3.6, 88, 106, centerZ - 3.6, centerZ + 3.6, tint, 6.4, 2.2, 0);
  boxSides(BUFFERS.concrete, centerX - 4.1, centerX + 4.1, 104.5, 107.2, centerZ - 4.1, centerZ + 4.1, col(0xe2dccb), 4, 0, 0);
  boxTop(BUFFERS.concrete, centerX - 4.1, centerX + 4.1, 107.2, centerZ - 4.1, centerZ + 4.1, col(0xe2dccb), 4);
  propCyl(centerX, centerZ, 107.2, 1.0, 10, 0xb9bdb6);
  propBox(centerX, centerZ, 116, 0.25, 9, 0.25, 0xd9d6cc);
  addInst('bulb', centerX, 125.4, centerZ, 0.7, 0.7, 0.7, 0xff6a5a);
  // plaza furniture around the tower
  for (let planterIndex = 0; planterIndex < 4; planterIndex++) {
    const angle = (planterIndex / 4) * Math.PI * 2 + 0.4;
    planter(centerX + Math.cos(angle) * 6.4, centerZ + Math.sin(angle) * 6.4, planterIndex + 40);
  }
  collider(centerX - 8.4, centerZ - 8.4, centerX + 8.4, centerZ + 8.4, 0, 126);
  BUILDING_COUNT++;
  LANDMARKS.push({name: 'Vice Tower', x: centerX, z: centerZ, district: 'Downtown'});
}

/* -------------------------------------------------------------- suburbs */

function gableRoof(centerX, centerZ, width, depth, baseY, rise, color, wallBuffer, wallTint) {
  const minX = centerX - width / 2, maxX = centerX + width / 2, minZ = centerZ - depth / 2, maxZ = centerZ + depth / 2, ridgeY = baseY + rise;
  const slopeLength = Math.hypot(depth / 2, rise), normalY = (depth / 2) / slopeLength, normalZ = rise / slopeLength, roofTile = 2.2;
  quadRaw(BUFFERS.roofTile, minX, baseY, maxZ, maxX, baseY, maxZ, maxX, ridgeY, centerZ, minX, ridgeY, centerZ,
    minX / roofTile, 0, maxX / roofTile, 0, maxX / roofTile, slopeLength / roofTile, minX / roofTile, slopeLength / roofTile, 0, normalY, normalZ, color[0], color[1], color[2]);
  quadRaw(BUFFERS.roofTile, maxX, baseY, minZ, minX, baseY, minZ, minX, ridgeY, centerZ, maxX, ridgeY, centerZ,
    maxX / roofTile, 0, minX / roofTile, 0, minX / roofTile, slopeLength / roofTile, maxX / roofTile, slopeLength / roofTile, 0, normalY, -normalZ, color[0], color[1], color[2]);
  triRaw(wallBuffer, minX, baseY, minZ, minX, baseY, maxZ, minX, ridgeY, centerZ,
    minZ / roofTile, 0, maxZ / roofTile, 0, (minZ + maxZ) / 2 / roofTile, rise / roofTile, -1, 0, 0,
    wallTint[0], wallTint[1], wallTint[2]);
  triRaw(wallBuffer, maxX, baseY, maxZ, maxX, baseY, minZ, maxX, ridgeY, centerZ,
    maxZ / roofTile, 0, minZ / roofTile, 0, (minZ + maxZ) / 2 / roofTile, rise / roofTile, 1, 0, 0,
    wallTint[0], wallTint[1], wallTint[2]);
  // ridge cap
  propBox(centerX, centerZ, ridgeY - 0.12, width + 0.12, 0.22, 0.5, 0x8c4c37);
}

function house(centerX, centerZ, salt, front) {
  const roll = (key) => hash3(salt, key, 131);
  const width = 4.5 + roll(1) * 1.0, depth = 4.3 + roll(2) * 1.0;
  const twoStorey = roll(3) > 0.45;
  const wallHeight = twoStorey ? 5.9 : 3.1;
  const tint = HOUSE_TINTS[(roll(4) * HOUSE_TINTS.length) | 0];
  const wallBuffer = roll(5) < 0.68 ? BUFFERS.stucco : BUFFERS.brick;
  const frontZ = centerZ + front * (depth / 2 + 0.75);
  boxSides(wallBuffer, centerX - width / 2, centerX + width / 2, 0, wallHeight, centerZ - depth / 2, centerZ + depth / 2, tint, 4.8, roll(6) * 3, 0);
  gableRoof(centerX, centerZ, width + 0.7, depth + 0.9, wallHeight, 1.65 + roll(7) * 0.9, ROOF_TINTS[(roll(8) * ROOF_TINTS.length) | 0], wallBuffer, tint);
  // door + porch
  propBox(centerX, frontZ - front * 0.32, 0, 1.0, 2.0, 0.16, 0x5d4433);
  propBox(centerX, frontZ, 0.1, 2.8, 0.22, 1.5, 0xbdb29c);
  propBox(centerX, frontZ, 2.55, 3.0, 0.16, 1.7, tint);
  propCyl(centerX - 1.18, frontZ + front * 0.45, 0.1, 0.16, 2.5, 0xe9e2d2);
  propCyl(centerX + 1.18, frontZ + front * 0.45, 0.1, 0.16, 2.5, 0xe9e2d2);
  if (roll(9) < 0.55) propBox(centerX + width * 0.28, centerZ - depth * 0.18, wallHeight + 0.5, 0.66, 1.7, 0.66, 0x9c6a58);
  // driveway to the street and a picket fence either side of it
  const edgeZ = centerZ + front * 4.05;
  groundQuad(BUFFERS.plaza, centerX - 1.15, centerX + 1.15, Math.min(edgeZ, edgeZ - front * 3.2), Math.max(edgeZ, edgeZ - front * 3.2), 0.055, 3, col(0xd9d3c4));
  const fenceExtent = 4.0;
  const fenceSegment = 2.9;
  propBox(centerX - fenceExtent + fenceSegment / 2 - 0.6, frontZ + front * 0.9, 0.05, fenceSegment, 0.85, 0.09, 0xe6dfcd);
  propBox(centerX + fenceExtent - fenceSegment / 2 + 0.6, frontZ + front * 0.9, 0.05, fenceSegment, 0.85, 0.09, 0xe6dfcd);
  propBox(centerX - 1.6, frontZ + front * 0.9, 0.5, 0.12, 0.45, 0.12, 0xe6dfcd);
  propBox(centerX + 1.6, frontZ + front * 0.9, 0.5, 0.12, 0.45, 0.12, 0xe6dfcd);
  collider(centerX - width / 2, centerZ - depth / 2, centerX + width / 2, centerZ + depth / 2, 0, wallHeight + 2.4);
  BUILDING_COUNT++;
}

function pelicanMotel(centerX, centerZ) {
  plazaPave(centerX, centerZ);
  const wallBuffer = BUFFERS.stucco, tint = col(0xf4dfc0);
  for (const side of [-1, 1]) {
    const wingX = centerX + side * 5.4;
    boxSides(wallBuffer, wingX - 3.6, wingX + 3.6, 0, 6.4, centerZ - 7.6, centerZ + 1.2, tint, 4.8, 0.5, 0);
    boxSides(BUFFERS.concrete, wingX - 3.9, wingX + 3.9, 6.4, 7.0, centerZ - 7.9, centerZ + 1.5, col(0xd8cbb2), 3, 0, 0);
    boxTop(BUFFERS.roofDark, wingX - 3.9, wingX + 3.9, 7.0, centerZ - 7.9, centerZ + 1.5, col(0x8b8478), 4);
    for (let balconyY = 3.4; balconyY < 6.2; balconyY += 2.9) {
      propBox(wingX, centerZ + 1.5, balconyY, 3.0, 0.14, 1.1, 0x6b5540);
      propBox(wingX, centerZ + 2.05, balconyY + 0.5, 3.0, 0.85, 0.08, 0x6b5540);
    }
    collider(wingX - 3.9, centerZ - 7.9, wingX + 3.9, centerZ + 1.5, 0, 7);
    BUILDING_COUNT++;
  }
  groundQuad(BUFFERS.plaza, centerX - 6.4, centerX + 6.4, centerZ + 1.5, centerZ + 7.2, 0.06, 3, col(0xcfc8b8));
  // rooftop sign facing the street
  propBox(centerX - 2.6, centerZ + 5.2, 0, 0.3, 7.2, 0.3, 0x3d4442);
  propBox(centerX + 2.6, centerZ + 5.2, 0, 0.3, 7.2, 0.3, 0x3d4442);
  billboardPanel(centerX, 6.3, centerZ + 5.2, 7.2, 2.6, 0, 2);
  // pool and palms
  groundQuad(BUFFERS.water, centerX - 3.2, centerX + 3.2, centerZ + 2.2, centerZ + 6.0, 0.08, 6, col(0xbfe6e0));
  propBox(centerX, centerZ + 6.25, 0.06, 7.0, 0.16, 0.3, 0xe4dccb);
  palm(centerX - 7.2, centerZ + 4.0, 12);
  palm(centerX + 7.2, centerZ + 4.0, 13);
  LANDMARKS.push({name: 'Pelican Motel', x: centerX, z: centerZ, district: 'Suburbs'});
}

function suburbBlock(centerX, centerZ, blockI, blockJ) {
  for (let rowIndex = 0; rowIndex < 2; rowIndex++) for (let colIndex = 0; colIndex < 2; colIndex++) {
    const lotX = centerX - 4.05 + rowIndex * 8.1, lotZ = centerZ - 4.05 + colIndex * 8.1;
    groundQuad(BUFFERS.grass, lotX - 4.05, lotX + 4.05, lotZ - 4.05, lotZ + 4.05, 0.03, 7, col(0xffffff));
    house(lotX, lotZ, blockI * 131 + blockJ * 17 + rowIndex * 5 + colIndex * 3, colIndex === 0 ? -1 : 1);
    if (hash3(blockI, blockJ, 190 + rowIndex * 2 + colIndex) < 0.55) {
      tree(lotX + (rowIndex ? -3.1 : 3.1), lotZ + (colIndex ? 3.1 : -3.1), blockI * 31 + blockJ * 7 + rowIndex * 2 + colIndex);
    }
  }
}

/* ---------------------------------------------------------------- docks */

function warehouse(centerX, centerZ, width, depth, height, salt) {
  const tint = [col(0xffffff), col(0xd9e0dc), col(0xe6d3b4), col(0xc3ccc8)][(hash3(salt, 1, 191) * 4) | 0];
  boxSides(BUFFERS.metal, centerX - width / 2, centerX + width / 2, 0, height, centerZ - depth / 2, centerZ + depth / 2, tint, 4, hash3(salt, 2, 193) * 6, 0);
  boxTop(BUFFERS.roofMetal, centerX - width / 2, centerX + width / 2, height, centerZ - depth / 2, centerZ + depth / 2, col(0x878c88), 4);
  for (let ribIndex = 0; ribIndex < 3; ribIndex++) {
    propBox(centerX, centerZ - depth / 3 + ribIndex * depth / 3, height + 0.1, width * 0.92, 0.32, 0.55, 0xb9bdba);
  }
  const doorCount = 2 + ((hash3(salt, 3, 197) * 2) | 0);
  for (let doorIndex = 0; doorIndex < doorCount; doorIndex++) {
    const doorX = centerX - width / 2 + ((doorIndex + 0.5) * width) / doorCount;
    propBox(doorX, centerZ + depth / 2 + 0.14, 0, width / doorCount - 1.3, 4.6, 0.26, 0x59605d);
    propBox(doorX, centerZ + depth / 2 + 0.3, 4.5, width / doorCount - 0.9, 0.28, 0.5, 0xc9c7ba);
  }
  propBox(centerX, centerZ + depth / 2 + 1.2, 0, width * 0.92, 0.95, 2.4, 0xa8a496);
  collider(centerX - width / 2, centerZ - depth / 2, centerX + width / 2, centerZ + depth / 2, 0, height);
  BUILDING_COUNT++;
}

function containerStack(x, z, salt, tall) {
  const stackCount = 1 + ((hash3(salt, 1, 201) * tall) | 0);
  for (let levelIndex = 0; levelIndex < stackCount; levelIndex++) {
    const tint = CONTAINERS[(hash3(salt, levelIndex, 203) * CONTAINERS.length) | 0];
    addInst('container', x + (hash3(salt, levelIndex, 207) - 0.5) * 0.25, 1.32 + levelIndex * 2.64, z,
      6, 2.6, 2.5, tint, hash3(salt, levelIndex, 209) < 0.25 ? Math.PI / 2 : 0);
  }
  collider(x - 3.1, z - 1.4, x + 3.1, z + 1.4, 0, 1.3 + stackCount * 2.64);
}

function crane(x, z, height) {
  const craneColor = 0xd0a03c;
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    propBox(x + sideX * 3.4, z + sideZ * 3.4, 0, 0.7, height, 0.7, craneColor);
  }
  propBox(x, z, height - 0.8, 7.8, 0.8, 0.8, craneColor);
  propBox(x, z, height - 0.8, 0.8, 0.8, 7.8, craneColor);
  propBox(x + 4.6, z, height - 0.4, 12, 0.7, 0.7, craneColor);
  propBox(x + 9.6, z, height - 3.4, 0.1, 3.0, 0.1, 0x55584f);
  propBox(x + 9.6, z, height - 3.9, 0.7, 0.7, 0.7, 0x9a8a4a);
  propBox(x + 0.4, z, height - 0.4, 2.4, 1.6, 2.2, 0x8a6b34);
  collider(x - 4, z - 4, x + 4, z + 4, 0, height);
}

function docksBlock(centerX, centerZ, blockI, blockJ) {
  const roll = (salt) => hash3(blockI, blockJ, 200 + salt);
  const width = 13.4, depth = 9.2;
  warehouse(centerX, centerZ + 2.4, width, depth, 8.5 + roll(1) * 4.5, blockI * 131 + blockJ);
  const stackCount = 3 + ((roll(2) * 3) | 0);
  for (let stackIndex = 0; stackIndex < stackCount; stackIndex++) {
    containerStack(centerX - 6.2 + stackIndex * 4.1, centerZ - 6.2, blockI * 71 + blockJ * 13 + stackIndex, 3);
  }
  propBox(centerX + 6.4, centerZ - 2.4, 0, 2.6, 1.0, 2.6, 0x9d998c);
  for (let crateIndex = 0; crateIndex < 2; crateIndex++) propBox(centerX + 5.4 + crateIndex * 1.5, centerZ + 6.6, 0, 1.3, 0.9, 1.3, 0x8d7a5a);
  if (roll(3) < 0.4) crane(centerX, centerZ - 6.0, 15 + roll(4) * 5);
}

/* ------------------------------------------------------------ industrial */

function tank(x, z, radius, height, tint) {
  propCyl(x, z, 0, radius * 2, height, tint);
  propCone(x, z, height, radius * 2.15, radius * 1.15, tint);
  for (let ringIndex = 1; ringIndex < 3; ringIndex++) propCyl(x, z, ringIndex * (height / 3), radius * 2.05, 0.25, 0x8d918a);
  propBox(x + radius + 0.15, z, 0, 0.12, height, 0.5, 0x777b74);
  collider(x - radius, z - radius, x + radius, z + radius, 0, height + radius);
}

function chimney(x, z, height) {
  propCyl(x, z, 0, 2.6, height, 0xb2a596);
  for (let ringIndex = 1; ringIndex < 4; ringIndex++) propCyl(x, z, (ringIndex * height) / 4, 2.75, 0.6, 0x8c8175);
  propCyl(x, z, height, 2.9, 0.5, 0x6f6659);
  collider(x - 1.4, z - 1.4, x + 1.4, z + 1.4, 0, height);
}

function shed(centerX, centerZ, width, depth, height, salt) {
  const tint = [col(0xffffff), col(0xdfe3e0), col(0xd3cdbb), col(0xc8d0cc)][(hash3(salt, 1, 301) * 4) | 0];
  boxSides(BUFFERS.concrete, centerX - width / 2, centerX + width / 2, 0, height, centerZ - depth / 2, centerZ + depth / 2, tint, 5, hash3(salt, 2, 303) * 5, 0);
  boxTop(BUFFERS.roofMetal, centerX - width / 2, centerX + width / 2, height, centerZ - depth / 2, centerZ + depth / 2, col(0x8a8f8b), 4);
  propBox(centerX, centerZ, height + 0.05, width * 0.96, 0.5, 0.7, 0x9aa09c);
  for (let skylightIndex = 0; skylightIndex < 4; skylightIndex++) {
    propBox(centerX - width * 0.36 + skylightIndex * (width * 0.24), centerZ - depth * 0.2, height + 0.35, width * 0.14, 0.35, depth * 0.42, 0xcfe0dc);
  }
  const doorCount = 2;
  for (let doorIndex = 0; doorIndex < doorCount; doorIndex++) {
    const doorX = centerX - width / 2 + ((doorIndex + 0.5) * width) / doorCount;
    propBox(doorX, centerZ + depth / 2 + 0.1, 0, 3.4, 4.4, 0.22, 0x5b625f);
  }
  collider(centerX - width / 2, centerZ - depth / 2, centerX + width / 2, centerZ + depth / 2, 0, height);
  BUILDING_COUNT++;
}

function industrialBlock(centerX, centerZ, blockI, blockJ) {
  const roll = (salt) => hash3(blockI, blockJ, 300 + salt);
  const width = 10 + roll(1) * 3.2, depth = 9 + roll(2) * 3.4;
  shed(centerX + (roll(3) - 0.5) * 1.6, centerZ + 2.6, width, depth, 6.5 + roll(4) * 4.2, blockI * 131 + blockJ);
  if (roll(5) < 0.55) {
    tank(centerX - 5.4, centerZ - 5.6, 2.0 + roll(6) * 0.9, 7 + roll(7) * 4, 0xd8d3c4);
    if (roll(8) < 0.6) tank(centerX - 0.4, centerZ - 6.0, 1.5 + roll(9) * 0.6, 5.5 + roll(10) * 3, 0xc9cdc6);
  } else {
    chimney(centerX - 4.6, centerZ - 5.4, 18 + roll(11) * 12);
  }
  // pipe rack along the block edge
  for (let pipeIndex = 0; pipeIndex < 3; pipeIndex++) {
    propBox(centerX + 4.4, centerZ - 6.4 + pipeIndex * 1.4, 0.4, 0.5, 3.4, 0.5, 0x9a9d95);
  }
  propBox(centerX + 4.4, centerZ - 5.0, 3.6, 0.35, 0.35, 4.4, 0xb0b3aa);
  propBox(centerX + 4.4, centerZ - 5.0, 2.6, 0.28, 0.28, 4.4, 0x8d8f86);
}

/* ----------------------------------------------------------- beach park */

function kiosk(centerX, centerZ, width, depth, height, salt) {
  const tint = PASTELS[(hash3(salt, 1, 401) * PASTELS.length) | 0];
  boxSides(BUFFERS.stucco, centerX - width / 2, centerX + width / 2, 0, height, centerZ - depth / 2, centerZ + depth / 2, tint, 4.8, 0, 0);
  boxSides(BUFFERS.roofTile, centerX - width / 2 - 0.8, centerX + width / 2 + 0.8, height, height + 0.5, centerZ - depth / 2 - 0.8, centerZ + depth / 2 + 0.8,
    col(0xb2643f), 2.2, 0, 0);
  boxTop(BUFFERS.roofTile, centerX - width / 2 - 0.8, centerX + width / 2 + 0.8, height + 0.5, centerZ - depth / 2 - 0.8, centerZ + depth / 2 + 0.8, col(0xffffff), 2.2);
  propBox(centerX, centerZ + depth / 2 + 0.55, 2.2, width * 0.9, 0.14, 1.3, 0xd4573f);
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    propCyl(centerX + sideX * (width / 2 - 0.3), centerZ + sideZ * (depth / 2 - 0.3), 0, 0.2, 0.2 + height - 0.4, 0xe8e0ce);
  }
  collider(centerX - width / 2, centerZ - depth / 2, centerX + width / 2, centerZ + depth / 2, 0, height);
  BUILDING_COUNT++;
}

function lifeguard(x, z, salt) {
  const deckY = 2.3;
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) propCyl(x + sideX * 1.1, z + sideZ * 1.1, 0, 0.22, deckY, 0xe4dccb);
  propBox(x, z, deckY, 2.8, 0.16, 2.8, 0xd8cbb0);
  boxSides(BUFFERS.stucco, x - 1.2, x + 1.2, deckY + 0.16, deckY + 2.2, z - 1.2, z + 1.2, col(0xf1e6cf), 3, 0, 0);
  boxSides(BUFFERS.roofTile, x - 1.7, x + 1.7, deckY + 2.2, deckY + 2.6, z - 1.7, z + 1.7, col(0xc26a45), 2, 0, 0);
  boxTop(BUFFERS.roofTile, x - 1.7, x + 1.7, deckY + 2.6, z - 1.7, z + 1.7, col(0xffffff), 2);
  propBox(x, z + 1.9, 0, 1.0, 0.16, 3.4, 0xb6a992, 0, -0.32, 0);
  collider(x - 1.7, z - 1.7, x + 1.7, z + 1.7, 0, deckY + 2.6);
  BUILDING_COUNT++;
}

function beachBlock(centerX, centerZ, blockI, blockJ) {
  const roll = (salt) => hash3(blockI, blockJ, 400 + salt);
  grassPave(centerX, centerZ);
  groundQuad(BUFFERS.plaza, centerX - CORE, centerX + CORE, centerZ + 3.4, centerZ + 5.3, 0.05, 3, col(0xffffff));
  if (roll(1) < 0.62) kiosk(centerX - 2.6 + roll(2) * 2.4, centerZ - 2.2, 4.4, 3.4, 3.1, blockI * 17 + blockJ);
  for (let palmIndex = 0; palmIndex < 3; palmIndex++) palm(centerX - 6.6 + palmIndex * 6.6, centerZ - 7.2, blockI * 13 + blockJ * 7 + palmIndex);
  if (roll(3) < 0.7) bench(centerX + 4.6, centerZ + 4.2, 0);
  if (roll(4) < 0.5) bin(centerX - 5.6, centerZ + 4.4);
  if (roll(5) < 0.4) tree(centerX + 6.2, centerZ + 6.0, blockI * 23 + blockJ);
}

/* --------------------------------------------------------------- marina */

function marinaBuilding(centerX, centerZ, width, depth, height, salt) {
  const roll = (key) => hash3(salt, key, 500);
  const wallBuffer = roll(1) < 0.55 ? BUFFERS.stucco : BUFFERS.brick;
  const tint = PASTELS[(roll(2) * PASTELS.length) | 0];
  boxSides(wallBuffer, centerX - width / 2, centerX + width / 2, 0, height, centerZ - depth / 2, centerZ + depth / 2, tint, 4.8, roll(3) * 4, 0);
  boxSides(BUFFERS.concrete, centerX - width / 2 - 0.25, centerX + width / 2 + 0.25, height - 0.7, height + 0.3, centerZ - depth / 2 - 0.25, centerZ + depth / 2 + 0.25,
    col(0xe0d7c3), 4, 0, 0);
  boxTop(BUFFERS.roofDark, centerX - width / 2 - 0.25, centerX + width / 2 + 0.25, height + 0.3, centerZ - depth / 2 - 0.25, centerZ + depth / 2 + 0.25, col(0x8b8478), 4);
  for (let balconyY = 3.2; balconyY < height - 1.2; balconyY += 3.1) {
    propBox(centerX, centerZ + depth / 2 + 0.55, balconyY, width * 0.82, 0.14, 1.1, 0x6e5a45);
    propBox(centerX, centerZ + depth / 2 + 1.06, balconyY + 0.55, width * 0.82, 0.85, 0.08, 0x4a4034);
    const planterCount = roll(balconyY) < 0.4 ? 2 : 1;
    for (let planterIndex = 0; planterIndex < planterCount; planterIndex++) planter(centerX - width * 0.3 + planterIndex * 1.9, centerZ + depth / 2 + 0.9, salt + balconyY + planterIndex);
  }
  const awningColor = AWNING_COLS[(roll(4) * AWNING_COLS.length) | 0];
  addInst('box', centerX, 2.75, centerZ + depth / 2 + 0.72, width * 0.78, 0.12, 1.5, awningColor, 0, -0.16, 0);
  propBox(centerX, centerZ + depth / 2 + 0.28, 0, width * 0.72, 2.4, 0.12, 0x2c3a3c);
  collider(centerX - width / 2, centerZ - depth / 2, centerX + width / 2, centerZ + depth / 2, 0, height);
  BUILDING_COUNT++;
}

function marinaBlock(centerX, centerZ, blockI, blockJ) {
  plazaPave(centerX, centerZ);
  const roll = (salt) => hash3(blockI, blockJ, 600 + salt);
  marinaBuilding(centerX - 4.1, centerZ - 4.0, 7.4, 7.2, 8.5 + roll(1) * 4.5, blockI * 17 + blockJ * 3);
  marinaBuilding(centerX + 4.1, centerZ + 4.0, 7.4, 7.2, 7.5 + roll(2) * 5.0, blockI * 17 + blockJ * 3 + 1);
  if (roll(3) < 0.5) palm(centerX + 6.9, centerZ - 6.9, blockI * 5 + blockJ);
  if (roll(4) < 0.4) bench(centerX - 6.6, centerZ + 6.9, Math.PI / 2);
}

/* --------------------------------------------------------- street furniture */

function billboardPanel(positionX, positionY, positionZ, width, height, yaw, adIndex) {
  const atlasU = (adIndex % 2) * 0.5, atlasV = adIndex < 2 ? 0.5 : 0;
  const halfSpanX = Math.cos(yaw) * width / 2, halfSpanZ = -Math.sin(yaw) * width / 2;
  quadRaw(BUFFERS.ads,
    positionX - halfSpanX, positionY - height / 2, positionZ - halfSpanZ, positionX + halfSpanX, positionY - height / 2, positionZ + halfSpanZ, positionX + halfSpanX, positionY + height / 2, positionZ + halfSpanZ, positionX - halfSpanX, positionY + height / 2, positionZ - halfSpanZ,
    atlasU, atlasV, atlasU + 0.5, atlasV, atlasU + 0.5, atlasV + 0.5, atlasU, atlasV + 0.5,
    Math.sin(yaw), 0, Math.cos(yaw), 1, 1, 1);
}

function billboard(centerX, centerZ, side, adIndex) {
  const yaw = side === 'n' ? Math.PI : side === 's' ? 0 : side === 'w' ? -Math.PI / 2 : Math.PI / 2;
  const edgeOffset = 10.4;
  const panelX = side === 'w' ? centerX - edgeOffset : side === 'e' ? centerX + edgeOffset : centerX + 3.4;
  const panelZ = side === 'n' ? centerZ - edgeOffset : side === 's' ? centerZ + edgeOffset : centerZ;
  const postOffsetX = Math.cos(yaw) * 2.9, postOffsetZ = -Math.sin(yaw) * 2.9;
  propBox(panelX - postOffsetX, panelZ - postOffsetZ, 0, 0.32, 5.8, 0.32, 0x4b504c);
  propBox(panelX + postOffsetX, panelZ + postOffsetZ, 0, 0.32, 5.8, 0.32, 0x4b504c);
  billboardPanel(panelX, 6.9, panelZ, 7.4, 3.9, yaw, adIndex);
  propBox(panelX, panelZ, 4.95, 7.8, 0.2, 0.24, 0x3f4440, yaw);
  const colliderHalfX = Math.abs(Math.cos(yaw)) * 3.9 + Math.abs(Math.sin(yaw)) * 0.5;
  const colliderHalfZ = Math.abs(Math.sin(yaw)) * 3.9 + Math.abs(Math.cos(yaw)) * 0.5;
  collider(panelX - colliderHalfX, panelZ - colliderHalfZ, panelX + colliderHalfX, panelZ + colliderHalfZ, 0, 9);
}

function busStop(x, z, yaw) {
  propBox(x - 2.1, z, 0, 0.2, 2.7, 0.2, 0x4a4f4c, yaw);
  propBox(x + 2.1, z, 0, 0.2, 2.7, 0.2, 0x4a4f4c, yaw);
  propBox(x, z, 2.7, 4.6, 0.18, 1.8, 0x3f4a4a, yaw);
  propBox(x, z - 0.75, 0.3, 4.2, 2.2, 0.1, 0x9fc4c0, yaw);
  propBox(x, z, 0.4, 3.4, 0.14, 0.55, 0x6b5236, yaw);
  collider(x - 2.4, z - 1.1, x + 2.4, z + 1.1, 0, 3);
}

function trafficLight(junctionX, junctionZ, flip) {
  const signX = flip ? -1 : 1, signZ = flip ? -1 : 1;
  const poleX = junctionX + 7.0 * signX, poleZ = junctionZ + 7.0 * signZ;
  propCyl(poleX, poleZ, 0, 0.34, 5.4, 0x39423c);
  const armLen = 6.0;
  propBox(poleX - (armLen / 2) * signX, poleZ, 5.15, armLen, 0.2, 0.2, 0x39423c);
  const headX = poleX - (armLen - 0.6) * signX;
  propBox(headX, poleZ, 4.2, 0.55, 1.35, 0.45, 0x2f3a33);
  const lens = flip ? 'lensR' : 'lensG';
  addInst(lens, headX, 4.75, poleZ + 0.26 * signZ, 0.26, 0.26, 0.26, 0xffffff);
  propBox(headX, poleZ + 0.32 * signZ, 5.02, 0.5, 0.09, 0.34, 0x2a332c);
  TRAFFIC_LIGHTS.push({x: poleX, z: poleZ, orientation: flip ? Math.PI : 0, axis: flip ? 'z' : 'x'});
}

function blockFurniture(centerX, centerZ, blockI, blockJ, district) {
  const roll = (salt) => hash3(blockI, blockJ, 700 + salt);
  lamp(centerX, centerZ - 10.9, 0, -1);
  lamp(centerX, centerZ + 10.9, 0, 1);
  lamp(centerX - 10.9, centerZ, -1, 0);
  lamp(centerX + 10.9, centerZ, 1, 0);
  bench(centerX - 4.6 + roll(1) * 2.0, centerZ + 10.5, 0);
  if (roll(2) < 0.7) bin(centerX + 6.2, centerZ + 10.4);
  if (roll(3) < 0.5) hydrant(centerX - 9.9, centerZ + 4.2);
  if ((district === 'Downtown' || district === 'Marina') && roll(4) < 0.55) planter(centerX + 9.7, centerZ - 4.0, blockI * 7 + blockJ);
  if (roll(5) < 0.1 && district !== 'Beach Park') busStop(centerX + 4.0, centerZ - 10.5, 0);
  if (roll(6) < 0.12 && district === 'Downtown') bench(centerX + 10.5, centerZ + 2.2, -Math.PI / 2);
}

/* ------------------------------------------------------------ roads and sea */

function roadQuad(alongX, roadCoord) {
  const white = col(0xffffff);
  if (alongX) {
    const minX = -HALF, maxX = HALF, minZ = roadCoord - ROAD_HALF, maxZ = roadCoord + ROAD_HALF, roadY = 0.02;
    quadRaw(BUFFERS.road, minX, roadY, minZ, minX, roadY, maxZ, maxX, roadY, maxZ, maxX, roadY, minZ,
      0, minX / ROAD_TILE, 1, minX / ROAD_TILE, 1, maxX / ROAD_TILE, 0, maxX / ROAD_TILE, 0, 1, 0, white[0], white[1], white[2]);
  } else {
    const minX = roadCoord - ROAD_HALF, maxX = roadCoord + ROAD_HALF, minZ = -212, maxZ = SOUTH, roadY = 0.045;
    quadRaw(BUFFERS.road, minX, roadY, minZ, minX, roadY, maxZ, maxX, roadY, maxZ, maxX, roadY, minZ,
      0, minZ / ROAD_TILE, 0, maxZ / ROAD_TILE, 1, maxZ / ROAD_TILE, 1, minZ / ROAD_TILE, 0, 1, 0, white[0], white[1], white[2]);
  }
}

function roadGrid() {
  for (const roadCoord of LINES) {
    roadQuad(true, roadCoord);
    roadQuad(false, roadCoord);
  }
  // crosswalks a few metres off each intersection, on the 121 inner junctions
  const white = col(0xf2e8c8);
  for (let lineI = 0; lineI < LINES.length; lineI++) for (let lineJ = 0; lineJ < LINES.length; lineJ++) {
    const junctionX = LINES[lineI], junctionZ = LINES[lineJ];
    if (Math.abs(junctionX) > 170 || Math.abs(junctionZ) > 170) continue;
    for (const side of [-1, 1]) {
      for (let stripeIndex = 0; stripeIndex < 5; stripeIndex++) {
        const stripeOffset = -4.4 + stripeIndex * 2.2;
        // across the north-south road
        crossStripe(junctionX + stripeOffset, junctionZ + side * 7.2, 1.3, 2.6, white);
        // across the east-west road
        crossStripe(junctionX + side * 7.2, junctionZ + stripeOffset, 2.6, 1.3, white);
      }
    }
  }
}
function crossStripe(centerX, centerZ, width, depth, color) {
  const stripeY = 0.085;
  quadRaw(BUFFERS.paint, centerX - width / 2, stripeY, centerZ - depth / 2, centerX - width / 2, stripeY, centerZ + depth / 2, centerX + width / 2, stripeY, centerZ + depth / 2, centerX + width / 2, stripeY, centerZ - depth / 2,
    0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, color[0], color[1], color[2]);
}

function terrain() {
  const ground = col(0xd7c3a0);
  // land slab, water, beach, boardwalk, grass verges
  groundQuad(BUFFERS.sand, -HALF, HALF, SEA_Z, SOUTH, 0, 12, ground);
  // the outer margin reads as packed sand/scrub
  groundQuad(BUFFERS.sand, -HALF, HALF, SEA_Z, BEACH_Z - 0.3, 0.045, 8, col(0xffffff));
  groundQuad(BUFFERS.board, -203, 203, -216.2, BEACH_Z - 0.4, 0.12, 2, col(0xffffff));
  // surf line just off the sand
  groundQuad(BUFFERS.paint, -HALF, HALF, SEA_Z - 1.1, SEA_Z + 0.05, -0.42, 6, col(0xdff3ec));
  // distant country south of the grid so the horizon is not raw background
  groundQuad(BUFFERS.grass, -420, 420, SOUTH, 620, -0.3, 40, col(0x9aa887));
  for (let hillIndex = 0; hillIndex < 6; hillIndex++) {
    const hillX = -260 + hillIndex * 110, hillZ = 330 + (hillIndex % 3) * 34;
    propCone(hillX, hillZ, -0.3, 150 + (hillIndex % 3) * 40, 26 + (hillIndex % 4) * 9, 0x93a189);
  }
}

/* ------------------------------------------------------------ waterfront */

function boat(positionX, positionZ, yaw, hullColor) {
  addInst('box', positionX, 0.15, positionZ, 7.2, 1.3, 2.6, hullColor, yaw);
  addInst('box', positionX - 0.7, 1.1, positionZ, 2.6, 1.4, 1.9, 0xf0ebdd, yaw);
  addInst('cyl', positionX + 1.8, 3.4, positionZ, 0.1, 6.2, 0.1, 0xcfd3cd, yaw);
  addInst('box', positionX + 0.4, 0.85, positionZ, 6.4, 0.18, 2.8, 0xe8e2d2, yaw);
}

function pier(pierX) {
  groundQuad(BUFFERS.board, pierX - 2.2, pierX + 2.2, -262, SEA_Z - 0.5, 0.16, 2, col(0xffffff));
  for (let pilingZ = -258; pilingZ <= SEA_Z - 6; pilingZ += 8) {
    propCyl(pierX - 2.0, pilingZ, -1.4, 0.32, 2.0, 0x6b5842);
    propCyl(pierX + 2.0, pilingZ, -1.4, 0.32, 2.0, 0x6b5842);
  }
  for (let pilingZ = -258; pilingZ <= SEA_Z - 6; pilingZ += 8) propBox(pierX, pilingZ, 0.28, 4.6, 0.12, 0.2, 0x6f5a42);
}

function waterfront() {
  const lighthouseTint = col(0xf0e6d2);
  for (const pierX of [62, 92, 122, 152]) {
    pier(pierX);
    for (let boatIndex = 0; boatIndex < 2; boatIndex++) {
      const boatZ = -248 + boatIndex * 14;
      boat(pierX - 5.0, boatZ, 0.02, 0xe8e4d6);
      boat(pierX + 5.0, boatZ + 5, Math.PI + 0.02, CAR_COLS[(boatIndex + pierX) % CAR_COLS.length]);
    }
  }
  // marina quay + bollards
  groundQuad(BUFFERS.plaza, 40, 210, SEA_Z - 2.6, SEA_Z + 0.4, 0.07, 3, col(0xffffff));
  for (let bollardX = 44; bollardX < 208; bollardX += 9) propBox(bollardX, SEA_Z - 1.4, 0.03, 0.55, 0.75, 0.55, 0x4d5450);
  // breakwater rocks and the lighthouse
  for (let rockX = -30; rockX <= 210; rockX += 6.4) {
    addInst('sphere', rockX, -0.25, -268 + Math.sin(rockX * 0.1) * 2.4, 7 + hash3(rockX, 1, 9) * 4, 5 + hash3(rockX, 2, 9) * 3,
      7 + hash3(rockX, 3, 9) * 4, 0x8d8b80);
  }
  const lightX = 188, lightZ = -268;
  propCyl(lightX, lightZ, -0.8, 7.4, 2.4, 0xd9d3c2);
  for (let bandIndex = 0; bandIndex < 4; bandIndex++) {
    propCyl(lightX, lightZ, 1.4 + bandIndex * 5.1, 4.6 - bandIndex * 0.42, 5.2, bandIndex % 2 ? 0xc45c46 : 0xf0e9da);
  }
  propCyl(lightX, lightZ, 21.8, 5.6, 0.4, 0x414a46);
  propCyl(lightX, lightZ, 22.2, 3.2, 2.2, 0x33454a);
  propCone(lightX, lightZ, 24.4, 3.9, 1.7, 0x2f3b3e);
  addInst('bulb', lightX, 23.6, lightZ, 1.3, 1.3, 1.3, 0xffe2a0);
  LANDMARKS.push({name: 'Solara Light', x: lightX, z: lightZ, district: 'Marina'});
  LANDMARKS.push({name: 'Causeway Pier', x: 122, z: -244, district: 'Marina'});

  // beach life: umbrellas, towels, lifeguard towers
  for (let umbrellaIndex = 0; umbrellaIndex < 22; umbrellaIndex++) {
    const umbrellaX = -196 + umbrellaIndex * 18 + hash3(umbrellaIndex, 1, 31) * 6;
    const umbrellaZ = -222 + hash3(umbrellaIndex, 2, 37) * 5;
    propCyl(umbrellaX, umbrellaZ, 0.05, 0.1, 2.1, 0xe8e2d0);
    propCone(umbrellaX, umbrellaZ, 1.95, 3.0, 1.0, [0xd4573f, 0x2f8b86, 0xe0a03a, 0xf0dfc4][(hash3(umbrellaIndex, 3, 41) * 4) | 0]);
    addInst('box', umbrellaX + 1.4, 0.1, umbrellaZ + 0.6, 1.1, 0.08, 1.9, [0x5f8fb0, 0xd4735c, 0xe2d3a8][(hash3(umbrellaIndex, 4, 43) * 3) | 0]);
  }
  lifeguard(-150, -223, 1);
  lifeguard(-35, -224, 2);
  lifeguard(70, -222, 3);
  LANDMARKS.push({name: 'Solara Boardwalk', x: 0, z: -212, district: 'Beach Park'});
  // promenade palms and benches along the boardwalk
  for (let promenadeX = -196; promenadeX <= 196; promenadeX += 12.5) {
    palm(promenadeX, -218.6, promenadeX | 0);
    if ((promenadeX / 12.5) % 3 === 0) bench(promenadeX + 5, -212.6, Math.PI);
  }
  for (let postX = -196; postX <= 196; postX += 24) propCyl(postX, -210.2, 0, 0.24, 4.2, 0x333d40);
  // outer edge greenery
  for (let edgeZ = -190; edgeZ <= 226; edgeZ += 26) {
    palm(-221, edgeZ, edgeZ | 0);
    palm(221, edgeZ, edgeZ + 7);
  }
  for (let southX = -200; southX <= 200; southX += 26) palm(southX, 224, southX | 0);
  LANDMARKS.push({name: 'Pelican Docks', x: -172, z: 0, district: 'Docks'});
}

/* ---------------------------------------------------------- district fill */

function landmarkRefinery(centerX, centerZ) {
  plazaPave(centerX, centerZ);
  shed(centerX, centerZ + 2, 12, 9, 8, 99);
  chimney(centerX - 5.5, centerZ - 6, 34);
  chimney(centerX - 1.5, centerZ - 6, 28);
  tank(centerX + 5.4, centerZ - 5.6, 2.6, 11, 0xd9d4c5);
  tank(centerX + 7.4, centerZ + 6.2, 1.8, 8, 0xc4c9c3);
  for (let pipeIndex = 0; pipeIndex < 4; pipeIndex++) propCyl(centerX + 2.4, centerZ + 5.4 - pipeIndex * 2.4, 0.4, 0.4, 6 + pipeIndex, 0x9fa39b);
  LANDMARKS.push({name: 'Amalgam Refinery', x: centerX, z: centerZ, district: 'Industrial'});
}

function cityFill() {
  for (let blockI = 0; blockI < 12; blockI++) for (let blockJ = 0; blockJ < 12; blockJ++) {
    const centerX = CENTERS[blockI], centerZ = CENTERS[blockJ];
    const district = districtAt(centerX, centerZ);
    sidewalkRing(centerX, centerZ);
    if (district === 'Downtown') downtownBlock(centerX, centerZ, blockI, blockJ);
    else if (district === 'Suburbs') {
      if (blockI === 6 && blockJ === 10) pelicanMotel(centerX, centerZ);
      else suburbBlock(centerX, centerZ, blockI, blockJ);
    } else if (district === 'Docks') docksBlock(centerX, centerZ, blockI, blockJ);
    else if (district === 'Industrial') {
      if (blockI === 9 && blockJ === 6) landmarkRefinery(centerX, centerZ);
      else industrialBlock(centerX, centerZ, blockI, blockJ);
    } else if (district === 'Beach Park') beachBlock(centerX, centerZ, blockI, blockJ);
    else marinaBlock(centerX, centerZ, blockI, blockJ);
    blockFurniture(centerX, centerZ, blockI, blockJ, district);
  }
  // traffic lights on every junction
  for (let lineI = 0; lineI < LINES.length; lineI++) for (let lineJ = 0; lineJ < LINES.length; lineJ++) {
    trafficLight(LINES[lineI], LINES[lineJ], (lineI + lineJ) % 2 === 1);
  }
  // billboards at the edges of a handful of blocks
  const billboardSpecs = [[4, 0, 'n', 0], [8, 0, 'n', 1], [0, 4, 'w', 2], [11, 6, 'e', 3],
    [2, 11, 's', 1], [9, 11, 's', 0], [0, 8, 'w', 3], [11, 2, 'e', 2], [6, 4, 'n', 0], [4, 8, 'n', 1]];
  for (const [billBlockI, billBlockJ, side, adIndex] of billboardSpecs) billboard(CENTERS[billBlockI], CENTERS[billBlockJ], side, adIndex);
}

/* ------------------------------------------------------------ spawn data */

function spawnPoints() {
  const cars = [], peds = [];
  for (let lineIndex = 0; lineIndex < LINES.length; lineIndex++) {
    const roadCoord = LINES[lineIndex];
    for (let spotIndex = 0; spotIndex < 3; spotIndex++) {
      const alongCoord = -150 + spotIndex * 130 + ((lineIndex * 37) % 40);
      cars.push({x: alongCoord, z: roadCoord + 2.7, angle: Math.PI / 2});
      cars.push({x: roadCoord - 2.7, z: alongCoord + 20, angle: 0});
    }
  }
  for (let pedIndex = 0; pedIndex < 48; pedIndex++) {
    const blockI = 1 + ((hash3(pedIndex, 1, 900) * 10) | 0), blockJ = 1 + ((hash3(pedIndex, 2, 901) * 10) | 0);
    peds.push({
      x: CENTERS[blockI] + (hash3(pedIndex, 3, 902) - 0.5) * 19,
      z: CENTERS[blockJ] + (hash3(pedIndex, 4, 903) - 0.5) * 19
    });
  }
  return {cars, peds};
}

/* -------------------------------------------------------------- assembly */

function flushGeometry() {
  const mats = materials();
  const defs = [
    ['road', mats.road], ['walk', mats.walk], ['plaza', mats.plaza], ['sand', mats.sand],
    ['paint', mats.paint], ['grass', mats.grass], ['board', mats.board], ['concrete', mats.concrete],
    ['glass', mats.glass], ['stone', mats.stone], ['stucco', mats.stucco], ['brick', mats.brick],
    ['metal', mats.metal], ['roofDark', mats.roofDark], ['roofTile', mats.roofTile], ['roofMetal', mats.roofMetal],
    ['water', mats.pool]
  ];
  for (const [key, mat] of defs) {
    const buffer = BUFFERS[key];
    if (!buffer || !buffer.indices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffer.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffer.uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffer.colors, 3));
    geometry.setIndex(buffer.indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = 'city_' + key;
    mesh.castShadow = key !== 'road' && key !== 'walk' && key !== 'plaza' && key !== 'sand' &&
      key !== 'paint' && key !== 'grass' && key !== 'board' && key !== 'concrete' && key !== 'water';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    SCENE.add(mesh);
  }
  // ocean is its own translucent-ish slab, kept out of the vertex-colour batch
  const waterGeo = new THREE.PlaneGeometry(1, 1);
  const sea = new THREE.Mesh(waterGeo, mats.water);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.55, -330);
  sea.scale.set(640, 200, 1);
  sea.receiveShadow = false;
  sea.name = 'city_sea';
  SCENE.add(sea);
  // billboard panels use the atlas material, so they get their own batch
  if (BUFFERS.ads && BUFFERS.ads.indices.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(BUFFERS.ads.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(BUFFERS.ads.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(BUFFERS.ads.uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(BUFFERS.ads.colors, 3));
    geometry.setIndex(BUFFERS.ads.indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, mats.ads);
    mesh.name = 'city_ads';
    SCENE.add(mesh);
  }
}

function makeFrondGeometry() {
  const geometry = new THREE.PlaneGeometry(3.4, 0.9, 6, 1);
  geometry.translate(1.7, 0, 0);
  const positionAttribute = geometry.attributes.position;
  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex++) {
    const vertexX = positionAttribute.getX(vertexIndex), vertexY = positionAttribute.getY(vertexIndex);
    const along = Math.max(0, Math.min(1, vertexX / 3.4));
    positionAttribute.setY(vertexIndex, vertexY * (1 - along * 0.9) + Math.sin(along * 1.9) * 0.95 - along * along * 1.9);
    positionAttribute.setZ(vertexIndex, Math.sin(along * Math.PI) * 0.2);
  }
  positionAttribute.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function flushInstances() {
  const mats = materials();
  const propMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.72, metalness: 0.12});
  const foliage = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.88, flatShading: true});
  const frondMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, flatShading: true});
  const containerMat = new THREE.MeshStandardMaterial({map: TEX_CACHE.corrugated, roughness: 0.62, metalness: 0.32});
  const bulbMat = new THREE.MeshStandardMaterial({color: 0x2a2418, emissive: 0xffd08a, emissiveIntensity: 1.5, roughness: 0.4});
  const redMat = new THREE.MeshStandardMaterial({color: 0x40100e, emissive: 0xff3a2a, emissiveIntensity: 1.4, roughness: 0.4});
  const greenMat = new THREE.MeshStandardMaterial({color: 0x0c2a18, emissive: 0x3dff9a, emissiveIntensity: 1.2, roughness: 0.4});
  const defs = {
    box: {geometry: new THREE.BoxGeometry(1, 1, 1), material: propMat, receiveShadow: true},
    cyl: {geometry: new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1), material: propMat, receiveShadow: true},
    cone: {geometry: new THREE.ConeGeometry(0.5, 1, 10, 1), material: propMat, receiveShadow: false},
    sphere: {geometry: new THREE.IcosahedronGeometry(0.5, 1), material: foliage, receiveShadow: false},
    frond: {geometry: makeFrondGeometry(), material: frondMat, receiveShadow: false},
    container: {geometry: new THREE.BoxGeometry(1, 1, 1), material: containerMat, receiveShadow: true, tint: true},
    bulb: {geometry: new THREE.SphereGeometry(0.5, 7, 5), material: bulbMat, receiveShadow: false},
    lensR: {geometry: new THREE.SphereGeometry(0.5, 8, 6), material: redMat, receiveShadow: false},
    lensG: {geometry: new THREE.SphereGeometry(0.5, 8, 6), material: greenMat, receiveShadow: false}
  };
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler();
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), color = new THREE.Color();
  for (const key in defs) {
    const list = INSTANCES[key];
    if (!list || !list.length) continue;
    const def = defs[key];
    const mesh = new THREE.InstancedMesh(def.geometry, def.material, list.length);
    mesh.name = 'prop_' + key;
    let coloured = false;
    for (let instanceIndex = 0; instanceIndex < list.length; instanceIndex++) {
      const instance = list[instanceIndex];
      euler.set(instance.rotX, instance.rotY, instance.rotZ);
      quaternion.setFromEuler(euler);
      position.set(instance.x, instance.y, instance.z);
      scale.set(instance.scaleX, instance.scaleY, instance.scaleZ);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(instanceIndex, matrix);
      if (key === 'container') {
        const tintHex = instance.color || COLORS.sea;
        mesh.setColorAt(instanceIndex, color.setHex(tintHex));
        coloured = true;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (coloured && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = !!def.receiveShadow;
    mesh.frustumCulled = false;
    SCENE.add(mesh);
  }
}

/* --------------------------------------------------------------- build */

export function buildCity(scene) {
  SCENE = scene;
  BUFFERS = {
    road: emptyGeo(), walk: emptyGeo(), plaza: emptyGeo(), sand: emptyGeo(), paint: emptyGeo(),
    grass: emptyGeo(), board: emptyGeo(), glass: emptyGeo(), stone: emptyGeo(), stucco: emptyGeo(),
    brick: emptyGeo(), metal: emptyGeo(), concrete: emptyGeo(), roofDark: emptyGeo(),
    roofTile: emptyGeo(), roofMetal: emptyGeo(), water: emptyGeo(), ads: emptyGeo()
  };
  INSTANCES = {box: [], cyl: [], cone: [], sphere: [], frond: [], container: [], bulb: [], lensR: [], lensG: []};
  COLLIDERS = [];
  WALKS = [];
  TRAFFIC_LIGHTS = [];
  LANDMARKS = [];
  BUILDING_COUNT = 0;

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
    buildings: BUILDING_COUNT,
    colliders: COLLIDERS,
    roadLines: LINES.map((roadCoord) => ({axis: 'x', at: roadCoord})).concat(LINES.map((roadCoord) => ({axis: 'z', at: roadCoord}))),
    sidewalks: WALKS,
    spawnPoints: spawnPoints(),
    landmarks: LANDMARKS,
    trafficLights: TRAFFIC_LIGHTS,
    districtAt,
    meshCount: scene.children.length
  };
}
