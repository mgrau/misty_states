import { describe, expect, it } from 'vitest'
import { piLabel, readAngle } from './angle'

describe('an angle said in π', () => {
  it('names the marks the dial is labelled with', () => {
    expect([0, 45, 90, 135, 180, 225, 270, 315, 360].map(piLabel)).toEqual([
      '0', 'π/4', 'π/2', '3π/4', 'π', '5π/4', '3π/2', '7π/4', '2π',
    ])
  })

  it('writes π and 2π bare, since 1π reads as a mistake', () => {
    expect(piLabel(180)).toBe('π')
    expect(piLabel(360)).toBe('2π')
    expect(piLabel(-180)).toBe('-π')
  })

  it('reaches the thirds and sixths as well as the quarters', () => {
    expect(piLabel(30)).toBe('π/6')
    expect(piLabel(60)).toBe('π/3')
    expect(piLabel(120)).toBe('2π/3')
    expect(piLabel(150)).toBe('5π/6')
  })

  it('gives up on a fraction where one would be arithmetic rather than a label', () => {
    // 37° is not a twelfth of anything, and `37π/180` is not a label.
    expect(piLabel(37)).toBe('0.65 rad')
    expect(piLabel(1)).toBe('0.02 rad')
  })
})

describe('an angle as typed', () => {
  it('reads degrees, with or without the mark', () => {
    expect(['30', '22.5°', '-90', ' 45 deg ', '.5'].map(readAngle)).toEqual([30, 22.5, -90, 45, 0.5])
  })

  it('reads multiples of π, written either way', () => {
    expect(['π/4', '3π/2', '-pi/3', '2pi', 'π', '3*pi/4', 'PI / 2'].map(readAngle)).toEqual([
      45, 270, -60, 360, 180, 135, 90,
    ])
  })

  it('keeps a few places of an angle that is not a whole number of degrees', () => {
    expect(readAngle('3π/7')).toBe(77.1429)
  })

  it('turns down what is not an angle', () => {
    expect(['', 'abc', '45x', 'π/0', '1/2', '--3'].map(readAngle)).toEqual([
      null, null, null, null, null, null,
    ])
  })
})
