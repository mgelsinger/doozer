# assets

Static assets bundled with the app.

| Folder | What |
|---|---|
| `icon/` | The two drawings every icon file is made from: `doozer.svg` (the whole creature, used from 48 pixels up) and `doozer-small.svg` (a simplified face, for the tray and other small sizes). `node scripts/make-icons.mjs` builds `src-tauri/icons/` from them. See [docs/release.md](../../docs/release.md). |
| `doozer/` | The 3D Doozer for the Island view: `doozer.glb` (glTF, about 630 KB) and `build_doozer.py`, the Blender script that builds it. Never edit the model by hand: change the script and run it. |

## The model

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python app/assets/doozer/build_doozer.py
```

Always with `--background`, so that no window opens. Add `-- --preview <folder>` to also render stills of every face and both hats for a quick look, and `--palette mint` to see those stills in another palette (the file itself is always exported in Peach; the page sets the colours).

What is in it, and why it is built the way it is, is at the top of the script. In short:

- **Proportions come from the 2D rig.** Every number is a coordinate of `src/character/rig-markup.ts` (a 200 × 200 drawing standing on y = 186), divided by 100. The body is the drawn outline turned about its own middle; the face is laid onto its front by straight projection, so the front view matches the drawing by construction.
- **Bones:** `root`, `body`, `earL`, `earR`, `tuft`, `armL`, `armR`, `footL`, `footR`, `tail`. All point straight up with no roll, so in the file every joint rests unrotated and its axes are the model's own.
- **Shape keys:** on `eyes`: calm, half, heavy, sad, wide, happy, closed, squeeze (and blink); on `mouth`: smile, open, o, flat, frown, wavy, chew, yawn (and chew-shut). The resting shapes are open eyes and the "w" mouth. An expression is a pair, chosen by `src/character/expressions.ts`.
- **Palettes:** each material that follows the palette names its palette colour in a custom property; the body's belly is a per-vertex mask (`_BELLY`). The five palettes are read from `src/character/palettes.ts` when the script runs and stored on the armature.
- **Extras, each its own object fixed to a bone:** cheeks, glasses, grime, drool, the nightcap, the bow.

`tests/views/island/model.test.ts` checks the file against the rig's tables (bones, pivots, proportions, shapes, palettes). If it fails after the rig changed, run the script again.
