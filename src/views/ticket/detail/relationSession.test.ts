import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TicketRelationCandidate } from '@/api/ticket'
import { createRelationSession } from './relationSession'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function candidate(id: string): TicketRelationCandidate {
  return { id, title: `Ticket ${id}`, status: 'open' }
}

afterEach(() => { vi.useRealTimers() })

describe('ticket relation picker', () => {
  it('keeps the current results and errors when older searches settle', async () => {
    vi.useFakeTimers()
    const stale = deferred<TicketRelationCandidate[]>()
    const current = deferred<TicketRelationCandidate[]>()
    const lookup = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)
    const session = createRelationSession({
      source: () => '1', active: () => true, lookup,
      save: vi.fn(), refresh: vi.fn(), saved: vi.fn(),
    })
    session.search('old')
    await vi.advanceTimersByTimeAsync(300)
    session.search('new')
    await vi.advanceTimersByTimeAsync(300)
    expect(lookup.mock.calls).toEqual([['1', 'old'], ['1', 'new']])
    current.resolve([candidate('9223372036854775807')])
    await vi.advanceTimersByTimeAsync(0)
    stale.reject(new Error('old failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(session.state.options).toEqual([candidate('9223372036854775807')])
    expect(session.state.searchError).toBe('')
    expect(session.state.searching).toBe(false)
    session.clear()
    expect(session.state.options).toEqual([])
  })

  it('invalidates the old target before searching and retries without retyping', async () => {
    vi.useFakeTimers()
    const lookup = vi.fn()
      .mockResolvedValueOnce([candidate('2')])
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([candidate('3')])
    const session = createRelationSession({
      source: () => '1', active: () => true, lookup,
      save: vi.fn(), refresh: vi.fn(), saved: vi.fn(),
    })
    session.search('first')
    await vi.advanceTimersByTimeAsync(300)
    session.choose('2')
    expect(session.state.target).toBe('2')
    session.search('second')
    session.choose('2')
    expect(session.state.target).toBe('')
    await vi.advanceTimersByTimeAsync(300)
    expect(session.state.searchError).toContain('关联候选加载失败')
    session.retry()
    session.search('') // opening the select also produces an empty callback
    await vi.advanceTimersByTimeAsync(300)
    expect(lookup).toHaveBeenLastCalledWith('1', 'second')
    expect(session.state.options).toEqual([candidate('3')])
  })

  it('refreshes the submitted pair and preserves the newly opened form', async () => {
    let source = '1'
    const pending = deferred<void>()
    const save = vi.fn().mockReturnValue(pending.promise)
    const refresh = vi.fn()
    const saved = vi.fn()
    const session = createRelationSession({
      source: () => source, active: () => true, lookup: vi.fn(),
      save, refresh, saved,
    })
    session.state.target = '2'
    const first = session.submit()
    await session.submit()
    expect(save.mock.calls).toEqual([['1', '2']])
    source = '3'
    session.reset()
    session.state.target = '4'
    pending.resolve()
    await first
    expect(refresh.mock.calls).toEqual([['1', '2']])
    expect(saved).not.toHaveBeenCalled()
    expect(session.state.target).toBe('4')
    expect(session.state.saving).toBe(false)
  })

  it('retains the selected target on rejection and distinguishes readback failure', async () => {
    const save = vi.fn().mockRejectedValueOnce({ response: { status: 403, data: { message: 'write denied' } } }).mockResolvedValueOnce(undefined)
    const refresh = vi.fn().mockRejectedValue(new Error('read unavailable'))
    const session = createRelationSession({
      source: () => '1', active: () => true, lookup: vi.fn(),
      save, refresh, saved: vi.fn(),
    })
    session.state.target = '2'
    await session.submit()
    expect(session.state.target).toBe('2')
    expect(session.state.saveError).toContain('write denied')
    expect(refresh).not.toHaveBeenCalled()
    await session.submit()
    expect(session.state.target).toBe('')
    expect(session.state.saveError).toContain('关联已保存')
  })
})
