import { reactive } from 'vue'
import {
  readPublicationBaseline, type PublicationBaseline, type PublicationPlan,
  type PublicationReceipt, type PublicationTarget, type PublishDefinitionInput,
} from '@/api/ticket/definitionPublication'
import { apiErrorBody, apiErrorMessage } from '@/utils/apiError'

interface PendingPublication {
  generation: number
  target: PublicationTarget
  baseline: PublicationBaseline
  plan: PublicationPlan
  input: PublishDefinitionInput
  operationId: string
  saving: boolean
  uncertain: boolean
}

interface PublicationDependencies {
  allowed: () => boolean
  generation: () => number
  newKey: () => string
  plan: (baseline: PublicationBaseline) => Promise<PublicationPlan>
  publish: (input: PublishDefinitionInput, operationId: string) => Promise<PublicationReceipt>
  refresh: () => Promise<PublicationTarget[]>
  onPublished: (receipt: PublicationReceipt) => void
}

function responseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status
}

export function createDefinitionPublication(deps: PublicationDependencies) {
  const state = reactive({
    visible: false, planning: false, saving: false, warningsAccepted: false, uncertain: false, operationId: '',
    target: null as PublicationTarget | null, baseline: null as PublicationBaseline | null,
    plan: null as PublicationPlan | null, receipt: null as PublicationReceipt | null, error: '',
  })
  let view = 0
  let generation = deps.generation()
  const pending = new Map<string, PendingPublication>()

  function close() {
    view++
    Object.assign(state, {
      visible: false, planning: false, saving: false, warningsAccepted: false, uncertain: false, operationId: '',
      target: null, baseline: null, plan: null, receipt: null, error: '',
    })
  }

  const isCurrent = (token: number) => token === view && state.visible && generation === deps.generation()

  async function loadPreview(target: PublicationTarget, token: number) {
    state.baseline = readPublicationBaseline(target)
    if (!state.baseline) {
      state.error = '未能读取草稿修订和当前发布版本，请刷新后重试'
      return
    }
    const plan = await deps.plan(state.baseline)
    if (isCurrent(token) && deps.allowed()) state.plan = plan
  }

  async function preview(target: PublicationTarget) {
    const token = view
    state.planning = true
    try {
      const fresh = (await deps.refresh()).find(row => row.id === target.id && row.code === target.code)
      if (!isCurrent(token) || !deps.allowed()) return
      if (!fresh) {
        state.error = '工单类型已删除或替换，请返回列表核对'
        return
      }
      state.target = { ...fresh }
      await loadPreview(fresh, token)
    } catch (error) {
      if (isCurrent(token)) state.error = responseStatus(error) === 409
        ? '草稿或发布版本已变化，请刷新后重新预览'
        : apiErrorMessage(error, '发布预览加载失败，请刷新后重试')
    } finally {
      if (isCurrent(token)) state.planning = false
    }
  }

  async function open(target: PublicationTarget) {
    if (!deps.allowed()) return
    close()
    if (generation !== deps.generation()) pending.clear()
    generation = deps.generation()
    state.visible = true
    const previous = pending.get(target.code)
    if (previous) {
      Object.assign(state, {
        target: previous.target, baseline: previous.baseline, plan: previous.plan,
        uncertain: true, saving: previous.saving, operationId: previous.operationId,
        error: '发布结果待核实，请使用原操作号重试',
      })
      return
    }
    state.target = { ...target }
    await preview(target)
  }

  async function refresh() {
    if (!isCurrent(view) || !deps.allowed() || !state.target || state.planning || state.saving || state.uncertain) return
    Object.assign(state, { baseline: null, plan: null, receipt: null, warningsAccepted: false, error: '' })
    await preview(state.target)
  }

  const canSubmit = () => isCurrent(view) && deps.allowed() && !!state.plan && !!state.baseline
    && !state.saving && !state.planning && !state.receipt && !state.plan.errors.length
    && (state.uncertain || !state.plan.warnings.length || state.warningsAccepted)

  async function submit() {
    if (!canSubmit() || !state.target || !state.baseline || !state.plan) return
    const { target, baseline, plan } = state
    const acknowledged = plan.warnings.flatMap(warning => warning.id ? [warning.id] : [])
    let operation = pending.get(target.code)
    if (!operation) {
      operation = {
        generation, target, baseline, plan, operationId: deps.newKey(), saving: false, uncertain: false,
        input: { ...baseline, plan_id: plan.plan_id, plan_hash: plan.plan_hash,
          ...(acknowledged.length ? { acknowledged_warning_ids: acknowledged } : {}) },
      }
      pending.set(target.code, operation)
    }
    if (operation.saving) return
    operation.saving = state.saving = true
    state.operationId = operation.operationId
    state.error = ''
    const showsOperation = () => isCurrent(view) && state.operationId === operation.operationId
      && operation.generation === generation
    try {
      const receipt = await deps.publish(operation.input, operation.operationId)
      if (operation.generation !== deps.generation()) return
      pending.delete(target.code)
      if (showsOperation()) {
        state.receipt = receipt
        state.uncertain = false
      }
      deps.onPublished(receipt)
    } catch (error) {
      if (operation.generation !== deps.generation()) return
      const status = responseStatus(error)
      const conflict = status === 409 && apiErrorBody(error).code === 10006
      // 重试的拒绝只能说明本次未通过，不能消除原请求可能已经提交的事实。
      const rejected = conflict || (!operation.uncertain && (status === 400 || status === 403 || status === 422))
      if (rejected) pending.delete(target.code)
      else operation.uncertain = true
      if (!showsOperation()) return
      if (rejected) {
        state.plan = null
        state.uncertain = false
        state.error = conflict ? '草稿或发布版本已变化，请刷新后重新预览' : apiErrorMessage(error, '发布被拒绝，请刷新后核对配置或权限')
      } else {
        state.uncertain = true
        state.error = `${apiErrorMessage(error, '发布结果暂未核实')}，请使用原操作号重试`
      }
    } finally {
      operation.saving = false
      if (showsOperation()) state.saving = false
    }
  }

  return { state, open, close, refresh, canSubmit, submit }
}
