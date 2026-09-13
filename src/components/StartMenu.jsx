import { util } from '../game/util.js';
export function StartMenu({ state, ui }) {
  return (
    <div id="start-overlay" className="overlay open" hidden={state.menu !== "start"}>
      <header className="start-masthead">
        <span className="start-brand"><svg viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M4 32V16a12 12 0 0 1 24 0v16M10 32V16a6 6 0 0 1 12 0v16M1 32h30" /></svg>POOLROOMS</span>
        <span className="start-edition">A place between places</span>
      </header>
      <main className="start-content">
        <p className="menu-eyebrow"><span /> TAKE THE LONG WAY HOME</p>
        <h1 className="title">Let yourself<br /><em>wander.</em></h1>
        <p className="subtitle">Sunlit water. Empty halls. Somewhere beyond it all, an open sky. Explore at your own pace.</p>

        <form id="start-form" onSubmit={event => { event.preventDefault(); ui.action("onStart", { seed: state.seed || util.randomSeedString(), mode: state.settings.mode }); }} autoComplete="off" noValidate>
          <button id="btn-start" disabled={!state.ready || !!state.error} className="btn primary" type="submit"><span>Enter the poolrooms</span><span aria-hidden="true">↗</span></button>
          <p className="start-invitation">No enemies. No clock. Just curiosity.</p>
        </form>

        <details className="start-controls"><summary>How to explore</summary>
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
        </details>
      </main>
      <footer className="start-footer"><span>FOLLOW THE WATER. FIND THE SKY.</span><span className="start-audio">Headphones recommended</span></footer>
    </div>

    
  );
}
