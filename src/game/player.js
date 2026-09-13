import * as THREE from 'three';
import { util } from './util.js';
import { CONST } from './util.js';
/* player.js — capsule player controller: walk/sprint/jump/swim, cell + AABB collision, interpolated camera. */


  // Tuning values not covered by CONST (CONTRACT §8).
  const ACCEL_GROUND = 40;      // units/s² toward the wish velocity while on the ground
  const ACCEL_AIR = 8;          // ... while airborne
  const SWIM_ACCEL = 10;        // horizontal acceleration while swimming
  const SWIM_DRAG = 3;          // per-second velocity drag while swimming (all axes)
  const SWIM_VERT_ACCEL = 12;   // jump/down vertical acceleration while swimming
  const SWIM_VERT_MAX = 2.2;    // cap for the controlled vertical swim speed
  const SWIM_VY_MAX = 2.5;      // cap for the total vertical swim speed
  const SWIM_GRAVITY = 2;       // mild gravity while swimming
  const BUOYANCY = 6;           // spring stiffness pulling the feet toward FLOAT_DEPTH below the surface
  const FLOAT_DEPTH = 1.25;     // resting feet depth below the water surface (eyes just above it)
  const DIVE_GAIN = 6;          // look-down diving: vertical acceleration per unit of sin(pitch) * forward speed
  const SURFACE_BAND = 1.6;     // feet within this distance below the surface may climb out (WATER_STEP_HEIGHT)
  const COYOTE_TIME = 0.12;     // seconds after leaving the ground during which a jump is still accepted
  const SNAP_DOWN = 0.3;        // max drop that keeps the player glued to descending stairs
  const SOFT_LANDING_VY = -3;   // landing faster than this plays a light footstep
  const HARD_LANDING_VY = -7;   // landing faster than this plays a heavy footstep
  const STRIDE_WALK = 2.1;      // distance between footstep sounds when walking
  const STRIDE_SPRINT = 2.6;    // ... when sprinting
  const STRIDE_WADE = 1.6;      // ... when wading (splash sounds)
  const EYE_SWIM = 1.35;        // eye height above the feet while swimming
  const EYE_BLEND_TIME = 0.2;   // seconds for the standing <-> swimming eye height transition
  const BOB_AMP = 0.03;         // head bob amplitude (units) on the ground
  const BOB_RATE = 2.8;         // head bob phase advance (radians per unit walked)
  const BOB_SWIM_AMP = 0.012;   // subtle bob amplitude while swimming
  const BOB_SWIM_RATE = 2.4;    // swimming bob phase advance (radians per second)
  const BOB_FADE = 5;           // bob amplitude blend speed (fraction of BOB_AMP per second)
  const PUSH_EPS = 1e-4;        // penetrations smaller than this are ignored by the collision solver
  const MAX_PASSES = 3;         // collision solver passes per step
  const MAX_FLOOR_RISE = 4;     // a floor farther above the feet than this means "inside solid": ignored
  const STEP_CAMERA_RATE = 12; // blend tread height changes into a continuous climb/descent

  /**
   * Create the player controller (CONTRACT §8).
   * @param {{world: object, camera: THREE.Camera, input: object, audio: object}} opts
   * @returns {object} player API: position, prevPosition, velocity, yaw, pitch, state, setWorld, teleport,
   *   applyLook, fixedStep, updateCamera, eyeY
   */
  function createPlayer(opts) {
    
    const C = CONST;
    const clamp = util.clamp;
    const R = C.PLAYER_RADIUS;
    const H = C.PLAYER_HEIGHT;
    const CELL = C.CELL;
    const EYE_RATE = (C.EYE_HEIGHT - EYE_SWIM) / EYE_BLEND_TIME;

    let world = opts.world;
    const camera = opts.camera;
    const input = opts.input;
    const audio = opts.audio;

    const position = new THREE.Vector3();      // feet position (physics state)
    const prevPosition = new THREE.Vector3();  // feet position at the start of the last step
    const velocity = new THREE.Vector3();
    const wish = new THREE.Vector3();          // scratch: wish direction in world XZ
    const camPos = new THREE.Vector3();        // scratch: interpolated camera position

    const state = {
      onGround: false, inWater: false, swimming: false, underwater: false,
      sprinting: false, speed: 0, wading: false,
    };

    let yaw = 0;
    let pitch = 0;
    let coyote = COYOTE_TIME;      // time since the feet last touched the ground
    let wetFeet = 0, dripTimer = 0;
    let stride = 0;                // horizontal distance walked since the last footstep sound
    let eyeH = C.EYE_HEIGHT;       // current eye height above the feet (blends toward EYE_SWIM when swimming)
    let prevEyeH = C.EYE_HEIGHT;
    let reducedMotion = false;
    let bobPhase = 0;
    let bobAmp = 0;
    let bobY = 0;                  // current head bob offset
    let prevBobY = 0;
    let stepOffset = 0, prevStepOffset = 0;
    let camY = C.EYE_HEIGHT;       // camera y written by the last updateCamera()
    let nx = 0;                    // candidate XZ position being resolved (shared with pushOutRect)
    let nz = 0;

    /**
     * Push the candidate circle (nx, nz, radius R) out of the XZ rectangle [x0,x1]x[z0,z1] and kill the
     * velocity component pointing into it. Returns true when a real push happened.
     */
    function pushOutRect(x0, z0, x1, z1) {
      const px = nx < x0 ? x0 : (nx > x1 ? x1 : nx);   // closest point of the rectangle to the centre
      const pz = nz < z0 ? z0 : (nz > z1 ? z1 : nz);
      const dx = nx - px;
      const dz = nz - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) return false;
      let normX;
      let normZ;
      let depth;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        normX = dx / d;
        normZ = dz / d;
        depth = R - d;
      } else {
        // Centre inside the rectangle: leave through the nearest face.
        const dl = nx - x0;
        const dr = x1 - nx;
        const db = nz - z0;
        const df = z1 - nz;
        let m = dl;
        normX = -1;
        normZ = 0;
        if (dr < m) { m = dr; normX = 1; normZ = 0; }
        if (db < m) { m = db; normX = 0; normZ = -1; }
        if (df < m) { m = df; normX = 0; normZ = 1; }
        depth = m + R;
      }
      if (depth <= PUSH_EPS) return false;
      nx += normX * depth;
      nz += normZ * depth;
      const vn = velocity.x * normX + velocity.z * normZ;
      if (vn < 0) {
        velocity.x -= vn * normX;
        velocity.z -= vn * normZ;
      }
      return true;
    }

    /**
     * Resolve (nx, nz) against blocking collision cells and wall AABBs, up to MAX_PASSES passes.
     * Returns false when the last pass still pushed (the player is pinched): the caller keeps the old position.
     */
    function resolveXZ(feetY, stepLimit, walls) {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        let pushed = false;
        // a. Cells overlapped by the circle's bounding box (Math.floor handles negative coordinates).
        const i0 = Math.floor((nx - R) / CELL);
        const i1 = Math.floor((nx + R) / CELL);
        const j0 = Math.floor((nz - R) / CELL);
        const j1 = Math.floor((nz + R) / CELL);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const x0 = i * CELL;
            const z0 = j * CELL;
            const fl = world.floorAt(x0 + CELL * 0.5, z0 + CELL * 0.5);
            const ce = world.ceilingAt(x0 + CELL * 0.5, z0 + CELL * 0.5);
            // A cell blocks when its floor is too high to step onto or the gap below its ceiling is too low.
            const blocked = fl > feetY + stepLimit || ce - Math.max(fl, feetY) < H * 0.9;
            if (blocked && pushOutRect(x0, z0, x0 + CELL, z0 + CELL)) pushed = true;
          }
        }
        // b. Wall AABBs overlapping the capsule's vertical span; tops within a step are walkable instead.
        for (let k = 0; k < walls.length; k++) {
          const w = walls[k];
          if (w.y0 < feetY + H && w.y1 > feetY + stepLimit && pushOutRect(w.x0, w.z0, w.x1, w.z1)) pushed = true;
        }
        if (!pushed) return true;
      }
      return false;
    }

    /**
     * Height of the support under (nx, nz): the walkable floor cell, raised by any wall AABB top the
     * player can stand on (top within stepLimit above the feet, footprint containing the point).
     */
    function supportAt(feetY, stepLimit, walls) {
      let f = world.floorAt(nx, nz);
      for (let k = 0; k < walls.length; k++) {
        const w = walls[k];
        if (w.y1 > f && w.y1 <= feetY + stepLimit && nx > w.x0 && nx < w.x1 && nz > w.z0 && nz < w.z1) f = w.y1;
      }
      // A floor far above the feet means the point is inside solid geometry: never catapult the player.
      return f > feetY + MAX_FLOOR_RISE ? feetY : f;
    }

    /**
     * Replace the world queried for collision and water (after a teleport to a new depth).
     * @param {object} w world created by createWorld
     */
    function setWorld(w) {
      world = w;
    }

    /**
     * Place the player: feet position, zero velocity, given yaw, level pitch, all transient state reset.
     */
    function teleport(x, y, z, newYaw) {
      world.resetRide?.();
      position.set(x, y, z);
      prevPosition.copy(position);
      velocity.set(0, 0, 0);
      yaw = Number(newYaw) || 0;
      pitch = 0;
      coyote = COYOTE_TIME;
      stride = 0; wetFeet = 0; dripTimer = 0;
      eyeH = C.EYE_HEIGHT;
      prevEyeH = C.EYE_HEIGHT;
      bobPhase = 0;
      bobAmp = 0;
      bobY = 0;
      prevBobY = 0;
      stepOffset = prevStepOffset = 0;
      camY = y + C.EYE_HEIGHT;
      state.onGround = false;
      state.inWater = false;
      state.swimming = false;
      state.wading = false;
      state.underwater = false;
      state.sprinting = false;
      state.speed = 0;
    }

    /**
     * Apply look deltas (radians, already invert-adjusted by input): yaw -= dx, pitch -= dy (clamped).
     */
    function applyLook(dx, dy) {
      yaw -= dx || 0;
      if (yaw > Math.PI) yaw -= Math.PI * 2;
      else if (yaw < -Math.PI) yaw += Math.PI * 2;
      pitch = clamp(pitch - (dy || 0), -1.55, 1.55);
    }

    /**
     * One fixed physics step (CONTRACT §8): input → velocity → XZ collision → vertical → audio → state.
     * @param {number} dt step length in seconds (FIXED_DT)
     */
    function fixedStep(dt) {
      prevPosition.copy(position);
      prevEyeH = eyeH;
      prevBobY = bobY;
      prevStepOffset = stepOffset;

      const x = position.x;
      const feetY = position.y;
      const z = position.z;
      const vyBefore = velocity.y;
      const inp = input.state;
      const ride = world.stepRide?.(position, velocity, dt);
      if (ride) {
        input.consumeJump();
        // Input owns the view while the ride owns position; looking never steers the flume.
        stepOffset *= Math.exp(-STEP_CAMERA_RATE * dt);
        state.onGround = false;
        state.inWater = false;
        state.swimming = false;
        state.underwater = false;
        state.wading = false;
        state.sprinting = false;
        state.speed = velocity.length();
        eyeH = C.EYE_HEIGHT;
        bobY = 0;
        if (ride.finished) audio.splash(1.4);
        return;
      }
      const jumpPressed = input.consumeJump();   // consumed every step so a press cannot linger across modes

      // 1. Wish direction in world XZ (forward = (-sin yaw, 0, -cos yaw), right = (cos yaw, 0, -sin yaw)).
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      const mx = clamp(inp.moveX || 0, -1, 1);
      const mz = clamp(inp.moveZ || 0, -1, 1);
      wish.set(-sy * mz + cy * mx, 0, -cy * mz - sy * mx);
      const wishLen = wish.length();
      if (wishLen > 1) wish.divideScalar(wishLen);
      const moving = wishLen > 1e-3;
      const sprint = !!inp.sprint && moving;

      // 2. Water sampling. NaN (no water) makes every comparison below false.
      const waterY = world.waterAt(x, z);
      const depth = waterY - feetY;
      const wasInWater = state.inWater;
      const inWater = depth > 0.05;
      const swimming = depth > C.SWIM_DEPTH;
      const wading = inWater && !swimming;
      // Climbing out of water is allowed only near the surface (wading is always near it).
      const stepLimit = inWater && feetY > waterY - SURFACE_BAND ? C.WATER_STEP_HEIGHT : C.STEP_HEIGHT;

      // 3. Velocity update.
      let jumped = false;
      if (!swimming) {
        const maxSpeed = (sprint ? C.SPRINT_SPEED : C.WALK_SPEED) * (wading ? C.WADE_FACTOR : 1);
        const accel = (state.onGround ? ACCEL_GROUND : ACCEL_AIR) * dt;
        velocity.x += clamp(wish.x * maxSpeed - velocity.x, -accel, accel);
        velocity.z += clamp(wish.z * maxSpeed - velocity.z, -accel, accel);
        velocity.y -= C.GRAVITY * dt;
        if (jumpPressed && (state.onGround || coyote < COYOTE_TIME)) {
          velocity.y = C.JUMP_SPEED;
          coyote = COYOTE_TIME;   // no second jump until grounded again
          jumped = true;
          audio.jump();
        }
      } else {
        const swimSpeed = sprint ? C.SWIM_SPRINT_SPEED : C.SWIM_SPEED;
        const accel = SWIM_ACCEL * dt;
        velocity.x += clamp(wish.x * swimSpeed - velocity.x, -accel, accel);
        velocity.z += clamp(wish.z * swimSpeed - velocity.z, -accel, accel);
        velocity.multiplyScalar(Math.max(0, 1 - SWIM_DRAG * dt));
        velocity.y -= SWIM_GRAVITY * dt;
        if (inp.jumpHeld) {
          velocity.y = Math.min(velocity.y + SWIM_VERT_ACCEL * dt, SWIM_VERT_MAX);
        } else if (inp.downHeld) {
          velocity.y = Math.max(velocity.y - SWIM_VERT_ACCEL * dt, -SWIM_VERT_MAX);
        } else {
          // Damped spring toward the float height; the buoyant term cancels SWIM_GRAVITY exactly there.
          velocity.y += ((waterY - FLOAT_DEPTH - feetY) * BUOYANCY + SWIM_GRAVITY) * dt;
        }
        // Look-based diving: with rotation.x = pitch the view direction's y component is sin(pitch),
        // so swimming forward while looking down (pitch < 0) pushes the player under.
        if (mz > 0) velocity.y += Math.sin(pitch) * mz * swimSpeed * DIVE_GAIN * dt;
        velocity.y = clamp(velocity.y, -SWIM_VY_MAX, SWIM_VY_MAX);
        // Surfacing stops just below the depth where swimming ends, so the mode cannot flip-flop there.
        const feetCap = waterY - C.SWIM_DEPTH - 0.01;
        if (velocity.y > 0 && feetY + velocity.y * dt > feetCap) velocity.y = Math.max(0, (feetCap - feetY) / dt);
      }

      // 4. Horizontal move with collision push-out; a pinch that never resolves keeps the old XZ.
      nx = x + velocity.x * dt;
      nz = z + velocity.z * dt;
      const walls = world.wallsNear(x, z);
      if (!resolveXZ(feetY, stepLimit, walls)) {
        nx = x;
        nz = z;
      }

      // 5. Vertical move: floor support, landing, step-down glue, ceiling, hard floor guarantee.
      let ny = feetY + velocity.y * dt;
      const f = supportAt(feetY, stepLimit, walls);
      const wasOnGround = state.onGround;
      let onGround = false;
      if (ny <= f) {
        if (!wasOnGround && velocity.y < SOFT_LANDING_VY) {
          audio.footstep(velocity.y < HARD_LANDING_VY ? 1.6 : 0.9, wetFeet > 0 ? 'wet' : 'dry');
        }
        ny = f;
        velocity.y = 0;
        onGround = true;
      } else if (wasOnGround && !jumped && velocity.y <= 0 && ny - f <= SNAP_DOWN) {
        ny = f;   // stay glued to the floor when walking down steps
        velocity.y = 0;
        onGround = true;
      }
      const c = world.ceilingAt(nx, nz);
      if (ny + H > c) {
        ny = c - H;
        velocity.y = Math.min(velocity.y, 0);
      }
      if (ny < f) ny = f;
      // Keep collision on the real treads, absorbing only grounded step snaps in the camera.
      // Jumps and long drops retain their physical motion; teleports clear this offset explicitly.
      if (onGround && !jumped && (wasOnGround || inWater) && Math.abs(ny-feetY) <= stepLimit) {
        stepOffset = clamp(stepOffset + feetY - ny, -1.3, 1.3);
      }
      stepOffset *= Math.exp(-STEP_CAMERA_RATE * dt);

      // 6. Water transitions and the underwater flag (eye height is lower while swimming).
      if (inWater && !wasInWater) audio.splash(clamp(-vyBefore / 6, 0.5, 1.5));
      wetFeet = inWater ? 7 : Math.max(0, wetFeet - dt);
      dripTimer -= dt;
      if (!inWater && wetFeet > 0 && dripTimer <= 0) { audio.waterDrip?.(); dripTimer = 1.3 + Math.random() * 0.9; }
      const underwater = ny + (swimming ? EYE_SWIM : C.EYE_HEIGHT) < waterY - 0.02;

      // 7. Footsteps from the distance walked on the ground; wading plays small splashes instead.
      const dx = nx - x;
      const dz = nz - z;
      const moved = Math.sqrt(dx * dx + dz * dz);
      if (onGround && !swimming && moved > 1e-4) {
        stride += moved;
        const strideLen = inWater ? STRIDE_WADE : (sprint ? STRIDE_SPRINT : STRIDE_WALK);
        if (stride >= strideLen) {
          stride = 0;
          if (inWater) audio.splash(sprint ? 0.35 : 0.2);
          else audio.footstep(sprint ? 1.2 : 1, wetFeet > 0 ? 'wet' : 'dry');
        }
      }

      // 8. Commit position and state.
      position.set(nx, ny, nz);
      coyote = onGround ? 0 : coyote + dt;
      state.onGround = onGround;
      state.inWater = inWater;
      state.swimming = swimming;
      state.wading = wading;
      state.underwater = underwater;
      state.sprinting = sprint;
      state.speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

      // Camera helpers advanced at the physics rate so updateCamera() can interpolate them.
      const eyeTarget = swimming ? EYE_SWIM : C.EYE_HEIGHT;
      eyeH += clamp(eyeTarget - eyeH, -EYE_RATE * dt, EYE_RATE * dt);
      let ampTarget = 0;
      let phaseRate = 0;
      if (swimming) {
        ampTarget = BOB_SWIM_AMP;
        phaseRate = BOB_SWIM_RATE;
      } else if (onGround && moved > 1e-4) {
        ampTarget = BOB_AMP;
        phaseRate = BOB_RATE * state.speed;   // bob frequency proportional to speed
      }
      const fade = BOB_AMP * BOB_FADE * dt;
      bobAmp += clamp(ampTarget - bobAmp, -fade, fade);
      bobPhase = (bobPhase + phaseRate * dt) % (Math.PI * 2);
      bobY = reducedMotion ? 0 : Math.sin(bobPhase) * bobAmp;
    }

    /**
     * Place the camera at the eye interpolated between the previous and current physics state.
     * @param {number} alpha interpolation factor (clamped to [0,1])
     */
    function updateCamera(alpha) {
      const a = clamp(alpha, 0, 1);
      camPos.lerpVectors(prevPosition, position, a);
      camPos.y += prevEyeH + (eyeH - prevEyeH) * a + prevBobY + (bobY - prevBobY) * a;
      camPos.y += prevStepOffset + (stepOffset - prevStepOffset) * a;
      camera.position.copy(camPos);
      if (camera.rotation.order !== 'YXZ') camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
      camY = camPos.y;
    }

    /**
     * Current camera height (the eye y written by the last updateCamera call).
     * @returns {number}
     */
    function eyeY() {
      return camY;
    }

    return {
      position,
      prevPosition,
      velocity,
      state,
      get yaw() { return yaw; },
      set yaw(v) { yaw = v; },
      get pitch() { return pitch; },
      set pitch(v) { pitch = clamp(v, -1.55, 1.55); },
      setWorld,
      setReducedMotion(value) { reducedMotion = !!value; if (reducedMotion) bobY = prevBobY = 0; },
      teleport,
      applyLook,
      fixedStep,
      updateCamera,
      eyeY,
    };
  }

  export { createPlayer };

