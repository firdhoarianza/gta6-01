// Solara Bay — wanted level, patrol pursuit, roadblocks, air support and arrest.
//
// The chase is deliberately cheap: cars are steered kinematically along the road grid when
// they are far away and switch to direct pursuit (with ramming and PIT nudges) up close.
// `step(dt, pos, player, damageFn)` is called by main.js every frame.
import * as VEHICLES from './vehicles.js';

const TAU = Math.PI * 2;
const ROAD = 34;                 // road centre lines every 34 units
const ROAD_HALF = 5.5;           // half the 11 unit carriageway
const EDGE = 204;                // outermost legal intersection
const ARREST_TIME = 2.5;
const MAX_STARS = 5;
const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
const wrap = (angle) => {
  angle = (angle + Math.PI) % TAU;
  if (angle < 0) angle += TAU;
  return angle - Math.PI;
};
const snapRoad = (coord) => Math.round(coord / ROAD) * ROAD;
const dist2 = (x1, z1, x2, z2) => Math.hypot(x1 - x2, z1 - z2);

const DESIRED_CARS = [0, 2, 3, 5, 7, 9];
const DESIRED_FOOT = [0, 1, 2, 2, 2, 2];

// Wanted-level and dispatch timing.
const CRIME_LOCK_MS = 1100;
const HEAT_LOCK_MS = 1300;
const MAX_HEAT = 4;
const DISPATCH_CAP = 0.4;
const DISPATCH_INTERVAL = 1.35;
const ROADBLOCK_CD_CAP = 4;
const ROADBLOCK_INTERVAL = 24;
const ROADBLOCK_MIN_CD = 8;
const INITIAL_ROADBLOCK_CD = 10;
const MAX_BLOCK_GROUPS = 2;
const BLOCK_DESPAWN_DIST = 150;
const DESPAWN_DISTANCE = 285;
const FOOT_DESPAWN = 160;
const MAX_STEP_DELTA = 0.06;
const PLAYER_SPEED_SMOOTH = 6;
const NEAR_FALLBACK = 9999;
const ARREST_ACTIVE_THRESHOLD = 0.15;
const EVADE_DISPLAY_SECONDS = 2.5;
// Spawning.
const SPAWN_ATTEMPTS = 14;
const SEA_Z_LIMIT = -200;
const UNIT_CROWD_RADIUS = 15;
const BURST_MIN_DIST = 55;
const BURST_MAX_DIST = 95;
const DISPATCH_MIN_DIST = 50;
const DISPATCH_MAX_DIST = 110;
const INITIAL_UNIT_SPEED = 8;
const AGGRESSION_BASE = 0.7;
const AGGRESSION_RANGE = 0.6;
const CAR_RIDE_HEIGHT = 0.55;
const FOOT_PHASE_RANGE = 5;
const FOOT_BASE_SPEED = 3.4;
const FOOT_SPEED_RANGE = 1.2;
const FOOT_FIRE_INITIAL = 1;
const FOOT_SPAWN_ATTEMPTS = 8;
const FOOT_SPAWN_SPREAD = 26;
const FOOT_SPAWN_AHEAD = 14;
const FOOT_SPAWN_DEPTH = 18;
// Roadblocks.
const ROADBLOCK_AHEAD = 82;
const ROADBLOCK_SEA_LIMIT = -198;
const ROADBLOCK_FALLBACK_Z = -170;
const ROADBLOCK_SPACING = 5.4;
const ROADBLOCK_BOUND = 208;
const ROADBLOCK_LIFETIME = 26;
// Helicopter orbit and lights.
const HELI_SPAWN_OFFSET_X = 18;
const HELI_HEIGHT = 30;
const HELI_ORBIT_RADIUS = 23;
const HELI_RADIUS_SWING = 4;
const HELI_RADIUS_RATE = 0.2;
const HELI_HEIGHT_SWING = 2.2;
const HELI_HEIGHT_RATE = 0.6;
const HELI_ANGLE_RATE = 0.34;
const HELI_FOLLOW_RATE = 1.2;
const HELI_VERTICAL_RATE = 0.9;
const HELI_TURN_RATE = 1.5;
const HELI_BANK_RATE = 0.8;
const HELI_BANK_AMOUNT = 0.04;
const ROTOR_SPEED = 26;
const TAIL_ROTOR_SPEED = 32;
const HELI_BLINK_RATE = 2.4;
const SHAFT_BASE_OPACITY = 0.055;
const SHAFT_PULSE_RATE = 3.1;
const SHAFT_PULSE_AMOUNT = 0.02;
const SIREN_RED = 0xff2d3d;
const SIREN_BLUE = 0x3d7bff;
const BEACON_RED_OFF = 0x3a0a0e;
const BEACON_BLUE_OFF = 0x0d2361;
// Patrol car pursuit.
const FAR_PURSUIT_DISTANCE = 44;
const WAYPOINT_REFRESH = 0.55;
const LEAD_DISTANCE = 30;
const LEAD_FACTOR = 0.28;
const PIT_NEAR = 17;
const PIT_FAR = 5;
const PIT_OFFSET = 4.2;
const BASE_TURN_RATE = 2.35;
const TURN_SPEED_REF = 16;
const TURN_FACTOR_MIN = 0.35;
const TURN_FACTOR_MAX = 1.5;
const BASE_CHASE_SPEED = 13;
const SPEED_PER_STAR = 4.6;
const CLOSE_DISTANCE = 26;
const CLOSE_CAR_SPEED = 10;
const CLOSE_CAR_PER_STAR = 3.4;
const CLOSE_FOOT_SPEED = 6.5;
const CORNER_ANGLE = 1.15;
const CORNER_SPEED_FACTOR = 0.58;
const REVERSE_SPEED = -6;
const STUCK_ANGLE = 2.4;
const STUCK_SPEED = 4;
const STUCK_TIME = 1.3;
const REVERSE_BASE = 0.9;
const REVERSE_RANGE = 0.5;
const HEADING_JITTER = 0.8;
const SPEED_SMOOTH_RATE = 2.6;
const UNIT_BOUND = 226;
const BOB_RATE = 0.012;
const BOB_MAX = 0.03;
const BOB_PER_SPEED = 0.001;
const WHEEL_SPIN_FACTOR = 1.4;
const SIREN_FLASH_RATE = 3;
const SIREN_FLASH_OFFSET = 1.5;
const WRECK_SPEED_DECAY = 0.9;
const WRECK_TILT_MAX = 0.25;
const WRECK_TILT_RATE = 0.4;
// Contact damage and shooting.
const RAM_CAR_DIST = 5.4;
const RAM_FOOT_DIST = 4.6;
const RAM_MIN_SPEED = 2;
const RAM_CAR_DAMAGE = 8;
const RAM_FOOT_DAMAGE = 5;
const RAM_SPEED_REF = 18;
const RAM_FACTOR_MIN = 0.3;
const RAM_FACTOR_MAX = 1.6;
const CAR_RAM_DAMAGE = 12;
const SHOOT_DISTANCE = 26;
const SHOOT_MAX_SPEED = 24;
const UNIT_FIRE_BASE = 1.3;
const UNIT_FIRE_RANGE = 0.6;
const SHOOT_DAMAGE_BASE = 3;
const SHOOT_DAMAGE_RANGE = 2.5;
// Foot cops.
const TELEPORT_DISTANCE = 110;
const TELEPORT_SPREAD = 40;
const TELEPORT_AHEAD = 30;
const RUN_PHASE_RATE = 7;
const WALK_PHASE_RATE = 2;
const RUN_DISTANCE_THRESHOLD = 12;
const APPROACH_DISTANCE = 8.5;
const RETREAT_DISTANCE = 5;
const RETREAT_SPEED = 1.2;
const LEG_SWING_AMOUNT = 0.55;
const FOOT_FIRE_DISTANCE = 26;
const FOOT_FIRE_BASE = 1.5;
const FOOT_FIRE_RANGE = 0.8;
const FOOT_DAMAGE_BASE = 4;
const FOOT_DAMAGE_RANGE = 3;
const FOOT_ARREST_DISTANCE = 4.4;
// Crowd avoidance and road guidance.
const CROWD_RADIUS = 8;
const CROWD_MIN_DISTANCE = 0.01;
const CROWD_AHEAD_MIN = 0.2;
const CROWD_STEER_FACTOR = 0.05;
const CROWD_SPEED_DAMP = 0.985;
const BLOCK_LOOKAHEAD = 7;
const BLOCK_MARGIN = 1;
const BLOCK_BOUND_X = 220;
const BLOCK_BOUND_Z = 210;
const BLOCK_STEER_AMOUNT = 0.4;
const ROAD_GUIDE_MARGIN = 2;
const GUIDE_STEP_LIMIT = 24;
// Arrest and evasion.
const ARREST_CAR_DIST = 4.9;
const ARREST_FOOT_DIST = 4.2;
const ARREST_SLOW_SPEED = 3.4;
const ARREST_DECAY_RATE = 1.6;
const ARREST_CAR_DECAY_RATE = 2;
const BUSTED_DURATION = 3;
const SEEN_CAR_DIST = 58;
const SEEN_FOOT_DIST = 48;
const SEEN_HELI_DIST = 78;
const EVADE_DELAY = 5.5;
const HEAT_DECAY_TIME = 7.5;

// Small shared materials — one set per police instance keeps allocations down.
function mat(color, roughness = 0.6, metalness = 0.1) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export function createPolice(scene) {
  const units = [];        // { car, root, heading, speed, wp, ... }
  const foot = [];         // { mesh, heading, phase, fireCd, ... }
  const roadblock = [];    // car objects parked across the road
  const blockGroups = [];  // { cars, until }
  let heli = null;

  let wanted = 0;
  let heat = 0;            // queued escalation from repeat crimes
  let crimeLock = 0;
  let dispatch = 0;
  let roadblockCd = 0;
  let evade = 0;           // seconds since a cop last had eyes on the player
  let decay = 0;
  let arrest = 0;
  let arrestCop = null;
  let busted = 0;
  let tick = 0;
  let lastPlayer = { x: 0, z: 0 };
  let playerSpeed = 0;
  const events = [];

  const sirenMatA = new THREE.MeshBasicMaterial({ color: SIREN_RED });
  const sirenMatB = new THREE.MeshBasicMaterial({ color: SIREN_BLUE });
  const skinMat = mat(0xa97455, 0.85);
  const navyMat = mat(0x1f2f4a, 0.72);
  const vestMat = mat(0x141d2a, 0.55);
  const capMat = mat(0x16233a, 0.6);

  const api = {
    units,
    foot,
    roadblock,
    get heli() { return heli; },
    get stars() { return wanted; },
    set stars(level) {
      level = clamp(Math.round(Number(level) || 0), 0, MAX_STARS);
      if (level === wanted) return;
      const raising = level > wanted;
      wanted = level;
      heat = 0;
      arrest = 0;
      evade = 0;
      decay = 0;
      if (!level) {
        clearAll();
        events.push('HEAT LOST');
      } else {
        dispatch = 0;
        roadblockCd = level >= 3 ? 0 : INITIAL_ROADBLOCK_CD;
        if (raising) events.push(`WANTED LEVEL ${level}`);
        if (level >= 4 && !heli) spawnHeli();
        if (level < 4 && heli) { scene.remove(heli.group); if (heli.target && heli.target.parent) scene.remove(heli.target); heli = null; }
        if (level >= 3) spawnBurst();
      }
    },
    get clock() { return decay; },
    get arrest() { return clamp(arrest / ARREST_TIME, 0, 1); },
    get arresting() { return arrest > ARREST_ACTIVE_THRESHOLD; },
    get busted() { return busted > 0; },
    get evading() { return wanted > 0 && evade > EVADE_DISPLAY_SECONDS; },
    get heat() { return wanted ? clamp((wanted + heat) / MAX_STARS, 0, 1) : 0; },
    get nearest() {
      let nearestDistance = NEAR_FALLBACK;
      for (const unit of units) if (unit.car.hp > 0) nearestDistance = Math.min(nearestDistance, dist2(unit.car.root.position.x, unit.car.root.position.z, lastPlayer.x, lastPlayer.z));
      for (const cop of foot) nearestDistance = Math.min(nearestDistance, dist2(cop.mesh.position.x, cop.mesh.position.z, lastPlayer.x, lastPlayer.z));
      return nearestDistance;
    },
    onArrest: null,
    crime,
    step,
    drainEvents() { return events.splice(0, events.length); },
    clear() { wanted = 0; clearAll(); }
  };

  // ---------------------------------------------------------------- spawning
  function makePoliceCar(positionX, positionZ, heading) {
    let car = null;
    const factory = VEHICLES.makeCarMesh;
    if (typeof factory === 'function') {
      try {
        car = factory('police');
        if (!car || !car.root) car = factory(scene, 'police');
      } catch (error) { car = null; }
    }
    if (!car || !car.root) {
      car = VEHICLES.makeCar(scene, positionX, positionZ, 0xe9e3ce, true, 'police');
    } else if (!car.root.parent) {
      scene.add(car.root);
    }
    car.root.position.set(positionX, CAR_RIDE_HEIGHT, positionZ);
    car.root.rotation.y = heading;
    return car;
  }

  function spawnPoint(playerX, playerZ, minDistance, maxDistance) {
    let best = null;
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const angle = Math.random() * TAU;
      const distance = minDistance + Math.random() * (maxDistance - minDistance);
      const spawnX = clamp(snapRoad(playerX + Math.sin(angle) * distance), -EDGE, EDGE);
      const spawnZ = clamp(snapRoad(playerZ + Math.cos(angle) * distance), -EDGE, EDGE);
      if (spawnZ <= SEA_Z_LIMIT) continue;
      let crowded = false;
      for (const unit of units) if (dist2(unit.car.root.position.x, unit.car.root.position.z, spawnX, spawnZ) < UNIT_CROWD_RADIUS) crowded = true;
      if (crowded) continue;
      best = { x: spawnX, z: spawnZ };
      break;
    }
    return best || { x: clamp(snapRoad(playerX + minDistance), -EDGE, EDGE), z: clamp(snapRoad(playerZ), -EDGE, EDGE) };
  }

  function addUnit(positionX, positionZ, heading) {
    const car = makePoliceCar(positionX, positionZ, heading);
    const unit = {
      car,
      root: car.root,
      heading,
      speed: INITIAL_UNIT_SPEED,
      wp: { x: positionX, z: positionZ },
      wpAt: 0,
      stuck: 0,
      reverse: 0,
      pitSide: Math.random() < 0.5 ? 1 : -1,
      aggression: AGGRESSION_BASE + Math.random() * AGGRESSION_RANGE,
      lit: Math.random() < 0.5
    };
    units.push(unit);
    return unit;
  }

  function spawnBurst() {
    const playerPos = lastPlayer;
    const count = wanted >= 4 ? 3 : 2;
    for (let index = 0; index < count && units.length < DESIRED_CARS[wanted]; index++) {
      const point = spawnPoint(playerPos.x, playerPos.z, BURST_MIN_DIST, BURST_MAX_DIST);
      addUnit(point.x, point.z, Math.atan2(playerPos.x - point.x, playerPos.z - point.z));
    }
  }

  function spawnFootCop(playerX, playerZ) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.62, 3, 7), navyMat);
    body.position.y = 0.86;
    body.castShadow = true;
    group.add(body);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.36), vestMat);
    vest.position.set(0, 0.95, 0.03);
    group.add(vest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 9, 7), skinMat);
    head.position.y = 1.52;
    group.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.25, 0.11, 10), capMat);
    cap.position.y = 1.66;
    cap.rotation.z = Math.PI / 2;
    group.add(cap);
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 3, 5), navyMat);
      leg.position.set(side * 0.15, 0.33, 0);
      group.add(leg);
      legs.push(leg);
    }
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.42), mat(0x1b2126, 0.4, 0.6));
    gun.position.set(0.2, 1.05, 0.3);
    group.add(gun);

    let spawnX = playerX, spawnZ = playerZ;
    for (let attempt = 0; attempt < FOOT_SPAWN_ATTEMPTS; attempt++) {
      spawnX = playerX + (Math.random() - 0.5) * FOOT_SPAWN_SPREAD;
      spawnZ = playerZ + FOOT_SPAWN_AHEAD + Math.random() * FOOT_SPAWN_DEPTH;
      if (spawnZ > SEA_Z_LIMIT) break;
    }
    group.position.set(spawnX, 0, spawnZ);
    scene.add(group);
    foot.push({ mesh: group, body, legs, heading: 0, phase: Math.random() * FOOT_PHASE_RANGE, fireCd: FOOT_FIRE_INITIAL + Math.random(), speed: FOOT_BASE_SPEED + Math.random() * FOOT_SPEED_RANGE });
  }

  function spawnRoadblock(playerX, playerZ, heading) {
    // Put the barricade across the road ahead of the player, perpendicular to travel.
    const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
    let blockX = playerX + forwardX * ROADBLOCK_AHEAD, blockZ = playerZ + forwardZ * ROADBLOCK_AHEAD;
    blockX = snapRoad(blockX);
    blockZ = snapRoad(blockZ);
    if (blockZ < ROADBLOCK_SEA_LIMIT) blockZ = ROADBLOCK_FALLBACK_Z;
    const perpX = Math.cos(heading), perpZ = -Math.sin(heading);
    const group = { cars: [], until: ROADBLOCK_LIFETIME };
    for (let offsetIndex = -1; offsetIndex <= 1; offsetIndex++) {
      const carX = clamp(blockX + perpX * offsetIndex * ROADBLOCK_SPACING, -ROADBLOCK_BOUND, ROADBLOCK_BOUND);
      const carZ = clamp(blockZ + perpZ * offsetIndex * ROADBLOCK_SPACING, -ROADBLOCK_BOUND, ROADBLOCK_BOUND);
      const car = makePoliceCar(carX, carZ, heading + Math.PI / 2);
      car.speed = 0;
      group.cars.push(car);
      roadblock.push(car);
    }
    blockGroups.push(group);
    events.push('ROADBLOCK DEPLOYED');
  }

  function spawnHeli() {
    const group = new THREE.Group();
    const bodyMat = mat(0x22343b, 0.5, 0.35);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 4.1), bodyMat);
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 1.7), mat(0x6f9aa1, 0.25, 0.4));
    cabin.position.set(0, 0.1, 1.15);
    group.add(cabin);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 3.4), bodyMat);
    boom.position.set(0, 0.12, -3.2);
    group.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.9), bodyMat);
    fin.position.set(0, 0.55, -4.6);
    group.add(fin);
    const skids = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 2.8), mat(0x2b3337, 0.6));
    skids.position.y = -0.62;
    group.add(skids);

    const rotor = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.07, 0.36), mat(0x11181c, 0.5, 0.4));
    rotor.position.y = 0.72;
    group.add(rotor);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 6), mat(0x2b3337, 0.6));
    mast.position.y = 0.55;
    group.add(mast);
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 0.24), mat(0x11181c, 0.5, 0.4));
    tailRotor.position.set(0.24, 0.35, -4.6);
    group.add(tailRotor);

    const beaconR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: SIREN_RED }));
    beaconR.position.set(-0.55, 0.55, -0.4);
    group.add(beaconR);
    const beaconB = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: SIREN_BLUE }));
    beaconB.position.set(0.55, 0.55, -0.4);
    group.add(beaconB);

    // Visible search-light shaft plus a real SpotLight that sweeps the street.
    const shaft = new THREE.Mesh(
      new THREE.ConeGeometry(7.5, 32, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2c9, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    shaft.position.y = -16;
    group.add(shaft);

    const light = new THREE.SpotLight(0xfff0c4, 5.5, 90, 0.3, 0.55, 1.1);
    light.position.set(0, -0.4, 0.4);
    const target = new THREE.Object3D();
    scene.add(target);
    light.target = target;
    group.add(light);

    group.position.set(lastPlayer.x + HELI_SPAWN_OFFSET_X, HELI_HEIGHT, lastPlayer.z);
    scene.add(group);
    heli = { group, rotor, tailRotor, light, target, beaconR, beaconB, shaft, angle: Math.random() * TAU };
    events.push('AIR SUPPORT INBOUND');
  }

  function removeCar(car) {
    if (!car || !car.root) return;
    scene.remove(car.root);
    car.root.traverse((object) => {
      if (object.material && object.material.dispose && object.material !== sirenMatA && object.material !== sirenMatB) object.material.dispose();
    });
  }

  function clearAll() {
    for (const unit of units) removeCar(unit.car);
    units.length = 0;
    for (const cop of foot) scene.remove(cop.mesh);
    foot.length = 0;
    for (const car of roadblock) removeCar(car);
    roadblock.length = 0;
    blockGroups.length = 0;
    if (heli) {
      scene.remove(heli.group);
      if (heli.target && heli.target.parent) scene.remove(heli.target);
      heli = null;
    }
    arrest = 0;
    heat = 0;
    evade = 0;
    decay = 0;
  }

  // ---------------------------------------------------------------- wanted logic
  function applyCrime(amount) {
    const before = wanted;
    wanted = clamp(wanted + amount, 0, MAX_STARS);
    dispatch = Math.min(dispatch, DISPATCH_CAP);
    evasionReset();
    if (wanted > before) {
      events.push(`WANTED LEVEL ${wanted}`);
      if (wanted >= 4 && !heli) spawnHeli();
      if (wanted >= 3) {
        roadblockCd = Math.min(roadblockCd, ROADBLOCK_CD_CAP);
        spawnBurst();
      }
    }
  }

  function crime(amount = 1) {
    amount = Math.max(1, Math.round(Number(amount) || 1));
    const now = performance.now();
    if (now < crimeLock) {
      heat = Math.min(MAX_HEAT, heat + amount);
      return wanted;
    }
    applyCrime(amount >= 3 ? 2 : 1);
    heat = Math.max(0, heat + amount - 2);
    crimeLock = now + CRIME_LOCK_MS;
    return wanted;
  }

  function evasionReset() {
    evade = 0;
    decay = 0;
  }

  // ---------------------------------------------------------------- AI helpers
  function roadGuide(positionX, positionZ, playerX, playerZ) {
    // Follow the nearest road toward the player's axis. Cheap but reads as road driving.
    const roadX = snapRoad(positionX), roadZ = snapRoad(positionZ);
    const offX = Math.abs(positionX - roadX), offZ = Math.abs(positionZ - roadZ);
    if (offX > ROAD_HALF + ROAD_GUIDE_MARGIN && offZ > ROAD_HALF + ROAD_GUIDE_MARGIN) {
      // stuck inside a block: head for the nearest tarmac first
      return offX < offZ ? { x: roadX, z: positionZ } : { x: positionX, z: roadZ };
    }
    if (offX <= offZ) {
      // on a north-south road: run along it toward the player
      const deltaZ = playerZ - positionZ;
      return { x: roadX, z: positionZ + clamp(deltaZ, -GUIDE_STEP_LIMIT, GUIDE_STEP_LIMIT) };
    }
    const deltaX = playerX - positionX;
    return { x: positionX + clamp(deltaX, -GUIDE_STEP_LIMIT, GUIDE_STEP_LIMIT), z: roadZ };
  }

  function avoidCrowd(unit, steer) {
    const posX = unit.root.position.x, posZ = unit.root.position.z;
    const forwardX = Math.sin(unit.heading), forwardZ = Math.cos(unit.heading);
    for (const other of units) {
      if (other === unit || other.car.hp <= 0) continue;
      const offsetX = other.root.position.x - posX, offsetZ = other.root.position.z - posZ;
      const distance = Math.hypot(offsetX, offsetZ);
      if (distance > CROWD_RADIUS || distance < CROWD_MIN_DISTANCE) continue;
      const ahead = (offsetX * forwardX + offsetZ * forwardZ) / distance;
      if (ahead < CROWD_AHEAD_MIN) continue;
      const side = Math.sign(offsetX * forwardZ - offsetZ * forwardX) || 1;
      steer -= side * (CROWD_RADIUS - distance) * CROWD_STEER_FACTOR;
      unit.speed *= CROWD_SPEED_DAMP;
    }
    // City blocks are implicit colliders: if a hull is ahead, hug the tarmac.
    const lookX = posX + forwardX * BLOCK_LOOKAHEAD, lookZ = posZ + forwardZ * BLOCK_LOOKAHEAD;
    const inBlock = Math.abs(lookX - snapRoad(lookX)) > ROAD_HALF + BLOCK_MARGIN &&
      Math.abs(lookZ - snapRoad(lookZ)) > ROAD_HALF + BLOCK_MARGIN &&
      Math.abs(lookX) < BLOCK_BOUND_X && Math.abs(lookZ) < BLOCK_BOUND_Z;
    if (inBlock) steer += Math.sign(wrap(Math.atan2(snapRoad(lookX) - lookX, snapRoad(lookZ) - lookZ) - unit.heading)) * BLOCK_STEER_AMOUNT;
    return steer;
  }

  function updateUnit(unit, delta, playerX, playerZ, player, damageFn) {
    const car = unit.car;
    const posX = car.root.position.x, posZ = car.root.position.z;
    const distance = dist2(posX, posZ, playerX, playerZ);

    if (car.hp <= 0) {
      unit.speed *= WRECK_SPEED_DECAY;
      car.root.rotation.z = Math.min(WRECK_TILT_MAX, car.root.rotation.z + delta * WRECK_TILT_RATE);
      return;
    }

    let targetX = playerX, targetZ = playerZ;
    if (distance > FAR_PURSUIT_DISTANCE) {
      unit.wpAt -= delta;
      if (unit.wpAt <= 0) {
        unit.wpAt = WAYPOINT_REFRESH;
        unit.wp = roadGuide(posX, posZ, playerX, playerZ);
      }
      targetX = unit.wp.x;
      targetZ = unit.wp.z;
    } else {
      // lead a moving target and set up PIT angles when close
      if (player.car && distance < LEAD_DISTANCE) {
        const chaseHeading = player.car.root.rotation.y, chaseSpeed = player.car.speed || 0;
        targetX += Math.sin(chaseHeading) * chaseSpeed * LEAD_FACTOR;
        targetZ += Math.cos(chaseHeading) * chaseSpeed * LEAD_FACTOR;
        if (distance < PIT_NEAR && distance > PIT_FAR) {
          const side = unit.pitSide;
          targetX += Math.cos(chaseHeading) * side * PIT_OFFSET;
          targetZ -= Math.sin(chaseHeading) * side * PIT_OFFSET;
        }
      }
    }

    const desiredHeading = Math.atan2(targetX - posX, targetZ - posZ);
    let steer = wrap(desiredHeading - unit.heading);
    steer = avoidCrowd(unit, steer);

    const turnRate = BASE_TURN_RATE * clamp(TURN_FACTOR_MIN + Math.abs(unit.speed) / TURN_SPEED_REF, TURN_FACTOR_MIN, TURN_FACTOR_MAX);
    unit.heading += clamp(steer, -turnRate * delta, turnRate * delta);

    let targetSpeed = BASE_CHASE_SPEED + wanted * SPEED_PER_STAR;
    if (distance < CLOSE_DISTANCE) targetSpeed = player.car ? CLOSE_CAR_SPEED + wanted * CLOSE_CAR_PER_STAR : CLOSE_FOOT_SPEED;
    if (Math.abs(steer) > CORNER_ANGLE) targetSpeed *= CORNER_SPEED_FACTOR;
    if (unit.reverse > 0) {
      unit.reverse -= delta;
      targetSpeed = REVERSE_SPEED;
    }
    targetSpeed *= unit.aggression;

    if (unit.reverse <= 0 && Math.abs(steer) > STUCK_ANGLE && unit.speed > STUCK_SPEED) {
      unit.stuck += delta;
      if (unit.stuck > STUCK_TIME) {
        unit.reverse = REVERSE_BASE + Math.random() * REVERSE_RANGE;
        unit.stuck = 0;
        unit.heading += (Math.random() - 0.5) * HEADING_JITTER;
      }
    } else {
      unit.stuck = Math.max(0, unit.stuck - delta);
    }

    unit.speed += (targetSpeed - unit.speed) * Math.min(1, delta * SPEED_SMOOTH_RATE);
    const nextX = posX + Math.sin(unit.heading) * unit.speed * delta;
    const nextZ = posZ + Math.cos(unit.heading) * unit.speed * delta;
    car.root.position.x = clamp(nextX, -UNIT_BOUND, UNIT_BOUND);
    car.root.position.z = clamp(nextZ, -UNIT_BOUND, UNIT_BOUND);
    car.root.rotation.y = unit.heading;
    car.root.position.y = CAR_RIDE_HEIGHT + Math.sin(performance.now() * BOB_RATE + unit.pitSide) * Math.min(BOB_MAX, Math.abs(unit.speed) * BOB_PER_SPEED);
    for (const wheel of car.wheels || []) wheel.rotation.x += unit.speed * delta * WHEEL_SPIN_FACTOR;

    // Sirens: alternate the roof bar. Cheap, and it sells the chase at night.
    if (car.bar) {
      const phase = ((tick * SIREN_FLASH_RATE + unit.lit * SIREN_FLASH_OFFSET) % 2) < 1;
      car.bar.material.color.copy(phase ? sirenMatA.color : sirenMatB.color);
    }

    // Contact: ram the player's car, or brake and bail out against a pedestrian.
    if (distance < (player.car ? RAM_CAR_DIST : RAM_FOOT_DIST) && unit.speed > RAM_MIN_SPEED) {
      if (typeof damageFn === 'function') damageFn((player.car ? RAM_CAR_DAMAGE : RAM_FOOT_DAMAGE) * delta * clamp(unit.speed / RAM_SPEED_REF, RAM_FACTOR_MIN, RAM_FACTOR_MAX));
      if (player.car && typeof VEHICLES.damageVehicle === 'function') VEHICLES.damageVehicle(player.car, CAR_RAM_DAMAGE * delta);
      if (!player.car && arrestCop === null) arrestCop = unit;
    }

    if (wanted >= 3 && distance < SHOOT_DISTANCE && unit.speed < SHOOT_MAX_SPEED) {
      unit.fireCd = (unit.fireCd || 0) - delta;
      if (unit.fireCd <= 0) {
        unit.fireCd = UNIT_FIRE_BASE + Math.random() * UNIT_FIRE_RANGE;
        if (typeof damageFn === 'function') damageFn(SHOOT_DAMAGE_BASE + Math.random() * SHOOT_DAMAGE_RANGE);
      }
    }
  }

  function updateFoot(cop, delta, playerX, playerZ, player, damageFn) {
    const mesh = cop.mesh;
    const posX = mesh.position.x, posZ = mesh.position.z;
    const distance = dist2(posX, posZ, playerX, playerZ);
    if (distance > TELEPORT_DISTANCE) {
      mesh.position.set(playerX + (Math.random() - 0.5) * TELEPORT_SPREAD, 0, playerZ + TELEPORT_AHEAD);
      return;
    }
    cop.phase += delta * (distance > RUN_DISTANCE_THRESHOLD ? RUN_PHASE_RATE : WALK_PHASE_RATE);
    let moveAmount = 0;
    if (distance > APPROACH_DISTANCE) moveAmount = cop.speed * delta;
    else if (distance < RETREAT_DISTANCE) moveAmount = -RETREAT_SPEED * delta;
    if (moveAmount !== 0) {
      cop.heading = Math.atan2(playerX - posX, playerZ - posZ);
      mesh.position.x += Math.sin(cop.heading) * moveAmount;
      mesh.position.z += Math.cos(cop.heading) * moveAmount;
      mesh.rotation.y = cop.heading;
    }
    const swing = distance > APPROACH_DISTANCE ? Math.sin(cop.phase) * LEG_SWING_AMOUNT : 0;
    if (cop.legs) {
      cop.legs[0].rotation.x = swing;
      cop.legs[1].rotation.x = -swing;
    }
    cop.fireCd -= delta;
    if (distance < FOOT_FIRE_DISTANCE && cop.fireCd <= 0) {
      cop.fireCd = FOOT_FIRE_BASE + Math.random() * FOOT_FIRE_RANGE;
      if (typeof damageFn === 'function') damageFn(FOOT_DAMAGE_BASE + Math.random() * FOOT_DAMAGE_RANGE);
    }
    if (distance < FOOT_ARREST_DISTANCE && arrestCop === null) arrestCop = cop;
  }

  function updateHeli(delta, playerX, playerZ) {
    if (!heli) return;
    heli.angle += delta * HELI_ANGLE_RATE;
    const radius = HELI_ORBIT_RADIUS + Math.sin(tick * HELI_RADIUS_RATE) * HELI_RADIUS_SWING;
    const orbitX = playerX + Math.sin(heli.angle) * radius;
    const orbitZ = playerZ + Math.cos(heli.angle) * radius;
    const group = heli.group;
    group.position.x += (orbitX - group.position.x) * Math.min(1, delta * HELI_FOLLOW_RATE);
    group.position.z += (orbitZ - group.position.z) * Math.min(1, delta * HELI_FOLLOW_RATE);
    group.position.y += (HELI_HEIGHT + Math.sin(tick * HELI_HEIGHT_RATE) * HELI_HEIGHT_SWING - group.position.y) * Math.min(1, delta * HELI_VERTICAL_RATE);
    group.rotation.y += (Math.atan2(playerX - group.position.x, playerZ - group.position.z) - group.rotation.y) * Math.min(1, delta * HELI_TURN_RATE);
    group.rotation.z = Math.sin(tick * HELI_BANK_RATE) * HELI_BANK_AMOUNT;
    heli.rotor.rotation.y += delta * ROTOR_SPEED;
    heli.tailRotor.rotation.x += delta * TAIL_ROTOR_SPEED;
    heli.target.position.set(playerX, 0, playerZ);
    heli.light.target = heli.target;
    const blink = (tick * HELI_BLINK_RATE) % 1 < 0.5;
    heli.beaconR.material.color.setHex(blink ? SIREN_RED : BEACON_RED_OFF);
    heli.beaconB.material.color.setHex(blink ? BEACON_BLUE_OFF : SIREN_BLUE);
    heli.shaft.material.opacity = SHAFT_BASE_OPACITY + Math.sin(tick * SHAFT_PULSE_RATE) * SHAFT_PULSE_AMOUNT;
  }

  // ---------------------------------------------------------------- main step
  function step(delta, pos, player, damageFn) {
    delta = clamp(Number(delta) || 0, 0, MAX_STEP_DELTA);
    if (!pos) return;
    tick += delta;
    if (busted > 0) busted = Math.max(0, busted - delta);

    const playerX = pos.x, playerZ = pos.z;
    if (delta > 0) {
      playerSpeed += (dist2(playerX, playerZ, lastPlayer.x, lastPlayer.z) / delta - playerSpeed) * Math.min(1, delta * PLAYER_SPEED_SMOOTH);
    }
    lastPlayer = { x: playerX, z: playerZ };

    // Queued heat from a burst of crimes promotes one level at a time.
    if (heat > 0 && performance.now() >= crimeLock) {
      const heatStep = Math.min(1, heat);
      heat -= heatStep;
      applyCrime(heatStep);
      crimeLock = performance.now() + HEAT_LOCK_MS;
    }

    if (!wanted) {
      arrest = 0;
      arrestCop = null;
      return;
    }

    if (arrestCop && (!units.includes(arrestCop) && !foot.includes(arrestCop))) arrestCop = null;

    // Dispatch strength and reinforcements.
    dispatch -= delta;
    if (dispatch <= 0) {
      dispatch = DISPATCH_INTERVAL;
      while (units.length < DESIRED_CARS[wanted]) {
        const point = spawnPoint(playerX, playerZ, DISPATCH_MIN_DIST, DISPATCH_MAX_DIST);
        addUnit(point.x, point.z, Math.atan2(playerX - point.x, playerZ - point.z));
      }
      if (foot.length < DESIRED_FOOT[wanted] && wanted <= 3) spawnFootCop(playerX, playerZ);
    }
    if (wanted >= 3) {
      roadblockCd -= delta;
      if (roadblockCd <= 0 && blockGroups.length < MAX_BLOCK_GROUPS) {
        const travel = player.car ? player.car.root.rotation.y : 0;
        spawnRoadblock(playerX, playerZ, travel);
        roadblockCd = ROADBLOCK_INTERVAL;
      }
    } else {
      roadblockCd = Math.max(roadblockCd, ROADBLOCK_MIN_CD);
    }
    if (wanted >= 4 && !heli) spawnHeli();

    for (let unitIndex = units.length - 1; unitIndex >= 0; unitIndex--) {
      const unit = units[unitIndex];
      if (dist2(unit.root.position.x, unit.root.position.z, playerX, playerZ) > DESPAWN_DISTANCE) {
        removeCar(unit.car);
        units.splice(unitIndex, 1);
        continue;
      }
      updateUnit(unit, delta, playerX, playerZ, player, damageFn);
    }
    for (let copIndex = foot.length - 1; copIndex >= 0; copIndex--) {
      const cop = foot[copIndex];
      updateFoot(cop, delta, playerX, playerZ, player, damageFn);
      if (dist2(cop.mesh.position.x, cop.mesh.position.z, playerX, playerZ) > FOOT_DESPAWN) {
        scene.remove(cop.mesh);
        foot.splice(copIndex, 1);
      }
    }
    updateHeli(delta, playerX, playerZ);

    // Roadblocks expire or are left behind.
    for (let groupIndex = blockGroups.length - 1; groupIndex >= 0; groupIndex--) {
      const blockGroup = blockGroups[groupIndex];
      blockGroup.until -= delta;
      const centerX = blockGroup.cars[1] ? blockGroup.cars[1].root.position.x : playerX;
      const centerZ = blockGroup.cars[1] ? blockGroup.cars[1].root.position.z : playerZ;
      if (blockGroup.until <= 0 || dist2(centerX, centerZ, playerX, playerZ) > BLOCK_DESPAWN_DIST) {
        for (const car of blockGroup.cars) {
          const blockIndex = roadblock.indexOf(car);
          if (blockIndex >= 0) roadblock.splice(blockIndex, 1);
          removeCar(car);
        }
        blockGroups.splice(groupIndex, 1);
      }
    }

    // Anyone touching the player keeps the arrest timer alive.
    if (!player.car) {
      const nearCar = units.find((unit) => unit.car.hp > 0 && dist2(unit.root.position.x, unit.root.position.z, playerX, playerZ) < ARREST_CAR_DIST);
      const nearFoot = foot.find((cop) => dist2(cop.mesh.position.x, cop.mesh.position.z, playerX, playerZ) < ARREST_FOOT_DIST);
      const isSlow = playerSpeed < ARREST_SLOW_SPEED || player.crouch;
      if ((nearCar || nearFoot) && isSlow && wanted > 0) {
        arrest += delta;
      } else {
        arrest = Math.max(0, arrest - delta * ARREST_DECAY_RATE);
      }
      if (arrest >= ARREST_TIME) {
        arrest = 0;
        busted = BUSTED_DURATION;
        events.push('BUSTED');
        const callback = api.onArrest;
        if (typeof callback === 'function') {
          callback({ player, police: api });
        } else {
          if (player) player.wanted = 0;
          wanted = 0;
          clearAll();
        }
      }
    } else {
      arrest = Math.max(0, arrest - delta * ARREST_CAR_DECAY_RATE);
    }

    // Breaking line of sight: stay out of everyone's range and the heat cools a level at a time.
    let seen = false;
    for (const unit of units) if (unit.car.hp > 0 && dist2(unit.root.position.x, unit.root.position.z, playerX, playerZ) < SEEN_CAR_DIST) seen = true;
    for (const cop of foot) if (dist2(cop.mesh.position.x, cop.mesh.position.z, playerX, playerZ) < SEEN_FOOT_DIST) seen = true;
    if (heli && dist2(heli.group.position.x, heli.group.position.z, playerX, playerZ) < SEEN_HELI_DIST) seen = true;
    if (seen) {
      evade = 0;
      decay = 0;
    } else {
      evade += delta;
      if (evade > EVADE_DELAY) {
        decay += delta;
        if (decay > HEAT_DECAY_TIME) {
          decay = 0;
          wanted = Math.max(0, wanted - 1);
          if (wanted === 0) {
            clearAll();
            events.push('HEAT LOST');
          } else {
            if (wanted < 4 && heli) { scene.remove(heli.group); if (heli.target && heli.target.parent) scene.remove(heli.target); heli = null; }
            events.push(`WANTED LEVEL ${wanted}`);
          }
        }
      }
    }
  }

  return api;
}
