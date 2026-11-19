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

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};
const blockCenter = (i) => CENTER0 + i * BLOCK;

// One limb box whose origin sits at the joint, so rotation.x swings it.
const LIMB = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
const TORSO = new THREE.CylinderGeometry(0.5, 0.44, 1, 8, 1);
const HEAD = new THREE.SphereGeometry(0.5, 8, 6);
const MATS = new Map();
function cloth(color) {
  let m = MATS.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.04 });
    m.dispose = () => {}; // shared across peds: never let a caller free it
    MATS.set(color, m);
  }
  return m;
}

/** Corner k of block (bi,bj): 0 NW, 1 NE, 2 SE, 3 SW. */
function cornerPoint(bi, bj, k) {
  const cx = blockCenter(bi);
  const cz = blockCenter(bj);
  const sx = k === 1 || k === 2 ? 1 : -1;
  const sz = k >= 2 ? 1 : -1;
  return { x: cx + sx * HALF_BLOCK, z: cz + sz * HALF_BLOCK };
}

function buildPerson(rng) {
  const group = new THREE.Group();
  const figure = new THREE.Group();
  group.add(figure);
  const shirt = SHIRTS[(rng() * SHIRTS.length) | 0];
  const pants = PANTS[(rng() * PANTS.length) | 0];
  const skin = SKINS[(rng() * SKINS.length) | 0];

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

  return { group, figure, torso, head, arms, legs, height: 0.93 + rng() * 0.15 };
}

/**
 * Build the actor layer: pedestrian pool plus the ambient traffic system.
 * Returns { cars, people, traffic, lastBark, ... } as main.js expects.
 */
export function makeActors(scene) {
  const rng = createRandom(CITY.seed ^ 0x1d3a7);
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

  for (let i = 0; i < MAX_PEDS; i += 1) {
    const parts = buildPerson(rng);
    const person = {
      mesh: parts.group,
      figure: parts.figure,
      torso: parts.torso,
      head: parts.head,
      arms: parts.arms,
      legs: parts.legs,
      alive: true,
      health: 100,
      height: parts.height,
      bi: 0,
      bj: 0,
      corner: 0,
      ring: rng() < 0.5 ? 1 : -1,
      target: { x: 0, z: 0 },
      state: 'walk',
      timer: 0,
      phase: rng() * 6,
      speed: 1.15 + rng() * 0.6,
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
    placePed(actors, person, 0, 0, rng, false);
  }

  return actors;
}

/** Drop a person on a corner near (px,pz), preferably out of sight distance. */
function placePed(actors, person, px, pz, rng, anyDistance) {
  let chosen = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const bi = clamp(Math.round((px - CENTER0) / BLOCK) + Math.floor((rng() * 2 - 1) * 5), 0, 11);
    const bj = clamp(Math.round((pz - CENTER0) / BLOCK) + Math.floor((rng() * 2 - 1) * 5), 0, 11);
    const k = (rng() * 4) | 0;
    const pt = cornerPoint(bi, bj, k);
    const d = Math.hypot(pt.x - px, pt.z - pz);
    if (!anyDistance && (d < SPAWN_MIN || d > SPAWN_MAX)) continue;
    let crowded = false;
    for (let i = 0; i < actors.people.length; i += 1) {
      const other = actors.people[i];
      if (other === person || !other.alive) continue;
      if (Math.hypot(other.mesh.position.x - pt.x, other.mesh.position.z - pt.z) < 2.6) { crowded = true; break; }
    }
    if (crowded) continue;
    chosen = { bi, bj, k, pt };
    break;
  }
  if (!chosen) {
    const bi = clamp(Math.round((px - CENTER0) / BLOCK), 0, 11);
    const bj = clamp(Math.round((pz - CENTER0) / BLOCK), 0, 11);
    const k = (rng() * 4) | 0;
    chosen = { bi, bj, k, pt: cornerPoint(bi, bj, k) };
  }
  const p = chosen.pt;
  person.mesh.position.set(p.x, 0.16, p.z);
  person.bi = chosen.bi;
  person.bj = chosen.bj;
  person.corner = chosen.k;
  person.alive = true;
  person.health = 100;
  person.state = 'walk';
  person.panic = 0;
  person.partner = null;
  person.fall = 0;
  person.dead = 0;
  person.knockX = 0;
  person.knockZ = 0;
  person.timer = 0;
  person.mesh.rotation.set(0, rng() * 6.28, 0);
  person.figure.rotation.set(0, 0, 0);
  chooseWalkTarget(person);
  return person;
}

function chooseWalkTarget(person) {
  const next = (person.corner + person.ring + 4) % 4;
  const pt = cornerPoint(person.bi, person.bj, next);
  person.pending = next;
  person.target.x = pt.x;
  person.target.z = pt.z;
  person.state = 'walk';
}

/** Cross to the neighbouring block over the west/east road. */
function crossX(actors, person, dir) {
  const nb = person.bi + dir;
  if (nb < 0 || nb > 11) return false;
  const k = person.corner;
  let nk;
  if (dir < 0) nk = k === 0 ? 1 : k === 3 ? 2 : -1;
  else nk = k === 1 ? 0 : k === 2 ? 3 : -1;
  if (nk < 0) return false;
  const pt = cornerPoint(nb, person.bj, nk);
  person.pendingBlock = { bi: nb, bj: person.bj, k: nk };
  person.target.x = pt.x;
  person.target.z = pt.z;
  person.state = 'cross';
  person.timer = 0;
  return true;
}

/** Cross the north/south road. */
function crossZ(actors, person, dir) {
  const nb = person.bj + dir;
  if (nb < 0 || nb > 11) return false;
  const k = person.corner;
  let nk;
  if (dir < 0) nk = k === 0 ? 3 : k === 1 ? 2 : -1;
  else nk = k === 2 ? 1 : k === 3 ? 0 : -1;
  if (nk < 0) return false;
  const pt = cornerPoint(person.bi, nb, nk);
  person.pendingBlock = { bi: person.bi, bj: nb, k: nk };
  person.target.x = pt.x;
  person.target.z = pt.z;
  person.state = 'cross';
  person.timer = 0;
  return true;
}

function trafficNear(actors, x, z, radius) {
  const cars = actors.traffic.cars;
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i];
    if (Math.abs(car.speed || 0) < 1.2) continue;
    if (Math.hypot(car.root.position.x - x, car.root.position.z - z) < radius) return true;
  }
  return false;
}

function say(actors, text, person) {
  if (actors.barkTimer > 0) return;
  actors.lastBark = text;
  actors.barkTimer = 2.4;
  actors.lastSpeaker = person || null;
}

function nearestBark(actors, seed) {
  const i = Math.floor(seed * BARKS.length) % BARKS.length;
  return BARKS[i];
}

/** Public: shoot or run someone over. Returns true when it kills them. */
export function hitPedestrian(person, damage, dirX = 0, dirZ = 0, actors = null) {
  if (!person || !person.alive) return false;
  person.health -= damage;
  person.panic = Math.max(person.panic, 5);
  if (person.health > 0) return false;
  person.alive = false;
  person.state = 'dead';
  person.dead = 0;
  person.fall = 0;
  person.knockX = dirX * 2.6;
  person.knockZ = dirZ * 2.6;
  if (actors) say(actors, 'Somebody call a doctor!', person);
  return true;
}

export function stepActors(actors, dt, player, police) {
  if (!actors || !(dt > 0)) return;
  const ppos = player && player.group ? player.group.position : null;
  const px = ppos ? ppos.x : 0;
  const pz = ppos ? ppos.z : 0;

  // The city is built before the actors, so bind its colliders on the first tick.
  if (!actors._world) {
    actors._world = true;
    const city = typeof window !== 'undefined' && window.SOLARA ? window.SOLARA.city : null;
    if (city) setWorld(city);
  }

  if (actors.traffic) { actors.traffic.step(dt, ppos, player); actors.honks = actors.traffic.honks; }
  if (actors.barkTimer > 0) actors.barkTimer -= dt;

  const stars = police && police.stars ? police.stars : 0;
  const panicRadius = 14 + stars * 7;

  // Gunfire: a shrinking clip means a shot went off this frame.
  let gunshot = false;
  if (player && typeof player.clip === 'number') {
    if (actors._clip >= 0 && player.clip < actors._clip) gunshot = true;
    actors._clip = player.clip;
  }
  const car = player && player.car ? player.car : null;
  const carSpeed = car ? Math.abs(car.speed || 0) : 0;

  for (let i = 0; i < actors.people.length; i += 1) {
    const person = actors.people[i];
    const pos = person.mesh.position;
    const distPlayer = Math.hypot(pos.x - px, pos.z - pz);

    if (distPlayer > CULL_DISTANCE) {
      placePed(actors, person, px, pz, actors.trafficRandom || (actors.trafficRandom = createRandom(CITY.seed ^ 0x77)), false);
      continue;
    }

    if (!person.alive) {
      updateDead(actors, person, dt, px, pz);
      continue;
    }

    // Threats: a wanted player, gunfire, or a car coming at them.
    if (gunshot && distPlayer < 46) {
      person.panic = Math.max(person.panic, 4.5 + Math.min(2, distPlayer / 30));
      say(actors, nearestBark(actors, (pos.x + pos.z) * 0.017), person);
    }
    if (stars > 0 && distPlayer < panicRadius) person.panic = Math.max(person.panic, 3.5);
    if (car && distPlayer < 22 && carSpeed > 10) person.panic = Math.max(person.panic, 2.2);

    // Run over the pedestrian.
    if (car && distPlayer < 2.9 && carSpeed > 5.5) {
      const vx = car.velocityX || 0;
      const vz = car.velocityZ || 0;
      const mag = Math.hypot(vx, vz) || 1;
      hitPedestrian(person, 120, vx / mag, vz / mag, actors);
      if (typeof window !== 'undefined' && window.SOLARA && window.SOLARA.audio) window.SOLARA.audio.step();
      if (police && police.crime) police.crime(1);
      continue;
    }

    if (person.panic > 0) person.panic -= dt;

    if (person.panic > 0 && person.state !== 'cross') {
      updateFlee(actors, person, dt, px, pz, carSpeed);
      continue;
    }

    if (person.state === 'idle') {
      updateIdle(actors, person, dt);
      continue;
    }
    if (person.state === 'wait') {
      updateWait(actors, person, dt);
      continue;
    }
    updateWalk(actors, person, dt);
  }

  actors._fire = player ? player.fire : 0;
}

function updateWalk(actors, person, dt) {
  const pos = person.mesh.position;
  const dx = person.target.x - pos.x;
  const dz = person.target.z - pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.45) {
    arrive(actors, person);
    return;
  }
  const want = Math.atan2(dx, dz);
  const diff = wrap(want - person.mesh.rotation.y);
  person.mesh.rotation.y += clamp(diff, -6 * dt, 6 * dt);
  const speed = person.state === 'cross' ? person.speed * 1.5 : person.speed;
  const move = Math.min(dist, speed * dt * clamp(Math.cos(diff), 0.08, 1));
  person.mesh.position.x += Math.sin(person.mesh.rotation.y) * move;
  person.mesh.position.z += Math.cos(person.mesh.rotation.y) * move;
  person.phase += move * 3.4;
  animateWalk(person, Math.min(1, speed / 1.4));
  groundY(person, dt);
}

function animateWalk(person, amount) {
  const swing = Math.sin(person.phase) * 0.55 * amount;
  person.legs[0].rotation.x = swing;
  person.legs[1].rotation.x = -swing;
  person.arms[0].rotation.x = -swing * 0.7;
  person.arms[1].rotation.x = swing * 0.7;
  person.torso.rotation.z = Math.sin(person.phase * 0.5) * 0.03 * amount;
  person.head.rotation.x = 0;
  person.head.rotation.y = 0;
}

/** Sit the figure on the sidewalk slab, or down on the tarmac while crossing. */
function groundY(person, dt) {
  const pos = person.mesh.position;
  const onX = Math.abs(pos.x - Math.round(pos.x / BLOCK) * BLOCK) < 5.6;
  const onZ = Math.abs(pos.z - Math.round(pos.z / BLOCK) * BLOCK) < 5.6;
  const target = person.state === 'cross' || (onX && onZ) ? 0.03 : 0.16;
  pos.y += (target - pos.y) * Math.min(1, dt * 8);
}

function arrive(actors, person) {
  const pos = person.mesh.position;
  if (person.state === 'cross') {
    const b = person.pendingBlock;
    if (b) {
      person.bi = b.bi;
      person.bj = b.bj;
      person.corner = b.k;
      person.pendingBlock = null;
    }
    person.state = 'walk';
    chooseWalkTarget(person);
    return;
  }
  person.corner = person.pending !== undefined ? person.pending : person.corner;
  const rng = actors.trafficRandom || (actors.trafficRandom = createRandom(CITY.seed ^ 0x77));
  const roll = rng();
  if (roll < CROSS_CHANCE) {
    // Cross whichever road this corner faces.
    const side = rng();
    const ok = side < 0.5
      ? crossX(actors, person, person.corner === 0 || person.corner === 3 ? -1 : 1)
      : crossZ(actors, person, person.corner <= 1 ? -1 : 1);
    if (ok) {
      // Look for traffic before stepping off the kerb.
      const midX = (pos.x + person.target.x) * 0.5;
      const midZ = (pos.z + person.target.z) * 0.5;
      if (trafficNear(actors, midX, midZ, 15)) {
        person.state = 'wait';
        person.timer = 2.2;
      }
      return;
    }
  }
  if (roll < CROSS_CHANCE + IDLE_CHANCE) {
    person.state = 'idle';
    person.timer = 2.5 + rng() * 5;
    person.partner = findPartner(actors, person);
    asPersonIdle(person);
    if (person.partner) say(actors, nearestBark(actors, rng()), person);
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
  for (let i = 0; i < actors.people.length; i += 1) {
    const other = actors.people[i];
    if (other === person || !other.alive || other.state !== 'idle' || other.partner) continue;
    if (Math.hypot(other.mesh.position.x - person.mesh.position.x, other.mesh.position.z - person.mesh.position.z) < 9) return other;
  }
  return null;
}

function updateIdle(actors, person, dt) {
  person.timer -= dt;
  const t = person.phase;
  person.figure.rotation.z = Math.sin(t * 1.4) * 0.012;
  person.arms[0].rotation.x = Math.sin(t * 1.1) * 0.06;
  person.arms[1].rotation.x = -Math.sin(t * 1.1) * 0.06;
  if (person.partner) {
    const other = person.partner;
    if (!other.alive || other.state !== 'idle') {
      person.partner = null;
    } else {
      const dx = other.mesh.position.x - person.mesh.position.x;
      const dz = other.mesh.position.z - person.mesh.position.z;
      const want = Math.atan2(dx, dz);
      person.mesh.rotation.y += clamp(wrap(want - person.mesh.rotation.y), -3 * dt, 3 * dt);
      person.head.rotation.x = Math.sin(t * 4) * 0.1;
      person.head.rotation.y = Math.sin(t * 2.2) * 0.12;
    }
  }
  person.phase += dt * 2;
  if (person.timer <= 0) {
    person.partner = null;
    person.head.rotation.set(0, 0, 0);
    person.figure.rotation.z = 0;
    chooseWalkTarget(person);
  }
}

function updateWait(actors, person, dt) {
  person.timer -= dt;
  const pos = person.mesh.position;
  const midX = (pos.x + person.target.x) * 0.5;
  const midZ = (pos.z + person.target.z) * 0.5;
  if (person.timer <= 0 || !trafficNear(actors, midX, midZ, 12)) {
    person.state = 'cross';
  }
}

function updateFlee(actors, person, dt, px, pz, carSpeed) {
  const pos = person.mesh.position;
  const dx = pos.x - px;
  const dz = pos.z - pz;
  const dist = Math.hypot(dx, dz) || 1;
  // Keep running along the footway: aim for the corner farthest from the threat.
  if (person.state !== 'flee' || person.timer <= 0) {
    person.state = 'flee';
    person.timer = 0.7;
    let best = null;
    let bestScore = -1;
    for (let k = 0; k < 4; k += 1) {
      const pt = cornerPoint(person.bi, person.bj, k);
      const score = Math.hypot(pt.x - px, pt.z - pz);
      if (score > bestScore) { bestScore = score; best = { k, pt }; }
    }
    if (best) {
      person.pending = best.k;
      person.target.x = best.pt.x;
      person.target.z = best.pt.z;
    }
  }
  person.timer -= dt;
  const tx = person.target.x - pos.x;
  const tz = person.target.z - pos.z;
  const tdist = Math.hypot(tx, tz);
  const want = tdist > 0.4 ? Math.atan2(tx, tz) : Math.atan2(dx, dz);
  const diff = wrap(want - person.mesh.rotation.y);
  person.mesh.rotation.y += clamp(diff, -9 * dt, 9 * dt);
  const speed = 4.2 + Math.min(1.4, carSpeed * 0.05);
  const move = speed * dt * clamp(Math.cos(diff), 0.05, 1);
  person.mesh.position.x += Math.sin(person.mesh.rotation.y) * move;
  person.mesh.position.z += Math.cos(person.mesh.rotation.y) * move;
  person.phase += move * 3.6;
  const swing = Math.sin(person.phase) * 0.85;
  person.legs[0].rotation.x = swing;
  person.legs[1].rotation.x = -swing;
  person.arms[0].rotation.x = -2.1 + Math.sin(person.phase * 0.7) * 0.3;
  person.arms[1].rotation.x = -2.1 - Math.sin(person.phase * 0.7) * 0.3;
  person.mesh.position.y = 0.16;
}

function updateDead(actors, person, dt, px, pz) {
  const pos = person.mesh.position;
  person.dead += dt;
  person.fall = Math.min(1, person.fall + dt * 4.5);
  const dir = person.knockX || person.knockZ ? Math.sign(person.knockX || person.knockZ) : 1;
  person.mesh.rotation.z += (dir * 1.5 - person.mesh.rotation.z) * Math.min(1, dt * 9);
  pos.x += person.knockX * dt;
  pos.z += person.knockZ * dt;
  person.knockX *= 0.86;
  person.knockZ *= 0.86;
  pos.y += (0.16 - pos.y) * Math.min(1, dt * 5);
  person.arms[0].rotation.x = -1.4;
  person.arms[1].rotation.x = -1.9;
  person.legs[0].rotation.x = 0.2;
  person.legs[1].rotation.x = -0.15;
  if (person.dead > 14) placePed(actors, person, px, pz, actors.trafficRandom || (actors.trafficRandom = createRandom(CITY.seed ^ 0x77)), false);
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
