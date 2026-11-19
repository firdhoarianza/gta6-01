// Vehicle model and arcade handling for Solara Bay.
//
// Every body class is a handful of boxes merged into one geometry per material
// (paint / glass / trim / lamps) so a car costs five draw calls plus four wheels,
// and all cars of a class share those geometries. Handling is deliberately
// arcade: an engine curve with speed-dependent drag, brake-or-reverse on one
// axis, a handbrake that drops rear grip, steering that tightens at low speed,
// lateral tyre grip, a suspension bob, wheel spin and smoke/steam when the car
// slides or takes damage. World collision is optional: push a city whose
// `colliders` array holds {x,z,width,depth} or {x,z,r} entries through setWorld().

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const TAU = Math.PI * 2;

/** The six body classes the city drives. Speeds are world units per second. */
export const VEHICLE_CLASSES = {
  sports: { speed: 46, accel: 23, turn: 1.95, brake: 36, grip: 9.5, color: 0xe5512f, mass: 1.0, kit: 'sports' },
  sedan: { speed: 34, accel: 15, turn: 1.7, brake: 31, grip: 9.2, color: 0x2f9f97, mass: 1.1, kit: 'sedan' },
  taxi: { speed: 33, accel: 14, turn: 1.7, brake: 31, grip: 9.2, color: 0xf0b53c, mass: 1.1, kit: 'taxi' },
  van: { speed: 28, accel: 11.5, turn: 1.45, brake: 28, grip: 8.6, color: 0xd8d0b4, mass: 1.4, kit: 'van' },
  truck: { speed: 24, accel: 9, turn: 1.15, brake: 25, grip: 7.8, color: 0xb17645, mass: 1.9, kit: 'truck' },
  police: { speed: 39, accel: 19, turn: 1.85, brake: 34, grip: 9.4, color: 0xe9e3ce, mass: 1.15, kit: 'police' },
};

const BASE_Y = 0.55; // the old cars sat at y=.55; the kits are drawn relative to it.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_WHEEL = new THREE.CylinderGeometry(1, 1, 1, 10, 1);

// ---------------------------------------------------------------- materials
const PAINTS = new Map();
function paintFor(color) {
  let m = PAINTS.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.25 });
    m.dispose = () => {};
    PAINTS.set(color, m);
  }
  return m;
}
const GLASS = new THREE.MeshStandardMaterial({ color: 0x8dbcc2, roughness: 0.16, metalness: 0.45 });
const TRIM = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.72, metalness: 0.2 });
const RUBBER = new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.92, metalness: 0.02 });
const LIGHT_WARM = new THREE.MeshBasicMaterial({ color: 0xffeec4 });
const LIGHT_RED = new THREE.MeshBasicMaterial({ color: 0xc4281f });
const BAR_RED = new THREE.MeshBasicMaterial({ color: 0xff2a35 });

// police.js frees every material under a car it removes. These are shared
// between cars, so their dispose is a no-op and only per-car clones go away.
for (const kept of [GLASS, TRIM, RUBBER, LIGHT_WARM, LIGHT_RED, BAR_RED]) kept.dispose = () => {};

// ------------------------------------------------------------- merged kits
function mergeBoxes(parts) {
  const src = UNIT_BOX.attributes;
  const vCount = src.position.count;
  const srcIndex = UNIT_BOX.index.array;
  const count = parts.length;
  if (count === 0) return null;
  const pos = new Float32Array(count * vCount * 3);
  const nor = new Float32Array(count * vCount * 3);
  const index = new Uint16Array(count * srcIndex.length);
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  let write = 0;
  let iw = 0;
  for (let p = 0; p < count; p += 1) {
    const q = parts[p];
    m.makeScale(q.w, q.h, q.d);
    m.setPosition(q.x, q.y, q.z);
    nm.getNormalMatrix(m);
    for (let k = 0; k < vCount; k += 1) {
      v.fromBufferAttribute(src.position, k).applyMatrix4(m);
      n.fromBufferAttribute(src.normal, k).applyMatrix3(nm).normalize();
      pos[write] = v.x; pos[write + 1] = v.y; pos[write + 2] = v.z;
      nor[write] = n.x; nor[write + 1] = n.y; nor[write + 2] = n.z;
      write += 3;
    }
    const base = p * vCount;
    for (let k = 0; k < srcIndex.length; k += 1) index[iw++] = base + srcIndex[k];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Boxes for one body kit, in "wheel contact patch is y=0" space. Kept as a
 * declarative table so the six silhouettes are easy to read and tune.
 */
function kitParts(type) {
  const box = (list) => (w, h, d, x, y, z) => list.push({ w, h, d, x, y, z });
  const paint = [];
  const glass = [];
  const trim = [];
  const head = [];
  const tail = [];
  const P = box(paint), G = box(glass), T = box(trim), H = box(head), R = box(tail);
  let W = 1.9, L = 4.5, wheelR = 0.35, wheelW = 0.27;
  let wheels = [[-0.92, 1.45], [0.92, 1.45], [-0.92, -1.45], [0.92, -1.45]];
  const lamps = (x, y, z, wz = 0.34, hy = 0.12) => {
    H(wz, hy, 0.05, -x, y, z);
    H(wz, hy, 0.05, x, y, z);
    R(wz * 1.15, hy, 0.05, -x, y + 0.04, -z);
    R(wz * 1.15, hy, 0.05, x, y + 0.04, -z);
  };

  if (type === 'sports') {
    W = 1.94; L = 4.3; wheelR = 0.36; wheelW = 0.3;
    wheels = [[-0.93, 1.36], [0.93, 1.36], [-0.93, -1.36], [0.93, -1.36]];
    P(1.92, 0.42, 4.02, 0, 0.52, 0);
    P(1.86, 0.24, 1.05, 0, 0.74, 1.5);
    P(1.44, 0.09, 1.06, 0, 1.13, -0.45);
    P(1.84, 0.22, 0.78, 0, 0.8, -1.62);
    P(1.7, 0.07, 0.32, 0, 1.02, -1.98);
    G(1.52, 0.4, 1.5, 0, 0.93, -0.4);
    T(1.86, 0.18, 0.22, 0, 0.44, 2.1);
    T(1.86, 0.16, 0.2, 0, 0.46, -2.08);
    T(0.1, 0.16, 2.6, -0.96, 0.36, 0);
    T(0.1, 0.16, 2.6, 0.96, 0.36, 0);
    T(0.07, 0.2, 0.08, -0.6, 0.93, -1.9);
    T(0.07, 0.2, 0.08, 0.6, 0.93, -1.9);
    lamps(0.62, 0.66, 2.12, 0.4, 0.12);
  } else if (type === 'van') {
    W = 2.06; L = 5.0; wheelR = 0.38; wheelW = 0.3;
    wheels = [[-0.99, 1.62], [0.99, 1.62], [-0.99, -1.62], [0.99, -1.62]];
    P(2.02, 1.44, 4.1, 0, 1.12, -0.35);
    P(2.0, 0.52, 0.72, 0, 0.72, 2.2);
    P(1.98, 0.1, 4.16, 0, 1.88, -0.32);
    G(1.9, 0.5, 0.08, 0, 1.32, 2.14);
    G(0.05, 0.42, 1.5, -1.03, 1.42, -0.1);
    G(0.05, 0.42, 1.5, 1.03, 1.42, -0.1);
    T(2.02, 0.2, 0.2, 0, 0.44, 2.55);
    T(2.02, 0.2, 0.18, 0, 0.46, -2.42);
    lamps(0.66, 0.82, 2.56, 0.36, 0.16);
  } else if (type === 'truck') {
    W = 2.3; L = 6.5; wheelR = 0.44; wheelW = 0.34;
    wheels = [[-1.04, 2.32], [1.04, 2.32], [-1.04, -1.15], [1.04, -1.15], [-1.04, -2.05], [1.04, -2.05]];
    P(2.24, 1.1, 1.9, 0, 1.32, 2.15);
    P(2.2, 0.5, 0.95, 0, 0.95, 3.15);
    P(2.3, 1.85, 3.5, 0, 1.55, -0.85);
    P(2.1, 0.16, 0.5, 0, 1.95, 1.6);
    G(2.08, 0.5, 0.08, 0, 1.6, 3.1);
    T(1.9, 0.26, 6.1, 0, 0.5, 0);
    T(2.34, 0.26, 0.2, 0, 0.48, 3.55);
    T(2.3, 1.7, 0.12, 0, 1.55, -2.62);
    lamps(0.82, 0.82, 3.62, 0.38, 0.18);
  } else if (type === 'police') {
    W = 1.92; L = 4.6;
    wheels = [[-0.92, 1.42], [0.92, 1.42], [-0.92, -1.42], [0.92, -1.42]];
    P(1.9, 0.5, 4.32, 0, 0.62, 0);
    P(1.56, 0.1, 1.5, 0, 1.43, -0.25);
    P(1.84, 0.1, 0.8, 0, 0.92, 1.78);
    G(1.62, 0.44, 1.9, 0, 1.14, -0.2);
    T(0.04, 0.44, 2.2, -0.95, 0.66, -0.1);
    T(0.04, 0.44, 2.2, 0.95, 0.66, -0.1);
    T(1.9, 0.22, 0.12, 0, 0.52, 2.28);
    T(1.9, 0.18, 0.2, 0, 0.44, -2.2);
    T(1.0, 0.07, 0.28, 0, 1.53, 0.05);
    lamps(0.64, 0.68, 2.2, 0.34, 0.12);
  } else if (type === 'taxi') {
    W = 1.9; L = 4.5;
    P(1.9, 0.5, 4.24, 0, 0.62, 0);
    P(1.56, 0.1, 1.4, 0, 1.42, -0.3);
    P(1.84, 0.1, 0.9, 0, 0.92, 1.7);
    P(1.84, 0.09, 0.7, 0, 0.93, -1.75);
    G(1.6, 0.46, 1.95, 0, 1.14, -0.2);
    T(0.04, 0.14, 1.7, -0.96, 0.72, -0.1);
    T(0.04, 0.14, 1.7, 0.96, 0.72, -0.1);
    T(1.9, 0.18, 0.22, 0, 0.44, 2.1);
    T(1.9, 0.18, 0.2, 0, 0.44, -2.08);
    H(0.55, 0.16, 0.3, 0, 1.55, 0.1);
    lamps(0.62, 0.68, 2.12, 0.34, 0.12);
  } else { // sedan
    W = 1.9; L = 4.5;
    P(1.9, 0.5, 4.24, 0, 0.62, 0);
    P(1.56, 0.1, 1.4, 0, 1.42, -0.3);
    P(1.84, 0.1, 0.9, 0, 0.92, 1.7);
    P(1.84, 0.09, 0.7, 0, 0.93, -1.75);
    G(1.6, 0.46, 1.95, 0, 1.14, -0.2);
    T(1.9, 0.18, 0.22, 0, 0.44, 2.1);
    T(1.9, 0.18, 0.2, 0, 0.44, -2.08);
    lamps(0.62, 0.68, 2.12, 0.34, 0.12);
  }

  const drop = (list) => { for (const p of list) p.y -= BASE_Y; return list; };
  const result = { paint: drop(paint), glass: drop(glass), trim: drop(trim), head: drop(head), tail: drop(tail), W, L, wheelR, wheelW, wheels };
  return result;
}

const KITS = new Map();
function kitFor(type) {
  const key = VEHICLE_CLASSES[type] ? VEHICLE_CLASSES[type].kit : 'sedan';
  let kit = KITS.get(key);
  if (!kit) {
    const parts = kitParts(key);
    kit = {
      paint: mergeBoxes(parts.paint),
      glass: mergeBoxes(parts.glass),
      trim: mergeBoxes(parts.trim),
      head: mergeBoxes(parts.head),
      tail: mergeBoxes(parts.tail),
      W: parts.W,
      L: parts.L,
      wheelR: parts.wheelR,
      wheelW: parts.wheelW,
      wheels: parts.wheels,
    };
    // Shared across every car of this class: never let a caller dispose it.
    for (const geo of [kit.paint, kit.glass, kit.trim, kit.head, kit.tail]) {
      if (geo) geo.dispose = () => {};
    }
    KITS.set(key, kit);
  }
  return kit;
}

/**
 * A car shell with no physics: body kit, four (or six) wheel pivots and lamps.
 * Returned group is not added to the scene; the caller decides where it goes.
 */
export function makeCarMesh(type = 'sedan', color) {
  const spec = VEHICLE_CLASSES[type] || VEHICLE_CLASSES.sedan;
  const kit = kitFor(type);
  const root = new THREE.Group();
  const shell = new THREE.Group();
  root.add(shell);

  const add = (geometry, material, shadow) => {
    if (!geometry) return null;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !!shadow;
    mesh.receiveShadow = true;
    shell.add(mesh);
    return mesh;
  };
  const body = add(kit.paint, paintFor(color === undefined ? spec.color : color), true);
  add(kit.glass, GLASS, false);
  add(kit.trim, TRIM, true);
  add(kit.head, LIGHT_WARM, false);
  const taillightMat = LIGHT_RED.clone();
  const taillights = add(kit.tail, taillightMat, false);

  let bar = null;
  if (type === 'police') {
    // One mesh with its own material: police.js recolours car.bar.material.
    bar = new THREE.Mesh(UNIT_BOX, BAR_RED.clone());
    bar.scale.set(0.9, 0.13, 0.26);
    bar.position.set(0, 1.6 - BASE_Y, 0.05);
    shell.add(bar);
  }

  const wheels = [];
  const steerWheels = [];
  for (let i = 0; i < kit.wheels.length; i += 1) {
    const [x, z] = kit.wheels[i];
    const pivot = new THREE.Group();
    pivot.position.set(x, kit.wheelR - BASE_Y, z);
    pivot.rotation.order = 'YXZ';
    pivot.userData.front = z > 0;
    const tyre = new THREE.Mesh(UNIT_WHEEL, RUBBER);
    tyre.scale.set(kit.wheelR, kit.wheelW, kit.wheelR);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = false;
    pivot.add(tyre);
    const hub = new THREE.Mesh(UNIT_WHEEL, TRIM);
    hub.scale.set(kit.wheelR * 0.45, kit.wheelW * 1.02, kit.wheelR * 0.45);
    hub.rotation.z = Math.PI / 2;
    hub.castShadow = false;
    pivot.add(hub);
    root.add(pivot);
    wheels.push(pivot);
    if (z > 0) steerWheels.push(pivot);
  }

  return {
    root, shell, body, taillights, taillightMat, bar, wheels, steerWheels,
    width: kit.W, length: kit.L, height: 1.6, wheelRadius: kit.wheelR,
    radius: Math.max(kit.W, kit.L) * 0.36,
  };
}

// ------------------------------------------------------------------ damage FX
const PUFF_GEO = new THREE.IcosahedronGeometry(1, 0);
const SMOKE_MAT = new THREE.MeshBasicMaterial({ color: 0x2d2f31, transparent: true, opacity: 0.4, depthWrite: false });
const STEAM_MAT = new THREE.MeshBasicMaterial({ color: 0xe8eef0, transparent: true, opacity: 0.3, depthWrite: false });

function ensureDamageFX(car) {
  if (car.damageFX || !car.shell) return car.damageFX;
  const group = new THREE.Group();
  group.position.set(0, 0.3, 1.05);
  const puffs = [];
  for (let i = 0; i < 4; i += 1) {
    const puff = new THREE.Mesh(PUFF_GEO, SMOKE_MAT);
    puff.position.set((i % 2 ? 0.16 : -0.16), i * 0.14, i * 0.1);
    puff.scale.setScalar(0.16);
    puff.visible = false;
    group.add(puff);
    puffs.push(puff);
  }
  const steams = [];
  for (let i = 0; i < 2; i += 1) {
    const steam = new THREE.Mesh(PUFF_GEO, STEAM_MAT);
    steam.position.set(i ? 0.3 : -0.3, -0.1, 0.35);
    steam.scale.setScalar(0.1);
    steam.visible = false;
    group.add(steam);
    steams.push(steam);
  }
  car.shell.add(group);
  car.damageFX = { group, puffs, steams, t: 0 };
  return car.damageFX;
}

function updateDamageFX(car, dt) {
  const fx = car.damageFX;
  if (!fx) return;
  fx.t += dt;
  const hurt = car.damage || 0;
  const smoking = hurt > 0.42 || car.hp <= car.maxHp * 0.6;
  const steaming = car.hp <= car.maxHp * 0.28;
  for (let i = 0; i < fx.puffs.length; i += 1) {
    const puff = fx.puffs[i];
    puff.visible = smoking;
    if (smoking) {
      const phase = (fx.t * 0.55 + i * 0.27) % 1;
      puff.scale.setScalar(0.1 + phase * 0.34 * (0.6 + hurt));
      puff.position.y = phase * 0.9;
    }
  }
  for (let i = 0; i < fx.steams.length; i += 1) {
    const steam = fx.steams[i];
    steam.visible = steaming;
    if (steaming) {
      const phase = (fx.t * 1.3 + i * 0.5) % 1;
      steam.scale.setScalar(0.07 + phase * 0.26);
      steam.position.y = 0.35 + phase * 0.5;
    }
  }
}

// ------------------------------------------------------------------- physics
const WORLD = { city: null, colliders: [], shapes: [] };

/** Register the city (or a bare collider array) so cars can bounce off things. */
export function setWorld(city) {
  WORLD.city = city || null;
  if (Array.isArray(city)) WORLD.colliders = city;
  else WORLD.colliders = city && Array.isArray(city.colliders) ? city.colliders : [];
  // Parse once: the collider list is static, and a car should not allocate per frame.
  WORLD.shapes = [];
  for (let i = 0; i < WORLD.colliders.length; i += 1) {
    const shape = colliderShape(WORLD.colliders[i]);
    if (shape) WORLD.shapes.push(shape);
  }
  return WORLD.shapes.length;
}

// Other cars the player can shunt. traffic.js hands over its live array.
let OTHERS = [];
/** traffic.js passes its live car array so the player can shunt traffic. */
export function registerCars(list) {
  OTHERS = Array.isArray(list) ? list : [];
  return OTHERS;
}
export function otherCars() {
  return OTHERS;
}

function colliderShape(c) {
  if (!c) return null;
  if (c.isObject3D) {
    const p = c.position || { x: 0, z: 0 };
    const s = c.scale || { x: 1, z: 1 };
    return { x: p.x, z: p.z, hw: Math.abs(s.x) * 0.5, hd: Math.abs(s.z) * 0.5 };
  }
  if (typeof c.r === 'number' || typeof c.radius === 'number') {
    return { x: c.x || 0, z: c.z || 0, r: c.r !== undefined ? c.r : c.radius };
  }
  if (typeof c.w === 'number' && typeof c.d === 'number') return { x: c.x || 0, z: c.z || 0, hw: c.w / 2, hd: c.d / 2 };
  if (typeof c.width === 'number' && typeof c.depth === 'number') return { x: c.x || 0, z: c.z || 0, hw: c.width / 2, hd: c.depth / 2 };
  if (typeof c.minX === 'number') {
    return { x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2, hw: Math.abs(c.maxX - c.minX) / 2, hd: Math.abs(c.maxZ - c.minZ) / 2 };
  }
  if (Array.isArray(c) && c.length >= 4) {
    return { x: (c[0] + c[2]) / 2, z: (c[1] + c[3]) / 2, hw: Math.abs(c[2] - c[0]) / 2, hd: Math.abs(c[3] - c[1]) / 2 };
  }
  return null;
}

function resolveWorld(car, dt) {
  const list = WORLD.shapes;
  if (!list || list.length === 0) return;
  const pos = car.root.position;
  const R = car.radius;
  for (let i = 0; i < list.length; i += 1) {
    const shape = list[i];
    if (!shape) continue;
    const dxRaw = pos.x - shape.x;
    const dzRaw = pos.z - shape.z;
    if (Math.abs(dxRaw) > R + shape.hw + 2 || Math.abs(dzRaw) > R + shape.hd + 2) continue;
    let nx, nz, pen;
    if (shape.r !== undefined) {
      const d = Math.hypot(dxRaw, dzRaw) || 0.0001;
      pen = R + shape.r - d;
      if (pen <= 0) continue;
      nx = dxRaw / d; nz = dzRaw / d;
    } else {
      const cx = clamp(dxRaw, -shape.hw, shape.hw);
      const cz = clamp(dzRaw, -shape.hd, shape.hd);
      const ox = dxRaw - cx;
      const oz = dzRaw - cz;
      if (Math.abs(ox) < 0.0001 && Math.abs(oz) < 0.0001) {
        // centre inside the box: push out along the shortest axis
        const px = shape.hw + R - Math.abs(dxRaw);
        const pz = shape.hd + R - Math.abs(dzRaw);
        if (px < pz) { nx = sign(dxRaw) || 1; nz = 0; pen = px; } else { nx = 0; nz = sign(dzRaw) || 1; pen = pz; }
      } else {
        const d = Math.hypot(ox, oz);
        pen = R - d;
        if (pen <= 0) continue;
        nx = ox / d; nz = oz / d;
      }
    }
    pos.x += nx * pen;
    pos.z += nz * pen;
    const vn = car.velocityX * nx + car.velocityZ * nz;
    if (vn < 0) {
      const impact = -vn;
      car.velocityX -= nx * vn * 1.3;
      car.velocityZ -= nz * vn * 1.3;
      car.velocityX *= 0.92;
      car.velocityZ *= 0.92;
      if (impact > 4.5) {
        car.hp = Math.max(0, car.hp - impact * 1.35);
        car.damage = 1 - car.hp / car.maxHp;
        car.lastImpact = impact;
        car.bounceV -= impact * 0.012;
      }
    }
  }
}

/**
 * Shove the player's car out of any traffic car it has hit. Two rotated boxes,
 * separated on the axis of least penetration, with a crude impulse swap.
 */
function resolveCars(car) {
  if (!OTHERS || OTHERS.length === 0) return;
  const pa = car.root.position;
  const ha = { hl: (car.length || 4.5) * 0.5, hw: (car.width || 1.9) * 0.5 };
  const yawA = car.root.rotation.y;
  const fa = { x: Math.sin(yawA), z: Math.cos(yawA) };
  const ra = { x: fa.z, z: -fa.x };
  for (let i = 0; i < OTHERS.length; i += 1) {
    const other = OTHERS[i];
    if (!other || other === car || !other.root) continue;
    const pb = other.root.position;
    const dx = pb.x - pa.x;
    const dz = pb.z - pa.z;
    const reach = (ha.hl + (other.length || 4.5) * 0.5) + 1.2;
    if (dx * dx + dz * dz > reach * reach) continue;
    const hb = { hl: (other.length || 4.5) * 0.5, hw: (other.width || 1.9) * 0.5 };
    const yawB = other.root.rotation.y;
    const fb = { x: Math.sin(yawB), z: Math.cos(yawB) };
    const rb = { x: fb.z, z: -fb.x };
    let bestPen = Infinity;
    let bnx = 0;
    let bnz = 0;
    let separated = false;
    for (let t = 0; t < 2 && !separated; t += 1) {
      const nx = t === 0 ? fa.x : fb.x;
      const nz = t === 0 ? fa.z : fb.z;
      const projA = ha.hl * Math.abs(nx * fa.x + nz * fa.z) + ha.hw * Math.abs(nx * ra.x + nz * ra.z);
      const projB = hb.hl * Math.abs(nx * fb.x + nz * fb.z) + hb.hw * Math.abs(nx * rb.x + nz * rb.z);
      const pen = projA + projB - Math.abs(dx * nx + dz * nz);
      if (pen <= 0) separated = true;
      else if (pen < bestPen) { bestPen = pen; bnx = nx; bnz = nz; }
    }
    if (separated || bestPen === Infinity) continue;
    if (dx * bnx + dz * bnz < 0) { bnx = -bnx; bnz = -bnz; }
    pa.x -= bnx * bestPen * 0.45;
    pa.z -= bnz * bestPen * 0.45;
    pb.x += bnx * bestPen * 0.55;
    pb.z += bnz * bestPen * 0.55;
    const rvx = (car.velocityX || 0) - (other.velocityX || 0);
    const rvz = (car.velocityZ || 0) - (other.velocityZ || 0);
    const closing = rvx * bnx + rvz * bnz;
    if (closing < 1.5) continue;
    car.velocityX = (car.velocityX - bnx * closing * 1.15) * 0.9;
    car.velocityZ = (car.velocityZ - bnz * closing * 1.15) * 0.9;
    other.velocityX = (other.velocityX || 0) + bnx * closing * 0.55;
    other.velocityZ = (other.velocityZ || 0) + bnz * closing * 0.55;
    other.speed = Math.max(0, (other.speed || 0) + closing * 0.12);
    other.bounceV = (other.bounceV || 0) - closing * 0.01;
    if (closing > 5) {
      const dmg = (closing - 5) * 1.6;
      car.hp = Math.max(0, car.hp - dmg * 0.7);
      car.damage = 1 - car.hp / car.maxHp;
      other.hp = Math.max(0, (other.hp || 100) - dmg);
      other.damage = 1 - other.hp / 100;
      ensureDamageFX(other);
      car.lastImpact = closing;
      car.bounceV -= closing * 0.012;
    }
  }
}

/** Wheels, body roll and the damage effects. Shared with the traffic AI. */
export function animateVehicle(car, dt) {
  if (!car || !(dt > 0)) return;
  const speed = car.speed || 0;
  const spin = (car.wheelSpin || 0) + (speed * dt) / (car.wheelRadius || 0.35);
  car.wheelSpin = spin % TAU;
  const steerTarget = clamp(car.steerInput || 0, -1, 1) * 0.5;
  car.steerAngle = (car.steerAngle || 0) + (steerTarget - (car.steerAngle || 0)) * Math.min(1, dt * 11);

  for (let i = 0; i < car.wheels.length; i += 1) {
    const wheel = car.wheels[i];
    wheel.rotation.x = car.wheelSpin;
    if (wheel.userData.front) wheel.rotation.y = car.steerAngle;
  }

  if (car.shell) {
    const speedRatio = Math.min(1, Math.abs(speed) / 26);
    const rollTarget = -(car.steerInput || 0) * speedRatio * 0.06 - clamp((car.lateralSpeed || 0) * 0.005, -0.05, 0.05);
    car.roll = (car.roll || 0) + (rollTarget - (car.roll || 0)) * Math.min(1, dt * 7);
    const pitchTarget = clamp(-(car.accelForce || 0) * 0.0021, -0.055, 0.055);
    car.pitch = (car.pitch || 0) + (pitchTarget - (car.pitch || 0)) * Math.min(1, dt * 6);
    car.shell.rotation.z = car.roll;
    car.shell.rotation.x = car.pitch;
    car.shell.position.y = clamp((car.bounce || 0) * 0.5, -0.04, 0.05);
  }

  car.bounceV = (car.bounceV || 0) + (-(car.bounce || 0) * 130 - (car.bounceV || 0) * 12) * dt;
  car.bounce = clamp((car.bounce || 0) + car.bounceV * dt, -0.09, 0.1);

  const lateral = Math.abs(car.lateralSpeed || 0);
  car.sliding = lateral > 2.3 && Math.abs(speed) > 4;
  const slideSmoke = car.sliding ? Math.min(1, (lateral - 2.3) / 7) : 0;
  car.smoke = Math.max(slideSmoke, Math.max(0, (car.smoke || 0) - dt * 2.4));

  if (car.taillightMat) {
    const braking = !!car.braking;
    car.taillightMat.color.setHex(braking ? 0xff7a63 : 0xc4281f);
  }
  if (car.bar && car.bar.material) {
    car.flash = (car.flash || 0) + dt;
    const on = Math.sin(car.flash * 16) > 0;
    car.bar.material.color.setHex(on ? 0xff2a35 : 0x2f57ff);
  }
  if (car.damageFX) updateDamageFX(car, dt);
}

/** Create a drivable car at (x, z). Keeps the old argument order. */
export function makeCar(scene, x, z, color, police, type) {
  const resolved = type || (police ? 'police' : 'sedan');
  const spec = VEHICLE_CLASSES[resolved] || VEHICLE_CLASSES.sedan;
  const shell = makeCarMesh(resolved, color);
  const car = Object.assign(shell, {
    type: resolved,
    police: !!police || resolved === 'police',
    spec,
    speed: 0,
    hp: 100,
    maxHp: 100,
    damage: 0,
    maxSpeed: spec.speed,
    acceleration: spec.accel,
    turnRate: spec.turn,
    brakeForce: spec.brake,
    grip: spec.grip,
    reverseMax: spec.speed * 0.32,
    velocityX: 0,
    velocityZ: 0,
    lateralSpeed: 0,
    wheelSpin: 0,
    steerAngle: 0,
    steerInput: 0,
    accelForce: 0,
    bounce: 0,
    bounceV: 0,
    roll: 0,
    pitch: 0,
    sliding: false,
    smoke: 0,
    braking: false,
    engine: 0,
    ai: null,
    lamps: [shell.taillights],
  });
  car.root.position.set(x, BASE_Y, z);
  if (scene) scene.add(car.root);
  return car;
}

/** Legacy helper kept so existing callers keep working. */
export function setLights(vehicle, on) {
  if (!vehicle || !vehicle.taillights) return;
  vehicle.taillights.material.color.setHex(on ? 0xffe6b4 : 0xc4281f);
}

/** Damage a car; returns true when it is wrecked. */
export function damageVehicle(vehicle, amount) {
  if (!vehicle) return false;
  vehicle.hp = Math.max(0, vehicle.hp - amount);
  vehicle.damage = 1 - vehicle.hp / vehicle.maxHp;
  ensureDamageFX(vehicle);
  vehicle.bounceV -= 0.08;
  return vehicle.hp === 0;
}

/**
 * One step of player-driven physics. `input.gas` is -1..1 (brake/reverse when
 * negative), `input.steer` is -1..1 and `input.handbrake` breaks rear grip.
 */
export function vehicleStep(car, dt, input = {}) {
  if (!car || !(dt > 0)) return car;
  const gas = clamp(+input.gas || 0, -1, 1);
  const steerIn = clamp(+input.steer || 0, -1, 1);
  const handbrake = !!input.handbrake;

  const yaw = car.root.rotation.y;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);

  let vLong = (car.velocityX || 0) * fx + (car.velocityZ || 0) * fz;
  let vLat = (car.velocityX || 0) * rx + (car.velocityZ || 0) * rz;

  const maxFwd = car.maxSpeed;
  const maxRev = car.reverseMax || maxFwd * 0.32;
  let force = 0;

  if (gas > 0) {
    if (vLong < -0.6) force = car.brakeForce; // still rolling backwards: brake first
    else {
      const ratio = clamp(vLong / maxFwd, 0, 1);
      force = car.acceleration * gas * (1 - ratio * ratio);
    }
  } else if (gas < 0) {
    if (vLong > 0.6) force = -car.brakeForce;
    else {
      const ratio = clamp(-vLong / maxRev, 0, 1);
      force = car.acceleration * 0.6 * gas * (1 - ratio * ratio);
    }
  }

  vLong += force * dt;
  // Rolling resistance, engine braking and the handbrake.
  const coast = gas === 0 ? 2.1 : 0.34;
  vLong -= Math.min(Math.abs(vLong), coast * dt) * sign(vLong);
  if (handbrake) vLong -= Math.min(Math.abs(vLong), 13 * dt) * sign(vLong);

  vLong = clamp(vLong, -maxRev, maxFwd);

  const speed = Math.abs(vLong);
  const lowSpeed = 0.32 + 0.68 * Math.min(1, speed / 5.5);
  const highSpeed = 1 / (1 + speed * 0.022);
  const handbrakeBoost = handbrake ? 1.28 : 1;
  const yawRate = steerIn * car.turnRate * lowSpeed * highSpeed * handbrakeBoost * sign(vLong || 1);

  car.root.rotation.y = (yaw + yawRate * dt) % TAU;

  // Tyre grip kills sideways motion; with the handbrake up the car keeps its
  // momentum and slides, because the velocity is rebuilt in the old frame.
  const grip = (handbrake ? 1.05 : car.grip || 9) * (0.6 + 0.4 * Math.min(1, speed / 8));
  vLat *= Math.exp(-grip * dt);

  car.velocityX = fx * vLong + rx * vLat;
  car.velocityZ = fz * vLong + rz * vLat;
  car.root.position.x += car.velocityX * dt;
  car.root.position.z += car.velocityZ * dt;

  resolveWorld(car, dt);
  resolveCars(car);

  car.speed = car.velocityX * Math.sin(car.root.rotation.y) + car.velocityZ * Math.cos(car.root.rotation.y);
  car.lateralSpeed = vLat;
  car.steerInput = steerIn;
  car.accelForce = force;
  car.braking = (gas < 0 && vLong > 0.5) || (gas > 0 && vLong < -0.5);
  car.engine = 0.12 + Math.min(1, Math.abs(car.speed) / maxFwd);

  // Keep the car on the island (the sea starts past z = -230).
  car.root.position.x = clamp(car.root.position.x, -232, 232);
  car.root.position.z = clamp(car.root.position.z, -230, 232);
  car.root.position.y = BASE_Y;

  animateVehicle(car, dt);
  return car;
}