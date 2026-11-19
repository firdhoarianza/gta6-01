// Builds Solara Bay's coast, road grid, districts, skyline, palms and street furniture.
import { CITY, COLORS } from './config.js';
export function buildCity(scene){
 const mat=(c,r=.8)=>new THREE.MeshStandardMaterial({color:c,roughness:r});
 const ground=mat(0xc8ae83), road=mat(COLORS.road), sand=mat(COLORS.sand), sea=mat(COLORS.sea), white=mat(0xf1dfb4), palm=mat(0x35664d), trunk=mat(0x806044);
 function box(x,y,z,sx,sy,sz,m){const o=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;scene.add(o);return o;}
 box(0,-.3,0,350,.5,350,ground);box(0,-.22,-177,370,.25,20,sand);box(0,-.3,-195,390,.4,25,sea);
 for(let n=-5;n<=5;n++){let z=n*CITY.block;box(0,-.04,z,350,.16,CITY.road,road);box(z,-.04,0,CITY.road,.16,350,road);for(let k=-5;k<=5;k++){box(k*CITY.block,.05,z,1,.025,4,white);box(z,.05,k*CITY.block,4,.025,1,white);}}
 const palettes=[0xf4d7ad,0xe9b7a5,0xa7c8c0,0xd8c8a4,0xc5d3da,0xf0cc8a];
 for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++){if(Math.abs(x)<1&&Math.abs(z)<1)continue;let px=x*CITY.block+17,pz=z*CITY.block+17;if(pz < -145||pz>150)continue;let h=8+((x*x*13+z*z*7+x*z*5+41)%5)*5;if(Math.abs(x)<2&&Math.abs(z)<2)h+=25;const c=palettes[Math.abs(x*7+z*3)%palettes.length];let b=box(px,h/2,pz,19,h,19,mat(c,.58));box(px,h+.25,pz,19.4,.5,19.4,mat(0xb18463));
 for(let side=-1;side<=1;side+=2)for(let j=1;j<h/4;j++){box(px+side*9.72,j*4,pz, .09,1.25,13,mat(j%2?0x8dd2d0:0xf4d59e,.3));}}
 for(let i=-7;i<=7;i++)for(let z of [-155,-120,120,150]){let x=i*22;box(x,3,z,.4,6,.4,trunk);let crown=new THREE.Mesh(new THREE.ConeGeometry(3,8,7),palm);crown.position.set(x,8,z);scene.add(crown);}
 // Causeway connects the resort strip to the industrial shore.
 box(115,.2,-40,14,.5,160,mat(0x9d9884));for(let i=0;i<8;i++)box(115,2+i%2,-110+i*19,1,.18,3,white);
 for(let i=0;i<45;i++){let x=-150+(i*67%300),z=-150+(i*91%290);if(Math.abs((x+170)%34-17)<9||Math.abs((z+170)%34-17)<9)continue;box(x,.6,z,1.2,1.2,1.2,mat(0xb78c5c));}
 return {size:CITY.size,block:CITY.block};
}
