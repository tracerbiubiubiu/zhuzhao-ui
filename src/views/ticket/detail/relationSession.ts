import { reactive } from 'vue'
import type { TicketRelationCandidate } from '@/api/ticket'
import { apiErrorMessage, apiReadError } from '@/utils/apiError'

interface RelationSessionPorts {
  source: () => string
  active: () => boolean
  lookup: (source: string, keyword: string) => Promise<TicketRelationCandidate[]>
  save: (source: string, target: string) => Promise<void>
  refresh: (source: string, target: string) => Promise<unknown>
  saved: (target: string) => void
}

export function createRelationSession(ports: RelationSessionPorts) {
  const state = reactive({
    target: '', options: [] as TicketRelationCandidate[],
    searching: false, searchError: '', searched: false,
    saving: false, saveError: '',
  })
  let formGeneration = 0
  let searchGeneration = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let keyword = ''

  function current(source: string, generation: number) {
    return ports.active() && source === ports.source() && generation === formGeneration
  }

  function search(value: string, retry = false) {
    const term = value.trim()
    // Opening the select emits an empty query. Keep the last accepted
    // search so a failed query can be retried without typing it again.
    if (!term || (!retry && term === keyword)) return
    clear()
    keyword = term
    const source = ports.source()
    const generation = formGeneration
    const request = ++searchGeneration
    state.searching = ports.active()
    if (!state.searching) return

    const currentSearch = () => request === searchGeneration && current(source, generation)
    timer = setTimeout(async () => {
      try {
        const options = await ports.lookup(source, term)
        if (currentSearch()) {
          state.options = options
          state.searched = true
        }
      } catch (error) {
        if (currentSearch()) state.searchError = apiReadError(error, '关联候选加载失败，请重试', '当前工单不可用')
      } finally {
        if (currentSearch()) state.searching = false
      }
    }, 300)
  }

  function clear() {
    clearTimeout(timer)
    searchGeneration++
    state.target = ''
    state.options = []
    state.searching = false
    state.searched = false
    state.searchError = ''
    keyword = ''
  }

  function choose(value: unknown) {
    state.target = state.options.some(item => item.id === value) ? String(value) : ''
    state.saveError = ''
  }

  function reset() {
    formGeneration++
    clear()
    state.saving = false
    state.saveError = ''
  }

  async function submit() {
    if (state.saving || !ports.active()) return
    const source = ports.source()
    const target = state.target
    const generation = formGeneration
    if (!target || target === source) {
      state.saveError = target ? '不能关联自身' : '请先搜索并选择对方工单'
      return
    }

    state.saving = true
    state.saveError = ''
    try {
      await ports.save(source, target)
    } catch (error) {
      if (current(source, generation)) {
        state.saveError = apiErrorMessage(error, '建立关联失败，请重试')
        state.saving = false
      }
      return
    }
    if (current(source, generation)) {
      if (state.target === target) state.target = ''
      ports.saved(target)
    }
    try {
      await ports.refresh(source, target)
    } catch {
      if (current(source, generation)) state.saveError = '关联已保存，关系列表读取失败，请重试读取'
    } finally {
      if (current(source, generation)) state.saving = false
    }
  }

  return { state, search, clear, choose, retry: () => search(keyword, true), reset, submit }
}
