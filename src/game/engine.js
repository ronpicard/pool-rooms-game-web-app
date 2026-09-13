import { createWaterEffects } from './water-effects.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { util, CONST } from './util.js';
import { textures as textureFactory } from './textures.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createWorld } from './world.js';
import { createAtmosphere } from './atmosphere.js';
import { REST_SPOT } from './journey.js';
import { createPlayer } from './player.js';
const ADDONS = { EffectComposer, RenderPass, UnrealBloomPass, OutputPass };
/* engine.js — boot, renderer, scene, post-processing, fixed-timestep loop, state machine and module wiring. */


  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const SETTINGS_KEY = 'poolrooms.settings';
  const LAST_RUN_KEY = 'poolrooms.last'; // { seed, mode } of the current walk, mirrored from the URL hash
  const QUALITIES = ['low', 'medium', 'high'];
  const INPUT_MODES = ['auto', 'desktop', 'touch'];
  const GAME_MODES = ['wander'];

  /**
   * Quality table (CONTRACT §10). `ratio` is the pixel-ratio cap before the global device cap
   * (desktop 2, touch 1.5) is applied on top. Bloom and shadows are desktop-only whatever the quality.
   */
  const QUALITY = {
    low: { ratio: 1.0, ring: 1, fogNear: 35, fogFar: 95, bloom: false, shadows: false },
    medium: { ratio: 1.5, ring: 2, fogNear: 45, fogFar: 115, bloom: true, shadows: false },
    high: { ratio: 2.0, ring: 3, fogNear: 55, fogFar: 140, bloom: true, shadows: true },
  };

  const SKY_COLOR = 0xe9f0f4;        // background and dry fog colour (day-white with a blue tint)
  const UNDERWATER_COLOR = 0x3f8aa3; // fog colour while the camera is below a water surface
  const UNDERWATER_FOG_NEAR = 0;
  const UNDERWATER_FOG_FAR = 14;
  const CAMERA_FAR_PAD = 2;          // camera far plane sits this far beyond fog.far (fully fogged there, so the clip is invisible)
  const HUD_INTERVAL = 0.1;          // seconds between HUD / compass refreshes (10 Hz)
  const FPS_INTERVAL = 0.5;          // seconds over which the fps counter is averaged
  const SHADOW_REFRESH = 2;          // seconds between forced shadow-flag passes over the world group
  const NEAR_WATER_RADIUS = 4;       // sampling radius (units) for the audio "near water" flag
  const SHADOW_EXTENT = 48;          // half-size of the directional shadow frustum (units)
  const SHADOW_DISTANCE = 40;        // distance of the shadow light from the player along its direction

  /** Eight sample offsets on a circle of NEAR_WATER_RADIUS, precomputed so the loop allocates nothing. */
  const NEAR_WATER_OFFSETS = (function () {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      out.push([Math.cos(a) * NEAR_WATER_RADIUS, Math.sin(a) * NEAR_WATER_RADIUS]);
    }
    return out;
  })();

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  /**
   * Looks up a DOM element by id.
   * @param {string} id
   * @returns {HTMLElement|null}
   */
  function byId(id) {
    return document.getElementById(id);
  }

  /**
   * Normalises a user-supplied seed to the allowed alphabet ([a-z0-9-_], at most 32 chars).
   * @param {*} value
   * @returns {string} sanitised seed, possibly empty
   */
  function sanitizeSeed(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  }

  /**
   * Merges a stored or partial settings object over `defaults`, keeping only valid values.
   * @param {*} raw  candidate settings (localStorage content or a React settings payload)
   * @param {{quality:string, inputMode:string, volume:number, invertY:boolean, reducedMotion:boolean, mode:string}} defaults
   * @returns {{quality:string, inputMode:string, volume:number, invertY:boolean, reducedMotion:boolean, mode:string}}
   */
  function sanitizeSettings(raw, defaults) {
    const s = {
      quality: defaults.quality,
      inputMode: defaults.inputMode,
      volume: defaults.volume,
      environmentVolume: defaults.environmentVolume, movementVolume: defaults.movementVolume, musicVolume: defaults.musicVolume, gentleSound: defaults.gentleSound,
      invertY: defaults.invertY,
      reducedMotion: defaults.reducedMotion,
      mode: defaults.mode,
    };
    if (!raw || typeof raw !== 'object') return s;
    if (QUALITIES.indexOf(raw.quality) !== -1) s.quality = raw.quality;
    if (INPUT_MODES.indexOf(raw.inputMode) !== -1) s.inputMode = raw.inputMode;
    const volume = typeof raw.volume === 'string' && raw.volume.trim() !== '' ? Number(raw.volume) : raw.volume;
    if (typeof volume === 'number' && Number.isFinite(volume)) {
      // Accept both the 0..1 scale used internally and the 0..100 scale of a range input.
      s.volume = Math.min(1, Math.max(0, volume > 1 ? volume / 100 : volume));
    }
    for (const key of ['environmentVolume', 'movementVolume', 'musicVolume']) {
      if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) s[key] = Math.max(0, Math.min(1, raw[key]));
    }
    if (typeof raw.gentleSound === 'boolean') s.gentleSound = raw.gentleSound;
    if (typeof raw.reducedMotion === 'boolean') s.reducedMotion = raw.reducedMotion;
    if (typeof raw.invertY === 'boolean') s.invertY = raw.invertY;
    if (GAME_MODES.indexOf(raw.mode) !== -1) s.mode = raw.mode;
    return s;
  }

  /**
   * Shows the fatal error overlay (Three.js missing, WebGL unavailable, boot failure).
   * Falls back to a generated element when the page skeleton itself is incomplete.
   * @param {string} message
   */

  /**
   * Best-effort fullscreen request for touch devices; every failure path is swallowed because
   * fullscreen is a nicety (iPhone Safari has no element fullscreen at all).
   */
  function tryFullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      // Without a live user activation the browser refuses (and logs a warning); skip it quietly.
      if (navigator.userActivation && !navigator.userActivation.isActive) return;
      const el = document.documentElement;
      const request = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!request) return;
      const result = request.call(el);
      if (result && typeof result.catch === 'function') {
        result.catch(function () {
          // Declined or unsupported: keep playing in the normal viewport.
        });
      }
    } catch (err) {
      // Same as above: a rejected or throwing request must never affect the game.
    }
  }

  /**
   * Creates every shared texture once. World chunks reference these and never dispose them.
   * @param {boolean} touch  smaller canvases on touch devices
   * @param {number} maxAnisotropy  renderer.capabilities.getMaxAnisotropy()
   * @returns {{floor:object, pool:object, wall:object, ceiling:object, waterNormal:object, glow:object}}
   */
  function createTextures(touch, maxAnisotropy) {
    const T = textureFactory;
    const size = touch ? 512 : 1024;
    const textures = {
      floor: T.createTileTexture({
        size, unitsPerTexture: 4, tilesPerUnit: 2, baseColor: '#efece4', variation: 0.05, groutColor: '#b7c2bc', seed: 11,
      }),
      pool: T.createTileTexture({
        size, unitsPerTexture: 4, tilesPerUnit: 2, baseColor: '#a7ded8', variation: 0.06, groutColor: '#7fa3ad', seed: 23,
      }),
      wall: T.createTileTexture({
        size, unitsPerTexture: 4, tilesPerUnit: 2, baseColor: '#f4f2ec', variation: 0.04, groutColor: '#b7c2bc', seed: 37,
      }),
      ceiling: T.createPlasterTexture({ size: touch ? 256 : 512, baseColor: '#f7f7f4', noise: 0.03, seed: 41 }),
      tileRelief: T.createTileTexture({ size: 512, relief: true }),
      waterNormal: T.createWaterNormalTexture({ size: 256, seed: 5, strength: 1.0 }),
      glow: T.createGlowTexture({ size: 128 }),
    };
    textures.tileRelief.anisotropy = maxAnisotropy;
    textures.floor.anisotropy = maxAnisotropy;
    textures.pool.anisotropy = maxAnisotropy;
    textures.wall.anisotropy = maxAnisotropy;
    textures.ceiling.anisotropy = maxAnisotropy;
    textures.waterNormal.anisotropy = maxAnisotropy;
    return textures;
  }

  // ---------------------------------------------------------------------------
  // Game
  // ---------------------------------------------------------------------------

  /**
   * Builds the scene, wires every module together and owns the state machine and frame loop.
   * @param {object} THREE  THREE
   * @param {object} renderer  an initialised THREE.WebGLRenderer bound to `canvas`
   * @param {HTMLElement} app  #app container (its client size drives the viewport)
   * @param {HTMLCanvasElement} canvas  #c
   * @param {boolean} deviceTouch  pointer-capability based touch detection (util.isTouchDevice)
   * @returns {object} the window.PR.game debug hook
   */
  function createGame(renderer, app, canvas, deviceTouch, ui) {
    const showError = ui.showError;
    const C = CONST;
    const vignette = byId('vignette');

    // --- persistent state ------------------------------------------------------------------------
    const defaults = { quality: deviceTouch ? 'low' : 'medium', inputMode: 'auto', volume: 0.8, environmentVolume: 1, movementVolume: 0.8, musicVolume: 0, gentleSound: false, invertY: false, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, mode: 'wander' };
    let settings = sanitizeSettings(util.storageGet(SETTINGS_KEY, null), defaults);
    // The URL hash wins; without a seed in it, resume the last run from storage (the hash cannot
    // always be written on file:// pages, so storage is what survives a reload there).
    const hash = util.readHash();
    const lastRun = util.storageGet(LAST_RUN_KEY, null);
    const run = (sanitizeSeed(hash.seed) || !lastRun || typeof lastRun !== 'object') ? hash : lastRun;
    let seed = sanitizeSeed(run.seed) || util.randomSeedString();
    const mode = 'wander';
    settings.mode = mode;
    const depth = 0;

    // --- runtime state ---------------------------------------------------------------------------
    let disposed = false;
    let state = 'start';          // 'start' | 'playing' | 'paused'; resting retains the live scene
    let textures = null;          // shared textures, created with the first world (deferred past the start overlay)
    let world = null;
    let player = null;
    let inputMode = 'desktop';    // resolved input mode ('auto' never reaches here)
    let composer = null;          // EffectComposer when bloom is active
    let dirLight = null;          // shadow-casting DirectionalLight (high quality, desktop only)
    let shadowsOn = false;
    let shadowChunkCount = -1;    // chunk count at the last shadow-flag pass
    let shadowTimer = 0;
    let fogNear = QUALITY[settings.quality].fogNear;   // dry fog distances of the active quality
    let fogFar = QUALITY[settings.quality].fogFar;
    let underwater = false;
    let rafId = 0;
    let loopWanted = false;       // true once Start was pressed; the loop restarts on tab return
    let last = 0;
    let acc = 0;
    let time = 0;
    let hudTimer = 0;
    let fpsFrames = 0;
    let fpsTime = 0;
    let fps = 0;
    let orientationTimer = 0;
    let resting = false;
    let activeRest = null;
    let lastRoom = '';
    let roomHaze = 1;
    const restEye = new THREE.Vector3(REST_SPOT.x, REST_SPOT.y + 1.25, REST_SPOT.z);
    const restView = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04, REST_SPOT.yaw, 0, 'YXZ'));

    // --- renderer, scene, camera, lights ---------------------------------------------------------
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false; // reset once per frame so multi-pass (bloom) frames report totals

    const skyColor = new THREE.Color(SKY_COLOR);
    const underwaterColor = new THREE.Color(UNDERWATER_COLOR);
    const scene = new THREE.Scene();
    scene.background = skyColor.clone();
    scene.fog = new THREE.Fog(SKY_COLOR, fogNear, fogFar);

    // Far plane follows the fog (applyFog) so fully fogged chunks are frustum-culled instead of drawn.
    const camera = new THREE.PerspectiveCamera(deviceTouch ? 80 : 75, 1, 0.08, fogFar + CAMERA_FAR_PAD);
    camera.rotation.order = 'YXZ';

    const hemisphere = new THREE.HemisphereLight(0xfff7e8, 0x81b8bd, 1.5);
    scene.add(hemisphere);
    scene.add(new THREE.AmbientLight(0xdfe8f0, 0.35));
    const sun = new THREE.DirectionalLight(0xffefd5, 2.0);
    sun.position.set(-25, 45, 25);
    scene.add(sun);
    const atmosphere = createAtmosphere({ hemisphere, sun, renderer, skyColor });
    roomHaze = atmosphere.update('Sun Pavilion', 0, true);
    // A tiny sky dome follows the camera. Indoor walls naturally occlude it.
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(65, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vDirection;
        void main(){ vec3 d=normalize(vDirection); float h=max(0.,d.y);
          vec3 color=mix(vec3(.87,.91,.86),vec3(.29,.61,.76),smoothstep(0.,.7,h));
          float ribbons=sin(d.x*13.+sin(d.z*11.))*sin(d.z*19.+d.x*5.);
          float cloud=smoothstep(.24,.68,ribbons)*smoothstep(.03,.16,h)*(1.-smoothstep(.25,.5,h));
          gl_FragColor=vec4(mix(color,vec3(.97,.97,.9),cloud*.65),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    skyDome.renderOrder=-1; skyDome.frustumCulled=false; scene.add(skyDome);
    const lightDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    // --- modules ---------------------------------------------------------------------------------
    const audio = createAudio();
    const waterEffects = createWaterEffects(scene, camera, byId('water-lens'));
    const input = createInput({
      canvas,
      touchLayer: byId('touch-layer'),
      joystickBase: byId('joystick'),
      joystickKnob: byId('joystick-knob'),
      jumpButton: byId('btn-jump'),
      sprintIndicator: byId('sprint-indicator'),
      onPauseRequest: pause,
      onFirstGesture: function () {
        audio.unlock();
      },
    });
    ui.connect({
      onStart,
      onResume: resume,
      onPause: pause,
      onNewSeed,
      onSettingsChange,
      onCopyLink,
      onRest: toggleRest,
    });
    ui.onAnyClick = function () {
      audio.uiClick();
    };

    // Reuse the audio state object across frames.
    const audioState = { inWater: false, swimming: false, underwater: false, nearWater: false, speed: 0 };

    // --- world & player --------------------------------------------------------------------------

    /**
     * Disposes the current world (if any), builds a new one for the current seed/depth, primes the
     * whole chunk ring synchronously and places the player at its spawn. The shared textures are
     * created on the first call, which boot defers until the start overlay has painted.
     */
    function buildWorld() {
      if (!textures) textures = createTextures(deviceTouch, maxAnisotropy);
      if (world) {
        world.dispose();
        world = null;
      }
      const ring = QUALITY[settings.quality].ring;
      world = createWorld({
        scene,
        seed: util.worldSeed(seed, depth),
        ring,
        textures,
        maxAnisotropy,
        onBallContact: audio.ballContact,
        mode,
      });
      world.setCamera(camera);
      audio.setScene(world.soundscape);
      world.setFog(scene.fog.color, scene.fog.near, scene.fog.far);
      const spawn = world.spawn();
      world.update(spawn.x, spawn.z, (2 * ring + 1) * (2 * ring + 1));
      world.setRing(ring);
      if (player) {
        player.setWorld(world);
      } else {
        player = createPlayer({ world, camera, input, audio });
      }
      player.setReducedMotion(settings.reducedMotion);
      roomHaze = atmosphere.update('Sun Pavilion', 0, true);
      underwater = false;
      audio.setUnderwater(false);
      waterEffects.reset();
      vignette?.classList.remove('underwater');
      applyFog();
      player.teleport(spawn.x, spawn.y, spawn.z, spawn.yaw);
      player.updateCamera(1);
      world.setTime(time);
      shadowChunkCount = -1; // sentinel: the next shadow-flag pass runs regardless of the chunk count
      if (shadowsOn) refreshShadowFlags(0);
    }

    // --- quality ---------------------------------------------------------------------------------

    /**
     * Effective device pixel ratio: quality cap, then the global desktop (2) / touch (1.5) cap.
     * @returns {number}
     */
    function pixelRatioCap() {
      const dpr = window.devicePixelRatio || 1;
      return Math.min(dpr, QUALITY[settings.quality].ratio, deviceTouch ? 1.5 : 2);
    }

    /** Applies the active quality preset: fog, chunk ring, bloom, shadows and pixel ratio. */
    function applyQuality() {
      const q = QUALITY[settings.quality];
      fogNear = q.fogNear;
      fogFar = q.fogFar;
      applyFog();
      if (world) world.setRing(q.ring);
      setComposer(q.bloom && !deviceTouch);
      setShadows(q.shadows && !deviceTouch);
      resize();
    }

    /**
     * Writes the fog and background for the current dry/underwater state, forwards it to the water
     * shader and pulls the camera far plane in to just beyond the fog so fogged-out chunks are culled.
     */
    function applyFog() {
      const fog = scene.fog;
      if (underwater) {
        fog.color.copy(underwaterColor);
        fog.near = UNDERWATER_FOG_NEAR;
        fog.far = UNDERWATER_FOG_FAR;
      } else {
        fog.color.copy(skyColor);
        fog.near = fogNear * roomHaze;
        fog.far = fogFar * roomHaze;
      }
      scene.background.copy(fog.color);
      // The ocean has its own distant haze; preserve its horizon beyond the room fog.
      const oceanView = !underwater && player && world?.journey.roomAt(player.position.x,player.position.z)?.outdoor;
      const far = oceanView ? 1000 : fog.far + CAMERA_FAR_PAD;
      if (Math.abs(camera.far - far) > 0.05) {
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      if (world) world.setFog(fog.color, fog.near, fog.far);
    }

    /**
     * Creates or destroys the bloom composer. Silently stays on plain rendering when the post-processing
     * post-processing is disabled by the quality setting.
     * @param {boolean} enabled
     */
    function setComposer(enabled) {
      const A = ADDONS;
      const available = !!(A && A.EffectComposer && A.RenderPass && A.UnrealBloomPass && A.OutputPass);
      if (enabled && available && !composer) {
        const w = Math.max(1, app.clientWidth || window.innerWidth);
        const h = Math.max(1, app.clientHeight || window.innerHeight);
        composer = new A.EffectComposer(renderer);
        composer.addPass(new A.RenderPass(scene, camera));
        // Threshold 0.95: above the sky/fog colour's linear luminance (0.862) so fogged areas never
        // bloom, below the ceiling panels (1.35) and drain glow (>= 1.4), which are meant to.
        composer.addPass(new A.UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.65, 0.95));
        composer.addPass(new A.OutputPass());
      } else if (!enabled && composer) {
        for (let i = 0; i < composer.passes.length; i++) {
          const pass = composer.passes[i];
          if (typeof pass.dispose === 'function') pass.dispose();
        }
        if (typeof composer.dispose === 'function') composer.dispose();
        composer = null;
      }
    }

    /**
     * Enables or disables the dim shadow-casting directional light (high quality on desktop).
     * @param {boolean} enabled
     */
    function setShadows(enabled) {
      if (enabled === shadowsOn) return;
      shadowsOn = enabled;
      renderer.shadowMap.enabled = enabled;
      if (enabled) {
        if (!dirLight) {
          dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
          dirLight.castShadow = true;
          dirLight.shadow.mapSize.set(2048, 2048);
          const cam = dirLight.shadow.camera;
          cam.left = -SHADOW_EXTENT;
          cam.right = SHADOW_EXTENT;
          cam.bottom = -SHADOW_EXTENT;
          cam.top = SHADOW_EXTENT;
          cam.near = 1;
          cam.far = SHADOW_DISTANCE * 2 + 20;
          cam.updateProjectionMatrix();
          dirLight.shadow.bias = -0.0005;
          dirLight.shadow.normalBias = 0.03;
        }
        scene.add(dirLight);
        scene.add(dirLight.target);
        shadowChunkCount = -1;
        if (world) refreshShadowFlags(0);
      } else if (dirLight) {
        scene.remove(dirLight);
        scene.remove(dirLight.target);
        // Free the 2048² shadow render target; WebGLShadowMap recreates it if shadows come back.
        dirLight.shadow.dispose();
        dirLight.shadow.map = null;
        dirLight.shadow.mapPass = null;
        shadowChunkCount = -1;
      }
    }

    /**
     * Sets cast/receive flags on world meshes. Meshes are identified by their shared texture: walls,
     * pillars, railings and pool sides cast; floors receive; ceilings, panels and transparent surfaces
     * (water, glow discs) do neither so the roof does not black out the whole interior.
     * @param {object} obj  any Object3D visited by Group.traverse
     */
    function setMeshShadowFlags(obj) {
      if (!obj.isMesh) return;
      if (obj.userData.landmarkShadow !== undefined) {
        obj.castShadow = obj.userData.landmarkShadow;
        obj.receiveShadow = obj.userData.landmarkShadow;
        return;
      }
      const material = obj.material;
      if (!material || Array.isArray(material) || material.transparent) {
        obj.castShadow = false;
        obj.receiveShadow = false;
        return;
      }
      const map = material.map;
      const solid = map === textures.wall || map === textures.pool;
      obj.castShadow = solid;
      obj.receiveShadow = solid || map === textures.floor;
    }

    /**
     * Re-applies shadow flags when the loaded chunk set changed (or periodically, in case a chunk was
     * swapped for another without changing the count).
     * @param {number} elapsed  seconds since the previous call
     */
    function refreshShadowFlags(elapsed) {
      shadowTimer += elapsed;
      const count = world.stats().chunks;
      if (count === shadowChunkCount && shadowTimer < SHADOW_REFRESH) return;
      shadowTimer = 0;
      shadowChunkCount = count;
      world.group.traverse(setMeshShadowFlags);
    }

    /**
     * Keeps the shadow light (and its orthographic frustum) centred on the player.
     * @param {object} pos  player feet position (THREE.Vector3)
     */
    function followLight(pos) {
      dirLight.position.set(
        pos.x + lightDir.x * SHADOW_DISTANCE,
        pos.y + lightDir.y * SHADOW_DISTANCE,
        pos.z + lightDir.z * SHADOW_DISTANCE
      );
      dirLight.target.position.set(pos.x, pos.y, pos.z);
    }

    /** Resolves settings.inputMode ('auto' by pointer capability) and applies it to input and ui. */
    function applyInputMode() {
      inputMode = settings.inputMode === 'auto' ? (deviceTouch ? 'touch' : 'desktop') : settings.inputMode;
      input.setMode(inputMode);
      ui.setTouchControlsVisible(inputMode === 'touch' && state === 'playing');
    }

    // --- viewport --------------------------------------------------------------------------------

    /** Fits renderer, camera and composer to #app; re-renders the start backdrop when the loop is idle. */
    function resize() {
      const w = Math.max(1, app.clientWidth || window.innerWidth);
      const h = Math.max(1, app.clientHeight || window.innerHeight);
      const ratio = pixelRatioCap();
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (composer) {
        composer.setPixelRatio(ratio);
        composer.setSize(w, h);
      }
      if (!rafId) renderOnce();
    }

    /** Orientation changes report stale sizes on some mobile browsers: resize now and again shortly after. */
    function onOrientationChange() {
      resize();
      clearTimeout(orientationTimer);
      orientationTimer = setTimeout(resize, 300);
    }

    // --- rendering -------------------------------------------------------------------------------

    /** Renders one frame through the composer when bloom is active, plain otherwise. */
    function render() {
      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    }

    /** Renders a single frame outside the loop (start-menu backdrop, resize while idle). */
    function renderOnce() {
      if (rafId || !world || !player) return;
      renderer.info.reset();
      if (!resting) player.updateCamera(1);
      skyDome.position.copy(camera.position);
      render();
    }

    // --- location prompts, audio state, debug --------------------------------------------------------

    /**
     * Show room-entry titles and update the nearby chair prompt only when needed.
     */
    function updateHUD() {
      const p = player?.position;
      const room = p && world.journey.roomAt(p.x, p.z);
      const name = room?.name || 'Sun Pavilion';
      if (name !== lastRoom) {
        lastRoom = name;
        ui.patch({ area: name });
        if (state === 'playing') ui.announceArea(name);
      }
      const spot = p && world.journey.restSpotAt(p.x, p.z, p.y);
      const canRest = !!spot, restPrompt = spot?.ending ? 'Rest' : 'Sit for a while';
      if (ui.getSnapshot().canRest !== canRest || ui.getSnapshot().restPrompt !== restPrompt) ui.patch({ canRest, restPrompt });
    }

    function toggleRest() {
      if (state !== 'playing') return;
      if (!resting) {
        const p = player.position;
        activeRest = world.journey.restSpotAt(p.x,p.z,p.y);
        if (!activeRest) return;
        player.velocity.set(0,0,0);
        player.state.speed = 0;
        restEye.set(activeRest.x,activeRest.y+(activeRest.ending?1.25:1.55),activeRest.z);
        restView.setFromEuler(new THREE.Euler(-0.04,activeRest.yaw,0,'YXZ'));
      } else activeRest = null;
      resting = !resting;
      acc = 0;
      input.setEnabled(!resting);
      ui.setTouchControlsVisible(!resting && inputMode === 'touch');
      ui.patch({ resting, restEnding: !!activeRest?.ending, restCaption: activeRest?.caption || '' });
      if (resting) {
        if (input.isPointerLocked()) input.exitPointerLock();
        if (activeRest.ending) util.storageSet('poolrooms.completed', true);
      } else {
        player.updateCamera(1);
        enterPlaying();
      }
    }

    function onRestKey(event) {
      if (event.code === 'Escape' && resting) pause();
      if (event.code === 'KeyE' && !event.repeat && state === 'playing' &&
          !['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) toggleRest();
    }

    /**
     * True when the player is in water or water exists within NEAR_WATER_RADIUS (drives the lapping gain).
     * @returns {boolean}
     */
    function sampleNearWater() {
      if (player.state.inWater) return true;
      const px = player.position.x;
      const pz = player.position.z;
      for (let i = 0; i < NEAR_WATER_OFFSETS.length; i++) {
        const o = NEAR_WATER_OFFSETS[i];
        const wy = world.waterAt(px + o[0], pz + o[1]);
        if (wy === wy) return true; // not NaN => water here
      }
      return false;
    }

    /**
     * Renderer statistics line for the pause menu.
     * @returns {string}
     */
    function debugText() {
      const info = renderer.info;
      const chunks = world ? world.stats().chunks : 0;
      return fps + ' fps · ' + info.render.calls + ' calls · ' + info.memory.geometries + ' geo · ' +
        info.memory.textures + ' tex · ' + chunks + ' chunks';
    }

    /**
     * Switches fog, audio filter and vignette tint when the camera crosses a water surface.
     * A small hysteresis band avoids flicker while floating at the surface.
     */
    function updateUnderwater() {
      const eye = player.eyeY();
      const wy = world.waterAt(camera.position.x, camera.position.z);
      const next = wy === wy && (underwater ? eye < wy + 0.01 : eye < wy - 0.02);
      if (next === underwater) return;
      underwater = next;
      applyFog();
      audio.setUnderwater(next);
      if (vignette) vignette.classList.toggle('underwater', next);
    }

    // --- URL & links -----------------------------------------------------------------------------

    /**
     * Mirrors seed/mode into the URL hash (reproducible by link) and into storage (resumed on the
     * next visit when the URL carries no seed).
     */
    function syncHash() {
      const run = { seed, mode };
      util.writeHash(run);
      util.storageSet(LAST_RUN_KEY, run);
    }

    /**
     * Share link for the current world (the UI store copies it to the clipboard).
     * @returns {string}
     */
    function onCopyLink() {
      const base = String(window.location.href).split('#')[0];
      return base + '#seed=' + encodeURIComponent(seed) + '&mode=wander';
    }

    // --- state machine ---------------------------------------------------------------------------

    /**
     * Enters 'playing' from the start overlay or the pause menu: menus close, input and audio resume,
     * the pointer is captured (desktop) or fullscreen attempted (touch device) and the loop runs.
     */
    function enterPlaying() {
      state = 'playing';
      ui.hideMenus();
      ui.setTouchControlsVisible(!resting && inputMode === 'touch');
      input.setEnabled(!resting);
      audio.setPaused(false);
      acc = 0;
      if (inputMode === 'desktop' && !resting) {
        if (deviceTouch && typeof canvas.requestPointerLock !== 'function') {
          // Desktop mode on a phone without the Pointer Lock API (iOS Safari): nothing could move,
          // look or pause, so switch to touch rather than strand the player.
          fallBackToTouch();
        } else {
          Promise.resolve(input.requestPointerLock()).then(onPointerLockResult, function () {
            onPointerLockResult(false);
          });
        }
      } else if (deviceTouch) {
        tryFullscreen();
      }
      startLoop();
    }

    /**
     * Handles a refused pointer-lock request. On a touch-only device desktop mode is unplayable
     * without the lock, so it falls back to touch controls; on a desktop the refusal is usually a
     * click that came too soon after Esc released the previous lock, so tell the player how to recover.
     * @param {boolean} locked
     */
    function onPointerLockResult(locked) {
      if (disposed || locked || state !== 'playing' || inputMode !== 'desktop') return;
      if (deviceTouch) {
        fallBackToTouch();
      } else {
        ui.toast('Click the game to capture the mouse', 2200);
      }
    }

    /** Switches (and persists) the input mode to touch while playing, showing the touch controls. */
    function fallBackToTouch() {
      settings.inputMode = 'touch';
      util.storageSet(SETTINGS_KEY, settings);
      ui.setSettings(settings);
      applyInputMode();
      ui.toast('Pointer lock is not available here — using touch controls', 2600);
    }

    /**
     * Start button handler.
     * @param {{seed?: string, mode?: string}} opts  form values from the start overlay
     */
    function onStart(opts) {
      if (state !== 'start') return;
      const requestedSeed = sanitizeSeed(opts && opts.seed) || util.randomSeedString();
      audio.unlock();
      audio.start();
      audio.setVolume(settings.volume);
      settings.mode = mode;
      util.storageSet(SETTINGS_KEY, settings);
      let rebuild = false;
      if (requestedSeed !== seed) {
        seed = requestedSeed;
        rebuild = true;
      }
      if (rebuild || !world) {
        // !world: Start pressed before the deferred boot frame ran.
        try {
          buildWorld();
        } catch (err) {
          showError('The world failed to build: ' + (err && err.message ? err.message : String(err)));
          return;
        }
      }
      syncHash();
      updateHUD();
      loopWanted = true;
      enterPlaying();
      ui.announceArea(lastRoom || 'Sun Pavilion');
    }

    /**
     * Opens the pause menu (Esc / pointer-lock loss / HUD pause button / tab hidden). The render loop
     * stops too: the last frame stays on the canvas behind the blurred menu, so drawing more would
     * only burn battery. enterPlaying() restarts it.
     */
    function pause() {
      if (state !== 'playing') return;
      state = 'paused';
      input.setEnabled(false);
      if (input.isPointerLocked()) input.exitPointerLock();
      audio.setPaused(true);
      ui.setTouchControlsVisible(false);
      ui.showPause({ touch: inputMode === 'touch', debug: debugText() });
      stopLoop();
    }

    /** Resume button handler. */
    function resume() {
      if (state !== 'paused') return;
      enterPlaying();
    }

    /** Restart the walk at the Pavilion, retaining the current settings. */
    function onNewSeed() {
      seed = util.randomSeedString();
      resting = false;
      activeRest = null;
      ui.patch({ resting: false, restEnding: false, canRest: false });
      buildWorld();
      syncHash();
      updateHUD();
      ui.toast('Back at the Sun Pavilion', 2500);
      if (state === 'paused') {
        enterPlaying();
      } else {
        renderOnce();
      }
    }

    /**
     * Applies and persists a settings change from the pause menu.
     * @param {object} next  partial or complete settings object
     */
    function onSettingsChange(next) {
      const prev = settings;
      settings = sanitizeSettings(next, prev);
      util.storageSet(SETTINGS_KEY, settings);
      if (settings.quality !== prev.quality) applyQuality();
      if (settings.inputMode !== prev.inputMode) applyInputMode();
      if (settings.volume !== prev.volume) audio.setVolume(settings.volume);
      audio.setMix(settings);
      if (settings.invertY !== prev.invertY) input.setInvertY(settings.invertY);
      if (settings.reducedMotion !== prev.reducedMotion) player?.setReducedMotion(settings.reducedMotion);
    }

    // --- frame loop ------------------------------------------------------------------------------

    /**
     * Run while exploring or resting, after Start and while no menu is open.
     * @returns {boolean}
     */
    function loopNeeded() {
      return loopWanted && state === 'playing';
    }

    /** Starts the requestAnimationFrame loop (no-op while running or while the tab is hidden). */
    function startLoop() {
      if (rafId || document.hidden) return;
      last = performance.now();
      acc = 0;
      rafId = requestAnimationFrame(frame);
    }

    /** Stops the loop; timing restarts cleanly on the next startLoop(). */
    function stopLoop() {
      if (!rafId) return;
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    /**
     * One animation frame: look input, fixed-timestep physics with interpolation, world streaming,
     * underwater handling, location prompts at 10 Hz, audio modulation and rendering.
     * @param {number} now  DOMHighResTimeStamp
     */
    function frame(now) {
      rafId = requestAnimationFrame(frame);
      if (!world || !player) return;
      renderer.info.reset();

      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      time += dt;
      fpsFrames++;
      fpsTime += dt;
      if (fpsTime >= FPS_INTERVAL) {
        fps = Math.round(fpsFrames / fpsTime);
        fpsFrames = 0;
        fpsTime = 0;
      }

      // Resting keeps the scene alive while holding movement and settling the camera.
      const look = input.consumeLook();
      if (!resting) player.applyLook(look.dx, look.dy);
      if (!resting) acc += dt;
      let steps = 0;
      while (acc >= C.FIXED_DT && steps < C.MAX_STEPS) {
        player.fixedStep(C.FIXED_DT);
        acc -= C.FIXED_DT;
        steps++;
      }
      if (acc > C.FIXED_DT) acc = C.FIXED_DT; // never let a slow frame snowball into more steps
      const alpha = acc / C.FIXED_DT;

      const pos = player.position;
      const roomName = world.journey.roomAt(pos.x,pos.z)?.name;
      roomHaze = atmosphere.update(roomName, dt);
      applyFog();
      world.update(pos.x, pos.z, 2);
      if (resting) {
        const settle = settings.reducedMotion ? 1 : 1 - Math.exp(-dt * 1.6);
        camera.position.lerp(restEye, settle);
        camera.quaternion.slerp(restView, settle);
      } else player.updateCamera(alpha);
      updateUnderwater();
      waterEffects.update(dt, world.waterAt(camera.position.x,camera.position.z), underwater, settings.reducedMotion, renderer.getPixelRatio());
      skyDome.position.copy(camera.position);
      skyDome.visible = !underwater;
      world.setTime(time, player);

      hudTimer += dt;
      if (hudTimer >= HUD_INTERVAL) {
        updateHUD();
          audioState.nearWater = sampleNearWater();
        if (shadowsOn) refreshShadowFlags(hudTimer);
        hudTimer = 0;
      }

      const ps = player.state;
      audioState.inWater = ps.inWater;
      audioState.swimming = ps.swimming;
      audioState.underwater = underwater;
      audioState.speed = ps.speed;
      audioState.room = roomName || 'Sun Pavilion';
      audioState.position = camera.position;
      audioState.time = time;
      audioState.ending = resting && !!activeRest?.ending;
      audioState.pitch = resting ? -0.04 : player.pitch;
      audioState.yaw = resting ? activeRest.yaw : player.yaw;
      audio.update(dt, audioState);

      if (shadowsOn && dirLight) followLight(pos);
      render();
    }

    // --- document / window events ----------------------------------------------------------------

    /**
     * Hidden tab: stop rendering, silence audio and open the pause menu. Visible: restart the loop
     * unless a menu is open.
     */
    function onVisibilityChange() {
      if (document.hidden) {
        stopLoop();
        pause();
        audio.setPaused(true);
      } else {
        if (loopNeeded()) startLoop();
        if (state === 'playing') audio.setPaused(false);
      }
    }

    /** Re-captures the mouse when the initial pointer-lock request was refused or timed out. */
    function onAppPointerDown() {
      if (state === 'playing' && !resting && inputMode === 'desktop' && !input.isPointerLocked()) input.requestPointerLock();
    }

    /**
     * Lets the browser restore a lost WebGL context instead of leaving a dead canvas.
     * @param {Event} event
     */
    function onContextLost(event) {
      event.preventDefault();
      stopLoop();
      pause();
      ui.toast('Graphics context lost — trying to recover', 3000);
    }

    /** Resumes rendering once the WebGL context is back (Three re-uploads resources itself). */
    function onContextRestored() {
      if (loopNeeded()) {
        startLoop();
      } else {
        renderOnce();
      }
    }

    /**
     * Second half of boot: textures, the first chunk ring and the backdrop frame. This is the slow
     * part (hundreds of ms of texture synthesis and geometry), so it runs one frame after the start
     * overlay is shown, letting the overlay paint immediately instead of after a blank pause.
     */
    function finishBoot() {
      try {
        if (!world) buildWorld(); // Start pressed within the first frame has already built it
          renderOnce();
      } catch (err) {
        console.error(err);
        stopLoop();
        showError('The game failed to start: ' + (err && err.message ? err.message : String(err)));
      }
    }

    // --- boot sequence ---------------------------------------------------------------------------
    applyInputMode();
    input.setInvertY(settings.invertY);
    input.setEnabled(false);
    audio.setVolume(settings.volume);
    audio.setMix(settings);
    applyQuality(); // fog, composer, shadows and viewport; nothing is drawn until the world exists
    ui.setSettings(settings);
    ui.setTouchControlsVisible(false);
    updateHUD();
    ui.showStart({ seed, mode, touch: inputMode === 'touch' });

    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('keydown', onRestKey);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', onOrientationChange);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    app.addEventListener('pointerdown', onAppPointerDown);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    const bootFrame = requestAnimationFrame(finishBoot); // world + backdrop behind the overlay; the loop itself waits for Start

    return {
      get world() { return world; },
      get player() { return player; },
      get input() { return input; },
      renderer,
      scene,
      camera,
      get settings() { return settings; },
      get state() { return state; },
      get seed() { return seed; },
      get depth() { return depth; },
      get mode() { return mode; },
      dispose() {
        if (disposed) return;
        disposed = true;
        loopWanted = false;
        stopLoop();
        cancelAnimationFrame(bootFrame);
        clearTimeout(orientationTimer);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        document.removeEventListener('keydown', onRestKey);
        window.removeEventListener('resize', resize);
        window.removeEventListener('orientationchange', onOrientationChange);
        window.visualViewport?.removeEventListener('resize', resize);
        app.removeEventListener('pointerdown', onAppPointerDown);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
        input.dispose();
        audio.dispose();
        waterEffects.dispose();
        ui.dispose();
        world?.dispose();
        Object.values(textures || {}).forEach(texture => texture.dispose());
        composer?.passes.forEach(pass => pass.dispose?.());
        composer?.dispose();
        dirLight?.shadow.dispose();
        skyDome.geometry.dispose();
        skyDome.material.dispose();
        renderer.dispose();
      },
      get resting() { return resting; },
      pause,
      resume,
    };
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  /** Entry point: validates the environment (Three, modules, markup, WebGL), then builds the game. */
  export function startGame(ui) {
    const app = byId('app');
    const canvas = byId('c');
    const deviceTouch = util.isTouchDevice();
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !deviceTouch, powerPreference: 'high-performance' });
      return createGame(renderer, app, canvas, deviceTouch, ui);
    } catch (err) {
      renderer?.dispose();
      console.error(err);
      ui.showError('The game could not start. Check that WebGL is enabled in your browser. ' + err.message);
      return null;
    }
  }
