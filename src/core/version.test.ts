import { describe, expect, it } from 'vitest'
import { VERSION } from './version'
import pkg from '../../package.json'

describe('the version', () => {
  it('is what the manifest says', () => {
    // The library carries a literal because it must be importable without a
    // JSON loader of its own; this is what stops that literal from drifting
    // from the manifest. The test can import the JSON — it is not the library.
    expect(VERSION).toBe(pkg.version)
  })

  it('is a semantic version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  })
})
