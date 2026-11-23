<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCheckbox, ElCheckboxGroup, ElDialog, ElEmpty, ElInput, ElRadio, ElRadioGroup, ElTag } from 'element-plus'
import {
  finishRemediationApi, getRemediationContextApi, getRemediationOperationApi,
  reviewRemediationApi, type RemediationCommonInput, type RemediationContextDto,
  type RemediationContextItemDto, type RemediationEvidenceSource, type RemediationFinishInput,
  type RemediationOutcomeDto, type RemediationReviewInput,
} from '@/api/risk/remediation'
import { newRemediationCommandId } from '@/api/risk/remediationCommands'
import { getSessionGeneration } from '@/common/auth/tokenStorage'
import { apiErrorMessage, apiReadError } from '@/utils/apiError'
import type { InstanceAction } from '@/api/ticket/instanceActions'
import TransitionActionDialog from '@/views/ticket/detail/TransitionActionDialog.vue'
import type { TransitionActionInput } from '@/views/ticket/detail/transitionActionFields'

// 挂载入口与写权限由工单详情提供；本组件不自行判定权限码，也不伪造上传、
// 权限或风险接受接线。证据只能引用调用方注入的同票已绑定带版本附件。
const props = defineProps<{
  modelValue: boolean
  ticketId: string
  attachments: RemediationEvidenceSource[]
  references?: RemediationEvidenceSource[]
  canRead: boolean
  canFinish: boolean
  canReview: boolean
  ticketActions?: InstanceAction[]
  /** 父页工单、上下文和已发布动作全部刷新成功后才允许新一轮。 */
  refreshContext?: () => Promise<void>
  currentActorId?: string
  /** 票级公共输入，原样透传；空对象/空串按契约省略 */
  customDataPatch?: Record<string, unknown>
  comment?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  result: [value: RemediationOutcomeDto]
  readDenied: [value: { ticket_id: string; status: 403 | 404 }]
  /** 主页面应保持本组件挂载；可保留此原号供离页前受权核查 */
  operation: [value: { operation_id: string; kind: 'finish' | 'review' }]
}>()

type AttemptKind = 'finish' | 'review'
interface Attempt {
  kind: AttemptKind
  actorId?: string
  input: RemediationFinishInput | RemediationReviewInput
  /** 创建时的原请求签名；续办与核查只认原号原参 */
  signature: string
}
interface FinishDraft { measures: string; evidence: string[] }
interface ReviewDraft { decision: '' | 'approve' | 'reject'; note: string }

const context = ref<RemediationContextDto | null>(null)
const contextLoading = ref(false)
const contextError = ref('')
const selected = ref<string[]>([])
const finishDrafts = ref<Record<string, FinishDraft>>({})
const reviewDrafts = ref<Record<string, ReviewDraft>>({})
const attempt = ref<Attempt | null>(null)
const result = ref<RemediationOutcomeDto | null>(null)
const resultVersion = ref(0)
const busy = ref(false)
const error = ref('')
const uncertain = ref(false)
// 仅显式原号 GET 404 允许用户选择原参重发；仍不代表原写入未提交。
const receiptMissing = ref(false)
const contextReadDenied = ref(false)
const receiptReadDenied = ref(false)
const rejected = ref(false)
const priorOperations = ref<string[]>([])
const savedOperation = ref('')
const verificationNote = ref('')
const sessionInvalid = ref(false)
const statusElement = ref<HTMLElement | null>(null)
const ticketPrompt = ref<{ kind: AttemptKind; action: InstanceAction } | null>(null)
const ticketInput = ref<TransitionActionInput | null>(null)
let contextGeneration = 0
// 会话代际在挂载时拍定：跨会话重放被整窗拒绝，不借新会话续办原请求。
const session = getSessionGeneration()
let disposed = false

const canViewContext = computed(() => sessionMatches() && props.canRead && !contextReadDenied.value && !receiptReadDenied.value
  && (!attempt.value || ownsAttempt(attempt.value)) && context.value?.ticket_id === props.ticketId)
const items = computed(() => canViewContext.value ? context.value?.items ?? [] : [])
const usableEvidence = computed(() => [...props.attachments, ...(props.references ?? [])].filter(source =>
  typeof source.ref === 'string' && source.ref.trim().length > 0
  && typeof source.version === 'string' && source.version.trim().length > 0))
const selectedItems = computed(() => items.value.filter(item => selected.value.includes(item.link_id)))
const patchUsable = computed(() => props.customDataPatch === undefined
  || (typeof props.customDataPatch === 'object' && props.customDataPatch !== null && !Array.isArray(props.customDataPatch)))
const commonUsable = computed(() => patchUsable.value && (props.comment === undefined || typeof props.comment === 'string'))
const mixedSelection = computed(() => selectedItems.value.some(item => isFinishTarget(item) && !isReviewTarget(item))
  && selectedItems.value.some(item => isReviewTarget(item) && !isFinishTarget(item)))
const finishSelectionValid = computed(() => !mixedSelection.value && selectedItems.value.length > 0
  && selectedItems.value.every(item => isFinishTarget(item) && finishDraftReady(item.link_id)))
const reviewSelectionValid = computed(() => !mixedSelection.value && selectedItems.value.length > 0
  && selectedItems.value.every(item => isReviewTarget(item) && reviewDraftReady(item)))
const finished = computed(() => !sessionInvalid.value && !!result.value && !uncertain.value)
const inputChanged = computed(() => !!attempt.value && draftSignature(attempt.value.kind) !== attempt.value.signature)
const dismissLocked = computed(() => busy.value)
const canSubmitFinish = computed(() => !sessionInvalid.value && props.modelValue && canViewContext.value && props.canFinish
  && commonUsable.value && !attempt.value && !busy.value && !contextLoading.value && !contextError.value && !!context.value && finishSelectionValid.value)
const canSubmitReview = computed(() => !sessionInvalid.value && props.modelValue && canViewContext.value && props.canReview
  && commonUsable.value && !attempt.value && !busy.value && !contextLoading.value && !contextError.value && !!context.value && reviewSelectionValid.value)
const canInspect = computed(() => !sessionInvalid.value && props.modelValue && props.canRead && !contextReadDenied.value && !busy.value
  && !!attempt.value && ownsAttempt(attempt.value))
const canRetry = computed(() => !sessionInvalid.value && props.modelValue && canViewContext.value && !busy.value
  && receiptMissing.value && !result.value && !inputChanged.value
  && !!attempt.value && ownsAttempt(attempt.value) && !finished.value && !rejected.value
  && (attempt.value.kind === 'finish' ? props.canFinish : props.canReview))

function isFinishTarget(item: RemediationContextItemDto): boolean {
  return props.canFinish && (item.remediation_state === 'open' || item.remediation_state === 'rejected'
    || (item.remediation_state === 'pending_acceptance' && item.pending_acceptance_recoverable === true))
}
function isReviewTarget(item: RemediationContextItemDto): boolean {
  return props.canReview && ((item.is_risk_owner !== false && item.remediation_state === 'pending_verify')
    || isRecoverableReview(item))
}
function isRecoverableReview(item: RemediationContextItemDto): boolean {
  return item.is_risk_owner === true && item.remediation_state === 'pending_acceptance'
    && item.pending_acceptance_recoverable === true && /^[1-9]\d{0,18}$/.test(item.proposal_version)
    && (item.proposal_version.length < 19 || item.proposal_version <= '9223372036854775807')
}
function rejectOnly(linkId: string): boolean {
  return items.value.some(item => item.link_id === linkId && isRecoverableReview(item))
}
function canToggle(item: RemediationContextItemDto): boolean {
  return props.canRead && !attempt.value && !busy.value && (isFinishTarget(item) || isReviewTarget(item))
}
function itemTitle(linkId: string): string {
  return context.value?.items.find(item => item.link_id === linkId)?.title ?? linkId
}
function finishDraftReady(linkId: string): boolean {
  const draft = finishDrafts.value[linkId]
  if (!draft || !draft.measures.trim() || draft.evidence.length === 0) return false
  const usableRefs = new Set(usableEvidence.value.map(source => source.ref))
  return draft.evidence.every(ref => usableRefs.has(ref))
}
function reviewDraftReady(item: RemediationContextItemDto): boolean {
  const draft = reviewDrafts.value[item.link_id]
  return !!draft && (draft.decision === 'reject' || (draft.decision === 'approve' && !isRecoverableReview(item))) && !!draft.note.trim()
}

function sessionMatches() { return !sessionInvalid.value && session === getSessionGeneration() }
function checkSession() {
  if (sessionMatches()) return true
  sessionInvalid.value = true
  busy.value = false
  uncertain.value = false
  error.value = '会话已切换，原操作仅供原会话受权核查。请关闭本窗口，勿作为新提交重做。'
  return false
}

function clearSelection() {
  ticketPrompt.value = null
  ticketInput.value = null
  selected.value = []
  finishDrafts.value = {}
  reviewDrafts.value = {}
}
function clearContext() {
  context.value = null
  contextError.value = ''
  clearSelection()
}

function ownsAttempt(original: Attempt) {
  return props.ticketId === original.input.ticket_id && props.currentActorId === original.actorId
}

function denyContextRead(cause: unknown, source: string): boolean {
  const status = (cause as { response?: { status?: number } } | null)?.response?.status
  if (status !== 403 && status !== 404) return false
  contextReadDenied.value = true
  contextLoading.value = false
  receiptMissing.value = false
  ticketPrompt.value = null
  emit('readDenied', { ticket_id: source, status })
  return true
}

async function loadContext() {
  if (disposed || !checkSession() || !props.modelValue || !props.canRead || contextReadDenied.value || attempt.value) return
  const source = props.ticketId
  const generation = ++contextGeneration
  contextLoading.value = true
  contextError.value = ''
  // 只在仍打开、仍有读权且没有在办原请求时应用，避免旧回包覆盖新状态。
  const current = () => !disposed && generation === contextGeneration && checkSession()
    && props.modelValue && props.canRead && props.ticketId === source && !attempt.value
  try {
    const response = await getRemediationContextApi(source)
    if (!current()) return
    if (response.ticket_id !== source) throw new Error('办理上下文与原工单不匹配')
    context.value = response
    clearSelection()
  } catch (cause) {
    if (current()) {
      contextError.value = apiReadError(cause, '逐资产办理上下文加载失败，请重试', '该工单当前没有逐资产办理上下文')
      denyContextRead(cause, source)
    }
  } finally {
    if (current()) contextLoading.value = false
  }
}

watch(() => [props.modelValue, props.ticketId, props.canRead, props.currentActorId] as const, () => {
  contextGeneration++
  contextLoading.value = false
  receiptMissing.value = false
  if (!checkSession()) return
  if (attempt.value) return // 有原请求在身：关闭、权限或票号变化都保留原号原参。
  clearContext()
  if (props.modelValue && props.canRead) void loadContext()
}, { flush: 'sync', immediate: true })
onScopeDispose(() => { disposed = true; contextGeneration++ })

async function focusStatus() {
  await nextTick()
  if (!disposed && props.modelValue && session === getSessionGeneration()) statusElement.value?.focus()
}

function toggleSelect(item: RemediationContextItemDto) {
  if (!checkSession() || !canToggle(item)) return
  const id = item.link_id
  if (selected.value.includes(id)) {
    selected.value = selected.value.filter(value => value !== id)
    delete finishDrafts.value[id]
    delete reviewDrafts.value[id]
    return
  }
  selected.value = [...selected.value, id]
  if (isFinishTarget(item)) finishDrafts.value[id] = { measures: '', evidence: [] }
  if (isReviewTarget(item)) reviewDrafts.value[id] = { decision: '', note: '' }
}

function buildCommon(operationId: string): RemediationCommonInput {
  const patch = ticketInput.value?.custom_data_patch ?? props.customDataPatch
  const comment = ticketInput.value?.comment ?? props.comment
  return {
    operation_id: operationId,
    ticket_id: props.ticketId,
    expected_ticket_revision: context.value?.ticket_revision ?? '',
    definition_version: context.value?.definition_version ?? '',
    ...(patch && Object.keys(patch).length > 0 ? { custom_data_patch: patch } : {}),
    ...(comment ? { comment } : {}),
  }
}
function buildFinishRequest(operationId: string): RemediationFinishInput {
  return {
    ...buildCommon(operationId),
    items: selectedItems.value.filter(isFinishTarget).map(item => {
      const draft = finishDrafts.value[item.link_id]
      return {
        link_id: item.link_id,
        expected_link_revision: item.link_revision,
        expected_risk_revision: item.risk_revision,
        resolution: 'fixed' as const,
        measures: draft?.measures ?? '',
        evidence: (draft?.evidence ?? []).map(ref => {
          const source = usableEvidence.value.find(source => source.ref === ref)
          return { kind: source?.kind ?? 'file', ref, version: source?.version ?? '' }
        }),
      }
    }),
  }
}
function buildReviewRequest(operationId: string): RemediationReviewInput {
  return {
    ...buildCommon(operationId),
    items: selectedItems.value.filter(isReviewTarget).map(item => {
      const draft = reviewDrafts.value[item.link_id]
      return {
        link_id: item.link_id,
        expected_link_revision: item.link_revision,
        expected_risk_revision: item.risk_revision,
        expected_proposal_version: item.proposal_version,
        decision: (draft?.decision || 'approve') as 'approve' | 'reject',
        note: draft?.note ?? '',
        evidence: [] as [],
      }
    }),
  }
}
function draftSignature(kind: AttemptKind): string {
  // 签名不含操作号：选择/草稿/票版本/公共输入任一变化都算原请求已漂移。
  const request = kind === 'finish' ? buildFinishRequest('signature') : buildReviewRequest('signature')
  return JSON.stringify({ ...request, operation_id: null })
}

async function submitFinish() {
  if (!checkSession() || !canSubmitFinish.value || !context.value) return
  await collectTicketFields('finish', 'pending_verify')
}
async function submitReview() {
  if (!checkSession() || !canSubmitReview.value || !context.value) return
  const rejected = selectedItems.value.some(item => reviewDrafts.value[item.link_id]?.decision === 'reject')
  const allResolved = items.value.every(item => item.remediation_state === 'resolved' || selected.value.includes(item.link_id))
  await collectTicketFields('review', rejected ? 'in_progress' : allResolved ? 'closed' : 'pending_verify')
}
async function collectTicketFields(kind: AttemptKind, to: string) {
  if (props.ticketActions === undefined) {
    if (kind === 'review' && selectedItems.value.some(isRecoverableReview)) {
      error.value = '当前工单没有对应的已发布办理动作，请刷新后重试。'
      return
    }
    await beginAttempt(kind)
    return
  }
  const action = props.ticketActions.find(item => item.to === to
    && item.expectedRevision === context.value?.ticket_revision && item.definitionVersion === context.value?.definition_version)
  if (!action) {
    error.value = '当前工单没有对应的已发布办理动作，请刷新后重试。'
    return
  }
  if (action.commentRequired || action.fields.length > 0) {
    ticketPrompt.value = { kind, action }
    return
  }
  await beginAttempt(kind)
}
async function confirmTicketFields(input: TransitionActionInput) {
  const prompt = ticketPrompt.value
  if (!prompt || !checkSession()) return
  ticketPrompt.value = null
  const valid = prompt.kind === 'finish' ? canSubmitFinish.value : canSubmitReview.value
  const current = context.value
  if (!valid || !current || prompt.action.expectedRevision !== current.ticket_revision
    || prompt.action.definitionVersion !== current.definition_version) {
    error.value = '办理期间版本或权限已变化，请刷新后重试。'
    return
  }
  ticketInput.value = input
  await beginAttempt(prompt.kind)
}
async function beginAttempt(kind: AttemptKind) {
  let operationId: string
  try {
    operationId = newRemediationCommandId()
  } catch {
    error.value = '无法生成操作号，请重试'
    return
  }
  const request = kind === 'finish' ? buildFinishRequest(operationId) : buildReviewRequest(operationId)
  // 首个 await 前锁住原请求快照；此后输入/权限变化都不改写原请求。
  attempt.value = { kind, actorId: props.currentActorId, input: JSON.parse(JSON.stringify(request)) as typeof request, signature: draftSignature(kind) }
  savedOperation.value = operationId
  emit('operation', { operation_id: operationId, kind })
  await run()
}
async function retry() {
  if (!checkSession() || !canRetry.value) return
  await run()
}
async function inspect() {
  if (!checkSession() || !canInspect.value) return
  await run(true)
}
async function startNext() {
  const original = attempt.value
  if (disposed || !checkSession() || !original || !ownsAttempt(original) || (!finished.value && !rejected.value)
    || busy.value || !props.modelValue || !canViewContext.value) return
  const generation = ++contextGeneration
  const current = () => !disposed && generation === contextGeneration && checkSession()
    && props.modelValue && props.canRead && attempt.value === original && ownsAttempt(original)
  busy.value = true
  error.value = ''
  let readingContext = false
  try {
    // 原尝试始终保留，父页失败或晚到刷新都不能使旧操作号失去核查资格。
    await props.refreshContext?.()
    if (!current()) return
    readingContext = true
    const response = await getRemediationContextApi(original.input.ticket_id)
    readingContext = false
    if (!current()) return
    if (response.ticket_id !== original.input.ticket_id) throw new Error('办理上下文与原工单不匹配')
    if (props.ticketActions?.some(action => action.expectedRevision !== response.ticket_revision
      || action.definitionVersion !== response.definition_version)) throw new Error('已发布动作与办理上下文版本不匹配')
    context.value = response
    contextError.value = ''
    clearSelection()
    priorOperations.value.push(original.input.operation_id)
    attempt.value = null
    result.value = null
    uncertain.value = false
    rejected.value = false
    verificationNote.value = ''
  } catch (cause) {
    if (current()) {
      error.value = `${apiErrorMessage(cause, cause instanceof Error ? cause.message : '办理上下文刷新失败')}；刷新失败，已保留原操作，请按原号核查或重试刷新。`
      if (readingContext) denyContextRead(cause, original.input.ticket_id)
    }
  } finally {
    busy.value = false
  }
}

async function run(readOnly = false) {
  const current = attempt.value
  if (disposed || !current || !checkSession() || !props.modelValue || !props.canRead || contextReadDenied.value || !ownsAttempt(current) || busy.value) return
  if (!readOnly && (current.kind === 'finish' ? !props.canFinish : !props.canReview)) return
  const wasUncertain = uncertain.value
  receiptMissing.value = false
  busy.value = true
  error.value = ''
  verificationNote.value = ''
  uncertain.value = !rejected.value && !result.value
  const generation = contextGeneration
  const alive = () => !disposed && checkSession() && generation === contextGeneration
    && props.modelValue && props.canRead && attempt.value === current && ownsAttempt(current)
  try {
    const response = readOnly
      ? await getRemediationOperationApi(current.input.operation_id)
      : current.kind === 'finish'
        ? await finishRemediationApi(current.input as RemediationFinishInput)
        : await reviewRemediationApi(current.input as RemediationReviewInput)
    if (!alive() || !props.canRead) return
    // 组件侧同号复核（真实适配层已校验，这里兜底替身/漂移）：异号回执不确认完成。
    if (response.operation_id !== current.input.operation_id || response.ticket_id !== current.input.ticket_id) {
      throw new Error('回执与原操作号或原工单不匹配')
    }
    receiptReadDenied.value = false
    result.value = response
    resultVersion.value++
    uncertain.value = false
    rejected.value = false
    savedOperation.value = current.input.operation_id
    if (readOnly) verificationNote.value = '只读核查成功，未续办；原操作号已保留在本页面内存，刷新或离页前请另行保存。'
    emit('result', response)
  } catch (cause) {
    if (!alive()) return
    const status = (cause as { response?: { status?: number } } | null)?.response?.status
    if (readOnly && status === 403) receiptReadDenied.value = true
    if (readOnly && status === 404 && !rejected.value && !result.value) {
      receiptMissing.value = true
      receiptReadDenied.value = false
    }
    // 仅首次写入的明确业务拒绝可开启新一轮；续办或 GET 失败不证明原写入未提交。
    if (!readOnly && !wasUncertain && status !== undefined && [400, 403, 409, 422].includes(status)) {
      rejected.value = true
      uncertain.value = false
      error.value = `${apiErrorMessage(cause, '本次提交已被拒绝')}。请保留原操作号核对；可刷新上下文并修改，再显式提交新操作。`
      return
    }
    error.value = readOnly && status === 404
      ? '当前操作结果仍未知，404 不代表未提交；请保留原操作号，稍后只读核查。'
      : status === 403
        ? '当前无权完成本次请求，结果仍待核查；原操作号和请求已保留。'
        : `${apiErrorMessage(cause, readOnly ? '只读核查失败' : '提交结果未确认')}。请保留原操作号；请先只读核查，不换号重做。`
  } finally {
    busy.value = false
    if (alive()) await focusStatus()
  }
}

function close() {
  checkSession()
  if (!dismissLocked.value) emit('update:modelValue', false)
}
function updateVisible(value: boolean) {
  if (!value) close()
}

const stateText: Record<string, string> = {
  open: '待办理', pending_verify: '待复测', rejected: '已打回待重办', pending_acceptance: '待接受', resolved: '已生效',
}
const stateTagType: Record<string, 'primary' | 'warning' | 'danger' | 'success' | 'info'> = {
  open: 'primary', pending_verify: 'warning', rejected: 'danger', pending_acceptance: 'info', resolved: 'success',
}
const resultText: Record<string, string> = {
  pending_confirmation: '已提交待复测', applied: '已生效', rejected: '已打回', conflict: '冲突未生效', reworked: '已恢复整改',
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="逐资产整改与复测" width="860px" :close-on-click-modal="false"
    :close-on-press-escape="!dismissLocked" :show-close="!dismissLocked" @update:model-value="updateVisible" @opened="focusStatus">
    <div class="remediation-body">
      <div ref="statusElement" tabindex="-1" role="status" aria-live="polite" class="remediation-status">
        <p v-if="contextLoading">正在加载逐资产办理上下文…</p>
        <p v-if="canViewContext && context && sessionMatches()">工单 {{ context.ticket_id }} 状态 {{ context.status }}；票修订 {{ context.ticket_revision }}，定义版本 {{ context.definition_version }}；共 {{ context.items.length }} 项关联资产。</p>
        <template v-if="canViewContext && sessionMatches()">
          <p v-if="attempt">操作号：<code>{{ attempt.input.operation_id }}</code>（保存在本页面内存，离页前请保存）</p>
          <p v-else-if="savedOperation">上次操作号：<code>{{ savedOperation }}</code></p>
          <p v-for="operationId in priorOperations" :key="operationId">先前操作号（供核对）：<code>{{ operationId }}</code></p>
        </template>
        <p v-if="canViewContext && verificationNote">{{ verificationNote }}</p>
        <el-alert v-if="contextError" :title="contextError" type="error" :closable="false" show-icon />
        <el-alert v-if="error" :title="canViewContext || sessionInvalid ? error : '当前读取资格不可用，原操作号已保留，请在受权上下文核查。'" type="error" :closable="false" show-icon />
        <el-alert v-if="canRead && !canFinish && !canReview" title="当前无办理或复测写权限，仅可查看。" type="warning" :closable="false" />
        <el-alert v-if="canViewContext && canFinish && context && usableEvidence.length === 0" title="当前工单没有可引用的附件或公开记录。" type="warning" :closable="false" />
        <el-alert v-if="mixedSelection" title="已选项目混合了待办理与待复测状态，请分开提交。" type="warning" :closable="false" />
        <el-alert v-if="!patchUsable" title="custom_data_patch 必须为对象，请修正后再提交。" type="warning" :closable="false" />
        <el-alert v-if="attempt && inputChanged" title="选择或草稿已变化，当前仍在核查原操作与原请求。" type="warning" :closable="false" />
        <el-alert v-if="uncertain" title="结果待核查。可关闭并保留原操作，返回同一工单按原号核查。" type="warning" :closable="false" />
        <el-alert v-if="rejected" title="本次提交已被明确拒绝。可刷新并修改，由你显式提交新的操作号。" type="warning" :closable="false" />
      </div>
      <template v-if="items.length">
        <ul data-testid="remediation-items" role="list" class="remediation-list">
          <li v-for="item in items" :key="item.link_id" class="remediation-item">
            <el-checkbox :model-value="selected.includes(item.link_id)" :disabled="!canToggle(item)"
              :aria-label="`选择 ${item.title}`" @change="toggleSelect(item)" />
            <span class="remediation-title">{{ item.title }}</span>
            <span class="remediation-meta">风险 {{ item.risk_id }} · 关联 {{ item.link_id }}</span>
            <el-tag :type="stateTagType[item.remediation_state] ?? 'info'">
              {{ item.pending_acceptance_recoverable ? '待接受已失效' : stateText[item.remediation_state] ?? item.remediation_state }}
            </el-tag>
            <span class="remediation-versions">风险版本 {{ item.risk_revision }} / 关联版本 {{ item.link_revision }} / 提案版本 {{ item.proposal_version }}</span>
            <details v-if="item.submissions?.length" class="remediation-history">
              <summary>提交与复测记录</summary>
              <ol>
                <li v-for="entry in item.submissions" :key="entry.proposal_version">
                  <p>提案 {{ entry.proposal_version }} · {{ entry.measures }}</p>
                  <ul>
                    <li v-for="proof in entry.evidence" :key="`${proof.kind}:${proof.ref}:${proof.version}`">
                      <a v-if="proof.kind === 'file'" :href="`/api/v1/files/${proof.ref}`" target="_blank" rel="noopener">
                        {{ usableEvidence.find(source => source.ref === proof.ref)?.file_name ?? '已提交附件' }}
                      </a>
                      <span v-else>{{ proof.ref.replace('ticket-comment:', '公开记录 #') }}</span>
                      <span> · 版本 {{ proof.version }}</span>
                    </li>
                  </ul>
                  <p v-if="entry.decision">{{ entry.decision === 'approve' ? '通过' : '打回' }} · {{ entry.review_note }}</p>
                </li>
              </ol>
            </details>
          </li>
        </ul>
        <ul v-if="Object.keys(finishDrafts).length && !attempt" data-testid="remediation-drafts" class="remediation-drafts">
          <li v-for="(draft, linkId) in finishDrafts" :key="linkId">
            <p>{{ itemTitle(linkId) }}（关联 {{ linkId }}）</p>
            <el-input v-model="draft.measures" type="textarea" :rows="2" maxlength="16000" show-word-limit
              placeholder="整改措施（必填）" data-testid="remediation-measures" :name="`measures-${linkId}`" />
            <el-checkbox-group v-model="draft.evidence" class="remediation-evidence" :aria-label="`整改证据 ${itemTitle(linkId)}`">
              <el-checkbox v-for="source in usableEvidence" :key="source.ref" :value="source.ref">
                {{ source.file_name }}（版本 {{ source.version }}）
              </el-checkbox>
            </el-checkbox-group>
          </li>
        </ul>
        <ul v-if="Object.keys(reviewDrafts).length && !attempt" data-testid="remediation-review-drafts" class="remediation-drafts">
          <li v-for="(draft, linkId) in reviewDrafts" :key="linkId">
            <p>{{ itemTitle(linkId) }}（关联 {{ linkId }}）</p>
            <p v-if="rejectOnly(linkId)">原待接受申请已失效，只能打回旧提案重新办理。</p>
            <el-radio-group v-model="draft.decision" :aria-label="`复测决定 ${itemTitle(linkId)}`" data-testid="remediation-decision">
              <el-radio value="approve" :disabled="rejectOnly(linkId)">通过（A）</el-radio>
              <el-radio value="reject">打回（B）</el-radio>
            </el-radio-group>
            <el-input v-model="draft.note" type="textarea" :rows="2" maxlength="16000" show-word-limit
              placeholder="复测说明（必填）" data-testid="remediation-note" :name="`note-${linkId}`" />
          </li>
        </ul>
      </template>
      <el-empty v-else-if="canViewContext && sessionMatches() && !contextLoading && !contextError" description="该工单当前没有可办理的关联资产" />
      <div v-if="result && canViewContext && sessionMatches()" class="mt-4">
        <p>回执逐项结果（票修订 {{ result.ticket_revision }}）：</p>
        <ul data-testid="remediation-outcome" role="list">
          <li v-for="row in result.items" :key="row.link_id">
            关联 {{ row.link_id }}（风险 {{ row.risk_id }}）：{{ resultText[row.result] ?? row.result }}
            ；风险版本 {{ row.risk_revision }} / 关联版本 {{ row.link_revision }} / 提案版本 {{ row.proposal_version }}
          </li>
        </ul>
      </div>
    </div>
    <TransitionActionDialog
      v-if="ticketPrompt && canViewContext"
      append-to-body
      :model-value="true"
      :action="ticketPrompt.action"
      @update:model-value="ticketPrompt = null"
      @confirm="confirmTicketFields"
    />
    <template #footer>
      <el-button :disabled="dismissLocked" @click="close">{{ attempt && !finished ? '关闭并保留本次操作' : '关闭' }}</el-button>
      <el-button v-if="!attempt" data-testid="remediation-finish" type="primary" :disabled="!canSubmitFinish" :loading="busy" @click="submitFinish">提交整改办理</el-button>
      <el-button v-if="!attempt" data-testid="remediation-review" type="primary" :disabled="!canSubmitReview" :loading="busy" @click="submitReview">提交复测决定</el-button>
      <el-button v-if="attempt" data-testid="remediation-inspect" :disabled="!canInspect" :loading="busy" @click="inspect">按原号核查（只读）</el-button>
      <el-button v-if="attempt && !finished && !rejected" data-testid="remediation-resume" type="primary" :disabled="!canRetry" :loading="busy" @click="retry">按原号续办（重发原请求）</el-button>
      <el-button v-if="attempt && rejected" data-testid="remediation-rejected-refresh" :disabled="busy || !canViewContext" @click="startNext">刷新上下文并修改（新操作）</el-button>
      <el-button v-if="attempt && finished" :disabled="busy || !canViewContext" @click="startNext">开始下一批</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.remediation-body { max-height: 60vh; overflow: auto; overflow-wrap: anywhere; }
.remediation-status:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.remediation-list, .remediation-drafts, .remediation-outcome { margin: 8px 0; padding-left: 0; list-style: none; }
.remediation-item { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.remediation-item:last-child { border-bottom: none; }
.remediation-meta, .remediation-versions { color: var(--el-text-color-secondary); font-size: 12px; }
.remediation-drafts li { padding: 8px 0; border-bottom: 1px dashed var(--el-border-color-lighter); }
.remediation-evidence { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
</style>
