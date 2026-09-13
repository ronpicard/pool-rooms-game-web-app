import * as THREE from 'three';

// The flume mesh and ride controller follow the same curve in every room.
export function createSlide({ points, mesh, material, name, duration = 6.5, width = 1.2 }) {
  const slide = new THREE.CatmullRomCurve3(points.map(v => new THREE.Vector3(...v)), false, 'centripetal');
  const vertices = [], indices = [];
  const segments = 180, sides = 18;
  for (let i=0; i<=segments; i++) {
    const p = slide.getPointAt(i/segments), t = slide.getTangentAt(i/segments);
    const side = new THREE.Vector3(-t.z,0,t.x).normalize();
    for (let j=0; j<=sides; j++) {
      const angle = -Math.PI/2 + j/sides*Math.PI;
      const q = p.clone().addScaledVector(side, Math.sin(angle)*width);
      q.y += (1-Math.cos(angle))*width;
      vertices.push(q.x,q.y,q.z);
      if (i<segments && j<sides) {
        const a=i*(sides+1)+j, b=a+sides+1;
        indices.push(a,b,a+1,b,b+1,a+1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3)); geo.setIndex(indices); geo.computeVertexNormals();
  mesh(geo,material).name = name;
  for (const s of [-1,1]) {
    const path = new THREE.CatmullRomCurve3(Array.from({length:100},(_,i)=>{
      const p=slide.getPointAt(i/99), t=slide.getTangentAt(i/99);
      p.addScaledVector(new THREE.Vector3(-t.z,0,t.x).normalize(),s*width); p.y+=width; return p;
    }));
    mesh(new THREE.TubeGeometry(path,150,0.075,8,false), material);
  }
  let ride = null;
  const entry=slide.getPointAt(0), tangent=new THREE.Vector3();
  function stepRide(position, velocity, dt) {
    if (ride===null && position.distanceTo(entry)<1.1) ride=0;
    if (ride===null) return null;
    // The controller resets the ride explicitly on teleport; progress only advances during physics.
    ride=Math.min(1,ride+dt/duration);
    position.copy(slide.getPointAt(ride)); position.y+=0.12;
    tangent.copy(slide.getTangentAt(ride)); velocity.copy(tangent).multiplyScalar(8);
    const result={yaw:Math.atan2(-tangent.x,-tangent.z), finished:ride>=1};
    if(result.finished) ride=null;
    return result;
  }
  return { curve: slide, stepRide, resetRide() { ride = null; } };
}

export function createBeachBalls({ placements, mesh, material, contactShadow, terrain, walls, bounds, elevation = 0 }) {
  // Beach balls have real colored longitudinal panels, plus buoyant, pushable movement.
  const balls = [];
  const ballMats = [0xfff4df,0xed7868,0xffcb49,0x3eafb6,0x8c91d5,0xfff4df].map(c=>material(c,{roughness:0.23}));
  const ballGeo = new THREE.SphereGeometry(1,36,20);
  ballGeo.clearGroups();
  // Each longitude patch gets one material; shared geometry keeps this inexpensive.
  const idx=ballGeo.index, pos=ballGeo.attributes.position;
  for(let i=0;i<idx.count;i+=3) {
    const a=idx.getX(i), b=idx.getX(i+1), c=idx.getX(i+2);
    const x=pos.getX(a)+pos.getX(b)+pos.getX(c), z=pos.getZ(a)+pos.getZ(b)+pos.getZ(c);
    const section=Math.floor(((Math.atan2(z,x)+Math.PI)/(Math.PI*2))*6)%6;
    ballGeo.addGroup(i,3,section);
  }
  // Merge the material groups by reordering triangles (six draw calls per ball).
  const sorted=[], counts=Array(6).fill(0);
  for(let m=0;m<6;m++) for(const g of ballGeo.groups) if(g.materialIndex===m) {
    for(let j=0;j<3;j++) sorted.push(idx.getX(g.start+j)); counts[m]+=3;
  }
  ballGeo.setIndex(sorted); ballGeo.clearGroups(); let offset=0;
  counts.forEach((count,m)=>{ballGeo.addGroup(offset,count,m);offset+=count;});
  for(const [x,z,r] of placements) {
    const water = terrain(x,z).water;
    const ball=mesh(ballGeo,ballMats,x,Number.isFinite(water)?water-elevation+r*0.55:terrain(x,z).floor-elevation+r,z); ball.scale.setScalar(r); ball.name = 'Beach ball';
    const shadow=contactShadow(x,z,r*3,terrain(x,z).floor-elevation+0.025);
    balls.push({shadow,mesh:ball,x,z,r,vx:0,vz:0,phase:x+z,contact:false,nextContact:0,wet:Number.isFinite(terrain(x,z).water)});
  }
  return {
    update(t, dt, camera, onContact) {
      // Soft contact permits overlap while pushing both balls; movement below still checks pool edges and walls.
      for(let i=0;i<balls.length;i++) for(let j=i+1;j<balls.length;j++) {
        const a=balls[i], b=balls[j];
        const dx=b.x-a.x, dz=b.z-a.z, dy=b.mesh.position.y-a.mesh.position.y;
        const distance=Math.hypot(dx,dy,dz), overlap=a.r+b.r-distance;
        if(overlap<=0) continue;
        const horizontal=Math.hypot(dx,dz);
        // Coincident centers need a stable direction so they can drift apart.
        const nx=horizontal>0.0001 ? dx/horizontal : 1;
        const nz=horizontal>0.0001 ? dz/horizontal : 0;
        const push=overlap*8*dt;
        a.vx-=nx*push; a.vz-=nz*push;
        b.vx+=nx*push; b.vz+=nz*push;
      }
      for(const b of balls) {
        if(camera) {
          const dx=b.x-camera.position.x,dz=b.z-camera.position.z,d=Math.hypot(dx,dz);
          const touching = d<b.r+0.65 && d>0.01 && Math.abs(camera.position.y-(b.mesh.position.y+elevation))<2.6;
          if(touching) {
            b.vx+=dx/d*dt*5; b.vz+=dz/d*dt*5;
            if(!b.contact && t>b.nextContact) { onContact?.({x:b.x,y:b.mesh.position.y+elevation,z:b.z},0.8); b.nextContact=t+0.5; }
          }
          b.contact=touching;
        }
        const nx=b.x+b.vx*dt,nz=b.z+b.vz*dt;
        const blocked = b.wet
          ? !Number.isFinite(terrain(nx,nz).water)
          : nx < bounds[0] + b.r || nx > bounds[2] - b.r || nz < bounds[1] + b.r || nz > bounds[3] - b.r ||
            walls.some(w => nx + b.r > w.x0 && nx - b.r < w.x1 && nz + b.r > w.z0 && nz - b.r < w.z1 && w.y0 < b.r * 2);
        if(blocked) {
          const speed=Math.hypot(b.vx,b.vz);
          if(speed>0.35 && t>b.nextContact) { onContact?.({x:b.x,y:b.mesh.position.y+elevation,z:b.z},Math.min(1,speed/2)); b.nextContact=t+0.5; }
          b.vx*=-0.7;b.vz*=-0.7;
        } else {b.x=nx;b.z=nz;}
        b.vx*=Math.exp(-dt*1.3); b.vz*=Math.exp(-dt*1.3);
        b.shadow.position.set(b.x,terrain(b.x,b.z).floor-elevation+0.025,b.z);
        b.mesh.position.set(b.x,b.wet ? terrain(b.x,b.z).water-elevation+b.r*0.55+Math.sin(t*1.3+b.phase)*0.065 : terrain(b.x,b.z).floor-elevation+b.r,b.z);
        b.mesh.rotation.x+=b.vz*dt/b.r;b.mesh.rotation.z-=b.vx*dt/b.r;
      }
    },
  };
}
