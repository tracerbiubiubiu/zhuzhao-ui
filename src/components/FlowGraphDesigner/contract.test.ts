import { describe, expect, it } from 'vitest'
import { fromTicketGraph, validateTicketTypeContract } from './contract'
import { toGraph } from './mapper'
import { DEFAULT_STATES, DEFAULT_TRANSITIONS } from './types'

describe('ticket type reserved-state contract', () => {
  it.each(['open', 'assigned', 'closed'])('JSON cannot save without %s', (missing) => {
    const states = ['open', 'assigned', 'closed'].filter((s) => s !== missing)
    expect(validateTicketTypeContract(states, {})).toContain(`states 必须保留内置状态 "${missing}"（建票、分派及关闭所需）`)
  })
  it.each(['open', 'assigned', 'closed'])('deleted canvas %s is an explicit error, not an advisory warning', (missing) => {
    const graph = toGraph(['open', 'assigned', 'closed'].filter((s) => s !== missing), {})
    const result = fromTicketGraph(graph)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((error) => error.message.includes(`"${missing}"`))).toBe(true)
  })
  it.each(['', ' ', ' open', 'closed '])('JSON blank or padded name is blocked: %j', (state) => {
    expect(validateTicketTypeContract(['open', 'assigned', 'closed', state], {})).toContain('states 不可包含空白状态')
  })
  it('duplicate JSON states cannot silently collapse', () => { expect(validateTicketTypeContract(['open', 'assigned', 'closed', 'open'], {})).toContain('states 包含重复状态 "open"') })
  it('custom states and edges survive unchanged', () => {
    const states = ['open', 'assigned', 'closed', 'security_review']
    const transitions = { open: ['assigned', 'security_review'], assigned: ['closed'], security_review: ['closed'], closed: ['open'] }
    expect(validateTicketTypeContract(states, transitions)).toEqual([])
    const result = fromTicketGraph(toGraph(states, transitions))
    expect(result).toEqual({ ok: true, states, transitions })
  })
  it('default graph and in-place repaired historical graph remain saveable', () => {
    expect(validateTicketTypeContract([...DEFAULT_STATES], structuredClone(DEFAULT_TRANSITIONS))).toEqual([])
    expect(validateTicketTypeContract(['open', 'legacy_review'], { open: ['legacy_review'] }).length).toBeGreaterThan(0)
    expect(validateTicketTypeContract(['open', 'legacy_review', 'assigned', 'closed'], { open: ['legacy_review'], legacy_review: ['closed'] })).toEqual([])
  })
})
