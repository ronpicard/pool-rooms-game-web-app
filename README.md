# Poolrooms

[Play the game](https://ronpicard.github.io/pool-rooms-game-web-app/) · [Source on GitHub](https://github.com/ronpicard/pool-rooms-game-web-app)

A quiet exploration game through one connected pool complex. Begin in the Sun Pavilion, follow the blue arcade into Rain Hall, explore the Sunken Baths and Column Sea, then climb toward an open-air Sky Pool. There are no enemies, drain portals, depth scores, or level transitions. Pools, side paths, a slide and floating beach balls invite you to take your time.

Built with React, Vite and Three.js. All textures and audio are generated locally; no backend, CDN scripts, API keys, or downloaded art are needed at runtime.

## Latest changes

- Moved the ending chair onto a raised, railed overlook beyond the Sky Pool, facing an ocean of water.
- Fixed sunlight patches appearing as translucent ramps; they now lie flat on the tiles with soft edges.
- Replaced drain progression with a continuous, designed exploration route and a single entrance action.
- Added five distinct destinations: Blue Arcade, Rain Hall, Sunken Baths, Column Sea and Sky Pool, linked by quieter passages.
- Added rounded arcades, falling water, stepped baths, a bridge through towering columns, an ascending final passage and an open sky with clouds.
- Added room-dependent ambience: distant rain, quieter baths, a reverberant column hall, and outdoor wind and birds.
- Rest at the far Sky Pool chair to see the ending and credits. Get up whenever you want to continue exploring.
- Kept the Pavilion slide, curved swimming pools, beach balls and quality settings.

## Development

Use Node.js 22.12 or later (`nvm use` selects Node 22):

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. ES modules require a web server; double-clicking `index.html` is not supported.

```sh
npm run build
npm run preview
```

The production build is written to `dist/`.

## GitHub Pages deployment

The `ronpicard/pool-rooms-game-web-app` repository publishes automatically after a successful build and browser test run on `main`. Pull requests run checks without publishing.

1. Push this project to a GitHub repository on the `main` branch.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Push to `main`, or run **Deploy to GitHub Pages** from the Actions tab.

The existing workflow in `.github/workflows/deploy.yml` installs locked dependencies, builds, runs browser tests, uploads `dist/`, and deploys to Pages. Pull requests build and test without deploying. Update the workflow branch filters and deployment conditions if your default branch differs.

Vite's `base: './'` generates relative asset URLs, so the same build works at a domain root or a repository subpath. Hash links need no server rewrites. `public/.nojekyll` is copied into the build. Building locally does not publish the game.

## Controls

### Desktop

- Click **Enter the poolrooms** to start and capture the mouse.
- Move with `W`, `A`, `S`, `D` or the arrow keys; look with the mouse.
- Hold `Shift` to sprint. Use `Space` to jump or swim up, and `Ctrl` or `C` to swim down.
- Press `Esc` or click the pause control to open settings.
- Near the far Sky Pool chair, press `E` or click **Rest**. Press `E` again or choose **Get up & keep exploring** to return to movement.

### Touch

- Move with the floating joystick on the left half of the screen.
- Drag the right half to look. Double-tap it to toggle sprint.
- Use the on-screen jump button to jump or surface. Look down and swim forward to descend.
- Tap the pause control to open settings, and the **Rest** prompt at the final chair to sit down.

Input mode is detected from pointer capability and can be overridden in the pause menu. Phones without pointer lock fall back to touch controls. A refused desktop pointer lock leaves keyboard movement available and shows a capture hint.

### Exploring and ending

The Pavilion's eastern doorway leads to the Blue Arcade. Light at thresholds, colored tile borders and narrow connecting passages suggest the onward route. Walk around the pools or through their stepped basins; the Sunken Baths have paths around their partitions, and Column Sea has a central dry bridge. Every doorway supports returning the way you came.

The Pavilion's Golden Slide still starts at the top of its staircase. Walk into the flume to ride it into the lagoon. Walk into beach balls to push them.

The final passage climbs six units to the Sky Pool. Continue through the far terrace opening and up four shallow steps to the little overlook. Approach its ocean-facing chair to reveal **Rest**. The camera settles over the water, then the title and short credits fade in. The scene remains live; there is no forced exit. Pausing and getting up remain available. **Restart walk** in the pause menu returns to the Pavilion.

## Performance and quality

The route is finite. Room geometry is merged by material, and distant room groups are hidden. Materials, generated tile textures and animated water shaders are shared. Rain uses scrolling texture coordinates, clouds use simple geometry and a sky shader, and audio uses Web Audio synthesis. New rooms add no planar reflection passes or point lights. The ocean beyond the ending ledge uses one additional water mesh with a capped 32 × 32 subdivision grid.

- **Low:** pixel ratio capped at 1, no bloom or real-time shadows, and no Pavilion planar reflection. Default on touch devices.
- **Medium:** pixel ratio capped at 1.5, desktop bloom and the existing Pavilion lagoon reflection. Default on desktop.
- **High:** pixel ratio capped at 2 on desktop or 1.5 on touch, desktop bloom and directional shadows, plus the Pavilion reflection.

Touch devices skip bloom and real-time shadows on every setting. Pool-floor light patterns, colored architecture and animated water are available on Low. The nine Pavilion chunks remain allocated for reliable return trips and are hidden when distant. The renderer stops while paused or when the tab is hidden. Physics runs at a fixed 60 Hz with a bounded catch-up accumulator.

Draw-call regression tests check representative Low-quality room views. These are rendering-cost checks, not a guarantee of frame rate on every phone or GPU. The pause menu shows local frame rate and rendering statistics. Use Low if needed.

## Persistence and sharing

- **World variation** in the entrance menu exposes the existing seed field. Seeds accept up to 32 characters from `a-z`, `0-9`, `-` and `_`. The designed route is the same for every seed; seeds retain the Pavilion's deterministic procedural details.
- **Copy share link** copies a link such as `#seed=quiet-water&mode=wander`.
- Old links with `mode=drains` or `depth` are accepted, but start the exploration route at the Pavilion. Starting normalizes the URL and saved run to exploration.
- `poolrooms.settings` stores quality, input mode, volume and invert-look settings; `poolrooms.last` stores the last seed and mode. `poolrooms.completed` records whether the player has rested at the ending.
- Reloading starts at the Pavilion; position is not saved. Storage failures do not prevent play.

## Verification

```sh
npx playwright install chromium
npm run build
npm test
```

Browser tests serve the production build at both `/` and `/poolrooms/` without an SPA fallback. They cover startup, legacy-link migration, settings, touch controls, refused pointer lock, WebGL failures, the slide, swimming, Pavilion seams and return trips, beach balls, reflection shaders, new room thresholds in both directions, pool exits, resting and resuming, and a Low-quality rendering budget.

No lint or separate type-check command is configured. ESLint with JavaScript and React rules would provide useful static checks; it is not installed by this change.

## Source layout

- `src/App.jsx` and `src/components/`: React shell, menus and ending controls.
- `src/game/engine.js`: renderer, state machine, persistence, camera settling and fixed-timestep loop.
- `src/game/journey.js`: connected room definitions, batched geometry, matching terrain, collision and ending location.
- `src/game/world.js`: shared water and materials, Pavilion chunk generation and world-query integration.
- `src/game/landmark.js`: Pavilion architecture, slide, balls and reflection.
- `src/game/player.js`, `src/game/input.js`, `src/game/audio.js`: movement, input and synthesized sound.
- `src/styles.css`: responsive menus, touch controls and ending typography.
- `tests/`: Playwright browser tests and static build server.

The engine releases animation frames, event listeners, audio, textures and GPU resources on disposal. A console debug hook remains available through `window.PR.game`, including `player`, `world`, `renderer`, `camera`, `settings`, `resting`, `pause()` and `resume()`. Player teleports are for debugging; there is no drain-depth travel API.
