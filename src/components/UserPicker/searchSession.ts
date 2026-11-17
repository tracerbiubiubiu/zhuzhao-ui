import { reactive } from 'vue'
import type { PersonOption } from '@/api/ticket/people'

export type PeopleStatus = 'input' | 'context' | 'loading' | 'ready' | 'empty' | 'forbidden' | 'missing' | 'error'

/** Owns request state independently of the lifetime of a remote select dropdown. */
export function createPeopleSearch(load: (term: string) => Promise<PersonOption[]>) {
  const state = reactive({ options: [] as PersonOption[], status: 'input' as PeopleStatus, loading: false })
  let generation = 0
  let contextReady = true
  function reset(ready = true) { generation++; contextReady = ready; state.options = []; state.status = ready ? 'input' : 'context'; state.loading = false }
  async function search(raw: string) {
    const mine = ++generation
    const term = raw.trim()
    state.options = []
    if (!contextReady || [...term].length < 2 || [...term].length > 50) { state.status = contextReady ? 'input' : 'context'; state.loading = false; return }
    state.loading = true; state.status = 'loading'
    try { const options = await load(term); if (mine !== generation) return; state.options = options; state.status = options.length ? 'ready' : 'empty' }
    catch (error) { if (mine !== generation) return; const status = (error as { response?: { status?: number } })?.response?.status; state.status = status === 403 ? 'forbidden' : status === 404 ? 'missing' : 'error' }
    finally { if (mine === generation) state.loading = false }
  }
  return { state, search, reset }
}
