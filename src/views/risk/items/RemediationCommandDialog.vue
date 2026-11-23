<script setup lang="ts">
import { computed, onActivated, onDeactivated, onScopeDispose, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElInput, ElOption, ElRadio, ElRadioGroup, ElSelect } from 'element-plus'
import UserPicker from '@/components/UserPicker/index.vue'
import {
  acceptRemediationAssignmentApi, assignRemediationHandlerApi, decideRemediationAcceptanceApi,
  newRemediationCommandId, requestRemediationAcceptanceApi, validateRemediationCommandOutcome,
  type AssignRemediationHandlerInput, type DecideRemediationAcceptanceInput,
  type RemediationCommandCommon, type RemediationCommandContext, type RemediationCommandOutcome,
  type RemediationCommandPermissions, type RequestRemediationAcceptanceInput,
} from '@/api/risk/remediationCommands'
import { getSessionGeneration } from '@/common/auth/tokenStorage'
import { apiErrorMessage } from '@/utils/apiError'
import type { InstanceAction } from '@/api/ticket/instanceActions'
import TransitionActionDialog from '@/views/ticket/detail/TransitionActionDialog.vue'
import type { TransitionActionInput } from '@/views/ticket/detail/transitionActionFields'

// 保持本组件挂载以保留未知结果的原号；父层从共享 remediation GET 注入核查函数。
// 四个 permissions 分别来自 L1，不用 can_manage_risk/terminal_allowed 代替功能权限。
// 调用方按当前工单节点和现势策略展示动作，服务器在提交时再次核验。
const props = defineProps<{
  modelValue: boolean
  current: RemediationCommandContext | null
  permissions: RemediationCommandPermissions
  assignedTo?: string | null
  currentActorId: string
  canRead?: boolean
  /** 父层刷新工单、办理上下文及已发布动作；失败必须拒绝。 */
  refreshContext?: () => Promise<void>
  /** 直接复用共享 GET，回包在本组件按原 K/票号校验，不要求共享 DTO 强转。 */
  inspectOperation: (operationId: string) => Promise<unknown>
  ticketActions?: InstanceAction[]
  customDataPatch?: Record<string, unknown>
  comment?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  operation: [value: { operation_id: string; ticket_id: string; kind: CommandKind }]
  result: [value: RemediationCommandOutcome]
}>()
type CommandKind = 'assign' | 'accept-assignment' | 'request-acceptance' | 'decide-acceptance'
type CommandInput = RemediationCommandCommon | AssignRemediationHandlerInput | RequestRemediationAcceptanceInput | DecideRemediationAcceptanceInput
interface Attempt { kind: CommandKind; input: CommandInput; actorId: string }
interface RejectedAttempt { attempt: Attempt; message: string; result: RemediationCommandOutcome | null; error: string }
const assignedToUserId = ref('')
const selectedLinkId = ref('')
const reason = ref('')
const validUntil = ref('')
const decision = ref<'' | 'approve' | 'reject'>('')
const attempt = ref<Attempt | null>(null)
const result = ref<RemediationCommandOutcome | null>(null)
const rejection = ref('')
const rejectedAttempts = ref<RejectedAttempt[]>([])
const busy = ref(false)
const error = ref('')
const sessionInvalid = ref(false)
const receiptReadDenied = ref(false)
const form = ref<{ command: 'claim' | 'decision'; action: InstanceAction } | null>(null)
const live = ref(true)
const session = getSessionGeneration()
let epoch = 0
let disposed = false

function positiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807')
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return
  if (!value || typeof value !== 'object' || ancestors.has(value)
    || Object.getOwnPropertySymbols(value).length
    || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
    throw new Error('自定义字段必须为有效 JSON，不能静默删改原请求')
  }
  ancestors.add(value)
  if (Array.isArray(value) && (Object.keys(value).length !== value.length
    || Array.from({ length: value.length }, (_, i) => i).some(i => !Object.hasOwn(value, i)))) {
    throw new Error('自定义字段数组不完整')
  }
  Object.values(value).forEach(entry => assertJson(entry, ancestors))
  ancestors.delete(value)
}
const contextValid = computed(() => {
  const c = props.current
  return !!c && positiveDecimal(c.ticket_id) && positiveDecimal(c.ticket_revision)
    && positiveDecimal(c.definition_version) && typeof c.status === 'string' && !!c.status.trim()
    && Array.isArray(c.items) && Array.from(c.items).every(isObject)
    && new Set(c.items.map(item => item.link_id)).size === c.items.length
    && c.items.every(item => positiveDecimal(item.link_id) && positiveDecimal(item.risk_id)
      && positiveDecimal(item.risk_revision) && positiveDecimal(item.link_revision)
      && typeof item.is_risk_owner === 'boolean' && typeof item.can_manage_risk === 'boolean')
})
const active = computed(() => !disposed && live.value && props.modelValue && props.canRead !== false && !receiptReadDenied.value
  && session === getSessionGeneration() && !sessionInvalid.value && positiveDecimal(props.currentActorId))
const ready = computed(() => active.value && contextValid.value && props.current?.writes_enabled === true
  && !busy.value && !attempt.value && (props.customDataPatch === undefined || isObject(props.customDataPatch))
  && (props.comment === undefined || typeof props.comment === 'string'))
const selectedItem = computed(() => contextValid.value ? props.current?.items.find(item => item.link_id === selectedLinkId.value) : undefined)
const reasonValid = computed(() => !!reason.value.trim() && Array.from(reason.value).length <= 16000)
const requestTarget = computed(() => {
  const item = selectedItem.value
  return !!item && item.is_risk_owner === true && (['open', 'rejected', 'pending_verify'].includes(item.remediation_state)
    || (item.remediation_state === 'pending_acceptance' && item.pending_acceptance_recoverable === true))
    && !item.pending_acceptance_id && !item.pending_acceptance_revision
})
const decisionTarget = computed(() => {
  const item = selectedItem.value
  return !!item && item.can_manage_risk === true && item.is_risk_owner === false
    && item.remediation_state === 'pending_acceptance' && item.pending_acceptance_recoverable !== true
    && positiveDecimal(item.pending_acceptance_id) && positiveDecimal(item.pending_acceptance_revision)
})
const canAssign = computed(() => ready.value && props.permissions.canAssign === true && positiveDecimal(assignedToUserId.value))
const canAcceptAssignment = computed(() => ready.value && props.permissions.canAcceptAssignment === true && props.assignedTo === props.currentActorId)
const canRequestAcceptance = computed(() => ready.value && props.permissions.canRequestAcceptance === true
  && requestTarget.value && reasonValid.value && !!validUntil.value && Number.isFinite(Date.parse(validUntil.value)) && Date.parse(validUntil.value) > Date.now())
const canDecideAcceptance = computed(() => ready.value && props.permissions.canDecideAcceptance === true
  && decisionTarget.value && reasonValid.value && ['approve', 'reject'].includes(decision.value))
function isCurrentAttempt(original: Attempt) {
  return props.current?.ticket_id === original.input.ticket_id && props.currentActorId === original.actorId
}
// 原请求与 K 留给原账号恢复；读取失效或作用域变化时不继续展示缓存内容。
const canViewCurrent = computed(() => active.value && (!attempt.value || isCurrentAttempt(attempt.value)))
const visibleRejectedAttempts = computed(() => active.value ? rejectedAttempts.value.filter(record => isCurrentAttempt(record.attempt)) : [])
function canInspectAttempt(original: Attempt) {
  return active.value && !busy.value && isCurrentAttempt(original)
}
const canInspect = computed(() => !!attempt.value && !result.value && canInspectAttempt(attempt.value))
const canStartNext = computed(() => {
  const c = props.current, r = result.value
  const sent = attempt.value
  if (!active.value || busy.value || !contextValid.value || !sent || !c
    || c.ticket_id !== sent.input.ticket_id || props.currentActorId !== sent.actorId) return false
  if (rejection.value) return c.writes_enabled === true
  return !!r && (!!props.refreshContext || contextCoversResult(c, sent, r))
})
function contextCoversResult(c: RemediationCommandContext, sent: Attempt, r: RemediationCommandOutcome) {
  if (!decimalAtLeast(c.ticket_revision, r.ticket_revision)) return false
  if (c.ticket_revision !== sent.input.expected_ticket_revision) return true
  // A risk acceptance may only advance the selected risk and link.
  return (sent.kind === 'request-acceptance' || sent.kind === 'decide-acceptance')
    && r.items.length > 0 && r.items.every(item => c.items.some(current => current.link_id === item.link_id
      && decimalAtLeast(current.link_revision, item.link_revision) && decimalAtLeast(current.risk_revision, item.risk_revision)))
}

function decimalAtLeast(current: string, original: string) {
  return current.length > original.length || (current.length === original.length && current >= original)
}

watch([() => props.modelValue, () => props.current?.ticket_id, () => props.currentActorId, () => props.canRead], () => {
  epoch++
  // 关闭/换票只撤销旧响应回写资格，不丢弃已发写入的原号。
  if (!attempt.value) clearDraft()
}, { flush: 'sync' })
onActivated(() => { live.value = true; epoch++ })
onDeactivated(() => { live.value = false; epoch++ })
onScopeDispose(() => { disposed = true; epoch++ })
function checkSession(): boolean {
  if (session !== getSessionGeneration()) {
    sessionInvalid.value = true
    error.value = '会话已变化，请在原账号会话中核查已保留的操作号'
    return false
  }
  return !sessionInvalid.value
}
function clearDraft() {
  form.value = null
  assignedToUserId.value = ''; selectedLinkId.value = ''; reason.value = ''; validUntil.value = ''; decision.value = ''; error.value = ''
}
function commonInput(input?: TransitionActionInput): RemediationCommandCommon {
  const c = props.current!
  const patch = input?.custom_data_patch ?? props.customDataPatch
  const comment = input?.comment ?? props.comment
  // JSON 快照防止父层后续修改嵌套 patch，改变原请求语义。
  if (patch !== undefined) assertJson(patch)
  return JSON.parse(JSON.stringify({
    operation_id: newRemediationCommandId(), ticket_id: c.ticket_id,
    expected_ticket_revision: c.ticket_revision, definition_version: c.definition_version,
    ...(patch && Object.keys(patch).length ? { custom_data_patch: patch } : {}),
    ...(comment ? { comment } : {}),
  })) as RemediationCommandCommon
}
async function send<Input extends CommandInput>(kind: CommandKind, build: () => Input, post: (input: Input) => Promise<RemediationCommandOutcome>) {
  if (!checkSession() || !ready.value) return
  // 锁在首个 await 前取得，绝不自动重新 POST。
  busy.value = true; error.value = ''
  let original: Attempt
  try {
    original = { kind, input: build(), actorId: props.currentActorId }
    attempt.value = original
  } catch (err) {
    busy.value = false
    error.value = err instanceof Error ? err.message : '请求数据无效，请检查输入'
    return
  }
  const token = epoch
  emit('operation', { operation_id: original.input.operation_id, ticket_id: original.input.ticket_id, kind })
  try {
    const received = await post(original.input as Input)
    if (!checkSession() || disposed || token !== epoch || !active.value) return
    confirm(received, original)
  } catch (err) {
    if (checkSession() && active.value && token === epoch) {
      error.value = apiErrorMessage(err, err instanceof Error ? err.message : '提交未得到明确回执，请按原操作号查询结果')
      // 只采用本次 POST 的明确业务拒绝；GET 失败及传输/服务故障均不能证明未提交。
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status !== undefined && [400, 403, 409, 422].includes(status)) rejection.value = error.value
    }
  } finally {
    busy.value = false
  }
}
function confirm(received: unknown, original: Attempt) {
  const checked = validateRemediationCommandOutcome(received, original.input.operation_id, original.input.ticket_id)
  result.value = checked; error.value = ''; rejection.value = ''
  emit('result', checked) // 父层按回执 ticket_id 刷新；不能将终态许可当功能权限。
}
async function submitAssign() {
  if (!checkSession() || !canAssign.value) return
  await send('assign', () => ({ ...commonInput(), assigned_to_user_id: assignedToUserId.value }), assignRemediationHandlerApi)
}
async function submitAcceptAssignment() {
  if (!checkSession() || !canAcceptAssignment.value) return
  if (requestForm('claim', 'in_progress')) return
  await finishClaim()
}
async function finishClaim(input?: TransitionActionInput) {
  if (canAcceptAssignment.value) await send('accept-assignment', () => commonInput(input), acceptRemediationAssignmentApi)
}
async function submitRequestAcceptance() {
  if (!checkSession() || !canRequestAcceptance.value || Date.parse(validUntil.value) <= Date.now()) return
  const item = selectedItem.value!
  await send('request-acceptance', () => ({
    ...commonInput(), risk_id: item.risk_id, expected_risk_revision: item.risk_revision,
    link_id: item.link_id, expected_link_revision: item.link_revision,
    reason: reason.value, valid_until: new Date(validUntil.value).toISOString(),
  }), requestRemediationAcceptanceApi)
}
async function submitDecideAcceptance() {
  if (!checkSession() || !canDecideAcceptance.value) return
  const current = props.current!
  if (decision.value === 'reject' && current.status === 'pending_verify' && requestForm('decision', 'in_progress')) return
  if (decision.value === 'approve' && current.items.every(item => item.link_id === selectedLinkId.value || item.remediation_state === 'resolved')
    && requestForm('decision', 'closed')) return
  await finishDecision()
}
async function finishDecision(input?: TransitionActionInput) {
  if (!canDecideAcceptance.value) return
  const item = selectedItem.value!
  await send('decide-acceptance', () => ({
    ...commonInput(input), acceptance_id: item.pending_acceptance_id!, expected_acceptance_revision: item.pending_acceptance_revision!,
    expected_risk_revision: item.risk_revision, decision: decision.value as 'approve' | 'reject', reason: reason.value,
  }), decideRemediationAcceptanceApi)
}
function requestForm(command: 'claim' | 'decision', to: string): boolean {
  if (props.ticketActions === undefined) return false
  const action = props.ticketActions.find(item => item.to === to && item.expectedRevision === props.current?.ticket_revision
    && item.definitionVersion === props.current?.definition_version)
  if (!action) {
    error.value = '当前工单没有对应的已发布办理动作，请刷新后重试。'
    return true
  }
  if (!action.commentRequired && action.fields.length === 0) return false
  form.value = { command, action }
  return true
}
async function confirmForm(input: TransitionActionInput) {
  const pending = form.value
  const current = props.current
  form.value = null
  if (!pending || !current || !checkSession()) return
  if (pending.action.expectedRevision !== current.ticket_revision || pending.action.definitionVersion !== current.definition_version) {
    error.value = '办理期间版本或权限已变化，请刷新后重试。'
    return
  }
  if (pending.command === 'claim') await finishClaim(input)
  else await finishDecision(input)
}
function markReceiptReadDenied(error: unknown) {
  if (!disposed && session === getSessionGeneration()
    && (error as { response?: { status?: number } } | null)?.response?.status === 403) {
    receiptReadDenied.value = true
  }
}

async function inspect() {
  if (!checkSession() || !canInspect.value) return
  const original = attempt.value!, token = epoch
  busy.value = true; error.value = ''
  try {
    const received = await props.inspectOperation(original.input.operation_id)
    if (!checkSession() || disposed || token !== epoch || !active.value) return
    confirm(received, original)
  } catch (err) {
    // A refusal applies to the recorded attempt even if the dialog closed
    // while the request was in flight. Only presentation is tied to the epoch.
    markReceiptReadDenied(err)
    if (checkSession() && active.value && token === epoch) {
      error.value = `${apiErrorMessage(err, err instanceof Error ? err.message : '原号查询失败')}；未取得回执不代表未提交，请保留原号继续核查`
    }
  } finally { busy.value = false }
}
async function inspectRejected(record: RejectedAttempt) {
  if (!checkSession() || !rejectedAttempts.value.includes(record) || !canInspectAttempt(record.attempt)) return
  const original = record.attempt, token = epoch
  busy.value = true; record.error = ''
  try {
    const received = await props.inspectOperation(original.input.operation_id)
    if (!checkSession() || disposed || token !== epoch || !active.value) return
    record.result = validateRemediationCommandOutcome(received, original.input.operation_id, original.input.ticket_id)
  } catch (err) {
    markReceiptReadDenied(err)
    if (checkSession() && active.value && token === epoch) {
      record.error = `${apiErrorMessage(err, err instanceof Error ? err.message : '原号查询失败')}；未取得回执不代表未提交，请保留原号继续核查`
    }
  } finally { busy.value = false }
}
async function startNext() {
  if (!checkSession() || !canStartNext.value) return
  const original = attempt.value!, token = epoch
  if (props.refreshContext) {
    busy.value = true; error.value = ''
    try {
      await props.refreshContext()
      if (!checkSession() || !active.value || token !== epoch || attempt.value !== original
        || props.current?.ticket_id !== original.input.ticket_id || props.currentActorId !== original.actorId) return
      if (!contextValid.value || props.current?.writes_enabled !== true
        || (result.value && !contextCoversResult(props.current!, original, result.value))) {
        throw new Error('刷新后的办理上下文仍不可继续，请保留原操作号核查')
      }
    } catch (err) {
      if (checkSession() && active.value && token === epoch) {
        error.value = `刷新失败：${apiErrorMessage(err, err instanceof Error ? err.message : '请重试')}；已保留原操作号与请求`
      }
      return
    } finally { busy.value = false }
  }
  if (rejection.value) {
    rejectedAttempts.value.push({ attempt: attempt.value!, message: rejection.value, result: null, error: '' })
    attempt.value = null; result.value = null; rejection.value = ''; form.value = null; error.value = ''
  } else {
    attempt.value = null; result.value = null; clearDraft()
  }
}
function close() { epoch++; emit('update:modelValue', false) }
const acceptanceStatusText: Record<string, string> = { pending: '待审批', approved: '已批准', rejected: '已拒绝', superseded: '已失效', expired: '已到期' }
</script>

<template>
  <el-dialog :model-value="modelValue" title="整改分派与风险接受" width="620px" :close-on-click-modal="false" @update:model-value="close">
    <div v-if="canViewCurrent" class="max-h-[60vh] overflow-auto remediation-command-body">
      <el-alert v-if="!current || !contextValid" title="办理上下文缺失或不完整，请刷新工单" type="warning" :closable="false" />
      <el-alert v-else-if="current.writes_enabled !== true" title="当前工单暂不可办理，请刷新后核查" type="warning" :closable="false" />
      <p v-if="current">工单 {{ current.ticket_id }} · 当前状态 {{ current.status }}</p>
      <div v-if="!attempt && contextValid">
        <section aria-label="分派与本人接单">
          <label for="remediation-assignee">具名办理人</label>
          <UserPicker id="remediation-assignee" v-model="assignedToUserId" :context="{ purpose: 'assign', ticketId: current!.ticket_id }" :active="ready && permissions.canAssign" data-testid="remediation-command-picker" />
          <div class="flex flex-wrap gap-2 mt-2">
            <el-button v-if="permissions.canAssign" data-testid="remediation-command-assign" :disabled="!canAssign" @click="submitAssign">分派办理人</el-button>
            <el-button v-if="permissions.canAcceptAssignment" data-testid="remediation-command-claim" :disabled="!canAcceptAssignment" @click="submitAcceptAssignment">本人接单</el-button>
          </div>
          <p v-if="assignedTo !== currentActorId" class="text-sm">仅当前办理人可本人接单。</p>
        </section>
        <section aria-label="风险接受申请与审批" class="mt-4">
          <label for="remediation-risk-link">工单关联资产</label>
          <el-select id="remediation-risk-link" v-model="selectedLinkId" clearable placeholder="选择关联资产" :disabled="!ready" class="!w-full">
            <el-option v-for="item in current!.items" :key="item.link_id" :label="`${item.title}（风险 ${item.risk_id} / 关联 ${item.link_id}）`" :value="item.link_id" />
          </el-select>
          <p class="text-sm">当前风险责任人可申请；另一位拥有审批权限且可管理该风险的人员审批。</p>
          <label for="remediation-acceptance-reason">申请或审批理由</label>
          <el-input id="remediation-acceptance-reason" v-model="reason" type="textarea" :rows="3" :maxlength="16000" :disabled="!ready" placeholder="填写理由" />
          <template v-if="permissions.canRequestAcceptance">
            <label for="remediation-valid-until" class="block mt-2">接受截止时间（本地时间）</label>
            <el-input id="remediation-valid-until" v-model="validUntil" type="datetime-local" :disabled="!ready || !requestTarget" />
            <el-button class="mt-2" data-testid="remediation-command-request" :disabled="!canRequestAcceptance" @click="submitRequestAcceptance">申请风险接受</el-button>
          </template>
          <template v-if="permissions.canDecideAcceptance">
            <p v-if="selectedItem?.pending_acceptance_recoverable">原待接受申请已失效</p>
            <p v-else-if="selectedItem?.pending_acceptance_id">待审批申请 {{ selectedItem.pending_acceptance_id }} · 修订 {{ selectedItem.pending_acceptance_revision }}</p>
            <el-radio-group v-model="decision" :disabled="!ready || !decisionTarget" aria-label="风险接受审批决定">
              <el-radio value="approve">批准</el-radio><el-radio value="reject">拒绝</el-radio>
            </el-radio-group>
            <el-button class="mt-2" data-testid="remediation-command-decision" :disabled="!canDecideAcceptance" @click="submitDecideAcceptance">提交审批</el-button>
          </template>
        </section>
      </div>
      <div role="status" aria-live="polite" class="mt-3">
        <p v-if="attempt" class="remediation-operation">操作号：{{ attempt.input.operation_id }} · 工单 {{ attempt.input.ticket_id }}</p>
        <p v-if="busy">正在处理，请等待。</p>
        <template v-else-if="result">
          <p>已取得本次操作回执，请刷新工单查看最新状态。</p>
          <p v-if="result.acceptance_status">风险接受：{{ acceptanceStatusText[result.acceptance_status] ?? result.acceptance_status }}</p>
        </template>
        <p v-else-if="rejection">本次提交已明确拒绝：{{ rejection }}。可刷新工单后继续核查原号，或显式开始修改后提交新操作。</p>
        <p v-else-if="attempt">尚未确认本次结果。请保留操作号并查询原操作，不要重复提交。</p>
        <p v-if="attempt && current?.ticket_id !== attempt.input.ticket_id">请返回原工单核查本次操作。</p>
        <p v-if="error" role="alert">{{ error }}</p>
      </div>
      <section v-if="visibleRejectedAttempts.length" aria-label="此前明确拒绝的操作" class="mt-3">
        <div v-for="record in visibleRejectedAttempts" :key="record.attempt.input.operation_id" class="mt-2">
          <p class="remediation-operation">此前操作号：{{ record.attempt.input.operation_id }} · 工单 {{ record.attempt.input.ticket_id }} · 原修订 {{ record.attempt.input.expected_ticket_revision }}</p>
          <p>提交已明确拒绝：{{ record.message }}</p>
          <p v-if="record.result">已取得此前操作的回执 · 工单修订 {{ record.result.ticket_revision }}</p>
          <p v-if="record.error" role="alert">{{ record.error }}</p>
          <el-button :data-testid="`remediation-command-history-inspect-${record.attempt.input.operation_id}`"
            :disabled="!canInspectAttempt(record.attempt)" :loading="busy" @click="inspectRejected(record)">核查此前操作号</el-button>
        </div>
      </section>
    </div>
    <el-alert v-else title="当前无法展示整改信息，请恢复读取权限并返回原账号、原工单后核查" type="warning" :closable="false" />
    <TransitionActionDialog v-if="form && canViewCurrent" append-to-body :model-value="true" :action="form.action"
      @update:model-value="form = null" @confirm="confirmForm" />
    <template #footer>
      <el-button @click="close">{{ canViewCurrent && attempt ? '关闭并保留操作' : '关闭' }}</el-button>
      <el-button v-if="canViewCurrent && attempt && !result" data-testid="remediation-command-inspect" :disabled="!canInspect" :loading="busy" @click="inspect">查询原操作结果</el-button>
      <el-button v-if="canViewCurrent && (result || rejection)" data-testid="remediation-command-next" :disabled="!canStartNext" @click="startNext">{{ rejection ? '修改后提交新操作' : '使用刷新后的上下文继续' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.remediation-command-body { padding-right: 8px; }
.remediation-command-body label { display: block; margin-bottom: 6px; }
.remediation-operation { overflow-wrap: anywhere; }
</style>
