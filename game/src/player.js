// The player on foot: a capsule body with swinging limbs, weapon stats, and the
// enter/exit, fire, reload and damage rules. Everything lives in a THREE.Group.
import { makeCar, damageVehicle } from './vehicles.js';

const WEAPONS = [
  { name: 'Pistol', damage: 35, rate: 0.34, range: 48, mag: 12 },
  { name: 'SMG', damage: 17, rate: 0.095, range: 38, mag: 30 },
  { name: 'Shotgun', damage: 20, rate: 0.72, range: 24, mag: 8 },
];

const CLOTH_COLOR = 0xe0a276;
const PANTS_COLOR = 0x273b49;
const SKIN_COLOR = 0xb97858;
const BODY_RADIUS = 0.34;
const BODY_LENGTH = 0.62;
const BODY_HEIGHT = 1.1;
const HEAD_RADIUS = 0.23;
const HEAD_HEIGHT = 1.75;
const ARM_RADIUS = 0.1;
const ARM_LENGTH = 0.52;
const LEG_RADIUS = 0.12;
const LEG_LENGTH = 0.55;
const ARM_OFFSET_X = 0.38;
const LEG_OFFSET_X = 0.17;
const ARM_HEIGHT = 1.16;
const LEG_HEIGHT = 0.45;
const START_HEALTH = 100;
const START_ARMOR = 35;
const START_MONEY = 850;
const START_WEAPON = 1;
const START_AMMO = 72;
const START_CLIP = 12;
const START_STAMINA = 100;
const ARMOR_ABSORB_RATIO = 0.65;
const RELOAD_SECONDS = 1.2;
const PANIC_SECONDS = 5;
const CORPSE_HEIGHT = 0.25;

export function createPlayer(scene) {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: CLOTH_COLOR });
  const pants = new THREE.MeshStandardMaterial({ color: PANTS_COLOR });
  const skin = new THREE.MeshStandardMaterial({ color: SKIN_COLOR });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 4, 8), cloth);
  body.position.y = BODY_HEIGHT;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 10, 8), skin);
  head.position.y = HEAD_HEIGHT;
  group.add(head);
  const limbs = [];
  for (let side of [-1, 1]) {
    for (let isLeg = 0; isLeg < 2; isLeg++) {
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(isLeg ? LEG_RADIUS : ARM_RADIUS, isLeg ? LEG_LENGTH : ARM_LENGTH, 3, 6), isLeg ? pants : cloth);
      limb.position.set(side * (isLeg ? LEG_OFFSET_X : ARM_OFFSET_X), isLeg ? LEG_HEIGHT : ARM_HEIGHT, 0);
      group.add(limb);
      limbs.push(limb);
    }
  }
  scene.add(group);
  return {
    group, body, head, limbs,
    car: null, health: START_HEALTH, armor: START_ARMOR, money: START_MONEY,
    weapon: START_WEAPON, ammo: START_AMMO, clip: START_CLIP, wanted: 0, fire: 0,
    stamina: START_STAMINA, grounded: true, velocityY: 0, crouch: false, damage: 0,
    score: 0, weaponCooldown: 0, reload: 0,
  };
}

export function addPlayerCar(scene, player, type = 'sports') {
  const car = makeCar(scene, player.group.position.x, player.group.position.z, undefined, false, type);
  car.root.rotation.y = player.group.rotation.y;
  player.car = car;
  return car;
}

export function weaponSpec(player) {
  return WEAPONS[player.weapon - 1] || WEAPONS[0];
}

export function damagePlayer(player, amount) {
  const absorbed = Math.min(player.armor, amount * ARMOR_ABSORB_RATIO);
  player.armor -= absorbed;
  player.health = Math.max(0, player.health - (amount - absorbed));
  return player.health === 0;
}

export function reloadWeapon(player) {
  const spec = weaponSpec(player);
  if (player.clip < spec.mag && player.ammo > 0) {
    const count = Math.min(spec.mag - player.clip, player.ammo);
    player.clip += count;
    player.ammo -= count;
    player.reload = RELOAD_SECONDS;
    return true;
  }
  return false;
}

export function fireWeapon(player, scene, actors, camera, police, audio) {
  if (player.weaponCooldown > 0 || player.clip <= 0 || player.reload > 0) return null;
  const spec = weaponSpec(player);
  player.weaponCooldown = spec.rate;
  player.clip--;
  const origin = camera.position.clone();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const ray = new THREE.Raycaster(origin, direction, 0, spec.range);
  let candidates = [];
  for (const person of actors.people) if (person.alive) candidates.push(person.mesh);
  for (const car of actors.cars) candidates.push(car.root);
  const hits = ray.intersectObjects(candidates, true);
  const hit = hits[0];
  audio?.shot(player.weapon);
  if (hit) {
    // Walk up from the struck mesh to the owning person or car root.
    let object = hit.object;
    while (object.parent && object.parent !== scene) {
      if (actors.people.some(person => person.mesh === object)) break;
      if (actors.cars.some(car => car.root === object)) break;
      object = object.parent;
    }
    const person = actors.people.find(person => person.mesh === object || person.mesh === hit.object.parent);
    const vehicle = actors.cars.find(car => car.root === object);
    if (person) {
      person.health -= spec.damage;
      person.panic = PANIC_SECONDS;
      if (person.health <= 0) {
        person.alive = false;
        person.mesh.rotation.z = Math.PI / 2;
        person.mesh.position.y = CORPSE_HEIGHT;
      }
      police.crime(2);
      return { hit: true, person };
    }
    if (vehicle) {
      damageVehicle(vehicle, spec.damage);
      police.crime(1);
      return { hit: true, vehicle };
    }
  }
  police.crime(1);
  return { hit: false };
}
