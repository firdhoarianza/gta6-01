// Pedestrians for Solara Bay.
//
// Every person walks the ring of sidewalk that runs around one city block: four
// corners, joined by 19.6 unit edges, at the centre of the 3.4 unit footway that
// sits between the block core (8.1) and the kerb (11.5). At a corner they either
// keep circling their block, turn, stop to talk, or check for traffic and cross
// to the matching corner of the block across the road. They panic at gunfire,
// when a wanted player gets close, or when a car bears down on them, and they
// fall over when shot or run down. Ambient traffic lives in traffic.js; the
// cars it owns are exposed as actors.cars so the rest of the game (E to enter,
// bullet raycasts) keeps working.

import { CITY } from './config.js';
import { createRandom } from './random.js';
import { setWorld } from './vehicles.js';

const MAX_PEDS = 40;
const BLOCK = CITY.block;
const CENTER0 = -187; // centre of block 0
const HALF_BLOCK = 9.8; // walkway centre line, 1.7 clear of the building core
const CULL_DISTANCE = 210;
const SPAWN_MIN = 14;
const SPAWN_MAX = 118;
const CROSS_CHANCE = 0.16;
const IDLE_CHANCE = 0.09;

const PED_SEED_XOR = 0x1d3a7;
const RESPAWN_SEED_XOR = 0x77;
const BLOCK_INDEX_MAX = 11;
const BLOCK_SEARCH_RANGE = 5;
const SPAWN_ATTEMPTS = 24;
const PED_SPACING = 2.6;
const PED_HEALTH = 100;
const PED_PHASE_RANGE = 6;
const PED_BASE_SPEED = 1.15;
const PED_SPEED_RANGE = 0.6;
const PED_HEIGHT_BASE = 0.93;
const PED_HEIGHT_RANGE = 0.15;
const FULL_TURN = 6.28;
const SIDEWALK_Y = 0.16;
const ROAD_Y = 0.03;
const ROAD_HALF_CHECK = 5.6;
const GROUND_SMOOTH_RATE = 8;
const BARK_DURATION = 2.4;
const HIT_PANIC_SECONDS = 5;
const KNOCK_FACTOR = 2.6;
// Threat radii and panic strengths.
const PANIC_RADIUS_BASE = 14;
const PANIC_RADIUS_PER_STAR = 7;
const GUNSHOT_RADIUS = 46;
const GUNSHOT_PANIC_BASE = 4.5;
const GUNSHOT_PANIC_BONUS_MAX = 2;
const GUNSHOT_DIST_REF = 30;
const BARK_SEED_FACTOR = 0.017;
const WANTED_PANIC = 3.5;
const CAR_THREAT_DIST = 22;
const CAR_THREAT_SPEED = 10;
const CAR_THREAT_PANIC = 2.2;
const RUNOVER_DIST = 2.9;
const RUNOVER_SPEED = 5.5;
const RUNOVER_DAMAGE = 120;
const MOVING_CAR_SPEED = 1.2;
// Walking.
const ARRIVE_DIST = 0.45;
const WALK_TURN_RATE = 6;
const CROSS_SPEED_FACTOR = 1.5;
const WALK_MIN_COS = 0.08;
const WALK_PHASE_PER_UNIT = 3.4;
const WALK_ANIM_SPEED_REF = 1.4;
const LEG_SWING_AMOUNT = 0.55;
const ARM_SWING_RATIO = 0.7;
const TORSO_SWAY_RATE = 0.5;
const TORSO_SWAY_AMOUNT = 0.03;
// Corner decisions.
const TRAFFIC_CHECK_RADIUS = 15;
const WAIT_BEFORE_CROSS = 2.2;
const WAIT_TRAFFIC_RADIUS = 12;
const IDLE_BASE_SECONDS = 2.5;
const IDLE_RANDOM_SECONDS = 5;
const PARTNER_RADIUS = 9;
// Idle fidgets.
const IDLE_SWAY_RATE = 1.4;
const IDLE_SWAY_AMOUNT = 0.012;
const IDLE_ARM_RATE = 1.1;
const IDLE_ARM_AMOUNT = 0.06;
const IDLE_TURN_RATE = 3;
const IDLE_NOD_RATE = 4;
const IDLE_NOD_AMOUNT = 0.1;
const IDLE_LOOK_RATE = 2.2;
const IDLE_LOOK_AMOUNT = 0.12;
const IDLE_PHASE_RATE = 2;
// Fleeing.
const FLEE_RETARGET_SECONDS = 0.7;
const FLEE_TURN_RATE = 9;
const FLEE_BASE_SPEED = 4.2;
const FLEE_SPEED_BONUS_MAX = 1.4;
const FLEE_CAR_SPEED_FACTOR = 0.05;
const FLEE_MIN_COS = 0.05;
const FLEE_PHASE_PER_UNIT = 3.6;
const FLEE_LEG_SWING = 0.85;
const FLEE_ARM_RAISE = -2.1;
const FLEE_ARM_FLAIL_RATE = 0.7;
const FLEE_ARM_FLAIL = 0.3;
// Falling and respawning.
const FALL_RATE = 4.5;
const FALL_ANGLE = 1.5;
const FALL_SMOOTH_RATE = 9;
const KNOCK_DECAY = 0.86;
const DEAD_GROUND_SMOOTH = 5;
const RESPAWN_DELAY = 14;

const SHIRTS = [0xc4553f, 0x2f6f8f, 0xe0d7bf, 0x3d7a58, 0x8a5a8f, 0xd8a63a, 0x25303a, 0xb5726a, 0x5f7d92];
const PANTS = [0x2b3a46, 0x4a4438, 0x1e2226, 0x6b6252, 0x35455c];
const SKINS = [0xb97858, 0x8c5a3c, 0xd9a077, 0x6a4530, 0xe3b795];
const BARKS = [
  'Watch it, pal.',
  'Hey! I am walking here.',
  'You see that?',
  'Not again...',
  'Crazy driver!',
  'Somebody call the cops.',
  'Nice car. Shame about the paint.',
  'Get off the road!',
  'Nothing good happens after sundown.',
  'Keep walking, friend.',
  'He went that way!',
  'This city, I swear.',
];

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
const wrap = (angle) => {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
};
const blockCenter = (blockIndex) => CENTER0 + blockIndex * BLOCK;

// One limb box whose origin sits at the joint, so rotation.x swings it.
const LIMB = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
const TORSO = new THREE.CylinderGeometry(0.5, 0.44, 1, 8, 1);
const HEAD = new THREE.SphereGeometry(0.5, 8, 6);
const MATS = new Map();
function cloth(color) {
  let material = MATS.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.04 });
    material.dispose = () => {}; // shared across peds: never let a caller free it
    MATS.set(color, material);
  }
  return material;
}

/** Corner `cornerIndex` of block (blockXIndex,blockZIndex): 0 NW, 1 NE, 2 SE, 3 SW. */
function cornerPoint(blockXIndex, blockZIndex, cornerIndex) {
  const centerX = blockCenter(blockXIndex);
  const centerZ = blockCenter(blockZIndex);
  const signX = cornerIndex === 1 || cornerIndex === 2 ? 1 : -1;
  const signZ = cornerIndex >= 2 ? 1 : -1;
  return { x: centerX + signX * HALF_BLOCK, z: centerZ + signZ * HALF_BLOCK };
}

function buildPerson(random) {
  const group = new THREE.Group();
  const figure = new THREE.Group();
  group.add(figure);
  const shirt = SHIRTS[(random() * SHIRTS.length) | 0];
  const pants = PANTS[(random() * PANTS.length) | 0];
  const skin = SKINS[(random() * SKINS.length) | 0];

  const torso = new THREE.Mesh(TORSO, cloth(shirt));
  torso.scale.set(0.42, 0.62, 0.3);
  torso.position.y = 1.16;
  torso.castShadow = true;
  torso.receiveShadow = true;
  figure.add(torso);

  const head = new THREE.Mesh(HEAD, cloth(skin));
  head.scale.setScalar(0.42);
  head.position.y = 1.56;
  figure.add(head);

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(LIMB, cloth(shirt));
    arm.scale.set(0.11, 0.62, 0.12);
    arm.position.set(side * 0.245, 1.42, 0);
    figure.add(arm);
    arms.push(arm);
  }
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(LIMB, cloth(pants));
    leg.scale.set(0.15, 0.9, 0.16);
    leg.position.set(side * 0.1, 0.9, 0);
    figure.add(leg);
    legs.push(leg);
  }

  return { group, figure, torso, head, arms, legs, height: PED_HEIGHT_BASE + random() * PED_HEIGHT_RANGE };
}

/**
 * Build the actor layer: pedestrian pool plus the ambient traffic system.
 * Returns { cars, people, traffic, lastBark, ... } as main.js expects.
 */
export function makeActors(scene) {
  const random = createRandom(CITY.seed ^ PED_SEED_XOR);
  const traffic = typeof window !== 'undefined' && window.SOLARA ? window.SOLARA.traffic : null;
  const actors = {
    cars: traffic.cars,
    people: [],
    traffic,
    lastBark: '',
    barkTimer: 0,
    lastSpeaker: null,
    honks: 0,
    _clip: -1,
    _fire: 0,
    _world: false,
  };

  for (let pedIndex = 0; pedIndex < MAX_PEDS; pedIndex += 1) {
    const parts = buildPerson(random);
    const person = {
      mesh: parts.group,
      figure: parts.figure,
      torso: parts.torso,
      head: parts.head,
      arms: parts.arms,
      legs: parts.legs,
      alive: true,
      health: PED_HEALTH,
      height: parts.height,
      blockXIndex: 0,
      blockZIndex: 0,
      corner: 0,
      ring: random() < 0.5 ? 1 : -1,
      target: { x: 0, z: 0 },
      state: 'walk',
      timer: 0,
      phase: random() * PED_PHASE_RANGE,
      speed: PED_BASE_SPEED + random() * PED_SPEED_RANGE,
      panic: 0,
      partner: null,
      fall: 0,
      dead: 0,
      knockX: 0,
      knockZ: 0,
      talk: 0,
    };
    parts.figure.scale.setScalar(person.height);
    scene.add(person.mesh);
    actors.people.push(person);
    placePed(actors, person, 0, 0, random, false);
  }

  return actors;
}

/** Drop a person on a corner near (playerX,playerZ), preferably out of sight distance. */
function placePed(actors, person, playerX, playerZ, random, anyDistance) {
  let chosen = null;
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
    const blockXIndex = clamp(Math.round((playerX - CENTER0) / BLOCK) + Math.floor((random() * 2 - 1) * BLOCK_SEARCH_RANGE), 0, BLOCK_INDEX_MAX);
    const blockZIndex = clamp(Math.round((playerZ - CENTER0) / BLOCK) + Math.floor((random() * 2 - 1) * BLOCK_SEARCH_RANGE), 0, BLOCK_INDEX_MAX);
    const cornerIndex = (random() * 4) | 0;
    const point = cornerPoint(blockXIndex, blockZIndex, cornerIndex);
    const distance = Math.hypot(point.x - playerX, point.z - playerZ);
    if (!anyDistance && (distance < SPAWN_MIN || distance > SPAWN_MAX)) continue;
    let crowded = false;
    for (let otherIndex = 0; otherIndex < actors.people.length; otherIndex += 1) {
      const other = actors.people[otherIndex];
      if (other === person || !other.alive) continue;
      if (Math.hypot(other.mesh.position.x - point.x, other.mesh.position.z - point.z) < PED_SPACING) { crowded = true; break; }
    }
    if (crowded) continue;
    chosen = { blockXIndex, blockZIndex, cornerIndex, point };
    break;
  }
  if (!chosen) {
    const blockXIndex = clamp(Math.round((playerX - CENTER0) / BLOCK), 0, BLOCK_INDEX_MAX);
    const blockZIndex = clamp(Math.round((playerZ - CENTER0) / BLOCK), 0, BLOCK_INDEX_MAX);
    const cornerIndex = (random() * 4) | 0;
    chosen = { blockXIndex, blockZIndex, cornerIndex, point: cornerPoint(blockXIndex, blockZIndex, cornerIndex) };
  }
  const point = chosen.point;
  person.mesh.position.set(point.x, SIDEWALK_Y, point.z);
  person.blockXIndex = chosen.blockXIndex;
  person.blockZIndex = chosen.blockZIndex;
  person.corner = chosen.cornerIndex;
  person.alive = true;
  person.health = PED_HEALTH;
  person.state = 'walk';
  person.panic = 0;
  person.partner = null;
  person.fall = 0;
  person.dead = 0;
  person.knockX = 0;
  person.knockZ = 0;
  person.timer = 0;
  person.mesh.rotation.set(0, random() * FULL_TURN, 0);
  person.figure.rotation.set(0, 0, 0);
  chooseWalkTarget(person);
  return person;
}

function chooseWalkTarget(person) {
  const nextCorner = (person.corner + person.ring + 4) % 4;
  const point = cornerPoint(person.blockXIndex, person.blockZIndex, nextCorner);
  person.pending = nextCorner;
  person.target.x = point.x;
  person.target.z = point.z;
  person.state = 'walk';
}

/** Cross to the neighbouring block over the west/east road. */
function crossX(actors, person, dir) {
  const neighborBlock = person.blockXIndex + dir;
  if (neighborBlock < 0 || neighborBlock > BLOCK_INDEX_MAX) return false;
  const corner = person.corner;
  let nextCorner;
  if (dir < 0) nextCorner = corner === 0 ? 1 : corner === 3 ? 2 : -1;
  else nextCorner = corner === 1 ? 0 : corner === 2 ? 3 : -1;
  if (nextCorner < 0) return false;
  const point = cornerPoint(neighborBlock, person.blockZIndex, nextCorner);
  person.pendingBlock = { blockXIndex: neighborBlock, blockZIndex: person.blockZIndex, corner: nextCorner };
  person.target.x = point.x;
  person.target.z = point.z;
  person.state = 'cross';
  person.timer = 0;
  return true;
}

/** Cross the north/south road. */
function crossZ(actors, person, dir) {
  const neighborBlock = person.blockZIndex + dir;
  if (neighborBlock < 0 || neighborBlock > BLOCK_INDEX_MAX) return false;
  const corner = person.corner;
  let nextCorner;
  if (dir < 0) nextCorner = corner === 0 ? 3 : corner === 1 ? 2 : -1;
  else nextCorner = corner === 2 ? 1 : corner === 3 ? 0 : -1;
  if (nextCorner < 0) return false;
  const point = cornerPoint(person.blockXIndex, neighborBlock, nextCorner);
  person.pendingBlock = { blockXIndex: person.blockXIndex, blockZIndex: neighborBlock, corner: nextCorner };
  person.target.x = point.x;
  person.target.z = point.z;
  person.state = 'cross';
  person.timer = 0;
  return true;
}

function trafficNear(actors, x, z, radius) {
  const cars = actors.traffic.cars;
  for (let carIndex = 0; carIndex < cars.length; carIndex += 1) {
    const car = cars[carIndex];
    if (Math.abs(car.speed || 0) < MOVING_CAR_SPEED) continue;
    if (Math.hypot(car.root.position.x - x, car.root.position.z - z) < radius) return true;
  }
  return false;
}

function say(actors, text, person) {
  if (actors.barkTimer > 0) return;
  actors.lastBark = text;
  actors.barkTimer = BARK_DURATION;
  actors.lastSpeaker = person || null;
}

function nearestBark(actors, seed) {
  const barkIndex = Math.floor(seed * BARKS.length) % BARKS.length;
  return BARKS[barkIndex];
}

/** Public: shoot or run someone over. Returns true when it kills them. */
export function hitPedestrian(person, damage, dirX = 0, dirZ = 0, actors = null) {
  if (!person || !person.alive) return false;
  person.health -= damage;
  person.panic = Math.max(person.panic, HIT_PANIC_SECONDS);
  if (person.health > 0) return false;
  person.alive = false;
  person.state = 'dead';
  person.dead = 0;
  person.fall = 0;
  person.knockX = dirX * KNOCK_FACTOR;
  person.knockZ = dirZ * KNOCK_FACTOR;
  if (actors) say(actors, 'Somebody call a doctor!', person);
  return true;
}

export function stepActors(actors, delta, player, police) {
  if (!actors || !(delta > 0)) return;
  const playerPos = player && player.group ? player.group.position : null;
  const playerX = playerPos ? playerPos.x : 0;
  const playerZ = playerPos ? playerPos.z : 0;

  // The city is built before the actors, so bind its colliders on the first tick.
  if (!actors._world) {
    actors._world = true;
    const city = typeof window !== 'undefined' && window.SOLARA ? window.SOLARA.city : null;
    if (city) setWorld(city);
  }

  if (actors.traffic) { actors.traffic.step(delta, playerPos, player); actors.honks = actors.traffic.honks; }
  if (actors.barkTimer > 0) actors.barkTimer -= delta;

  const stars = police && police.stars ? police.stars : 0;
  const panicRadius = PANIC_RADIUS_BASE + stars * PANIC_RADIUS_PER_STAR;

  // Gunfire: a shrinking clip means a shot went off this frame.
  let gunshot = false;
  if (player && typeof player.clip === 'number') {
    if (actors._clip >= 0 && player.clip < actors._clip) gunshot = true;
    actors._clip = player.clip;
  }
  const car = player && player.car ? player.car : null;
  const carSpeed = car ? Math.abs(car.speed || 0) : 0;

  for (let pedIndex = 0; pedIndex < actors.people.length; pedIndex += 1) {
    const person = actors.people[pedIndex];
    const pos = person.mesh.position;
    const distPlayer = Math.hypot(pos.x - playerX, pos.z - playerZ);

    if (distPlayer > CULL_DISTANCE) {
      placePed(actors, person, playerX, playerZ, actors.trafficRandom || (actors.trafficRandom = createRandom(CITY.seed ^ RESPAWN_SEED_XOR)), false);
      continue;
    }

    if (!person.alive) {
      updateDead(actors, person, delta, playerX, playerZ);
      continue;
    }

    // Threats: a wanted player, gunfire, or a car coming at them.
    if (gunshot && distPlayer < GUNSHOT_RADIUS) {
      person.panic = Math.max(person.panic, GUNSHOT_PANIC_BASE + Math.min(GUNSHOT_PANIC_BONUS_MAX, distPlayer / GUNSHOT_DIST_REF));
      say(actors, nearestBark(actors, (pos.x + pos.z) * BARK_SEED_FACTOR), person);
    }
    if (stars > 0 && distPlayer < panicRadius) person.panic = Math.max(person.panic, WANTED_PANIC);
    if (car && distPlayer < CAR_THREAT_DIST && carSpeed > CAR_THREAT_SPEED) person.panic = Math.max(person.panic, CAR_THREAT_PANIC);

    // Run over the pedestrian.
    if (car && distPlayer < RUNOVER_DIST && carSpeed > RUNOVER_SPEED) {
      const velocityX = car.velocityX || 0;
      const velocityZ = car.velocityZ || 0;
      const magnitude = Math.hypot(velocityX, velocityZ) || 1;
      hitPedestrian(person, RUNOVER_DAMAGE, velocityX / magnitude, velocityZ / magnitude, actors);
      if (typeof window !== 'undefined' && window.SOLARA && window.SOLARA.audio) window.SOLARA.audio.step();
      if (police && police.crime) police.crime(1);
      continue;
    }

    if (person.panic > 0) person.panic -= delta;

    if (person.panic > 0 && person.state !== 'cross') {
      updateFlee(actors, person, delta, playerX, playerZ, carSpeed);
      continue;
    }

    if (person.state === 'idle') {
      updateIdle(actors, person, delta);
      continue;
    }
    if (person.state === 'wait') {
      updateWait(actors, person, delta);
      continue;
    }
    updateWalk(actors, person, delta);
  }

  actors._fire = player ? player.fire : 0;
}

function updateWalk(actors, person, delta) {
  const pos = person.mesh.position;
  const toTargetX = person.target.x - pos.x;
  const toTargetZ = person.target.z - pos.z;
  const targetDistance = Math.hypot(toTargetX, toTargetZ);
  if (targetDistance < ARRIVE_DIST) {
    arrive(actors, person);
    return;
  }
  const desiredHeading = Math.atan2(toTargetX, toTargetZ);
  const headingError = wrap(desiredHeading - person.mesh.rotation.y);
  person.mesh.rotation.y += clamp(headingError, -WALK_TURN_RATE * delta, WALK_TURN_RATE * delta);
  const speed = person.state === 'cross' ? person.speed * CROSS_SPEED_FACTOR : person.speed;
  const move = Math.min(targetDistance, speed * delta * clamp(Math.cos(headingError), WALK_MIN_COS, 1));
  person.mesh.position.x += Math.sin(person.mesh.rotation.y) * move;
  person.mesh.position.z += Math.cos(person.mesh.rotation.y) * move;
  person.phase += move * WALK_PHASE_PER_UNIT;
  animateWalk(person, Math.min(1, speed / WALK_ANIM_SPEED_REF));
  groundY(person, delta);
}

function animateWalk(person, amount) {
  const swing = Math.sin(person.phase) * LEG_SWING_AMOUNT * amount;
  person.legs[0].rotation.x = swing;
  person.legs[1].rotation.x = -swing;
  person.arms[0].rotation.x = -swing * ARM_SWING_RATIO;
  person.arms[1].rotation.x = swing * ARM_SWING_RATIO;
  person.torso.rotation.z = Math.sin(person.phase * TORSO_SWAY_RATE) * TORSO_SWAY_AMOUNT * amount;
  person.head.rotation.x = 0;
  person.head.rotation.y = 0;
}

/** Sit the figure on the sidewalk slab, or down on the tarmac while crossing. */
function groundY(person, delta) {
  const pos = person.mesh.position;
  const onX = Math.abs(pos.x - Math.round(pos.x / BLOCK) * BLOCK) < ROAD_HALF_CHECK;
  const onZ = Math.abs(pos.z - Math.round(pos.z / BLOCK) * BLOCK) < ROAD_HALF_CHECK;
  const target = person.state === 'cross' || (onX && onZ) ? ROAD_Y : SIDEWALK_Y;
  pos.y += (target - pos.y) * Math.min(1, delta * GROUND_SMOOTH_RATE);
}

function arrive(actors, person) {
  const pos = person.mesh.position;
  if (person.state === 'cross') {
    const pending = person.pendingBlock;
    if (pending) {
      person.blockXIndex = pending.blockXIndex;
      person.blockZIndex = pending.blockZIndex;
      person.corner = pending.corner;
      person.pendingBlock = null;
    }
    person.state = 'walk';
    chooseWalkTarget(person);
    return;
  }
  person.corner = person.pending !== undefined ? person.pending : person.corner;
  const random = actors.trafficRandom || (actors.trafficRandom = createRandom(CITY.seed ^ RESPAWN_SEED_XOR));
  const roll = random();
  if (roll < CROSS_CHANCE) {
    // Cross whichever road this corner faces.
    const side = random();
    const crossed = side < 0.5
      ? crossX(actors, person, person.corner === 0 || person.corner === 3 ? -1 : 1)
      : crossZ(actors, person, person.corner <= 1 ? -1 : 1);
    if (crossed) {
      // Look for traffic before stepping off the kerb.
      const midX = (pos.x + person.target.x) * 0.5;
      const midZ = (pos.z + person.target.z) * 0.5;
      if (trafficNear(actors, midX, midZ, TRAFFIC_CHECK_RADIUS)) {
        person.state = 'wait';
        person.timer = WAIT_BEFORE_CROSS;
      }
      return;
    }
  }
  if (roll < CROSS_CHANCE + IDLE_CHANCE) {
    person.state = 'idle';
    person.timer = IDLE_BASE_SECONDS + random() * IDLE_RANDOM_SECONDS;
    person.partner = findPartner(actors, person);
    asPersonIdle(person);
    if (person.partner) say(actors, nearestBark(actors, random()), person);
    return;
  }
  chooseWalkTarget(person);
}

function asPersonIdle(person) {
  person.legs[0].rotation.x = 0;
  person.legs[1].rotation.x = 0;
  person.arms[0].rotation.x = 0;
  person.arms[1].rotation.x = 0;
}

function findPartner(actors, person) {
  for (let otherIndex = 0; otherIndex < actors.people.length; otherIndex += 1) {
    const other = actors.people[otherIndex];
    if (other === person || !other.alive || other.state !== 'idle' || other.partner) continue;
    if (Math.hypot(other.mesh.position.x - person.mesh.position.x, other.mesh.position.z - person.mesh.position.z) < PARTNER_RADIUS) return other;
  }
  return null;
}

function updateIdle(actors, person, delta) {
  person.timer -= delta;
  const phase = person.phase;
  person.figure.rotation.z = Math.sin(phase * IDLE_SWAY_RATE) * IDLE_SWAY_AMOUNT;
  person.arms[0].rotation.x = Math.sin(phase * IDLE_ARM_RATE) * IDLE_ARM_AMOUNT;
  person.arms[1].rotation.x = -Math.sin(phase * IDLE_ARM_RATE) * IDLE_ARM_AMOUNT;
  if (person.partner) {
    const other = person.partner;
    if (!other.alive || other.state !== 'idle') {
      person.partner = null;
    } else {
      const toPartnerX = other.mesh.position.x - person.mesh.position.x;
      const toPartnerZ = other.mesh.position.z - person.mesh.position.z;
      const desiredHeading = Math.atan2(toPartnerX, toPartnerZ);
      person.mesh.rotation.y += clamp(wrap(desiredHeading - person.mesh.rotation.y), -IDLE_TURN_RATE * delta, IDLE_TURN_RATE * delta);
      person.head.rotation.x = Math.sin(phase * IDLE_NOD_RATE) * IDLE_NOD_AMOUNT;
      person.head.rotation.y = Math.sin(phase * IDLE_LOOK_RATE) * IDLE_LOOK_AMOUNT;
    }
  }
  person.phase += delta * IDLE_PHASE_RATE;
  if (person.timer <= 0) {
    person.partner = null;
    person.head.rotation.set(0, 0, 0);
    person.figure.rotation.z = 0;
    chooseWalkTarget(person);
  }
}

function updateWait(actors, person, delta) {
  person.timer -= delta;
  const pos = person.mesh.position;
  const midX = (pos.x + person.target.x) * 0.5;
  const midZ = (pos.z + person.target.z) * 0.5;
  if (person.timer <= 0 || !trafficNear(actors, midX, midZ, WAIT_TRAFFIC_RADIUS)) {
    person.state = 'cross';
  }
}

function updateFlee(actors, person, delta, playerX, playerZ, carSpeed) {
  const pos = person.mesh.position;
  const awayX = pos.x - playerX;
  const awayZ = pos.z - playerZ;
  // Keep running along the footway: aim for the corner farthest from the threat.
  if (person.state !== 'flee' || person.timer <= 0) {
    person.state = 'flee';
    person.timer = FLEE_RETARGET_SECONDS;
    let bestCorner = null;
    let bestScore = -1;
    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
      const point = cornerPoint(person.blockXIndex, person.blockZIndex, cornerIndex);
      const score = Math.hypot(point.x - playerX, point.z - playerZ);
      if (score > bestScore) { bestScore = score; bestCorner = { cornerIndex, point }; }
    }
    if (bestCorner) {
      person.pending = bestCorner.cornerIndex;
      person.target.x = bestCorner.point.x;
      person.target.z = bestCorner.point.z;
    }
  }
  person.timer -= delta;
  const toTargetX = person.target.x - pos.x;
  const toTargetZ = person.target.z - pos.z;
  const targetDistance = Math.hypot(toTargetX, toTargetZ);
  const desiredHeading = targetDistance > 0.4 ? Math.atan2(toTargetX, toTargetZ) : Math.atan2(awayX, awayZ);
  const headingError = wrap(desiredHeading - person.mesh.rotation.y);
  person.mesh.rotation.y += clamp(headingError, -FLEE_TURN_RATE * delta, FLEE_TURN_RATE * delta);
  const speed = FLEE_BASE_SPEED + Math.min(FLEE_SPEED_BONUS_MAX, carSpeed * FLEE_CAR_SPEED_FACTOR);
  const move = speed * delta * clamp(Math.cos(headingError), FLEE_MIN_COS, 1);
  person.mesh.position.x += Math.sin(person.mesh.rotation.y) * move;
  person.mesh.position.z += Math.cos(person.mesh.rotation.y) * move;
  person.phase += move * FLEE_PHASE_PER_UNIT;
  const swing = Math.sin(person.phase) * FLEE_LEG_SWING;
  person.legs[0].rotation.x = swing;
  person.legs[1].rotation.x = -swing;
  person.arms[0].rotation.x = FLEE_ARM_RAISE + Math.sin(person.phase * FLEE_ARM_FLAIL_RATE) * FLEE_ARM_FLAIL;
  person.arms[1].rotation.x = FLEE_ARM_RAISE - Math.sin(person.phase * FLEE_ARM_FLAIL_RATE) * FLEE_ARM_FLAIL;
  person.mesh.position.y = SIDEWALK_Y;
}

function updateDead(actors, person, delta, playerX, playerZ) {
  const pos = person.mesh.position;
  person.dead += delta;
  person.fall = Math.min(1, person.fall + delta * FALL_RATE);
  const fallDirection = person.knockX || person.knockZ ? Math.sign(person.knockX || person.knockZ) : 1;
  person.mesh.rotation.z += (fallDirection * FALL_ANGLE - person.mesh.rotation.z) * Math.min(1, delta * FALL_SMOOTH_RATE);
  pos.x += person.knockX * delta;
  pos.z += person.knockZ * delta;
  person.knockX *= KNOCK_DECAY;
  person.knockZ *= KNOCK_DECAY;
  pos.y += (SIDEWALK_Y - pos.y) * Math.min(1, delta * DEAD_GROUND_SMOOTH);
  person.arms[0].rotation.x = -1.4;
  person.arms[1].rotation.x = -1.9;
  person.legs[0].rotation.x = 0.2;
  person.legs[1].rotation.x = -0.15;
  if (person.dead > RESPAWN_DELAY) placePed(actors, person, playerX, playerZ, actors.trafficRandom || (actors.trafficRandom = createRandom(CITY.seed ^ RESPAWN_SEED_XOR)), false);
}

/** A quiet helper for the HUD and for tests: how many people are on their feet. */
export function actorStats(actors) {
  let alive = 0;
  let fleeing = 0;
  for (const person of actors.people) {
    if (person.alive) alive += 1;
    if (person.panic > 0) fleeing += 1;
  }
  return { alive, fleeing, peds: actors.people.length, cars: actors.traffic.cars.length, honks: actors.traffic.honks };
}
