import * as THREE from 'three';

const finishes = new WeakMap();
const plainSurface = () => {};
export function setSurfaceQuality(material, detailed) {
  if (!material.isMeshStandardMaterial) return;
  if (!finishes.has(material)) finishes.set(material, {
    bumpMap: material.bumpMap, compile: material.onBeforeCompile, cacheKey: material.customProgramCacheKey,
  });
  const finish = finishes.get(material), bumpMap = detailed ? finish.bumpMap : null;
  const compile = !detailed && material.userData.wallCaustics ? plainSurface : finish.compile;
  if (material.bumpMap === bumpMap && material.onBeforeCompile === compile) return;
  material.bumpMap = bumpMap; material.onBeforeCompile = compile;
  material.customProgramCacheKey = compile === plainSurface ? () => 'plain-tile' : finish.cacheKey;
  material.needsUpdate = true;
}

// Shared by the Pavilion and journey materials. Relief is R, glaze roughness is G.
export function tileFinish(map, textures) {
  return [textures.floor, textures.wall, textures.pool].includes(map)
    ? { bumpMap: textures.tileRelief, bumpScale: 0.022, roughnessMap: textures.tileRelief } : {};
}

export function createWetDeck(textures) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xc5d4c9, map: textures.floor, ...tileFinish(textures.floor, textures),
    roughness: 0.2, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  });
  material.name = 'Damp pool edges';
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float edgeWetness; varying float vEdgeWetness; varying vec3 vWetWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdgeWetness = edgeWetness; vWetWorld = (modelMatrix * vec4(position,1.0)).xyz;');
    shader.fragmentShader = 'varying float vEdgeWetness; varying vec3 vWetWorld;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float dampPattern = sin(vWetWorld.x*2.1+sin(vWetWorld.z*1.3))*sin(vWetWorld.z*2.7);
      diffuseColor.a *= smoothstep(0.05,0.9,vEdgeWetness) * (0.42+0.3*dampPattern);
    `);
  };
  return material;
}

// A softly fading strip, with UVs matching the floor beneath it. Points run along the wet inner edge.
export function wetEdgeGeometry(points, outerPoints, height) {
  const positions = [], uv = [], wetness = [], indices = [];
  points.forEach(([x,z], i) => {
    const [ox,oz] = outerPoints[i];
    positions.push(x,height,z,ox,height,oz); uv.push(x/4,z/4,ox/4,oz/4); wetness.push(1,0);
    if (i < points.length-1) { const a = i*2; indices.push(a,a+1,a+2,a+1,a+3,a+2); }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute('edgeWetness', new THREE.Float32BufferAttribute(wetness,1));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function addWallCaustics(material, pools, time) {
  material.userData.wallCaustics = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uWallCausticTime = time;
    shader.uniforms.uCausticBounds = { value: pools.map(p => new THREE.Vector4(p[0],p[1],p[2],p[3])) };
    shader.uniforms.uCausticLevels = { value: new Float32Array(pools.map(p => p[5])) };
    shader.vertexShader = 'varying vec3 vWallWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWallWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader = `varying vec3 vWallWorld; uniform float uWallCausticTime;
      uniform vec4 uCausticBounds[${pools.length}]; uniform float uCausticLevels[${pools.length}];\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      float lightReach=0.0;
      for(int i=0;i<${pools.length};i++) {
        float height=vWallWorld.y-uCausticLevels[i];
        if(height < -2.2 || height > 1.7) continue;
        vec2 edge=clamp(vWallWorld.xz,uCausticBounds[i].xy,uCausticBounds[i].zw);
        lightReach=max(lightReach,(1.0-smoothstep(0.0,2.5,length(vWallWorld.xz-edge)))*(1.0-smoothstep(0.15,1.7,height)));
      }
      vec2 q=vec2(vWallWorld.x+vWallWorld.z,vWallWorld.y*0.7)*2.2;
      float a=sin(q.x+sin(q.y*1.3+uWallCausticTime*0.5));
      float b=cos(q.y+sin(q.x*0.8-uWallCausticTime*0.4));
      totalEmissiveRadiance+=vec3(0.075,0.14,0.12)*pow(1.0-abs(a*b),18.0)*lightReach;
    `);
  };
  material.customProgramCacheKey = () => 'wall-caustics-' + pools.length;
}
