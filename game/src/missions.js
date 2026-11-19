// Solara Bay — the nine jobs from config.js, staged as multi-step scripts.
//
// main.js still drives the basics: `advance()` skips to the next job, `complete()` finishes the
// current step (so pressing E on a marker always works), and `marker` is the torus main.js checks
// against. The step engine lives in `update(dt, player, police)`, which the HUD calls every frame,
// and adds timers, kill counters, vehicle conditions, fail/retry and a mission log on top.
import { MISSIONS } from './config.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

// Road intersections are every 34 units; most waypoints sit on or just off one.
const LANDMARKS = {
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
    { type: 'goto', label: 'MEET NICO AT THE PELICAN MOTEL', at: LANDMARKS.pelican, r: 9 },
    { type: 'goto', label: "FOLLOW NICO'S LEAD TO THE LOCK-UP", at: LANDMARKS.lockup, r: 9 },
    { type: 'steal', label: 'TAKE THE COUPE OFF THE LOT', at: [-136, -68], r: 12, car: true },
    { type: 'deliver', label: 'RUN THE COUPE TO THE DOCKS', at: LANDMARKS.docks, r: 12, car: true }
  ] },
  // 02 · SALT IN THE AIR — marina pickup, dock patrol, return the bag.
  { steps: [
    { type: 'goto', label: 'GET DOWN TO THE MARINA', at: LANDMARKS.marina, r: 10 },
    { type: 'goto', label: 'FIND THE COURIER BAG IN THE DOCK OFFICE', at: LANDMARKS.marinaOffice, r: 8 },
    { type: 'escape', label: 'SHAKE THE DOCK PATROL', at: LANDMARKS.marinaOffice, level: 2 },
    { type: 'deliver', label: 'RETURN THE BAG TO NICO', at: LANDMARKS.pelican, r: 10 }
  ] },
  // 03 · GLASS HARBOR — timed coupe run through downtown, paint must survive.
  { steps: [
    { type: 'steal', label: 'TAKE THE MARKED COUPE FROM THE VALET', at: LANDMARKS.downtown, r: 11, car: true },
    { type: 'goto', label: 'CLEAR THE HARBOR OVERPASS', at: [68, 34], r: 10, car: true, time: 26 },
    { type: 'goto', label: 'CUT THROUGH THE GLASS TOWERS', at: [68, -34], r: 10, car: true, time: 26 },
    { type: 'deliver', label: 'DELIVER IT WITHOUT A SCRATCH', at: LANDMARKS.harbor, r: 12, car: true, time: 30, paint: true }
  ] },
  // 04 · NIGHT FREIGHT — port yard, truck theft, timed warehouse run, hand-off.
  { steps: [
    { type: 'goto', label: 'MEET THE FREIGHT CREW AT THE YARD', at: LANDMARKS.freight, r: 10 },
    { type: 'steal', label: 'STEAL THE FREIGHT TRUCK FROM THE PORT', at: LANDMARKS.port, r: 12, car: true },
    { type: 'deliver', label: 'RUN THE CRATE TO THE SUBURB WAREHOUSE', at: LANDMARKS.warehouse, r: 13, car: true, time: 85 },
    { type: 'deliver', label: 'HAND OFF THE CRATE', at: LANDMARKS.suburbs, r: 10, car: true }
  ] },
  // 05 · LOW TIDE — causeway confrontation, crew fight, response, escape.
  { steps: [
    { type: 'goto', label: 'MEET THE CREW AT THE OLD CAUSEWAY', at: LANDMARKS.causeway, r: 10 },
    { type: 'kill', label: 'CLEAR THE BREAKWATER CREW', at: LANDMARKS.breakwater, r: 24, count: 5 },
    { type: 'survive', label: 'SURVIVE THE RESPONSE', at: LANDMARKS.breakwater, time: 40, level: 3 },
    { type: 'escape', label: 'LOSE THE HEAT', at: LANDMARKS.breakwater, level: 3 }
  ] },
  // 06 · LAST LIGHT — rooftop meet, Nico's crew, escape the city.
  { steps: [
    { type: 'goto', label: 'MEET NICO ABOVE THE MARINA', at: LANDMARKS.marina, r: 9 },
    { type: 'goto', label: 'GET TO THE ROOFTOP STAIR', at: LANDMARKS.rooftop, r: 8 },
    { type: 'kill', label: "CLEAR NICO'S CREW", at: LANDMARKS.rooftop, r: 26, count: 8 },
    { type: 'escape', label: 'LEAVE SOLARA BAY BEHIND', at: LANDMARKS.rooftop, level: 3 }
  ] },
  // SIDE · TAXI FARE — pick up, scenic stop, timed drop.
  { steps: [
    { type: 'steal', label: 'PICK UP THE FARE DOWNTOWN', at: LANDMARKS.taxiStand, r: 10, car: true },
    { type: 'goto', label: 'TAKE THE SCENIC ROUTE', at: LANDMARKS.scenic, r: 11, car: true, time: 35 },
    { type: 'deliver', label: 'DROP THEM IN THE SUBURBS', at: LANDMARKS.suburbs, r: 12, car: true, time: 45 }
  ] },
  // SIDE · HOT PACKAGE — pickup, timed cross-town run, lose the tail.
  { steps: [
    { type: 'goto', label: 'COLLECT THE SEALED PACKAGE', at: LANDMARKS.package, r: 9 },
    { type: 'deliver', label: 'DELIVER IT BEFORE IT COOLS', at: LANDMARKS.coldDrop, r: 12, car: true, time: 75 },
    { type: 'escape', label: 'LOSE THE TAIL', at: LANDMARKS.coldDrop, level: 1 }
  ] },
  // SIDE · RAMPAGE — start trouble, drop ten targets, survive the response.
  { steps: [
    { type: 'goto', label: 'START SOMETHING DOWNTOWN', at: LANDMARKS.rampage, r: 10 },
    { type: 'kill', label: 'DROP TEN TARGETS', at: LANDMARKS.rampage, r: 28, count: 10, time: 90, level: 3 },
    { type: 'escape', label: 'SURVIVE THE RESPONSE', at: LANDMARKS.rampage, level: 3 }
  ] }
];

const STATUS_ACTIVE = 'ACTIVE';
const STATUS_DONE = 'COMPLETE';
const STATUS_FAIL = 'FAILED';

const SIDE_MISSION_START = 6;
const MAX_STEP_DELTA = 0.1;
const FAIL_RETRY_SECONDS = 4.5;
const PAINT_DAMAGE_LIMIT = 0.42;
const DEFAULT_GOTO_RADIUS = 8;
const DEFAULT_KILL_COUNT = 5;
const KILL_CREW_RADIUS = 14;
const DEFAULT_CREW_RADIUS = 12;
const CREW_MIN_DISTANCE = 7;
const CREW_SPAWN_BOUND = 220;
const CREW_ANGLE_JITTER = 0.4;
const CREW_BASE_SPEED = 0.3;
const CREW_SPEED_RANGE = 0.2;
const CREW_PHASE_RANGE = 6;
const CREW_WALK_RANGE = 8;
// Marker geometry and resting heights.
const MARKER_RADIUS = 3;
const MARKER_TUBE = 0.24;
const MARKER_HEIGHT = 0.45;
const RING_INNER_RADIUS = 3.25;
const RING_OUTER_RADIUS = 3.75;
const BEACON_RADIUS = 0.42;
const BEACON_REST_HEIGHT = 3.6;
const BEAM_TOP_RADIUS = 0.3;
const BEAM_BOTTOM_RADIUS = 1.1;
const BEAM_LENGTH = 8;
const BEAM_HEIGHT = 4;
const HIDDEN_Y = -2000;
// Marker colours: story jobs amber, side jobs teal.
const MARKER_COLOR = 0xffc46a;
const RING_COLOR = 0xffd79a;
const BEACON_COLOR = 0xffe0a3;
const SIDE_MARKER_COLOR = 0x6fe8d4;
const SIDE_RING_COLOR = 0x9ff6e7;
const SIDE_BEACON_COLOR = 0xbdfbf0;
const MARKER_OPACITY = 0.95;
const RING_OPACITY = 0.28;
const BEACON_OPACITY = 0.9;
const BEAM_OPACITY = 0.11;
// Marker pulse animation rates.
const MARKER_SPIN_RATE = 0.8;
const MARKER_PULSE_RATE = 2.6;
const MARKER_PULSE_AMOUNT = 0.05;
const BEACON_SPIN_RATE = 1.7;
const BEACON_BASE_HEIGHT = 3.5;
const BEACON_BOB_RATE = 1.9;
const BEACON_BOB_AMOUNT = 0.28;
const RING_CYCLE_RATE = 0.7;
const RING_GROWTH = 0.55;
const RING_BASE_OPACITY = 0.3;
const BEAM_BASE_OPACITY = 0.09;
const BEAM_PULSE_RATE = 1.6;
const BEAM_PULSE_AMOUNT = 0.025;
// Crew body proportions and colours.
const CREW_SHIRT_COLOR = 0x8e3630;
const CREW_PANTS_COLOR = 0x1d2429;
const CREW_SKIN_COLOR = 0x9c6a4d;
const CREW_CAP_COLOR = 0x161a1c;
const CREW_BODY_RADIUS = 0.3;
const CREW_BODY_LENGTH = 0.62;
const CREW_BODY_HEIGHT = 0.82;
const CREW_HEAD_RADIUS = 0.22;
const CREW_HEAD_HEIGHT = 1.4;
const CREW_BEANIE_RADIUS = 0.23;
const CREW_BEANIE_LENGTH = 0.14;
const CREW_BEANIE_HEIGHT = 1.55;
const CREW_LEG_RADIUS = 0.1;
const CREW_LEG_LENGTH = 0.48;
const CREW_LEG_OFFSET_X = 0.14;
const CREW_LEG_HEIGHT = 0.3;

function fmtTime(seconds) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

export function createMissions(scene) {
  let index = 0;
  let stepIndex = 0;
  let steps = [];
  let currentStep = null;
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

  const markerMat = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: MARKER_OPACITY });
  const marker = new THREE.Mesh(new THREE.TorusGeometry(MARKER_RADIUS, MARKER_TUBE, 8, 36), markerMat);
  marker.rotation.x = Math.PI / 2;
  marker.position.set(LANDMARKS.pelican[0], MARKER_HEIGHT, LANDMARKS.pelican[1]);
  scene.add(marker);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(RING_INNER_RADIUS, RING_OUTER_RADIUS, 40),
    new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: RING_OPACITY, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);

  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(BEACON_RADIUS, 0),
    new THREE.MeshBasicMaterial({ color: BEACON_COLOR, transparent: true, opacity: BEACON_OPACITY })
  );
  beacon.position.y = BEACON_REST_HEIGHT;
  marker.add(beacon);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(BEAM_TOP_RADIUS, BEAM_BOTTOM_RADIUS, BEAM_LENGTH, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: BEAM_OPACITY, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.set(LANDMARKS.pelican[0], BEAM_HEIGHT, LANDMARKS.pelican[1]);
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

  function placeMarker(location) {
    if (!location) {
      marker.visible = false;
      beam.visible = false;
      marker.position.set(0, HIDDEN_Y, 0);
      beam.position.set(0, HIDDEN_Y, 0);
      return;
    }
    marker.visible = true;
    beam.visible = true;
    marker.position.set(location[0], MARKER_HEIGHT, location[1]);
    beam.position.set(location[0], BEAM_HEIGHT, location[1]);
  }

  function buildCrew(location, count, radius) {
    const crew = [];
    const actors = window.SOLARA && window.SOLARA.actors;
    const shirt = new THREE.MeshStandardMaterial({ color: CREW_SHIRT_COLOR, roughness: 0.75 });
    const pants = new THREE.MeshStandardMaterial({ color: CREW_PANTS_COLOR, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: CREW_SKIN_COLOR, roughness: 0.8 });
    const cap = new THREE.MeshStandardMaterial({ color: CREW_CAP_COLOR, roughness: 0.7 });
    for (let memberIndex = 0; memberIndex < count; memberIndex++) {
      const angle = (memberIndex / count) * TAU + Math.random() * CREW_ANGLE_JITTER;
      const distance = CREW_MIN_DISTANCE + Math.random() * (radius || DEFAULT_CREW_RADIUS);
      const spawnX = clamp(location[0] + Math.sin(angle) * distance, -CREW_SPAWN_BOUND, CREW_SPAWN_BOUND);
      const spawnZ = clamp(location[1] + Math.cos(angle) * distance, -CREW_SPAWN_BOUND, CREW_SPAWN_BOUND);
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(CREW_BODY_RADIUS, CREW_BODY_LENGTH, 3, 6), shirt);
      body.position.y = CREW_BODY_HEIGHT;
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(CREW_HEAD_RADIUS, 8, 7), skin);
      head.position.y = CREW_HEAD_HEIGHT;
      group.add(head);
      const beanie = new THREE.Mesh(new THREE.CylinderGeometry(CREW_BEANIE_RADIUS, CREW_BEANIE_RADIUS, CREW_BEANIE_LENGTH, 8), cap);
      beanie.position.y = CREW_BEANIE_HEIGHT;
      group.add(beanie);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(CREW_LEG_RADIUS, CREW_LEG_LENGTH, 3, 5), pants);
        leg.position.set(side * CREW_LEG_OFFSET_X, CREW_LEG_HEIGHT, 0);
        group.add(leg);
      }
      group.position.set(spawnX, 0, spawnZ);
      group.rotation.y = Math.random() * TAU;
      scene.add(group);
      const person = {
        mesh: group, body, alive: true, health: 100, panic: 0, phase: Math.random() * CREW_PHASE_RANGE,
        speed: CREW_BASE_SPEED + Math.random() * CREW_SPEED_RANGE, homeX: spawnX, homeZ: spawnZ, walk: Math.random() * CREW_WALK_RANGE, crew: true
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

  function enterStep(requestedIndex) {
    if (currentStep) cleanupCrew(currentStep);
    stepIndex = clamp(requestedIndex, 0, Math.max(0, steps.length - 1));
    currentStep = steps[stepIndex] || null;
    timeLeft = currentStep && currentStep.time ? currentStep.time : null;
    timeTotal = timeLeft || 0;
    pendingWanted = currentStep && currentStep.level ? currentStep.level : 0;
    if (!currentStep) return;
    if (currentStep.type === 'escape' || currentStep.type === 'survive') {
      // No fixed point to run to — the HUD shows a pursuit state instead.
      placeMarker(null);
    } else {
      placeMarker(currentStep.at);
    }
    if (currentStep.type === 'kill') {
      currentStep._crew = buildCrew(currentStep.at, currentStep.count || DEFAULT_KILL_COUNT, currentStep.type === 'kill' ? KILL_CREW_RADIUS : DEFAULT_CREW_RADIUS);
      currentStep.progress = 0;
      currentStep.finished = false;
    }
    setPips();
  }

  function begin(missionIndex, announce = true) {
    cleanupCrew(currentStep);
    index = clamp(missionIndex, 0, MISSIONS.length - 1);
    done = false;
    state = STATUS_ACTIVE;
    failReason = '';
    failTimer = 0;
    elapsed = 0;
    steps = SCRIPTS[index].steps.map((stepDef) => Object.assign({}, stepDef));
    stepIndex = 0;
    currentStep = null;
    const side = index >= SIDE_MISSION_START;
    markerMat.color.setHex(side ? SIDE_MARKER_COLOR : MARKER_COLOR);
    ring.material.color.setHex(side ? SIDE_RING_COLOR : RING_COLOR);
    beam.material.color.setHex(side ? SIDE_MARKER_COLOR : MARKER_COLOR);
    beacon.material.color.setHex(side ? SIDE_BEACON_COLOR : BEACON_COLOR);
    enterStep(0);
    if (announce) emit(`JOB ${String(index + 1).padStart(2, '0')} · ${MISSIONS[index][0].replace(/^\d+ · /, '').replace(/^SIDE · /, '')}`);
  }

  function finish() {
    const title = MISSIONS[index][0];
    const reward = REWARDS[index];
    const player = window.SOLARA && window.SOLARA.player;
    if (player) player.money = (player.money || 0) + reward;
    logs.unshift({ index, title, reward, status: STATUS_DONE, at: fmtTime(elapsed), objective: MISSIONS[index][1] });
    cleanupCrew(currentStep);
    emit(`JOB COMPLETE · +${reward} CR`);
    if (index < MISSIONS.length - 1) {
      begin(index + 1);
    } else {
      done = true;
      state = STATUS_DONE;
      currentStep = null;
      placeMarker(null);
      emit('STORY COMPLETE · SOLARA BAY IS YOURS');
    }
  }

  function stepDone() {
    if (!currentStep || done) return;
    if (stepIndex + 1 < steps.length) {
      enterStep(stepIndex + 1);
    } else {
      finish();
    }
  }

  function fail(reason) {
    if (state !== STATUS_ACTIVE) return;
    state = STATUS_FAIL;
    failReason = reason || 'JOB FAILED';
    failTimer = FAIL_RETRY_SECONDS;
    logs.unshift({ index, title: MISSIONS[index][0], reward: 0, status: STATUS_FAIL, at: fmtTime(elapsed), objective: failReason });
    emit(`JOB FAILED · ${failReason}`);
    cleanupCrew(currentStep);
    if (currentStep) placeMarker(null);
  }

  function retry() {
    if (done) return;
    begin(index, false);
    emit(`RETRY · ${MISSIONS[index][0]}`);
  }

  function update(delta, player, police) {
    delta = clamp(Number(delta) || 0, 0, MAX_STEP_DELTA);
    elapsed += delta;
    api.time += delta;

    // Marker pulse even when a step is not running (menus, failures).
    const nowSeconds = performance.now() * 0.001;
    if (marker.visible) {
      marker.rotation.z = nowSeconds * MARKER_SPIN_RATE;
      marker.scale.setScalar(1 + Math.sin(nowSeconds * MARKER_PULSE_RATE) * MARKER_PULSE_AMOUNT);
      beacon.rotation.y = nowSeconds * BEACON_SPIN_RATE;
      beacon.position.y = BEACON_BASE_HEIGHT + Math.sin(nowSeconds * BEACON_BOB_RATE) * BEACON_BOB_AMOUNT;
      ring.scale.setScalar(1 + ((nowSeconds * RING_CYCLE_RATE) % 1) * RING_GROWTH);
      ring.material.opacity = RING_BASE_OPACITY * (1 - ((nowSeconds * RING_CYCLE_RATE) % 1));
      beam.material.opacity = BEAM_BASE_OPACITY + Math.sin(nowSeconds * BEAM_PULSE_RATE) * BEAM_PULSE_AMOUNT;
    }

    if (done) return;
    if (state === STATUS_FAIL) {
      failTimer -= delta;
      if (failTimer <= 0) retry();
      return;
    }
    if (!currentStep || !player || !player.group) return;

    if (pendingWanted && police && typeof police.crime === 'function') {
      police.crime(pendingWanted);
      pendingWanted = 0;
    }

    const playerPos = player.group.position;
    if (!Number.isFinite(playerPos.x)) return;

    if (currentStep.type === 'kill' && currentStep._crew) {
      let dead = 0;
      for (const person of currentStep._crew) if (!person.alive) dead++;
      currentStep.progress = dead;
    }

    // Vehicle conditions.
    if (currentStep.car && player.car && player.car.hp <= 0) { fail('VEHICLE WRECKED'); return; }
    if (currentStep.paint && player.car && player.car.damage > PAINT_DAMAGE_LIMIT) { fail('THE PAINT IS RUINED'); return; }

    // Step timer. A survive step completes when it runs out; everything else fails.
    if (timeLeft !== null) {
      timeLeft -= delta;
      if (timeLeft <= 0) {
        timeLeft = 0;
        if (currentStep.type === 'survive') { stepDone(); return; }
        fail('TIME EXPIRED');
        return;
      }
    }

    switch (currentStep.type) {
      case 'goto':
      case 'steal':
      case 'deliver': {
        const target = currentStep.at || [0, 0];
        const radius = currentStep.r || DEFAULT_GOTO_RADIUS;
        const isNear = Math.hypot(playerPos.x - target[0], playerPos.z - target[1]) < radius;
        if (isNear && (!currentStep.car || player.car)) stepDone();
        break;
      }
      case 'escape':
        if (police && police.stars === 0) stepDone();
        break;
      case 'kill': {
        const crew = currentStep._crew || [];
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
    for (let missionIndex = 0; missionIndex < MISSIONS.length; missionIndex++) {
      const title = MISSIONS[missionIndex][0].toLowerCase();
      const tag = MISSIONS[missionIndex][2].toLowerCase();
      if (title === raw || tag === raw || title.includes(raw)) return missionIndex;
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
    get stepIndex() { return stepIndex; },
    get stepCount() { return steps.length || SCRIPTS[index].steps.length; },
    get stepLabel() { return currentStep ? currentStep.label : ''; },
    get needsCar() { return !!(currentStep && currentStep.car); },
    get crewLeft() { return currentStep && currentStep._crew ? currentStep._crew.filter((person) => person.alive).length : 0; },
    get crewTotal() { return currentStep && currentStep._crew ? currentStep._crew.length : 0; },
    get side() { return index >= SIDE_MISSION_START; },
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
    const missionRow = MISSIONS[clamp(index, 0, MISSIONS.length - 1)];
    view[0] = missionRow[0];
    if (done) view[1] = 'STORY COMPLETE';
    else if (state === STATUS_FAIL) view[1] = `FAILED · ${failReason}`;
    else view[1] = currentStep ? currentStep.label : missionRow[1];
    view[2] = missionRow[2];
    return view;
  }

  function advance() {
    if (done) return current();
    if (index < MISSIONS.length - 1) begin(index + 1);
    else {
      done = true;
      state = STATUS_DONE;
      currentStep = null;
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
    if (!currentStep) return '';
    let text = currentStep.label;
    if (currentStep.type === 'kill' && currentStep._crew) text += ` · ${currentStep.progress || 0} / ${currentStep._crew.length}`;
    if (currentStep.type === 'escape') text = 'LOSE THE HEAT · BREAK LINE OF SIGHT';
    if (currentStep.car && currentStep.type !== 'kill') text += ' · IN A VEHICLE';
    return text;
  }

  function timeLeftValue() {
    if (done || state === STATUS_FAIL) return null;
    return timeLeft === null ? null : Math.max(0, Math.ceil(timeLeft));
  }

  function missionLog() {
    const list = logs.slice();
    if (!done && state === STATUS_ACTIVE && currentStep) {
      list.unshift({ index, title: MISSIONS[index][0], reward: REWARDS[index], status: STATUS_ACTIVE, at: fmtTime(elapsed), objective: currentStep.label });
    }
    return list;
  }

  begin(0, false);
  return api;
}

// Keep a plain-object helper export available for tests / tooling without touching the API above.
export function missionMeta(missionIndex) {
  const safeIndex = clamp(missionIndex | 0, 0, MISSIONS.length - 1);
  return { title: MISSIONS[safeIndex][0], brief: MISSIONS[safeIndex][1], tag: MISSIONS[safeIndex][2], reward: REWARDS[safeIndex], steps: SCRIPTS[safeIndex].steps.length };
}
