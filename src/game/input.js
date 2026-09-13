
/* input.js — desktop pointer-lock + keyboard, touch joystick / drag-look / buttons, mode switching. */


  /** Joystick knob travel radius in CSS pixels. */
  const JOY_RADIUS = 48;
  /** Joystick dead zone in CSS pixels (no movement until the knob leaves it). */
  const JOY_DEAD = 12;
  /** Two taps closer than this in time (ms) and distance (px) form a double-tap. */
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_PX = 24;
  /** A single tap must be released within this many ms and move less than DOUBLE_TAP_PX to count as a tap. */
  const TAP_MAX_MS = 300;
  /** How long requestPointerLock waits for pointerlockchange / pointerlockerror before giving up. */
  const LOCK_TIMEOUT_MS = 1000;
  /** Largest per-event mouse delta accepted while locked (Chrome emits a huge spike right after locking). */
  const MAX_MOUSE_DELTA = 250;
  /** Minimum spacing between two onPauseRequest calls so Escape + pointerlockchange cannot double-fire. */
  const PAUSE_DEBOUNCE_MS = 100;

  const KEY_FORWARD = ['KeyW', 'ArrowUp'];
  const KEY_BACK = ['KeyS', 'ArrowDown'];
  const KEY_LEFT = ['KeyA', 'ArrowLeft'];
  const KEY_RIGHT = ['KeyD', 'ArrowRight'];
  const KEY_SPRINT = ['ShiftLeft', 'ShiftRight'];
  const KEY_DOWN = ['ControlLeft', 'ControlRight', 'KeyC'];
  const KEY_PREVENT = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

  /**
   * True when a keyboard event originates from a text/form control and must not drive the game.
   * @param {Event} e
   * @returns {boolean}
   */
  function isFormTarget(e) {
    const t = e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
  }

  /**
   * Create the input controller (CONTRACT §6). Desktop mode uses pointer lock + keyboard; touch mode uses
   * Pointer Events on the touch layer (floating joystick on the left half, drag-look on the right half,
   * double-tap on the right half toggles sprint, dedicated jump button).
   *
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas          WebGL canvas (pointer lock target)
   * @param {HTMLElement} opts.touchLayer            #touch-layer (must have `touch-action: none`)
   * @param {HTMLElement} opts.joystickBase          #joystick (positioned with left/top + translate(-50%,-50%) in CSS)
   * @param {HTMLElement} opts.joystickKnob          #joystick-knob
   * @param {HTMLElement} opts.jumpButton            #btn-jump
   * @param {HTMLElement} opts.sprintIndicator       #sprint-indicator (class 'on' while sprint toggled)
   * @param {function(): void} [opts.onPauseRequest] called when the game should pause (pointer lock lost / Escape)
   * @param {function(): void} [opts.onFirstGesture] called once on the very first pointerdown/keydown anywhere
   * @returns {Object} input controller
   */
  function createInput(opts) {
    const o = opts || {};
    const canvas = o.canvas || null;
    const touchLayer = o.touchLayer || null;
    const joystickBase = o.joystickBase || null;
    const joystickKnob = o.joystickKnob || null;
    const jumpButton = o.jumpButton || null;
    const sprintIndicator = o.sprintIndicator || null;
    const onPauseRequest = typeof o.onPauseRequest === 'function' ? o.onPauseRequest : null;
    const onFirstGesture = typeof o.onFirstGesture === 'function' ? o.onFirstGesture : null;

    /** @type {{moveX:number, moveZ:number, sprint:boolean, jumpHeld:boolean, downHeld:boolean}} */
    const state = { moveX: 0, moveZ: 0, sprint: false, jumpHeld: false, downHeld: false };

    let mode = 'desktop';
    let enabled = false;
    let invertY = false;
    let mouseSens = 0.0022;
    let touchSens = 0.005;
    let disposed = false;

    // Accumulated look deltas (radians) and the edge-triggered jump flag.
    let lookDX = 0;
    let lookDY = 0;
    let jumpQueued = false;

    // Desktop keyboard state.
    const keys = new Set();
    let locked = false;
    let lastPauseAt = -Infinity;
    /** @type {{promise: Promise<boolean>, finish: function(boolean): void}|null} */
    let lockPending = null;

    // Touch state, keyed by pointerId.
    let joyPointerId = null;
    let joyOriginX = 0;
    let joyOriginY = 0;
    let lookPointerId = null;
    let lookLastX = 0;
    let lookLastY = 0;
    let lookStartX = 0;
    let lookStartY = 0;
    let lookStartTime = 0;
    let lookMoved = 0;
    /** @type {{time:number, x:number, y:number}|null} */
    let lastTap = null;
    let jumpPointerId = null;

    let firstGestureFired = false;

    /** Registered listeners so dispose() can remove every one of them. */
    const listeners = [];

    /**
     * Add a listener and remember it for dispose(). A null target is silently skipped so missing DOM
     * elements only disable the matching feature.
     * @param {EventTarget|null} target
     * @param {string} type
     * @param {function} fn
     * @param {Object|boolean} [options]
     */
    function on(target, type, fn, options) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, fn, options);
      listeners.push({ target, type, fn, options });
    }

    /** Fire onFirstGesture exactly once. */
    function fireFirstGesture() {
      if (firstGestureFired) return;
      firstGestureFired = true;
      if (onFirstGesture) onFirstGesture();
    }

    /** Debounced pause request (Escape keydown and pointerlockchange may both fire for one exit). */
    function requestPause() {
      const now = performance.now();
      if (now - lastPauseAt < PAUSE_DEBOUNCE_MS) return;
      lastPauseAt = now;
      if (onPauseRequest) onPauseRequest();
    }

    /** Reflect the sprint toggle on the on-screen indicator. */
    function setSprint(value) {
      state.sprint = value;
      if (sprintIndicator) sprintIndicator.classList.toggle('on', value);
    }

    /** Hide the joystick and zero its contribution. */
    function releaseJoystick() {
      joyPointerId = null;
      state.moveX = 0;
      state.moveZ = 0;
      if (joystickBase) joystickBase.classList.remove('active');
      if (joystickKnob) joystickKnob.style.transform = 'translate(0px, 0px)';
    }

    /** Drop every held key / pointer and zero all movement and look state. */
    function releaseAll() {
      keys.clear();
      releaseJoystick();
      lookPointerId = null;
      lastTap = null;
      jumpPointerId = null;
      state.moveX = 0;
      state.moveZ = 0;
      state.jumpHeld = false;
      state.downHeld = false;
      setSprint(false);
      lookDX = 0;
      lookDY = 0;
      jumpQueued = false;
    }

    /** True while game input should be processed in the given mode. */
    function active(forMode) {
      return enabled && !disposed && mode === forMode;
    }

    // ------------------------------------------------------------------ desktop: keyboard

    /** Recompute moveX/moveZ from the set of held keys (right +, forward +). */
    function updateKeyMove() {
      const any = (list) => list.some((code) => keys.has(code));
      state.moveX = (any(KEY_RIGHT) ? 1 : 0) - (any(KEY_LEFT) ? 1 : 0);
      state.moveZ = (any(KEY_FORWARD) ? 1 : 0) - (any(KEY_BACK) ? 1 : 0);
      state.sprint = any(KEY_SPRINT);
      state.downHeld = any(KEY_DOWN);
      state.jumpHeld = keys.has('Space');
    }

    function onKeyDown(e) {
      fireFirstGesture();
      if (isFormTarget(e)) return;
      if (e.code === 'Escape') {
        // Pauses in both modes (a keyboard may be attached in touch mode). While pointer-locked the browser
        // swallows Escape and exits the lock itself, which pauses via onLockChange.
        if (enabled && !disposed && !locked) requestPause();
        return;
      }
      if (!active('desktop')) return;
      const code = e.code;
      if (KEY_PREVENT.indexOf(code) !== -1) e.preventDefault();
      if (code === 'Space' && !e.repeat && !keys.has('Space')) jumpQueued = true;
      keys.add(code);
      updateKeyMove();
    }

    function onKeyUp(e) {
      if (!keys.has(e.code)) return;
      keys.delete(e.code);
      updateKeyMove();
    }

    // ------------------------------------------------------------------ desktop: mouse / pointer lock

    /** @returns {boolean} whether the canvas currently owns the pointer lock */
    function isPointerLocked() {
      return !!canvas && document.pointerLockElement === canvas;
    }

    function onMouseMove(e) {
      if (!locked || !active('desktop')) return;
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      if (Math.abs(mx) > MAX_MOUSE_DELTA || Math.abs(my) > MAX_MOUSE_DELTA) return;
      lookDX += mx * mouseSens;
      lookDY += my * mouseSens * (invertY ? -1 : 1);
    }

    function onLockChange() {
      const wasLocked = locked;
      locked = isPointerLocked();
      if (lockPending) lockPending.finish(locked);
      // Losing the lock while playing (Escape or focus loss) pauses the game.
      if (wasLocked && !locked && active('desktop')) requestPause();
    }

    function onLockError() {
      locked = isPointerLocked();
      if (lockPending) lockPending.finish(false);
    }

    /**
     * Request pointer lock on the canvas. Never throws: resolves false when pointer lock is unsupported
     * (iOS Safari), when the browser rejects the request (Chrome's "too soon" SecurityError), or when
     * neither pointerlockchange nor pointerlockerror arrives within LOCK_TIMEOUT_MS (Safari returns no promise).
     * @returns {Promise<boolean>} true when the lock was acquired
     */
    function requestPointerLock() {
      if (disposed || mode !== 'desktop' || !canvas || typeof canvas.requestPointerLock !== 'function') {
        return Promise.resolve(false);
      }
      if (isPointerLocked()) {
        locked = true;
        return Promise.resolve(true);
      }
      if (lockPending) return lockPending.promise;

      const pending = { promise: null, finish: null };
      pending.promise = new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => pending.finish(isPointerLocked()), LOCK_TIMEOUT_MS);
        pending.finish = (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (lockPending === pending) lockPending = null;
          resolve(!!ok);
        };
        let ret;
        try {
          ret = canvas.requestPointerLock();
        } catch (err) {
          pending.finish(false);
          return;
        }
        // Chrome returns a promise (rejects with SecurityError when called too soon after an exit).
        if (ret && typeof ret.then === 'function') {
          ret.then(() => pending.finish(isPointerLocked()), () => pending.finish(false));
        }
      });
      lockPending = pending;
      return pending.promise;
    }

    /** Release pointer lock if held (safe on browsers without the API). */
    function exitPointerLock() {
      try {
        if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
          document.exitPointerLock();
        }
      } catch (err) {
        // Some browsers throw when no lock is held or the document is not active; nothing to do.
      }
    }

    // ------------------------------------------------------------------ touch: joystick / look / buttons

    /**
     * Layer-relative coordinates of a pointer event (the joystick is positioned inside the touch layer).
     * @param {PointerEvent} e
     * @returns {{x:number, y:number}}
     */
    function layerPoint(e) {
      if (!touchLayer) return { x: e.clientX, y: e.clientY };
      const r = touchLayer.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    /** Pointer-capture the layer so drags that leave it keep reporting (touch captures implicitly). */
    function capture(el, pointerId) {
      try {
        if (el && typeof el.setPointerCapture === 'function') el.setPointerCapture(pointerId);
      } catch (err) {
        // Capture can fail if the pointer is already gone (e.g. very quick taps); tracking still works.
      }
    }

    /** Begin a joystick drag anchored at the touch-down point. */
    function startJoystick(e) {
      joyPointerId = e.pointerId;
      joyOriginX = e.clientX;
      joyOriginY = e.clientY;
      if (joystickBase) {
        const p = layerPoint(e);
        joystickBase.style.left = p.x + 'px';
        joystickBase.style.top = p.y + 'px';
        joystickBase.classList.add('active');
      }
      if (joystickKnob) joystickKnob.style.transform = 'translate(0px, 0px)';
    }

    /** Move the knob and derive moveX/moveZ from its offset. */
    function moveJoystick(e) {
      let dx = e.clientX - joyOriginX;
      let dy = e.clientY - joyOriginY;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        dx *= JOY_RADIUS / len;
        dy *= JOY_RADIUS / len;
      }
      if (joystickKnob) joystickKnob.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
      if (len <= JOY_DEAD) {
        state.moveX = 0;
        state.moveZ = 0;
        return;
      }
      // Magnitude ramps from 0 at the dead zone edge to 1 at the radius; screen-up is world-forward.
      const mag = Math.min(1, (len - JOY_DEAD) / (JOY_RADIUS - JOY_DEAD));
      const nx = (e.clientX - joyOriginX) / len;
      const ny = (e.clientY - joyOriginY) / len;
      state.moveX = nx * mag;
      state.moveZ = -ny * mag;
    }

    /** Begin a drag-look with this pointer. */
    function startLook(e) {
      lookPointerId = e.pointerId;
      lookLastX = lookStartX = e.clientX;
      lookLastY = lookStartY = e.clientY;
      lookStartTime = performance.now();
      lookMoved = 0;
    }

    /** Accumulate look deltas from clientX/Y differences (movementX is 0 on iOS). */
    function moveLook(e) {
      const dx = e.clientX - lookLastX;
      const dy = e.clientY - lookLastY;
      lookLastX = e.clientX;
      lookLastY = e.clientY;
      lookMoved = Math.max(lookMoved, Math.hypot(e.clientX - lookStartX, e.clientY - lookStartY));
      lookDX += dx * touchSens;
      lookDY += dy * touchSens * (invertY ? -1 : 1);
    }

    /**
     * End a look drag. A short, nearly stationary press counts as a tap; two taps close in time and
     * space toggle sprint.
     * @param {boolean} cancelled true for pointercancel (never a tap)
     */
    function endLook(cancelled) {
      lookPointerId = null;
      if (cancelled) return;
      const now = performance.now();
      const isTap = now - lookStartTime < TAP_MAX_MS && lookMoved < DOUBLE_TAP_PX;
      if (!isTap) {
        lastTap = null;
        return;
      }
      if (lastTap && now - lastTap.time < DOUBLE_TAP_MS &&
          Math.hypot(lookStartX - lastTap.x, lookStartY - lastTap.y) < DOUBLE_TAP_PX) {
        setSprint(!state.sprint);
        lastTap = null;
      } else {
        lastTap = { time: now, x: lookStartX, y: lookStartY };
      }
    }

    /**
     * True when a pointer event landed on a button (the jump button, or any other control such as a pause
     * button) rather than on the bare layer. Buttons keep their own handlers and must never start a drag.
     * @param {PointerEvent} e
     * @returns {boolean}
     */
    function isButtonTarget(e) {
      const t = e.target;
      if (!t) return false;
      if (jumpButton && (t === jumpButton || jumpButton.contains(t))) return true;
      return typeof t.closest === 'function' && t.closest('button') !== null;
    }

    function onLayerPointerDown(e) {
      if (!active('touch')) return;
      if (isButtonTarget(e)) return;
      e.preventDefault();
      if (e.pointerId === joyPointerId || e.pointerId === lookPointerId) return;
      capture(touchLayer, e.pointerId);
      // Half split is recomputed per event so rotation / resize is always respected. The left half only ever
      // drives the joystick (extra left-hand touches are ignored); look drags are exclusive to the right half.
      const leftHalf = e.clientX < window.innerWidth / 2;
      if (leftHalf) {
        if (joyPointerId === null) startJoystick(e);
      } else if (lookPointerId === null) {
        startLook(e);
      }
    }

    function onLayerPointerMove(e) {
      if (!active('touch')) return;
      if (e.pointerId === joyPointerId) {
        e.preventDefault();
        moveJoystick(e);
      } else if (e.pointerId === lookPointerId) {
        e.preventDefault();
        moveLook(e);
      }
    }

    function onLayerPointerUp(e) {
      if (mode !== 'touch') return;
      if (e.cancelable) e.preventDefault();
      if (e.pointerId === joyPointerId) {
        releaseJoystick();
      } else if (e.pointerId === lookPointerId) {
        endLook(e.type === 'pointercancel');
      }
    }

    function onJumpDown(e) {
      if (!active('touch')) return;
      e.preventDefault();
      e.stopPropagation();
      capture(jumpButton, e.pointerId);
      jumpPointerId = e.pointerId;
      if (!state.jumpHeld) jumpQueued = true;
      state.jumpHeld = true;
    }

    function onJumpUp(e) {
      if (jumpPointerId === null || e.pointerId !== jumpPointerId) return;
      if (e.cancelable) e.preventDefault();
      jumpPointerId = null;
      state.jumpHeld = false;
    }

    function onContextMenu(e) {
      // Long-press on Android would otherwise open a context menu mid-drag.
      if (mode === 'touch') e.preventDefault();
    }

    // ------------------------------------------------------------------ global safety nets

    function onGlobalPointerDown() {
      fireFirstGesture();
    }

    function onBlur() {
      releaseAll();
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') releaseAll();
    }

    // ------------------------------------------------------------------ public API

    /**
     * Switch between 'desktop' and 'touch'. Visibility of the touch layer is ui.js's job; this only
     * resets state (and drops pointer lock when leaving desktop mode).
     * @param {'desktop'|'touch'} next
     */
    function setMode(next) {
      const value = next === 'touch' ? 'touch' : 'desktop';
      if (value !== 'desktop' && locked) exitPointerLock();
      mode = value;
      releaseAll();
    }

    /**
     * Enable or disable game input. When disabled all movement/look state is zeroed and events are ignored.
     * @param {boolean} value
     */
    function setEnabled(value) {
      enabled = !!value;
      if (!enabled) releaseAll();
    }

    /** @param {boolean} value invert vertical look */
    function setInvertY(value) {
      invertY = !!value;
    }

    /**
     * Look sensitivity in radians per pixel.
     * @param {number} [mouse=0.0022]
     * @param {number} [touch=0.005]
     */
    function setSensitivity(mouse, touch) {
      mouseSens = typeof mouse === 'number' && mouse > 0 ? mouse : 0.0022;
      touchSens = typeof touch === 'number' && touch > 0 ? touch : 0.005;
    }

    /**
     * Accumulated look deltas (radians, invert already applied) since the last call; resets to zero.
     * @returns {{dx:number, dy:number}}
     */
    function consumeLook() {
      const out = { dx: lookDX, dy: lookDY };
      lookDX = 0;
      lookDY = 0;
      return out;
    }

    /** @returns {boolean} true exactly once per jump press */
    function consumeJump() {
      const pressed = jumpQueued;
      jumpQueued = false;
      return pressed;
    }

    /** Remove every listener, release pointer lock and hide the joystick. */
    function dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      releaseAll();
      if (lockPending) lockPending.finish(false);
      if (locked) exitPointerLock();
      for (const l of listeners) l.target.removeEventListener(l.type, l.fn, l.options);
      listeners.length = 0;
    }

    // ------------------------------------------------------------------ wiring

    const passiveFalse = { passive: false };
    on(window, 'keydown', onKeyDown);
    on(window, 'keyup', onKeyUp);
    on(window, 'pointerdown', onGlobalPointerDown, true);
    on(window, 'blur', onBlur);
    on(document, 'visibilitychange', onVisibility);
    on(document, 'mousemove', onMouseMove);
    on(document, 'pointerlockchange', onLockChange);
    on(document, 'pointerlockerror', onLockError);

    on(touchLayer, 'pointerdown', onLayerPointerDown, passiveFalse);
    on(touchLayer, 'pointermove', onLayerPointerMove, passiveFalse);
    on(touchLayer, 'pointerup', onLayerPointerUp, passiveFalse);
    on(touchLayer, 'pointercancel', onLayerPointerUp, passiveFalse);
    on(touchLayer, 'contextmenu', onContextMenu);

    on(jumpButton, 'pointerdown', onJumpDown, passiveFalse);
    on(jumpButton, 'pointerup', onJumpUp, passiveFalse);
    on(jumpButton, 'pointercancel', onJumpUp, passiveFalse);
    on(jumpButton, 'pointerleave', onJumpUp);

    const api = {
      /** Current input mode ('desktop' | 'touch'). */
      get mode() {
        return mode;
      },
      state,
      setMode,
      setEnabled,
      setInvertY,
      setSensitivity,
      requestPointerLock,
      exitPointerLock,
      isPointerLocked,
      consumeLook,
      consumeJump,
      dispose,
    };
    return api;
  }

  export { createInput };

