import * as THREE from 'three';
import { util } from './util.js';

// Droplets and water rings share positions and impact times. Jitter changes after each fall.
export const RAIN_PATTERN = `
  uniform vec2 uRainSources[6];
  vec2 rainHash(vec2 p) {
    return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
  }
  vec3 rainEvent(vec2 cell, float time) {
    vec2 seed=rainHash(cell);
    float period=2.65+seed.x*0.55;
    float clock=time+seed.y*period;
    vec2 jitter=rainHash(cell+floor(clock/period)*vec2(13.1,7.7));
    return vec3((cell+0.18+jitter*0.64)*0.65,mod(clock,period)-1.65);
  }
  float rainCoverage(vec2 p) {
    float wet=0.0;
    for(int i=0;i<6;i++) {
      float edge=abs(length(p-uRainSources[i])-2.55);
      wet=max(wet,1.0-smoothstep(0.18,0.4,edge));
    }
    return wet;
  }
`;

export function createRainfall(sources, height, waterY) {
  const positions=[];
  for(const source of sources) {
    for(let x=Math.floor((source.x-3.5)/0.65);x<=Math.ceil((source.x+3.5)/0.65);x++) {
      for(let z=Math.floor((source.z-3.5)/0.65);z<=Math.ceil((source.z+3.5)/0.65);z++) {
        if(Math.abs(Math.hypot((x+0.5)*0.65-source.x,(z+0.5)*0.65-source.z)-2.55)<0.9) positions.push(x,waterY,z);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,fog:true,
    uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),uTime:{value:0},uHeight:{value:height-waterY},uPixelRatio:{value:1},uRainSources:{value:sources.map(s=>new THREE.Vector2(s.x,s.z))}},
    vertexShader:`
      uniform float uTime,uHeight,uPixelRatio;
      varying float vOpacity,vFalling;
      #include <fog_pars_vertex>
      ${RAIN_PATTERN}
      void main() {
        vec3 event=rainEvent(position.xz,uTime);
        float progress=clamp((event.z+1.65)/1.65,0.0,1.0);
        float splash=max(0.0,2.2*event.z-5.0*event.z*event.z);
        vec3 point=vec3(event.x,position.y+uHeight*(1.0-progress*progress)+splash,event.y);
        vec2 scatter=rainHash(position.xz)*2.0-1.0;
        point.xz+=scatter*max(0.0,event.z)*0.8;
        vFalling=1.0-step(0.0,event.z);
        vOpacity=rainCoverage(event.xy)*(1.0-smoothstep(0.18,0.44,event.z));
        vOpacity*=smoothstep(0.0,0.05,progress);
        vec4 mvPosition=modelViewMatrix*vec4(point,1.0);
        gl_Position=projectionMatrix*mvPosition;
        gl_PointSize=clamp(130.0/max(1.0,-mvPosition.z),2.0,10.0)*uPixelRatio;
        #include <fog_vertex>
      }
    `,
    fragmentShader:`
      varying float vOpacity,vFalling;
      #include <fog_pars_fragment>
      void main() {
        vec2 p=gl_PointCoord-0.5;
        p.x*=mix(1.0,3.0,vFalling);
        float alpha=(1.0-smoothstep(0.12,0.5,length(p)))*vOpacity*0.65;
        if(alpha<0.01) discard;
        gl_FragColor=vec4(0.78,0.94,0.96,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh=new THREE.Points(geometry,material);
  mesh.name='Rain droplets and splash beads'; mesh.frustumCulled=false; mesh.renderOrder=11;
  return {mesh,update(time,pixelRatio=1){material.uniforms.uTime.value=time;material.uniforms.uPixelRatio.value=pixelRatio;}};
}

export function createPoolSteam(pool, waterY, seed) {
  const random=util.mulberry32(seed), count=18;
  const geometry=new THREE.InstancedBufferGeometry(), plane=new THREE.PlaneGeometry(1,1);
  geometry.setIndex(plane.index.clone());
  for(const name of ['position','uv']) geometry.setAttribute(name,plane.attributes[name].clone());
  plane.dispose();
  const wisps=[];
  for(let i=0;i<count;i++) wisps.push(pool[0]+2+random()*(pool[2]-pool[0]-4),pool[1]+2+random()*(pool[3]-pool[1]-4),random(),2.8+random()*2.6);
  geometry.setAttribute('wisp',new THREE.InstancedBufferAttribute(new Float32Array(wisps),4));
  geometry.instanceCount=count;
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,fog:true,side:THREE.DoubleSide,
    uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),uTime:{value:0},uWaterY:{value:waterY}},
    vertexShader:`
      attribute vec4 wisp;
      uniform float uTime,uWaterY;
      varying vec2 vUv;
      varying float vOpacity,vPhase;
      #include <fog_pars_vertex>
      void main() {
        float age=fract(uTime*0.085+wisp.z);
        vPhase=wisp.z*6.283+uTime*0.12;
        vec3 center=vec3(wisp.x+sin(vPhase)*0.55,uWaterY+0.3+age*1.1,wisp.y+cos(vPhase)*0.4);
        vec4 mvPosition=modelViewMatrix*vec4(center,1.0);
        mvPosition.xy+=position.xy*vec2(wisp.w*(0.75+age*0.4),1.2+age*1.6);
        gl_Position=projectionMatrix*mvPosition;
        vUv=uv;
        vOpacity=smoothstep(0.0,0.2,age)*(1.0-smoothstep(0.65,1.0,age))*0.2;
        #include <fog_vertex>
      }
    `,
    fragmentShader:`
      varying vec2 vUv;
      varying float vOpacity,vPhase;
      #include <fog_pars_fragment>
      void main() {
        vec2 p=vUv-0.5;
        p.x+=sin(p.y*9.0+vPhase)*0.05;
        float soft=exp(-dot(p*vec2(3.4,4.0),p*vec2(3.4,4.0)));
        soft*=1.0-smoothstep(0.32,0.5,max(abs(p.x),abs(p.y)));
        gl_FragColor=vec4(0.96,0.98,0.94,soft*vOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='Pool steam'; mesh.frustumCulled=false; mesh.renderOrder=12;
  return {mesh,update(time){material.uniforms.uTime.value=time;}};
}

// Twelve reusable bubbles; no spawning meshes, render targets or screen shake.
export function createWaterEffects(scene, camera, lens) {
  const positions = new Float32Array(36), origins = new Float32Array(36);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { opacity: { value: 0 }, pixelRatio: { value: 1 } },
    vertexShader: `uniform float pixelRatio; void main() {
      vec4 view = modelViewMatrix * vec4(position,1.0);
      gl_Position = projectionMatrix * view;
      gl_PointSize = min(20.0, 10.0 / max(0.5,-view.z)) * pixelRatio;
    }`,
    fragmentShader: `uniform float opacity; void main() {
      float d = length(gl_PointCoord-0.5)*2.0;
      float ring = smoothstep(0.52,0.8,d)*(1.0-smoothstep(0.8,1.0,d));
      gl_FragColor=vec4(0.75,0.96,1.0,ring*opacity);
    }`,
  });
  const bubbles = new THREE.Points(geometry, material); bubbles.name = 'Water entry bubbles';
  bubbles.frustumCulled = false; bubbles.visible = false; scene.add(bubbles);
  const forward = new THREE.Vector3();
  let wasUnderwater = false, age = 3;
  return {
    update(dt, waterY, underwater, reducedMotion, pixelRatio) {
      if (underwater && !wasUnderwater && !reducedMotion) {
        age = 0; camera.getWorldDirection(forward);
        for (let i=0;i<12;i++) {
          origins[i*3] = camera.position.x + forward.x*0.9 + Math.sin(i*2.4)*0.55;
          origins[i*3+1] = camera.position.y - 0.65 - (i%4)*0.12;
          origins[i*3+2] = camera.position.z + forward.z*0.9 + Math.cos(i*2.4)*0.55;
        }
      }
      wasUnderwater = underwater; age += dt;
      if (reducedMotion) age = 3;
      bubbles.visible = !reducedMotion && underwater && age < 1.8;
      if (bubbles.visible) {
        for (let i=0;i<12;i++) {
          positions[i*3] = origins[i*3]+Math.sin(age*2+i)*0.04;
          positions[i*3+1] = Math.min(waterY-0.03, origins[i*3+1]+age*(0.55+i*0.025));
          positions[i*3+2] = origins[i*3+2];
        }
        geometry.attributes.position.needsUpdate = true;
        material.uniforms.opacity.value = 0.3*(1-age/1.8);
        material.uniforms.pixelRatio.value = pixelRatio;
      }
      const sheen = reducedMotion || !Number.isFinite(waterY) ? 0 : Math.max(0, 1-Math.abs(camera.position.y-waterY)/0.16);
      if (lens) lens.style.opacity = String(sheen*0.35);
    },
    reset() { age = 3; wasUnderwater = false; bubbles.visible = false; if (lens) lens.style.opacity = '0'; },
    dispose() { bubbles.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
