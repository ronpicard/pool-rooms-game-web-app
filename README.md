# Poolrooms

[Play the game](https://ronpicard.github.io/pool-rooms-game-web-app/) · [Source on GitHub](https://github.com/ronpicard/pool-rooms-game-web-app)

A quiet exploration game through one connected pool complex. Begin in the Sun Pavilion, follow the blue arcade into Rain Hall, explore the Sunken Baths and Column Sea, then climb toward an open-air Sky Pool and a long ocean pier. Take optional detours into the Changing Gallery and Lantern Baths. There are no enemies, drain portals, depth scores, or level transitions. Pools, quiet seats, slides and floating beach balls invite you to take your time.

Built with React, Vite and Three.js. All textures and audio are generated locally; no backend, CDN scripts, API keys, or downloaded art are needed at runtime.

## Latest changes

- Look freely with the mouse or touch controls throughout all three slide rides.
- Smoothed the camera over ascending and descending steps while retaining solid treads, responsive jumps and normal swimming.
- Rain Hall droplets now accelerate toward the water and meet small splash beads and fading rings beneath the actual shower heads. Added gentle drifting steam over the Sunken Baths and Lantern Baths.
- Kept the ocean edge protected, including jumping against the Sky Pool's low outer walls and the pier rails.
- Added separate Environment, Movement and optional Music levels, plus Gentle sound for softer transients. Music starts off; raise its slider in the pause menu to hear sparse room themes and the ocean-chair resolution.
- Waterfall impacts and pool edges now have spatial sound. Actual room walls muffle distant water, while open doorways let it through. The ocean wash follows the same swells as the visible water and grows along the pier.
- Added softer barefoot steps, wet footsteps and a few drips after leaving a pool, plus quiet beach-ball contact sounds. Wading ripples and splashes respond to movement speed.
- Added recessed tile relief, varied glaze, softly fading damp pool edges, and moving water light on nearby lower walls and columns. Rain Hall columns have soft contact shadows.
- Submerging briefly releases a small cluster of bubbles; crossing the surface adds a restrained peripheral sheen, and the view up through the water has a rippling bright window. Reduced motion disables the entry bubbles and surface sheen.

- Added a teal Rain Slide in Rain Hall and a coral Sunset Slide at the Sky Pool, each with a walkable staircase and a curved ride into the water.
- Added eight pushable, floating beach balls across Rain Hall, Sky Pool and Lantern Baths.
- Deepened Rain Hall's basin to 3.5 units and Column Sea's basin to 4.5 units, with tiled exit steps around every edge and columns reaching the deeper floor.
- Separated Rain Hall's ceiling lights from its waterfall heads and columns.
- Centered the long pier, terrace opening, steps and ending chair on the Sky Pool terrace.
- Gave the surrounding ocean gentle rolling swells, finer wind ripples, deeper water color, sky reflections and a distant hazy horizon. Indoor pools retain their calm, transparent water.
- Extended the ending pier from 13 to 80 world units, with repeating brass rails, deck inlays and small lights leading to the far chair.
- Enlarged Rain Hall by 50% in floor area and raised its ceiling to 26 units. Column Sea now has about 67% more floor area, more columns and a 29-unit ceiling.
- Added two connected side rooms: a mint Changing Gallery with lockers and a footbath, and warm Lantern Baths with hanging lights and a stepped pool.
- Added lifebuoys, wall clocks, towel shelves, ceramic direction signs and usable seats throughout the walk. Only the far ocean chair starts the ending.
- Removed the World variation option from the entrance; enter directly or expand the controls.
- Added distinct room lighting and haze that blend as you explore, with warm Pavilion sunlight, cooler rain and a dimmer Column Sea.
- Water now responds to wading and swimming with expanding ripples; Rain Hall pools show falling-water impacts. Reflections and pool-floor light patterns follow the scene's color treatment.
- Added directional rain, deeper hall echoes, gently swelling outdoor wind, and varied stereo birdsong.
- Room arrivals briefly show a title and a quiet line of text. The pause menu now matches the entrance and shows your current location.
- Added a **Reduced motion** setting for a steady walking/swimming camera and immediate settling at the ending chair. It defaults to your system preference and remembers your choice.
- Refined curved tile scale, plaster ceilings and colored pool borders along the route.
- Redesigned the entrance with a scenic Pavilion backdrop, larger typography, and expandable controls.
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
- Near a usable bench or lounger, press `E` or click **Sit for a while**. The far ocean chair offers **Rest** and starts the ending. Press `E` again or choose **Get up & keep exploring** to return to movement.

### Touch

- Move with the floating joystick on the left half of the screen.
- Drag the right half to look. Double-tap it to toggle sprint.
- Use the on-screen jump button to jump or surface. Look down and swim forward to descend.
- Tap the pause control to open settings. Use **Sit for a while** at a bench or **Rest** at the final chair to sit down.

Input mode is detected from pointer capability and can be overridden in the pause menu. Phones without pointer lock fall back to touch controls. A refused desktop pointer lock leaves keyboard movement available and shows a capture hint.

### Exploring and ending

The Pavilion's eastern doorway leads to the Blue Arcade. Light at thresholds, colored tile borders and narrow connecting passages suggest the onward route. Walk around the pools or through their stepped basins; the Sunken Baths have paths around their partitions, and Column Sea has a central dry bridge. Every doorway supports returning the way you came.

The Changing Gallery opens off Rain Hall's north wall, beyond the expanded pool. Lantern Baths opens off Column Sea's south wall. Follow the ceramic signs beside their doorways; both detours return to the same hall. Their stepped basins have exits around every edge. Lockers, towels, clocks and lifebuoys are decorative.

The Pavilion's Golden Slide, Rain Hall's teal Rain Slide and Sky Pool's coral Sunset Slide start at the top of their staircases. Walk into a flume to ride it into the pool; keep using the mouse or touch look controls to look around during the ride. Rain Slide's stairs are on the east deck; Sunset Slide's stairs are on the northeast side of the Sky Pool. Walk into beach balls to push them in the Pavilion, Rain Hall, Sky Pool and Lantern Baths. Rain Hall and Column Sea have deeper centers for diving; their quarter-unit steps lead back to the deck around every edge. Stair movement has a smooth camera glide in both directions, including with Reduced motion enabled.

Each room's title appears briefly on arrival and then fades away. The pause menu retains your current location. **Reduced motion** in settings removes camera bob, room-title movement and the ending camera glide; water, rain, pool steam and the live environment keep moving. It also disables entry bubbles and the peripheral waterline sheen.

Sit beside the rain, on the Sunken Baths benches, on either Sky Pool lounger, or in the two side rooms. The camera settles into a quiet view while water and sound continue. Getting up returns you to your approach position. These seats do not mark the journey complete.

The final passage climbs six units to the Sky Pool. Continue through the opening at the center of the far terrace and up four shallow steps to an 80-unit pier, then walk out toward the ocean-facing chair at its far end. Approach the chair to reveal **Rest**. The camera settles over the water, then the title and short credits fade in. The scene remains live; there is no forced exit. Pausing and getting up remain available. **Restart walk** in the pause menu returns to the Pavilion.

## Sound

The pause menu has a master volume and independent **Environment**, **Movement** and **Music** sliders. Setting a category to **Off** also silences its reverb. **Gentle sound** softens high frequencies, sharp drips and movement sounds without changing the mix sliders. These settings are remembered, and older saves receive the new defaults automatically.

Music is optional and starts off. Raise its slider for slow, quiet phrases with long gaps: warmer tones indoors, isolated resonances in Column Sea, and brighter harmony at the Sky Pool. The pier introduces a new phrase; resting in the final chair resolves it. Restarting clears the previous room's music. Audio pauses with the game or a hidden tab.

Headphones make it easier to locate the six waterfall impacts and nearby pool edges. Walls and columns filter sound using the same bounds as collision; this is a lightweight approximation of room acoustics. The ocean has a separate wash synchronized to the visible waves. No recorded samples, external music services or new dependencies are required.

## Performance and quality

The route is finite. Room geometry is merged by material, and distant room groups are hidden. Materials, generated tile textures and animated water shaders are shared. Rain combines faint scrolling water curtains with synchronized droplets and impact rings, clouds use simple geometry and a sky shader, and audio uses Web Audio synthesis. New rooms add no planar reflection passes or point lights. The ocean uses one opaque water mesh with a 112 × 128 grid concentrated around the pier. Its broad swells and surface normals share the same wave equations; smaller wind ripples fade with distance. Ocean reflections use the sky palette without an additional reflection pass, and separate sea haze preserves a distant horizon. The sea surrounds the raised terrace and stays outside the lower indoor floors.

Water interactions share a fixed buffer of eight ripples across the pools. Rain impacts run only in Rain Hall's water shader, with matching falling droplets and splash beads in one reusable point buffer. Steam uses 18 drifting wisps and one draw per warm basin. These effects add no reflection passes; plaster ceilings add one shared-material draw per visible room. Decorations and pier details are merged with their room by material; ceramic signs each use a generated texture and a single mesh. Room lighting, fog and water color blend over several seconds. A shared 512-pixel texture supplies tile relief and glaze variation. Damp edge strips are batched per room, and nearby wall caustics run in the existing material shader. Entry bubbles reuse one twelve-point buffer. These additions require no reflection or post-processing passes. Spatial audio updates at 10 Hz, and the two environmental/movement convolution paths share one generated impulse response.

- **Low:** pixel ratio capped at 1, no bloom or real-time shadows, and no Pavilion planar reflection. Damp edges and glaze remain visible; extra tile bump shading and wall caustics are disabled. Default on touch devices.
- **Medium:** pixel ratio capped at 1.5, desktop bloom, tile relief, wall caustics and the existing Pavilion lagoon reflection. Default on desktop.
- **High:** pixel ratio capped at 2 on desktop or 1.5 on touch, desktop bloom and directional shadows, plus the Pavilion reflection.

Touch devices skip bloom and real-time shadows on every setting. Pool-floor light patterns, colored architecture and animated water are available on Low. The nine Pavilion chunks remain allocated for reliable return trips and are hidden when distant. The renderer stops while paused or when the tab is hidden. Physics runs at a fixed 60 Hz with a bounded catch-up accumulator.

Draw-call regression tests check representative Low-quality room views. These are rendering-cost checks, not a guarantee of frame rate on every phone or GPU. The pause menu shows local frame rate and rendering statistics. Use Low if needed.

## Persistence and sharing

- The entrance has no world-variation or seed controls. Seeds remain internal for deterministic Pavilion details and compatibility with shared links; the designed route is always the same.
- **Copy share link** copies a link such as `#seed=quiet-water&mode=wander`.
- Old links with `mode=drains` or `depth` are accepted, but start the exploration route at the Pavilion. Starting normalizes the URL and saved run to exploration.
- `poolrooms.settings` stores quality, input mode, master and category volumes, Gentle sound, invert-look and reduced-motion settings; `poolrooms.last` stores the last seed and mode. `poolrooms.completed` records whether the player has rested at the ending.
- Reloading starts at the Pavilion; position is not saved. Storage failures do not prevent play.

## Verification

Movement checks cover free look throughout all three slides, smooth camera height while walking and sprinting up and down steps, immediate teleport resets, and jumps against every ocean-facing terrace and pier edge. Rain and steam checks compare rendered pixels with each effect enabled and disabled at Low, Medium and High, verify source positions, and retain the rendering budgets.

```sh
npx playwright install chromium
npm run build
npm test
```

Browser tests serve the production build at both `/` and `/poolrooms/` without an SPA fallback. They cover startup, legacy-link migration, settings, touch controls, refused pointer lock, WebGL failures, the slide, swimming, Pavilion seams and return trips, beach balls, reflection shaders, new room thresholds in both directions, pool exits, resting and resuming, and a Low-quality rendering budget.

Atmosphere checks cover transient room titles, lighting changes and restart recovery, bounded water ripples at the correct pool elevation, and the reduced-motion system default, steady camera and persisted override. Room screenshots wait for lighting to settle.

Visual regression checks measure clearance between Rain Hall ceiling lights and waterfall rims, verify that the pier is centered and the former opening is closed, and sample rendered ocean animation and color at all three quality settings. They also check that returning indoors restores the shorter camera range.

Expansion checks cover side-room doorways and pool exits, scenic seating without ending the journey, the full walk to the distant chair, pier rails and return travel, the simplified mobile entrance, and rendering budgets for both side rooms and the pier.

Pool activity checks cover climbing and riding both new slides, cancelling rides on teleport, pushing the new beach balls at indoor and raised pool elevations, diving to the deeper floors, surfacing and exiting both deep pools on all four sides.

Sound checks measure real output for music, category muting and master volume; they also verify pause suspension, settings validation and persistence, wall/door sound paths, bounded entry bubbles and Reduced motion. Wet tile shaders are rendered at all three quality levels.

No lint or separate type-check command is configured. ESLint with JavaScript and React rules would provide useful static checks; it is not installed by this change.

## Source layout

- `src/App.jsx` and `src/components/`: React shell, menus and ending controls.
- `src/game/engine.js`: renderer, state machine, persistence, camera settling and fixed-timestep loop.
- `src/game/atmosphere.js`: room palettes, gradual lighting transitions and arrival copy.
- `src/game/journey.js`: connected room definitions, batched geometry, matching terrain, collision and ending location.
- `src/game/world.js`: shared water and materials, Pavilion chunk generation and world-query integration.
- `src/game/landmark.js`: Pavilion architecture, slide, balls and reflection.
- `src/game/pool-toys.js`: shared slide geometry, ride controller and buoyant beach balls.
- `src/game/acoustics.js`: geometry-based sound positions and wall occlusion.
- `src/game/ocean.js`: shared ocean wave definitions for rendering and sound.
- `src/game/surfaces.js` and `src/game/water-effects.js`: tile finishes, damp edges, wall caustics, rain impacts, pool steam and restrained water-entry effects.
- `src/game/player.js`, `src/game/input.js`, `src/game/audio.js`: movement, input and synthesized sound.
- `src/styles.css`: responsive menus, touch controls and ending typography.
- `tests/`: Playwright browser tests and static build server.

The engine releases animation frames, event listeners, audio, textures and GPU resources on disposal. A console debug hook remains available through `window.PR.game`, including `player`, `world`, `renderer`, `camera`, `settings`, `resting`, `pause()` and `resume()`. Player teleports are for debugging; there is no drain-depth travel API.
