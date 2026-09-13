export function PauseMenu({ state, ui }) {
  return (
    <div id="pause-menu" className="overlay open" hidden={state.menu !== "pause"}>
      <div className="card">
        <p className="menu-eyebrow">{state.area}</p>
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
            <span>Master volume</span>
            <input id="rng-volume" type="range" min="0" max="100" step="1" value={Math.round(state.settings.volume * 100)} onChange={event => ui.changeSetting("volume", Number(event.target.value) / 100)} />
          </label>
          <fieldset className="sound-settings">
            <legend>Make room for quiet</legend>
            {[["environmentVolume", "Environment"], ["movementVolume", "Movement"], ["musicVolume", "Music"]].map(([key, label]) => (
              <label className="row" htmlFor={`rng-${key}`} key={key}>
                <span>{label}{key === "musicVolume" && <small className="setting-description">Optional · quiet phrases, long pauses</small>}</span>
                <span className="sound-level">
                  <input id={`rng-${key}`} type="range" min="0" max="100" step="1" value={Math.round(state.settings[key] * 100)} aria-valuetext={state.settings[key] === 0 ? "Off" : `${Math.round(state.settings[key] * 100)} percent`} onChange={event => ui.changeSetting(key, Number(event.target.value) / 100)} />
                  <output htmlFor={`rng-${key}`}>{state.settings[key] === 0 ? "Off" : `${Math.round(state.settings[key] * 100)}%`}</output>
                </span>
              </label>
            ))}
            <label className="row" htmlFor="chk-gentle">
              <span>Gentle sound<small className="setting-description">Softer drips, splashes &amp; footsteps</small></span>
              <input id="chk-gentle" type="checkbox" checked={state.settings.gentleSound} onChange={event => ui.changeSetting("gentleSound", event.target.checked)} />
            </label>
          </fieldset>
          <label className="row" htmlFor="chk-invert">
            <span>Invert look</span>
            <input id="chk-invert" checked={state.settings.invertY} onChange={event => ui.changeSetting("invertY", event.target.checked)} type="checkbox" />
          </label>
          <label className="row" htmlFor="chk-motion">
            <span>Reduced motion<small className="setting-description">Steady camera &amp; simpler transitions</small></span>
            <input id="chk-motion" checked={state.settings.reducedMotion} onChange={event => ui.changeSetting("reducedMotion", event.target.checked)} type="checkbox" />
          </label>
        </div>

        <div className="actions">
          <button id="btn-copy-link" onClick={() => ui.copyLink()} className="btn" type="button">Copy share link</button>
          <button id="btn-new-seed" onClick={() => ui.action("onNewSeed")} className="btn" type="button">Restart walk</button>
        </div>

        {state.completed && <details className="revisit-places"><summary>Return to a favorite place</summary><div className="revisit-list">{state.visited.map(name=><button className="btn" type="button" key={name} onClick={()=>ui.action('onRevisit',name)}>{name}</button>)}</div></details>}
        {state.discoveries.length>0 && <details className="found-places"><summary>Little discoveries</summary><ul>{state.discoveries.map(name=><li key={name}>{name}</li>)}</ul></details>}

        <p className="pause-hint" data-platform="desktop" hidden={state.touch}>WASD move &middot; Shift sprint &middot; Space jump / up &middot; Ctrl / C down &middot; Esc pause</p>
        <p className="pause-hint" data-platform="touch" hidden={!state.touch}>Left: joystick &middot; Right: drag to look &middot; Sprint: toggle faster movement &middot; Jump / up: jump or surface &middot; Dive: swim down</p>
        <div id="debug-line" className="mono">{state.debug}</div>
      </div>
    </div>

    
  );
}
