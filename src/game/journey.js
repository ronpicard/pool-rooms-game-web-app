import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One connected route. Door positions, pool steps, meshes and collision use these same dimensions.
const ROOMS = [
  { name: 'Blue Arcade', x0: 48, x1: 96, z0: 0, z1: 24, h: 12, entry: 12, exit: 12, color: 0x639bab, pool: [54, 7, 90, 17, 0.6] },
  { name: 'Water passage', x0: 96, x1: 108, z0: 8, z1: 16, h: 3.6, entry: 12, exit: 12, color: 0xa5cbc7 },
  { name: 'Rain Hall', x0: 108, x1: 164, z0: -16, z1: 40, h: 19, entry: 12, exit: 28, color: 0xb4d4ca, pool: [116, -8, 156, 32, 1.8] },
  { name: 'Quiet passage', x0: 164, x1: 176, z0: 24, z1: 32, h: 3.2, entry: 28, exit: 28, color: 0xbfa4a4 },
  { name: 'Sunken Baths', x0: 176, x1: 224, z0: 0, z1: 40, h: 4.8, entry: 28, exit: 12, color: 0xb89fba, pool: [183, 7, 197, 21, 0.9] },
  { name: 'The threshold', x0: 224, x1: 236, z0: 8, z1: 16, h: 3.2, entry: 12, exit: 12, color: 0x6c999c },
  { name: 'Column Sea', x0: 236, x1: 308, z0: -24, z1: 48, h: 23, entry: 12, exit: 12, color: 0x709fa1, pool: [243, -17, 301, 41, 2.1] },
  { name: 'Toward the sky', x0: 308, x1: 336, z0: 8, z1: 16, h: 10, entry: 12, exit: 12, color: 0xe5d1b1 },
  { name: 'Sky Pool', x0: 336, x1: 404, z0: -16, z1: 44, h: 80, entry: 12, exit: null, color: 0xe4c69b, pool: [345, -7, 390, 25, 1.5], outdoor: true },
];
export const REST_SPOT = { x: 413, y: 7, z: 32, yaw: -Math.PI / 2 };
const LEDGE = { x0: 404, x1: 417, z0: 26, z1: 38, floor: 7 };
const inside = (x, z, p) => x > p[0] && x < p[2] && z > p[1] && z < p[3];

export function createJourney({ group, textures, createWater, poolMaterial }) {
  const root = new THREE.Group();
  root.name = 'The journey';
  group.add(root);
  const owned = new Set(), waterMeshes = [], sections = [], walls = [], pools = [], rain = [];
  const material = (color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, ...extra });
    owned.add(m); return m;
  };
  const ivory = material(0xf7efdc, { map: textures.wall });
  const floor = material(0xe3e5dc, { map: textures.floor });
  const brass = material(0xbb9c61, { roughness: 0.35, metalness: 0.45 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffecc9, side: THREE.DoubleSide }); owned.add(glow);
  const shade = new THREE.MeshBasicMaterial({ color: 0x254c59, map: textures.glow, transparent: true, opacity: 0.22, depthWrite: false }); owned.add(shade);
  const lightPatch = new THREE.MeshBasicMaterial({ color: 0xffe9ba, map: textures.glow, transparent: true, opacity: 0.23, depthWrite: false }); owned.add(lightPatch);
  const rainMaterial = new THREE.MeshBasicMaterial({ color: 0xd5ffff, transparent: true, opacity: 0.21, depthWrite: false, side: THREE.DoubleSide }); owned.add(rainMaterial);
  const streakCanvas = document.createElement('canvas'); streakCanvas.width=64; streakCanvas.height=256;
  const streakContext = streakCanvas.getContext('2d');
  for(let i=0;i<18;i++) {
    const x=(i*37)%64, y=(i*73)%256;
    const gradient=streakContext.createLinearGradient(0,y,0,y+60);
    gradient.addColorStop(0,'#ffffff00'); gradient.addColorStop(0.5,'#ffffffbb'); gradient.addColorStop(1,'#ffffff00');
    streakContext.fillStyle=gradient; streakContext.fillRect(x,y,1,60);
  }
  const streaks=new THREE.CanvasTexture(streakCanvas); streaks.wrapS=streaks.wrapT=THREE.RepeatWrapping;
  streaks.repeat.set(5,4); owned.add(streaks); rainMaterial.map=streaks; rainMaterial.opacity=0.65;
  let section, batches;
  function geometry(geo, mat, x, y, z, rotation = null) {
    if (rotation) geo.rotateX(rotation[0]).rotateY(rotation[1]).rotateZ(rotation[2]);
    geo.translate(x, y, z);
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push(geo);
  }
  function box(x, y, z, w, h, d, mat = ivory, solid = false) {
    const geo = new THREE.BoxGeometry(w, h, d);
    // World-scale tile UVs survive geometry batching, even on very large walls.
    const pos = geo.attributes.position, normal = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (Math.abs(normal.getX(i)) > 0.5 ? pos.getZ(i) + z : pos.getX(i) + x) / 4,
        (Math.abs(normal.getY(i)) > 0.5 ? pos.getZ(i) + z : pos.getY(i) + y) / 4);
    }
    geometry(geo, mat, x, y, z);
    if (solid) walls.push({ x0: x-w/2, x1: x+w/2, y0: y-h/2, y1: y+h/2, z0: z-d/2, z1: z+d/2 });
  }
  function finish() {
    for (const [mat, list] of batches) {
      const merged = mergeGeometries(list);
      list.forEach(g => g.dispose());
      owned.add(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      section.add(mesh);
    }
    root.add(section);
  }
  function arch(x, z, radius, spring, accent) {
    // A half torus is a real opening: rounded masonry, not a decal on a closed wall.
    geometry(new THREE.TorusGeometry(radius, 0.38, 6, 24, Math.PI), accent, x, spring, z, [0, Math.PI / 2, 0]);
    for (const side of [-1, 1]) {
      box(x, spring/2, z + side*radius, 0.8, spring, 0.8, accent, true);
      box(x, 0.25, z + side*radius, 1.1, 0.5, 1.1, ivory);
    }
  }
  function portal(r, x, center) {
    const h = r.outdoor ? 6 : r.h;
    const threshold = r.name === 'Toward the sky' && x === r.x1 ? 6 : 0;
    if (center === null) {
      // The final terrace opens onto the overlook instead of ending at a solid wall.
      for (const [z0,z1] of [[r.z0,LEDGE.z0],[LEDGE.z1,r.z1]]) {
        box(x,1,(z0+z1)/2,0.6,2,z1-z0,ivory,true);
      }
      return;
    }
    const low = center-4, high = center+4;
    if (low > r.z0) box(x, h/2, (r.z0+low)/2, 0.6, h, low-r.z0, ivory, true);
    if (high < r.z1) box(x, h/2, (high+r.z1)/2, 0.6, h, r.z1-high, ivory, true);
    if (h > threshold+3.2) box(x, (h+threshold+3.2)/2, center, 0.6, h-threshold-3.2, 8, ivory, true);
    box(x-0.32, threshold+2.8, center, 0.05, 0.1, 7.8, glow);
  }
  function basin(p, room) {
    pools.push([...p, room.outdoor ? 6 : 0]);
    const [x0,z0,x1,z1,depth] = p;
    const count = Math.ceil(depth/0.25);
    // Nested quarter-unit steps: every visible tread is also walkable terrain.
    for (let i = 0; i <= count; i++) {
      const inset = i*0.6, next = (i+1)*0.6, y = -Math.min(depth, (i+1)*0.25);
      if (i === count) box((x0+x1)/2, -depth-0.15, (z0+z1)/2, x1-x0-2*inset, 0.3, z1-z0-2*inset, poolMaterial);
      else {
        box((x0+x1)/2, y-0.15, z0+inset+0.3, x1-x0-2*inset, 0.3, 0.6, poolMaterial);
        box((x0+x1)/2, y-0.15, z1-inset-0.3, x1-x0-2*inset, 0.3, 0.6, poolMaterial);
        box(x0+inset+0.3, y-0.15, (z0+z1)/2, 0.6, 0.3, z1-z0-2*next, poolMaterial);
        box(x1-inset-0.3, y-0.15, (z0+z1)/2, 0.6, 0.3, z1-z0-2*next, poolMaterial);
      }
    }
    const water = createWater(x0,z0,x1,z1,-0.12,depth);
    water.name = room.name + ' water'; section.add(water); waterMeshes.push(water); owned.add(water.geometry);
  }
  for (const r of ROOMS) {
    section = new THREE.Group(); section.name = r.name; batches = new Map();
    const wallStart = walls.length;
    sections.push({ root: section, room: r });
    const accent = material(r.color, { map: textures.wall });
    const cx = (r.x0+r.x1)/2, cz = (r.z0+r.z1)/2, w = r.x1-r.x0, d = r.z1-r.z0;
    const roomPools = r.pool ? [r.pool] : [];
    if (r.name === 'Sunken Baths') roomPools.push([203, 22, 217, 34, 0.9]);
    // Split the deck around basins; there is no invisible solid floor beneath the water.
    const xs = [...new Set([r.x0,r.x1,...roomPools.flatMap(p => [p[0],p[2]])])].sort((a,b)=>a-b);
    const zs = [...new Set([r.z0,r.z1,...roomPools.flatMap(p => [p[1],p[3]])])].sort((a,b)=>a-b);
    for (let a=0; a<xs.length-1; a++) for(let b=0;b<zs.length-1;b++) {
      const x=(xs[a]+xs[a+1])/2, z=(zs[b]+zs[b+1])/2;
      if (!roomPools.some(p=>inside(x,z,p))) box(x,-0.2,z,xs[a+1]-xs[a],0.4,zs[b+1]-zs[b],floor);
    }
    if (r.name === 'Toward the sky') {
      for (let i=0;i<24;i++) box(r.x0+(i+0.5)*w/24,(i+1)*0.25-0.15,cz,w/24,0.3,d,floor);
    }
    roomPools.forEach(p=>basin(p,r));
    for (const z of [r.z0,r.z1]) {
      box(cx,r.outdoor?0.75:r.h/2,z,w,r.outdoor?1.5:r.h,0.6,ivory,true);
      box(cx,0.55,z+(z===r.z0?0.32:-0.32),w,1.1,0.08,accent);
      if (!r.outdoor) box(cx,r.h-0.65,z+(z===r.z0?0.34:-0.34),w,0.18,0.1,glow);
    }
    portal(r,r.x0,r.entry); portal(r,r.x1,r.exit);
    if (!r.outdoor) {
      box(cx,r.h+0.2,cz,w,0.4,d,ivory);
      // Luminous overhead openings and projected patches give low quality the same composition.
      for (let x=r.x0+8; x<r.x1-4; x+=14) {
        geometry(new THREE.CircleGeometry(r.h>10?3.8:1.3,32),glow,x,r.h-0.04,cz,[Math.PI/2,0,0]);
        // Flatten first, then rotate around the vertical axis so the light stays on the tiles.
        geometry(new THREE.PlaneGeometry(4,r.h>10?13:5),lightPatch,x+2,0.025,r.z1-3,[-Math.PI/2,0.4,0]);
      }
    }
    // A continuous inlaid blue tile border quietly links the thresholds.
    box(cx,0.015,r.z1-1.2,w-0.6,0.025,0.18,accent);
    if (r.name==='Blue Arcade') {
      for(let x=54;x<96;x+=8) arch(x,12,8,3.6,accent);
      for(let x=57;x<94;x+=12) box(x,3.6,0.34,5,3.4,0.08,glow);
    }
    if(r.name==='Rain Hall') {
      for(const x of [124,148]) for(const z of [0,24]) {
        geometry(new THREE.TorusGeometry(2.8,0.22,6,32),brass,x,18.7,z,[Math.PI/2,0,0]);
        geometry(new THREE.CircleGeometry(2.8,32),glow,x,18.94,z,[Math.PI/2,0,0]);
        const sheet = new THREE.Mesh(new THREE.CylinderGeometry(2.55,2.65,18.5,16,1,true),rainMaterial);
        sheet.position.set(x,9.2,z); section.add(sheet); owned.add(sheet.geometry); rain.push(sheet);
        geometry(new THREE.CircleGeometry(3.2,32),lightPatch,x,0.03,z,[-Math.PI/2,0,0]);
      }
      for(const x of [112,160]) for(const z of [-10,34]) box(x,9.5,z,1.6,19,1.6,accent,true);
    }
    if(r.name==='Sunken Baths') {
      // Offset partitions create two side baths and reconnect around both ends.
      box(200,2.4,12,1,4.8,16,accent,true);
      box(200,2.4,34,1,4.8,8,accent,true);
      arch(180,28,3.3,1.8,accent); arch(220,12,3.3,1.8,accent);
      for(const x of [185,210]) box(x,0.4,2,7,0.8,1.6,ivory,true);
    }
    if(r.name==='Column Sea') {
      for(let x=249;x<301;x+=12) for(let z=-10;z<=34;z+=11) {
        if (z === 12) continue; // Keep the dry bridge clear through the column forest.
        geometry(new THREE.CylinderGeometry(0.95,1.15,25.1,12),ivory,x,10.45,z);
        walls.push({x0:x-1.15,x1:x+1.15,z0:z-1.15,z1:z+1.15,y0:-2,y1:23});
        geometry(new THREE.PlaneGeometry(7,7),shade,x,0.015,z,[-Math.PI/2,0,0]);
      }
      // Narrow bridge is an optional dry crossing through the column forest.
      box(272,0,12,58,0.3,3.6,ivory);
    }
    if(r.outdoor) {
      for(const x of [340,400]) for(const z of [-12,40]) box(x,5,z,1.2,10,1.2,ivory,true);
      for(const z of [-12,40]) box(370,10,z,61,0.5,1.4,ivory);
      for(let x=341;x<400;x+=4) box(x,10.3,40,0.35,0.3,7,brass);
      for(const x of [351,361]) {
        box(x,0.55,32,1.8,0.22,3.6,ivory,true);
        box(x,0.9,33.25,1.8,0.85,0.28,ivory,true);
        for(const z of [30.8,33.2]) box(x,0.25,z,1.6,0.5,0.15,brass);
      }
      // Four broad steps climb from the terrace to a small cantilevered overlook.
      for (let i=0;i<4;i++) box(400.5+i,(i+1)*0.25-0.15,32,1,0.3,8,floor);
      box((LEDGE.x0+LEDGE.x1)/2,0.7,32,LEDGE.x1-LEDGE.x0,0.6,12,ivory);
      // Slender brass rails leave the water view open while their matching colliders contain jumps.
      for (const z of [LEDGE.z0,LEDGE.z1]) {
        box(410.5,2.2,z,13,0.08,0.08,brass);
        for (const x of [404,408,412,417]) box(x,1.6,z,0.08,1.25,0.08,brass);
        walls.push({x0:404,x1:417,y0:1,y1:2.25,z0:z-0.06,z1:z+0.06});
      }
      box(417,2.2,32,0.08,0.08,12,brass);
      for (const z of [26,30,34,38]) box(417,1.6,z,0.08,1.25,0.08,brass);
      walls.push({x0:416.94,x1:417.06,y0:1,y1:2.25,z0:26,z1:38});
      // The chair faces east, away from the architecture and toward the ocean horizon.
      box(REST_SPOT.x,1.55,32,3.6,0.22,1.8,ivory,true);
      box(REST_SPOT.x-1.25,1.9,32,0.28,0.85,1.8,ivory,true);
      for (const x of [411.8,414.2]) box(x,1.25,32,0.15,0.5,1.6,brass);
      const ocean=createWater(400,-1000,1400,1000,-3.5,8);
      ocean.name='Ocean beyond the overlook';
      section.add(ocean); waterMeshes.push(ocean); owned.add(ocean.geometry);
      // Distant cloud silhouettes use the existing soft texture, no downloaded assets.
      const cloudMat = new THREE.SpriteMaterial({map:textures.glow,color:0xffffff,transparent:true,opacity:0.7,depthWrite:false}); owned.add(cloudMat);
      for(let i=0;i<12;i++) {
        const cloud = new THREE.Sprite(cloudMat); cloud.position.set(350+(i%4)*23,21+Math.sin(i*2)*6,-65-Math.floor(i/4)*22);
        cloud.scale.set(42,12,1); section.add(cloud);
      }
    }
    finish();
    if (r.outdoor) {
      section.position.y = 6;
      for(let i=wallStart;i<walls.length;i++) { walls[i].y0+=6; walls[i].y1+=6; }
    }
  }
  // Close the former procedural exits; the east arcade is the Pavilion's sole onward route.
  section = new THREE.Group(); section.name='Pavilion perimeter'; batches=new Map();
  box(-24,8,12,0.6,16,72,ivory,true);
  for(const z of [-24,48]) box(12,8,z,72,16,0.6,ivory,true);
  for(const [z,d] of [[-8,32],[32,32]]) box(48,8,z,0.6,16,d,ivory,true);
  finish();
  const bridge = (x,z) => x>=243 && x<=301 && Math.abs(z-12)<1.8;
  function terrain(x,z) {
    if (x>=400 && x<LEDGE.x0 && z>=28 && z<=36) return {floor:6+Math.min(4,Math.floor(x-400)+1)*0.25,water:NaN};
    if (x>=LEDGE.x0 && x<=LEDGE.x1 && z>=LEDGE.z0 && z<=LEDGE.z1) return {floor:LEDGE.floor,water:NaN};
    if(x>=308 && x<336) return {floor:Math.min(6,(Math.floor((x-308)/(28/24))+1)*0.25),water:NaN};
    if(bridge(x,z)) return {floor:0.15,water:NaN};
    const p=pools.find(p=>inside(x,z,p));
    if(!p) return {floor:x>=336?6:0,water:NaN};
    const edge=Math.min(x-p[0],p[2]-x,z-p[1],p[3]-z);
    return {floor:p[5]-Math.min(p[4],(Math.floor(edge/0.6)+1)*0.25),water:p[5]-0.12};
  }
  return {
    root, walls, waterMeshes, terrain,
    roomAt(x,z) {
      if (x>=LEDGE.x0 && x<=LEDGE.x1 && z>=LEDGE.z0 && z<=LEDGE.z1) return ROOMS[ROOMS.length-1];
      return ROOMS.find(r=>x>=r.x0 && x<r.x1 && z>=r.z0 && z<=r.z1) || null; },
    restAvailable(x,z,y) { return Math.hypot(x-REST_SPOT.x,z-REST_SPOT.z)<3 && Math.abs(y-REST_SPOT.y)<1; },
    update(x) { for(const s of sections) s.root.visible=x>s.room.x0-160 && x<s.room.x1+160; },
    setTime(t) { streaks.offset.y=t*0.6; for(const sheet of rain) sheet.rotation.y=t*0.025; },
    dispose() { owned.forEach(o=>o.dispose()); waterMeshes.forEach(w=>w.material.dispose()); root.removeFromParent(); },
  };
}
