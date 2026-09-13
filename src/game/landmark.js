import { tileFinish, createWetDeck, wetEdgeGeometry } from './surfaces.js';
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { textures as textureFactory } from './textures.js';
import { createSlide, createBeachBalls } from './pool-toys.js';

// Shared dimensions keep the hall, perimeter, skylights and arrival view aligned.
export const PAVILION = {
  x0: -48, x1: 48, z0: -48, z1: 72, height: 24,
  spawn: [-38, 2, 12, -Math.PI / 2],
  skylights: [[-10,5,17], [19,-27,12], [23,36,13], [-12,31,5]],
};
export const inLandmark = (cx, cz) => cx >= -2 && cx <= 1 && cz >= -2 && cz <= 2;
const pools = [
  { x: 0, z: 5, rx: 32, rz: 20, depth: 2.1, color: 0x31bdb8 },
  { x: -12, z: 31, rx: 7, rz: 7, depth: 0.8, color: 0xe7a799 },
  { x: -13, z: -31, rx: 16, rz: 8, depth: 0.8, color: 0xa7a2d7 },
];
const stairways = [
  { x: 37, bottom: 47, top: 22, height: 10, name: 'Golden spiral slide', duration: 9, width: 1.65, points: [
    [32,10,20.5], [28,9.7,21], [23,8.9,28], [19,7.8,38],
    [7,6.5,42], [-2,5.2,36], [0,4,28], [12,2.9,26], [19,1.4,22], [11,-0.05,18],
  ] },
  { x: 37, bottom: -3, top: -38, height: 14, name: 'Turquoise spiral slide', duration: 12, width: 1.8, points: [
    [32,14,-39.5], [27,13.8,-39.5], [17,13,-39], [7,11.8,-33],
    [6,10.3,-23], [17,8.8,-18], [27,7.4,-25], [23,6,-34],
    [12,4.6,-33], [8,3.1,-24], [14,1.5,-16], [15,-0.05,-4],
  ] },
];
export function landmarkTerrain(x, z) {
  // A broad stepped arrival terrace gives the first view elevation over the lagoon.
  if (x >= -44 && x < -28 && z >= 7 && z < 17) return { floor: Math.min(2, Math.ceil((-28-x)/0.75)*0.25) };
  // The dry causeway points directly through the eastern doorway into the Blue Arcade.
  if (x >= -28 && x < 36 && z >= 10 && z < 14) return { floor: 0 };
  if (x >= -1 && x < 11 && z >= 23 && z < 40) return { floor: Math.min(1.5, Math.ceil((z - 23) / 0.75) * 0.25) };
  // Wide, quarter-unit steps and a landing meet the slide's exact entrance.
  for (const stair of stairways) {
    if (x >= stair.x-2 && x < stair.x+2 && z >= stair.top && z < stair.bottom) return { floor: Math.min(stair.height, Math.ceil((stair.bottom-z)/0.625)*0.25) };
    if (x >= stair.x-6 && x < stair.x+2 && z >= stair.top-3 && z < stair.top) return { floor: stair.height };
  }
  for (const p of pools) {
    const r = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
    if (r < 1) return { floor: -Math.min(p.depth, Math.ceil((1 - r) * 16) * 0.3), water: -0.12, pool: true };
    if (r < 1.04) return { floor: 0, pool: true };
  }
  return { floor: 0 };
}

export function createLandmark({ group, textures, createWater, poolMaterial, ring }) {
  const root = new THREE.Group();
  root.name = 'The Sun Pavilion';
  group.add(root);
  const owned = new Set();
  const waterMeshes = [];
  const material = (color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.3, ...tileFinish(extra.map, textures), ...extra });
    owned.add(m); return m;
  };
  const wetDeck = createWetDeck(textures); owned.add(wetDeck);
  const ivory = material(0xfff2d9, { map: textures.wall });
  const coral = material(0xe78a78);
  const teal = material(0x269d9f);
  const yellow = material(0xffbf35, { roughness: 0.22, metalness: 0.12, side: THREE.DoubleSide });
  const lavender = material(0xa8a0d3);
  const metal = material(0xf8ead5, { metalness: 0.35 });
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
    owned.add(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    m.userData.landmarkShadow = !(mat.isMeshBasicMaterial || mat.transparent);
    root.add(m); return m;
  };
  const architecture = [];
  const box = (x, y, z, w, h, d, mat) => {
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    architecture.push(m); return m;
  };
  const bar = (a, b, radius = 0.07, mat = metal) => {
    const v = new THREE.Vector3(...a), w = new THREE.Vector3(...b);
    const m = mesh(new THREE.CylinderGeometry(radius, radius, v.distanceTo(w), 8), mat);
    m.position.copy(v).add(w).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), w.sub(v).normalize());
    architecture.push(m); return m;
  };
  const contactMaterial = new THREE.MeshBasicMaterial({ map: textures.glow, color: 0x184b51, transparent: true, opacity: 0.28, depthWrite: false });
  owned.add(contactMaterial);
  const recessMaterial = new THREE.MeshBasicMaterial({ color:0x244a50, transparent:true, opacity:0.24, depthWrite:false }); owned.add(recessMaterial);
  const contactGeo = new THREE.PlaneGeometry(1, 1); owned.add(contactGeo);
  const contactShadow = (x, z, size, y = 0.02) => {
    const shadow = mesh(contactGeo, contactMaterial, x, y, z);
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(size, size, 1);
    shadow.renderOrder = 1; return shadow;
  };
  const walls = [];
  const obstacle = (x, z, r, h = 16, bottom = 0) => walls.push({ x0: x-r, x1: x+r, z0: z-r, z1: z+r, y0: bottom, y1: h });
  // Actual arch openings, with rounded soffits and columns instead of rectangular door decals.
  function arch(x, z, rotation, accent) {
    const shape = new THREE.Shape();
    shape.moveTo(-5, 5); shape.lineTo(-5, 12); shape.lineTo(5, 12); shape.lineTo(5, 5);
    shape.lineTo(3.7, 5); shape.absarc(0, 5, 3.7, 0, Math.PI, false); shape.lineTo(-5, 5);
    const a = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false, curveSegments: 24 }), accent, x, 0, z);
    a.rotation.y = rotation;
    architecture.push(a);
    // A soft recess on each soffit gives depth even when real-time shadows are disabled.
    const recess = mesh(new THREE.TorusGeometry(3.78,0.2,6,32,Math.PI),recessMaterial,x,5,z+0.83);
    recess.name='Pavilion arch recess';
    recess.rotation.y=rotation;
    if (rotation) { recess.position.x=x+0.83; recess.position.z=z; }
    for (const offset of [-4.35, 4.35]) {
      const px = x + Math.cos(rotation) * offset, pz = z - Math.sin(rotation) * offset;
      box(px, 2.5, pz, 1.3, 5, 1.3, ivory);
      box(px, 0.55, pz, 1.45, 1.1, 1.45, accent);
      box(px, 5, pz, 1.6, 0.24, 1.6, accent);
      obstacle(px, pz, 0.73);
      contactShadow(px, pz, 4);
    }
  }
  for (const x of [-37, -27, -17, -7, 3, 13, 23, 33]) arch(x, -45, 0, x < 0 ? lavender : coral);
  for (const z of [-34, -24, -14, -4, 6, 16, 26, 36, 46, 56, 66]) {
    arch(-45, z, Math.PI / 2, teal);
  }
  for (const z of [-30, -20, -10, 0, 10, 20, 30, 40, 50, 60]) {
    arch(45, z, Math.PI / 2, coral);
  }
  // Clerestory windows, heavy roof beams and luminous circular skylights.
  const sky = new THREE.MeshBasicMaterial({ color: 0xd7f8ff, side: THREE.DoubleSide }); owned.add(sky);
  for (const x of [-36, -24, -12, 0, 12, 24, 36]) {
    box(x, 20.9, -47.6, 8, 4.5, 0.14, sky);
    box(x, 21, -47.4, 0.1, 4.8, 0.22, metal);
    box(x, 24.1, 12, 0.35, 0.6, 120, ivory);
  }
  for (const [x,z,r] of PAVILION.skylights) {
    const disc = mesh(new THREE.CircleGeometry(r, 64), sky, x, 23.94, z);
    disc.rotation.x = Math.PI / 2; disc.castShadow = false;
    const rim = mesh(new THREE.TorusGeometry(r, 0.22, 8, 80), ivory, x, 23.8, z);
    rim.rotation.x = Math.PI / 2;
    bar([x-r,23.7,z], [x+r,23.7,z], 0.1, metal);
    bar([x,23.7,z-r], [x,23.7,z+r], 0.1, metal);
  }
  const sunlight = new THREE.MeshBasicMaterial({map:textures.glow,color:0xffe2a6,transparent:true,opacity:0.16,depthWrite:false,blending:THREE.AdditiveBlending}); owned.add(sunlight);
  for(const [x,z] of [[-18,13],[35,-8],[24,35]]) {
    const patch=mesh(new THREE.PlaneGeometry(5,12),sunlight,x,0.035,z);
    patch.rotation.set(-Math.PI/2,0,0.3); patch.name='Pavilion skylight patch';
  }
  // Pool water and smooth colored coping follow the same ellipses as the floor collision.
  for (const p of pools) {
    const edge = Array.from({length:129},(_,i)=>{const a=-i/128*Math.PI*2; return [p.x+Math.cos(a)*p.rx*1.12,p.z+Math.sin(a)*p.rz*1.12];});
    const outer = Array.from({length:129},(_,i)=>{const a=-i/128*Math.PI*2; return [p.x+Math.cos(a)*(p.rx*1.12+0.8),p.z+Math.sin(a)*(p.rz*1.12+0.8)];});
    mesh(wetEdgeGeometry(edge,outer,0.026),wetDeck);
    // Smooth concentric terraces hide the collision grid's stair-step silhouette.
    // Their step depths match landmarkTerrain; the broad outer ring covers cell-edge gaps.
    const positions = [], uvs = [], triangles = [];
    const band = (outer, outerY, inner, innerY) => {
      for (let i = 0; i < 128; i++) {
        const a = i / 128 * Math.PI * 2, b = (i + 1) / 128 * Math.PI * 2;
        const corners = [[outer, outerY, a], [inner, innerY, a], [inner, innerY, b], [outer, outerY, b]];
        const start = positions.length / 3;
        for (const [r, y, angle] of corners) {
          const x = p.x + Math.cos(angle) * p.rx * r, z = p.z + Math.sin(angle) * p.rz * r;
          positions.push(x, y + 0.015, z);
          if (outer === inner) uvs.push(angle * p.rx / 4, y / 4);
          else uvs.push(x / 4, z / 4);
        }
        triangles.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
    };
    band(1.12, 0, 1, 0);
    let radius = 1, height = 0;
    for (let step = 1; step <= Math.ceil(p.depth / 0.3); step++) {
      const y = -Math.min(p.depth, step * 0.3), nextRadius = 1 - step / 16;
      band(radius, height, radius, y);
      band(radius, y, nextRadius, y);
      height = y; radius = nextRadius;
    }
    band(radius, height, 0, height);
    const basin = new THREE.BufferGeometry();
    basin.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    basin.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    basin.setIndex(triangles); basin.computeVertexNormals();
    mesh(basin, poolMaterial).name = 'Curved tiled basin';
    const water = createWater(p.x-p.rx, p.z-p.rz, p.x+p.rx, p.z+p.rz, -0.12, p.depth);
    water.geometry.dispose();
    water.geometry = new THREE.CircleGeometry(1, 96);
    water.scale.set(p.rx, p.rz, 1);
    root.add(water); waterMeshes.push(water); owned.add(water.geometry); owned.add(water.material);
    const curve = new THREE.EllipseCurve(p.x, p.z, p.rx+0.12, p.rz+0.12, 0, Math.PI*2);
    const path = new THREE.CatmullRomCurve3(curve.getPoints(128).map(p => new THREE.Vector3(p.x, 0.08, p.y)), true);
    mesh(new THREE.TubeGeometry(path, 128, 0.16, 8, true), material(p.color));
  }
  // One shared planar reflection on medium/high; the low preset keeps the simple water pass.
  // Hide all pool surfaces during reflection to prevent recursive renders and water feedback.
  const reflector = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 512, textureHeight: 512, multisample: 0, clipBias: 0.003 });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = -0.12;
  reflector.updateMatrixWorld(true);
  const inverseReflectionWorld = reflector.matrixWorld.clone().invert();
  const reflectingWater = waterMeshes[0];
  const reflectedUniforms = reflectingWater.material.uniforms;
  reflectedUniforms.uReflection.value = reflector.getRenderTarget().texture;
  reflectedUniforms.uReflect.value = ring > 1 ? 1 : 0;
  reflectingWater.onBeforeRender = (renderer, scene, camera) => {
    if (!reflectedUniforms.uReflect.value || camera.position.y < -0.12) return;
    const visibility = waterMeshes.map(water => water.visible);
    waterMeshes.forEach(water => { water.visible = false; });
    try {
      reflector.onBeforeRender(renderer, scene, camera);
      reflectedUniforms.uReflectionMatrix.value.copy(reflector.material.uniforms.textureMatrix.value).multiply(inverseReflectionWorld);
    } finally {
      waterMeshes.forEach((water, i) => { water.visible = visibility[i]; });
    }
  };
  // The broad causeway carries the opening view and the walk through the same doorway.
  box(4,-0.22,12,64,0.4,4,ivory).name='Pavilion causeway';
  for (const z of [10.12,13.88]) box(4,0.018,z,64,0.025,0.15,teal);
  for (const x of [-23,-11,1,13,25]) {
    const arrow = new THREE.Shape();
    arrow.moveTo(x-0.6,11.55); arrow.lineTo(x+0.25,12); arrow.lineTo(x-0.6,12.45);
    arrow.lineTo(x-0.35,12); arrow.closePath();
    const inlay = new THREE.ShapeGeometry(arrow); inlay.rotateX(Math.PI/2);
    mesh(inlay,yellow,0,0.022,0);
  }
  const rides = stairways.map((stair,index) => {
    const accent=index===0?yellow:material(0x35b8bb,{roughness:0.2,metalness:0.12,side:THREE.DoubleSide});
    const ride=createSlide({mesh,material:accent,...stair});
    for (const t of [0.12,0.3,0.5,0.7]) {
      const p=ride.curve.getPointAt(t), floor=landmarkTerrain(p.x,p.z).floor;
      contactShadow(p.x,p.z,9,floor+0.045).name='Pavilion slide shade';
      bar([p.x,floor,p.z],[p.x,p.y,p.z],0.2,teal);
      obstacle(p.x,p.z,0.23,p.y,floor);
    }
    // Both staircases use the same quarter-unit treads as the terrain.
    for (const x of [stair.x-2.15,stair.x+2.15]) {
      bar([x,1,stair.bottom],[x,stair.height+1,stair.top],0.08,coral);
      for(let z=stair.top;z<=stair.bottom;z+=2.5) {
        const y=Math.min(stair.height,(stair.bottom-z)*0.4);
        bar([x,y,z],[x,y+1,z],0.05,metal);
      }
      walls.push({x0:x-0.1,x1:x+0.1,z0:stair.top,z1:stair.bottom,y0:0,y1:stair.height+2});
    }
    for (const [a,b] of [
      [[31,stair.height+1,stair.top-3],[39,stair.height+1,stair.top-3]],
      [[31,stair.height+1,stair.top],[34.8,stair.height+1,stair.top]],
      [[39,stair.height+1,stair.top-3],[39,stair.height+1,stair.top]],
    ]) {
      bar(a,b,0.08,coral);
      walls.push({x0:Math.min(a[0],b[0])-0.1,x1:Math.max(a[0],b[0])+0.1,z0:Math.min(a[2],b[2])-0.1,z1:Math.max(a[2],b[2])+0.1,y0:stair.height,y1:stair.height+2});
    }
    return ride;
  });
  const beachBalls = createBeachBalls({
    placements: [[2,17,1.15],[20,5,0.8],[-2,2,0.65],[13,-2,0.95],[28,31,1.4]],
    mesh, material, contactShadow, terrain: landmarkTerrain, walls, bounds: [-47,-47,47,71],
  });
  // Twin tiered fountains frame the causeway, leaving the onward view open between them.
  const sculpture=mesh(new THREE.TorusGeometry(5.2,0.45,16,64),lavender,-12,5.2,31);
  sculpture.rotation.y=Math.PI/6;
  const stream=new THREE.MeshStandardMaterial({color:0xb9f5f1,transparent:true,opacity:0.5,roughness:0.12,depthWrite:false});
  owned.add(stream);
  const flowTime={value:0};
  stream.onBeforeCompile=shader=>{
    shader.uniforms.uFlowTime=flowTime;
    shader.vertexShader='varying vec2 vFlowUv;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvFlowUv=uv;');
    shader.fragmentShader='uniform float uFlowTime;\nvarying vec2 vFlowUv;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float flow=0.5+0.5*sin(vFlowUv.x*110.0-uFlowTime*18.0+sin(vFlowUv.x*37.0-uFlowTime*9.0));
      float edge=pow(0.5+0.5*cos(vFlowUv.y*6.283),3.0);
      diffuseColor.rgb+=vec3(0.12,0.16,0.16)*flow;
      diffuseColor.a*=0.25+0.55*flow+0.2*edge;
    `);
  };
  const jets=[], ripples=[], fountainDrops=[];
  const dropletMaterial=new THREE.PointsMaterial({color:0xd9ffff,map:textures.glow,size:0.17,transparent:true,opacity:0.82,depthWrite:false});
  owned.add(dropletMaterial);
  for (const [index,x,z,height] of [[1,-6,-6,5.8],[2,11,19,4.8]]) {
    const floor=landmarkTerrain(x,z).floor;
    mesh(new THREE.CylinderGeometry(1.5,2.1,0.7,40),teal,x,floor+0.35,z).name=`Pavilion fountain ${index}`;
    mesh(new THREE.CylinderGeometry(0.4,0.75,height-floor,32),ivory,x,(height+floor)/2,z);
    for(const [y,r] of [[height*0.44,2.1],[height,1.3]]) {
      mesh(new THREE.CylinderGeometry(r,r*0.55,0.55,40),ivory,x,y-0.27,z);
      const rim=mesh(new THREE.TorusGeometry(r,0.11,8,48),teal,x,y,z);rim.rotation.x=Math.PI/2;
    }
    const paths=[], curves=[];
    for(let i=0;i<12;i++) {
      const a=i/12*Math.PI*2, radius=index===1?4.6:3.4;
      const path=new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(x,height,z),
        new THREE.Vector3(x+Math.cos(a)*radius*0.45,height+4,z+Math.sin(a)*radius*0.45),
        new THREE.Vector3(x+Math.cos(a)*radius,-0.1,z+Math.sin(a)*radius));
      curves.push(path);
      paths.push(new THREE.TubeGeometry(path,32,0.075,6,false));
    }
    // Water spills from each bowl to the tier below, then drains into the lagoon.
    for(const [y,r,targetY,targetR] of [[height,1.3,height*0.44+0.04,2.0],[height*0.44,2.1,-0.1,2.9]]) {
      for(let i=0;i<8;i++) {
        const a=i/8*Math.PI*2+0.18, c=Math.cos(a), s=Math.sin(a);
        const path=new THREE.QuadraticBezierCurve3(new THREE.Vector3(x+c*r,y+0.06,z+s*r),
          new THREE.Vector3(x+c*(r+0.6),y+0.04,z+s*(r+0.6)),new THREE.Vector3(x+c*targetR,targetY,z+s*targetR));
        curves.push(path);paths.push(new THREE.TubeGeometry(path,20,0.09,6,false));
      }
    }
    const geometry=mergeGeometries(paths);paths.forEach(path=>path.dispose());
    const jet=mesh(geometry,stream);jet.name=`Pavilion fountain ${index} jets`;jets.push(jet);
    jet.castShadow=false;
    const positions=new Float32Array(curves.length*12*3), dropsGeometry=new THREE.BufferGeometry();
    dropsGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
    owned.add(dropsGeometry);
    const drops=new THREE.Points(dropsGeometry,dropletMaterial);
    drops.name=`Pavilion fountain ${index} droplets`;drops.frustumCulled=false;root.add(drops);jets.push(drops);
    fountainDrops.push({mesh:drops,curves,positions});
    const rippleMaterial=new THREE.MeshBasicMaterial({color:0xd5ffff,transparent:true,opacity:0.3,depthWrite:false,side:THREE.DoubleSide});owned.add(rippleMaterial);
    const ripple=mesh(new THREE.RingGeometry(0.97,1,80),rippleMaterial,x,-0.09,z);ripple.rotation.x=-Math.PI/2;
    ripple.name=`Pavilion fountain ${index} ripples`;ripples.push({mesh:ripple,phase:index*0.5,radius:index===1?4.6:3.4});
    obstacle(x,z,0.8,height,floor);
  }
  const fountainValve=mesh(new THREE.TorusGeometry(0.3,0.065,8,24),metal,24,1.3,-16);
  fountainValve.rotation.y=Math.PI/2;
  box(24,0.55,-16,0.4,1.1,0.4,teal);
  let fountainQuiet=false;
  const interactions=[{id:'fountain',room:'Sun Pavilion',x:24,y:1.3,z:-16,
    get label(){return fountainQuiet?'Start the fountain':'Pause the fountain';},
    get value(){return fountainQuiet;},
    set(value){fountainQuiet=value===true;[...jets,...ripples.map(ripple=>ripple.mesh)].forEach(jet=>{jet.visible=!fountainQuiet;});fountainValve.rotation.z=fountainQuiet?Math.PI/2:0;},
  }];
  const label = (text,x,y,z,color= '#266d73') => {
    const texture=textureFactory.createLabelTexture(text,{color});owned.add(texture);
    const mat=new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide});owned.add(mat);
    return mesh(new THREE.PlaneGeometry(13,1.625),mat,x,y,z);
  };
  label('T O W A R D   T H E   S K Y',47.6,4.4,12).rotation.y=-Math.PI/2;
  label('S U N   P A V I L I O N',0,15.5,-44.05);
  label('T H E   B L U E   A R C A D E',47.5,8,12).rotation.y=-Math.PI/2;
  label('01   /   GOLDEN SLIDE',34,2.6,49, '#b35d39').rotation.y=-Math.PI/2;
  label('03   /   TURQUOISE SPIRAL',34,2.6,-1).rotation.y=-Math.PI/2;
  label('02   /   LILAC BATHS',-12,1.8,40).rotation.y=-Math.PI/2;
  // Batch repeated masonry and rails so the larger hall keeps the existing shadow budget.
  const batches=new Map();
  for (const object of architecture) {
    if (object.name) continue;
    object.updateMatrix();
    const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    geometry.applyMatrix4(object.matrix);
    if (!batches.has(object.material)) batches.set(object.material,[]);
    batches.get(object.material).push(geometry);
    root.remove(object);owned.delete(object.geometry);object.geometry.dispose();
  }
  for (const [mat,geometries] of batches) {
    mesh(mergeGeometries(geometries),mat).name='Pavilion architecture';
    geometries.forEach(geometry=>geometry.dispose());
  }
  const dropPoint=new THREE.Vector3();
  function updateFountains(t) {
    flowTime.value=t;
    for(const {mesh,curves,positions} of fountainDrops) {
      if (!mesh.visible) continue;
      for(let path=0;path<curves.length;path++) for(let i=0;i<12;i++) {
        const phase=(t/(path<12?1.8:1.1)+i/12+path*0.371)%1;
        curves[path].getPoint(Math.min(1,phase/0.84),dropPoint);
        if(phase>0.84) {
          const age=(phase-0.84)/0.16, angle=i*2.4+path;
          dropPoint.x+=Math.cos(angle)*age*0.3;dropPoint.z+=Math.sin(angle)*age*0.3;
          dropPoint.y+=Math.sin(age*Math.PI)*0.22;
        }
        dropPoint.toArray(positions,(path*12+i)*3);
      }
      mesh.geometry.attributes.position.needsUpdate=true;
    }
  }
  updateFountains(0);
  return {
    root, walls, waterMeshes, pools, interactions,
    stepRide(position,velocity,dt) { for(const ride of rides) { const result=ride.stepRide(position,velocity,dt); if(result) return result; } return null; },
    resetRide() { rides.forEach(ride=>ride.resetRide()); },
    setQuality(ring) { reflectedUniforms.uReflect.value = ring > 1 ? 1 : 0; },
    update(t,dt,camera,onContact) {
      beachBalls.update(t,dt,camera,onContact);
      updateFountains(t);
      for (const ripple of ripples) {
        const phase=(t*0.38+ripple.phase)%1;
        ripple.mesh.scale.setScalar(ripple.radius+phase*0.75);
        ripple.mesh.material.opacity=(1-phase)*0.25;
      }
    },
    dispose(){reflector.geometry.dispose();reflector.dispose();for(const item of owned)item.dispose();root.clear();group.remove(root);},
  };
}
