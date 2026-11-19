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

const TRAFFIC_SEED_XOR = 0x5eed;
const CAR_RIDE_HEIGHT = 0.55;
const FAR_DISTANCE = 999;
const NODE_AHEAD_EPSILON = 5;
const TURN_LEFT_CHANCE = 0.2;
const TURN_RIGHT_CHANCE = 0.4;
const MAP_EDGE_LIMIT = 205;
const PLAYER_NEAR_DISTANCE = 22;
const SPAWN_ATTEMPTS = 26;
const SPAWN_COORD_RANGE = 165;
const SPAWN_EDGE_LIMIT = 190;
const JUNCTION_CLEARANCE = 7;
const SPAWN_CAR_SPACING = 13;
const POLICE_SPAWN_CHANCE = 0.05;
const TRUCK_SPEED_FACTOR = 0.8;
const SPORTS_SPEED_FACTOR = 1.15;
const INITIAL_HORN_COOLDOWN = 2;
const HORN_BASE_COOLDOWN = 1;
const HORN_COORD_MODULO = 3;
const HONK_MIN_GAP = 0.9;
const HORN_NEVER = -9;
const HORN_BLOCKED_SECONDS = 1.4;
const HORN_COOLDOWN_BASE = 3.5;
const HORN_COOLDOWN_RANDOM = 4;
const RECYCLE_INTERVAL = 0.6;
// Local light cycle thresholds (seconds into LIGHT_PERIOD), per axis.
const AXIS0_GREEN_END = 6.5;
const AXIS0_YELLOW_END = 8;
const AXIS1_RED_END = 9.5;
const AXIS1_GREEN_END = 16.5;
// Arrival and overshoot detection at intersections.
const ARRIVE_DISTANCE = 3.4;
const OVERSHOOT_MARGIN = 0.35;
const OVERSHOOT_WINDOW = 11;
// Steering feel.
const BASE_TURN_RATE = 2.0;
const SPEED_TURN_BONUS = 1.4;
const TURN_SPEED_FACTOR = 0.05;
const LOW_SPEED_TURN_FLOOR = 0.55;
const LOW_SPEED_TURN_RANGE = 0.45;
const TURN_SPEED_REF = 5;
const CORNER_SLOW_ANGLE = 0.32;
const CORNER_SLOW_FACTOR = 0.46;
const SHARP_TURN_ANGLE = 0.9;
const SHARP_TURN_SPEED = 5.5;
const STEER_VISUAL_SCALE = 1.6;
const BRAKE_THRESHOLD = 0.2;
// Traffic lights ahead.
const LIGHT_APPROACH_DIST = 11;
const YELLOW_STOP_DIST = 6.5;
const STOP_LINE_OFFSET = 6.2;
const STOP_SPEED_SCALE = 1.5;
// Queuing behind other cars and yielding to the player.
const AHEAD_EPSILON = 0.2;
const FOLLOW_LOOKAHEAD = 17;
const LANE_HALF_WIDTH = 2.9;
const PLAYER_CAR_LOOKAHEAD = 15;
const PLAYER_CAR_HALF_WIDTH = 3.4;
const PLAYER_CAR_CLEARANCE = 5.4;
const PLAYER_FOOT_LOOKAHEAD = 13;
const PLAYER_FOOT_HALF_WIDTH = 2.8;
const PLAYER_FOOT_CLEARANCE = 3.2;
const GAP_SLOW_RANGE = 22;
const GAP_BUFFER = 1;
const GAP_SPEED_SCALE = 1.35;
const BLOCKED_SPEED_THRESHOLD = 0.25;
const BLOCKED_CREEP_SPEED = 0.9;
const BLOCKED_DECAY_RATE = 2.2;

/** Three speed profiles, plus the body types that show up in ambient traffic. */
const PROFILES = [
  { cruise: 7.5, accel: 4.0, brake: 7.0 },
  { cruise: 11, accel: 5.2, brake: 9.0 },
  { cruise: 15, accel: 6.6, brake: 11.5 },
];
const TYPES = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'sports', 'sedan', 'truck'];
const PAINTS = [0x2f9f97, 0xe8e2d2, 0xc45a4a, 0x4a6ea8, 0xd9b061, 0x8a8f7a, 0x384049, 0x9c5c74, 0x6f8f6a];

const wrapAngle = (angle) => {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
};
const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

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
  const nearestNode = Math.round(coord / BLOCK) * BLOCK;
  if (dir > 0) return nearestNode > coord + NODE_AHEAD_EPSILON ? nearestNode : nearestNode + BLOCK;
  return nearestNode < coord - NODE_AHEAD_EPSILON ? nearestNode : nearestNode - BLOCK;
}

function setTarget(car) {
  const trafficState = car.traffic;
  if (trafficState.axis === 0) {
    trafficState.target.x = trafficState.nextNode;
    trafficState.target.z = laneCoord(trafficState.line, 0, trafficState.dir);
  } else {
    trafficState.target.x = laneCoord(trafficState.line, 1, trafficState.dir);
    trafficState.target.z = trafficState.nextNode;
  }
}

/** The car reached its intersection: go straight, or pick a random turn. */
function advance(car, random) {
  const trafficState = car.traffic;
  const node = trafficState.nextNode;
  let turn = 0;
  const roll = random();
  if (roll < TURN_LEFT_CHANCE) turn = -1;
  else if (roll < TURN_RIGHT_CHANCE) turn = 1;

  // Never drive off the end of a road: force a turn at the edge of the grid.
  if (Math.abs(node + trafficState.dir * BLOCK) > LIMIT * BLOCK) turn = trafficState.dir > 0 ? 1 : -1;

  if (turn === 0) {
    trafficState.nextNode = node + trafficState.dir * BLOCK;
    setTarget(car);
    return;
  }
  const forwardX = trafficState.axis === 0 ? trafficState.dir : 0;
  const forwardZ = trafficState.axis === 1 ? trafficState.dir : 0;
  const rightX = forwardZ;
  const rightZ = -forwardX;
  const turnX = turn > 0 ? rightX : -rightX;
  const turnZ = turn > 0 ? rightZ : -rightZ;
  const axis = turnX !== 0 ? 0 : 1;
  const dir = turnX !== 0 ? turnX : turnZ;
  trafficState.axis = axis;
  trafficState.dir = dir;
  trafficState.line = clamp(Math.round(node / BLOCK), -LIMIT, LIMIT);
  trafficState.nextNode = node + dir * BLOCK;
  setTarget(car);
}

/** Move a car onto a lane and give it a destination. */
function place(car, axis, dir, line, coord) {
  line = clamp(Math.round(line), -LIMIT, LIMIT);
  car.root.position.x = axis === 0 ? coord : laneCoord(line, 1, dir);
  car.root.position.z = axis === 0 ? laneCoord(line, 0, dir) : coord;
  car.root.position.y = CAR_RIDE_HEIGHT;
  car.root.rotation.y = headingFor(axis, dir);
  const trafficState = car.traffic;
  trafficState.axis = axis;
  trafficState.dir = dir;
  trafficState.line = line;
  trafficState.nextNode = nextNodeAhead(coord, dir);
  trafficState.target = trafficState.target || { x: 0, z: 0 };
  trafficState.blocked = 0;
  trafficState.hornCooldown = HORN_BASE_COOLDOWN + (coord % HORN_COORD_MODULO);
  trafficState.lastDist = FAR_DISTANCE;
  trafficState.resume = false;
  setTarget(car);
}

/** Recover the nearest lane after the player abandons a hijacked car. */
function resumeLane(car) {
  const position = car.root.position;
  const yaw = car.root.rotation.y;
  const dzRoad = Math.abs(position.z - Math.round(position.z / BLOCK) * BLOCK);
  const dxRoad = Math.abs(position.x - Math.round(position.x / BLOCK) * BLOCK);
  const axis = dzRoad <= dxRoad ? 0 : 1;
  const dir = axis === 0 ? (Math.sin(yaw) >= 0 ? 1 : -1) : (Math.cos(yaw) >= 0 ? 1 : -1);
  const line = axis === 0 ? position.z / BLOCK : position.x / BLOCK;
  const coord = axis === 0 ? position.x : position.z;
  const trafficState = car.traffic;
  trafficState.axis = axis;
  trafficState.dir = dir;
  trafficState.line = clamp(Math.round(line), -LIMIT, LIMIT);
  trafficState.nextNode = nextNodeAhead(coord, dir);
  trafficState.blocked = 0;
  trafficState.lastDist = FAR_DISTANCE;
  car.speed = Math.abs(car.speed || 0);
  setTarget(car);
}

/**
 * Traffic lights. If the city exposes `lightState(axis)` or a `trafficLights`
 * array it wins; otherwise a local 18 second cycle runs both axes.
 */
function ownLight(axis, time) {
  const phase = ((time % LIGHT_PERIOD) + LIGHT_PERIOD) % LIGHT_PERIOD;
  if (axis === 0) return phase < AXIS0_GREEN_END ? 'green' : phase < AXIS0_YELLOW_END ? 'yellow' : 'red';
  return phase < AXIS1_RED_END ? 'red' : phase < AXIS1_GREEN_END ? 'green' : 'yellow';
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
    for (let index = 0; index < city.trafficLights.length; index += 1) {
      const light = city.trafficLights[index];
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
export function makeTrafficCar(scene, type = 'sedan', positionX = 0, positionZ = 0, heading = 0, color) {
  const car = makeCar(scene, positionX, positionZ, color, type === 'police', type);
  car.root.rotation.y = heading;
  car.ai = 'traffic';
  return car;
}

/** Create the ambient traffic system. `city` is optional (lights/colliders). */
export function createTraffic(scene, city) {
  const random = createRandom(((city && city.seed) || CITY.seed) ^ TRAFFIC_SEED_XOR);
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

  function pickSpawn(playerX, playerZ) {
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
      const axis = random() < 0.5 ? 0 : 1;
      const line = Math.round((random() * 2 - 1) * LIMIT);
      const dir = random() < 0.5 ? 1 : -1;
      const coord = (random() * 2 - 1) * SPAWN_COORD_RANGE;
      const x = axis === 0 ? coord : laneCoord(line, 1, dir);
      const z = axis === 0 ? laneCoord(line, 0, dir) : coord;
      if (Math.abs(x) > SPAWN_EDGE_LIMIT || Math.abs(z) > SPAWN_EDGE_LIMIT) continue;
      if (Math.abs(coord - Math.round(coord / BLOCK) * BLOCK) < JUNCTION_CLEARANCE) continue; // not in the junction
      const distance = Math.hypot(x - playerX, z - playerZ);
      if (distance < SPAWN_MIN || distance > SPAWN_MAX) continue;
      let clear = true;
      for (let index = 0; index < cars.length; index += 1) {
        const other = cars[index].root.position;
        if (Math.hypot(other.x - x, other.z - z) < SPAWN_CAR_SPACING) { clear = false; break; }
      }
      if (!clear) continue;
      return { axis, dir, line, coord, x, z };
    }
    return null;
  }

  function spawn(playerX, playerZ) {
    const spot = pickSpawn(playerX, playerZ);
    if (!spot) return null;
    const profile = PROFILES[Math.floor(random() * PROFILES.length)];
    const roll = random();
    const type = roll < POLICE_SPAWN_CHANCE ? 'police' : TYPES[Math.floor(random() * TYPES.length)];
    const color = type === 'taxi' || type === 'police' ? undefined : PAINTS[Math.floor(random() * PAINTS.length)];
    const car = makeTrafficCar(scene, type, spot.x, spot.z, headingFor(spot.axis, spot.dir), color);
    car.traffic = {
      axis: spot.axis, dir: spot.dir, line: spot.line, nextNode: 0,
      target: { x: 0, z: 0 }, cruise: profile.cruise * (type === 'truck' ? TRUCK_SPEED_FACTOR : type === 'sports' ? SPORTS_SPEED_FACTOR : 1),
      accel: profile.accel, brake: profile.brake, blocked: 0, hornCooldown: INITIAL_HORN_COOLDOWN, lastDist: FAR_DISTANCE, resume: false,
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
    if (now - (traffic.lastHonk || HORN_NEVER) < HONK_MIN_GAP) return;
    traffic.lastHonk = now;
    audio.horn();
  }

  function step(delta, playerPos, player) {
    if (!(delta > 0)) return;
    traffic.time += delta;
    const playerX = playerPos ? playerPos.x : 0;
    const playerZ = playerPos ? playerPos.z : 0;
    const carInUse = player && player.car ? player.car : null;
    const lightAxis0 = cityLight(traffic.city, 0, traffic.time) || ownLight(0, traffic.time);
    const lightAxis1 = cityLight(traffic.city, 1, traffic.time) || ownLight(1, traffic.time);
    const redAxis0 = lightAxis0 === 'red';
    const redAxis1 = lightAxis1 === 'red';
    const yellowAxis0 = lightAxis0 === 'yellow';
    const yellowAxis1 = lightAxis1 === 'yellow';

    if (firstStep) {
      // The player may have been placed after the traffic was built.
      firstStep = false;
      for (let index = 0; index < cars.length; index += 1) {
        if (Math.hypot(cars[index].root.position.x - playerX, cars[index].root.position.z - playerZ) < PLAYER_NEAR_DISTANCE) {
          const spot = pickSpawn(playerX, playerZ);
          if (spot) place(cars[index], spot.axis, spot.dir, spot.line, spot.coord);
        }
      }
    }

    for (let carIndex = 0; carIndex < cars.length; carIndex += 1) {
      const car = cars[carIndex];
      const trafficState = car.traffic;
      if (!trafficState) continue;
      if (car === carInUse) { trafficState.resume = true; continue; }
      if (trafficState.resume) resumeLane(car);

      const pos = car.root.position;
      const groupDistance = Math.hypot(pos.x - playerX, pos.z - playerZ);
      if (groupDistance > DESPAWN || Math.abs(pos.x) > MAP_EDGE_LIMIT || Math.abs(pos.z) > MAP_EDGE_LIMIT) {
        const spot = pickSpawn(playerX, playerZ);
        if (spot) place(car, spot.axis, spot.dir, spot.line, spot.coord);
        continue;
      }

      const yaw = car.root.rotation.y;
      const forwardX = Math.sin(yaw);
      const forwardZ = Math.cos(yaw);
      const rightX = forwardZ;
      const rightZ = -forwardX;
      const toX = trafficState.target.x - pos.x;
      const toZ = trafficState.target.z - pos.z;
      const targetDistance = Math.hypot(toX, toZ);

      if (targetDistance < ARRIVE_DISTANCE || (targetDistance > trafficState.lastDist + OVERSHOOT_MARGIN && trafficState.lastDist < OVERSHOOT_WINDOW)) {
        advance(car, random);
        trafficState.lastDist = FAR_DISTANCE;
      } else {
        trafficState.lastDist = targetDistance;
      }
      const desired = Math.atan2(trafficState.target.x - pos.x, trafficState.target.z - pos.z);
      const headingError = wrapAngle(desired - car.root.rotation.y);
      const speed = Math.max(0, car.speed || 0);
      const maxTurn = (BASE_TURN_RATE + Math.min(SPEED_TURN_BONUS, speed * TURN_SPEED_FACTOR)) * (LOW_SPEED_TURN_FLOOR + LOW_SPEED_TURN_RANGE * Math.min(1, speed / TURN_SPEED_REF));

      let targetSpeed = trafficState.cruise;
      if (Math.abs(headingError) > CORNER_SLOW_ANGLE) targetSpeed *= CORNER_SLOW_FACTOR;
      if (Math.abs(headingError) > SHARP_TURN_ANGLE) targetSpeed = Math.min(targetSpeed, SHARP_TURN_SPEED);

      // Lights: stop 6 units before the junction, unless already inside it.
      const coord = trafficState.axis === 0 ? pos.x : pos.z;
      const ahead = (trafficState.nextNode - coord) * trafficState.dir;
      const axisRed = trafficState.axis === 0 ? redAxis0 : redAxis1;
      const axisYellow = trafficState.axis === 0 ? yellowAxis0 : yellowAxis1;
      if (ahead > 0 && ahead < LIGHT_APPROACH_DIST) {
        const willStop = axisRed || (axisYellow && ahead > YELLOW_STOP_DIST);
        if (willStop) {
          targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - STOP_LINE_OFFSET) * STOP_SPEED_SCALE));
        }
      }

      // The car ahead in this lane, and the player (on foot or driving).
      let gap = Infinity;
      for (let otherIndex = 0; otherIndex < cars.length; otherIndex += 1) {
        if (otherIndex === carIndex) continue;
        const other = cars[otherIndex].root.position;
        const offsetX = other.x - pos.x;
        const offsetZ = other.z - pos.z;
        const along = offsetX * forwardX + offsetZ * forwardZ;
        if (along <= AHEAD_EPSILON || along > FOLLOW_LOOKAHEAD) continue;
        if (Math.abs(offsetX * rightX + offsetZ * rightZ) > LANE_HALF_WIDTH) continue;
        const clearance = along - (car.length + cars[otherIndex].length) * 0.5 - TAILGATE;
        if (clearance < gap) gap = clearance;
      }
      if (carInUse && carInUse !== car) {
        const offsetX = carInUse.root.position.x - pos.x;
        const offsetZ = carInUse.root.position.z - pos.z;
        const along = offsetX * forwardX + offsetZ * forwardZ;
        if (along > 0 && along < PLAYER_CAR_LOOKAHEAD && Math.abs(offsetX * rightX + offsetZ * rightZ) < PLAYER_CAR_HALF_WIDTH) {
          gap = Math.min(gap, along - PLAYER_CAR_CLEARANCE);
        }
      } else if (!carInUse) {
        const offsetX = playerX - pos.x;
        const offsetZ = playerZ - pos.z;
        const along = offsetX * forwardX + offsetZ * forwardZ;
        if (along > 0 && along < PLAYER_FOOT_LOOKAHEAD && Math.abs(offsetX * rightX + offsetZ * rightZ) < PLAYER_FOOT_HALF_WIDTH) {
          gap = Math.min(gap, along - PLAYER_FOOT_CLEARANCE);
        }
      }
      if (gap < GAP_SLOW_RANGE) targetSpeed = Math.min(targetSpeed, Math.max(0, (gap - GAP_BUFFER) * GAP_SPEED_SCALE));

      if (targetSpeed < BLOCKED_SPEED_THRESHOLD && speed < BLOCKED_CREEP_SPEED) trafficState.blocked += delta;
      else trafficState.blocked = Math.max(0, trafficState.blocked - delta * BLOCKED_DECAY_RATE);
      trafficState.hornCooldown -= delta;
      if (trafficState.blocked > HORN_BLOCKED_SECONDS && trafficState.hornCooldown <= 0) {
        trafficState.hornCooldown = HORN_COOLDOWN_BASE + random() * HORN_COOLDOWN_RANDOM;
        honk();
      }

      car.speed = speed + clamp(targetSpeed - speed, -trafficState.brake * delta, trafficState.accel * delta);
      if (car.speed < 0) car.speed = 0;
      car.root.rotation.y = (car.root.rotation.y + clamp(headingError, -maxTurn * delta, maxTurn * delta)) % (Math.PI * 2);
      const heading = car.root.rotation.y;
      car.velocityX = Math.sin(heading) * car.speed;
      car.velocityZ = Math.cos(heading) * car.speed;
      car.root.position.x += car.velocityX * delta;
      car.root.position.z += car.velocityZ * delta;
      car.root.position.y = CAR_RIDE_HEIGHT;
      car.steerInput = clamp(headingError * STEER_VISUAL_SCALE, -1, 1);
      car.lateralSpeed = 0;
      car.braking = targetSpeed < speed - BRAKE_THRESHOLD;
      animateVehicle(car, delta);
    }

    // Keep the cap, and top the street back up after crashes or hijacks.
    recycleTimer -= delta;
    if (recycleTimer <= 0) {
      recycleTimer = RECYCLE_INTERVAL;
      while (cars.length < MAX_CARS) {
        if (!spawn(playerX, playerZ)) break;
      }
    }
  }

  spawn(0, 0);
  while (cars.length < MAX_CARS) if (!spawn(0, 0)) break;
  registerCars(cars);
  return traffic;
}
