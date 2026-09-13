import { useEffect, useState, useSyncExternalStore } from 'react';
import { startGame } from './game/engine.js';
import { createUIStore } from './game/ui-store.js';
import { StartMenu } from './components/StartMenu.jsx';
import { PauseMenu } from './components/PauseMenu.jsx';
import { ATMOSPHERES } from './game/atmosphere.js';

export default function App() {
  const [ui] = useState(createUIStore);
  const state = useSyncExternalStore(ui.subscribe, ui.getSnapshot);
  useEffect(() => {
    const game = startGame(ui);
    // Retain the existing console debug API; game modules use explicit imports.
    window.PR = { game };
    return () => {
      game?.dispose();
      ui.dispose();
      if (window.PR?.game === game) delete window.PR;
    };
  }, [ui]);
  useEffect(() => {
    if (!state.touch && state.menu) {
      document.getElementById(state.menu === 'start' ? 'btn-start' : 'btn-resume')?.focus({ preventScroll: true });
    }
  }, [state.menu, state.touch, state.ready]);
  return (
  <div id="app" data-reduced-motion={state.settings.reducedMotion}>
    <canvas id="c" aria-label="Poolrooms 3D view"></canvas>
    <div id="vignette" aria-hidden="true"></div>
    <div id="water-lens" aria-hidden="true"></div>
    <div id="arrival" key={state.arrival} className="arrival" role="status" hidden={!state.arrival || !!state.menu || state.resting || !!state.error}>
      <span className="arrival-rule" aria-hidden="true" />
      <p className="arrival-name">{state.arrival}</p>
      <p className="arrival-caption">{ATMOSPHERES[state.arrival]?.caption}</p>
    </div>

    
    <div id="hud" hidden={state.menu === "start" || !!state.error}>
      <button id="btn-pause" className="pause-icon" type="button" aria-label="Pause" hidden={!!state.menu} onClick={() => ui.action("onPause")}></button>
    </div>

    
    <div id="touch-layer" hidden={!state.controls}>
      <div id="joystick" aria-hidden="true">
        <div id="joystick-knob"></div>
      </div>
      <div id="sprint-indicator" aria-live="polite">sprint</div>
      <button id="btn-jump" type="button" aria-label="Jump or surface">▲</button>
    </div>

    
    <button id="btn-rest" className="rest-prompt" hidden={!state.canRest || state.resting || !!state.menu} onClick={() => ui.action("onRest")}>{state.restPrompt}<span hidden={state.touch}> E </span></button>
    <div id="quiet-rest" className="quiet-rest" hidden={!state.resting || state.restEnding || !!state.menu}>
      <p>{state.restCaption}</p>
      <button id="btn-leave-seat" className="btn" onClick={() => ui.action("onRest")}>Get up &amp; keep exploring</button>
    </div>
    <div id="ending" className="ending" hidden={!state.resting || !state.restEnding || !!state.menu}>
      <div className="ending-titles"><p className="menu-eyebrow">YOU FOUND THE SKY</p><h2>POOLROOMS</h2><p>There is nowhere else you need to be.</p><div className="ending-credits">A quiet journey through water and light<br />Thank you for exploring.</div></div>
      <button id="btn-get-up" className="btn" onClick={() => ui.action("onRest")}>Get up & keep exploring</button>
    </div>
    <StartMenu state={state} ui={ui} />
    <PauseMenu state={state} ui={ui} />
    <div id="fade" className={state.fade ? "on" : ""} style={{ transitionDuration: `${state.fadeMs}ms` }} aria-hidden="true"></div>
    <div id="toast" role="status" aria-live="polite" className={state.toast ? "show" : ""} hidden={!state.toast}>{state.toast}</div>

    
    <div id="error-overlay" className="overlay open error" role="alert" hidden={!state.error}>
      <div className="card">
        <h2>Cannot start</h2>
        <p id="error-message">{state.error}</p>
        <p className="error-help">Poolrooms needs WebGL enabled. Try a current version of Chrome, Firefox or Safari.</p>
      </div>
    </div>
  </div>
  );
}
