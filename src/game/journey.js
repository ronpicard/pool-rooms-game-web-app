import { tileFinish, createWetDeck, wetEdgeGeometry, addWallCaustics } from './surfaces.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { textures as textureFactory } from './textures.js';
import { createSlide, createBeachBalls } from './pool-toys.js';
import { createRainfall, createPoolSteam } from './water-effects.js';
import { createLazyRiver, RIVER_FOOTPRINT } from './lazy-river.js';
import { addRoomDetails } from './room-details.js';
import { PAVILION } from './landmark.js';

// One connected route. Door positions, pool steps, meshes and collision use these same dimensions.
const ROOMS = [
  { name: 'Blue Arcade', x0: 48, x1: 96, z0: 0, z1: 24, h: 12, entry: 12, exit: 12, color: 0x639bab, pool: [54, 7, 90, 17, 0.6] },
  { name: 'Water passage', x0: 96, x1: 108, z0: 8, z1: 16, h: 3.6, entry: 12, exit: 12, color: 0xa5cbc7 },
  { name: 'Rain Hall', x0: 108, x1: 164, z0: -44, z1: 40, h: 26, entry: 12, exit: 28, northDoor: 136, southDoor: 124, hiddenSouth: true, color: 0xb4d4ca, pool: [116, -36, 156, 32, 3.5] },
  { name: 'Quiet passage', x0: 164, x1: 176, z0: 24, z1: 32, h: 3.2, entry: 28, exit: 28, color: 0xbfa4a4 },
  { name: 'Sunken Baths', x0: 176, x1: 224, z0: 0, z1: 40, h: 4.8, entry: 28, exit: 12, southDoor: 210, southDestination: 'Lazy River', color: 0xb89fba, pool: [183, 7, 197, 21, 0.9] },
  { name: 'The threshold', x0: 224, x1: 236, z0: 8, z1: 16, h: 3.2, entry: 12, exit: 12, color: 0x6c999c },
  { name: 'Column Sea', x0: 236, x1: 308, z0: -48, z1: 72, h: 29, entry: 12, exit: 12, southDoor: 272, color: 0x709fa1, pool: [243, -41, 301, 65, 4.5] },
  { name: 'Toward the sky', x0: 308, x1: 336, z0: 8, z1: 16, h: 10, entry: 12, exit: 12, color: 0xe5d1b1 },
  { name: 'Sky Pool', x0: 336, x1: 404, z0: -16, z1: 44, h: 80, entry: 12, exit: null, color: 0xe4c69b, pool: [345, -7, 390, 25, 1.5], outdoor: true },
  { name: 'Changing Gallery', x0: 116, x1: 156, z0: -76, z1: -44, h: 7.5, southDoor: 136, color: 0x7ba9a3, pool: [123, -67, 149, -55, 0.6], branch: true, returnTo: 'Rain Hall' },
  { name: 'Lantern Baths', x0: 248, x1: 296, z0: 72, z1: 112, h: 9, entry: 92, northDoor: 272, color: 0xbb896f, pool: [254, 80, 290, 104, 1.2], branch: true, returnTo: 'Column Sea' },
  { name: 'Rain Garden', x0: 116, x1: 144, z0: 40, z1: 64, h: 6, northDoor: 124, color: 0x89b79e, pool: [122, 46, 138, 58, 0.9], branch: true, returnTo: 'Rain Hall' },
  { name: 'Stillwater Nook', x0: 182, x1: 200, z0: 58, z1: 78, h: 4.8, exit: 68, color: 0xe0bc93, pool: [184, 62, 194, 72, 0.6], branch: true, returnTo: 'Lazy River' },
];
const SKY_POOL = ROOMS.find(room => room.name === 'Sky Pool');
const PIER_CENTER_Z = (SKY_POOL.z0 + SKY_POOL.z1) / 2;
const LEDGE = { x0: 404, x1: 484, z0: PIER_CENTER_Z-6, z1: PIER_CENTER_Z+6, floor: 7 };
export const REST_SPOT = { x: 480, y: 7, z: PIER_CENTER_Z, yaw: -Math.PI / 2, room: 'Sky Pool', ending: true };
const REST_STOPS = [
  { x: 112, y: 0, z: 20, yaw: -Math.PI / 2, room: 'Rain Hall', caption: 'Let the rain fill the silence.' },
  ...[185, 210].map(x => ({ x, y: 0, z: 2, yaw: Math.PI, room: 'Sunken Baths', caption: 'Stay as long as you like.' })),
  ...[351, 361].map(x => ({ x, y: 6, z: 32, yaw: 0, room: 'Sky Pool', caption: 'A little sun. A little stillness.' })),
  { x: 136, y: 0, z: -70.7, yaw: Math.PI, room: 'Changing Gallery', caption: 'Leave the outside world at the door.' },
  ...[259,285].map(x=>({x,y:0,z:108,yaw:0,room:'Lantern Baths',caption:'Water and a little warmth.'})),
  { x: 140, y: 0, z: 59, yaw: Math.PI / 2, room: 'Rain Garden', caption: 'A garden, hidden in the sound of rain.' },
  { x: 197, y: 0, z: 75, yaw: 0, room: 'Stillwater Nook', caption: 'Let the river go on without you.' },
  { x: 202.5, y: 0, z: 78, yaw: -Math.PI / 2, room: 'Lazy River', caption: 'A little pause beside the current.' },
  REST_SPOT,
];
const inside = (x, z, p) => x > p[0] && x < p[2] && z > p[1] && z < p[3];

export function createJourney({ group, textures, createWater, poolMaterial }) {
  const root = new THREE.Group();
  root.name = 'The journey';
  group.add(root);
  const owned = new Set(), waterMeshes = [], sections = [], walls = [], pools = [], rainSources = [];
  const slides = [], beachBalls = [], waterEffects = [];
  const interactions = [], animations = [], rainControl = { quiet: false };
  let river;
  const material = (color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, ...tileFinish(extra.map, textures), ...extra });
    owned.add(m); return m;
  };
  const wetDeck = createWetDeck(textures); owned.add(wetDeck);
  const ivory = material(0xf7efdc, { map: textures.wall });
  const floor = material(0xe3e5dc, { map: textures.floor });
  const ceiling = material(0xe8eee7, { map: textures.ceiling, roughness: 0.92 });
  const brass = material(0xbb9c61, { roughness: 0.35, metalness: 0.45 });
  const coral = material(0xd78065, { roughness: 0.45 });
  const foliage = material(0x608f72, { roughness:0.88 });
  const lantern = new THREE.MeshBasicMaterial({ color: 0xffd497 }); owned.add(lantern);
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
  streaks.repeat.set(5,4); owned.add(streaks); rainMaterial.map=streaks; rainMaterial.opacity=0.18;
  let section, batches;
  function geometry(geo, mat, x, y, z, rotation = null) {
    // Keep the same tile size on curved masonry as on the surrounding walls.
    const p = geo.parameters, uv = geo.attributes.uv;
    if (mat.map === textures.wall && (geo.type === 'CylinderGeometry' || geo.type === 'TorusGeometry')) {
      const circumference = geo.type === 'CylinderGeometry' ? Math.PI * (p.radiusTop + p.radiusBottom) : p.radius * p.arc;
      const height = geo.type === 'CylinderGeometry' ? p.height : 2 * Math.PI * p.tube;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circumference / 4, uv.getY(i) * height / 4);
    }
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
    if (center === undefined) { box(x,h/2,(r.z0+r.z1)/2,0.6,h,r.z1-r.z0,ivory,true); return; }
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
    const lintelY = threshold+3.2;
    if (h > lintelY) box(x, (h+lintelY)/2, center, 0.6, h-lintelY, 8, ivory, true);
    // Mount on this room's lintel face, or against its ceiling when the opening reaches it.
    const inward = x===r.x0 ? 1 : -1;
    box(x+inward*0.32, Math.min(lintelY+0.1,h-0.05), center, 0.05, 0.1, 7.8, glow);
  }
  function sign(destination, x, y, z, yaw, caption = 'Continue your walk') {
    const texture = textureFactory.createLabelTexture(destination, { plaque: true, caption });
    texture.anisotropy = textures.wall.anisotropy; owned.add(texture);
    const mat = material(0xffffff, { map: texture, roughness: 0.65 });
    const geo = new THREE.PlaneGeometry(2.8, 1.05); owned.add(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x,y,z); mesh.rotation.y = yaw;
    mesh.name = 'Wayfinding: ' + destination;
    section.add(mesh);
  }
  function wayfinding(room, destination) {
    // On the east wall, the right-pointing arrow leads toward increasing Z into the opening.
    sign(destination, room.x1-0.32, room.outdoor?0.85:1.9, (room.exit??PIER_CENTER_Z)-(room.outdoor?7.6:5.6), -Math.PI/2);
  }
  function sideWall(room, z, door, accent) {
    const h = room.outdoor ? 1.5 : room.h;
    const ranges = door === undefined ? [[room.x0,room.x1]] : [[room.x0,door-4],[door+4,room.x1]];
    const inward = z===room.z0 ? 1 : -1;
    for (const [x0,x1] of ranges) {
      box((x0+x1)/2,h/2,z,x1-x0,h,0.6,ivory,true);
      // Ocean-facing parapets remain protective even at the apex of a sprint jump.
      if (room.outdoor) walls[walls.length-1].y1 = 3.5;
      box((x0+x1)/2,0.55,z+inward*0.32,x1-x0,1.1,0.08,accent);
    }
    if (door !== undefined) {
      box(door,(h+3.2)/2,z,8,h-3.2,0.6,ivory,true);
      box(door,3.3,z+inward*0.32,7.8,0.1,0.05,glow);
      const destination = room.returnTo || (inward === 1 ? room.northDestination || 'Changing Gallery' : room.southDestination || 'Lantern Baths');
      if (!(room.hiddenSouth && inward === -1)) sign(destination,door-inward*5.6,1.9,z+inward*0.32,inward===1?0:Math.PI,room.branch?'Back to the main walk':'A quieter detour');
    }
    if (!room.outdoor) box((room.x0+room.x1)/2,h-0.65,z+inward*0.34,room.x1-room.x0,0.18,0.1,glow);
  }
  function lifebuoy(x,y,z,yaw=0) {
    geometry(new THREE.TorusGeometry(0.72,0.17,8,32),coral,x,y,z,[0,yaw,0]);
    for (let i=0;i<4;i++) geometry(new THREE.TorusGeometry(0.72,0.175,8,8,0.38).rotateZ(i*Math.PI/2),ivory,x,y,z,[0,yaw,0]);
    geometry(new THREE.TorusGeometry(0.99,0.025,5,32),brass,x,y,z,[0,yaw,0]);
  }
  function wallClock(x,y,z,yaw=0) {
    geometry(new THREE.CircleGeometry(0.82,32),ivory,x,y,z,[0,yaw,0]);
    geometry(new THREE.TorusGeometry(0.85,0.07,6,32),brass,x,y,z,[0,yaw,0]);
    for (let i=0;i<12;i++) {
      const angle=i*Math.PI/6, dx=Math.sin(angle)*0.66;
      geometry(new THREE.BoxGeometry(0.035,0.12,0.025).rotateZ(-angle),brass,x+dx*Math.cos(yaw),y+Math.cos(angle)*0.66,z-dx*Math.sin(yaw)+0.025*Math.cos(yaw),[0,yaw,0]);
    }
    for (const [angle,length] of [[-Math.PI/3,0.4],[Math.PI/3,0.57]]) {
      geometry(new THREE.BoxGeometry(0.055,length,0.03).translate(0,length/2,0).rotateZ(-angle),brass,x+0.035*Math.sin(yaw),y,z+0.035*Math.cos(yaw),[0,yaw,0]);
    }
  }
  function towelShelf(x,z,accent) {
    for (const dx of [-2.5,2.5]) box(x+dx,1.1,z,0.16,2.2,1.2,brass,true);
    for (const y of [0.3,1.1,1.9]) {
      box(x,y,z,5,0.12,1.2,ivory,true);
      for (let i=0;i<4;i++) for(let layer=0;layer<2;layer++) box(x-1.8+i*1.2,y+0.14+layer*0.15,z,0.85,0.14,0.8,layer?ivory:accent);
    }
  }
  function basin(p, room, accent) {
    pools.push([...p, room.outdoor ? 6 : 0]);
    const [x0,z0,x1,z1,depth] = p;
    // A narrow glazed border makes the edge readable before you step into the water.
    for (const z of [z0 - 0.14, z1 + 0.14]) box((x0+x1)/2, 0.012, z, x1-x0+0.56, 0.024, 0.28, accent);
    for (const x of [x0 - 0.14, x1 + 0.14]) box(x, 0.012, (z0+z1)/2, 0.28, 0.024, z1-z0, accent);
    const inner = [[x0-0.28,z0-0.28],[x0-0.28,z1+0.28],[x1+0.28,z1+0.28],[x1+0.28,z0-0.28],[x0-0.28,z0-0.28]];
    const outer = [[x0-1,z0-1],[x0-1,z1+1],[x1+1,z1+1],[x1+1,z0-1],[x0-1,z0-1]];
    geometry(wetEdgeGeometry(inner,outer,0.026),wetDeck,0,0,0);
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
    water.material.uniforms.uRain.value = room.name === 'Rain Hall' ? 1 : 0;
    if (room.name === 'Rain Hall') water.material.defines.RAIN = 1;
    water.name = room.name + ' water'; section.add(water); waterMeshes.push(water); owned.add(water.geometry);
    if (['Sunken Baths','Lantern Baths','Rain Garden','Stillwater Nook'].includes(room.name)) {
      const steam = createPoolSteam(p,-0.12,Math.round(x0*17+z0*3));
      section.add(steam.mesh); owned.add(steam.mesh.geometry); owned.add(steam.mesh.material);
      waterEffects.push(steam);
    }
  }
  function toys(room, placements, slideConfigs = []) {
    const elevation = room.outdoor ? 6 : 0;
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
      owned.add(geo);
      const item = new THREE.Mesh(geo, mat);
      item.position.set(x,y,z); item.receiveShadow = true;
      section.add(item); return item;
    };
    const contactGeo = new THREE.PlaneGeometry(1,1);
    beachBalls.push({ root: section, balls: createBeachBalls({
      placements, mesh, material, terrain, walls, elevation,
      bounds: [room.x0,room.z0,room.x1,room.z1],
      contactShadow(x,z,size,y) {
        const shadow = mesh(contactGeo,shade,x,y,z);
        shadow.rotation.x = -Math.PI/2; shadow.scale.set(size,size,1);
        return shadow;
      },
    }) });
    for (const slideConfig of Array.isArray(slideConfigs) ? slideConfigs : [slideConfigs]) {
      const { x, z, height, name, color, points, entrySide = -1, width = 3, treadDepth = 0.625, duration = 5, supportTimes = [0.12,0.35,0.6] } = slideConfig;
      const count = height/0.25, top = z-count*treadDepth, halfWidth = width/2;
      const slideMaterial = material(color,{roughness:0.22,metalness:0.12,side:THREE.DoubleSide});
      const slide = createSlide({
        name, material: slideMaterial, duration,
        points: points.map(([px,py,pz])=>[px,py+elevation,pz]),
        mesh(geo,mat) { return mesh(geo.translate(0,-elevation,0),mat); },
      });
      slides.push(slide);
      // Thin solid treads leave the deck or water beneath the stairs accessible.
      for (let i=0;i<count;i++) box(x,(i+1)*0.25-0.15,z-(i+0.5)*treadDepth,width,0.3,treadDepth,ivory,true);
      box(x+entrySide*0.75,height-0.15,top-1.5,width+1.5,0.3,3,ivory,true);
      // Sloping handrails enclose the stairs; the landing opens directly into the flume.
      for (const side of [-1,1]) {
        const a = new THREE.Vector3(x+side*(halfWidth+0.15),1,z);
        const b = new THREE.Vector3(x+side*(halfWidth+0.15),height+1,top);
        const rail = new THREE.CylinderGeometry(0.07,0.07,a.distanceTo(b),8);
        rail.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));
        const center = a.clone().add(b).multiplyScalar(0.5);
        geometry(rail,brass,center.x,center.y,center.z);
        for(let i=0;i<=count;i+=4) box(a.x,i*0.25+0.5,z-i*treadDepth,0.08,1,0.08,brass);
        // Follow the stair slope instead of extending the railing down to the ground.
        for(let i=0;i<count;i++) walls.push({x0:a.x-0.08,x1:a.x+0.08,z0:z-(i+1)*treadDepth,z1:z-i*treadDepth,y0:(i+1)*0.25-0.3,y1:(i+1)*0.25+2});
      }
      for(const [rx,rz,w,d] of [[x+entrySide*0.75,top-3,width+1.5,0.08],[x-entrySide*(halfWidth+0.15),top-1.5,0.08,3]]) {
        box(rx,height+1,rz,w,0.08,d,brass);
        walls.push({x0:rx-w/2,x1:rx+w/2,z0:rz-d/2,z1:rz+d/2,y0:height,y1:height+2});
      }
      for(const t of supportTimes) {
        const p = slide.curve.getPointAt(t), bottom = terrain(p.x,p.z).floor-elevation;
        const h = p.y-elevation-bottom;
        box(p.x,bottom+h/2,p.z,0.24,h,0.24,brass,true);
      }
      box(x+halfWidth+0.32,1.15,z-0.5,0.08,2.3,0.08,brass);
      sign(name,x+halfWidth+0.27,1.8,z-0.5,-Math.PI/2,'Walk up the steps to ride');
    }
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
    roomPools.forEach(p=>basin(p,r,accent));
    sideWall(r,r.z0,r.northDoor,accent); sideWall(r,r.z1,r.southDoor,accent);
    portal(r,r.x0,r.entry); portal(r,r.x1,r.exit);
    if (r.pool && !r.branch) {
      const next = ROOMS.slice(ROOMS.indexOf(r) + 1).find(room => room.pool && !room.branch);
      wayfinding(r, next?.name || 'Ocean overlook');
    }
    if (!r.outdoor) {
      box(cx,r.h+0.2,cz,w,0.4,d,ceiling);
      // Luminous overhead openings and projected patches give low quality the same composition.
      const ceilingLights = [];
      if (r.name === 'Rain Hall') {
        // The center aisle leaves clear space around both rows of waterfall heads and the columns.
        for (let z=r.z0+12; z<r.z1-4; z+=16) ceilingLights.push([cx,z]);
      } else {
        for (let x=r.x0+8; x<r.x1-4; x+=14) ceilingLights.push([x,cz]);
      }
      for (const [x,z] of ceilingLights) {
        geometry(new THREE.CircleGeometry(r.h>10?3.8:1.3,32),glow,x,r.h-0.04,z,[Math.PI/2,0,0]);
      }
      for (let x=r.x0+8; x<r.x1-4; x+=14) {
        // Flatten first, then rotate around the vertical axis so the light stays on the tiles.
        geometry(new THREE.PlaneGeometry(4,r.h>10?13:5),lightPatch,x+2,0.025,r.z1-3,[-Math.PI/2,0.4,0]);
      }
    }
    // A continuous inlaid blue tile border quietly links the thresholds.
    box(cx,0.015,r.z1-1.2,w-0.6,0.025,0.18,accent);
    if (r.name==='Blue Arcade') {
      for(let x=54;x<96;x+=8) arch(x,12,8,3.6,accent);
      for(let x=57;x<94;x+=12) box(x,3.6,0.34,5,3.4,0.08,glow);
      lifebuoy(84,2.2,23.55,Math.PI);
      wallClock(95.55,4.6,19,-Math.PI/2);
    }
    if(r.name==='Rain Hall') {
      lifebuoy(163.55,2.2,35,-Math.PI/2);
      wallClock(108.45,4.4,30,Math.PI/2);
      // A dry bench faces the falling water and leaves the entrance path clear.
      box(112,0.65,20,1.5,0.24,4.8,ivory,true);
      box(111.38,1.1,20,0.24,0.9,4.8,accent,true);
      for (const z of [18.2,21.8]) box(112,0.3,z,1.1,0.6,0.22,brass);
      for(const x of [124,148]) for(const z of [-24,0,24]) {
        geometry(new THREE.TorusGeometry(2.8,0.22,6,32),brass,x,r.h-0.3,z,[Math.PI/2,0,0]);
        geometry(new THREE.CircleGeometry(2.8,32),glow,x,r.h-0.06,z,[Math.PI/2,0,0]);
        geometry(new THREE.CylinderGeometry(2.55,2.65,r.h-0.5,16,1,true),rainMaterial,x,(r.h-0.5)/2-0.05,z);
        rainSources.push({x, y: 0.25, z});
        geometry(new THREE.CircleGeometry(3.2,32),lightPatch,x,0.03,z,[-Math.PI/2,0,0]);
      }
      const rainfall = createRainfall(rainSources,r.h-0.3,-0.12);
      section.add(rainfall.mesh); owned.add(rainfall.mesh.geometry); owned.add(rainfall.mesh.material);
      waterEffects.push(rainfall);
      const rainWater = waterMeshes.find(water=>water.name==='Rain Hall water');
      rainWater.material.uniforms.uRainSources.value = rainSources.map(source=>new THREE.Vector2(source.x,source.z));
      animations.push(()=>{
        rainfall.mesh.visible=!rainControl.quiet;
        rainMaterial.opacity=rainControl.quiet?0.035:0.18;
        rainWater.material.uniforms.uRain.value=rainControl.quiet?0:1;
        for(const source of rainSources) source.level=rainControl.quiet?0.22:1;
      });
      geometry(new THREE.PlaneGeometry(7.8,3.2),rainMaterial,124,1.6,39.4);
      for(const x of [112,160]) for(const z of [-38,-10,34]) {
        box(x,r.h/2,z,1.6,r.h,1.6,accent,true);
        geometry(new THREE.PlaneGeometry(4.4,4.4),shade,x,0.018,z,[-Math.PI/2,0,0]);
      }
      // Two full turns keep the stacked flume floors seven units apart.
      const spiralPoints = Array.from({length:49},(_,i)=>{
        const angle = -Math.PI/2+i/48*Math.PI*4;
        return [133+Math.cos(angle)*10,17.5-i/48*14,-22.5+Math.sin(angle)*10];
      });
      toys(r,[[132,8,0.9],[141,-14,0.75],[129,25,1.05]],[{
        name:'Rain Slide',x:160,z:20,height:4,color:0x4ebbb9,
        points:[[158,4,8.5],[155,3.8,8.5],[152,3.2,10],[147,2.3,14],[141,1.3,14],[137,0.4,10],[136,-0.05,6]],
      },{
        name:'Rain Spiral',x:114.2,z:10,height:18,entrySide:1,width:2.2,color:0x79cdd1,duration:14,supportTimes:[],
        points:[[116.2,18,-36.5],[122,17.85,-36.5],...spiralPoints,[141,2,-32],[147,0.8,-29],[149,-0.05,-24]],
      }]);
      // A central mast and radial arms support each turn without piercing the lower flume.
      box(133,7,-22.5,0.7,21,0.7,brass,true);
      for(let i=0;i<spiralPoints.length;i+=6) {
        const [x,y,z] = spiralPoints[i], angle = Math.atan2(z+22.5,x-133);
        geometry(new THREE.BoxGeometry(10,0.18,0.22),brass,(133+x)/2,y-0.25,(-22.5+z)/2,[0,-angle,0]);
      }
      for(let i=16;i<=72;i+=16) box(114.2,i*0.125,10-i*0.625,0.24,i*0.25,0.24,brass,true);
      box(114.2,9,-36.5,0.24,18,0.24,brass,true);
    }
    if(r.name==='Sunken Baths') {
      towelShelf(219,2,accent);
      // Offset partitions create two side baths and reconnect around both ends.
      box(200,2.4,12,1,4.8,16,accent,true);
      box(200,2.4,34,1,4.8,8,accent,true);
      arch(180,28,3.3,1.8,accent); arch(220,12,3.3,1.8,accent);
      for(const x of [185,210]) box(x,0.4,2,7,0.8,1.6,ivory,true);
    }
    if(r.name==='Column Sea') {
      lifebuoy(307.55,2.2,22,-Math.PI/2);
      for(let x=249;x<301;x+=12) for(let z=-32;z<=56;z+=11) {
        if (z === 12) continue; // Keep the dry bridge clear through the column forest.
        const depth = r.pool[4];
        geometry(new THREE.CylinderGeometry(0.95,1.15,r.h+depth,12),ivory,x,(r.h-depth)/2,z);
        walls.push({x0:x-1.15,x1:x+1.15,z0:z-1.15,z1:z+1.15,y0:-depth,y1:r.h});
        geometry(new THREE.PlaneGeometry(7,7),shade,x,-2.075,z,[-Math.PI/2,0,0]);
      }
      // Narrow bridge is an optional dry crossing through the column forest.
      box(272,0,12,58,0.3,3.6,ivory);
    }
    if (r.name==='Changing Gallery') {
      for(let x=119;x<=153;x+=3.4) {
        if (Math.abs(x-149.6)<0.01) {
          box(x,1.9,-75.25,2.9,3.8,0.12,accent,true);
          for(const dx of [-1.4,1.4]) box(x+dx,1.9,-74.7,0.1,3.8,1.2,accent,true);
          for(const y of [0.1,1.25,3.75]) box(x,y,-74.7,2.9,0.12,1.2,ivory,true);
          continue;
        }
        box(x,1.9,-74.7,2.9,3.8,1.2,accent,true);
        box(x,1.9,-74.04,2.65,3.5,0.08,ivory);
        box(x+0.85,1.8,-73.94,0.09,0.42,0.1,brass);
        for(let y=2.8;y<=3.2;y+=0.16) box(x,y,-73.98,1.3,0.035,0.03,brass);
      }
      box(136,0.6,-70.7,12,0.22,1.4,ivory,true);
      for(const x of [131,136,141]) box(x,0.3,-70.7,0.2,0.6,1.1,brass);
      towelShelf(120,-48,accent);
      lifebuoy(155.55,2.2,-51,-Math.PI/2);
      wallClock(136,5.1,-75.55);
    }
    if (r.name==='Lantern Baths') {
      for (const x of [258,272,286]) for (const z of [83,101]) {
        box(x,7.5,z,0.035,3,0.035,brass);
        geometry(new THREE.CylinderGeometry(0.55,0.55,1.2,12),lantern,x,5.9,z);
        for(const y of [5.3,6.5]) geometry(new THREE.TorusGeometry(0.58,0.05,5,16),brass,x,y,z,[Math.PI/2,0,0]);
        for(let i=0;i<4;i++) box(x+Math.cos(i*Math.PI/2)*0.55,5.9,z+Math.sin(i*Math.PI/2)*0.55,0.04,1.2,0.04,brass);
      }
      for (const x of [259,285]) box(x,0.5,108,8,1,1.8,ivory,true);
      towelShelf(292,76,accent);
      lifebuoy(248.45,2.2,93,Math.PI/2);
      toys(r,[[265,89,0.7],[281,96,0.85]]);
      sign('Lazy River',248.4,1.8,99,Math.PI/2,'A quieter way to the Sunken Baths');
    }
    if (r.name === 'Rain Garden' || r.name === 'Stillwater Nook') {
      const seat = REST_STOPS.find(spot=>spot.room===r.name);
      box(seat.x,0.5,seat.z,1.5,1,4,ivory,true);
      for(const x of [r.x0+2,r.x1-2]) {
        box(x,0.65,r.z1-2,1.4,1.3,1.4,coral,true);
        box(x,1.6,r.z1-2,0.08,1.4,0.08,brass);
        for(let i=0;i<7;i++) {
          const angle=i*Math.PI*2/7;
          const leaf=new THREE.SphereGeometry(1,10,6).scale(0.32,0.09,1.25).rotateX(-0.38).rotateY(angle);
          geometry(leaf,foliage,x+Math.sin(angle)*0.7,2.1+(i%2)*0.25,r.z1-2+Math.cos(angle)*0.7);
        }
      }
      arch(r.x1-2,(r.z0+r.z1)/2,3,1.3,accent);
    }
    if(r.outdoor) {
      const skySpiralPoints = Array.from({length:49},(_,i)=>{
        const angle = -Math.PI/2-i/48*Math.PI*4;
        return [360+Math.cos(angle)*11,19.5-i/48*16,7+Math.sin(angle)*11];
      });
      toys(r,[[360,4,0.9],[376,15,1.05],[388,8,0.7]],[{
        name:'Sunset Slide',x:395,z:9,height:3.5,color:0xed9271,
        points:[[393,3.5,-1.25],[390,3.3,-1.25],[386,2.8,2],[380,2,5],[375,1.1,2],[377,0.4,-1],[379,-0.05,0]],
      },{
        // Shorter treads keep the southern deck route to the pier open.
        name:'Sky Spiral',x:383,z:26,height:20,treadDepth:0.45,color:0x77b9df,duration:15,supportTimes:[],
        points:[[381,20,-11.5],[373,19.85,-11.5],...skySpiralPoints,[353,2,-2],[352,0.8,3],[355,-0.05,6]],
      }]);
      // Support both broad turns from the center, leaving the flume and splashdown clear.
      box(360,9,7,0.7,21,0.7,brass,true);
      for(let i=0;i<skySpiralPoints.length;i+=6) {
        const [x,y,z] = skySpiralPoints[i], angle = Math.atan2(z-7,x-360);
        geometry(new THREE.BoxGeometry(11,0.18,0.22),brass,(360+x)/2,y-0.25,(7+z)/2,[0,-angle,0]);
      }
      for(const i of [16,32,56,72,80]) {
        const z=26-i*0.45, height=i*0.25;
        // Query the basin beside the stairs so the legs reach the actual pool floor.
        const floorY=terrain(385,z).floor-6;
        box(383,(floorY+height)/2,z,0.24,height-floorY,0.24,brass,true);
      }
      box(383,10,-11.5,0.24,20,0.24,brass,true);
      for(const x of [340,400]) for(const z of [-12,40]) box(x,5,z,1.2,10,1.2,ivory,true);
      for(const z of [-12,40]) box(370,10,z,61,0.5,1.4,ivory);
      for(let x=341;x<400;x+=4) box(x,10.3,40,0.35,0.3,7,brass);
      for(const x of [351,361]) {
        box(x,0.55,32,1.8,0.22,3.6,ivory,true);
        box(x,0.9,33.25,1.8,0.85,0.28,ivory,true);
        for(const z of [30.8,33.2]) box(x,0.25,z,1.6,0.5,0.15,brass);
      }
      // Four broad steps climb from the terrace to the centered ocean pier.
      for (let i=0;i<4;i++) box(400.5+i,(i+1)*0.25-0.15,PIER_CENTER_Z,1,0.3,8,floor);
      box((LEDGE.x0+LEDGE.x1)/2,0.7,PIER_CENTER_Z,LEDGE.x1-LEDGE.x0,0.6,12,ivory);
      // Slender brass rails leave the water view open while their matching colliders contain jumps.
      for (const z of [LEDGE.z0,LEDGE.z1]) {
        box((LEDGE.x0+LEDGE.x1)/2,2.2,z,LEDGE.x1-LEDGE.x0,0.08,0.08,brass);
        for (let x=LEDGE.x0;x<=LEDGE.x1;x+=4) box(x,1.6,z,0.08,1.25,0.08,brass);
        walls.push({x0:LEDGE.x0,x1:LEDGE.x1,y0:1,y1:4.5,z0:z-0.06,z1:z+0.06});
      }
      for (let x=LEDGE.x0+8;x<LEDGE.x1-4;x+=8) {
        box(x,1.012,PIER_CENTER_Z,0.06,0.024,11.5,brass);
        for (const z of [LEDGE.z0+0.3,LEDGE.z1-0.3]) {
          box(x,1.5,z,0.25,1,0.25,brass);
          box(x,2.03,z,0.32,0.12,0.32,glow);
        }
      }
      box(LEDGE.x1,2.2,PIER_CENTER_Z,0.08,0.08,12,brass);
      for (let z=LEDGE.z0;z<=LEDGE.z1;z+=4) box(LEDGE.x1,1.6,z,0.08,1.25,0.08,brass);
      walls.push({x0:LEDGE.x1-0.06,x1:LEDGE.x1+0.06,y0:1,y1:4.5,z0:LEDGE.z0,z1:LEDGE.z1});
      // The chair faces east, away from the architecture and toward the ocean horizon.
      box(REST_SPOT.x,1.55,PIER_CENTER_Z,3.6,0.22,1.8,ivory,true);
      box(REST_SPOT.x-1.25,1.9,PIER_CENTER_Z,0.28,0.85,1.8,ivory,true);
      for (const x of [REST_SPOT.x-1.2,REST_SPOT.x+1.2]) box(x,1.25,PIER_CENTER_Z,0.15,0.5,1.6,brass);
      const oceanCenterX = (LEDGE.x0+LEDGE.x1)/2;
      const ocean=createWater(oceanCenterX-1000,PIER_CENTER_Z-1000,oceanCenterX+1000,PIER_CENTER_Z+1000,-3.5,8,{
        ocean:true,
        // Cut out each indoor footprint, leaving ocean in the gaps between buildings.
        // Room walls extend 0.3 units outward; end the cutouts inside that masonry.
        landBounds:[
          ...[PAVILION,...ROOMS.filter(room=>!room.outdoor)].map(room=>[room.x0-0.2,room.z0-0.2,room.x1+0.2,room.z1+0.2]),
          ...RIVER_FOOTPRINT.bounds,
        ],
        landArcs:RIVER_FOOTPRINT.arcs,
      });
      ocean.name='Ocean beyond the overlook';
      section.add(ocean); waterMeshes.push(ocean); owned.add(ocean.geometry);
      // Distant cloud silhouettes use the existing soft texture, no downloaded assets.
      const cloudMat = new THREE.SpriteMaterial({map:textures.glow,color:0xffffff,transparent:true,opacity:0.7,depthWrite:false}); owned.add(cloudMat);
      for(let i=0;i<12;i++) {
        const cloud = new THREE.Sprite(cloudMat); cloud.position.set(350+(i%4)*23,21+Math.sin(i*2)*6,-65-Math.floor(i/4)*22);
        cloud.scale.set(42,12,1); section.add(cloud);
      }
    }
    addRoomDetails(r,{section,owned,geometry,box,material,sign,ivory,brass,coral,lantern,glow,shade,interactions,animations,rainControl});
    finish();
    if (r.outdoor) {
      section.position.y = 6;
      for(let i=wallStart;i<walls.length;i++) { walls[i].y0+=6; walls[i].y1+=6; }
    }
  }
  section = new THREE.Group(); section.name = 'Lazy River'; batches = new Map();
  const riverRoom = { name:'Lazy River', x0:200, x1:248, z0:40, z1:102, h:6 };
  sections.push({ root:section, room:riverRoom });
  river = createLazyRiver({geometry,box,material,sign,section,walls,owned,createWater,waterMeshes,textures,ivory,floor,poolMaterial,brass,glow,shade});
  finish();
  // Close the former procedural exits; the east arcade is the Pavilion's sole onward route.
  section = new THREE.Group(); section.name='Pavilion perimeter'; batches=new Map();
  const {x0,x1,z0,z1,height} = PAVILION;
  box(x0,height/2,(z0+z1)/2,0.6,height,z1-z0,ivory,true);
  for(const z of [z0,z1]) box((x0+x1)/2,height/2,z,x1-x0,height,0.6,ivory,true);
  for(const [a,b] of [[z0,8],[16,z1]]) box(x1,height/2,(a+b)/2,0.6,height,b-a,ivory,true);
  finish();
  function bridge(x,z) { return x>=243 && x<=301 && Math.abs(z-12)<1.8; }
  function terrain(x,z) {
    const riverTerrain = river?.terrain(x,z);
    if (riverTerrain) return riverTerrain;
    if (x>=400 && x<LEDGE.x0 && Math.abs(z-PIER_CENTER_Z)<=4) return {floor:6+Math.min(4,Math.floor(x-400)+1)*0.25,water:NaN};
    if (x>=LEDGE.x0 && x<=LEDGE.x1 && z>=LEDGE.z0 && z<=LEDGE.z1) return {floor:LEDGE.floor,water:NaN};
    if(x>=308 && x<336) return {floor:Math.min(6,(Math.floor((x-308)/(28/24))+1)*0.25),water:NaN};
    if(bridge(x,z)) return {floor:0.15,water:NaN};
    const p=pools.find(p=>inside(x,z,p));
    if(!p) return {floor:x>=336?6:0,water:NaN};
    const edge=Math.min(x-p[0],p[2]-x,z-p[1],p[3]-z);
    return {floor:p[5]-Math.min(p[4],(Math.floor(edge/0.6)+1)*0.25),water:p[5]-0.12};
  }
  for (const mat of owned) if (mat.isMeshStandardMaterial && mat.map === textures.wall) addWallCaustics(mat, pools, poolMaterial.userData.causticTime);
  return {
    root, walls, waterMeshes, terrain, pools, rainSources, pier: LEDGE, river, interactions,
    roomAt(x,z) {
      if (river.contains(x,z)) return riverRoom;
      if (x>=LEDGE.x0 && x<=LEDGE.x1 && z>=LEDGE.z0 && z<=LEDGE.z1) return ROOMS.find(r=>r.name==='Sky Pool');
      return ROOMS.find(r=>x>=r.x0 && x<r.x1 && z>=r.z0 && z<=r.z1) || null; },
    restAvailable(x,z,y) { return Math.hypot(x-REST_SPOT.x,z-REST_SPOT.z)<3 && Math.abs(y-REST_SPOT.y)<1; },
    restSpotAt(x,z,y) {
      const room = this.roomAt(x,z)?.name;
      return REST_STOPS.find(spot => spot.room === room && Math.hypot(x-spot.x,z-spot.z)<3 && Math.abs(y-spot.y)<1) || null;
    },
    update(x) { for(const s of sections) s.root.visible=x>s.room.x0-160 && x<s.room.x1+160; },
    stepRide(position,velocity,dt) {
      for(const slide of slides) { const ride = slide.stepRide(position,velocity,dt); if(ride) return ride; }
      return null;
    },
    resetRide() { slides.forEach(slide=>slide.resetRide()); },
    setTime(t,dt,camera,onBallContact) {
      streaks.offset.y=t*0.6;
      for(const effect of waterEffects) effect.update(t);
      for(const toys of beachBalls) if(toys.root.visible) toys.balls.update(t,dt,camera,onBallContact);
      for(const animate of animations) animate(t,dt);
    },
    dispose() { owned.forEach(o=>o.dispose()); waterMeshes.forEach(w=>w.material.dispose()); root.removeFromParent(); },
  };
}
