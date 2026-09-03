# Misty States

Text to SVG diagrams of quantum states and circuits in the visual language of
Terry Rudolph's *Q is for Quantum* — qubits as shapes, superpositions inside
cloud outlines, circuits as vertical pipe-and-gate figures.

Type text, get an SVG. Everything runs client-side; nothing is uploaded.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # editor in dist/, library bundle in dist/lib/
npm test         # ~1460 tests
```

TypeScript, Svelte 5, Tailwind 4. The drawing library (`src/core/`) is pure,
DOM-free and has zero runtime dependencies; the editor (`src/app/`) bundles
jsPDF, gifenc and friends at build time.

---

## States

Qubits are `0` (white) and `1` (black). Position picks the shape: circle,
square, triangle, and so on.

| Input | Meaning |
| --- | --- |
| `0` `1` | A single qubit |
| `00\|11` | A superposition (`,` also works) |
| `-1\|0` | Negative amplitude |
| `2*00\|-3*11` | Numeric amplitudes |
| `2i*0\|1` | Imaginary coefficient |
| `0(0\|1)` | Factored product |
| `(0\|1) x (0\|1)` | Explicit tensor product |
| `(0\|1)\|(0\|1)` | Nested clouds |
| `0\|1 = 0\|-1` | Equation (`!=`, `->` also work) |
| `50%: 0(0\|1) : note` | Annotations left and right of `:` |
| `?` | Unknown qubit |
| `"text"` | Label |
| `shape os^` | Set which shape each position draws |
| `0@3` | Force this qubit to shape 3 |

Each line is a row. `#` starts a comment.

## Circuits

Vertical: qubits enter at the top, gates are connected by pipes.

```
in 00
H 1
CNOT 1 -> 2
out calculate
```

| Statement | Meaning |
| --- | --- |
| `H 1` | Single-qubit gate (`X Y Z S T I`, also `PETE` for `H`) |
| `RZ(90) 1` | Rotation in degrees (`RX`, `RY`, `P`) |
| `CNOT 1 -> 2` | Controlled-NOT (arrow optional; `CX` is an alias) |
| `TOFFOLI 1 2 -> 3` | Two controls (`CCNOT`/`CCX`) |
| `CZ 1 2` | Controlled-Z |
| `SWAP 1 2` | Swap |
| `CSWAP 1 2 3` | Controlled swap / Fredkin (`CSWAP 1 -> 2 3` too) |
| `measure 1 Z` | Measurement (`M` is an alias) |
| `box "U" 1-3` | Custom labelled box |
| `blank 1-2` | Empty frame for students |
| `in 00\|11` | Input state above the circuit |
| `out calculate` | Calculated output state |
| `window calculate` | State window mid-circuit |
| `view 2-3 00\|11` | View of some qubits |
| `header on` | Label columns with shapes |
| `qubits 3` | Set register width (usually inferred) |
| `shape ^os` | Per-wire shapes |
| `chart` | Bar chart of amplitudes or probabilities |
| `tabulate` | Outcome table |
| `animate` | CSS animation |
| `HH` | Shorthand: `H 1; H 2` |
| `;` | Same layer: `H 1; X 2` |
| `---` | Force a new layer |
| `CNOT "Oracle" 1 -> 2` | Named target (replaces ⊕) |
| `CNOT 1 -> 2 "label"` | Named link |
| `answer 010` | Hidden until "Show answer" |
| `step: H 1 : note` | Annotations on a gate line |

### Calculated states

`calculate` (or `calc`) computes the state from the input and gates above it.
The arithmetic is exact Gaussian integers — `H` is unnormalised so `H·H = 2I`
and every amplitude stays whole. Rotations at non-right angles produce decimal
coefficients rounded to two places.

`in calculate` runs the circuit backwards; a measurement cannot be undone and
says so. A measurement forward produces one row per outcome with its odds.

### Charts and tables

`chart` draws a bar per basis state — amplitude (coloured, signed) by default,
or `chart(probability)` (grey, unsigned). `tabulate` draws an outcome table.
Both go where an output goes.

### Animation

`animate` makes the state travel through the gates. A superposition is worked
term by term: terms queue above a gate, go through one at a time, then
identical terms merge and opposite ones cancel. The result is a self-contained
SVG with CSS keyframes, no JavaScript.

Saving as GIF or MP4 is offered from the toolbar.

### Themes

Three themes — **solid** (default, shaded), **flat** (line art), **isometric**
(extruded 3D). Geometry is identical; only shading differs.

---

## Versioning

Semantic versioning. Currently `0.x.y` — the notation is settled (140 figures
depend on it) but the API may still move.

| | |
| --- | --- |
| **major** | Notation break or published export removed |
| **minor** | New notation, new exports, new options |
| **patch** | Fixes that change neither |

Every exported figure is stamped with its version in `<metadata>`.

---

## Project layout

```
src/core/               the drawing library (zero runtime deps)
  index.ts              render(source, options) → SVG
  api.ts                convenience/UMD surface (MistyStates.svg, etc.)
  kernel.ts             parser + simulator + editing rules
  version.ts            the version literal
  state/                state AST, parser, layout
  circuit/              circuit AST, parser, simulator, layout, editing
    simulate.ts         exact-integer simulation
    reference.ts        independent dense-matrix cross-check
    edit.ts             drag-and-drop editing rules
  render/               primitives → themed SVG
  chart/                bar chart layout
  ui/board.ts           framework-agnostic drag layer
  shapes.ts, svg.ts, gates.ts, check.ts, conceal.ts, metadata.ts, url.ts

src/app/                the editor (Svelte 5, bundles jsPDF etc.)
  export.ts             SVG/PNG/PDF download and clipboard
  movie.ts              GIF/MP4 encoding
  library.ts            library data model
  library-yaml.ts       YAML import/export
  library-store.svelte.ts  persistence and editing
  route.ts              URL routing
  angle.ts              π-label formatting for the rotation dial
  components/           Svelte UI components

src/
  App.svelte            the editor
  Viewer.svelte         bare image view for ?format=

scripts/
  boundary.mjs          enforces src/core → src/app boundary
```

---

## Library entry points

```jsonc
"exports": {
  ".":        "./src/core/api.ts",       // MistyStates.svg(), etc.
  "./render": "./src/core/index.ts",     // render(), themes, palettes
  "./kernel": "./src/core/kernel.ts",    // parser, simulator, editing
  "./ui":     "./src/core/ui/board.ts"   // drag layer (needs a browser)
}
```

Points at source — a consumer's build compiles it and types come free.
`public.test.ts` pins every exported name against a literal list.

### JavaScript API

```js
import MistyStates from 'misty-states'

MistyStates.svg('00|11')                           // SVG string
MistyStates.svg('00|11', { theme: 'flat' })        // with options
MistyStates.render('qubits 2\nH 1')               // { svg, kind, width, height, ... }
MistyStates.svgDataUrl('00|11')                    // data: URL
await MistyStates.pngBlob('00|11')                 // Blob (browser only)
await MistyStates.pngDataUrl('00|11')              // data: URL (browser only)
MistyStates.detectMode('H 1')                      // 'circuit'
MistyStates.themes                                 // ['solid', 'flat', 'isometric']
MistyStates.shapes                                 // ['circle', 'square', ...]
```

Options: `theme`, `dark`, `scale`, `background`, `shapeOrder`, `step`,
`check`, `dial`, `factorCalculated`, `exactOdds`, `keepSign`. Parse errors
throw with the column-level message the editor shows.

### Kernel

```ts
import { parseCircuit, simulate, canonical, insertGate } from 'misty-states/kernel'

const doc = parseCircuit('qubits 2\nin 00\nH 1\nCNOT 1 -> 2')
const amps = simulate(doc, doc.layers.length)
const terms = canonical(amps)  // [['00', {re:1,im:0}], ['11', {re:1,im:0}]]
```

### Drag layer

```ts
import { createBoard } from 'misty-states/ui'

const board = createBoard({
  preview: () => element,
  view: () => ({ source, geometry, qubits, spots }),
  onpreview: (edit) => { /* draw the preview */ },
  oncommit: (edit) => { source = edit.source },
  onchange: (state) => { /* update carry indicator */ },
})
```

Framework-agnostic. Four callbacks in, four methods out (`press`,
`carryNew`, `beforeRender`, `afterRender`).

---

## Export

**Drag** the figure straight into PowerPoint, Keynote, Word or Finder — grab
any empty part of it and drag out (a press on a gate still edits). A still
figure drags as an SVG (the default) or a PNG, per Settings → *Drag a still
out as*; an animation drags as a GIF, the one still-image format that carries
the motion and drops onto a slide. **Copy** — PNG image (default), SVG image,
SVG markup, data URLs. **Save** — PDF (default, vector), SVG, PNG, and GIF/MP4
for an animation. **Open** — drop or pick any file saved from this app to
reopen it with its source.

Every image format embeds the source and name, so a file found later is
editable.

Everything lands on a slide at one size, which takes a different trick per
format because a slide sizes each differently. A PNG declares its resolution
(the Settings dpi — a whole multiple of 96, 288 by default) so it shrinks back
to its true footprint. An exported SVG states its size in inches, since a bare
number is read differently by different programs. A GIF or video can state no
resolution at all, and PowerPoint places one by its pixels at 72 to the inch,
so those are drawn at ¾ size to land where the rest do. The result is that a
PNG, an SVG, a GIF and an MP4 of the same figure all drop onto a slide the same
size.

PDFs are banded (gradient rectangles drawn as solid strips) so they render
correctly in Apple Preview when embedded via `\includegraphics`.

Cloud outlines are seeded, so the same input always gives the same output.

## URLs

```
?src=00|11                  the editor, pre-loaded
?format=svg&src=00|11       the diagram alone
?format=png&src=00|11       rasterised
?format=pdf&src=00|11       a PDF in the browser's viewer
```

Generated links keep `|`, `(`, `)`, `;`, `:` readable rather than
percent-encoding them, so a URL stays legible. A circuit's arrow is the
exception — its `>` is escaped as `%3E`, because auto-linkers and HTML end a
URL at `>`. These are client-side renders, not HTTP image responses.

## The library

No built-in library. Name a diagram and save it, import a YAML file, or let
the dev server seed from `library.yaml` (not committed — it holds course
material). The library persists in `localStorage` and can be edited,
reordered, grouped and exported from Settings.
