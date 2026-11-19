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
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
const snapRoad = (v) => Math.round(v / ROAD) * ROAD;
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

const DESIRED_CARS = [0, 2, 3, 5, 7, 9];
const DESIRED_FOOT = [0, 1, 2, 2, 2, 2];

// Small shared materials — one set per police instance keeps allocations down.
function mat(color, rough = 0.6, metal = 0.1) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
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

  const sirenMatA = new THREE.MeshBasicMaterial({ color: 0xff2d3d });
  const sirenMatB = new THREE.MeshBasicMaterial({ color: 0x3d7bff });
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
    set stars(n) {
      n = clamp(Math.round(Number(n) || 0), 0, 5);
      if (n === wanted) return;
      const up = n > wanted;
      wanted = n;
      heat = 0;
      arrest = 0;
      evade = 0;
      decay = 0;
      if (!n) {
        clearAll();
        events.push('HEAT LOST');
      } else {
        dispatch = 0;
        roadblockCd = n >= 3 ? 0 : 10;
        if (up) events.push(`WANTED LEVEL ${n}`);
        if (n >= 4 && !heli) spawnHeli();
        if (n < 4 && heli) { scene.remove(heli.group); if (heli.target && heli.target.parent) scene.remove(heli.target); heli = null; }
        if (n >= 3) spawnBurst();
      }
    },
    get clock() { return decay; },
    get arrest() { return clamp(arrest / ARREST_TIME, 0, 1); },
    get arresting() { return arrest > 0.15; },
    get busted() { return busted > 0; },
    get evading() { return wanted > 0 && evade > 2.5; },
    get heat() { return wanted ? clamp((wanted + heat) / 5, 0, 1) : 0; },
    get nearest() {
      let best = 9999;
      for (const u of units) if (u.car.hp > 0) best = Math.min(best, dist2(u.car.root.position.x, u.car.root.position.z, lastPlayer.x, lastPlayer.z));
      for (const f of foot) best = Math.min(best, dist2(f.mesh.position.x, f.mesh.position.z, lastPlayer.x, lastPlayer.z));
      return best;
    },
    onArrest: null,
    crime,
    step,
    drainEvents() { return events.splice(0, events.length); },
    clear() { wanted = 0; clearAll(); }
  };

  // ---------------------------------------------------------------- spawning
  function makePoliceCar(x, z, heading) {
    let car = null;
    const factory = VEHICLES.makeCarMesh;
    if (typeof factory === 'function') {
      try {
        car = factory('police');
        if (!car || !car.root) car = factory(scene, 'police');
      } catch (err) { car = null; }
    }
    if (!car || !car.root) {
      car = VEHICLES.makeCar(scene, x, z, 0xe9e3ce, true, 'police');
    } else if (!car.root.parent) {
      scene.add(car.root);
    }
    car.root.position.set(x, 0.55, z);
    car.root.rotation.y = heading;
    return car;
  }

  function spawnPoint(px, pz, minD, maxD) {
    let best = null;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU;
      const r = minD + Math.random() * (maxD - minD);
      const x = clamp(snapRoad(px + Math.sin(a) * r), -EDGE, EDGE);
      const z = clamp(snapRoad(pz + Math.cos(a) * r), -EDGE, EDGE);
      if (z <= -200) continue;
      let crowded = false;
      for (const u of units) if (dist2(u.car.root.position.x, u.car.root.position.z, x, z) < 15) crowded = true;
      if (crowded) continue;
      best = { x, z };
      break;
    }
    return best || { x: clamp(snapRoad(px + minD), -EDGE, EDGE), z: clamp(snapRoad(pz), -EDGE, EDGE) };
  }

  function addUnit(x, z, heading) {
    const car = makePoliceCar(x, z, heading);
    const unit = {
      car,
      root: car.root,
      heading,
      speed: 8,
      wp: { x, z },
      wpAt: 0,
      stuck: 0,
      reverse: 0,
      pitSide: Math.random() < 0.5 ? 1 : -1,
      aggression: 0.7 + Math.random() * 0.6,
      lit: Math.random() < 0.5
    };
    units.push(unit);
    return unit;
  }

  function spawnBurst() {
    const p = lastPlayer;
    const count = wanted >= 4 ? 3 : 2;
    for (let i = 0; i < count && units.length < DESIRED_CARS[wanted]; i++) {
      const pt = spawnPoint(p.x, p.z, 55, 95);
      addUnit(pt.x, pt.z, Math.atan2(p.x - pt.x, p.z - pt.z));
    }
  }

  function spawnFootCop(px, pz) {
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

    let x = px, z = pz;
    for (let i = 0; i < 8; i++) {
      x = px + (Math.random() - 0.5) * 26;
      z = pz + 14 + Math.random() * 18;
      if (z > -200) break;
    }
    group.position.set(x, 0, z);
    scene.add(group);
    foot.push({ mesh: group, body, legs, heading: 0, phase: Math.random() * 5, fireCd: 1 + Math.random(), speed: 3.4 + Math.random() * 1.2 });
  }

  function spawnRoadblock(px, pz, heading) {
    // Put the barricade across the road ahead of the player, perpendicular to travel.
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let bx = px + fx * 82, bz = pz + fz * 82;
    bx = snapRoad(bx);
    bz = snapRoad(bz);
    if (bz < -198) bz = -170;
    const perpX = Math.cos(heading), perpZ = -Math.sin(heading);
    const group = { cars: [], until: 26 };
    for (let i = -1; i <= 1; i++) {
      const x = clamp(bx + perpX * i * 5.4, -208, 208);
      const z = clamp(bz + perpZ * i * 5.4, -208, 208);
      const car = makePoliceCar(x, z, heading + Math.PI / 2);
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

    const beaconR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff2d3d }));
    beaconR.position.set(-0.55, 0.55, -0.4);
    group.add(beaconR);
    const beaconB = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: 0x3d7bff }));
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

    group.position.set(lastPlayer.x + 18, 30, lastPlayer.z);
    scene.add(group);
    heli = { group, rotor, tailRotor, light, target, beaconR, beaconB, shaft, angle: Math.random() * TAU };
    events.push('AIR SUPPORT INBOUND');
  }

  function removeCar(car) {
    if (!car || !car.root) return;
    scene.remove(car.root);
    car.root.traverse((o) => {
      if (o.material && o.material.dispose && o.material !== sirenMatA && o.material !== sirenMatB) o.material.dispose();
    });
  }

  function clearAll() {
    for (const u of units) removeCar(u.car);
    units.length = 0;
    for (const f of foot) scene.remove(f.mesh);
    foot.length = 0;
    for (const c of roadblock) removeCar(c);
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
  function applyCrime(n) {
    const before = wanted;
    wanted = clamp(wanted + n, 0, 5);
    dispatch = Math.min(dispatch, 0.4);
    evasionReset();
    if (wanted > before) {
      events.push(`WANTED LEVEL ${wanted}`);
      if (wanted >= 4 && !heli) spawnHeli();
      if (wanted >= 3) {
        roadblockCd = Math.min(roadblockCd, 4);
        spawnBurst();
      }
    }
  }

  function crime(n = 1) {
    n = Math.max(1, Math.round(Number(n) || 1));
    const now = performance.now();
    if (now < crimeLock) {
      heat = Math.min(4, heat + n);
      return wanted;
    }
    applyCrime(n >= 3 ? 2 : 1);
    heat = Math.max(0, heat + n - 2);
    crimeLock = now + 1100;
    return wanted;
  }

  function evasionReset() {
    evade = 0;
    decay = 0;
  }

  // ---------------------------------------------------------------- AI helpers
  function roadGuide(x, z, px, pz) {
    // Follow the nearest road toward the player's axis. Cheap but reads as road driving.
    const rx = snapRoad(x), rz = snapRoad(z);
    const offX = Math.abs(x - rx), offZ = Math.abs(z - rz);
    if (offX > ROAD_HALF + 2 && offZ > ROAD_HALF + 2) {
      // stuck inside a block: head for the nearest tarmac first
      return offX < offZ ? { x: rx, z } : { x, z: rz };
    }
    if (offX <= offZ) {
      // on a north-south road: run along it toward the player
      const dz = pz - z;
      return { x: rx, z: z + clamp(dz, -24, 24) };
    }
    const dx = px - x;
    return { x: x + clamp(dx, -24, 24), z: rz };
  }

  function avoidCrowd(unit, steer) {
    const x = unit.root.position.x, z = unit.root.position.z;
    const fx = Math.sin(unit.heading), fz = Math.cos(unit.heading);
    for (const other of units) {
      if (other === unit || other.car.hp <= 0) continue;
      const dx = other.root.position.x - x, dz = other.root.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > 8 || d < 0.01) continue;
      const ahead = (dx * fx + dz * fz) / d;
      if (ahead < 0.2) continue;
      const side = Math.sign(dx * fz - dz * fx) || 1;
      steer -= side * (8 - d) * 0.05;
      unit.speed *= 0.985;
    }
    // City blocks are implicit colliders: if a hull is ahead, hug the tarmac.
    const lookX = x + fx * 7, lookZ = z + fz * 7;
    const inBlock = Math.abs(lookX - snapRoad(lookX)) > ROAD_HALF + 1 &&
      Math.abs(lookZ - snapRoad(lookZ)) > ROAD_HALF + 1 &&
      Math.abs(lookX) < 220 && Math.abs(lookZ) < 210;
    if (inBlock) steer += Math.sign(wrap(Math.atan2(snapRoad(lookX) - lookX, snapRoad(lookZ) - lookZ) - unit.heading)) * 0.4;
    return steer;
  }

  function updateUnit(unit, dt, px, pz, player, damageFn) {
    const car = unit.car;
    const x = car.root.position.x, z = car.root.position.z;
    const d = dist2(x, z, px, pz);

    if (car.hp <= 0) {
      unit.speed *= 0.9;
      car.root.rotation.z = Math.min(0.25, car.root.rotation.z + dt * 0.4);
      return;
    }

    let tx = px, tz = pz;
    if (d > 44) {
      unit.wpAt -= dt;
      if (unit.wpAt <= 0) {
        unit.wpAt = 0.55;
        unit.wp = roadGuide(x, z, px, pz);
      }
      tx = unit.wp.x;
      tz = unit.wp.z;
    } else {
      // lead a moving target and set up PIT angles when close
      if (player.car && d < 30) {
        const ch = player.car.root.rotation.y, cs = player.car.speed || 0;
        tx += Math.sin(ch) * cs * 0.28;
        tz += Math.cos(ch) * cs * 0.28;
        if (d < 17 && d > 5) {
          const side = unit.pitSide;
          tx += Math.cos(ch) * side * 4.2;
          tz -= Math.sin(ch) * side * 4.2;
        }
      }
    }

    const want = Math.atan2(tx - x, tz - z);
    let steer = wrap(want - unit.heading);
    steer = avoidCrowd(unit, steer);

    const turnRate = 2.35 * clamp(0.35 + Math.abs(unit.speed) / 16, 0.35, 1.5);
    unit.heading += clamp(steer, -turnRate * dt, turnRate * dt);

    let target = 13 + wanted * 4.6;
    if (d < 26) target = player.car ? 10 + wanted * 3.4 : 6.5;
    if (Math.abs(steer) > 1.15) target *= 0.58;
    if (unit.reverse > 0) {
      unit.reverse -= dt;
      target = -6;
    }
    target *= unit.aggression;

    if (unit.reverse <= 0 && Math.abs(steer) > 2.4 && unit.speed > 4) {
      unit.stuck += dt;
      if (unit.stuck > 1.3) {
        unit.reverse = 0.9 + Math.random() * 0.5;
        unit.stuck = 0;
        unit.heading += (Math.random() - 0.5) * 0.8;
      }
    } else {
      unit.stuck = Math.max(0, unit.stuck - dt);
    }

    unit.speed += (target - unit.speed) * Math.min(1, dt * 2.6);
    const nx = x + Math.sin(unit.heading) * unit.speed * dt;
    const nz = z + Math.cos(unit.heading) * unit.speed * dt;
    car.root.position.x = clamp(nx, -226, 226);
    car.root.position.z = clamp(nz, -226, 226);
    car.root.rotation.y = unit.heading;
    car.root.position.y = 0.55 + Math.sin(performance.now() * 0.012 + unit.pitSide) * Math.min(0.03, Math.abs(unit.speed) * 0.001);
    for (const wheel of car.wheels || []) wheel.rotation.x += unit.speed * dt * 1.4;

    // Sirens: alternate the roof bar. Cheap, and it sells the chase at night.
    if (car.bar) {
      const phase = ((tick * 3 + unit.lit * 1.5) % 2) < 1;
      car.bar.material.color.copy(phase ? sirenMatA.color : sirenMatB.color);
    }

    // Contact: ram the player's car, or brake and bail out against a pedestrian.
    if (d < (player.car ? 5.4 : 4.6) && unit.speed > 2) {
      if (typeof damageFn === 'function') damageFn((player.car ? 8 : 5) * dt * clamp(unit.speed / 18, 0.3, 1.6));
      if (player.car && typeof VEHICLES.damageVehicle === 'function') VEHICLES.damageVehicle(player.car, 12 * dt);
      if (!player.car && arrestCop === null) arrestCop = unit;
    }

    if (wanted >= 3 && d < 26 && unit.speed < 24) {
      unit.fireCd = (unit.fireCd || 0) - dt;
      if (unit.fireCd <= 0) {
        unit.fireCd = 1.3 + Math.random() * 0.6;
        if (typeof damageFn === 'function') damageFn(3 + Math.random() * 2.5);
      }
    }
  }

  function updateFoot(cop, dt, px, pz, player, damageFn) {
    const mesh = cop.mesh;
    const x = mesh.position.x, z = mesh.position.z;
    const d = dist2(x, z, px, pz);
    if (d > 110) {
      mesh.position.set(px + (Math.random() - 0.5) * 40, 0, pz + 30);
      return;
    }
    cop.phase += dt * (d > 12 ? 7 : 2);
    let step = 0;
    if (d > 8.5) step = cop.speed * dt;
    else if (d < 5) step = -1.2 * dt;
    if (step !== 0) {
      cop.heading = Math.atan2(px - x, pz - z);
      mesh.position.x += Math.sin(cop.heading) * step;
      mesh.position.z += Math.cos(cop.heading) * step;
      mesh.rotation.y = cop.heading;
    }
    const swing = d > 8.5 ? Math.sin(cop.phase) * 0.55 : 0;
    if (cop.legs) {
      cop.legs[0].rotation.x = swing;
      cop.legs[1].rotation.x = -swing;
    }
    cop.fireCd -= dt;
    if (d < 26 && cop.fireCd <= 0) {
      cop.fireCd = 1.5 + Math.random() * 0.8;
      if (typeof damageFn === 'function') damageFn(4 + Math.random() * 3);
    }
    if (d < 4.4 && arrestCop === null) arrestCop = cop;
  }

  function updateHeli(dt, px, pz) {
    if (!heli) return;
    heli.angle += dt * 0.34;
    const radius = 23 + Math.sin(tick * 0.2) * 4;
    const x = px + Math.sin(heli.angle) * radius;
    const z = pz + Math.cos(heli.angle) * radius;
    const g = heli.group;
    g.position.x += (x - g.position.x) * Math.min(1, dt * 1.2);
    g.position.z += (z - g.position.z) * Math.min(1, dt * 1.2);
    g.position.y += (30 + Math.sin(tick * 0.6) * 2.2 - g.position.y) * Math.min(1, dt * 0.9);
    g.rotation.y += (Math.atan2(px - g.position.x, pz - g.position.z) - g.rotation.y) * Math.min(1, dt * 1.5);
    g.rotation.z = Math.sin(tick * 0.8) * 0.04;
    heli.rotor.rotation.y += dt * 26;
    heli.tailRotor.rotation.x += dt * 32;
    heli.target.position.set(px, 0, pz);
    heli.light.target = heli.target;
    const blink = (tick * 2.4) % 1 < 0.5;
    heli.beaconR.material.color.setHex(blink ? 0xff2d3d : 0x3a0a0e);
    heli.beaconB.material.color.setHex(blink ? 0x0d2361 : 0x3d7bff);
    heli.shaft.material.opacity = 0.055 + Math.sin(tick * 3.1) * 0.02;
  }

  // ---------------------------------------------------------------- main step
  function step(dt, pos, player, damageFn) {
    dt = clamp(Number(dt) || 0, 0, 0.06);
    if (!pos) return;
    tick += dt;
    if (busted > 0) busted = Math.max(0, busted - dt);

    const px = pos.x, pz = pos.z;
    if (dt > 0) {
      playerSpeed += (dist2(px, pz, lastPlayer.x, lastPlayer.z) / dt - playerSpeed) * Math.min(1, dt * 6);
    }
    lastPlayer = { x: px, z: pz };

    // Queued heat from a burst of crimes promotes one level at a time.
    if (heat > 0 && performance.now() >= crimeLock) {
      const add = Math.min(1, heat);
      heat -= add;
      applyCrime(add);
      crimeLock = performance.now() + 1300;
    }

    if (!wanted) {
      arrest = 0;
      arrestCop = null;
      return;
    }

    if (arrestCop && (!units.includes(arrestCop) && !foot.includes(arrestCop))) arrestCop = null;

    // Dispatch strength and reinforcements.
    dispatch -= dt;
    if (dispatch <= 0) {
      dispatch = 1.35;
      while (units.length < DESIRED_CARS[wanted]) {
        const pt = spawnPoint(px, pz, 50, 110);
        addUnit(pt.x, pt.z, Math.atan2(px - pt.x, pz - pt.z));
      }
      if (foot.length < DESIRED_FOOT[wanted] && wanted <= 3) spawnFootCop(px, pz);
    }
    if (wanted >= 3) {
      roadblockCd -= dt;
      if (roadblockCd <= 0 && blockGroups.length < 2) {
        const travel = player.car ? player.car.root.rotation.y : 0;
        spawnRoadblock(px, pz, travel);
        roadblockCd = 24;
      }
    } else {
      roadblockCd = Math.max(roadblockCd, 8);
    }
    if (wanted >= 4 && !heli) spawnHeli();

    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (dist2(u.root.position.x, u.root.position.z, px, pz) > 285) {
        removeCar(u.car);
        units.splice(i, 1);
        continue;
      }
      updateUnit(u, dt, px, pz, player, damageFn);
    }
    for (let i = foot.length - 1; i >= 0; i--) {
      const f = foot[i];
      updateFoot(f, dt, px, pz, player, damageFn);
      if (dist2(f.mesh.position.x, f.mesh.position.z, px, pz) > 160) {
        scene.remove(f.mesh);
        foot.splice(i, 1);
      }
    }
    updateHeli(dt, px, pz);

    // Roadblocks expire or are left behind.
    for (let i = blockGroups.length - 1; i >= 0; i--) {
      const g = blockGroups[i];
      g.until -= dt;
      const cx = g.cars[1] ? g.cars[1].root.position.x : px;
      const cz = g.cars[1] ? g.cars[1].root.position.z : pz;
      if (g.until <= 0 || dist2(cx, cz, px, pz) > 150) {
        for (const car of g.cars) {
          const idx = roadblock.indexOf(car);
          if (idx >= 0) roadblock.splice(idx, 1);
          removeCar(car);
        }
        blockGroups.splice(i, 1);
      }
    }

    // Anyone touching the player keeps the arrest timer alive.
    if (!player.car) {
      const nearCar = units.find((u) => u.car.hp > 0 && dist2(u.root.position.x, u.root.position.z, px, pz) < 4.9);
      const nearFoot = foot.find((f) => dist2(f.mesh.position.x, f.mesh.position.z, px, pz) < 4.2);
      const slow = playerSpeed < 3.4 || player.crouch;
      if ((nearCar || nearFoot) && slow && wanted > 0) {
        arrest += dt;
      } else {
        arrest = Math.max(0, arrest - dt * 1.6);
      }
      if (arrest >= ARREST_TIME) {
        arrest = 0;
        busted = 3;
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
      arrest = Math.max(0, arrest - dt * 2);
    }

    // Breaking line of sight: stay out of everyone's range and the heat cools a level at a time.
    let seen = false;
    for (const u of units) if (u.car.hp > 0 && dist2(u.root.position.x, u.root.position.z, px, pz) < 58) seen = true;
    for (const f of foot) if (dist2(f.mesh.position.x, f.mesh.position.z, px, pz) < 48) seen = true;
    if (heli && dist2(heli.group.position.x, heli.group.position.z, px, pz) < 78) seen = true;
    if (seen) {
      evade = 0;
      decay = 0;
    } else {
      evade += dt;
      if (evade > 5.5) {
        decay += dt;
        if (decay > 7.5) {
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