import { tileFinish, createWetDeck, wetEdgeGeometry } from './surfaces.js';
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { textures as textureFactory } from './textures.js';
import { createSlide, createBeachBalls } from './pool-toys.js';

// A designed, nine-chunk arrival hall. Terrain and meshes share the same coordinates.
export const inLandmark = (cx, cz) => Math.abs(cx) <= 1 && Math.abs(cz) <= 1;
const pools = [
  { x: 10, z: 5, rx: 22, rz: 16, depth: 2.1, color: 0x31bdb8 },
  { x: -12, z: 31, rx: 7, rz: 7, depth: 0.8, color: 0xe7a799 },
  { x: 13, z: -16, rx: 9, rz: 4, depth: 0.8, color: 0xa7a2d7 },
];
export function landmarkTerrain(x, z) {
  // A broad stepped arrival terrace gives the first view elevation over the lagoon.
  if (x >= -1 && x < 11 && z >= 23 && z < 40) return { floor: Math.min(1.5, Math.ceil((z - 23) / 0.75) * 0.25) };
  // Wide, quarter-unit steps and a landing meet the slide's exact entrance.
  if (x >= 35 && x < 39 && z >= 22 && z < 37) return { floor: Math.min(6, Math.ceil((37 - z) / 0.625) * 0.25) };
  if (x >= 31 && x < 39 && z >= 19 && z < 22) return { floor: 6 };
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
  const box = (x, y, z, w, h, d, mat) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const bar = (a, b, radius = 0.07, mat = metal) => {
    const v = new THREE.Vector3(...a), w = new THREE.Vector3(...b);
    const m = mesh(new THREE.CylinderGeometry(radius, radius, v.distanceTo(w), 8), mat);
    m.position.copy(v).add(w).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), w.sub(v).normalize());
    return m;
  };
  const contactMaterial = new THREE.MeshBasicMaterial({ map: textures.glow, color: 0x184b51, transparent: true, opacity: 0.16, depthWrite: false });
  owned.add(contactMaterial);
  const contactGeo = new THREE.PlaneGeometry(1, 1); owned.add(contactGeo);
  const contactShadow = (x, z, size, y = 0.02) => {
    const shadow = mesh(contactGeo, contactMaterial, x, y, z);
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(size, size, 1);
    shadow.renderOrder = 1; return shadow;
  };
  const walls = [];
  const obstacle = (x, z, r, h = 16) => walls.push({ x0: x-r, x1: x+r, z0: z-r, z1: z+r, y0: 0, y1: h });
  // Actual arch openings, with rounded soffits and columns instead of rectangular door decals.
  function arch(x, z, rotation, accent) {
    const shape = new THREE.Shape();
    shape.moveTo(-5, 5); shape.lineTo(-5, 12); shape.lineTo(5, 12); shape.lineTo(5, 5);
    shape.lineTo(3.7, 5); shape.absarc(0, 5, 3.7, 0, Math.PI, false); shape.lineTo(-5, 5);
    const a = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false, curveSegments: 24 }), accent, x, 0, z);
    a.rotation.y = rotation;
    for (const offset of [-4.35, 4.35]) {
      const px = x + Math.cos(rotation) * offset, pz = z - Math.sin(rotation) * offset;
      box(px, 2.5, pz, 1.3, 5, 1.3, ivory);
      box(px, 0.55, pz, 1.45, 1.1, 1.45, accent);
      box(px, 5, pz, 1.6, 0.24, 1.6, accent);
      obstacle(px, pz, 0.73);
      contactShadow(px, pz, 4);
    }
  }
  for (const x of [-13, -3, 7, 17, 27, 37]) arch(x, -21, 0, x < 0 ? lavender : coral);
  for (const z of [-10, 0, 10, 20, 30, 40]) {
    arch(-21, z, Math.PI / 2, teal);
    arch(45, z, Math.PI / 2, coral);
  }
  // Clerestory windows, heavy roof beams and luminous circular skylights.
  const sky = new THREE.MeshBasicMaterial({ color: 0xd7f8ff, side: THREE.DoubleSide }); owned.add(sky);
  for (const x of [-12, 0, 12, 24, 36]) {
    box(x, 13.9, -23.6, 8, 3.5, 0.14, sky);
    box(x, 14, -23.4, 0.1, 3.8, 0.22, metal);
    box(x, 16.1, 12, 0.35, 0.6, 72, ivory);
  }
  for (const [x,z,r] of [[6,5,11], [28,25,7], [-12,31,5]]) {
    const disc = mesh(new THREE.CircleGeometry(r, 64), sky, x, 15.94, z);
    disc.rotation.x = Math.PI / 2; disc.castShadow = false;
    const rim = mesh(new THREE.TorusGeometry(r, 0.22, 8, 80), ivory, x, 15.8, z);
    rim.rotation.x = Math.PI / 2;
    bar([x-r,15.7,z], [x+r,15.7,z], 0.1, metal);
    bar([x,15.7,z-r], [x,15.7,z+r], 0.1, metal);
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
  // Curved open flume: the rider follows the center of this exact mesh.
  const slideRide = createSlide({ mesh, material: yellow, name: 'Golden spiral slide', points: [
    [32,6,20.5], [29,5.8,20.5], [24,5.1,23], [21,4.3,27],
    [15,3.5,28], [11,2.8,25], [13,2,21], [19,1.3,19], [22,0.65,15], [20,-0.05,10],
  ] });
  const slide = slideRide.curve;
  for (const t of [0.15,0.35,0.55,0.72]) {
    const p=slide.getPointAt(t);
    bar([p.x,0,p.z], [p.x,p.y,p.z],0.16,teal);
    obstacle(p.x,p.z,0.18,p.y);
  }
  // Stair railings stop at the landing so the slide entrance is accessible.
  for (const x of [34.85,39.15]) {
    bar([x,1,37],[x,7,22],0.08,coral);
    for(let z=23;z<=37;z+=2) {
      const y=Math.min(6,(37-z)*0.4);
      bar([x,y,z],[x,y+1,z],0.05,metal);
    }
    walls.push({x0:x-0.1,x1:x+0.1,z0:22,z1:37,y0:0,y1:8});
  }
  for (const [a,b] of [ [[31,7,19],[39,7,19]], [[31,7,22],[34.8,7,22]], [[39,7,19],[39,7,22]] ]) {
    bar(a,b,0.08,coral);
    walls.push({ x0: Math.min(a[0],b[0])-0.1,x1:Math.max(a[0],b[0])+0.1,z0:Math.min(a[2],b[2])-0.1,z1:Math.max(a[2],b[2])+0.1,y0:6,y1:8 });
  }
  const beachBalls = createBeachBalls({
    placements: [[2,17,1.15],[20,5,0.8],[-2,2,0.65],[13,-2,0.95],[-12,31,0.65],[28,31,1.4]],
    mesh, material, contactShadow, terrain: landmarkTerrain, walls, bounds: [-23,-23,47,47],
  });
  // Sculptural rings and a small fountain make the shallow baths distinct destinations.
  const sculpture=mesh(new THREE.TorusGeometry(5.2,0.45,16,64),lavender,-12,5.2,31);
  sculpture.rotation.y=Math.PI/6;
  for(const x of [-17.2,-6.8]) { box(x,1.9,31,0.9,3.8,0.9,lavender); obstacle(x,31,0.5,4); }
  mesh(new THREE.CylinderGeometry(0.8,1.1,0.8,32),teal,13,0.1,-16);
  const stream=material(0x94e3e1,{transparent:true,opacity:0.65});
  for(let i=0;i<8;i++) {
    const a=i/8*Math.PI*2;
    const path=new THREE.QuadraticBezierCurve3(new THREE.Vector3(13,0.5,-16),new THREE.Vector3(13+Math.cos(a),3,-16+Math.sin(a)),new THREE.Vector3(13+Math.cos(a)*2.3,-0.1,-16+Math.sin(a)*2.3));
    mesh(new THREE.TubeGeometry(path,24,0.045,6,false),stream);
  }
  const label = (text,x,y,z,color= '#266d73') => {
    const texture=textureFactory.createLabelTexture(text,{color});owned.add(texture);
    const mat=new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide});owned.add(mat);
    return mesh(new THREE.PlaneGeometry(13,1.625),mat,x,y,z);
  };
  label('T O W A R D   T H E   S K Y',47.6,4.4,12).rotation.y=-Math.PI/2;
  label('S U N   P A V I L I O N',12,10.6,-20.05);
  label('01   /   GOLDEN SLIDE',34,2.6,38, '#b35d39');
  label('02   /   LILAC BATHS',-12,1.8,40);
  return {
    root, walls, waterMeshes, pools, stepRide: slideRide.stepRide, resetRide: slideRide.resetRide,
    setQuality(ring) { reflectedUniforms.uReflect.value = ring > 1 ? 1 : 0; },
    update: beachBalls.update,
    dispose(){reflector.geometry.dispose();reflector.dispose();for(const item of owned)item.dispose();root.clear();group.remove(root);},
  };
}
