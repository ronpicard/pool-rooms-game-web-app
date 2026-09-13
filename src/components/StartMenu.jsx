import { util } from '../game/util.js';
export function StartMenu({ state, ui }) {
  return (
    <div id="start-overlay" className="overlay open" hidden={state.menu !== "start"}>
      <div className="card">
        <p className="menu-eyebrow">A QUIET JOURNEY</p>
        <h1 className="title">POOLROOMS</h1>
        <p className="subtitle">Follow the water. Find the sky. Stay a while.</p>

        <form id="start-form" onSubmit={event => { event.preventDefault(); ui.action("onStart", { seed: state.seed || util.randomSeedString(), mode: state.settings.mode }); }} autoComplete="off" noValidate>
          <details className="journey-options"><summary>World variation</summary><div className="seed-row">
            <label className="sr-only" htmlFor="seed-input">Seed</label>
            <input id="seed-input" type="text" inputMode="text" maxLength="32" value={state.seed} onChange={event => ui.patch({ seed: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) })}
                   placeholder="seed (random if empty)" spellCheck="false" autoCapitalize="none" autoCorrect="off" />
            <button id="btn-random-seed" onClick={() => ui.patch({ seed: util.randomSeedString() })} className="btn" type="button" title="Random seed" aria-label="Random seed">Random</button>
          </div></details>

          <button id="btn-start" disabled={!state.ready || !!state.error} className="btn primary" type="submit">Enter the poolrooms</button>
        </form>

        <ul id="hints-desktop" className="hints" hidden={state.touch}>
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to move, mouse to look</li>
          <li><kbd>Shift</kbd> sprint &middot; <kbd>Space</kbd> jump / swim up &middot; <kbd>Ctrl</kbd> or <kbd>C</kbd> swim down</li>
          <li><kbd>Esc</kbd> pause · <kbd>E</kbd> rest when you find a chair</li>
        </ul>
        <ul id="hints-touch" className="hints" hidden={!state.touch}>
          <li>Left half: joystick appears under your thumb</li>
          <li>Right half: drag to look &middot; double-tap to toggle sprint</li>
          <li><span className="kbd-btn">▲</span> jump on land, surface in water</li>
          <li><span className="kbd-btn pause-icon"></span> top right pauses and opens the settings</li>
          <li>Walk into the slide at the top to ride</li>
        </ul>
      </div>
    </div>

    
  );
}
