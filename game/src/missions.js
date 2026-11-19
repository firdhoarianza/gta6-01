// Solara Bay — the nine jobs from config.js, staged as multi-step scripts.
//
// main.js still drives the basics: `advance()` skips to the next job, `complete()` finishes the
// current step (so pressing E on a marker always works), and `marker` is the torus main.js checks
// against. The step engine lives in `update(dt, player, police)`, which the HUD calls every frame,
// and adds timers, kill counters, vehicle conditions, fail/retry and a mission log on top.
import { MISSIONS } from './config.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Road intersections are every 34 units; most waypoints sit on or just off one.
const L = {
  pelican: [-42, -42],
  lockup: [-102, -34],
  docks: [-170, -34],
  marina: [68, -204],
  marinaOffice: [102, -170],
  rooftop: [102, -204],
  downtown: [34, 34],
  harbor: [136, -34],
  port: [170, -34],
  freight: [170, 34],
  warehouse: [102, 136],
  suburbs: [68, 170],
  causeway: [-34, -204],
  breakwater: [-68, -204],
  taxiStand: [17, 17],
  scenic: [102, 68],
  package: [0, 102],
  coldDrop: [-170, -136],
  rampage: [-34, 34]
};

const REWARDS = [450, 650, 820, 950, 1300, 2600, 320, 430, 700];

// One line per step in the HUD's pip strip; `time` is a step timer in seconds.
const SCRIPTS = [
  // 01 · FIRST LIGHT — meet the fixer, find the lock-up, steal and deliver a car.
  { steps: [
    { type: 'goto', label: 'MEET NICO AT THE PELICAN MOTEL', at: L.pelican, r: 9 },
    { type: 'goto', label: "FOLLOW NICO'S LEAD TO THE LOCK-UP", at: L.lockup, r: 9 },
    { type: 'steal', label: 'TAKE THE COUPE OFF THE LOT', at: [-136, -68], r: 12, car: true },
    { type: 'deliver', label: 'RUN THE COUPE TO THE DOCKS', at: L.docks, r: 12, car: true }
  ] },
  // 02 · SALT IN THE AIR — marina pickup, dock patrol, return the bag.
  { steps: [
    { type: 'goto', label: 'GET DOWN TO THE MARINA', at: L.marina, r: 10 },
    { type: 'goto', label: 'FIND THE COURIER BAG IN THE DOCK OFFICE', at: L.marinaOffice, r: 8 },
    { type: 'escape', label: 'SHAKE THE DOCK PATROL', at: L.marinaOffice, level: 2 },
    { type: 'deliver', label: 'RETURN THE BAG TO NICO', at: L.pelican, r: 10 }
  ] },
  // 03 · GLASS HARBOR — timed coupe run through downtown, paint must survive.
  { steps: [
    { type: 'steal', label: 'TAKE THE MARKED COUPE FROM THE VALET', at: L.downtown, r: 11, car: true },
    { type: 'goto', label: 'CLEAR THE HARBOR OVERPASS', at: [68, 34], r: 10, car: true, time: 26 },
    { type: 'goto', label: 'CUT THROUGH THE GLASS TOWERS', at: [68, -34], r: 10, car: true, time: 26 },
    { type: 'deliver', label: 'DELIVER IT WITHOUT A SCRATCH', at: L.harbor, r: 12, car: true, time: 30, paint: true }
  ] },
  // 04 · NIGHT FREIGHT — port yard, truck theft, timed warehouse run, hand-off.
  { steps: [
    { type: 'goto', label: 'MEET THE FREIGHT CREW AT THE YARD', at: L.freight, r: 10 },
    { type: 'steal', label: 'STEAL THE FREIGHT TRUCK FROM THE PORT', at: L.port, r: 12, car: true },
    { type: 'deliver', label: 'RUN THE CRATE TO THE SUBURB WAREHOUSE', at: L.warehouse, r: 13, car: true, time: 85 },
    { type: 'deliver', label: 'HAND OFF THE CRATE', at: L.suburbs, r: 10, car: true }
  ] },
  // 05 · LOW TIDE — causeway confrontation, crew fight, response, escape.
  { steps: [
    { type: 'goto', label: 'MEET THE CREW AT THE OLD CAUSEWAY', at: L.causeway, r: 10 },
    { type: 'kill', label: 'CLEAR THE BREAKWATER CREW', at: L.breakwater, r: 24, count: 5 },
    { type: 'survive', label: 'SURVIVE THE RESPONSE', at: L.breakwater, time: 40, level: 3 },
    { type: 'escape', label: 'LOSE THE HEAT', at: L.breakwater, level: 3 }
  ] },
  // 06 · LAST LIGHT — rooftop meet, Nico's crew, escape the city.
  { steps: [
    { type: 'goto', label: 'MEET NICO ABOVE THE MARINA', at: L.marina, r: 9 },
    { type: 'goto', label: 'GET TO THE ROOFTOP STAIR', at: L.rooftop, r: 8 },
    { type: 'kill', label: "CLEAR NICO'S CREW", at: L.rooftop, r: 26, count: 8 },
    { type: 'escape', label: 'LEAVE SOLARA BAY BEHIND', at: L.rooftop, level: 3 }
  ] },
  // SIDE · TAXI FARE — pick up, scenic stop, timed drop.
  { steps: [
    { type: 'steal', label: 'PICK UP THE FARE DOWNTOWN', at: L.taxiStand, r: 10, car: true },
    { type: 'goto', label: 'TAKE THE SCENIC ROUTE', at: L.scenic, r: 11, car: true, time: 35 },
    { type: 'deliver', label: 'DROP THEM IN THE SUBURBS', at: L.suburbs, r: 12, car: true, time: 45 }
  ] },
  // SIDE · HOT PACKAGE — pickup, timed cross-town run, lose the tail.
  { steps: [
    { type: 'goto', label: 'COLLECT THE SEALED PACKAGE', at: L.package, r: 9 },
    { type: 'deliver', label: 'DELIVER IT BEFORE IT COOLS', at: L.coldDrop, r: 12, car: true, time: 75 },
    { type: 'escape', label: 'LOSE THE TAIL', at: L.coldDrop, level: 1 }
  ] },
  // SIDE · RAMPAGE — start trouble, drop ten targets, survive the response.
  { steps: [
    { type: 'goto', label: 'START SOMETHING DOWNTOWN', at: L.rampage, r: 10 },
    { type: 'kill', label: 'DROP TEN TARGETS', at: L.rampage, r: 28, count: 10, time: 90, level: 3 },
    { type: 'escape', label: 'SURVIVE THE RESPONSE', at: L.rampage, level: 3 }
  ] }
];

const STATUS_ACTIVE = 'ACTIVE';
const STATUS_DONE = 'COMPLETE';
const STATUS_FAIL = 'FAILED';

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createMissions(scene) {
  let index = 0;
  let step = 0;
  let steps = [];
  let cur = null;
  let state = STATUS_ACTIVE;
  let done = false;
  let timeLeft = null;
  let timeTotal = 0;
  let failReason = '';
  let failTimer = 0;
  let elapsed = 0;
  let pendingWanted = 0;
  let lastStepAt = 0;
  const logs = [];
  const events = [];
  const view = ['', '', ''];

  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.95 });
  const marker = new THREE.Mesh(new THREE.TorusGeometry(3, 0.24, 8, 36), markerMat);
  marker.rotation.x = Math.PI / 2;
  marker.position.set(L.pelican[0], 0.45, L.pelican[1]);
  scene.add(marker);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.25, 3.75, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd79a, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);

  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshBasicMaterial({ color: 0xffe0a3, transparent: true, opacity: 0.9 })
  );
  beacon.position.y = 3.6;
  marker.add(beacon);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 1.1, 8, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.set(L.pelican[0], 4, L.pelican[1]);
  scene.add(beam);

  function emit(text) { events.push(text); }

  function cleanupCrew(target) {
    if (!target || !target._crew) return;
    const actors = window.SOLARA && window.SOLARA.actors;
    for (const person of target._crew) {
      if (!person) continue;
      if (person.mesh) scene.remove(person.mesh);
      if (actors && Array.isArray(actors.people)) {
        const at = actors.people.indexOf(person);
        if (at >= 0) actors.people.splice(at, 1);
      }
    }
    target._crew = null;
  }

  function placeMarker(at) {
    if (!at) {
      marker.visible = false;
      beam.visible = false;
      marker.position.set(0, -2000, 0);
      beam.position.set(0, -2000, 0);
      return;
    }
    marker.visible = true;
    beam.visible = true;
    marker.position.set(at[0], 0.45, at[1]);
    beam.position.set(at[0], 4, at[1]);
  }

  function buildCrew(at, count, radius) {
    const crew = [];
    const actors = window.SOLARA && window.SOLARA.actors;
    const shirt = new THREE.MeshStandardMaterial({ color: 0x8e3630, roughness: 0.75 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x1d2429, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x9c6a4d, roughness: 0.8 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x161a1c, roughness: 0.7 });
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + Math.random() * 0.4;
      const rad = 7 + Math.random() * (radius || 12);
      const x = clamp(at[0] + Math.sin(angle) * rad, -220, 220);
      const z = clamp(at[1] + Math.cos(angle) * rad, -220, 220);
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.62, 3, 6), shirt);
      body.position.y = 0.82;
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7), skin);
      head.position.y = 1.4;
      group.add(head);
      const beanie = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.14, 8), cap);
      beanie.position.y = 1.55;
      group.add(beanie);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.48, 3, 5), pants);
        leg.position.set(side * 0.14, 0.3, 0);
        group.add(leg);
      }
      group.position.set(x, 0, z);
      group.rotation.y = Math.random() * TAU;
      scene.add(group);
      const person = {
        mesh: group, body, alive: true, health: 100, panic: 0, phase: Math.random() * 6,
        speed: 0.3 + Math.random() * 0.2, homeX: x, homeZ: z, walk: Math.random() * 8, crew: true
      };
      if (actors && Array.isArray(actors.people)) actors.people.push(person);
      crew.push(person);
    }
    return crew;
  }

  function setPips() {
    // exposed through stepCount/stepIndex; HUD renders its own dots
    lastStepAt = performance.now();
  }

  function enterStep(k) {
    if (cur) cleanupCrew(cur);
    step = clamp(k, 0, Math.max(0, steps.length - 1));
    cur = steps[step] || null;
    timeLeft = cur && cur.time ? cur.time : null;
    timeTotal = timeLeft || 0;
    pendingWanted = cur && cur.level ? cur.level : 0;
    if (!cur) return;
    if (cur.type === 'escape' || cur.type === 'survive') {
      // No fixed point to run to — the HUD shows a pursuit state instead.
      placeMarker(null);
    } else {
      placeMarker(cur.at);
    }
    if (cur.type === 'kill') {
      cur._crew = buildCrew(cur.at, cur.count || 5, cur.type === 'kill' ? 14 : 12);
      cur.progress = 0;
      cur.finished = false;
    }
    setPips();
  }

  function begin(i, announce = true) {
    cleanupCrew(cur);
    index = clamp(i, 0, MISSIONS.length - 1);
    done = false;
    state = STATUS_ACTIVE;
    failReason = '';
    failTimer = 0;
    elapsed = 0;
    steps = SCRIPTS[index].steps.map((s) => Object.assign({}, s));
    step = 0;
    cur = null;
    const side = index >= 6;
    markerMat.color.setHex(side ? 0x6fe8d4 : 0xffc46a);
    ring.material.color.setHex(side ? 0x9ff6e7 : 0xffd79a);
    beam.material.color.setHex(side ? 0x6fe8d4 : 0xffc46a);
    beacon.material.color.setHex(side ? 0xbdfbf0 : 0xffe0a3);
    enterStep(0);
    if (announce) emit(`JOB ${String(index + 1).padStart(2, '0')} · ${MISSIONS[index][0].replace(/^\d+ · /, '').replace(/^SIDE · /, '')}`);
  }

  function finish() {
    const title = MISSIONS[index][0];
    const reward = REWARDS[index];
    const player = window.SOLARA && window.SOLARA.player;
    if (player) player.money = (player.money || 0) + reward;
    logs.unshift({ index, title, reward, status: STATUS_DONE, at: fmtTime(elapsed), objective: MISSIONS[index][1] });
    cleanupCrew(cur);
    emit(`JOB COMPLETE · +${reward} CR`);
    if (index < MISSIONS.length - 1) {
      begin(index + 1);
    } else {
      done = true;
      state = STATUS_DONE;
      cur = null;
      placeMarker(null);
      emit('STORY COMPLETE · SOLARA BAY IS YOURS');
    }
  }

  function stepDone() {
    if (!cur || done) return;
    if (step + 1 < steps.length) {
      enterStep(step + 1);
    } else {
      finish();
    }
  }

  function fail(reason) {
    if (state !== STATUS_ACTIVE) return;
    state = STATUS_FAIL;
    failReason = reason || 'JOB FAILED';
    failTimer = 4.5;
    logs.unshift({ index, title: MISSIONS[index][0], reward: 0, status: STATUS_FAIL, at: fmtTime(elapsed), objective: failReason });
    emit(`JOB FAILED · ${failReason}`);
    cleanupCrew(cur);
    if (cur) placeMarker(null);
  }

  function retry() {
    if (done) return;
    begin(index, false);
    emit(`RETRY · ${MISSIONS[index][0]}`);
  }

  function update(dt, player, police) {
    dt = clamp(Number(dt) || 0, 0, 0.1);
    elapsed += dt;
    api.time += dt;

    // Marker pulse even when a step is not running (menus, failures).
    const t = performance.now() * 0.001;
    if (marker.visible) {
      marker.rotation.z = t * 0.8;
      marker.scale.setScalar(1 + Math.sin(t * 2.6) * 0.05);
      beacon.rotation.y = t * 1.7;
      beacon.position.y = 3.5 + Math.sin(t * 1.9) * 0.28;
      ring.scale.setScalar(1 + ((t * 0.7) % 1) * 0.55);
      ring.material.opacity = 0.3 * (1 - ((t * 0.7) % 1));
      beam.material.opacity = 0.09 + Math.sin(t * 1.6) * 0.025;
    }

    if (done) return;
    if (state === STATUS_FAIL) {
      failTimer -= dt;
      if (failTimer <= 0) retry();
      return;
    }
    if (!cur || !player || !player.group) return;

    if (pendingWanted && police && typeof police.crime === 'function') {
      police.crime(pendingWanted);
      pendingWanted = 0;
    }

    const pos = player.group.position;
    if (!Number.isFinite(pos.x)) return;

    if (cur.type === 'kill' && cur._crew) {
      let dead = 0;
      for (const person of cur._crew) if (!person.alive) dead++;
      cur.progress = dead;
    }

    // Vehicle conditions.
    if (cur.car && player.car && player.car.hp <= 0) { fail('VEHICLE WRECKED'); return; }
    if (cur.paint && player.car && player.car.damage > 0.42) { fail('THE PAINT IS RUINED'); return; }

    // Step timer. A survive step completes when it runs out; everything else fails.
    if (timeLeft !== null) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        if (cur.type === 'survive') { stepDone(); return; }
        fail('TIME EXPIRED');
        return;
      }
    }

    switch (cur.type) {
      case 'goto':
      case 'steal':
      case 'deliver': {
        const at = cur.at || [0, 0];
        const radius = cur.r || 8;
        const near = Math.hypot(pos.x - at[0], pos.z - at[1]) < radius;
        if (near && (!cur.car || player.car)) stepDone();
        break;
      }
      case 'escape':
        if (police && police.stars === 0) stepDone();
        break;
      case 'kill': {
        const crew = cur._crew || [];
        if (crew.length && crew.every((person) => !person.alive)) stepDone();
        break;
      }
      case 'survive':
        break;
      default:
        stepDone();
    }
  }

  function resolve(id) {
    if (typeof id === 'number' && Number.isFinite(id)) return clamp(Math.round(id) - 1, 0, MISSIONS.length - 1);
    const raw = String(id == null ? '' : id).trim().toLowerCase();
    if (!raw) return index;
    for (let i = 0; i < MISSIONS.length; i++) {
      const title = MISSIONS[i][0].toLowerCase();
      const tag = MISSIONS[i][2].toLowerCase();
      if (title === raw || tag === raw || title.includes(raw)) return i;
    }
    const numeric = parseInt(raw, 10);
    if (!Number.isNaN(numeric)) return clamp(numeric - 1, 0, MISSIONS.length - 1);
    return index;
  }

  const api = {
    marker,
    beam,
    get index() { return index; },
    get done() { return done; },
    get activity() { return 0; },
    get state() { return state; },
    get failed() { return state === STATUS_FAIL; },
    get failReason() { return failReason; },
    get reward() { return REWARDS[index]; },
    get stepIndex() { return step; },
    get stepCount() { return steps.length || SCRIPTS[index].steps.length; },
    get stepLabel() { return cur ? cur.label : ''; },
    get needsCar() { return !!(cur && cur.car); },
    get crewLeft() { return cur && cur._crew ? cur._crew.filter((p) => p.alive).length : 0; },
    get crewTotal() { return cur && cur._crew ? cur._crew.length : 0; },
    get side() { return index >= 6; },
    time: 0,
    startedAt: 0,
    current,
    advance,
    complete,
    start,
    retry,
    update,
    step: update,
    objectiveText,
    timeLeft: timeLeftValue,
    timeTotal: () => timeTotal,
    title,
    missionLog,
    drainEvents() { return events.splice(0, events.length); },
    reset() { logs.length = 0; begin(0, false); }
  };

  function current() {
    const m = MISSIONS[clamp(index, 0, MISSIONS.length - 1)];
    view[0] = m[0];
    if (done) view[1] = 'STORY COMPLETE';
    else if (state === STATUS_FAIL) view[1] = `FAILED · ${failReason}`;
    else view[1] = cur ? cur.label : m[1];
    view[2] = m[2];
    return view;
  }

  function advance() {
    if (done) return current();
    if (index < MISSIONS.length - 1) begin(index + 1);
    else {
      done = true;
      state = STATUS_DONE;
      cur = null;
      placeMarker(null);
    }
    return current();
  }

  function complete() {
    if (done) return current();
    if (state === STATUS_FAIL) retry();
    else stepDone();
    return current();
  }

  function start(id) {
    begin(resolve(id));
    return api;
  }

  function title() {
    return MISSIONS[clamp(index, 0, MISSIONS.length - 1)][0];
  }

  function objectiveText() {
    if (done) return 'SOLARA BAY IS YOURS';
    if (state === STATUS_FAIL) return `RETRYING IN ${Math.ceil(failTimer)} · ${failReason}`;
    if (!cur) return '';
    let text = cur.label;
    if (cur.type === 'kill' && cur._crew) text += ` · ${cur.progress || 0} / ${cur._crew.length}`;
    if (cur.type === 'escape') text = 'LOSE THE HEAT · BREAK LINE OF SIGHT';
    if (cur.car && cur.type !== 'kill') text += ' · IN A VEHICLE';
    return text;
  }

  function timeLeftValue() {
    if (done || state === STATUS_FAIL) return null;
    return timeLeft === null ? null : Math.max(0, Math.ceil(timeLeft));
  }

  function missionLog() {
    const list = logs.slice();
    if (!done && state === STATUS_ACTIVE && cur) {
      list.unshift({ index, title: MISSIONS[index][0], reward: REWARDS[index], status: STATUS_ACTIVE, at: fmtTime(elapsed), objective: cur.label });
    }
    return list;
  }

  begin(0, false);
  return api;
}

// Keep a plain-object helper export available for tests / tooling without touching the API above.
export function missionMeta(i) {
  const k = clamp(i | 0, 0, MISSIONS.length - 1);
  return { title: MISSIONS[k][0], brief: MISSIONS[k][1], tag: MISSIONS[k][2], reward: REWARDS[k], steps: SCRIPTS[k].steps.length };
}