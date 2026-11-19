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

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
const sign = (value) => (value > 0 ? 1 : value < 0 ? -1 : 0);
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

// Shared dimensions and lamp colours.
const DEFAULT_CAR_LENGTH = 4.5;
const DEFAULT_CAR_WIDTH = 1.9;
const CAR_HEIGHT = 1.6;
const COLLISION_RADIUS_FACTOR = 0.36;
const DEFAULT_WHEEL_RADIUS = 0.35;
const HUB_RADIUS_FACTOR = 0.45;
const HUB_WIDTH_FACTOR = 1.02;
const LIGHT_BAR_WIDTH = 0.9;
const LIGHT_BAR_HEIGHT = 0.13;
const LIGHT_BAR_DEPTH = 0.26;
const LIGHT_BAR_ROOF_Y = 1.6;
const LIGHT_BAR_OFFSET_Z = 0.05;
const LAMP_DEFAULT_WIDTH = 0.34;
const LAMP_DEFAULT_HEIGHT = 0.12;
const LAMP_DEPTH = 0.05;
const TAIL_WIDTH_FACTOR = 1.15;
const TAIL_HEIGHT_OFFSET = 0.04;
const TAIL_IDLE_COLOR = 0xc4281f;
const TAIL_BRAKE_COLOR = 0xff7a63;
const LIGHTS_ON_COLOR = 0xffe6b4;
const BAR_RED_COLOR = 0xff2a35;
const BAR_BLUE_COLOR = 0x2f57ff;
const BAR_FLASH_RATE = 16;

// ---------------------------------------------------------------- materials
const PAINTS = new Map();
function paintFor(color) {
  let material = PAINTS.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.25 });
    material.dispose = () => {};
    PAINTS.set(color, material);
  }
  return material;
}
const GLASS = new THREE.MeshStandardMaterial({ color: 0x8dbcc2, roughness: 0.16, metalness: 0.45 });
const TRIM = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.72, metalness: 0.2 });
const RUBBER = new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.92, metalness: 0.02 });
const LIGHT_WARM = new THREE.MeshBasicMaterial({ color: 0xffeec4 });
const LIGHT_RED = new THREE.MeshBasicMaterial({ color: TAIL_IDLE_COLOR });
const BAR_RED = new THREE.MeshBasicMaterial({ color: BAR_RED_COLOR });

// police.js frees every material under a car it removes. These are shared
// between cars, so their dispose is a no-op and only per-car clones go away.
for (const kept of [GLASS, TRIM, RUBBER, LIGHT_WARM, LIGHT_RED, BAR_RED]) kept.dispose = () => {};

// ------------------------------------------------------------- merged kits
function mergeBoxes(parts) {
  const sourceAttributes = UNIT_BOX.attributes;
  const vertexCount = sourceAttributes.position.count;
  const sourceIndex = UNIT_BOX.index.array;
  const count = parts.length;
  if (count === 0) return null;
  const positions = new Float32Array(count * vertexCount * 3);
  const normals = new Float32Array(count * vertexCount * 3);
  const index = new Uint16Array(count * sourceIndex.length);
  const transform = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let write = 0;
  let indexWrite = 0;
  for (let partIndex = 0; partIndex < count; partIndex += 1) {
    const part = parts[partIndex];
    transform.makeScale(part.width, part.height, part.depth);
    transform.setPosition(part.x, part.y, part.z);
    normalMatrix.getNormalMatrix(transform);
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      vertex.fromBufferAttribute(sourceAttributes.position, vertexIndex).applyMatrix4(transform);
      normal.fromBufferAttribute(sourceAttributes.normal, vertexIndex).applyMatrix3(normalMatrix).normalize();
      positions[write] = vertex.x; positions[write + 1] = vertex.y; positions[write + 2] = vertex.z;
      normals[write] = normal.x; normals[write + 1] = normal.y; normals[write + 2] = normal.z;
      write += 3;
    }
    const base = partIndex * vertexCount;
    for (let indexOffset = 0; indexOffset < sourceIndex.length; indexOffset += 1) index[indexWrite++] = base + sourceIndex[indexOffset];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Boxes for one body kit, in "wheel contact patch is y=0" space. Kept as a
 * declarative table so the six silhouettes are easy to read and tune.
 */
function kitParts(type) {
  const box = (list) => (width, height, depth, x, y, z) => list.push({ width, height, depth, x, y, z });
  const paint = [];
  const glass = [];
  const trim = [];
  const head = [];
  const tail = [];
  const addPaint = box(paint), addGlass = box(glass), addTrim = box(trim), addHead = box(head), addTail = box(tail);
  let bodyWidth = 1.9, bodyLength = 4.5, wheelRadius = 0.35, wheelWidth = 0.27;
  let wheels = [[-0.92, 1.45], [0.92, 1.45], [-0.92, -1.45], [0.92, -1.45]];
  const lamps = (x, y, z, lampWidth = LAMP_DEFAULT_WIDTH, lampHeight = LAMP_DEFAULT_HEIGHT) => {
    addHead(lampWidth, lampHeight, LAMP_DEPTH, -x, y, z);
    addHead(lampWidth, lampHeight, LAMP_DEPTH, x, y, z);
    addTail(lampWidth * TAIL_WIDTH_FACTOR, lampHeight, LAMP_DEPTH, -x, y + TAIL_HEIGHT_OFFSET, -z);
    addTail(lampWidth * TAIL_WIDTH_FACTOR, lampHeight, LAMP_DEPTH, x, y + TAIL_HEIGHT_OFFSET, -z);
  };

  if (type === 'sports') {
    bodyWidth = 1.94; bodyLength = 4.3; wheelRadius = 0.36; wheelWidth = 0.3;
    wheels = [[-0.93, 1.36], [0.93, 1.36], [-0.93, -1.36], [0.93, -1.36]];
    addPaint(1.92, 0.42, 4.02, 0, 0.52, 0);
    addPaint(1.86, 0.24, 1.05, 0, 0.74, 1.5);
    addPaint(1.44, 0.09, 1.06, 0, 1.13, -0.45);
    addPaint(1.84, 0.22, 0.78, 0, 0.8, -1.62);
    addPaint(1.7, 0.07, 0.32, 0, 1.02, -1.98);
    addGlass(1.52, 0.4, 1.5, 0, 0.93, -0.4);
    addTrim(1.86, 0.18, 0.22, 0, 0.44, 2.1);
    addTrim(1.86, 0.16, 0.2, 0, 0.46, -2.08);
    addTrim(0.1, 0.16, 2.6, -0.96, 0.36, 0);
    addTrim(0.1, 0.16, 2.6, 0.96, 0.36, 0);
    addTrim(0.07, 0.2, 0.08, -0.6, 0.93, -1.9);
    addTrim(0.07, 0.2, 0.08, 0.6, 0.93, -1.9);
    lamps(0.62, 0.66, 2.12, 0.4, 0.12);
  } else if (type === 'van') {
    bodyWidth = 2.06; bodyLength = 5.0; wheelRadius = 0.38; wheelWidth = 0.3;
    wheels = [[-0.99, 1.62], [0.99, 1.62], [-0.99, -1.62], [0.99, -1.62]];
    addPaint(2.02, 1.44, 4.1, 0, 1.12, -0.35);
    addPaint(2.0, 0.52, 0.72, 0, 0.72, 2.2);
    addPaint(1.98, 0.1, 4.16, 0, 1.88, -0.32);
    addGlass(1.9, 0.5, 0.08, 0, 1.32, 2.14);
    addGlass(0.05, 0.42, 1.5, -1.03, 1.42, -0.1);
    addGlass(0.05, 0.42, 1.5, 1.03, 1.42, -0.1);
    addTrim(2.02, 0.2, 0.2, 0, 0.44, 2.55);
    addTrim(2.02, 0.2, 0.18, 0, 0.46, -2.42);
    lamps(0.66, 0.82, 2.56, 0.36, 0.16);
  } else if (type === 'truck') {
    bodyWidth = 2.3; bodyLength = 6.5; wheelRadius = 0.44; wheelWidth = 0.34;
    wheels = [[-1.04, 2.32], [1.04, 2.32], [-1.04, -1.15], [1.04, -1.15], [-1.04, -2.05], [1.04, -2.05]];
    addPaint(2.24, 1.1, 1.9, 0, 1.32, 2.15);
    addPaint(2.2, 0.5, 0.95, 0, 0.95, 3.15);
    addPaint(2.3, 1.85, 3.5, 0, 1.55, -0.85);
    addPaint(2.1, 0.16, 0.5, 0, 1.95, 1.6);
    addGlass(2.08, 0.5, 0.08, 0, 1.6, 3.1);
    addTrim(1.9, 0.26, 6.1, 0, 0.5, 0);
    addTrim(2.34, 0.26, 0.2, 0, 0.48, 3.55);
    addTrim(2.3, 1.7, 0.12, 0, 1.55, -2.62);
    lamps(0.82, 0.82, 3.62, 0.38, 0.18);
  } else if (type === 'police') {
    bodyWidth = 1.92; bodyLength = 4.6;
    wheels = [[-0.92, 1.42], [0.92, 1.42], [-0.92, -1.42], [0.92, -1.42]];
    addPaint(1.9, 0.5, 4.32, 0, 0.62, 0);
    addPaint(1.56, 0.1, 1.5, 0, 1.43, -0.25);
    addPaint(1.84, 0.1, 0.8, 0, 0.92, 1.78);
    addGlass(1.62, 0.44, 1.9, 0, 1.14, -0.2);
    addTrim(0.04, 0.44, 2.2, -0.95, 0.66, -0.1);
    addTrim(0.04, 0.44, 2.2, 0.95, 0.66, -0.1);
    addTrim(1.9, 0.22, 0.12, 0, 0.52, 2.28);
    addTrim(1.9, 0.18, 0.2, 0, 0.44, -2.2);
    addTrim(1.0, 0.07, 0.28, 0, 1.53, 0.05);
    lamps(0.64, 0.68, 2.2, 0.34, 0.12);
  } else if (type === 'taxi') {
    bodyWidth = 1.9; bodyLength = 4.5;
    addPaint(1.9, 0.5, 4.24, 0, 0.62, 0);
    addPaint(1.56, 0.1, 1.4, 0, 1.42, -0.3);
    addPaint(1.84, 0.1, 0.9, 0, 0.92, 1.7);
    addPaint(1.84, 0.09, 0.7, 0, 0.93, -1.75);
    addGlass(1.6, 0.46, 1.95, 0, 1.14, -0.2);
    addTrim(0.04, 0.14, 1.7, -0.96, 0.72, -0.1);
    addTrim(0.04, 0.14, 1.7, 0.96, 0.72, -0.1);
    addTrim(1.9, 0.18, 0.22, 0, 0.44, 2.1);
    addTrim(1.9, 0.18, 0.2, 0, 0.44, -2.08);
    addHead(0.55, 0.16, 0.3, 0, 1.55, 0.1);
    lamps(0.62, 0.68, 2.12, 0.34, 0.12);
  } else { // sedan
    bodyWidth = 1.9; bodyLength = 4.5;
    addPaint(1.9, 0.5, 4.24, 0, 0.62, 0);
    addPaint(1.56, 0.1, 1.4, 0, 1.42, -0.3);
    addPaint(1.84, 0.1, 0.9, 0, 0.92, 1.7);
    addPaint(1.84, 0.09, 0.7, 0, 0.93, -1.75);
    addGlass(1.6, 0.46, 1.95, 0, 1.14, -0.2);
    addTrim(1.9, 0.18, 0.22, 0, 0.44, 2.1);
    addTrim(1.9, 0.18, 0.2, 0, 0.44, -2.08);
    lamps(0.62, 0.68, 2.12, 0.34, 0.12);
  }

  const dropToBase = (list) => { for (const part of list) part.y -= BASE_Y; return list; };
  const result = { paint: dropToBase(paint), glass: dropToBase(glass), trim: dropToBase(trim), head: dropToBase(head), tail: dropToBase(tail), width: bodyWidth, length: bodyLength, wheelRadius, wheelWidth, wheels };
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
      width: parts.width,
      length: parts.length,
      wheelRadius: parts.wheelRadius,
      wheelWidth: parts.wheelWidth,
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
    bar.scale.set(LIGHT_BAR_WIDTH, LIGHT_BAR_HEIGHT, LIGHT_BAR_DEPTH);
    bar.position.set(0, LIGHT_BAR_ROOF_Y - BASE_Y, LIGHT_BAR_OFFSET_Z);
    shell.add(bar);
  }

  const wheels = [];
  const steerWheels = [];
  for (let wheelIndex = 0; wheelIndex < kit.wheels.length; wheelIndex += 1) {
    const [wheelX, wheelZ] = kit.wheels[wheelIndex];
    const pivot = new THREE.Group();
    pivot.position.set(wheelX, kit.wheelRadius - BASE_Y, wheelZ);
    pivot.rotation.order = 'YXZ';
    pivot.userData.front = wheelZ > 0;
    const tyre = new THREE.Mesh(UNIT_WHEEL, RUBBER);
    tyre.scale.set(kit.wheelRadius, kit.wheelWidth, kit.wheelRadius);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = false;
    pivot.add(tyre);
    const hub = new THREE.Mesh(UNIT_WHEEL, TRIM);
    hub.scale.set(kit.wheelRadius * HUB_RADIUS_FACTOR, kit.wheelWidth * HUB_WIDTH_FACTOR, kit.wheelRadius * HUB_RADIUS_FACTOR);
    hub.rotation.z = Math.PI / 2;
    hub.castShadow = false;
    pivot.add(hub);
    root.add(pivot);
    wheels.push(pivot);
    if (wheelZ > 0) steerWheels.push(pivot);
  }

  return {
    root, shell, body, taillights, taillightMat, bar, wheels, steerWheels,
    width: kit.width, length: kit.length, height: CAR_HEIGHT, wheelRadius: kit.wheelRadius,
    radius: Math.max(kit.width, kit.length) * COLLISION_RADIUS_FACTOR,
  };
}

// ------------------------------------------------------------------ damage FX
const PUFF_GEO = new THREE.IcosahedronGeometry(1, 0);
const SMOKE_MAT = new THREE.MeshBasicMaterial({ color: 0x2d2f31, transparent: true, opacity: 0.4, depthWrite: false });
const STEAM_MAT = new THREE.MeshBasicMaterial({ color: 0xe8eef0, transparent: true, opacity: 0.3, depthWrite: false });
const FX_PUFF_COUNT = 4;
const FX_STEAM_COUNT = 2;
const FX_ORIGIN_Y = 0.3;
const FX_ORIGIN_Z = 1.05;
const PUFF_SPREAD_X = 0.16;
const PUFF_STEP_Y = 0.14;
const PUFF_STEP_Z = 0.1;
const PUFF_REST_SCALE = 0.16;
const STEAM_SPREAD_X = 0.3;
const STEAM_ORIGIN_Y = -0.1;
const STEAM_ORIGIN_Z = 0.35;
const STEAM_REST_SCALE = 0.1;
const SMOKE_DAMAGE_THRESHOLD = 0.42;
const SMOKE_HP_RATIO = 0.6;
const STEAM_HP_RATIO = 0.28;
const PUFF_CYCLE_RATE = 0.55;
const PUFF_PHASE_OFFSET = 0.27;
const PUFF_BASE_SCALE = 0.1;
const PUFF_GROWTH = 0.34;
const PUFF_DAMAGE_BOOST = 0.6;
const PUFF_RISE = 0.9;
const STEAM_CYCLE_RATE = 1.3;
const STEAM_PHASE_OFFSET = 0.5;
const STEAM_BASE_SCALE = 0.07;
const STEAM_GROWTH = 0.26;
const STEAM_BASE_HEIGHT = 0.35;
const STEAM_RISE = 0.5;

function ensureDamageFX(car) {
  if (car.damageFX || !car.shell) return car.damageFX;
  const group = new THREE.Group();
  group.position.set(0, FX_ORIGIN_Y, FX_ORIGIN_Z);
  const puffs = [];
  for (let puffIndex = 0; puffIndex < FX_PUFF_COUNT; puffIndex += 1) {
    const puff = new THREE.Mesh(PUFF_GEO, SMOKE_MAT);
    puff.position.set((puffIndex % 2 ? PUFF_SPREAD_X : -PUFF_SPREAD_X), puffIndex * PUFF_STEP_Y, puffIndex * PUFF_STEP_Z);
    puff.scale.setScalar(PUFF_REST_SCALE);
    puff.visible = false;
    group.add(puff);
    puffs.push(puff);
  }
  const steams = [];
  for (let steamIndex = 0; steamIndex < FX_STEAM_COUNT; steamIndex += 1) {
    const steam = new THREE.Mesh(PUFF_GEO, STEAM_MAT);
    steam.position.set(steamIndex ? STEAM_SPREAD_X : -STEAM_SPREAD_X, STEAM_ORIGIN_Y, STEAM_ORIGIN_Z);
    steam.scale.setScalar(STEAM_REST_SCALE);
    steam.visible = false;
    group.add(steam);
    steams.push(steam);
  }
  car.shell.add(group);
  car.damageFX = { group, puffs, steams, elapsed: 0 };
  return car.damageFX;
}

function updateDamageFX(car, delta) {
  const fx = car.damageFX;
  if (!fx) return;
  fx.elapsed += delta;
  const hurt = car.damage || 0;
  const smoking = hurt > SMOKE_DAMAGE_THRESHOLD || car.hp <= car.maxHp * SMOKE_HP_RATIO;
  const steaming = car.hp <= car.maxHp * STEAM_HP_RATIO;
  for (let puffIndex = 0; puffIndex < fx.puffs.length; puffIndex += 1) {
    const puff = fx.puffs[puffIndex];
    puff.visible = smoking;
    if (smoking) {
      const phase = (fx.elapsed * PUFF_CYCLE_RATE + puffIndex * PUFF_PHASE_OFFSET) % 1;
      puff.scale.setScalar(PUFF_BASE_SCALE + phase * PUFF_GROWTH * (PUFF_DAMAGE_BOOST + hurt));
      puff.position.y = phase * PUFF_RISE;
    }
  }
  for (let steamIndex = 0; steamIndex < fx.steams.length; steamIndex += 1) {
    const steam = fx.steams[steamIndex];
    steam.visible = steaming;
    if (steaming) {
      const phase = (fx.elapsed * STEAM_CYCLE_RATE + steamIndex * STEAM_PHASE_OFFSET) % 1;
      steam.scale.setScalar(STEAM_BASE_SCALE + phase * STEAM_GROWTH);
      steam.position.y = STEAM_BASE_HEIGHT + phase * STEAM_RISE;
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
  for (let colliderIndex = 0; colliderIndex < WORLD.colliders.length; colliderIndex += 1) {
    const shape = colliderShape(WORLD.colliders[colliderIndex]);
    if (shape) WORLD.shapes.push(shape);
  }
  return WORLD.shapes.length;
}

// Other cars the player can shunt. traffic.js hands over its live array.
let TRAFFIC_CARS = [];
/** traffic.js passes its live car array so the player can shunt traffic. */
export function registerCars(list) {
  TRAFFIC_CARS = Array.isArray(list) ? list : [];
  return TRAFFIC_CARS;
}
export function otherCars() {
  return TRAFFIC_CARS;
}

function colliderShape(collider) {
  if (!collider) return null;
  if (collider.isObject3D) {
    const position = collider.position || { x: 0, z: 0 };
    const scale = collider.scale || { x: 1, z: 1 };
    return { x: position.x, z: position.z, hw: Math.abs(scale.x) * 0.5, hd: Math.abs(scale.z) * 0.5 };
  }
  if (typeof collider.r === 'number' || typeof collider.radius === 'number') {
    return { x: collider.x || 0, z: collider.z || 0, r: collider.r !== undefined ? collider.r : collider.radius };
  }
  if (typeof collider.w === 'number' && typeof collider.d === 'number') return { x: collider.x || 0, z: collider.z || 0, hw: collider.w / 2, hd: collider.d / 2 };
  if (typeof collider.width === 'number' && typeof collider.depth === 'number') return { x: collider.x || 0, z: collider.z || 0, hw: collider.width / 2, hd: collider.depth / 2 };
  if (typeof collider.minX === 'number') {
    return { x: (collider.minX + collider.maxX) / 2, z: (collider.minZ + collider.maxZ) / 2, hw: Math.abs(collider.maxX - collider.minX) / 2, hd: Math.abs(collider.maxZ - collider.minZ) / 2 };
  }
  if (Array.isArray(collider) && collider.length >= 4) {
    return { x: (collider[0] + collider[2]) / 2, z: (collider[1] + collider[3]) / 2, hw: Math.abs(collider[2] - collider[0]) / 2, hd: Math.abs(collider[3] - collider[1]) / 2 };
  }
  return null;
}

// World collision tuning.
const BROAD_PHASE_MARGIN = 2;
const MIN_SEPARATION = 0.0001;
const WALL_RESTITUTION = 1.3;
const WALL_IMPACT_DAMPING = 0.92;
const WALL_DAMAGE_THRESHOLD = 4.5;
const WALL_DAMAGE_FACTOR = 1.35;
const WALL_BOUNCE_FACTOR = 0.012;

function resolveWorld(car, delta) {
  const list = WORLD.shapes;
  if (!list || list.length === 0) return;
  const pos = car.root.position;
  const carRadius = car.radius;
  for (let shapeIndex = 0; shapeIndex < list.length; shapeIndex += 1) {
    const shape = list[shapeIndex];
    if (!shape) continue;
    const dxRaw = pos.x - shape.x;
    const dzRaw = pos.z - shape.z;
    if (Math.abs(dxRaw) > carRadius + shape.hw + BROAD_PHASE_MARGIN || Math.abs(dzRaw) > carRadius + shape.hd + BROAD_PHASE_MARGIN) continue;
    let normalX, normalZ, penetration;
    if (shape.r !== undefined) {
      const distance = Math.hypot(dxRaw, dzRaw) || MIN_SEPARATION;
      penetration = carRadius + shape.r - distance;
      if (penetration <= 0) continue;
      normalX = dxRaw / distance; normalZ = dzRaw / distance;
    } else {
      const closestX = clamp(dxRaw, -shape.hw, shape.hw);
      const closestZ = clamp(dzRaw, -shape.hd, shape.hd);
      const offsetX = dxRaw - closestX;
      const offsetZ = dzRaw - closestZ;
      if (Math.abs(offsetX) < MIN_SEPARATION && Math.abs(offsetZ) < MIN_SEPARATION) {
        // centre inside the box: push out along the shortest axis
        const pushX = shape.hw + carRadius - Math.abs(dxRaw);
        const pushZ = shape.hd + carRadius - Math.abs(dzRaw);
        if (pushX < pushZ) { normalX = sign(dxRaw) || 1; normalZ = 0; penetration = pushX; } else { normalX = 0; normalZ = sign(dzRaw) || 1; penetration = pushZ; }
      } else {
        const distance = Math.hypot(offsetX, offsetZ);
        penetration = carRadius - distance;
        if (penetration <= 0) continue;
        normalX = offsetX / distance; normalZ = offsetZ / distance;
      }
    }
    pos.x += normalX * penetration;
    pos.z += normalZ * penetration;
    const normalVelocity = car.velocityX * normalX + car.velocityZ * normalZ;
    if (normalVelocity < 0) {
      const impact = -normalVelocity;
      car.velocityX -= normalX * normalVelocity * WALL_RESTITUTION;
      car.velocityZ -= normalZ * normalVelocity * WALL_RESTITUTION;
      car.velocityX *= WALL_IMPACT_DAMPING;
      car.velocityZ *= WALL_IMPACT_DAMPING;
      if (impact > WALL_DAMAGE_THRESHOLD) {
        car.hp = Math.max(0, car.hp - impact * WALL_DAMAGE_FACTOR);
        car.damage = 1 - car.hp / car.maxHp;
        car.lastImpact = impact;
        car.bounceV -= impact * WALL_BOUNCE_FACTOR;
      }
    }
  }
}

// Car-vs-car collision tuning.
const COLLISION_REACH_MARGIN = 1.2;
const PUSH_SHARE_SELF = 0.45;
const PUSH_SHARE_OTHER = 0.55;
const MIN_CLOSING_SPEED = 1.5;
const SELF_IMPULSE_FACTOR = 1.15;
const SELF_IMPULSE_DAMPING = 0.9;
const OTHER_IMPULSE_FACTOR = 0.55;
const OTHER_SPEED_GAIN = 0.12;
const OTHER_BOUNCE_FACTOR = 0.01;
const DAMAGE_CLOSING_THRESHOLD = 5;
const CLOSING_DAMAGE_FACTOR = 1.6;
const SELF_DAMAGE_SHARE = 0.7;
const DEFAULT_OTHER_HP = 100;
const CRASH_BOUNCE_FACTOR = 0.012;

/**
 * Shove the player's car out of any traffic car it has hit. Two rotated boxes,
 * separated on the axis of least penetration, with a crude impulse swap.
 */
function resolveCars(car) {
  if (!TRAFFIC_CARS || TRAFFIC_CARS.length === 0) return;
  const selfPos = car.root.position;
  const selfHalf = { hl: (car.length || DEFAULT_CAR_LENGTH) * 0.5, hw: (car.width || DEFAULT_CAR_WIDTH) * 0.5 };
  const selfYaw = car.root.rotation.y;
  const selfForward = { x: Math.sin(selfYaw), z: Math.cos(selfYaw) };
  const selfRight = { x: selfForward.z, z: -selfForward.x };
  for (let otherIndex = 0; otherIndex < TRAFFIC_CARS.length; otherIndex += 1) {
    const other = TRAFFIC_CARS[otherIndex];
    if (!other || other === car || !other.root) continue;
    const otherPos = other.root.position;
    const offsetX = otherPos.x - selfPos.x;
    const offsetZ = otherPos.z - selfPos.z;
    const reach = (selfHalf.hl + (other.length || DEFAULT_CAR_LENGTH) * 0.5) + COLLISION_REACH_MARGIN;
    if (offsetX * offsetX + offsetZ * offsetZ > reach * reach) continue;
    const otherHalf = { hl: (other.length || DEFAULT_CAR_LENGTH) * 0.5, hw: (other.width || DEFAULT_CAR_WIDTH) * 0.5 };
    const otherYaw = other.root.rotation.y;
    const otherForward = { x: Math.sin(otherYaw), z: Math.cos(otherYaw) };
    const otherRight = { x: otherForward.z, z: -otherForward.x };
    let bestPen = Infinity;
    let bestNormalX = 0;
    let bestNormalZ = 0;
    let separated = false;
    for (let axisIndex = 0; axisIndex < 2 && !separated; axisIndex += 1) {
      const normalX = axisIndex === 0 ? selfForward.x : otherForward.x;
      const normalZ = axisIndex === 0 ? selfForward.z : otherForward.z;
      const projSelf = selfHalf.hl * Math.abs(normalX * selfForward.x + normalZ * selfForward.z) + selfHalf.hw * Math.abs(normalX * selfRight.x + normalZ * selfRight.z);
      const projOther = otherHalf.hl * Math.abs(normalX * otherForward.x + normalZ * otherForward.z) + otherHalf.hw * Math.abs(normalX * otherRight.x + normalZ * otherRight.z);
      const penetration = projSelf + projOther - Math.abs(offsetX * normalX + offsetZ * normalZ);
      if (penetration <= 0) separated = true;
      else if (penetration < bestPen) { bestPen = penetration; bestNormalX = normalX; bestNormalZ = normalZ; }
    }
    if (separated || bestPen === Infinity) continue;
    if (offsetX * bestNormalX + offsetZ * bestNormalZ < 0) { bestNormalX = -bestNormalX; bestNormalZ = -bestNormalZ; }
    selfPos.x -= bestNormalX * bestPen * PUSH_SHARE_SELF;
    selfPos.z -= bestNormalZ * bestPen * PUSH_SHARE_SELF;
    otherPos.x += bestNormalX * bestPen * PUSH_SHARE_OTHER;
    otherPos.z += bestNormalZ * bestPen * PUSH_SHARE_OTHER;
    const relativeVelocityX = (car.velocityX || 0) - (other.velocityX || 0);
    const relativeVelocityZ = (car.velocityZ || 0) - (other.velocityZ || 0);
    const closing = relativeVelocityX * bestNormalX + relativeVelocityZ * bestNormalZ;
    if (closing < MIN_CLOSING_SPEED) continue;
    car.velocityX = (car.velocityX - bestNormalX * closing * SELF_IMPULSE_FACTOR) * SELF_IMPULSE_DAMPING;
    car.velocityZ = (car.velocityZ - bestNormalZ * closing * SELF_IMPULSE_FACTOR) * SELF_IMPULSE_DAMPING;
    other.velocityX = (other.velocityX || 0) + bestNormalX * closing * OTHER_IMPULSE_FACTOR;
    other.velocityZ = (other.velocityZ || 0) + bestNormalZ * closing * OTHER_IMPULSE_FACTOR;
    other.speed = Math.max(0, (other.speed || 0) + closing * OTHER_SPEED_GAIN);
    other.bounceV = (other.bounceV || 0) - closing * OTHER_BOUNCE_FACTOR;
    if (closing > DAMAGE_CLOSING_THRESHOLD) {
      const damageAmount = (closing - DAMAGE_CLOSING_THRESHOLD) * CLOSING_DAMAGE_FACTOR;
      car.hp = Math.max(0, car.hp - damageAmount * SELF_DAMAGE_SHARE);
      car.damage = 1 - car.hp / car.maxHp;
      other.hp = Math.max(0, (other.hp || DEFAULT_OTHER_HP) - damageAmount);
      other.damage = 1 - other.hp / DEFAULT_OTHER_HP;
      ensureDamageFX(other);
      car.lastImpact = closing;
      car.bounceV -= closing * CRASH_BOUNCE_FACTOR;
    }
  }
}

// Suspension, body roll and visual smoothing.
const STEER_MAX_ANGLE = 0.5;
const STEER_SMOOTH_RATE = 11;
const ROLL_SPEED_REF = 26;
const ROLL_STEER_AMOUNT = 0.06;
const ROLL_LATERAL_FACTOR = 0.005;
const ROLL_LATERAL_LIMIT = 0.05;
const ROLL_SMOOTH_RATE = 7;
const PITCH_FORCE_FACTOR = 0.0021;
const PITCH_LIMIT = 0.055;
const PITCH_SMOOTH_RATE = 6;
const BOUNCE_POSITION_FACTOR = 0.5;
const BOUNCE_POSITION_MIN = -0.04;
const BOUNCE_POSITION_MAX = 0.05;
const SUSPENSION_SPRING = 130;
const SUSPENSION_DAMPING = 12;
const BOUNCE_TRAVEL_MIN = -0.09;
const BOUNCE_TRAVEL_MAX = 0.1;
const SLIDE_LATERAL_THRESHOLD = 2.3;
const SLIDE_SPEED_THRESHOLD = 4;
const SLIDE_SMOKE_RANGE = 7;
const SMOKE_DECAY_RATE = 2.4;

/** Wheels, body roll and the damage effects. Shared with the traffic AI. */
export function animateVehicle(car, delta) {
  if (!car || !(delta > 0)) return;
  const speed = car.speed || 0;
  const spin = (car.wheelSpin || 0) + (speed * delta) / (car.wheelRadius || DEFAULT_WHEEL_RADIUS);
  car.wheelSpin = spin % TAU;
  const steerTarget = clamp(car.steerInput || 0, -1, 1) * STEER_MAX_ANGLE;
  car.steerAngle = (car.steerAngle || 0) + (steerTarget - (car.steerAngle || 0)) * Math.min(1, delta * STEER_SMOOTH_RATE);

  for (let wheelIndex = 0; wheelIndex < car.wheels.length; wheelIndex += 1) {
    const wheel = car.wheels[wheelIndex];
    wheel.rotation.x = car.wheelSpin;
    if (wheel.userData.front) wheel.rotation.y = car.steerAngle;
  }

  if (car.shell) {
    const speedRatio = Math.min(1, Math.abs(speed) / ROLL_SPEED_REF);
    const rollTarget = -(car.steerInput || 0) * speedRatio * ROLL_STEER_AMOUNT - clamp((car.lateralSpeed || 0) * ROLL_LATERAL_FACTOR, -ROLL_LATERAL_LIMIT, ROLL_LATERAL_LIMIT);
    car.roll = (car.roll || 0) + (rollTarget - (car.roll || 0)) * Math.min(1, delta * ROLL_SMOOTH_RATE);
    const pitchTarget = clamp(-(car.accelForce || 0) * PITCH_FORCE_FACTOR, -PITCH_LIMIT, PITCH_LIMIT);
    car.pitch = (car.pitch || 0) + (pitchTarget - (car.pitch || 0)) * Math.min(1, delta * PITCH_SMOOTH_RATE);
    car.shell.rotation.z = car.roll;
    car.shell.rotation.x = car.pitch;
    car.shell.position.y = clamp((car.bounce || 0) * BOUNCE_POSITION_FACTOR, BOUNCE_POSITION_MIN, BOUNCE_POSITION_MAX);
  }

  car.bounceV = (car.bounceV || 0) + (-(car.bounce || 0) * SUSPENSION_SPRING - (car.bounceV || 0) * SUSPENSION_DAMPING) * delta;
  car.bounce = clamp((car.bounce || 0) + car.bounceV * delta, BOUNCE_TRAVEL_MIN, BOUNCE_TRAVEL_MAX);

  const lateral = Math.abs(car.lateralSpeed || 0);
  car.sliding = lateral > SLIDE_LATERAL_THRESHOLD && Math.abs(speed) > SLIDE_SPEED_THRESHOLD;
  const slideSmoke = car.sliding ? Math.min(1, (lateral - SLIDE_LATERAL_THRESHOLD) / SLIDE_SMOKE_RANGE) : 0;
  car.smoke = Math.max(slideSmoke, Math.max(0, (car.smoke || 0) - delta * SMOKE_DECAY_RATE));

  if (car.taillightMat) {
    const braking = !!car.braking;
    car.taillightMat.color.setHex(braking ? TAIL_BRAKE_COLOR : TAIL_IDLE_COLOR);
  }
  if (car.bar && car.bar.material) {
    car.flash = (car.flash || 0) + delta;
    const flashOn = Math.sin(car.flash * BAR_FLASH_RATE) > 0;
    car.bar.material.color.setHex(flashOn ? BAR_RED_COLOR : BAR_BLUE_COLOR);
  }
  if (car.damageFX) updateDamageFX(car, delta);
}

const DEFAULT_HP = 100;
const REVERSE_SPEED_RATIO = 0.32;

/** Create a drivable car at (x, z). Keeps the old argument order. */
export function makeCar(scene, positionX, positionZ, color, police, type) {
  const resolved = type || (police ? 'police' : 'sedan');
  const spec = VEHICLE_CLASSES[resolved] || VEHICLE_CLASSES.sedan;
  const shell = makeCarMesh(resolved, color);
  const car = Object.assign(shell, {
    type: resolved,
    police: !!police || resolved === 'police',
    spec,
    speed: 0,
    hp: DEFAULT_HP,
    maxHp: DEFAULT_HP,
    damage: 0,
    maxSpeed: spec.speed,
    acceleration: spec.accel,
    turnRate: spec.turn,
    brakeForce: spec.brake,
    grip: spec.grip,
    reverseMax: spec.speed * REVERSE_SPEED_RATIO,
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
  car.root.position.set(positionX, BASE_Y, positionZ);
  if (scene) scene.add(car.root);
  return car;
}

/** Legacy helper kept so existing callers keep working. */
export function setLights(vehicle, on) {
  if (!vehicle || !vehicle.taillights) return;
  vehicle.taillights.material.color.setHex(on ? LIGHTS_ON_COLOR : TAIL_IDLE_COLOR);
}

const DAMAGE_BOUNCE_KICK = 0.08;

/** Damage a car; returns true when it is wrecked. */
export function damageVehicle(vehicle, amount) {
  if (!vehicle) return false;
  vehicle.hp = Math.max(0, vehicle.hp - amount);
  vehicle.damage = 1 - vehicle.hp / vehicle.maxHp;
  ensureDamageFX(vehicle);
  vehicle.bounceV -= DAMAGE_BOUNCE_KICK;
  return vehicle.hp === 0;
}

// Arcade handling tuning.
const BRAKE_ROLL_THRESHOLD = 0.6;
const REVERSE_ACCEL_FACTOR = 0.6;
const COAST_DECEL = 2.1;
const ENGINE_BRAKE_DECEL = 0.34;
const HANDBRAKE_DECEL = 13;
const LOW_SPEED_TURN_BASE = 0.32;
const LOW_SPEED_TURN_RANGE = 0.68;
const LOW_SPEED_REF = 5.5;
const HIGH_SPEED_DRAG = 0.022;
const HANDBRAKE_TURN_BOOST = 1.28;
const HANDBRAKE_GRIP = 1.05;
const DEFAULT_GRIP = 9;
const GRIP_SPEED_FLOOR = 0.6;
const GRIP_SPEED_RANGE = 0.4;
const GRIP_SPEED_REF = 8;
const BRAKING_SPEED_THRESHOLD = 0.5;
const ENGINE_IDLE_LEVEL = 0.12;
const ISLAND_BOUND_X = 232;
const ISLAND_MIN_Z = -230;
const ISLAND_MAX_Z = 232;

/**
 * One step of player-driven physics. `input.gas` is -1..1 (brake/reverse when
 * negative), `input.steer` is -1..1 and `input.handbrake` breaks rear grip.
 */
export function vehicleStep(car, delta, input = {}) {
  if (!car || !(delta > 0)) return car;
  const gas = clamp(+input.gas || 0, -1, 1);
  const steerIn = clamp(+input.steer || 0, -1, 1);
  const handbrake = !!input.handbrake;

  const yaw = car.root.rotation.y;
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let longitudinalSpeed = (car.velocityX || 0) * forwardX + (car.velocityZ || 0) * forwardZ;
  let lateralVelocity = (car.velocityX || 0) * rightX + (car.velocityZ || 0) * rightZ;

  const maxForward = car.maxSpeed;
  const maxReverse = car.reverseMax || maxForward * REVERSE_SPEED_RATIO;
  let force = 0;

  if (gas > 0) {
    if (longitudinalSpeed < -BRAKE_ROLL_THRESHOLD) force = car.brakeForce; // still rolling backwards: brake first
    else {
      const ratio = clamp(longitudinalSpeed / maxForward, 0, 1);
      force = car.acceleration * gas * (1 - ratio * ratio);
    }
  } else if (gas < 0) {
    if (longitudinalSpeed > BRAKE_ROLL_THRESHOLD) force = -car.brakeForce;
    else {
      const ratio = clamp(-longitudinalSpeed / maxReverse, 0, 1);
      force = car.acceleration * REVERSE_ACCEL_FACTOR * gas * (1 - ratio * ratio);
    }
  }

  longitudinalSpeed += force * delta;
  // Rolling resistance, engine braking and the handbrake.
  const coastDecel = gas === 0 ? COAST_DECEL : ENGINE_BRAKE_DECEL;
  longitudinalSpeed -= Math.min(Math.abs(longitudinalSpeed), coastDecel * delta) * sign(longitudinalSpeed);
  if (handbrake) longitudinalSpeed -= Math.min(Math.abs(longitudinalSpeed), HANDBRAKE_DECEL * delta) * sign(longitudinalSpeed);

  longitudinalSpeed = clamp(longitudinalSpeed, -maxReverse, maxForward);

  const speed = Math.abs(longitudinalSpeed);
  const lowSpeedFactor = LOW_SPEED_TURN_BASE + LOW_SPEED_TURN_RANGE * Math.min(1, speed / LOW_SPEED_REF);
  const highSpeedFactor = 1 / (1 + speed * HIGH_SPEED_DRAG);
  const handbrakeBoost = handbrake ? HANDBRAKE_TURN_BOOST : 1;
  const yawRate = steerIn * car.turnRate * lowSpeedFactor * highSpeedFactor * handbrakeBoost * sign(longitudinalSpeed || 1);

  car.root.rotation.y = (yaw + yawRate * delta) % TAU;

  // Tyre grip kills sideways motion; with the handbrake up the car keeps its
  // momentum and slides, because the velocity is rebuilt in the old frame.
  const grip = (handbrake ? HANDBRAKE_GRIP : car.grip || DEFAULT_GRIP) * (GRIP_SPEED_FLOOR + GRIP_SPEED_RANGE * Math.min(1, speed / GRIP_SPEED_REF));
  lateralVelocity *= Math.exp(-grip * delta);

  car.velocityX = forwardX * longitudinalSpeed + rightX * lateralVelocity;
  car.velocityZ = forwardZ * longitudinalSpeed + rightZ * lateralVelocity;
  car.root.position.x += car.velocityX * delta;
  car.root.position.z += car.velocityZ * delta;

  resolveWorld(car, delta);
  resolveCars(car);

  car.speed = car.velocityX * Math.sin(car.root.rotation.y) + car.velocityZ * Math.cos(car.root.rotation.y);
  car.lateralSpeed = lateralVelocity;
  car.steerInput = steerIn;
  car.accelForce = force;
  car.braking = (gas < 0 && longitudinalSpeed > BRAKING_SPEED_THRESHOLD) || (gas > 0 && longitudinalSpeed < -BRAKING_SPEED_THRESHOLD);
  car.engine = ENGINE_IDLE_LEVEL + Math.min(1, Math.abs(car.speed) / maxForward);

  // Keep the car on the island (the sea starts past z = -230).
  car.root.position.x = clamp(car.root.position.x, -ISLAND_BOUND_X, ISLAND_BOUND_X);
  car.root.position.z = clamp(car.root.position.z, ISLAND_MIN_Z, ISLAND_MAX_Z);
  car.root.position.y = BASE_Y;

  animateVehicle(car, delta);
  return car;
}
