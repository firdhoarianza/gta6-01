import {CITY,COLORS} from './config.js';
const DISTRICTS=[{name:'Downtown',color:0x97b8b0,height:5},{name:'Docks',color:0xc3a37a,height:1},{name:'Suburbs',color:0xe4c99f,height:0},{name:'Industrial',color:0x9b9d91,height:2},{name:'Beach Park',color:0xf0d49b,height:0},{name:'Ghetto',color:0xc58d76,height:1}];
export function buildCity(scene){const mat=(c,r=.8)=>new THREE.MeshStandardMaterial({color:c,roughness:r}),ground=mat(0xc8ae83),road=mat(COLORS.road),sand=mat(COLORS.sand),sea=mat(COLORS.sea),paint=mat(0xf1dfb4),green=mat(0x35664d),trunk=mat(0x806044),sidewalk=mat(0x9f9b8b);
 const boxGeo=new THREE.BoxGeometry(1,1,1);function box(x,y,z,sx,sy,sz,m){const o=new THREE.Mesh(boxGeo,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=sy>1;o.receiveShadow=true;scene.add(o);return o;}
 box(0,-.3,0,470,.5,470,ground);box(0,-.22,-239,480,.25,20,sand);box(0,-.3,-262,500,.4,28,sea);
 for(let n=-6;n<=6;n++){const lane=n*CITY.block;box(0,-.04,lane,470,.16,CITY.road,road);box(lane,-.04,0,CITY.road,.16,470,road);box(0,.035,lane,470,.025,.13,paint);box(lane,.035,0,.13,.025,470,paint);
 for(let k=-6;k<=6;k++){let p=k*CITY.block;for(let offset of [-3.2,3.2]){box(p+offset,.02,lane,1.1,.08,.13,paint);box(lane,.02,p+offset,.13,.08,1.1,paint);}box(lane+7.5,.03,p,4,.1,4,sidewalk);box(p,.03,lane+7.5,4,.1,4,sidewalk);}}
 const districtMats=DISTRICTS.map((d,i)=>mat([0xe7c29b,0xc7b394,0xf0d5ac,0x9e9d91,0xf2d196,0xc58f7d][i],.7));let count=0;
 for(let gx=-6;gx<=6;gx++)for(let gz=-6;gz<=6;gz++){const x=gx*CITY.block+17,z=gz*CITY.block+17;if(Math.abs(x)>220||z>210||z< -210)continue;const d=x<-105?1:z>105?2:x>105?3:z< -105?4:Math.abs(x)<60?0:5;if(Math.abs(gx)<1&&Math.abs(gz)<1)continue;const seed=Math.abs(gx*71+gz*113+991),floors=3+seed%8+(d===0?5:0),h=6+floors*3.3;let w=12+seed%8,dep=12+(seed*7)%9;
 box(x,h/2,z,w,h,dep,districtMats[d]);box(x,h+.16,z,w+.45,.32,dep+.45,mat(d===3?0x6c6d68:d===1?0x8c775b:0xb88962));
 const windowMat=mat(d===0?0x91c7c1:0x75a8a5,.24,.25);windowMat.emissive=new THREE.Color(0xf2b76a);windowMat.emissiveIntensity=.02;const rows=Math.min(10,Math.floor(h/3.6));for(let r=1;r<rows;r++){for(let side of [-1,1]){box(x+side*(w/2+.025),r*3.2,z,w*.72,.92,.055,windowMat);box(x,r*3.2,z+side*(dep/2+.025),.055,.92,dep*.72,windowMat);}}count++;
 if(d===2||d===4){box(x+w/2+1,2,z,.18,4,.18,trunk);const crown=new THREE.Mesh(new THREE.ConeGeometry(2.5,6,7),green);crown.position.set(x+w/2+1,6,z);scene.add(crown);} }
 // Recognizable district silhouettes beyond the block grid, kept intentionally low-poly.
 for(let i=0;i<18;i++){let x=-210+i*24,z=170+(i%3)*11,h=22+(i*19%52);box(x,h/2,z,17,h,15,mat(i%2?0x798782:0x9c9d8e));}
 // Lamps, hydrants, benches, fencing and lit intersections are cheap shared primitive meshes.
 const lampMat=mat(0x34444a,.5),lampGlow=new THREE.MeshBasicMaterial({color:0xffd99a});for(let n=-6;n<=6;n++)for(let k=-6;k<=6;k++){if((n+k)%2)continue;let x=n*CITY.block+8,z=k*CITY.block+8;box(x,.9,z,.15,1.8,.15,lampMat);box(x+.5,1.8,z,.9,.12,.18,lampMat);const bulb=new THREE.Mesh(new THREE.SphereGeometry(.14,6,5),lampGlow);bulb.position.set(x+.9,1.75,z);scene.add(bulb);}
 const hydrant=mat(0xc1483c),bench=mat(0x614c38);for(let i=0;i<48;i++){let x=-198+(i*71%396),z=-198+(i*97%396);if(i%3===0){box(x,.42,z,.42,.8,.42,hydrant);box(x,.65,z,.7,.14,.14,hydrant);}else{box(x,.62,z,2.4,.18,.65,bench);box(x,.3,z-.2,.15,.5,.15,lampMat);box(x,.3,z+.2,.15,.5,.15,lampMat);}}
 for(let i=0;i<10;i++){let z=-180+i*37;box(115,.25,z,14,.5,24,mat(0x9d9884));box(108,1.2,z,1,2.4,24,mat(0x777a70));box(122,1.2,z,1,2.4,24,mat(0x777a70));}
 return {size:470,block:CITY.block,districts:DISTRICTS,buildings:count};}
