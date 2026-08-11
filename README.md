# Misty States

A browser app for drawing quantum states and circuits in the visual language of
Terry Rudolph's *Q is for Quantum* — qubits as shapes, black for 1 and white for
0, superpositions gathered inside a "misty state" cloud.

Type text, get an SVG. Everything runs client-side; nothing is uploaded.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/, plus the API bundle in dist/lib/
npm test         # 628 tests
```

Built with TypeScript, Svelte 5 and Tailwind 4. No backend and no network calls:
`dist/` is a plain static bundle that also runs straight off the filesystem. The
only runtime dependency is jsPDF, loaded lazily for PDF export.

---

## States

Qubits are `0` (white) and `1` (black). Position within a term picks the shape:
the first qubit is a circle, the second a square, the third a triangle, and so on.

| Input | Meaning |
| --- | --- |
| `0` `1` | A single white or black qubit |
| `00\|11` | A superposition. `,` works too: `00,11` |
| `000\|-111` | A leading `-` gives the term a negative amplitude |
| `0(0\|1)` | A bare qubit beside a cloud (a factored state) |
| `(0\|1)(0\|1)` | Two adjacent clouds — a product of separable states |
| `(0\|1) x (0\|1)` | An explicit `×` between factors (`X` works too) |
| `(0\|1)\|(0\|1)` | Clouds nested inside a cloud, to any depth |
| `3*0\|2*1` | Numeric amplitudes; same state as `0\|0\|0\|1\|1` |
| `3(0\|1)\|1` | A coefficient in front of a cloud |
| `0\|1\|-1 = 0` | `=` chains expressions into an equation (also `!=`, `->`) |
| `50%: 0(0\|1)` | Text before `:` is an annotation in the left gutter |
| `0(0\|1) : note` | Text after `:` is an annotation on the right |
| `step: H 1 : note` | The same either side of a gate line |
| `0?1` | `?` is a qubit of unknown value, one per wire |
| `("???")` | Quoted text inside a cloud — `???`, or any other caption |
| `shape os^` | Set which shape each position draws with |
| `0@3` | Force this qubit to use shape 3, whatever `shape` says |
| `"text"` | A literal text label |

Each input line is drawn as its own row, stacked vertically — which is how the
"50% / 50%" measurement-outcome figures are made. `#` starts a comment.

### Naming the register

Position picks the shape, but not every figure uses the default order. A
`shape` line says which shape each position draws with, one character apiece:

| | | | | | | | |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `o` | `s` | `^` | `d` | `v` | `*` | `p` | `h` |
| circle | square | triangle | diamond | heart | star | pentagon | hexagon |

```
shape s^o
010            # a black square, a white triangle, a white circle
```

Pictographic where a character allows — `o`, `^`, `*` — and the shape's initial
otherwise. Not `#` for square, obvious though that looks: `#` starts a comment,
so `shape #^o` would lose its own argument. `O S T t D < V P H` are accepted as
alternatives.

It reads the same in a state and in a circuit, where it also sets the header,
the input and output, and anything `calculate` works out. Spacing is ignored, so
`shape o s ^` and `shape os^` agree.

A name means that shape whatever order the shapes are configured in, unlike the
older numeric form — `shapes 2 3 1` still works and picks the 2nd, 3rd and 1st
of the *current* order. `0@3` overrides a `shape` line for one qubit.

### Annotations

A colon before the state puts text in the left gutter; a colon after it puts
text on the right. Both at once is fine:

```
50%: 00(0|-1) : the circle measured white
50%: 11(0|-1) : the circle measured black
```

Each gutter aligns to a single edge, so a column of annotations reads as a
column rather than ragging along the states — and the left gutter is measured
from the rows that use it, so one wide state elsewhere does not push every
annotation away from what it labels.

The same works in a circuit, on the input, the output, and any state shown
part-way through — including a calculated one:

```
in 001 : the register starts here
SWAP 2 3
after the swap: calculate : two wires exchanged
out calculate : all black
```

A gate line takes them the same way, naming a step of the circuit rather than a
state:

```
in 00
prepare: H 1 : make the misty state
entangle: CNOT 1 -> 2
measure 1 Z; measure 2 Z : read it out
out calculate
```

The label hangs off the gates actually drawn, so a part-width layer is annotated
beside itself rather than beside the whole circuit. Which side of a colon the
text belongs on is settled by what is left over: `CNOT 1 -> 2 : entangle them`
is a gate with a note, not a caption on the state "entangle them". Anything that
would parse as gates in its own right is therefore never taken as prose, and a
`;` inside a candidate annotation is refused outright — so `H 1; encode: H 2` is
an error rather than a caption that quietly swallowed the first gate. A colon
inside a quoted label, as in `box "cost: 5" 1-2`, is left alone.

### Animating a circuit

`animate` sets the state moving: the qubits travel down the wires, the gate's
casing goes clear as they reach it so you can watch it act on them, and they
carry on changed.

```
in 11
CNOT 1 -> 2
animate
```

The result is one self-contained SVG that plays by itself — CSS keyframes in a
`<style>` block, no script — so it works in a browser, in Quarto HTML, and as a
file you can send someone. `speed=`, `dwell=`, `hold=` and `loop=off` tune it.

A **superposition** is worked through a term at a time, which is what linearity
looks like: the terms wait on the pipes above a gate, go through one at a time,
and pile up below it. Once they have all been through, the pile is added up —
identical terms merge and their amplitudes add, opposite ones take each other
away — and what is left is what waits above the next gate. `0|1` through a
Hadamard is four results collapsing to `2*0`, which is rules 2 and 3 happening
in front of you.

A state with a single term keeps the simpler picture, individual qubits and
crossing swaps and all: one row of qubits on the wires is exactly what that
animation already draws.

Repeating is off by default — a figure is usually read once, and a drawing that
keeps restarting is hard to talk over. `animate loop=on` asks for it, and the
toolbar's **Once / Repeat** button switches the preview.

**Opening the gates.** By default a gate's casing goes clear as the state
reaches it, so you see the gate act: a term splits in two where it stands, the
bracket forms round the pair, and the pair leaves together. `animate inside=off`
— or the Settings toggle it defaults from — draws the gate as a closed box
instead: qubits go in at the lid and come out underneath. That is the picture to
draw when the gate is something to take on trust rather than look into.

Refused: a **measurement**, which splits the drawing into outcomes rather than
moving it, and more than eight terms at once — a Hadamard on each of four wires
asks for sixteen rows, which is a list rather than a picture. Everything
`calculate` cannot follow is refused the same way it is there.

A swap is the one gate where the paths cross: the two qubits carry their own
colours across each other, because that is what a swap does — it moves the
qubits, it does not repaint the wires. (In the term-at-a-time picture a swap
shows as the bits exchanging rather than as a crossing, the subject there being
whole rows.)

The written `in` and `out` states are left undrawn, since the travelling qubits
are them.

**Saving one.** The SVG plays by itself, which suits a web page and nothing
else. **Save → Animated GIF** and **MP4 video** encode the run for everywhere
that will not take an SVG — slides, a document, a message. Both are drawn from
the same timeline the SVG's keyframes come from, sampled rather than played, so
a saved file and what was on screen cannot disagree.

A GIF plays anywhere and loops by itself, at the cost of 256 colours — nothing
on flat line art, visible banding on the isometric theme's gradients. An MP4 is
several times smaller and keeps the colour, but wants WebCodecs, so it is
offered only where the browser has it. `loop=off` reaches the file: a GIF made
from it plays once rather than sitting there restarting.

Settings chooses the frame rate — 25, 30, 50 or 60. A GIF holds its timing in
hundredths of a second and nothing finer, so it is sampled at the nearest rate
it can actually express: ask for 30 and the file runs at 33⅓, keeping the run's
true length rather than drifting from it. Higher rates cost size sharply — a
two-second figure is about 460 kB at 30 and 700 kB at 60 — which is the case for
MP4 where the browser can make one.

**Controls.** An animation gets a toolbar of its own below the figure's name:
back to the start, a step either way, play/pause, repeat, and a scrubber marked
with the keyframes. Stepping *plays* the piece between two stops rather than
cutting to it — the qubits moving is the thing being shown, so skipping it would
skip the point. Going back to the start is the exception, being something you
want done rather than watched.

The scrubber catches on the keyframes and ends where the motion does: `hold=`
puts a pause on the finished state before it runs round again, which is worth
having and worth nothing to look at. The repeat button starts from whatever
`loop=` asked for; the exported file follows the source rather than the button.

The stops are the moments a gate is worth looking at: the qubits above the
first one, then for each gate arrived inside with the casing clear and the
instant it acts, and finally the register at rest below the last one. There is
no stop in the gap between two gates — leaving one is being on the way into the
next, and pausing there says nothing the stops either side do not.

A gate acts in the *middle* of its dwell rather than across the whole of it, so
there is an instant at which the qubits have arrived and nothing has happened
yet. That matters most for a swap, whose crossing is motion rather than an
instant change: spread over the whole dwell it would begin the moment they
entered. The *acting* stop then sits after the change but before the casing
shuts, since once it has, the gate's own glyph is back on top of the qubit it
just changed.

Nothing is added to the file to make that work. The generated SVG reads two
custom properties, `--misty-play` and `--misty-at`, defaulting to what it does
unattended; the app sets them on an ancestor. So the same file still plays by
itself anywhere else, with no script inside it and nothing to strip before
sending it to someone.

### Questions and answers

A figure that poses a question and the figure that answers it are the same
drawing with some states blanked out, so one document holds both. `answer` marks
what the question is asking for:

```
in 001
SWAP 2 3
answer 010
CNOT 2 -> 1; X 3
answer out 111
```

The drawing hides every marked state behind `???`, one unknown per wire, until
the toolbar's **Show answer** is pressed. No `out` is needed — position already
says whether a state line is the input, a view, or the output — and the rest of
the line reads exactly as it would without the word, captions and all.

The source keeps the **answer**, not the question, and that way round is the
useful one: the checker can settle a stored answer, and it cannot drift from its
question, there being only one document to drift from.

It composes with `calculate`, which is where it earns the most — and `answer` on
its own means exactly that, the one answer that need not be written down. At the
top of a circuit it asks for the input; anywhere else, for the state there:

```
in 00|01|01|10
I 1; measure 2 Z
answer
```

The answer is then worked out rather than written down, so it cannot be wrong —
this is the figure whose printed key gave 2/3 for both outcomes. A calculated
answer takes its odds with it when hidden, those being half of what a
measurement question asks; a caption you wrote yourself is a label rather than
an answer, so it stays.

### Checking a figure

A figure often makes a claim — that two expressions are the same state, or that
a circuit turns this input into that output. Both are claims the arithmetic can
settle, so the toolbar shows a quiet **Checks out** or **Doesn't check out**
beside the diagram's name, with the detail on hover.

Three rules govern it:

- **A claim that cannot be evaluated is not a failure.** `?` is an unknown, a
  text label is prose, a `box` is a picture. A figure full of them is a
  question, not a wrong answer, and nothing is said.
- **Nothing is blocked.** A wrong figure still draws — drawing a wrong one is
  sometimes the exercise, which is why the verdict can be waved away. It comes
  back when the diagram changes, since by then it is about something else.
- **Anything derived is not a claim.** A `calculate` came from the simulator, so
  checking it would only confirm the simulator agrees with itself.

In a circuit it settles the written `out`, and any state written part-way
through — so a worked solution is checked at every step, not just at the end.
Comparison ignores overall scale and overall sign, both of which are
unobservable, so `00|11` and `2*00|2*11` agree. An equation's two sides are
*not* padded to a common width, though: describing different registers is a
mistake worth naming.

Turn it off in Settings if you never want it.

### The six rules

All of the misty-state algebra rules are expressible directly:

```
00|01 = 01|00                    # 1. term order does not matter
0|1|-1 = 0                       # 2. opposite amplitudes cancel
0|1|0|1 = 0|1                    # 3. repeated terms reduce
(0|1)|(0|1) = 0|1|0|1            # 4. nested clouds flatten
00|01 = 0(0|1)                   # 5. a common qubit factors out
(0|1)(0|-1) = 00|-01|10|-11      # 6. adjacent clouds distribute
```

## Circuits

Circuits are vertical: qubits enter at the top and fall down through gates
connected by pipes.

```
qubits 3
H 3
CNOT 3 -> 2
CNOT 2 -> 1
out 000|111
```

| Statement | Meaning |
| --- | --- |
| `qubits 3` | Widen the register. Rarely needed — it is inferred from the gates and the `in`/`out` states |
| `H 2` | Single-qubit gate. Also `X Y Z S T`, and `PETE` as an alias for `H` |
| `I 2` | Identity — drawn as plain pipe, so it just holds a slot in the layer |
| `CNOT 3 -> 2` | Control 3, target 2. `CX` is an alias; the arrow is optional, so `CNOT 3 2` reads the same |
| `TOFFOLI 1 2 -> 3` | Two controls. `CCNOT`/`CCX` are aliases; `TOFFOLI 1 2 3` too |
| `CZ 1 2` | Controlled-Z, drawn symmetrically |
| `CNOT "Oracle" 1 -> 2` | A quoted name **before** the wires stands on the target, in place of the ⊕ |
| `CNOT 1 -> 2 "Tiger?"` | A quoted name **after** them labels the link between the wires |
| `SWAP 1 2` | Swap two qubits |
| `measure 2 Z` | Measurement in a basis. `M` is an alias; the basis defaults to `Z` |
| `box "Oracle" 1-3` | Custom labelled box spanning a range; add `fill=#e3efe3` |
| `blank 1-2` | An empty frame for students to fill in |
| `in 00\|11` | Misty state above the circuit |
| `out 000\|111` | Misty state below the circuit |
| `header on` | Label the columns with their qubit shapes (`labels on` is an alias) |
| `shape ^os` | Per-wire shapes, for a register not in the default order |

### What sits above the circuit

Nothing, unless you ask. A circuit on its own is just gates and pipe:

```
CNOT 1 -> 2
```

That renders the gate alone, keeping short input and output pipe stubs so it
still reads as a piece of plumbing — useful for a legend, or for asking "what
does this gate do?".

Add `in <state>` for a misty state above the circuit, or `header on` for the
bare qubit shapes when you want the columns labelled:

```
qubits 3
header on
H 3
CNOT 3 -> 2
out 000|111
```

### States inside a circuit

A line that is a state rather than a gate is a **view** — a window onto the
computation at that point — and where it sits says what it means:

```
000                 # before any gate: the input
H 1
after H: 0(0|1)0    # between gates: a snapshot, with a caption
CNOT 1 -> 2
view 2-3 00|11      # just two of the qubits; qubit 1 flows past
111                 # after the last gate: the output
```

`in` and `out` still work and mean exactly the same thing; naming them is often
clearer than relying on position.

**Two looks.** `view` is a break in the plumbing: the pipes stop either side and
the state stands in the gap. `window` frames it instead — a surround built like
any other gate, so it shades and extrudes like one, with a glazed pane set into
its front face holding the state. The pane is white by default and `fill=`
styles it.

```
view 2-3 00|11              # a gap in the circuit
window 111                  # a framed instrument in the line
window 010 fill=#e3efe3     # the pane is what takes the colour
```

A window grows to hold what is inside it, in both directions, and stays
concentric with the wires it covers so the pipes still meet it square. A frame
wide enough to reach out over a wire it does *not* cover leaves that wire drawn
in front of it, so it reads as passing by rather than being taken in.

**Which qubits.** A bare state covers as many qubits as it is wide, starting at
the first. `view` and `window` take an explicit range — `view 2-3 00|11` — and
error if the state is not that wide. Qubits outside the span are simply not
covered, so their pipes run straight through: "look at these, leave those alone"
needs no extra syntax. After `view`, a leading number is the span only when
something follows it, so `view 10` is the two-qubit state `10` while `view 1 0`
is qubit 1.

**Holding a wire while looking at others.** `I 2 0` is an identity that shows
what its qubit holds — the same window, on a wire where nothing is happening —
and `;` puts it in the same layer as a view of the rest:

```
view 2-3 00|11; I 1 0
```

Views placed side by side are nudged apart if a cloud would run through the
qubit beside it. Usually the state is a product, though, in which case one view
says it better: `0(00|11)` covers all three wires and lines each piece up on its
own columns.

**Where it lands.** A view takes a layer to itself — a snapshot is a moment
*between* gates, not one of them — so nothing packs alongside it unless joined
by `;`, and nothing packs past it. The pipes it covers stop at it rather than
running behind, with clear pipe left above and below so the break reads as the
plumbing stopping rather than the qubits being wedged between two pipe ends.

**How it lines up.** A product is drawn piece by piece over the columns it
describes: bare qubits on their own pipes, a cloud centred over however many
columns it spans. Clouds are almost always wider than the column pitch, so
pieces that would collide are pushed apart just far enough and the row
re-centred — everything stays on its own column where there is room, and
degrades to an evenly spread row where there is not. An equation, or a state
carrying a text label, has no such correspondence and is centred as one group.

**Captions.** `after H: 000|111` puts the text in a gutter to the left of the
whole circuit, right-aligned against a single edge so a column of them reads as
a column. The state itself stays centred on its columns, so a captioned row
lines up with an uncaptioned one.

### Working the state out

Write `calculate` — or `calc` — where a state would go, and it is computed from
the input and the gates above it:

```
in 001
SWAP 2 3
after the swap: calculate      # 010
CNOT 2 -> 1; X 3
out calculate                  # 111
```

It goes anywhere a state can: `out calculate`, a bare line, `view calculate`,
`window calculate`, with or without a caption. A snapshot shows the state
*entering* its own layer, which is what a view means — the moment between the
gates above and the gates below.

**The arithmetic is exact integers.** Take the PETE box unnormalised — `0 → 0|1`
and `1 → 0|-1` — and every gate the course uses maps whole numbers to whole
numbers. `H·H = 2I`, and the factor of two divides straight back out. So there
is no floating point and nothing to round, and the answer lands in the notation
already drawn: reduce the terms by their common factor and `3*0|2*1` falls out
on its own. Overall sign and scale are unobservable, so the result is
normalised — smallest whole numbers, leading term positive.

Settings chooses whether the answer is **factored** into a product where it
separates — `(00|11)0` — or drawn **flat** as one cloud — `00|11 0` written out
in full. Only contiguous runs of wires can be factored, since that is what the
drawing can express.

An overall minus sign is unobservable, so it is normally tidied away with the
scale. Settings can **keep** it, for the figures that exist to show a phase flip
happening: `1 / H / X / H` then reads `-1` rather than `1`, which is the whole
point of that circuit being a Z. The sign belongs to the state rather than to
any one factor, so it is carried on the first block of a product — and where
every block is a bare run, the product is given up rather than grow a bracket
just to hold it, so `11 / CZ` draws `(-11)` and not `(-1)1`.

A circuit that writes no input starts from **every wire white**, so `H 1` alone
calculates to `0|1` and no `in` line is needed for the usual case.

**It runs backwards too.** Every gate this notation can follow is its own
inverse — `H·H = 2I`, and the rest are permutations — so a circuit is settled by
the state at *any* point, not only at the start. `in calculate` asks for the
input, worked back from a state written further down:

```
in calculate
H 3
CNOT 3 -> 2
SWAP 1 2; X 3
out 000|101
```

which gives `010`. That is the shape of a great many exam questions, and it used
to be a parse error. A measurement cannot be undone, so nothing before one can
be worked out, and it says so.

It refuses rather than guessing: `S`, `T` and `Y` need complex amplitudes the
notation cannot draw, `BOX` and `BLANK` are pictures rather than operations, and
`?` has no value to propagate. Each says which gate and why.

### Measurement

A measurement leaves several possible states, so `calculate` draws them all —
one row per outcome, labelled with how likely it is:

```
in 00
H 1
CNOT 1 -> 2
measure 1 Z; measure 2 Z
out calculate        # 50%: 00
                     # 50%: 11
```

The odds come from the Born rule on exact integers, so they are exact
fractions. Settings chooses how they are written: a **rounded percentage** by
default, or **exact odds**, which falls back to a fraction only where a
percentage would have to round — `9/13` rather than `69%`. An even split reads
`50%` either way.

The measured qubit keeps its collapsed value and the rest stay in
superposition, so `00|10|-01|11` measured on the first wire gives `50%: 0(0|-1)`
and `50%: 1(0|1)`, minus sign intact. Gates below a measurement apply to every
branch, and a second measurement branches again. An outcome with no amplitude is
dropped rather than drawn at 0%.

A single outcome is still labelled `100%` once a measurement has happened —
that a measurement told you nothing is worth saying. Before any measurement
there are no odds to report and no label appears.

Only the Z basis is handled: an X or Y measurement has no white-or-black outcome
the notation could draw, and says so.

### Tables

`tabulate` — or `table` — draws the same answer as the *Possibility /
Probability* table the course pairs with every measurement figure. It goes where
an output goes, as `out tabulate` or on a line of its own, and nothing follows it:

```
in 0|0|1|1|1
measure 1 Z
tabulate(possibility, amplitude, probability)
```

|  |  |  |
| --- | --- | --- |
| Possibility | Amplitude | Probability |
| ○ | 2 | 4/13 |
| ● | 3 | 9/13 |

Columns are `possibility`, `probability` and `amplitude`, in the order written,
defaulting to the first two. Each takes a short name — `state`, `p`, `amp` — and
can be renamed with `p="Chance"`, headings being the one piece of English the
renderer emits.

**What a row is follows the circuit rather than being chosen.** With a
measurement, each row is an outcome; without one there is a single outcome and
the rows are the terms of it, which is what gives an amplitude column something
to say. Amplitudes are reduced across the whole table rather than row by row, so
the 2 and 3 above survive instead of flattening to 1 and 1.

The amplitude is the one in front of the state **as drawn**. A branch left in
superposition by a partial measurement has an amplitude per term and so no
single term to read one off, but the drawing reduces each block by its common
factor, and what stands in front of the result is that factor:

```
00|01|00|-11  =  2*(00) | 1*((0|-1)1)
```

so those two rows report 2 and 1. Note this is the notation's amplitude rather
than a normalised one — the drawn states have different lengths, so squaring it
does not by itself give the probability beside it.

**How it is checked.** Three independent ways, because a simulator that is
subtly wrong draws plausible diagrams rather than obvious errors:

- every figure in the project library with both an input and a written output —
  answers a person worked out by hand — is recalculated and must agree
- algebraic identities that hold for *every* input: `H·H = 2I`, `X = H·Z·H`,
  `SWAP` as three CNOTs, gates on different wires commuting
- a second implementation in `reference.ts` that builds dense matrices from
  Kronecker products and multiplies floating-point vectors through them — a
  different algorithm, run against the first on hundreds of random circuits

### Charts

`chart` — or `plot` — draws the state as a bar per basis state, the view the
misty state cannot give. A cloud says *which* states are in a superposition;
this puts them all on one scale, including the ones with nothing in them, which
is what makes interference visible: a term that has cancelled is a bar that is
not there.

```
in 00
H 1
H 2
CZ 1 2
chart
```

It goes exactly where a table goes — `out chart` or a line of its own, nothing
after it — and takes a caption and a note the same way.

Amplitudes are the default, because the sign is the half a probability throws
away, and the half that does the interfering. `chart(probability)` plots the
chances instead, all positive and labelled with the odds. Both are normalised,
unlike the table's amplitude column: a bar's height is a share of the whole
state, so it has to be on the scale where that means something.

**An amplitude bar is coloured, a probability bar is not.** Blue above the axis
and red below, deepening with the size of the term, so the shape of a plot is
taken in before any one bar is measured — and a plain grey plot is the tell that
there is no sign left to say.

Basis states are written *down* the page under their bars, not across. A
register laid sideways under every bar makes the plot as many times wider as
there are wires; the glyphs stay upright, because a triangle on its side is a
different glyph rather than the same one rotated.

The half below the axis is drawn only when something is down there. Past five
wires the empty bars are dropped — 32 bars is already a smear rather than a
reading — and past a measurement there is no single statevector left, so the
bars become the outcomes and their chances, which is what the table lists. A
chance written over a bar shrinks to fit it, and is left off when even that
would not be worth reading.

### Layers

Gates pack automatically: each drops into the earliest layer at or after the
last layer that touched any qubit in its span. So independent gates sit side by
side, but a gate never floats above one it depends on.

Two overrides, both of which win over the automatic placement:

- `;` puts gates in the **same** layer — `H 1; H 2`
- `---` on its own line forces a **new** layer

### Shorthand for one-wire gates

A gate told nothing about which wire it acts on takes the first, so `H` is `H 1`
— and that goes for `X`, `Y`, `Z`, `S`, `T`, `I`, `NOT`, `PETE` and `M` alike.

A run of the one-letter gates is a row of them, one per wire from the first, all
in the same layer:

```
HH        # H 1; H 2
HZT       # H 1; Z 2; T 3
HIX       # a Hadamard, a held wire, a NOT
```

It says what a row looks like rather than which wires it is on, which is how
these circuits are usually described out loud. Only the one-letter gates join a
run, and only from two letters up — `CZ`, `ID` and `SWAP` are names, not runs.
`M` stays out of it too: a measurement's basis is a trailing letter, so `MZ`
would read as "measure wire 1, `Z` on wire 2" when it plainly means a Z-basis
measurement.

## Themes

Chosen from the toolbar; the geometry is identical across all three, only the
shading differs.

- **Solid** (default) — flat 2D with cylinder gradients on the pipes, lit qubit
  glyphs, and soft shadows under boxes and clouds, so the pieces read as objects
  you could pick up. Pale glyphs darken away from the light, dark glyphs pick up
  a highlight, both lit from the same direction.
- **Flat** — pure line art, no shading. Best for print.
- **Isometric** — extruded gate boxes and cylindrical pipes, matching the
  hand-drawn figures in the course materials.

Settings also holds the dark palette, the PNG resolution, a configurable shape
order (defaults to circle, square, triangle, diamond, heart, star, pentagon,
hexagon), whether superposition terms are separated by `|` or `,` when drawn,
and sliders for how fluffy the cloud outlines are and how much padding they
leave. Qubit size sits beside Zoom, above the preview.

## Export

Zoom resets by clicking its own label, and a scroll over the drawing zooms it.

Three toolbar menus — **Copy**, **Save** and **Link** — and the same actions on
a right-click over the diagram. Each is a split button: the labelled half runs
the first item in its menu, the caret opens the rest.

| Save | |
| --- | --- |
| **PDF** (default) | Vector, page cropped to the figure — drops straight into LaTeX |
| SVG | Vector, editable in Inkscape or Illustrator |
| PNG | Raster at 150/300/600 dpi |

**Copy** offers the drawing as an image — **PNG image** (the default, and what
pastes reliably into slides, docs and mail) and **SVG image**, which keeps it
vector — plus the SVG markup as text, and data URLs for SVG, PNG and PDF.

Browsers disagree about what may go on the clipboard. The async clipboard only
guarantees `text/plain`, `text/html` and `image/png`; Safari also accepts
`image/svg+xml`, Chrome and Firefox reject it. So **SVG image** writes a real
SVG where it can, and otherwise falls back to `text/html` carrying the markup,
which Word, Keynote and Illustrator will generally paste as vector. The toast
says which route it took, so you are never told "vector" when it was not. It
never quietly degrades to a raster — choose **PNG image** if you want that.

`application/pdf` cannot go on the clipboard at all, so a PDF is copied as a
data URL: paste it into the address bar to open the document.

PDF export is vector, via jsPDF. It is the only part of the app with a runtime
dependency, and it is loaded lazily, so the ~390 kB never reaches anyone who
does not export a PDF.

Cloud outlines are jittered from a seeded PRNG, so the same input always
produces byte-identical output — figures stay stable when a problem set is
regenerated.

### Reopening a saved figure

Every export carries its own source and name, so a file found in a folder a year
later is still editable. **Open** in the toolbar takes an SVG, PNG or PDF saved
from this app — or drop one anywhere in the window — and puts both back. Plain
text files are read as source directly, with the filename as the name.

| Format | Source | Name |
| --- | --- | --- |
| SVG | A `<metadata>` element, as readable text | `<title>` |
| PNG | A `tEXt` chunk, base64 of UTF-8 (tEXt values are Latin-1) | The spec's own `Title` chunk |
| PDF | Info: `Subject` readable, `Keywords` the base64 read back | The document title |

The name rides in each format's own title field, so it is not just ours to read:
file browsers, image tools and PDF viewers all show it. The PDF carries the
source twice because Info strings use a legacy character set that can mangle
anything outside ASCII — `Subject` is for the reader's Properties panel,
`Keywords` is authoritative. Re-encoding an image elsewhere generally strips the
metadata; the app says so plainly rather than failing silently.

## The library

**There is no built-in library.** The app starts empty and the picker stays
hidden until something is loaded, so the repository ships with no course
material in it.

A library arrives one of three ways: name a diagram and press **Save to
Library**, import a YAML file from Settings, or — in a working copy — let the
dev server seed one from `library.yaml` in the project root.

### library.yaml

Not committed (see `.gitignore`): it holds problems and their solutions. A Vite
plugin reads it at build time and hands it to the app, and the module resolves
to nulls when the file is absent — which is how the same code ships an empty
library and opens a full one on your own machine.

Reseeding is keyed on a hash of the file's contents. Edit `library.yaml` and the
next load replaces what the browser is holding; ordinary edits made in the app
survive a refresh until then. **A rebuilt library wins over unsaved work in the
browser** — export first if that matters.

```yaml
name: PHYS 137T — Fall 2025
groups:
  - label: Problem Set 2 — Circuits
    entries:
      - id: ps2.1
        title: §1 Swap, CNOT and NOT
        origin: ps2.problem1.png      # optional
        source: |-
          in 001
          SWAP 2 3
```

Tests use the same module: `library.test.ts` checks every entry still renders
when the file is there, and skips itself when it is not, so a fresh clone stays
green. The format itself is checked against a fixture that always exists.

### Naming and saving

The name sits below the zoom controls and travels with the diagram into every
export. **Save to Library** adds it; once the name matches something already
there the button becomes **Update in Library** and replaces that entry *where it
already sits*, so a corrected figure keeps its place among its neighbours.
Matching ignores case and surrounding space.

### The editor

Settings → **Edit library…** opens it. The library has a name, which heads the
picker. Groups can be renamed, reordered, collapsed, added and deleted; diagrams
can be renamed, deleted, and dragged anywhere — including into another group, or
onto a collapsed one to file it away without unfolding it.

Dragging works the way the qubit shape list does — pressing a grip picks a row
up and moving the pointer splices it through the list — with one difference. A
diagram can cross groups, so every entry row is one target list, and moving a
row between groups shifts every other row's offset. The bands are therefore
re-measured after each move, from `offsetTop` rather than
`getBoundingClientRect`: layout positions ignore the FLIP transforms still in
flight, so the animation cannot feed back into the hit-testing driving it.

Everything persists as you go; there is nothing to confirm except deleting a
group that still holds diagrams, which asks once.

## URLs

Everything needed to reproduce a drawing travels in the query string, so the one
static page answers all of these — no server, no stored state.

```
?src=00|11                  the editor, pre-loaded
?format=svg&src=00|11       the diagram alone, no editor chrome
?format=png&src=00|11       the diagram alone, rasterised
?format=pdf&src=00|11       the PDF, in the browser's own PDF viewer
?format=pdf&src=00|11&download=1   … and saved immediately
```

Parameters: `src` (required), `format`, `theme`, `dark=1`, `bg=1`, `scale`,
`qubit`, `download=1`. Unknown formats and themes are ignored rather than
trusted, and numbers are clamped.

You can write `|`, `(`, `)`, `;`, `:` and `->` literally — no `%7C` needed — and
generated links keep them that way, so a URL stays legible:

```
?format=svg&src=(00|11)(0|-1)
?format=svg&src=qubits 3;H 3;CNOT 3 -> 2
```

`&`, `=`, `+`, `#` and `%` are still escaped inside `src`, since those are what
separate one parameter from the next. Two places where a literal `|` will bite:
a Markdown **table** cell, and some plain-text auto-linkers that stop at it —
percent-encode there.

These links work from any file server or straight off the filesystem.

### What these links can and cannot do

`?format=pdf` really does open a PDF: the page builds it in the browser and
hands it to a blob whose type is `application/pdf`, so your browser's own PDF
viewer takes over, download and print buttons included. Adding `download=1`
saves the file instead. The same goes for the SVG and PNG views.

What none of them do is answer with the image *as the HTTP response*. The first
response is `text/html`, because a static host cannot be made to return
`application/pdf` or `image/svg+xml` — only a server can do that. So these links
are for **a person opening them**, not for `<img src>`, `curl`, pandoc or a
LaTeX build fetching bytes. For embedding in a document, use a data URL; for a
build pipeline, save the file, or call `MistyStates.svg()` from a script.

### Data URLs

The **Copy** menu offers `data:image/svg+xml;base64,…`, `data:image/png;base64,…`
and `data:application/pdf;base64,…`. These *are* the file, so the image ones work
anywhere a document references an image:

```html
<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0i…">
```

The trade-off: they are long (a few kB), GitHub markdown strips them, and some
LaTeX/PDF pipelines will not fetch them. For a Quarto problem set, **Save SVG**
or **Save PNG** into an `images/` folder is usually the better route.

## JavaScript API

The renderer is available programmatically, as an ES module or a global.

```bash
npm run build:lib   # dist/lib/misty-states.js (global) and .mjs (ES module)
```

```html
<script src="misty-states.js"></script>
<script>
  document.body.innerHTML = MistyStates.svg('000|-111|110|-001')
</script>
```

```js
import MistyStates from './misty-states.mjs'

MistyStates.svg('00|11', { theme: 'flat' })          // SVG markup
MistyStates.render('qubits 2\nH 1')                  // { svg, kind, width, height }
MistyStates.svgDataUrl('00|11')                      // data:image/svg+xml;base64,…
await MistyStates.pngBlob('00|11', { scale: 4 })     // Blob
await MistyStates.pngDataUrl('00|11')                // data:image/png;base64,…
MistyStates.editorUrl('00|11')                       // ?src=00%7C11
MistyStates.imageUrl('00|11', 'png', { scale: 4 })   // ?format=png&src=…&scale=4
MistyStates.detectMode('qubits 2\nH 1')              // 'circuit'
MistyStates.themes                                   // ['solid', 'flat', 'isometric']
```

Render options (`theme`, `dark`, `background`, `scale`, `metrics`, `shapeOrder`)
are accepted by every render call. Two of them are ways of *reading* a figure
rather than parts of it: `step: n` works the state out after `n` layers and
draws it in the middle of the circuit, and every result carries `dirac` — the
state it ends on, written `(|00⟩ + |11⟩)/√2`, one line per outcome once a
measurement has left more than one. `layers` says how many there are to step
through. Parse errors throw with the column-level
message the editor shows.

Whether a source is a state or a circuit is worked out automatically — the two
grammars are disjoint, so there is nothing to configure. `render()` returns the
`kind` it settled on.

`svg` and the URL builders are pure and run anywhere, **including Node** — handy
for generating figures in a build script. The PNG helpers rasterise through a
canvas, so they need a browser and reject with a clear message otherwise. The
URL builders default to the current page and take an explicit `base` outside one.

The editor page also sets `window.MistyStates`, so the API is callable from the
console or from any script on the page.

## Layout

```
src/lib/
  shapes.ts            qubit shape paths and the shape order
  svg.ts               SVG string builder, boxes, seeded PRNG
  state/               misty-state AST, parser, layout
  circuit/             circuit AST, parser (incl. layer scheduling), layout
    simulate.ts        exact-integer simulation behind `calculate`
    reference.ts       a second, dense implementation, used only to disagree
  chart/layout.ts      the statevector plot: a bar per basis state
  render/
    primitives.ts      positioned, theme-agnostic drawing instructions
    cloud.ts           cloud outline generation
    theme.ts           palettes, theme interface, shared glyphs
    themes.ts          the solid / flat / isometric surfaces
  url.ts               query-string encoding for every kind of link
  route.ts             which view a URL asks for
  export.ts            SVG/PNG download, clipboard and data URLs
  metadata.ts          the source and name embedded in, and read back out of, a file
  library.ts           the shape of a library; the app ships with none
  library-yaml.ts      the YAML format, and its validation
  library-store.svelte.ts  the loaded library, its persistence and its editing
  index.ts             render(source, options) -> SVG
  api.ts               the public programmatic API
src/
  App.svelte           the editor
  Viewer.svelte        the bare image view for ?format=
  components/
    SidePanel.svelte       the drawer on the right, shared by both panels below
    SettingsPanel.svelte   style, appearance and library import/export
    SyntaxHelp.svelte      the syntax reference, grouped by what you are doing
    LibraryEditor.svelte   arranging the library: names, groups, order
scripts/
  render-examples.ts   dump every example to SVG for eyeballing
```

Parsing and layout are pure functions with no DOM dependency, which is why the
whole pipeline is testable in Node and reusable outside the app.
