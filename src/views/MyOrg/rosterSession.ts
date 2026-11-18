import { computed, reactive, shallowReactive } from 'vue'
import { getSessionGeneration } from '@/common/auth/tokenStorage'
import { assignmentId } from '@/api/system/assignmentPayload'
import type { OrgMemberRosterItem, OrgMemberRosterResponse } from '@/api/org/selfService'
import { apiErrorMessage } from '@/utils/apiError'

type Status = 'idle' | 'loading' | 'ready' | 'readonly' | 'error'

interface RosterDeps {
  load: (orgId: string, page: number, pageSize: number) => Promise<OrgMemberRosterResponse>
  success: (message: string) => void
  failure: (message: string) => void
}

interface WriteTarget {
  orgId: string
  userId: string
  username: string
  current: () => boolean
  send: (mutation: () => Promise<void>) => Promise<void>
}

const pageSize = 20

/** 名册来源为组织+页码+世代。已提交的写操作按组织串行，切换组织不阻塞另一组织。 */
export function createRosterSession(deps: RosterDeps) {
  const state = reactive({
    orgId: '', page: 1, total: 0, rows: [] as OrgMemberRosterItem[],
    status: 'idle' as Status, error: '',
  })
  const writes = shallowReactive(new Map<string, { request?: Promise<void> }>())
  let generation = 0
  let active = true
  const canEdit = computed(() => state.status === 'ready' && !writes.has(state.orgId))

  async function load() {
    if (!active || !state.orgId) return
    const { orgId, page } = state
    const mine = ++generation
    const session = getSessionGeneration()
    const current = () => mine === generation && session === getSessionGeneration()
    Object.assign(state, { rows: [], status: 'loading', error: '' })
    try {
      // 快速返回同一组织时，当前名册应读取已发写入之后的状态。
      const pending = writes.get(orgId)?.request
      if (pending) await pending.catch(() => undefined)
      if (!current()) return
      const response = await deps.load(orgId, page, pageSize)
      if (!current()) return
      if (!Array.isArray(response?.list) || typeof response.total !== 'number'
        || !Number.isSafeInteger(response.total) || response.total < response.list.length) {
        throw new Error('名册响应不完整')
      }
      Object.assign(state, { rows: response.list, total: response.total, status: 'ready' })
    } catch (error) {
      if (!current()) return
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status === 403) {
        Object.assign(state, { total: 0, status: 'readonly' })
      } else {
        Object.assign(state, { status: 'error', error: apiErrorMessage(error, '成员名册加载失败，请重试') })
      }
    }
  }

  function selectOrg(orgId: string) {
    if (!orgId || orgId === state.orgId) return
    Object.assign(state, { orgId, page: 1, total: 0 })
    return load()
  }

  function selectPage(page: number) {
    if (page === state.page) return
    state.page = page
    return load()
  }

  function pause() {
    active = false
    ++generation
    Object.assign(state, { rows: [], status: 'idle', error: '' })
  }

  function resume() {
    if (active) return
    active = true
    return load()
  }

  async function write(row: OrgMemberRosterItem, action: (target: WriteTarget) => Promise<string | void>) {
    if (!canEdit.value || !state.rows.includes(row)) return
    const { orgId } = state
    const mine = generation
    const session = getSessionGeneration()
    const current = () => mine === generation && session === getSessionGeneration()
    const operation: { request?: Promise<void> } = {}
    writes.set(orgId, operation)
    try {
      const message = await action({
        orgId,
        userId: assignmentId(row.user_id),
        username: row.username ?? '',
        current,
        async send(mutation) {
          if (!current()) return
          operation.request = mutation()
          await operation.request
        },
      })
      if (current() && operation.request && message) deps.success(message)
    } catch (error) {
      if (current()) deps.failure(apiErrorMessage(error, error instanceof Error ? error.message : '操作失败，请稍后重试'))
    } finally {
      writes.delete(orgId)
      if (current() && operation.request) await load()
    }
  }

  return { state, pageSize, canEdit, selectOrg, selectPage, load, pause, resume, write }
}

/** 整体替换前确认预取确实包含该组织的全部负责人，且目标仍是该组织成员。 */
export function ownersWithMember(response: OrgMemberRosterResponse, targetId: string): string[] {
  const { list, total } = response
  if (typeof total === 'number' && total > 100) {
    throw new Error('组织成员超过 100：请联系全局管理员设置负责人')
  }
  if (!Array.isArray(list) || total !== list.length) throw new Error('未能读取完整负责人名册，请重试')
  const seen = new Set<string>()
  const owners = new Set<string>()
  for (const row of list) {
    const id = assignmentId(row.user_id)
    if (seen.has(id)) throw new Error('负责人名册包含重复成员，请重试')
    seen.add(id)
    if (row.org_member_role === 'owner') owners.add(id)
    else if (row.org_member_role !== 'admin' && row.org_member_role !== 'member') {
      throw new Error('未能确认成员角色，请重试')
    }
  }
  if (!seen.has(targetId)) throw new Error('该成员已不在当前组织，请重新读取名册')
  owners.add(targetId)
  return [...owners]
}
