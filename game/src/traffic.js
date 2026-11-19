// Ambient traffic for Solara Bay.
//
// Cars live on the same 13x13 road grid the city is built from (a road every
// CITY.block units, 11 wide) and drive the right-hand lane: axis 0 travels along
// x, axis 1 along z, and `line` names the road they are on. Each car steers
// toward the lane point at the next intersection, picks straight/left/right on
// arrival, queues behind the car ahead, obeys the lights, yields to the player
// and honks when it has been stuck for a while. Cars farther than DESPAWN units
// from the player are quietly moved to a fresh lane on the far side of the map,
// so the cap stays at MAX_CARS without pops in view.
//
// Nothing here uses Math.random: the same seed gives the same traffic.

import { CITY } from './config.js';
import { createRandom } from './random.js';
import { makeCar, animateVehicle, setWorld, registerCars } from './vehicles.js';

const BLOCK = CITY.block;
const LANE = 2.7; // lane centre offset from the road centre line
const LIMIT = 6; // road lines run from -6..6
const MAX_CARS = 14;
const SPAWN_MIN = 62;
const SPAWN_MAX = 180;
const DESPAWN = 228;
const TAILGATE = 3.0;
const LIGHT_PERIOD = 18;

/** Three speed profiles, plus the body types that show up in ambient traffic. */
const PROFILES = [
  { cruise: 7.5, accel: 4.0, brake: 7.0 },
  { cruise: 11, accel: 5.2, brake: 9.0 },
  { cruise: 15, accel: 6.6, brake: 11.5 },
];
const TYPES = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'sports', 'sedan', 'truck'];
const PAINTS = [0x2f9f97, 0xe8e2d2, 0xc45a4a, 0x4a6ea8, 0xd9b061, 0x8a8f7a, 0x384049, 0x9c5c74, 0x6f8f6a];

const wrapAngle = (a) => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function laneOffset(axis, dir) {
  // Right-hand traffic: along +x keep to -z, along +z keep to +x.
  return axis === 0 ? -LANE * dir : LANE * dir;
}
function laneCoord(line, axis, dir) {
  return line * BLOCK + laneOffset(axis, dir);
}
function headingFor(axis, dir) {
  if (axis === 0) return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}
function nextNodeAhead(coord, dir) {
  const n = Math.round(coord / BLOCK) * BLOCK;
  if (dir > 0) return n > coord + 5 ? n : n + BLOCK;
  return n < coord - 5 ? n : n - BLOCK;
}

function setTarget(car) {
  const t = car.traffic;
  if (t.axis === 0) {
    t.target.x = t.nextNode;
    t.target.z = laneCoord(t.line, 0, t.dir);
  } else {
    t.target.x = laneCoord(t.line, 1, t.dir);
    t.target.z = t.nextNode;
  }
}

/** The car reached its intersection: go straight, or pick a random turn. */
function advance(car, random) {
  const t = car.traffic;
  const node = t.nextNode;
  let turn = 0;
  const roll = random();
  if (roll < 0.2) turn = -1;
  else if (roll < 0.4) turn = 1;

  // Never drive off the end of a road: force a turn at the edge of the grid.
  if (Math.abs(node + t.dir * BLOCK) > LIMIT * BLOCK) turn = t.dir > 0 ? 1 : -1;

  if (turn === 0) {
    t.nextNode = node + t.dir * BLOCK;
    setTarget(car);
    return;
  }
  const fx = t.axis === 0 ? t.dir : 0;
  const fz = t.axis === 1 ? t.dir : 0;
  const rx = fz;
  const rz = -fx;
  const nx = turn > 0 ? rx : -rx;
  const nz = turn > 0 ? rz : -rz;
  const axis = nx !== 0 ? 0 : 1;
  const dir = nx !== 0 ? nx : nz;
  t.axis = axis;
  t.dir = dir;
  t.line = clamp(Math.round(node / BLOCK), -LIMIT, LIMIT);
  t.nextNode = node + dir * BLOCK;
  setTarget(car);
}

/** Move a car onto a lane and give it a destination. */
function place(car, axis, dir, line, coord) {
  line = clamp(Math.round(line), -LIMIT, LIMIT);
  car.root.position.x = axis === 0 ? coord : laneCoord(line, 1, dir);
  car.root.position.z = axis === 0 ? laneCoord(line, 0, dir) : coord;
  car.root.position.y = 0.55;
  car.root.rotation.y = headingFor(axis, dir);
  const t = car.traffic;
  t.axis = axis;
  t.dir = dir;
  t.line = line;
  t.nextNode = nextNodeAhead(coord, dir);
  t.target = t.target || { x: 0, z: 0 };
  t.blocked = 0;
  t.hornCooldown = 1 + (coord % 3);
  t.lastDist = 999;
  t.resume = false;
  setTarget(car);
}

/** Recover the nearest lane after the player abandons a hijacked car. */
function resumeLane(car) {
  const p = car.root.position;
  const yaw = car.root.rotation.y;
  const dzRoad = Math.abs(p.z - Math.round(p.z / BLOCK) * BLOCK);
  const dxRoad = Math.abs(p.x - Math.round(p.x / BLOCK) * BLOCK);
  const axis = dzRoad <= dxRoad ? 0 : 1;
  const dir = axis === 0 ? (Math.sin(yaw) >= 0 ? 1 : -1) : (Math.cos(yaw) >= 0 ? 1 : -1);
  const line = axis === 0 ? p.z / BLOCK : p.x / BLOCK;
  const coord = axis === 0 ? p.x : p.z;
  const t = car.traffic;
  t.axis = axis;
  t.dir = dir;
  t.line = clamp(Math.round(line), -LIMIT, LIMIT);
  t.nextNode = nextNodeAhead(coord, dir);
  t.blocked = 0;
  t.lastDist = 999;
  car.speed = Math.abs(car.speed || 0);
  setTarget(car);
}

/**
 * Traffic lights. If the city exposes `lightState(axis)` or a `trafficLights`
 * array it wins; otherwise a local 18 second cycle runs both axes.
 */
function ownLight(axis, time) {
  const p = ((time % LIGHT_PERIOD) + LIGHT_PERIOD) % LIGHT_PERIOD;
  if (axis === 0) return p < 6.5 ? 'green' : p < 8 ? 'yellow' : 'red';
  return p < 9.5 ? 'red' : p < 16.5 ? 'green' : 'yellow';
}

function cityLight(city, axis, time) {
  if (!city) return null;
  if (typeof city.lightState === 'function') {
    const state = city.lightState(axis);
    if (typeof state === 'string') return state;
    if (state === true) return 'green';
    if (state === false) return 'red';
  }
  if (Array.isArray(city.trafficLights)) {
    for (let i = 0; i < city.trafficLights.length; i += 1) {
      const light = city.trafficLights[i];
      if (!light) continue;
      const lightAxis = light.axis;
      if (lightAxis !== axis && lightAxis !== (axis === 0 ? 'x' : 'z')) continue;
      if (typeof light.state === 'string') return light.state;
      if (light.red) return 'red';
      if (light.yellow) return 'yellow';
      if (light.green) return 'green';
    }
  }
  return null;
}

/** Build one ambient car (also used for police-chase traffic). */
export function makeTrafficCar(scene, type = 'sedan', x = 0, z = 0, angle = 0, color) {
  const car = makeCar(scene, x, z, color, type === 'police', type);
  car.root.rotation.y = angle;
  car.ai = 'traffic';
  return car;
}

/** Create the ambient traffic system. `city` is optional (lights/colliders). */
export function createTraffic(scene, city) {
  const random = createRandom(((city && city.seed) || CITY.seed) ^ 0x5eed);
  const cars = [];
  if (city) setWorld(city);
  const traffic = {
    cars,
    city: city || null,
    honks: 0,
    time: 0,
    get count() {
      return cars.length;
    },
    step,
  };
  let firstStep = true;
  let recycleTimer = 0;

  function pickSpawn(px, pz) {
    for (let attempt = 0; attempt < 26; attempt += 1) {
      const axis = random() < 0.5 ? 0 : 1;
      const line = Math.round((random() * 2 - 1) * LIMIT);
      const dir = random() < 0.5 ? 1 : -1;
      const coord = (random() * 2 - 1) * 165;
      const x = axis === 0 ? coord : laneCoord(line, 1, dir);
      const z = axis === 0 ? laneCoord(line, 0, dir) : coord;
      if (Math.abs(x) > 190 || Math.abs(z) > 190) continue;
      if (Math.abs(coord - Math.round(coord / BLOCK) * BLOCK) < 7) continue; // not in the junction
      const d = Math.hypot(x - px, z - pz);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      let clear = true;
      for (let i = 0; i < cars.length; i += 1) {
        const other = cars[i].root.position;
        if (Math.hypot(other.x - x, other.z - z) < 13) { clear = false; break; }
      }
      if (!clear) continue;
      return { axis, dir, line, coord, x, z };
    }
    return null;
  }

  function spawn(px, pz) {
    const spot = pickSpawn(px, pz);
    if (!spot) return null;
    const profile = PROFILES[Math.floor(random() * PROFILES.length)];
    const roll = random();
    const type = roll < 0.05 ? 'police' : TYPES[Math.floor(random() * TYPES.length)];
    const color = type === 'taxi' || type === 'police' ? undefined : PAINTS[Math.floor(random() * PAINTS.length)];
    const car = makeTrafficCar(scene, type, spot.x, spot.z, headingFor(spot.axis, spot.dir), color);
    car.traffic = {
      axis: spot.axis, dir: spot.dir, line: spot.line, nextNode: 0,
      target: { x: 0, z: 0 }, cruise: profile.cruise * (type === 'truck' ? 0.8 : type === 'sports' ? 1.15 : 1),
      accel: profile.accel, brake: profile.brake, blocked: 0, hornCooldown: 2, lastDist: 999, resume: false,
    };
    place(car, spot.axis, spot.dir, spot.line, spot.coord);
    cars.push(car);
    return car;
  }

  function honk() {
    traffic.honks += 1;
    const audio = typeof window !== 'undefined' && window.SOLARA ? window.SOLARA.audio : null;
    if (!audio || typeof audio.horn !== 'function') return;
    const now = traffic.time;
    if (now - (traffic.lastHonk || -9) < 0.9) return;
    traffic.lastHonk = now;
    audio.horn();
  }

  function step(dt, playerPos, player) {
    if (!(dt > 0)) return;
    traffic.time += dt;
    const px = playerPos ? playerPos.x : 0;
    const pz = playerPos ? playerPos.z : 0;
    const carInUse = player && player.car ? player.car : null;
    const light0 = cityLight(traffic.city, 0, traffic.time) || ownLight(0, traffic.time);
    const light1 = cityLight(traffic.city, 1, traffic.time) || ownLight(1, traffic.time);
    const stop0 = light0 === 'red';
    const stop1 = light1 === 'red';
    const yellow0 = light0 === 'yellow';
    const yellow1 = light1 === 'yellow';

    if (firstStep) {
      // The player may have been placed after the traffic was built.
      firstStep = false;
      for (let i = 0; i < cars.length; i += 1) {
        if (Math.hypot(cars[i].root.position.x - px, cars[i].root.position.z - pz) < 22) {
          const spot = pickSpawn(px, pz);
          if (spot) place(cars[i], spot.axis, spot.dir, spot.line, spot.coord);
        }
      }
    }

    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      const t = car.traffic;
      if (!t) continue;
      if (car === carInUse) { t.resume = true; continue; }
      if (t.resume) resumeLane(car);

      const pos = car.root.position;
      const groupDistance = Math.hypot(pos.x - px, pos.z - pz);
      if (groupDistance > DESPAWN || Math.abs(pos.x) > 205 || Math.abs(pos.z) > 205) {
        const spot = pickSpawn(px, pz);
        if (spot) place(car, spot.axis, spot.dir, spot.line, spot.coord);
        continue;
      }

      const yaw = car.root.rotation.y;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = fz;
      const rz = -fx;
      const toX = t.target.x - pos.x;
      const toZ = t.target.z - pos.z;
      const dist = Math.hypot(toX, toZ);

      if (dist < 3.4 || (dist > t.lastDist + 0.35 && t.lastDist < 11)) {
        advance(car, random);
        t.lastDist = 999;
      } else {
        t.lastDist = dist;
      }
      const desired = Math.atan2(t.target.x - pos.x, t.target.z - pos.z);
      const diff = wrapAngle(desired - car.root.rotation.y);
      const speed = Math.max(0, car.speed || 0);
      const maxTurn = (2.0 + Math.min(1.4, speed * 0.05)) * (0.55 + 0.45 * Math.min(1, speed / 5));

      let targetSpeed = t.cruise;
      if (Math.abs(diff) > 0.32) targetSpeed *= 0.46;
      if (Math.abs(diff) > 0.9) targetSpeed = Math.min(targetSpeed, 5.5);

      // Lights: stop 6 units before the junction, unless already inside it.
      const coord = t.axis === 0 ? pos.x : pos.z;
      const ahead = (t.nextNode - coord) * t.dir;
      const axisLight = t.axis === 0 ? stop0 : stop1;
      const axisYellow = t.axis === 0 ? yellow0 : yellow1;
      if (ahead > 0 && ahead < 11) {
        const willStop = axisLight || (axisYellow && ahead > 6.5);
        if (willStop) {
          targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - 6.2) * 1.5));
        }
      }

      // The car ahead in this lane, and the player (on foot or driving).
      let gap = Infinity;
      for (let j = 0; j < cars.length; j += 1) {
        if (j === i) continue;
        const other = cars[j].root.position;
        const dx = other.x - pos.x;
        const dz = other.z - pos.z;
        const along = dx * fx + dz * fz;
        if (along <= 0.2 || along > 17) continue;
        if (Math.abs(dx * rx + dz * rz) > 2.9) continue;
        const clearance = along - (car.length + cars[j].length) * 0.5 - TAILGATE;
        if (clearance < gap) gap = clearance;
      }
      if (carInUse && carInUse !== car) {
        const dx = carInUse.root.position.x - pos.x;
        const dz = carInUse.root.position.z - pos.z;
        const along = dx * fx + dz * fz;
        if (along > 0 && along < 15 && Math.abs(dx * rx + dz * rz) < 3.4) {
          gap = Math.min(gap, along - 5.4);
        }
      } else if (!carInUse) {
        const dx = px - pos.x;
        const dz = pz - pos.z;
        const along = dx * fx + dz * fz;
        if (along > 0 && along < 13 && Math.abs(dx * rx + dz * rz) < 2.8) {
          gap = Math.min(gap, along - 3.2);
        }
      }
      if (gap < 22) targetSpeed = Math.min(targetSpeed, Math.max(0, (gap - 1) * 1.35));

      if (targetSpeed < 0.25 && speed < 0.9) t.blocked += dt;
      else t.blocked = Math.max(0, t.blocked - dt * 2.2);
      t.hornCooldown -= dt;
      if (t.blocked > 1.4 && t.hornCooldown <= 0) {
        t.hornCooldown = 3.5 + random() * 4;
        honk();
      }

      car.speed = speed + clamp(targetSpeed - speed, -t.brake * dt, t.accel * dt);
      if (car.speed < 0) car.speed = 0;
      car.root.rotation.y = (car.root.rotation.y + clamp(diff, -maxTurn * dt, maxTurn * dt)) % (Math.PI * 2);
      const heading = car.root.rotation.y;
      car.velocityX = Math.sin(heading) * car.speed;
      car.velocityZ = Math.cos(heading) * car.speed;
      car.root.position.x += car.velocityX * dt;
      car.root.position.z += car.velocityZ * dt;
      car.root.position.y = 0.55;
      car.steerInput = clamp(diff * 1.6, -1, 1);
      car.lateralSpeed = 0;
      car.braking = targetSpeed < speed - 0.2;
      animateVehicle(car, dt);
    }

    // Keep the cap, and top the street back up after crashes or hijacks.
    recycleTimer -= dt;
    if (recycleTimer <= 0) {
      recycleTimer = 0.6;
      while (cars.length < MAX_CARS) {
        if (!spawn(px, pz)) break;
      }
    }
  }

  spawn(0, 0);
  while (cars.length < MAX_CARS) if (!spawn(0, 0)) break;
  registerCars(cars);
  return traffic;
}