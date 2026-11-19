// Handles on-foot movement, vehicle entry, driving, health, weapons and basic combat.
import {makeCar} from './vehicles.js';
export function createPlayer(scene){let group=new THREE.Group();let body=new THREE.Mesh(new THREE.CapsuleGeometry(.42,.9,4,8),new THREE.MeshStandardMaterial({color:0xf0a36f}));body.position.y=1;group.add(body);scene.add(group);return {group,body,car:null,health:100,armor:35,money:850,weapon:1,ammo:72,wanted:0,fire:0};}
export function addPlayerCar(scene,p){if(p.car)return;p.car=makeCar(scene,p.group.position.x,p.group.position.z,0x32b5ad);p.car.root.rotation.y=p.group.rotation.y;}
