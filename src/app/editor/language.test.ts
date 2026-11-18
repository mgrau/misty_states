import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, foldable, getIndentation, indentUnit } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { toggleComment, indentMore, indentLess, insertNewlineAndIndent } from '@codemirror/commands'
import { braceFolding, gateColour, gateColourVars, mistyHighlighter, mistyLanguage } from './language'
import { LIGHT_PALETTE, withAccent } from '../../core/render/theme'

const stateOf = (doc: string, selection?: { anchor: number; head?: number }) =>
  EditorState.create({ doc, selection, extensions: [mistyLanguage, braceFolding, indentUnit.of('  ')] })

/** Each highlighted stretch of `doc` with the class it was given. */
function marks(doc: string): [string, string][] {
  const state = stateOf(doc)
  const tree = ensureSyntaxTree(state, doc.length, 5000)!
  const out: [string, string][] = []
  highlightTree(tree, mistyHighlighter, (from, to, cls) => out.push([doc.slice(from, to), cls]))
  return out
}

const classOf = (doc: string, text: string) => marks(doc).find(([t]) => t === text)?.[1]

/** Apply a command to a state and hand back the text it leaves. */
function run(state: EditorState, command: (t: { state: EditorState; dispatch: (tr: any) => void }) => boolean) {
  let next = state
  command({ state, dispatch: (tr) => (next = tr.state) })
  return next
}

describe('colouring the gates', () => {
  it('gives each gate the colour it is drawn in, in bold', () => {
    expect(classOf('H 1', 'H')).toBe('ms-gate ms-gate-H')
    expect(classOf('T 2', 'T')).toBe('ms-gate ms-gate-T')
    expect(classOf('CNOT 1 2', 'CNOT')).toBe('ms-gate ms-gate-accent')
    expect(classOf('SWAP 1 2', 'SWAP')).toBe('ms-gate ms-gate-accent')
    expect(classOf('M 3', 'M')).toBe('ms-gate ms-gate-measure')
    expect(classOf('RZ(90) 1', 'RZ(90)')).toBe('ms-gate ms-gate-RZ')
  })

  it('reads a gate in any case, as the parser does', () => {
    expect(classOf('cnot 1 2', 'cnot')).toBe('ms-gate ms-gate-accent')
  })

  it('colours a run letter by letter', () => {
    const m = marks('HZT')
    expect(m.map(([t, c]) => [t, c.split(' ').at(-1)])).toEqual([
      ['H', 'ms-gate-H'], ['Z', 'ms-gate-Z'], ['T', 'ms-gate-T'],
    ])
  })

  it('only where a gate heads the line', () => {
    // A product sign, not a NOT.
    expect(classOf('(0|1) x (0|1)', 'x')).toBeUndefined()
    // A caption, not a Hadamard.
    expect(classOf('after H: 000|111', 'after H')).toBe('ms-caption')
  })

  it('heads again after a semicolon', () => {
    expect(marks('H 1; T 2').filter(([, c]) => c.includes('gate')).map(([t]) => t)).toEqual(['H', 'T'])
  })

  it('heads the line again inside a block', () => {
    expect(classOf('"Prep" 1-2 {\n  H 1\n}', 'H')).toBe('ms-gate ms-gate-H')
  })

  it('knows a definition from its use', () => {
    const doc = 'def flip {\n  X 1\n}\nflip 2'
    const m = marks(doc).filter(([t]) => t === 'flip').map(([, c]) => c)
    expect(m).toEqual(['ms-def', 'ms-def-use'])
  })

  it('tells a comment from a colour', () => {
    expect(classOf('H 1  # the split', '# the split')).toBe('ms-comment')
    expect(classOf('BOX "O" 1-2 fill=#e6f0e6', '#e6f0e6')).toBe('ms-value')
  })

  it('takes the accent from the palette it is given', () => {
    const vars = gateColourVars(withAccent(LIGHT_PALETTE, '#ff0000'))
    expect(vars).toContain('--ms-gate-accent: #ff0000')
    expect(vars).toContain(`--ms-gate-H: ${LIGHT_PALETTE.gateChip.H}`)
    expect(gateColour('fredkin')).toBe('accent')
  })
})

describe('folding', () => {
  it('folds a block from its brace to its brace', () => {
    const doc = 'def flip {\n  X 1\n  X 2\n}\nflip 1'
    const state = stateOf(doc)
    const line = state.doc.line(1)
    const range = foldable(state, line.from, line.to)!
    expect(doc.slice(range.from, range.to)).toBe('\n  X 1\n  X 2\n')
  })

  it('folds the outer block round an inner one', () => {
    const doc = '"A" 1-2 {\n  "B" 1 {\n    H 1\n  }\n}'
    const state = stateOf(doc)
    const range = foldable(state, 0, state.doc.line(1).to)!
    expect(range.to).toBe(doc.lastIndexOf('}'))
  })

  it('ignores a brace in a quote or a comment', () => {
    const state = stateOf('H 1 # {\nH 2')
    expect(foldable(state, 0, state.doc.line(1).to)).toBeNull()
  })
})

describe('editing', () => {
  it('comments a line out with #, and back in', () => {
    const once = run(stateOf('H 1'), toggleComment)
    expect(once.doc.toString()).toBe('# H 1')
    expect(run(once, toggleComment).doc.toString()).toBe('H 1')
  })

  it('indents and unindents a block of lines', () => {
    const state = stateOf('H 1\nX 2', { anchor: 0, head: 7 })
    const more = run(state, indentMore)
    expect(more.doc.toString()).toBe('  H 1\n  X 2')
    expect(run(more, indentLess).doc.toString()).toBe('H 1\nX 2')
  })

  it('indents inside a brace and comes back out at its close', () => {
    const state = stateOf('def f {\n  X 1\n}')
    expect(getIndentation(state, state.doc.line(2).from)).toBe(2)
    expect(getIndentation(state, state.doc.line(3).from)).toBe(0)
    const opened = run(stateOf('def f {', { anchor: 7 }), insertNewlineAndIndent)
    expect(opened.doc.toString()).toBe('def f {\n  ')
  })
})
