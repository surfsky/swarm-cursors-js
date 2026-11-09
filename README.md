# Swarm Cursors

[GitHub](https://github.com/surfsky/swarm-cursors-js) · [Live demo](https://surfsky.github.io/swarm-cursors-js/) · [中文文档](README-CN.md)

Snapshot a page into a blueprint, clear the canvas, and watch a swarm of collaborative cursors rebuild it piece by piece: drawing boxes, typing text, tracing lines, and Option-dragging copies. This is a reconstruction, not a video replay.

Zero dependencies, in a single ES module ([src/swarm-cursors.js](src/swarm-cursors.js)). Inspired by the visual language of [Joel Califa's Swarm](https://califa.github.io/swarm-site/) and [DhvanilPatel's swarm-cursors](https://github.com/DhvanilPatel/swarm-cursors) extension; this repository is an independently written, general-purpose JavaScript implementation.

![Demo](demo/preview.png)

## Quick start

**Try the demo:** The demo imports the source module directly, with no build step. Browsers block ES module imports from `file://` pages, so start a static server in the project root:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080/demo/index.html>. Opening the demo directly from a file shows the same instructions rather than a blank page.

**Use the library:**

```js
import { SwarmCursors } from './src/swarm-cursors.js'

const swarm = new SwarmCursors({
  target: '#site',        // Element or selector to snapshot
  cursors: 8,
  speed: 1,
  background: '#FBF7F0',  // Canvas color after clearing
  startOnLoad: true,      // Start automatically when the DOM is ready
  showControlPanel: true, // Show the bottom-right control panel
  restoreOnFinish: true,  // Restore the real page after reconstruction
})

await swarm.play()        // Snapshot → clear → rebuild → optionally restore
```

The target should be able to contain its overflow; avoid making the target itself a scroll container. The library temporarily changes its `position` from `static` to `relative` when needed and hides its children with `visibility`. `stop()` restores these styles and removes the overlay without changing the original DOM structure.

## API

| Member | Description |
| --- | --- |
| `new SwarmCursors(opts)` | Create an instance; see the options below. |
| `play()` | Snapshot and start rebuilding; returns a Promise, not a completion signal for the animation. |
| `replay()` | Stop the current run and start again. |
| `stop()` | Remove the canvas and cursors and restore the real page. |
| `destroy()` | Stop and remove the built-in control panel. |
| `advance(ms)` | Synchronously fast-forward by N milliseconds without relying on animation frames; useful for recording, screenshots, and debugging. |
| `setSpeed(n)` | Set the reconstruction speed, from 0.25 to 4. |
| `setSound(bool)` | Toggle synthesized Web Audio clicks and typing sounds; off by default. |
| `on(event, fn)` | Listen for `ready`, `start`, `progress`, `done`, or `restored`. |

### Options

| Option | Default | Description |
| --- | --- | --- |
| `target` | `document.body` | Element to snapshot. |
| `background` | `#F1F2F3` | Cleared canvas color. |
| `cursors` | `8` | Number of concurrent cursors, from 2 to 12. |
| `speed` | `1` | Initial speed multiplier. |
| `sound` | `false` | Sound setting. |
| `palette` | 8 colors | Cursor colors. |
| `names` | 12 names | Cursor name labels. |
| `scale` | `1` | Cursor size. |
| `force` | `false` | Play even when `prefers-reduced-motion` is enabled. |
| `startOnLoad` | `false` | Automatically call `play()` after the DOM is ready. |
| `showControlPanel` | `false` | Show the built-in bottom-right panel for rebuilding, restoring, speed, and sound. |
| `restoreOnFinish` | `false` | Restore the real page after the animation finishes. |
| `restoreDelay` | `900` | Delay in milliseconds before automatic restoration. |

### Events

```js
swarm.on('progress', ({ done, total, row }) => console.log(done / total))
swarm.on('done', () => console.log('Reconstruction complete'))
swarm.on('restored', () => console.log('The real page is interactive again'))
```

## How it works

1. **Snapshot:** Walk the DOM and computed styles to collect painted boxes, styled text runs, individual border lines, and media (`img`, `svg`, `video`, and `canvas`). Similar sibling elements are identified as originals and copies.
2. **Clear:** Cover the target with a canvas isolated in a shadow DOM, and hide its children with `visibility: hidden` to preserve layout and scroll height.
3. **Rebuild:** Schedule tasks in vertical rows with a two-row lookahead. Cursors travel to their tasks, draw dimension-labeled boxes, fill shapes, reveal media, and type text. Copies wait for their originals and are dragged out with red spacing markers.
4. **Swarm:** Separation, attraction, and mouse avoidance give the cursors their motion. Idle cursors wander near the work area, then fly off the top of the canvas when finished.

## Known limitations

- **A visual reconstruction, not a clone:** The reconstructed layer is not interactive, and animations are frozen at snapshot time.
- The snapshot is taken when `play()` is called; later page changes are not synchronized.
- Cross-origin images or tainted canvases may not be available; unavailable canvas content falls back to a placeholder.
- Very long pages with thousands of nodes can be slow. Prefer a single screen or a narrower section as the target.
- Fonts are reproduced using the computed `font-family`; the library does not load web fonts.

## Development

The demo is in [demo/index.html](demo/index.html), and the library is in [src/swarm-cursors.js](src/swarm-cursors.js). Edit and refresh; there is no build or bundling step.

The demo supports URL parameters for recording and screenshots:

- `?auto` starts automatically.
- `?auto&speed=2` sets the speed multiplier.
- `?auto&advance=8000` fast-forwards eight seconds without relying on animation frames.
- `?auto&advance=16000&restore` fast-forwards and immediately restores the real page.
- `?norestore` disables the demo's default automatic restoration.
- `?panel=0` hides the bottom-right control panel.

## License

MIT. The motion design pays tribute to Joel Califa's Swarm and DhvanilPatel's extension. The original Swarm does not declare a license; contact its author before reusing its assets.