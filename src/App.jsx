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
  <div id="app" data-touch={state.touch} data-reduced-motion={state.settings.reducedMotion}>
    <canvas id="c" aria-label="Poolrooms 3D view"></canvas>
    <div id="vignette" aria-hidden="true"></div>
    <div id="water-lens" aria-hidden="true"></div>
    <div id="arrival" key={state.arrival} className="arrival" role="status" hidden={!state.arrival || !!state.menu || state.resting || !!state.error}>
      <span className="arrival-rule" aria-hidden="true" />
      <p className="arrival-name">{state.arrival}</p>
      <p className="arrival-caption">{ATMOSPHERES[state.arrival]?.caption}</p>
    </div>

    
    <div id="hud" hidden={state.menu === "start" || !!state.error || state.seatHidden}>
      <button id="btn-pause" className="pause-icon" type="button" aria-label="Pause" hidden={!!state.menu}
        onPointerDown={event => { event.preventDefault(); ui.action("onPause"); }}
        onClick={event => { if (event.detail === 0) ui.action("onPause"); }}></button>
    </div>

    
    <div id="touch-layer" hidden={!state.controls}>
      <div id="joystick" aria-hidden="true">
        <div id="joystick-knob"></div>
      </div>
      <div className="touch-guide touch-move" aria-hidden="true"><span>✥</span>Move</div>
      <div className="touch-guide touch-look" aria-hidden="true">Drag to look</div>
      <div className="touch-actions">
        <button id="sprint-indicator" type="button" aria-label="Sprint" aria-pressed="false">Sprint</button>
        <button id="btn-jump" type="button" aria-label="Jump or surface"><span aria-hidden="true">↑</span><small>Jump / up</small></button>
        <button id="btn-dive" type="button" aria-label="Dive"><span aria-hidden="true">↓</span><small>Dive</small></button>
      </div>
    </div>

    
    <button id="btn-interact" className="rest-prompt" hidden={!state.interactionLabel || state.resting || !!state.menu} onClick={()=>ui.action('onInteract')}>{state.interactionLabel}<span hidden={state.touch}> E </span></button>
    <button id="btn-rest" className="rest-prompt" hidden={!state.canRest || state.resting || !!state.menu || !!state.interactionLabel} onClick={() => ui.action("onRest")}>{state.restPrompt}<span hidden={state.touch}> E </span></button>
    <div id="quiet-rest" className="quiet-rest" hidden={!state.resting || state.restEnding || !!state.menu || state.seatHidden}>
      <p>{state.restCaption}</p>
      <small className="seat-hint">Drag to look around</small>
      <button id="btn-leave-seat" className="btn" onClick={() => ui.action("onRest")}>Get up &amp; keep exploring</button>
      <button className="btn hide-seat-ui" onClick={()=>ui.action('onHideSeatUI')}>Just the view</button>
    </div>
    <div id="ending" className="ending" hidden={!state.resting || !state.restEnding || !!state.menu || state.seatHidden}>
      <div className="ending-titles"><p className="menu-eyebrow">YOU FOUND THE SKY</p><h2>POOLROOMS</h2><p>There is nowhere else you need to be.</p><div className="ending-credits">A quiet journey through water and light<br />Thank you for exploring.</div></div>
      <div className="ending-actions"><small className="seat-hint">Drag to look around</small><button id="btn-get-up" className="btn" onClick={() => ui.action("onRest")}>Get up & keep exploring</button><button className="btn hide-seat-ui" onClick={()=>ui.action('onHideSeatUI')}>Just the view</button></div>
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
