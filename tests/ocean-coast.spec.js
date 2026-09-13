import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('ocean fills exterior gaps while leaving the rooms and curved river dry', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await page.addInitScript(()=>localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!PR.game?.world)).toBe(true);
  await page.locator('#btn-start').click();
  await page.locator('#btn-pause').click();
  const result=await page.evaluate(()=>{
    const {world,scene,camera,renderer}=PR.game;
    world.update(383);
    renderer.setSize(1280,800,false); camera.aspect=1280/800;
    camera.position.set(383,27.65,-8); camera.lookAt(300,4,-8);
    camera.far=1000; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    world.setTime(3); renderer.setRenderTarget(null); renderer.render(scene,camera);
    const image=renderer.domElement.toDataURL('image/png');
    renderer.setSize(640,360,false); camera.aspect=640/360; camera.updateProjectionMatrix();
    // Isolate the ocean so architecture cannot conceal an oversized cutout or indoor flooding.
    const ocean=world.group.getObjectByName('Ocean beyond the overlook');
    scene.traverse(object=>{if(object.isMesh || object.isSprite || object.isPoints) object.visible=object===ocean;});
    for(let object=ocean;object;object=object.parent) object.visible=true;
    const gl=renderer.getContext(),w=renderer.domElement.width,h=renderer.domElement.height;
    const samples=[
      ['beside the Sky Pool entrance',322,-24,true], ['north of Column Sea',300,-60,true],
      ['south of Column Sea',310,86,true], ['between halls',170,-20,true],
      ['beside the arcade',80,40,true], ['outside the Pavilion',-52,12,true],
      ['outside the river bend',203,99,true], ['inside the river elbow',225,76,true],
      ['beside the river straight',196,48,true], ['open sea',420,-30,true],
      ['Pavilion west wing',-38,12,false], ['Blue Arcade',72,12,false],
      ['Water passage',102,12,false], ['Rain Hall',136,0,false],
      ['Quiet passage',170,28,false], ['Sunken Baths',190,12,false],
      ['The threshold',230,12,false], ['Column Sea',272,0,false],
      ['Toward the sky',322,12,false], ['Changing Gallery',136,-60,false],
      ['Lantern Baths',272,92,false], ['Rain Garden',130,52,false],
      ['Stillwater Nook',190,68,false], ['river straight',210,60,false],
      ['river bend',213.5,88.5,false], ['river exit',240,92,false],
    ].map(([name,x,z,water])=>{
      camera.position.set(x,20,z); camera.lookAt(x,2.5,z-0.001); camera.updateMatrixWorld();
      const frames=[false,true].map(visible=>{
        ocean.visible=visible; world.setTime(3); renderer.render(scene,camera);
        const pixels=new Uint8Array(4*4*4);
        gl.readPixels(Math.floor(w/2)-2,Math.floor(h/2)-2,4,4,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        return pixels;
      });
      let difference=0;
      for(let i=0;i<frames[0].length;i+=4) for(let c=0;c<3;c++) difference+=Math.abs(frames[0][i+c]-frames[1][i+c]);
      return {name,water,difference:difference/(16*3)};
    });
    return {image,samples};
  });
  await writeFile(testInfo.outputPath('sky-spiral-coast.png'),Buffer.from(result.image.split(',')[1],'base64'));
  for(const {name,water,difference} of result.samples) {
    if(water) expect.soft(difference,name).toBeGreaterThan(10);
    else expect.soft(difference,name).toBe(0);
  }
  expect(errors).toEqual([]);
});
