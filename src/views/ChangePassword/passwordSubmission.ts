import { reactive } from 'vue'
import { ACCOUNT_DISABLED, TOKEN_INVALID } from '@/common/constants/errorBehavior'
import { isDefiniteSecurityRejection } from '@/common/auth/securityOutcome'
interface Dependencies {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  scope?: string
  generation: () => number
  newKey: () => string
  change: (oldPassword: string, newPassword: string, key: string) => Promise<void>
}
type Phase = 'idle' | 'unknown' | 'rejected' | 'terminal' | 'completed'
/** 自助已提交的专用结果 wire 尚待冻结；普通503只能归未知，不能宣称密码已变。 */
export function createPasswordSubmission(deps: Dependencies) {
  const state = reactive({ operationId: '', phase: 'idle' as Phase, busy: false, message: '' })
  const generation = deps.generation()
  const current = () => generation === deps.generation()
  const storageKey = `zhuzhao_password_operation:${deps.scope ?? 'current'}`
  const unknownMessage = '修改密码结果待核查，请保留原操作号，不要重复提交。可在服务恢复后尝试用本次新密码重新登录核查，或联系受权管理员；登录失败本身不证明原改密未提交。'
  let storageFailed = false
  try {
    const raw = deps.storage.getItem(storageKey)
    if (raw) {
      const saved = JSON.parse(raw) as { operationId?: unknown; phase?: unknown }
      if (typeof saved.operationId !== 'string' || !saved.operationId || !['unknown', 'rejected', 'terminal', 'completed'].includes(String(saved.phase))) throw new Error('invalid')
      if (saved.phase === 'unknown' || saved.phase === 'terminal') {
        state.operationId = saved.operationId
        state.phase = saved.phase
        state.message = saved.phase === 'unknown' ? unknownMessage : '原会话已失效，请重新登录核查原操作。'
      }
    }
  } catch {
    storageFailed = true
    state.message = '无法读取原改密操作号，请联系受权管理员核查，暂停重复提交'
  }
  function persist() {
    // 禁止存口令、TokenPair或可枚举口令hash。
    deps.storage.setItem(storageKey, JSON.stringify({ operationId: state.operationId, phase: state.phase }))
  }
  const blocked = () => !current() || storageFailed || state.busy || !['idle', 'rejected'].includes(state.phase)
  async function submit(oldPassword: string, newPassword: string): Promise<boolean> {
    if (blocked()) return false
    try {
      state.operationId = deps.newKey()
      state.phase = 'unknown'
      persist()
    } catch {
      storageFailed = true
      state.message = '无法保存原操作号，未发送本次改密，请检查浏览器存储'
      return false
    }
    state.busy = true
    state.message = ''
    try {
      await deps.change(oldPassword, newPassword, state.operationId)
      if (!current()) return false
      state.phase = 'completed'
      return true
    } catch (error) {
      if (!current()) return false
      const e = error as { response?: { status?: number; data?: { code?: number; message?: string } }; __sessionTransient?: boolean }
      const terminal = !e.__sessionTransient && ((e.response?.status === 403 && e.response.data?.code === ACCOUNT_DISABLED)
        || (e.response?.status === 401 && e.response.data?.code === TOKEN_INVALID))
      state.phase = terminal ? 'terminal' : isDefiniteSecurityRejection(error) ? 'rejected' : 'unknown'
      state.message = terminal ? '当前会话已失效，请重新登录核查原操作。'
        : state.phase === 'rejected' ? e.response?.data?.message ?? '本次改密被明确拒绝，请核对输入及当前资格'
        : unknownMessage
      return false
    } finally {
      if (current()) {
        state.busy = false
        try { persist() } catch { state.message = '结果未能保存，请保留原操作号并核查，勿重复提交' }
      }
    }
  }
  return { state, blocked, submit }
}
