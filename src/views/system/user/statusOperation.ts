import { reactive } from 'vue'
import { isDefiniteSecurityRejection } from '@/common/auth/securityOutcome'
import type { UserStatusResult } from '@/api/system/user'

export type StatusPhase = 'unknown' | 'submitted' | 'pending' | 'completed' | 'superseded' | 'rejected'
interface StatusOperation { operationId: string; userId: string; status: 0 | 1 | null; phase: StatusPhase }
interface Dependencies {
  principalId: string
  storage: Pick<Storage, 'getItem' | 'setItem'>
  generation: () => number
  hasPermission: () => boolean
  newKey: () => string
  write: (userId: string, status: 0 | 1, key: string) => Promise<null>
  read: (key: string) => Promise<UserStatusResult>
}
/** 每个管理员标签页只保留一个未收敛的安全写；原K不因超时或重新打开页面而更换。 */
export function createStatusOperation(deps: Dependencies) {
  const state = reactive({ operation: null as StatusOperation | null, result: null as UserStatusResult | null, busy: false, error: '' })
  const generation = deps.generation()
  const storageKey = `zhuzhao_status_operation:${deps.principalId}`
  let storageFailed = false
  const current = () => generation === deps.generation()
  const unresolved = () => !!state.operation && !['completed', 'superseded', 'rejected'].includes(state.operation.phase)
  const blocked = () => !current() || !deps.principalId || state.busy || storageFailed || unresolved()
  try {
    const raw = deps.storage.getItem(storageKey)
    if (raw) {
      const saved = JSON.parse(raw) as StatusOperation
      if (!saved || typeof saved.operationId !== 'string' || !saved.operationId || typeof saved.userId !== 'string'
        || (saved.status !== null && ![0, 1].includes(saved.status))
        || !['unknown', 'submitted', 'pending', 'completed', 'superseded', 'rejected'].includes(saved.phase)) throw new Error('invalid')
      state.operation = saved
    }
  } catch {
    storageFailed = true
    state.error = '无法读取原操作号，暂停安全写；请用已保留的操作号核查或联系受权管理员'
  }
  function persist() {
    deps.storage.setItem(storageKey, JSON.stringify(state.operation))
  }
  async function submit(userId: string, status: 0 | 1) {
    if (blocked() || !deps.hasPermission()) return
    state.error = ''
    state.result = null
    try {
      state.operation = { operationId: deps.newKey(), userId, status, phase: 'unknown' }
      persist() // 必须先保存K；保存失败时不允许发出安全写。
    } catch {
      storageFailed = true
      state.error = '无法保存原操作号，未发送本次安全写；请检查浏览器存储'
      return
    }
    const operation = state.operation!
    state.busy = true
    try {
      await deps.write(userId, status, operation.operationId)
      if (!current()) return
      operation.phase = 'submitted' // 旧成功null未包含投影事实，仍需GET确认。
    } catch (error) {
      if (!current()) return
      operation.phase = isDefiniteSecurityRejection(error) ? 'rejected' : 'unknown'
    } finally {
      if (current()) {
        state.busy = false
        try { persist() } catch { state.error = '结果未能保存，请保留原操作号继续核查' }
      }
    }
  }
  async function query(key: string) {
    if (!current() || state.busy || !deps.hasPermission()) return
    key = key.trim()
    if (!key || (unresolved() && key !== state.operation?.operationId)) {
      state.error = '请先核查当前保留的原操作号'
      return
    }
    state.busy = true
    state.error = ''
    try {
      // 查到真实回执才采用手工键。已经发出的未决操作仍只允许查询原键。
      const result = await deps.read(key)
      if (!current()) return
      if (!deps.hasPermission()) {
        state.error = '当前已无权查看原结果，请由受权管理员继续核查'
        return
      }
      const previous = state.operation
      if (result.operation_id !== key || (previous?.operationId === key && previous.status !== null && previous.status !== result.status)) throw new Error('操作回执与原请求不匹配')
      state.result = result
      state.operation = {
        operationId: key, userId: previous?.operationId === key ? previous.userId : '',
        status: result.status, phase: result.projection_state,
      }
      persist()
      storageFailed = false
    } catch {
      if (current()) state.error = '未能核实原结果（可能无权、暂未查到或服务不可用），请保留原操作号继续核查；不要重新启停'
    } finally {
      if (current()) state.busy = false
    }
  }
  return { state, blocked, submit, query }
}
