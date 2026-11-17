import { fromGraph, validateTypeGraph } from './mapper'
import type { FromGraphResult, RawGraphData } from './types'

/** Mirror the ticket-type write contract without restricting generic diagram mappers. */
export function validateTicketTypeContract(states: unknown, transitions: unknown): string[] {
  const errors = validateTypeGraph(states, transitions)
  if (!Array.isArray(states) || states.some((state) => typeof state !== 'string')) return errors
  const seen = new Set<string>()
  for (const state of states as string[]) {
    if (!state.trim() || state !== state.trim()) errors.push('states 不可包含空白状态')
    if (seen.has(state)) errors.push(`states 包含重复状态 ${JSON.stringify(state)}`)
    seen.add(state)
  }
  for (const required of ['open', 'assigned', 'closed']) {
    if (!seen.has(required)) errors.push(`states 必须保留内置状态 "${required}"（建票、分派及关闭所需）`)
  }
  return [...new Set(errors)]
}

/** Canvas save and visible errors share the same concrete ticket-type contract. */
export function fromTicketGraph(graph: RawGraphData): FromGraphResult {
  const result = fromGraph(graph)
  if (!result.ok) return result
  const errors = validateTicketTypeContract(result.states, result.transitions)
  return errors.length ? { ok: false, errors: errors.map((message) => ({ code: 'invalid_contract', message })) } : result
}
