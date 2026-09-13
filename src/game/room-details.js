import * as THREE from 'three';

// Small, reversible invitations live beside the architecture they affect.
export function addRoomDetails(room, { section, owned, geometry, box, material, sign, ivory, brass, coral, lantern, glow, shade, interactions, animations, rainControl }) {
  const mesh = (geo, mat, name, x, y, z) => {
    owned.add(geo);
    const item = new THREE.Mesh(geo, mat); item.name = name; item.position.set(x,y,z);
    section.add(item); return item;
  };
  const action = (id, x, y, z, labels, apply, sound = false) => {
    let value = false;
    interactions.push({ id, room:room.name, x,y,z, sound,
      get label() { return labels[value ? 1 : 0]; },
      get value() { return value; },
      set(next) { value = next === true; apply(value); },
    });
  };
  const valve = (x,y,z,yaw,name) => {
    const wheel = mesh(new THREE.TorusGeometry(0.32,0.065,8,24), brass, name, x,y,z);
    wheel.rotation.y = yaw;
    for (const angle of [0,Math.PI/2]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.55,0.055,0.06),brass);
      owned.add(spoke.geometry); spoke.rotation.z=angle; wheel.add(spoke);
    }
    return wheel;
  };
  if (room.name === 'Blue Arcade') {
    const shutters = [];
    const shutterMat = material(0x568e94, { roughness:0.8 });
    for (const x of [57,69,81,93]) {
      shutters.push(mesh(new THREE.BoxGeometry(5,3.4,0.16), shutterMat, 'Arcade shutter',x,3.6,0.52));
    }
    const wheel = valve(87,1.5,0.85,0,'Shutter wheel');
    action('shutters',87,1.5,0.85,['Lower the shutters','Let the light in'],closed=>{
      shutters.forEach(shutter=>{shutter.position.y=closed?3.6:7.2;}); wheel.rotation.z=closed?Math.PI/2:0;
    });
    shutters.forEach(shutter=>{shutter.position.y=7.2;});
    sign('A little light',89.2,1.7,0.4,0,'Turn the brass wheel');
  }
  if (room.name === 'Rain Hall') {
    const wheel = valve(108.7,1.5,-5,Math.PI/2,'Rain valve');
    action('rain',108.7,1.5,-5,['Soften the rain','Bring back the rain'],quiet=>{
      wheel.rotation.z=quiet?Math.PI/2:0; rainControl.quiet=quiet;
    });
    sign('A softer rain',108.4,1.8,-8,Math.PI/2,'Turn the brass wheel');
  }
  if (room.name === 'Sunken Baths') {
    const paper = material(0xf2cc86,{side:THREE.DoubleSide,roughness:0.85});
    const hull = new THREE.BufferGeometry();
    hull.setAttribute('position', new THREE.Float32BufferAttribute([-0.5,0,0,0.5,0,0,0,0.13,0.3, -0.5,0,0,0,-0.08,0,0.5,0,0, -0.5,0,0,0,0.13,-0.3,0.5,0,0, 0,0.02,-0.22,0,0.5,0,0,0.02,0.22],3));
    hull.computeVertexNormals();
    const boat = mesh(hull,paper,'Paper boat',191,0.05,5.9);
    let floating=false, travel=0;
    box(191,0.35,5.5,1.8,0.7,1.2,ivory,true);
    action('boat',191,0.9,5.5,['Float the paper boat','Bring the boat ashore'],value=>{floating=value;travel=0;});
    animations.push((t,dt)=>{
      if(floating) { travel+=dt*0.2; boat.position.set(190+Math.cos(travel)*3,-0.02+Math.sin(t*1.4)*0.035,14+Math.sin(travel)*3); boat.rotation.y=-travel; }
      else { boat.position.set(191,0.76,5.5); boat.rotation.y=0; }
    });
  }
  if (room.name === 'Changing Gallery') {
    const door = mesh(new THREE.BoxGeometry(2.65,3.5,0.08).translate(1.325,0,0),ivory,'Keepsake locker door',148.275,1.9,-74.04);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.42,0.1),brass); owned.add(handle.geometry); handle.position.set(2.175,-0.1,0.1); door.add(handle);
    const token = mesh(new THREE.TorusGeometry(0.21,0.07,8,24),brass,'Little sun keepsake',149.6,1.65,-74.28);
    const heart = mesh(new THREE.CircleGeometry(0.12,16),coral,'Keepsake center',149.6,1.65,-74.25);
    token.visible=false; heart.visible=false;
    action('locker',149.6,1.7,-73.8,['Open the little locker','Close the little locker'],open=>{
      door.rotation.y=open?-Math.PI*0.57:0; token.visible=open; heart.visible=open;
    });
    sign('Something left behind',149.6,4.2,-74.01,0,'A little sun, waiting for someone');
  }
  if (room.name === 'Column Sea') {
    box(240,0.45,19,1.5,0.9,1.5,ivory,true);
    mesh(new THREE.SphereGeometry(0.5,24,12,0,Math.PI*2,Math.PI/2,Math.PI/2),brass,'Resonance bowl',240,1.3,19);
    const bowl = mesh(new THREE.TorusGeometry(0.5,0.04,8,24),brass,'Bowl rim',240,1.3,19); bowl.rotation.x=Math.PI/2;
    action('bowl',240,1.3,19,['Sound the bowl','Sound the bowl'],()=>{},true);
    // A submerged sun is visible from above but only discovered by swimming down to it.
    const mosaicTeal = material(0x277f89,{roughness:0.5});
    for(let ix=-6;ix<=6;ix++) for(let iz=-6;iz<=6;iz++) {
      const radius=Math.hypot(ix,iz), rays=(Math.abs(ix)<2||Math.abs(iz)<2||Math.abs(Math.abs(ix)-Math.abs(iz))<1);
      const mat=radius<2.8||radius<5.8&&rays?brass:radius<6?mosaicTeal:ivory;
      box(287+ix*0.36,-4.475,48+iz*0.36,0.33,0.035,0.33,mat);
    }
  }
  if (room.name === 'Sky Pool') {
    box(372,1.6,34,0.13,3.2,0.13,brass,true);
    box(372.2,1.6,34,0.4,0.08,0.08,brass);
    const canopy=mesh(new THREE.ConeGeometry(3,0.75,24,1,true),coral,'Tilting sunshade',372,3.5,34);
    const patch=mesh(new THREE.PlaneGeometry(8,7),shade,'Sunshade shadow',372,0.025,34); patch.rotation.x=-Math.PI/2;
    action('sunshade',372.4,1.6+6,34,['Tilt the sunshade','Level the sunshade'],tilted=>{canopy.rotation.z=tilted?0.38:0;patch.position.x=tilted?373.2:372;});
  }
  if (room.name === 'Lantern Baths') {
    const wheel=valve(295.25,1.5,107,-Math.PI/2,'Lantern dimmer');
    action('lanterns',295.25,1.5,107,['Turn down the lanterns','Warm the lanterns'],dim=>{
      lantern.color.setHex(dim?0x9c6849:0xffd497); wheel.rotation.z=dim?Math.PI/2:0;
    });
    sign('A softer glow',295.6,1.8,104,-Math.PI/2,'Turn the brass wheel');
  }
}
