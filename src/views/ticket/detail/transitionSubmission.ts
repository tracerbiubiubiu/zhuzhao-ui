import { reactive } from 'vue'
import { apiErrorBody } from '@/utils/apiError'
import type { TransitionInstanceInput } from '@/api/ticket/instanceActions'

type Phase = 'idle' | 'rejected' | 'refresh' | 'unknown'

interface Dependencies<T> {
  newKey: () => string
  send: (input: T, operationId: string) => Promise<void>
}

interface Attempt<T> {
  body: T
  key: string
}

function failurePhase(error: unknown): Exclude<Phase, 'idle'> {
  const { response } = (error ?? {}) as {
    response?: { status?: number; data?: { code?: unknown; reason?: unknown; data?: { reason?: unknown } } }
  }
  const code = response?.data?.code
  if (typeof code !== 'number' || code === 0) return 'unknown'
  const reason = response?.data?.data?.reason ?? response?.data?.reason
  if (reason === 'operation_in_progress' || reason === 'idempotency_conflict') return 'unknown'
  if ([401, 403, 404, 409].includes(response?.status ?? 0)) return 'refresh'
  if ([400, 422, 429].includes(response?.status ?? 0)) return 'rejected'
  return 'unknown'
}

/** 在结果未知时保留首次操作的完整载荷和标识，后续输入不能改写该操作。 */
export function createTransitionSubmission<T = TransitionInstanceInput>(deps: Dependencies<T>) {
  const state = reactive({ phase: 'idle' as Phase, busy: false, message: '' })
  let pending: Attempt<T> | undefined

  async function run(attempt: Attempt<T>, replay: boolean): Promise<boolean> {
    pending = attempt
    state.busy = true
    state.message = ''
    try {
      await deps.send(attempt.body, attempt.key)
      if (pending !== attempt) return false
      state.phase = 'idle'
      return true
    } catch (error) {
      if (pending !== attempt) return false
      const outcome = failurePhase(error)
      const message = apiErrorBody(error).message
      // 重放被当前权限拒绝时，原请求的提交结果仍未知。
      state.phase = replay ? 'unknown' : outcome
      if (state.phase === 'unknown') {
        state.message = [message, '原提交结果待确认，请用原操作重试。'].filter(Boolean).join('。')
      } else if (state.phase === 'refresh') {
        state.message = [message, '请刷新工单并重新确认当前可用动作。'].filter(Boolean).join('。')
      } else {
        state.message = message || '提交被拒绝，请检查必填内容和附件后重试。'
      }
      return false
    } finally {
      if (pending === attempt) {
        state.busy = false
        if (state.phase !== 'unknown') pending = undefined
      }
    }
  }

  function submit(body: T): Promise<boolean> {
    if (state.busy || state.phase === 'unknown' || state.phase === 'refresh') return Promise.resolve(false)
    try {
      const snapshot = JSON.parse(JSON.stringify(body)) as T
      return run({ body: snapshot, key: deps.newKey() }, false)
    } catch {
      state.phase = 'rejected'
      state.message = '无法准备本次提交，请检查输入后重试。'
      return Promise.resolve(false)
    }
  }

  function retry(): Promise<boolean> {
    if (state.busy || state.phase !== 'unknown' || !pending) return Promise.resolve(false)
    return run(pending, true)
  }

  function reset() {
    pending = undefined
    Object.assign(state, { phase: 'idle', busy: false, message: '' })
  }

  return { state, submit, retry, reset }
}
