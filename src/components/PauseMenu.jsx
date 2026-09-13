export function PauseMenu({ state, ui }) {
  return (
    <div id="pause-menu" className="overlay open" hidden={state.menu !== "pause"}>
      <div className="card">
        <h2>Paused</h2>
        <button id="btn-resume" onClick={() => ui.action("onResume")} className="btn primary" type="button">Resume</button>

        <div className="settings">
          <label className="row" htmlFor="sel-quality">
            <span>Quality</span>
            <select id="sel-quality" value={state.settings.quality} onChange={event => ui.changeSetting("quality", event.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="row" htmlFor="sel-input">
            <span>Input</span>
            <select id="sel-input" value={state.settings.inputMode} onChange={event => ui.changeSetting("inputMode", event.target.value)}>
              <option value="auto">Auto</option>
              <option value="desktop">Desktop</option>
              <option value="touch">Touch</option>
            </select>
          </label>
          <label className="row" htmlFor="rng-volume">
            <span>Volume</span>
            <input id="rng-volume" type="range" min="0" max="100" step="1" value={Math.round(state.settings.volume * 100)} onChange={event => ui.changeSetting("volume", Number(event.target.value) / 100)} />
          </label>
          <label className="row" htmlFor="chk-invert">
            <span>Invert look</span>
            <input id="chk-invert" checked={state.settings.invertY} onChange={event => ui.changeSetting("invertY", event.target.checked)} type="checkbox" />
          </label>
        </div>

        <div className="actions">
          <button id="btn-copy-link" onClick={() => ui.copyLink()} className="btn" type="button">Copy share link</button>
          <button id="btn-new-seed" onClick={() => ui.action("onNewSeed")} className="btn" type="button">Restart walk</button>
        </div>

        <p className="pause-hint" data-platform="desktop" hidden={state.touch}>WASD move &middot; Shift sprint &middot; Space jump / up &middot; Ctrl / C down &middot; Esc pause</p>
        <p className="pause-hint" data-platform="touch" hidden={!state.touch}>Left: joystick &middot; Right: look, double-tap sprint &middot; ▲ jump / surface &middot; <span className="pause-icon"></span> pause</p>
        <div id="debug-line" className="mono">{state.debug}</div>
      </div>
    </div>

    
  );
}
