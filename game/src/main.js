// Solara Bay entry point: renderer, lights, weather, input, the frame loop and the
// window.SOLARA debug/staging API. The ?shot=play|end query params stage fixed scenes
// for screenshots; everything else is the live game.
import { buildCity } from './city.js';
import { makeActors, stepActors } from './actors.js';
import { createPlayer, addPlayerCar, fireWeapon, reloadWeapon, weaponSpec, damagePlayer } from './player.js';
import { createMissions } from './missions.js';
import { createPolice } from './police.js';
import { updateHud } from './hud.js';
import { vehicleStep } from './vehicles.js';
import { createAudio } from './audio.js';
import { createTraffic } from './traffic.js';
import { saveGame, loadGame, loadSettings, saveSettings } from './save.js';

const SKY_COLOR = 0xe9ad79;
const FOG_NEAR = 130;
const FOG_FAR = 380;
const CAMERA_FOV = 68;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 700;
const MAX_PIXEL_RATIO = 1.35;
const TONE_MAPPING_EXPOSURE = 1.12;
const HEMI_SKY_COLOR = 0xffe6c2;
const HEMI_GROUND_COLOR = 0x51696b;
const HEMI_BASE_INTENSITY = 1.7;
const SUN_COLOR = 0xffd294;
const SUN_BASE_INTENSITY = 2.5;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_EXTENT = 150;
const MOON_COLOR = 0x6980c4;
const MOON_BASE_INTENSITY = 0.05;
const RAIN_COUNT = 650;
const RAIN_SPREAD = 250;
const RAIN_HEIGHT = 45;
const RAIN_COLOR = 0xa8cbd8;
const RAIN_SIZE = 0.12;
const RAIN_OPACITY = 0.65;
const RAIN_FALL_SPEED = 42;
const RAIN_RESET_HEIGHT = 40;
const DAY_LENGTH_SECONDS = 360;
const SUN_ORBIT_RADIUS = 120;
const SUN_MIN_HEIGHT = 15;
const SUN_MAX_HEIGHT = 150;
const FULL_CIRCLE = 6.28;
const MOUSE_SENSITIVITY = 0.0025;
const WALK_SPEED = 5.7;
const SPRINT_SPEED = 10;
const STAMINA_DRAIN = 22;
const STAMINA_REGEN = 13;
const JUMP_VELOCITY = 7;
const GRAVITY = 19;
const WORLD_BOUND = 225;
const LIMB_SWING_RATE = 0.012;
const LIMB_SWING_AMOUNT = 0.6;
const STEP_FRAME_INTERVAL = 28;
const FIRE_INTERVAL = 0.1;
const CROUCH_SCALE = 0.75;
const HOSPITAL_COST = 250;
const RESPAWN_X = -42;
const RESPAWN_Z = -42;
const OBJECTIVE_NOTIFY_DIST = 8;
const ENTER_CAR_DIST = 5;
const MARKER_INTERACT_DIST = 9;
const MARKER_COMPLETE_REWARD = 350;
const SIDE_JOB_REWARD = 250;
const CAMERA_FOLLOW_DIST = 10;
const CAMERA_HEIGHT = 5.5;
const CAMERA_LOOK_HEIGHT = 1.4;
const CAMERA_LERP = 0.09;
const AUTOSAVE_MS = 10000;
const MAX_FRAME_DELTA = 0.04;
const RAIN_STOP_CHANCE = 0.025;
const RAIN_START_CHANCE = 0.009;
const FOG_NEAR_RAIN = 35;
const FOG_FAR_RAIN = 180;
const FOG_COLOR = 0xc2c5bc;
const RAIN_SKY_COLOR = 0x687d87;
const TOAST_SECONDS = 3;
const START_TOAST_SECONDS = 4;
const START_TIME_OF_DAY = 0.68;

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.Fog(SKY_COLOR, FOG_NEAR, FOG_FAR);
const city = buildCity(scene);
const camera = new THREE.PerspectiveCamera(CAMERA_FOV, innerWidth / innerHeight, CAMERA_NEAR, CAMERA_FAR);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
document.body.prepend(renderer.domElement);

const hemi = new THREE.HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, HEMI_BASE_INTENSITY);
scene.add(hemi);
const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_BASE_INTENSITY);
sun.position.set(-90, 130, 100);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
sun.shadow.camera.left = -SHADOW_EXTENT;
sun.shadow.camera.right = SHADOW_EXTENT;
sun.shadow.camera.top = SHADOW_EXTENT;
sun.shadow.camera.bottom = -SHADOW_EXTENT;
scene.add(sun);
const moon = new THREE.DirectionalLight(MOON_COLOR, MOON_BASE_INTENSITY);
moon.position.set(90, 90, -90);
scene.add(moon);

const traffic = createTraffic(scene, city);
window.SOLARA = { traffic };
const actors = makeActors(scene);
const player = createPlayer(scene);
const mission = createMissions(scene);
const police = createPolice(scene);
const audio = createAudio();
let started = false, paused = false, toast = '', toastTime = 0;
const clock = new THREE.Clock();
let yaw = 0, timeOfDay = START_TIME_OF_DAY, weather = 'clear', fireCooldown = 0, shotTimer = 0, frame = 0;
const menu = document.querySelector('#menu');
const keys = {};
const settings = { fov: CAMERA_FOV, quality: 1, ...loadSettings() };
camera.fov = settings.fov;
camera.updateProjectionMatrix();
const rainGeo = new THREE.BufferGeometry();
const rainPoints = new Float32Array(RAIN_COUNT * 3);
for (let dropIndex = 0; dropIndex < RAIN_COUNT; dropIndex++) {
  rainPoints[dropIndex * 3] = (Math.random() - 0.5) * RAIN_SPREAD;
  rainPoints[dropIndex * 3 + 1] = Math.random() * RAIN_HEIGHT;
  rainPoints[dropIndex * 3 + 2] = (Math.random() - 0.5) * RAIN_SPREAD;
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPoints, 3));
const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: RAIN_COLOR, size: RAIN_SIZE, transparent: true, opacity: RAIN_OPACITY }));
rain.visible = false;
scene.add(rain);

const begin = () => {
  started = true;
  menu.style.display = 'none';
  audio.boot();
  renderer.domElement.requestPointerLock?.();
  toast = 'NICO: Pelican Motel. Come alone.';
  toastTime = START_TOAST_SECONDS;
};
document.querySelector('#play').onclick = begin;

const shotMode = new URLSearchParams(location.search).get('shot');
if (shotMode === 'play') {
  started = true;
  menu.style.display = 'none';
  player.group.position.set(-36.7, 0, -40);
  addPlayerCar(scene, player, 'sports');
  player.car.root.position.set(-36.7, 0.55, -40);
  player.car.root.rotation.y = 0;
  player.car.speed = 8;
  player.money = 2450;
  mission.advance();
  timeOfDay = 0.5;
  for (let carIndex = 0; carIndex < 8; carIndex++) {
    const trafficCar = traffic.cars[carIndex];
    if (trafficCar && trafficCar.traffic) {
      const stagingZ = -16 + carIndex * 13;
      const nearestNode = Math.round(stagingZ / 34) * 34;
      trafficCar.traffic.axis = 1;
      trafficCar.traffic.dir = 1;
      trafficCar.traffic.line = -1;
      trafficCar.traffic.coord = stagingZ;
      trafficCar.traffic.nextNode = nearestNode > stagingZ + 5 ? nearestNode : nearestNode + 34;
      trafficCar.traffic.target = { x: -31.3, z: trafficCar.traffic.nextNode };
      trafficCar.traffic.lastDist = 999;
      trafficCar.traffic.cruise = 6 + (carIndex % 3);
      trafficCar.root.position.set(-31.3, 0.55, stagingZ);
      trafficCar.root.rotation.y = 0;
    }
  }
  for (let pedIndex = 0; pedIndex < 14; pedIndex++) {
    const pedestrian = actors.people[pedIndex];
    if (pedestrian && pedestrian.mesh) {
      const sideSign = pedIndex % 2 ? 1 : -1;
      pedestrian.mesh.position.set(-51 + sideSign * 9.8, 0.16, -51 + ((pedIndex * 7) % 3) * 9.8);
      pedestrian.target = { x: -51 + sideSign * 9.8, z: -51 + ((pedIndex * 7) % 3) * 9.8 };
      pedestrian.state = 'walk';
    }
  }
}
if (shotMode === 'end') {
  started = true;
  menu.style.display = 'none';
  player.group.position.set(2.7, 0, 18);
  player.money = 12750;
  player.health = 22;
  timeOfDay = 0.55;
  police.stars = 5;
  for (let unitIndex = 0; unitIndex < police.units.length && unitIndex < 4; unitIndex++) {
    const unit = police.units[unitIndex];
    unit.root.position.set(2.7 + (unitIndex % 2 ? -5.4 : 0), 0.55, -16 + unitIndex * 9);
    unit.heading = 0;
    unit.wp = { x: 2.7, z: -16 + unitIndex * 9 };
    unit.speed = 0;
  }
  for (let blockIndex = 0; blockIndex < Math.min(3, police.roadblock.length); blockIndex++) {
    const roadblockCar = police.roadblock[blockIndex];
    if (roadblockCar && roadblockCar.root) roadblockCar.root.position.set(-5.4 + blockIndex * 5.4, 0.55, -34);
  }
  if (police.heli) {
    const heliGroup = police.heli.group;
    heliGroup.position.set(2.7, 32, -24);
    police.heli.angle = Math.PI;
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener('mousemove', (event) => {
  if (document.pointerLockElement === renderer.domElement) yaw -= event.movementX * MOUSE_SENSITIVITY;
});

function notify(text) {
  toast = text;
  toastTime = TOAST_SECONDS;
  audio.click();
}

function interact() {
  if (player.car) {
    player.group.position.copy(player.car.root.position);
    player.group.position.x += 2;
    player.car.speed = 0;
    player.car = null;
    notify('ON FOOT · VEHICLE SECURED');
    return;
  }
  let near = actors.cars.find(car => car.root.position.distanceTo(player.group.position) < ENTER_CAR_DIST);
  if (near) {
    player.car = near;
    notify('VEHICLE ACQUIRED · E TO EXIT');
    if (near.police) police.crime(1);
    return;
  }
  if (player.group.position.distanceTo(mission.marker.position) < MARKER_INTERACT_DIST) {
    mission.complete();
    player.money += MARKER_COMPLETE_REWARD;
    notify('JOB COMPLETE · +350 CR');
    return;
  }
  notify('NO INTERACTION NEARBY');
}

addEventListener('keydown', (event) => {
  keys[event.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  if (event.code === 'KeyP' || event.code === 'Escape') {
    if (started) {
      paused = !paused;
      notify(paused ? 'PAUSED · P TO RESUME' : 'BACK IN THE CITY');
      if (paused) document.exitPointerLock?.();
      else renderer.domElement.requestPointerLock?.();
    }
  }
  if (event.code === 'KeyE' && started && !paused) interact();
  if (event.code === 'KeyM' && started) {
    mission.complete();
    player.money += SIDE_JOB_REWARD;
    notify('SIDE JOB COMPLETE · +250 CR');
  }
  if (event.code.startsWith('Digit') && Number(event.code.slice(5)) >= 1 && Number(event.code.slice(5)) <= 3) {
    player.weapon = Number(event.code.slice(5));
    player.clip = Math.min(player.clip, weaponSpec(player).mag);
    notify(weaponSpec(player).name.toUpperCase());
  }
  if (event.code === 'KeyR') reloadWeapon(player);
  if (event.code === 'KeyH' && player.car) audio.horn();
  if (event.code === 'KeyN') {
    notify(audio.station(audio.station + 1));
  }
  if (event.code === 'KeyF' && started) {
    player.crouch = !player.crouch;
    player.body.scale.y = player.crouch ? CROUCH_SCALE : 1;
  }
  if (event.code === 'KeyT') setWeather(weather === 'clear' ? 'rain' : weather === 'rain' ? 'fog' : 'clear');
});
addEventListener('keyup', (event) => keys[event.code] = false);
addEventListener('mousedown', () => {
  if (started && !paused) {
    player.fire = 1;
    audio.boot();
  }
});
addEventListener('mouseup', () => player.fire = 0);
addEventListener('blur', () => {
  for (const key of Object.keys(keys)) keys[key] = false;
  player.fire = 0;
});

function setWeather(next) {
  weather = next;
  rain.visible = weather === 'rain';
  scene.fog.near = weather === 'fog' ? FOG_NEAR_RAIN : FOG_NEAR;
  scene.fog.far = weather === 'fog' ? FOG_FAR_RAIN : FOG_FAR;
  scene.fog.color.setHex(weather === 'fog' ? FOG_COLOR : weather === 'rain' ? RAIN_SKY_COLOR : SKY_COLOR);
  scene.background.setHex(weather === 'fog' ? FOG_COLOR : weather === 'rain' ? RAIN_SKY_COLOR : SKY_COLOR);
}

const stored = loadGame();
if (stored) {
  player.money = stored.money || player.money;
  for (let missionIndex = 0; missionIndex < (stored.mission || 0); missionIndex++) mission.advance();
}
setInterval(() => saveGame({ money: player.money, mission: mission.index, health: player.health }), AUTOSAVE_MS);

window.SOLARA = {
  start: begin,
  setWanted: (level) => police.crime(level),
  startMission: (count) => { for (let missionIndex = 0; missionIndex < count; missionIndex++) mission.advance(); },
  spawnVehicle: () => addPlayerCar(scene, player),
  setTime: (value) => timeOfDay = value,
  setWeather,
  placeCamera: (x, y, z) => camera.position.set(x, y, z),
  toggleHud: (visible) => document.querySelector('#ui').style.display = visible ? '' : 'none',
  hideTitle: begin,
  player, scene, mission, police, actors, audio, city, traffic,
};

function tick() {
  requestAnimationFrame(tick);
  const delta = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
  frame++;
  if (started && !paused) {
    timeOfDay = (timeOfDay + delta / DAY_LENGTH_SECONDS) * 1 % 1;
    if (window.SOLARA) SOLARA.timeOfDay = timeOfDay;
    const daylight = Math.max(0, Math.sin((timeOfDay - 0.25) * Math.PI * 2));
    sun.intensity = 0.2 + daylight * 2.7;
    hemi.intensity = 0.35 + daylight * 1.6;
    moon.intensity = 0.03 + (1 - daylight) * 0.32;
    sun.position.set(Math.cos(timeOfDay * FULL_CIRCLE) * SUN_ORBIT_RADIUS, Math.max(SUN_MIN_HEIGHT, daylight * SUN_MAX_HEIGHT), Math.sin(timeOfDay * FULL_CIRCLE) * SUN_ORBIT_RADIUS);

    const moving = keys.KeyW || keys.ArrowUp;
    const reverse = keys.KeyS || keys.ArrowDown;
    const left = keys.KeyA || keys.ArrowLeft;
    const right = keys.KeyD || keys.ArrowRight;
    const sprint = keys.ShiftLeft || keys.ShiftRight;
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    player.weaponCooldown = Math.max(0, player.weaponCooldown - delta);
    player.reload = Math.max(0, player.reload - delta);
    if (player.car) {
      vehicleStep(player.car, delta, { gas: (moving ? 1 : 0) - (reverse ? 1 : 0), steer, handbrake: keys.Space });
      player.group.position.copy(player.car.root.position);
      player.group.visible = false;
      audio.engine(player.car.speed);
    } else {
      player.group.visible = true;
      const speed = sprint && player.stamina > 0 ? SPRINT_SPEED : WALK_SPEED;
      if (sprint && moving) player.stamina = Math.max(0, player.stamina - STAMINA_DRAIN * delta);
      else player.stamina = Math.min(100, player.stamina + STAMINA_REGEN * delta);
      player.group.rotation.y = yaw;
      const moveX = (Math.sin(yaw) * (moving ? 1 : 0) + Math.cos(yaw) * steer);
      const moveZ = (Math.cos(yaw) * (moving ? 1 : 0) - Math.sin(yaw) * steer);
      player.group.position.x += moveX * speed * delta;
      player.group.position.z += moveZ * speed * delta;
      if (keys.Space && player.grounded) {
        player.velocityY = JUMP_VELOCITY;
        player.grounded = false;
      }
      player.velocityY -= GRAVITY * delta;
      player.group.position.y += player.velocityY * delta;
      if (player.group.position.y <= 0) {
        player.group.position.y = 0;
        player.velocityY = 0;
        player.grounded = true;
      }
      const walking = moving || reverse || left || right;
      for (let limbIndex = 0; limbIndex < player.limbs.length; limbIndex++) player.limbs[limbIndex].rotation.x = walking ? Math.sin(performance.now() * LIMB_SWING_RATE + limbIndex * Math.PI) * LIMB_SWING_AMOUNT : 0;
      if (walking && frame % STEP_FRAME_INTERVAL === 0) audio.step();
    }

    player.group.position.x = THREE.MathUtils.clamp(player.group.position.x, -WORLD_BOUND, WORLD_BOUND);
    player.group.position.z = THREE.MathUtils.clamp(player.group.position.z, -WORLD_BOUND, WORLD_BOUND);
    stepActors(actors, delta, player, police);
    if (player.fire) {
      fireCooldown -= delta;
      if (fireCooldown <= 0) {
        fireCooldown = FIRE_INTERVAL;
        const hit = fireWeapon(player, scene, actors, camera, police, audio);
        if (hit?.hit) notify('HIT CONFIRMED');
      }
    }
    police.step(delta, player.group.position, player, amount => damagePlayer(player, amount));
    if (player.health <= 0) {
      player.health = 100;
      player.armor = 0;
      player.money = Math.max(0, player.money - HOSPITAL_COST);
      player.group.position.set(RESPAWN_X, 0, RESPAWN_Z);
      player.car = null;
      police.stars = 0;
      notify('WASTED · HOSPITAL RELEASE · −250 CR');
    }
    if (player.group.position.distanceTo(mission.marker.position) < OBJECTIVE_NOTIFY_DIST) notify('OBJECTIVE · ' + mission.current()[1]);

    if (weather === 'rain') {
      const positions = rain.geometry.attributes.position;
      for (let dropIndex = 0; dropIndex < RAIN_COUNT; dropIndex++) {
        let dropY = positions.getY(dropIndex) - RAIN_FALL_SPEED * delta;
        if (dropY < 0) dropY = RAIN_RESET_HEIGHT;
        positions.setY(dropIndex, dropY);
      }
      positions.needsUpdate = true;
    }
    if (weather === 'rain' && Math.random() < delta * RAIN_STOP_CHANCE) setWeather('clear');
    if (weather === 'clear' && Math.random() < delta * RAIN_START_CHANCE) setWeather('rain');
    audio.radio(delta);
    if (toastTime > 0) toastTime -= delta;
    else toast = '';
    updateHud(player, police, mission, toast);
  }
  const target = player.car ? player.car.root.position : player.group.position;
  const angle = player.car ? player.car.root.rotation.y : yaw;
  const desired = new THREE.Vector3(target.x - Math.sin(angle) * CAMERA_FOLLOW_DIST, target.y + CAMERA_HEIGHT, target.z - Math.cos(angle) * CAMERA_FOLLOW_DIST);
  camera.position.lerp(desired, CAMERA_LERP);
  camera.lookAt(target.x, target.y + CAMERA_LOOK_HEIGHT, target.z);
  if (shotMode === 'end') {
    camera.position.set(2.7, 13, 44);
    camera.lookAt(2.7, 6, -32);
    for (let unitIndex = 0; unitIndex < police.units.length && unitIndex < 4; unitIndex++) {
      const unit = police.units[unitIndex];
      unit.root.position.set(2.7 + (unitIndex % 2 ? -5.4 : 0), 0.55, -16 + unitIndex * 9);
      unit.root.rotation.y = 0;
      unit.speed = 0;
    }
    for (let blockIndex = 0; blockIndex < Math.min(3, police.roadblock.length); blockIndex++) {
      const roadblockCar = police.roadblock[blockIndex];
      if (roadblockCar && roadblockCar.root) {
        roadblockCar.root.position.set(-5.4 + blockIndex * 5.4, 0.55, -34);
        roadblockCar.speed = 0;
      }
    }
    if (police.heli) {
      const heliGroup = police.heli.group;
      heliGroup.position.x += (2.7 - heliGroup.position.x) * 0.08;
      heliGroup.position.z += (-24 - heliGroup.position.z) * 0.08;
      heliGroup.position.y += (32 - heliGroup.position.y) * 0.08;
    }
  } else if (shotMode === 'play') {
    for (let pedIndex = 0; pedIndex < 14; pedIndex++) {
      const pedestrian = actors.people[pedIndex];
      if (pedestrian && pedestrian.mesh) {
        const sideSign = pedIndex % 2 ? 1 : -1;
        pedestrian.mesh.position.set(-51 + sideSign * 9.8, 0.16, -51 + ((pedIndex * 7) % 3) * 9.8);
        pedestrian.target = { x: -51 + sideSign * 9.8, z: -51 + ((pedIndex * 7) % 3) * 9.8 };
      }
    }
  }
  renderer.render(scene, camera);
}
tick();
