import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('rain impacts and pool steam render visibly at every quality without shader errors', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await page.setViewportSize({width:1280,height:800});
  await page.addInitScript(()=>localStorage.setItem('poolrooms.settings',JSON.stringify({quality:'low',inputMode:'touch'})));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!window.PR?.game?.world),{timeout:15000}).toBe(true);
  await page.locator('#btn-start').click();
  await page.locator('#btn-pause').click();
  for(const quality of ['low','medium','high']) {
    await page.locator('#sel-quality').selectOption(quality);
    for(const name of ['rain','steam']) {
      const result=await page.evaluate(name=>{
        const {world,renderer,camera,scene}=PR.game;
        const rain=name==='rain';
        world.update(rain?124:272);
        camera.position.set(rain?124:272,3.2,rain?6:108);
        camera.lookAt(rain?124:272,-0.12,rain?0:92);
        camera.updateMatrixWorld();
        const room=world.journey.root.getObjectByName(rain?'Rain Hall':'Lantern Baths');
        const effect=room.getObjectByName(rain?'Rain droplets and splash beads':'Pool steam');
        const water=room.getObjectByName(rain?'Rain Hall water':'Lantern Baths water');
        world.setTime(8.3);
        const gl=renderer.getContext(),w=renderer.domElement.width,h=renderer.domElement.height;
        const frames=[false,true].map(visible=>{
          effect.visible=visible;
          if(rain) water.material.uniforms.uRain.value=visible?1:0;
          renderer.info.reset(); renderer.setRenderTarget(null); renderer.render(scene,camera);
          const pixels=new Uint8Array(w*h*4);
          gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          return pixels;
        });
        let changed=0;
        for(let i=0;i<frames[0].length;i+=4) {
          if(Math.abs(frames[0][i]-frames[1][i])+Math.abs(frames[0][i+1]-frames[1][i+1])+Math.abs(frames[0][i+2]-frames[1][i+2])>6) changed++;
        }
        const coverage=rain?water.material.uniforms.uRainSources.value.map(source=>source.toArray()):null;
        return {changed,count:rain?effect.geometry.attributes.position.count:effect.geometry.instanceCount,coverage,
          calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,image:renderer.domElement.toDataURL('image/png')};
      },name);
      expect(result.changed,`${name} ${quality}`).toBeGreaterThan(100);
      expect(result.count).toBeLessThan(1000);
      if(name==='rain') expect(result.coverage).toEqual([[124,-24],[124,0],[124,24],[148,-24],[148,0],[148,24]]);
      else expect(result.count).toBe(18);
      expect(result.calls,`${name} ${quality}`).toBeLessThan(180);
      expect(result.triangles,`${name} ${quality}`).toBeLessThan(250000);
      await writeFile(testInfo.outputPath(`${name}-${quality}.png`),Buffer.from(result.image.split(',')[1],'base64'));
    }
  }
  expect(errors).toEqual([]);
});
