/**
 * Questions and their answers, in one document.
 *
 * A figure that poses a question and the figure that answers it are the same
 * drawing with some states blanked out. The source keeps the answer — that way
 * round the checker can settle it, and it cannot drift from the question,
 * because there is only one document to drift from.
 */

import { describe, expect, it } from 'vitest'
import { parseCircuit } from './circuit/parse'
import { parseState } from './state/parse'
import { conceal, concealState, hasAnswer } from './conceal'
import { render } from './index'

const shown = (src: string) => render(src, { answers: true }).svg
const asked = (src: string) => render(src).svg

describe('writing it', () => {
  it('marks a state wherever one may stand', () => {
    const doc = parseCircuit('answer in 10\nSWAP 1 2\nanswer 01\nX 1\nanswer out 11')
    expect(doc.answerInput).toBe(true)
    expect(doc.answerOutput).toBe(true)
    const views = doc.layers.flatMap((l) => l.gates).filter((g) => g.kind === 'view')
    expect(views.some((g) => g.kind === 'view' && g.answer)).toBe(true)
  })

  it('needs no "out": position already says what a state line is', () => {
    // The simpler spelling, and the one that reads aloud.
    expect(parseCircuit('in 00\nH 1\nanswer 0|1').answerOutput).toBe(true)
    expect(parseCircuit('answer 00\nH 1').answerInput).toBe(true)
  })

  it('on its own asks for the state worked out', () => {
    // The one answer that need not be written down.
    const bare = 'in 00\nH 1\nCNOT 1 -> 2\nanswer'
    const spelt = 'in 00\nH 1\nCNOT 1 -> 2\nanswer out calculate'
    expect(render(bare, { answers: true }).svg).toBe(render(spelt, { answers: true }).svg)
    expect(render(bare).svg).toBe(render(spelt).svg)
    expect(render(bare).hasAnswer).toBe(true)
  })

  it('works part-way through as well as at the end', () => {
    expect(render('in 00\nanswer\nH 1').hasAnswer).toBe(true)
  })

  it('reads the rest of the line exactly as it would without it', () => {
    const plain = parseCircuit('in 001\nSWAP 2 3\nout 010')
    const marked = parseCircuit('in 001\nSWAP 2 3\nanswer out 010')
    // Where each qubit was written is the one thing that legitimately differs:
    // `answer` is seven characters, so everything after it really is seven
    // further along. What it must not change is what the line *says*.
    const said = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'at' ? undefined : v)))
    expect(said(marked.output)).toEqual(said(plain.output))
    expect(said(marked.layers)).toEqual(said(plain.layers))
  })

  it('takes a caption either side of it', () => {
    expect(hasAnswer(parseCircuit('in 001\nSWAP 2 3\nafter the swap: answer 010'))).toBe(true)
    expect(hasAnswer(parseState('50%: answer 0(0|1)'))).toBe(true)
  })

  it('marks a row of a plain state document', () => {
    const doc = parseState('00|01 = 0(0|1)\nanswer 0|1')
    expect(doc.rows[0].answer).toBeUndefined()
    expect(doc.rows[1].answer).toBe(true)
  })

  it('leaves a document without one exactly as it was', () => {
    const src = 'in 001\nSWAP 2 3\nout 010'
    const doc = parseCircuit(src)
    expect(hasAnswer(doc)).toBe(false)
    // Handed straight back, not rebuilt: nothing to hide is nothing to do.
    expect(conceal(doc)).toBe(doc)
    expect(asked(src)).toBe(shown(src))
  })
})

describe('hiding it', () => {
  it('replaces the answer with as many unknowns as it is wide', () => {
    const doc = conceal(parseCircuit('in 001\nSWAP 2 3\nanswer out 010'))
    const factors = doc.output![0].sides[0].factors
    expect(factors).toHaveLength(3)
    expect(factors.every((f) => f.kind === 'qubit' && f.value === 'unknown')).toBe(true)
  })

  it('hides only as wide as a partial view covers', () => {
    const doc = conceal(parseCircuit('in 000\nH 1\nanswer view 2-3 00\nX 1'))
    const view = doc.layers.flatMap((l) => l.gates).find((g) => g.kind === 'view')!
    expect(view.kind === 'view' && view.rows![0].sides[0].factors).toHaveLength(2)
  })

  it('draws the question and the answer differently, and nothing else', () => {
    const src = 'in 001\nSWAP 2 3\nanswer 010\nCNOT 2 -> 1; X 3\nanswer 111'
    expect(asked(src)).not.toBe(shown(src))
    expect(shown(src)).toBe(render('in 001\nSWAP 2 3\n010\nCNOT 2 -> 1; X 3\nout 111').svg)
  })

  it('keeps a label the author wrote', () => {
    // "after the swap" is context, not answer.
    expect(asked('in 001\nSWAP 2 3\nafter the swap: answer 010')).toContain('after the swap')
  })

  it('takes the odds with a calculated answer', () => {
    // They are half of what a measurement question asks; leaving them up would
    // give that half away.
    const src = 'in 00|01|01|10\nI 1; measure 2 Z\nanswer out calculate'
    expect(shown(src)).toContain('67%')
    expect(asked(src)).not.toContain('67%')
  })

  it('hides a row of a plain state document', () => {
    const doc = concealState(parseState('answer 0(0|1)'))
    expect(doc.rows[0].sides[0].factors.every((f) => f.kind === 'qubit')).toBe(true)
  })
})

describe('what it is for', () => {
  it('settles the answer even while the question is on show', () => {
    // The old pair of entries could not be checked against each other at all.
    expect(render('in 00\nH 1\nCNOT 1 -> 2\nanswer out 00|11').check!.ok).toBe(true)
    expect(render('in 00\nH 1\nCNOT 1 -> 2\nanswer out 00|01').check!.ok).toBe(false)
  })

  it('checks the same whether the answer is shown or hidden', () => {
    const src = 'in 001\nSWAP 2 3\nanswer 010\nCNOT 2 -> 1; X 3\nout 111'
    expect(render(src).check).toEqual(render(src, { answers: true }).check)
  })

  it('says whether there is an answer to show', () => {
    expect(render('in 00\nH 1\nanswer out 0|1').hasAnswer).toBe(true)
    expect(render('in 00\nH 1\nout 0|1').hasAnswer).toBeUndefined()
    expect(render('answer 0|1').hasAnswer).toBe(true)
  })

  it('draws in every theme, both ways', () => {
    const src = 'in 001\nSWAP 2 3\nanswer 010\nCNOT 2 -> 1; X 3\nanswer 111'
    for (const theme of ['solid', 'flat', 'isometric'] as const) {
      for (const answers of [false, true]) {
        expect(render(src, { theme, answers }).svg, `${theme} ${answers}`).not.toContain('NaN')
      }
    }
  })
})
