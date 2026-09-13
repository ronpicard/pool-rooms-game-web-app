// A small external store keeps the engine independent of React's render cycle.
export function createUIStore() {
  let snapshot = {
    menu: 'start', ready: false, seed: '', touch: false, controls: false,
    canContinue:false, continueRoom:'', visited:[], discoveries:[], completed:false, interactionLabel:'', seatHidden:false,
    settings: { quality: 'medium', inputMode: 'auto', volume: 0.8, environmentVolume: 1, movementVolume: 0.8, musicVolume: 0, gentleSound: false, invertY: false, reducedMotion: false, mode: 'wander' },
    hud: { seed: '—', depth: 0, best: 0, mode: 'wander' },
    compass: { visible: false, angle: 0, near: false },
    area: 'Sun Pavilion', arrival: '', canRest: false, resting: false, restEnding: false, restPrompt: 'Rest', restCaption: '', fade: false, fadeMs: 700, toast: '', debug: '', error: '',
  };
  const listeners = new Set();
  const timers = new Map();
  let toastTimer, arrivalTimer;
  let callbacks = {};
  let disposed = false;
  const patch = (next) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    listeners.forEach(listener => listener());
  };
  const delay = ms => new Promise(resolve => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
    timers.set(timer, resolve);
  });
  const ui = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect(next) { disposed = false; callbacks = next; patch({ ready: true }); },
    patch,
    action(name, value) { ui.onAnyClick?.(); return callbacks[name]?.(value); },
    setSettings(next) { patch({ settings: { ...snapshot.settings, ...next } }); },
    changeSetting(key, value) {
      ui.setSettings({ [key]: value });
      ui.action('onSettingsChange', snapshot.settings);
    },
    showStart({ seed = '', mode, touch = false } = {}) {
      ui.setSettings({ mode: mode || snapshot.settings.mode });
      patch({ menu: 'start', seed, touch });
    },
    showPause({ touch = false, debug = '' } = {}) { patch({ menu: 'pause', touch, debug }); },
    hideMenus() { document.activeElement?.blur?.(); patch({ menu: null }); },
    isMenuOpen: () => snapshot.menu !== null,
    setHUD(hud) {
      if (Object.keys(hud).some(key => snapshot.hud[key] !== hud[key])) patch({ hud: { ...snapshot.hud, ...hud } });
    },
    setCompass(compass) {
      if (Object.keys(compass).some(key => snapshot.compass[key] !== compass[key])) patch({ compass: { ...compass } });
    },
    fadeToWhite(ms) { patch({ fade: true, fadeMs: ms }); return delay(ms + 120); },
    fadeFromWhite(ms) { patch({ area: 'Sun Pavilion', arrival: '', canRest: false, resting: false, restEnding: false, restPrompt: 'Rest', restCaption: '', fade: false, fadeMs: ms }); return delay(ms + 120); },
    toast(message, ms = 1800) {
      clearTimeout(toastTimer);
      patch({ toast: String(message) });
      toastTimer = setTimeout(() => patch({ toast: '' }), ms);
    },
    announceArea(name) {
      clearTimeout(arrivalTimer);
      patch({ arrival: name });
      arrivalTimer = setTimeout(() => patch({ arrival: '' }), 6500);
    },
    setTouchControlsVisible: controls => patch({ controls }),
    setDebug: debug => patch({ debug }),
    showError: error => patch({ error, menu: null }),
    async copyLink() {
      const link = ui.action('onCopyLink');
      try {
        if (!link) throw new Error('No link');
        await navigator.clipboard.writeText(link);
        ui.toast('Share link copied to clipboard');
      } catch { ui.toast('Copy failed — copy the link from the address bar', 3200); }
    },
    dispose() {
      disposed = true;
      clearTimeout(toastTimer);
      clearTimeout(arrivalTimer);
      timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); });
      timers.clear();
      callbacks = {};
    },
  };
  return ui;
}
