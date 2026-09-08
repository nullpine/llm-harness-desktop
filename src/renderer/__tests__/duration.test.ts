/**
 * Load estimates are data, not copy — `estimatedLoadSeconds` comes from the
 * server's catalog, which measures it on the hardware in use. These tests pin
 * the two edges where the number stops being an ordinary duration.
 *
 * The one that matters is zero. On `remote_openai` the weights are already
 * resident in whatever is serving, so the catalog honestly says the switch takes
 * no time. Rendering that through `describeSeconds` produced "about an unknown
 * time" for something instantaneous, which reads as a fault rather than as good
 * news.
 */

import { describe, expect, it } from 'vitest'

import { describeSeconds, elapsedClock, loadsInstantly } from '../lib/duration'

describe('a switch that loads nothing', () => {
  it('is recognised, so the dialog can say so plainly', () => {
    expect(loadsInstantly(0)).toBe(true)
  })

  it('is not confused with a real wait', () => {
    expect(loadsInstantly(35)).toBe(false)
  })

  it('is not claimed for a number that is missing or nonsense', () => {
    // `harnessClient` coerces an absent field to 0, but a negative or NaN
    // estimate is a broken catalog, not a resident model. Promising "instant"
    // there would be inventing good news.
    expect(loadsInstantly(Number.NaN)).toBe(false)
    expect(loadsInstantly(-1)).toBe(false)
    expect(loadsInstantly(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('describeSeconds', () => {
  it('reads as a duration a person would say', () => {
    expect(describeSeconds(35)).toBe('35 seconds')
    expect(describeSeconds(60)).toBe('a minute')
    expect(describeSeconds(120)).toBe('2 minutes')
    expect(describeSeconds(90)).toBe('1m 30s')
    expect(describeSeconds(200)).toBe('3 minutes')
  })

  it('admits ignorance rather than inventing a number', () => {
    expect(describeSeconds(0)).toBe('an unknown time')
    expect(describeSeconds(-5)).toBe('an unknown time')
    expect(describeSeconds(Number.NaN)).toBe('an unknown time')
  })
})

describe('elapsedClock', () => {
  it('counts up in mm:ss', () => {
    expect(elapsedClock(0)).toBe('0:00')
    expect(elapsedClock(7_000)).toBe('0:07')
    expect(elapsedClock(75_000)).toBe('1:15')
  })

  it('never runs backwards', () => {
    expect(elapsedClock(-1_000)).toBe('0:00')
  })
})
