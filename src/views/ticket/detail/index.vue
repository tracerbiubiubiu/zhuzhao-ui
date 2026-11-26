<script setup lang="ts">
/**
 * 工单详情（P4-W4 详情批——评论/备注/关联/流转，03 S10/S11）
 *
 * - 转换按本工单绑定规则和当前权限读取。缺失原流程规则时只显示可读取信息。
 * - 评论/备注「全部展示+条数上限提示」（后端无分页，01 §8-W4 勿假设 page/total）；
 *   内部备注分层渲染（可见性由服务端过滤，viewer 只见公开评论——S10）
 * - 关联正反向渲染按 source 判方向；判重 409/自关联 400 内联呈现（勿纯 toast）
 * - 分派对话框填用户 ID（operator 无用户列表权限——不假搜索，ID 即工号外键）
 * - 按钮码（000010/000031 种子）：ticket:update/close/assign/delete/comment/note/relation
 * - 静态路由（§3.2④，菜单外——入口在列表页「详情」按钮，挂 ticket:read 码）
 */
import { apiReadError } from '@/utils/apiError'
import { formatDateTime } from '@/utils/datetime'
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, toRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElAlert, ElButton, ElCard, ElCheckbox, ElDescriptions, ElDescriptionsItem, ElDialog,
  ElEmpty, ElForm, ElFormItem, ElInput, ElLink, ElMessage, ElMessageBox, ElOption, ElSelect, ElTag,
} from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  addTicketCCApi, assignTicketApi, closeTicketApi, createTicketCommentApi, createTicketNoteApi,
  createTicketRelationApi, deleteTicketApi, getTicketApi, getTicketCommentsApi,
  getTicketRelationsApi, listTicketCCApi, listTicketTagsApi,
  listTicketTypesApi, listTicketRelationCandidatesApi, addTicketTagsApi, removeTicketCCApi, removeTicketTagApi,
  STATUS_LABEL, updateTicketApi, type TagRow, type TicketCCRow,
} from '@/api/ticket'
import { getInstanceActionsApi, normalizeTicketDefinition, transitionInstanceApi, type InstanceAction } from '@/api/ticket/instanceActions'
import { newTicketOperationKey } from '@/api/ticket/operationKey'
import { getRemediationContextApi, getRemediationOperationApi, type RemediationAction } from '@/api/risk/remediation'
import { useUserStoreWithOut } from '@/store/modules/user'
import { getSessionGeneration } from '@/common/auth/tokenStorage'
import UserNameText from '@/components/UserNameText/index.vue'
import { getTicketTypeFieldsApi, type TicketTypeFieldDef , renderRichtextApi } from '@/api/ticket'
import { getDictItemsByCodeApi } from '@/api/system/dict'
import UserPicker from '@/components/UserPicker/index.vue'
import TicketAttachments from '@/components/TicketAttachments.vue'
import { createRelationSession } from './relationSession'
import { useRenderedRichtext } from './useRenderedRichtext'
import TransitionActionDialog from './TransitionActionDialog.vue'
import { createTransitionSubmission } from './transitionSubmission'
import RemediationDialog from '@/views/risk/items/RemediationDialog.vue'
import RemediationCommandDialog from '@/views/risk/items/RemediationCommandDialog.vue'

// keep-alive 契约：name=静态路由名（参数路由——同工单不同 ID 依赖 :key 路由 fullPath 分实例）
defineOptions({ name: 'TicketDetail' })

const props = defineProps<{ ticketId: string }>()
const router = useRouter()
const queryClient = useQueryClient()
const userStore = useUserStoreWithOut()

// AppView 按 fullPath 缓存实例。路由参数由 RouterView 传入，缓存页不跟随全局 route 换单。
const ticketId = toRef(props, 'ticketId')
const active = ref(true)
const riskSession = getSessionGeneration()
const riskActor = userStore.profile?.id
function hasTicketReadScope() {
  return active.value && riskSession === getSessionGeneration() && riskActor === userStore.profile?.id
}
const ticketReadScope = computed(hasTicketReadScope)
onDeactivated(() => { active.value = false })
const canQueryTicket = computed(() => active.value && !!ticketId.value && ticketId.value !== 'new')

const ticketQuery = useQuery({
  queryKey: computed(() => ['ticket', 'detail', ticketId.value] as const),
  queryFn: async ({ queryKey }) => {
    const row = await getTicketApi(queryKey[2], { _silentError: true })
    return { row, definition: normalizeTicketDefinition(row) }
  },
  enabled: canQueryTicket,
})
const commentsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'comments', ticketId.value]),
  queryFn: () => getTicketCommentsApi(ticketId.value),
  enabled: canQueryTicket,
})
const relationsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'relations', ticketId.value]),
  queryFn: () => getTicketRelationsApi(ticketId.value),
  enabled: canQueryTicket,
})
const ccQuery = useQuery({
  queryKey: computed(() => ['ticket', 'cc', ticketId.value]),
  queryFn: () => listTicketCCApi(ticketId.value),
  enabled: canQueryTicket,
})
const tagsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'tags', ticketId.value]),
  queryFn: () => listTicketTagsApi(ticketId.value),
  enabled: canQueryTicket,
})
const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })

const ticket = computed(() => ticketQuery.isSuccess.value ? ticketQuery.data.value?.row : undefined)
const taskRuns = computed(() => ticketReadScope.value && userStore.hasPermission('ticket:read')
  ? ticket.value?.task_runs ?? [] : [])
const taskActionLabels = new Map([
  ['ticket.evidence.report.generate', '工单证据摘要'],
  ['activelist.document.update', '更新活动清单'],
  ['activelist.document.get', '读取活动清单'],
])
const taskStatusLabels = new Map([
  ['pending', '待提交确认'],
  ['queued', '已受理'],
  ['running', '执行中'],
  ['held', '暂缓执行'],
  ['failed_no_effect', '执行失败'],
  ['succeeded', '已完成'],
])
const taskReasonLabels = new Map([
  ['ticket_authorization_revoked', '原操作人已无此工单任务的执行权限'],
  ['report_input_unavailable', '无法读取生成摘要所需的工单证据'],
  ['document_authorization_revoked', '原操作人已无活动清单的所需权限'],
  ['document_unavailable_or_not_authorized', '目标数据不可用或当前无权访问'],
  ['document_input_rejected', '活动清单拒绝了本次操作'],
  ['document_input_invalid', '活动清单输入无效'],
  ['invalid_document_update', '清单更新条件无效'],
  ['document_version_conflict', '清单数据版本已变化，本次未写入'],
  ['document_outcome_unconfirmed', '清单结果待核实，请刷新查询原任务'],
  ['execution_expired', '执行期限已过'],
  ['task_delivery_canceled', '任务投递已取消，未执行'],
])
const ticketDefinition = computed(() => ticketQuery.isSuccess.value ? ticketQuery.data.value?.definition : undefined)
const canWriteTicket = computed(() => canQueryTicket.value && !!ticket.value && ticketDefinition.value?.resolution !== 'degraded')
const typeLabel = computed(
  () => typesQuery.data.value?.find((t) => t.code === ticket.value?.type_code)?.name ?? ticket.value?.type_code ?? '—',
)
const isClosed = computed(() => ticket.value?.status === 'closed')
const canReadRiskWorkflow = computed(() => canQueryTicket.value && !!ticket.value
  && ticketReadScope.value && userStore.hasPermission('route:/risks'))
const riskReadDenied = ref(false)
const riskWorkflow = useQuery({
  queryKey: computed(() => ['ticket', 'risk-workflow', ticketId.value, riskActor, riskSession] as const),
  queryFn: ({ queryKey, signal }) => {
    if (riskReadDenied.value || !hasTicketReadScope() || !canReadRiskWorkflow.value) throw new Error('读取资格已变化，请在原会话受权核查')
    return getRemediationContextApi(queryKey[2], signal)
  },
  enabled: computed(() => canReadRiskWorkflow.value && !riskReadDenied.value),
  retry: false,
})
watch(() => riskWorkflow.error.value, error => {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  // An initial 404 is also the normal response for an ordinary ticket.
  if (riskWorkflow.data.value && (status === 403 || status === 404)) riskReadDenied.value = true
}, { flush: 'sync', immediate: true })
// 显式拒绝不能借上次成功缓存继续核查；临时故障仍保留受权旧上下文。
const canInspectRiskWorkflow = computed(() => canReadRiskWorkflow.value && !riskReadDenied.value
  && ![403, 404].includes((riskWorkflow.error.value as { response?: { status?: number } } | null)?.response?.status ?? 0))
const riskWorkflowContext = computed(() => canInspectRiskWorkflow.value ? riskWorkflow.data.value : undefined)
const hideRiskTicketActions = computed(() => riskReadDenied.value || (!!riskWorkflow.data.value && !canInspectRiskWorkflow.value))
function onRiskWorkflowReadDenied(value: { ticket_id: string; status: 403 | 404 }) {
  if (value.ticket_id !== ticketId.value || !hasTicketReadScope() || !riskWorkflow.data.value) return
  riskReadDenied.value = true
}
const publicEvidence = computed(() => (commentsQuery.data.value ?? []).flatMap(row => !row.is_internal && row.evidence_version
  ? [{ kind: 'reference' as const, ref: `ticket-comment:${row.id}`, file_name: `公开记录 #${row.id}`, version: row.evidence_version }]
  : []))
const riskWorkflowVisible = ref(false)
const riskCommandsVisible = ref(false)
const retainedRiskCommand = ref<{ ticketId: string; actorId: string; session: number } | null>(null)
const riskWorkflowNotice = ref('')
let riskRefreshEpoch = 0
watch([ticketId, active, () => userStore.profile?.id, canReadRiskWorkflow], () => { riskRefreshEpoch++ }, { flush: 'sync' })
onBeforeUnmount(() => { riskRefreshEpoch++ })
const canReopenRiskCommand = computed(() => {
  const retained = retainedRiskCommand.value
  return canInspectRiskWorkflow.value && !!riskCommandContext.value && !!retained
    && retained.ticketId === ticketId.value && retained.actorId === userStore.profile?.id
    && retained.session === getSessionGeneration()
})
function retainRiskCommand(operation: { ticket_id: string }) {
  if (!canReadRiskWorkflow.value || operation.ticket_id !== ticketId.value || !userStore.profile?.id) return
  retainedRiskCommand.value = { ticketId: operation.ticket_id, actorId: userStore.profile.id, session: getSessionGeneration() }
}
const assignedActor = computed(() => !!userStore.profile?.id && ticket.value?.assigned_to === userStore.profile.id)
// Rejecting a risk read must not restore the ordinary lifecycle controls.
const activeRiskWorkflow = computed(() => riskReadDenied.value
  || (!!riskWorkflow.data.value && riskWorkflow.data.value.status !== 'closed'))
const riskCommandContext = computed(() => {
  const current = riskWorkflowContext.value
  if (!current || !canInspectRiskWorkflow.value) return null
  return { ...current, items: current.items.map(item => ({ ...item,
    is_risk_owner: item.is_risk_owner === true, can_manage_risk: item.can_manage_risk === true,
  })) }
})
function hasRiskAction(action: RemediationAction): boolean {
  return riskWorkflowContext.value?.writes_enabled === true && riskWorkflowContext.value.allowed_actions?.includes(action) === true
}
const riskCommandPermissions = computed(() => {
  const current = riskCommandContext.value
  const activeReview = current?.status === 'in_progress' || current?.status === 'pending_verify'
  return {
    canAssign: hasRiskAction('assign_handler') && current?.status === 'assigned'
      && current.items.length > 0 && current.items.every(item => item.can_manage_risk),
    canAcceptAssignment: hasRiskAction('accept_assignment') && current?.status === 'assigned' && assignedActor.value,
    canRequestAcceptance: hasRiskAction('accept_request') && current?.status === 'pending_verify'
      && current.items.some(item => item.is_risk_owner),
    canDecideAcceptance: hasRiskAction('accept_decision') && activeReview
      && current.items.some(item => item.can_manage_risk && !item.is_risk_owner && !!item.pending_acceptance_id),
    canReworkAcceptance: hasRiskAction('accept_rework') && activeReview
      && current.items.some(item => item.can_manage_risk && !!item.expired_acceptance_id),
  }
})
async function refreshRiskWorkflowContext() {
  const source = ticketId.value, actor = userStore.profile?.id, session = getSessionGeneration(), epoch = riskRefreshEpoch
  const assertCurrent = () => {
    if (!hasTicketReadScope() || !actor || source !== ticketId.value || actor !== userStore.profile?.id || session !== getSessionGeneration()
      || epoch !== riskRefreshEpoch || !canInspectRiskWorkflow.value) {
      throw new Error('工单、身份或读取权限已变化，原操作仍保留，请返回受权上下文核查')
    }
  }
  assertCurrent()
  const detail = await ticketQuery.refetch({ throwOnError: true })
  assertCurrent()
  if (!detail.isSuccess || !detail.data) throw detail.error ?? new Error('工单刷新失败，原操作仍保留')
  // 动作查询键依赖新票的状态和定义；等待观察器切换到新键后再刷新。
  await nextTick()
  assertCurrent()
  const context = await riskWorkflow.refetch({ throwOnError: true })
  assertCurrent()
  if (!context.isSuccess || !context.data) throw context.error ?? new Error('办理上下文刷新失败，原操作仍保留')
  const definition = detail.data.definition
  if (detail.data.row.id !== source || context.data.ticket_id !== source || definition.resolution !== 'exact'
    || context.data.ticket_revision !== definition.revision
    || context.data.definition_version !== definition.reference.definition_version) {
    throw new Error('工单与办理上下文版本不一致，原操作仍保留，请刷新后重试')
  }
  const actions = await actionsQuery.refetch({ throwOnError: true })
  assertCurrent()
  if (!actions.isSuccess || !actions.data) throw actions.error ?? new Error('已发布动作刷新失败，原操作仍保留')
  if (actions.data.actions.some(action => action.expectedRevision !== context.data.ticket_revision
    || action.definitionVersion !== context.data.definition_version)) {
    throw new Error('已发布动作与办理上下文版本不一致，原操作仍保留')
  }
  await nextTick()
  assertCurrent()
  riskWorkflowNotice.value = ''
}
function onRiskWorkflowResult() {
  void refreshRiskWorkflowContext().catch(cause => {
    if (canReadRiskWorkflow.value) riskWorkflowNotice.value = apiReadError(cause, '操作已取得回执，但刷新失败，请保留原号并重试')
  })
}

// 仅旧响应缺少全部版本元数据时，兼容读取原有类型字段接口。
const typeFieldsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'typeFields', ticket.value?.type_code ?? ''] as const),
  queryFn: ({ queryKey }) => getTicketTypeFieldsApi(queryKey[2], { _silentError: true }),
  enabled: computed(() => canQueryTicket.value && !!ticket.value?.type_code && ticketDefinition.value?.resolution === 'legacy'),
  staleTime: 60_000,
})

const actionsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'transitions', ticketId.value, ticket.value?.status, ticketDefinition.value] as const),
  queryFn: ({ queryKey }) => {
    if (hideRiskTicketActions.value) throw new Error('读取资格已变化，请在原会话受权核查')
    if (!queryKey[4]) throw new Error('请先刷新工单详情')
    return getInstanceActionsApi(queryKey[2], queryKey[4])
  },
  enabled: computed(() => !hideRiskTicketActions.value && canWriteTicket.value && (!isClosed.value || ticketDefinition.value?.resolution === 'exact')),
  retry: false,
})

const customFields = computed(() => {
  if (ticketDefinition.value?.resolution === 'exact') {
    return actionsQuery.data.value?.fields ?? ticketDefinition.value.fields ?? []
  }
  return ticketDefinition.value?.resolution === 'legacy' ? typeFieldsQuery.data.value ?? [] : []
})

const customValue = (key: string): unknown => {
  const cd = (ticket.value?.custom_data ?? {}) as Record<string, unknown>
  return cd[key]
}
// richtext 只展示服务端消毒 HTML；同单内容变化由字段缓存统一跟进。
const renderedHtml = useRenderedRichtext(
  () => customFields.value.filter((f) => f.field_type === 'richtext').map((f) => ({
    key: f.field_key,
    src: String(customValue(f.field_key) ?? ''),
  })),
  renderRichtextApi,
)
const formatCustomValue = (f: TicketTypeFieldDef): string => {
  const v = customValue(f.field_key)
  if (v === undefined || v === null) return '—'
  if (f.field_type === 'tips') return f.field_label
  if (typeof v === 'boolean') return v ? '是' : '否'
  // 空数组兜底（file 未传等）：String([]) 得空串会渲染成空白单元格
  if (Array.isArray(v) && !v.length) return '—'
  return String(v)
}

const availableActions = computed(() => actionsQuery.isSuccess.value && !hideRiskTicketActions.value ? actionsQuery.data.value?.actions ?? [] : [])
const selectedAction = ref<InstanceAction | null>(null)
let selectedSession: number | undefined
const actionDialog = computed(() => {
  const action = selectedAction.value
  return action && (action.fields.length || action.commentRequired) ? action : null
})
const transition = createTransitionSubmission({
  send: transitionInstanceApi,
  newKey: newTicketOperationKey,
})
const transitionRefreshing = ref(false)
const transitionNotice = ref('')
const attachments = ref<InstanceType<typeof TicketAttachments>>()
let attachmentsNeedRefresh = false
onActivated(() => {
  active.value = true
  if (!attachmentsNeedRefresh) return
  attachmentsNeedRefresh = false
  void attachments.value?.refresh()
})
const canUseOtherWrites = computed(() => canWriteTicket.value && !transition.state.busy && !transitionRefreshing.value
  && transition.state.phase !== 'unknown' && transition.state.phase !== 'refresh')
const canUseOrdinaryLifecycle = computed(() => canUseOtherWrites.value && !activeRiskWorkflow.value)
const canUseLegacyClose = computed(() => canUseOrdinaryLifecycle.value && ticketDefinition.value?.resolution === 'legacy')
const selectedActionCurrent = computed(() => {
  const selected = selectedAction.value
  return availableActions.value.some(action => action.id === selected?.id && action.to === selected.to
    && action.expectedRevision === selected.expectedRevision && action.definitionVersion === selected.definitionVersion)
})
const transitionNeedsRefresh = computed(() => transition.state.phase === 'refresh'
  || (!!selectedAction.value && !selectedActionCurrent.value && transition.state.phase !== 'unknown'))

function clearSelectedAction() {
  selectedAction.value = null
  selectedSession = undefined
  transitionNotice.value = ''
  transition.reset()
}

watch(ticketId, () => {
  attachmentsNeedRefresh = false
  clearSelectedAction()
}, { flush: 'sync' })
onBeforeUnmount(clearSelectedAction)

async function refreshTransitionState() {
  if (!canQueryTicket.value || transitionRefreshing.value) return
  transitionRefreshing.value = true
  const source = ticketId.value
  try {
    await refreshAll(source)
    if (!actionDialog.value && transition.state.phase === 'refresh'
      && ticketId.value === source && ticketQuery.isSuccess.value && !actionsQuery.isError.value) {
      const message = transition.state.message
      clearSelectedAction()
      transitionNotice.value = message
    }
  } finally {
    transitionRefreshing.value = false
  }
}

function openTransition(action: InstanceAction) {
  if (!canWriteTicket.value || transitionRefreshing.value || transition.state.busy
    || transition.state.phase === 'unknown' || transition.state.phase === 'refresh') return
  clearSelectedAction()
  selectedSession = getSessionGeneration()
  selectedAction.value = action
  if (!actionDialog.value) void submitTransition()
}

function dismissTransition() {
  if (active.value && !transition.state.busy && transition.state.phase !== 'unknown') clearSelectedAction()
}

async function submitTransition(evidence?: { custom_data_patch: Record<string, unknown>; comment?: string }) {
  const action = selectedAction.value
  if (!action || !canWriteTicket.value || transitionRefreshing.value || transition.state.busy || transitionNeedsRefresh.value) return
  const source = ticketId.value
  const generation = getSessionGeneration()
  if (selectedSession !== generation) {
    clearSelectedAction()
    return
  }
  const accepted = transition.state.phase === 'unknown'
    ? await transition.retry()
    : await transition.submit({
      id: source, to: action.to,
      ...(action.expectedRevision !== undefined ? { expected_revision: action.expectedRevision, definition_version: action.definitionVersion } : {}),
      ...evidence,
    })
  if (ticketId.value !== source || selectedAction.value !== action) return
  if (generation !== getSessionGeneration()) {
    clearSelectedAction()
    return
  }
  if (accepted) {
    clearSelectedAction()
    if (active.value) ElMessage.success(`已转换到 ${STATUS_LABEL[action.to] ?? action.to}`)
    attachmentsNeedRefresh = !active.value
    await Promise.all([
      active.value ? refreshTransitionState() : refreshAll(source),
      active.value ? attachments.value?.refresh() : undefined,
    ])
  } else if (transition.state.phase === 'refresh') {
    await refreshTransitionState()
  }
}

// ─── S10 B10-2 标签（默认共享；挂/自摘=读可见，摘他人挂的=update 权由后端兜底）───
const tagRows = computed(() => (tagsQuery.data.value ?? []) as TagRow[])
const tagInput = ref('')
const tagSaving = ref(false)

async function refreshTags() {
  await queryClient.invalidateQueries({ queryKey: ['ticket', 'tags'] })
}

async function addTag() {
  if (!canUseOtherWrites.value) return
  const v = tagInput.value.trim()
  if (!v) return
  tagSaving.value = true
  try {
    await addTicketTagsApi({ ticket_id: ticketId.value, tags: [v] })
    tagInput.value = ''
    await refreshTags()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '添加标签失败')
  } finally {
    tagSaving.value = false
  }
}

async function removeTag(row: TagRow) {
  if (!canUseOtherWrites.value) return
  try {
    await removeTicketTagApi({ ticket_id: ticketId.value, tag: row.tag })
    await refreshTags()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '移除失败（摘他人挂的需编辑权限）')
  }
}

// ─── S10 B10-1 抄送（L2 特例通道：抄送即可见；自加/自摘=读可见，加/摘他人=update 权）───
const ccRows = computed(() => (ccQuery.data.value ?? []) as TicketCCRow[])
const ccForm = reactive({ userId: '' })
const ccSaving = ref(false)

const ccLabel = (cc: TicketCCRow) => (cc.name ? `${cc.name}${cc.employee_no ? `(${cc.employee_no})` : ''}` : `用户 #${cc.user_id}`)

async function refreshCC() {
  await queryClient.invalidateQueries({ queryKey: ['ticket', 'cc'] })
}

async function doAddCC(userIds: string[]) {
  if (!canUseOtherWrites.value) return
  ccSaving.value = true
  try {
    await addTicketCCApi({ ticket_id: ticketId.value, user_ids: userIds })
    ElMessage.success('已抄送')
    ccForm.userId = ''
    await refreshCC()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '抄送失败')
  } finally {
    ccSaving.value = false
  }
}

function addCC() {
  if (!ccForm.userId) return
  void doAddCC([ccForm.userId])
}

/** 抄送我：读可见面动作（无需 update 权） */
function addSelfCC() {
  const me = userStore.profile?.id
  if (!me) return
  if (ccRows.value.some((c) => c.user_id === me)) {
    ElMessage.info('你已在抄送列表中')
    return
  }
  void doAddCC([me])
}

async function removeCC(cc: TicketCCRow) {
  if (!canUseOtherWrites.value) return
  try {
    await removeTicketCCApi({ ticket_id: ticketId.value, user_id: cc.user_id })
    ElMessage.success('已移除')
    await refreshCC()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '移除失败（摘他人需编辑权限）')
  }
}

// ── B1-7 批3（三路F-E-4）：字典引用选项预载——select/multi_select 显示 label 而非 code ──
const dictCache = ref<Record<string, Array<{ value: string; label: string }>>>({})
const dictErrors = ref<Record<string, string>>({})
const dictPending = new Map<string, Promise<void>>()
async function loadDictionary(code: string) {
  if (!code || dictCache.value[code]) return
  if (dictPending.has(code)) return dictPending.get(code)
  dictErrors.value[code] = ''
  const pending = (async () => {
    try {
      // 存量回显继续含停用项，与建单可选项的口径不同。
      const items = await getDictItemsByCodeApi(code, true, { _silentError: true })
      dictCache.value[code] = (items ?? []).map(i => ({ value: i.code, label: i.label }))
    } catch (err) {
      dictErrors.value[code] = apiReadError(err, '字典回显加载失败，请重试')
    } finally {
      dictPending.delete(code)
    }
  })()
  dictPending.set(code, pending)
  return pending
}
watch(() => customFields.value, fs => {
  const codes = new Set<string>()
  for (const f of fs) {
    const raw = f.field_options
    if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'string' && raw[0].startsWith('dict:')) codes.add(raw[0].slice(5))
  }
  codes.forEach(code => { void loadDictionary(code) })
}, { immediate: true })

/** 选项 label 解析（三形态与 create 页 optionsOf 同款——dict 引用展开缓存，兜底原值） */
function labelOf(f: TicketTypeFieldDef, v: string): string {
  const raw = f.field_options
  if (Array.isArray(raw)) {
    let opts: Array<{ value: string; label: string }>
    if (raw.length === 1 && typeof raw[0] === 'string' && raw[0].startsWith('dict:')) {
      opts = dictCache.value[raw[0].slice(5)] ?? []
    } else {
      opts = raw.map((o) =>
        typeof o === 'object' && o !== null && 'value' in (o as Record<string, unknown>)
          ? { value: String((o as Record<string, unknown>).value), label: String((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value) }
          : { value: String(o), label: String(o) },
      )
    }
    return opts.find((o) => o.value === v)?.label ?? v
  }
  return v
}


function formatTime(iso?: string): string {
  if (!iso) return '—'
  return formatDateTime(iso)
}

/** 动作后统一失效（close/assign/update 无有效响应体——S10 靠失效刷新，勿依赖返回值） */
async function refreshAll(source = ticketId.value) {
  await queryClient.invalidateQueries({ queryKey: ['ticket', 'detail', source] })
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['ticket', 'comments', source] }),
    queryClient.invalidateQueries({ queryKey: ['ticket', 'relations', source] }),
    queryClient.invalidateQueries({ queryKey: ['ticket', 'transitions', source] }),
  ])
}

/** 从错误响应提取后端 message（动作类对话框内联呈现——非纯 toast） */
function backendMessage(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败，请稍后重试'
}

// ─── 编辑（ticket:update——patch 三字段）───
const editVisible = ref(false)
const editLoading = ref(false)
const editError = ref('')
const editFormRef = ref<FormInstance>()
const editForm = reactive({ title: '', description: '', priority: 3 })

function openEdit() {
  if (!canUseOtherWrites.value || !ticket.value) return
  Object.assign(editForm, {
    title: ticket.value.title,
    description: ticket.value.description,
    priority: ticket.value.priority,
  })
  editError.value = ''
  editVisible.value = true
}

async function submitEdit() {
  if (!canUseOtherWrites.value) return
  const source = ticketId.value
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid || !canUseOtherWrites.value || ticketId.value !== source) return
  editLoading.value = true
  editError.value = ''
  try {
    await updateTicketApi(source, {
      title: editForm.title,
      description: editForm.description || undefined,
      priority: editForm.priority,
    })
    ElMessage.success('工单已更新')
    editVisible.value = false
    await refreshAll()
  } catch (err: unknown) {
    editError.value = backendMessage(err) // 10006 类并发冲突亦内联（重开即读到最新）
  } finally {
    editLoading.value = false
  }
}

// ─── 分派（ticket:assign——open↔assigned 自动推状态）───
const assignVisible = ref(false)
const assignLoading = ref(false)
const assignError = ref('')
const assignForm = reactive({ userId: '', escalationSupervisor: '' })

function openAssign() {
  if (!canUseOrdinaryLifecycle.value) return
  assignForm.userId = ''
  assignForm.escalationSupervisor = ''
  assignError.value = ''
  assignVisible.value = true
}

async function submitAssign() {
  if (!canUseOrdinaryLifecycle.value) return
  const uid = assignForm.userId.trim()
  if (!/^\d+$/.test(uid)) {
    assignError.value = '请填写数字用户 ID'
    return
  }
  assignLoading.value = true
  assignError.value = ''
  try {
    await assignTicketApi(ticketId.value, uid, assignForm.escalationSupervisor.trim() || undefined)
    ElMessage.success('已分派')
    assignVisible.value = false
    await refreshAll()
  } catch (err: unknown) {
    assignError.value = backendMessage(err)
  } finally {
    assignLoading.value = false
  }
}

async function unassign() {
  if (!canUseOrdinaryLifecycle.value) return
  const source = ticketId.value
  try {
    await ElMessageBox.confirm('取消分派后工单将回到「待处理」，确认？', '取消分派', { type: 'warning' })
  } catch {
    return
  }
  if (!canUseOrdinaryLifecycle.value || ticketId.value !== source) return
  try {
    await assignTicketApi(source, null)
    ElMessage.success('已取消分派')
    await refreshAll()
  } catch (err: unknown) {
    ElMessage.error(backendMessage(err))
  }
}

// ─── 关闭（ticket:close——可选关闭说明，S10 close 带 comment）───
const closeVisible = ref(false)
const closeLoading = ref(false)
const closeError = ref('')
const closeForm = reactive({ comment: '' })

function openClose() {
  if (!canUseLegacyClose.value) return
  closeForm.comment = ''
  closeError.value = ''
  closeVisible.value = true
}

async function submitClose() {
  if (!canUseLegacyClose.value) return
  closeLoading.value = true
  closeError.value = ''
  try {
    await closeTicketApi(ticketId.value, closeForm.comment || undefined)
    ElMessage.success('工单已关闭')
    closeVisible.value = false
    await refreshAll()
  } catch (err: unknown) {
    closeError.value = backendMessage(err) // 非法状态转换 90002 / 已关闭 90004 内联
  } finally {
    closeLoading.value = false
  }
}

// ─── 删除（ticket:delete——软删，回列表）───
async function onDelete() {
  if (!canUseOrdinaryLifecycle.value) return
  const source = ticketId.value
  try {
    await ElMessageBox.confirm(`确认删除工单 #${ticketId.value}？删除后列表不再展示。`, '危险操作', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  if (!canUseOrdinaryLifecycle.value || ticketId.value !== source) return
  try {
    await deleteTicketApi(source)
    ElMessage.success('已删除')
    router.push('/tickets')
  } catch (err: unknown) {
    ElMessage.error(backendMessage(err))
  }
}

// ─── 评论/备注（comment 公开 / note 内部——服务端按可见性过滤返回）───
const composer = reactive({ content: '', internal: false })
const composerLoading = ref(false)
const composerError = ref('')
/** 评论接口无分页——超过该条数提示截断风险（01 §8-W4 全部展示+上限提示） */
const COMMENT_DISPLAY_LIMIT = 200

async function submitComposer() {
  if (!canUseOtherWrites.value) return
  const content = composer.content.trim()
  if (!content) {
    composerError.value = '请输入内容'
    return
  }
  composerLoading.value = true
  composerError.value = ''
  try {
    if (composer.internal) {
      await createTicketNoteApi(ticketId.value, content)
    } else {
      await createTicketCommentApi(ticketId.value, content)
    }
    composer.content = ''
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'comments', ticketId.value] })
  } catch (err: unknown) {
    composerError.value = backendMessage(err)
  } finally {
    composerLoading.value = false
  }
}

// ─── 关联（ticket:relation——远程搜索下拉自动补全；正反向判重 409/自关联 400 内联）───
/** 已建关联快速跳转（#id 直达对方详情——详情路由 /tickets/:id，非缓存页新建实例） */
function goTicket(id: string) {
  void router.push(`/tickets/${id}`)
}
/** 搜索候选「查看」：新标签打开候选单详情（当前页关联表单态保留） */
function openInTab(id: string) {
  window.open(`/#/tickets/${id}`, '_blank')
}
const relationSession = createRelationSession({
  source: () => ticketId.value,
  active: () => canUseOtherWrites.value,
  lookup: listTicketRelationCandidatesApi,
  save: createTicketRelationApi,
  refresh: (source, target) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['ticket', 'relations', source] }, { throwOnError: true }),
    queryClient.invalidateQueries({ queryKey: ['ticket', 'relations', target] }, { throwOnError: true }),
  ]),
  saved: target => ElMessage.success(`已关联 #${target}`),
})
const relation = relationSession.state
watch([ticketId, canUseOtherWrites], relationSession.reset, { flush: 'sync' })
onBeforeUnmount(relationSession.reset)

function onRelationInput(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  // Element Plus first records the native input value on the target. An
  // ancestor capture handler can rerender the select before it records it.
  if (!event.target.value.trim() || (event instanceof InputEvent && event.isComposing)) relationSession.clear()
  else relationSession.search(event.target.value)
}


</script>

<template>
  <div class="fill-page p-4" v-loading="ticketQuery.isLoading.value">
    <el-alert
      v-if="ticketQuery.isError.value"
      :title="apiReadError(ticketQuery.error.value, '工单详情加载失败，请重试', '当前工单不可用')"
      type="error" show-icon :closable="false"
    >
      <el-button size="small" :loading="ticketQuery.isFetching.value" @click="ticketQuery.refetch()">重试读取</el-button>
    </el-alert>
    <div v-if="ticket" class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
    <el-card shadow="never" class="mb-4">
      <template #header>
        <div class="flex items-center gap-3 flex-wrap">
          <span class="font-semibold">#{{ ticketId }} {{ ticket?.title ?? '…' }}</span>
          <el-tag v-if="ticket" size="small">{{ STATUS_LABEL[ticket.status] ?? ticket.status }}</el-tag>
          <div class="flex-1" />
          <el-button link size="small" @click="$router.back()">返回</el-button>
        </div>
      </template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="类型">{{ typeLabel }}</el-descriptions-item>
        <el-descriptions-item v-if="ticketDefinition && 'reference' in ticketDefinition && ticketDefinition.reference" label="规则版本">
          {{ ticketDefinition.reference.definition_version }}
        </el-descriptions-item>
        <el-descriptions-item label="优先级">{{ ticket?.priority ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="SLA 截止">
          <span :class="ticket?.sla_due_at && ticket.status !== 'closed' ? 'text-[var(--el-color-danger)]' : ''">
            {{ formatTime(ticket?.sla_due_at) }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTime(ticket?.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ formatTime(ticket?.updated_at) }}</el-descriptions-item>
        <el-descriptions-item label="创建人">
          <UserNameText :name="ticket?.created_by_name" :no="ticket?.created_by_no" :fallback="ticket?.created_by" />
        </el-descriptions-item>
        <el-descriptions-item label="处理人">
          <UserNameText :name="ticket?.assignee_name" :no="ticket?.assignee_no" :fallback="ticket?.assigned_to ?? '未分派'" />
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="ticketDefinition?.resolution === 'degraded'" title="只能查看，原流程规则缺失"
        type="warning" show-icon :closable="false" class="mt-4"
      />
      <el-alert
        v-if="actionsQuery.isError.value && canWriteTicket"
        :title="apiReadError(actionsQuery.error.value, '可用动作加载失败，请刷新工单', '当前工单不可用')"
        type="error" show-icon :closable="false" class="mt-4"
      >
        <el-button size="small" :loading="transitionRefreshing" @click="refreshTransitionState">刷新工单</el-button>
      </el-alert>
      <el-alert v-if="transitionNotice" :title="transitionNotice" class="mt-4" type="warning" show-icon @close="transitionNotice = ''" />
      <el-alert
        v-if="transition.state.message && (!actionDialog || !canWriteTicket)" :title="transition.state.message"
        type="error" show-icon :closable="false" class="mt-4"
      >
        <el-button v-if="transition.state.phase === 'unknown'" size="small" :loading="transition.state.busy" :disabled="!canWriteTicket" @click="submitTransition()">原操作重试</el-button>
        <el-button v-if="transition.state.phase === 'refresh'" size="small" :loading="transitionRefreshing" @click="refreshTransitionState">刷新工单</el-button>
      </el-alert>
      <div v-if="canWriteTicket" class="mt-4 flex gap-2 flex-wrap">
        <template v-if="!isClosed && !activeRiskWorkflow">
        <el-button
          v-for="action in availableActions"
          :key="action.id"
          type="primary"
          plain
          size="small"
          :loading="transition.state.busy && selectedAction?.id === action.id"
          :disabled="transition.state.busy || transitionRefreshing || transition.state.phase === 'unknown' || transition.state.phase === 'refresh'"
          :data-testid="`btn-transition-${action.to}`"
          @click="openTransition(action)"
        >{{ action.title }}</el-button>
        </template>
        <el-button v-if="!isClosed && userStore.hasPermission('ticket:update')" :disabled="!canUseOtherWrites" @click="openEdit">编辑</el-button>
        <el-button v-if="!isClosed && !activeRiskWorkflow && userStore.hasPermission('ticket:assign')"
          :disabled="!canUseOtherWrites" type="primary" @click="openAssign">分派</el-button>
        <el-button v-if="!isClosed && !activeRiskWorkflow && ticket.assigned_to && userStore.hasPermission('ticket:assign')"
          :disabled="!canUseOtherWrites" @click="unassign">取消分派</el-button>
        <el-button v-if="!isClosed && !activeRiskWorkflow && canUseLegacyClose && userStore.hasPermission('ticket:close')"
          type="warning" @click="openClose">关闭</el-button>
        <el-button v-if="!activeRiskWorkflow && userStore.hasPermission('ticket:delete')"
          :disabled="!canUseOtherWrites" type="danger" plain @click="onDelete">删除</el-button>
      </div>
      <div v-if="riskWorkflowContext && canInspectRiskWorkflow" class="mt-4">
        <el-button data-testid="open-risk-remediation" @click="riskWorkflowVisible = true">逐资产办理与复测</el-button>
        <el-button v-if="canReopenRiskCommand || Object.values(riskCommandPermissions).some(Boolean)" data-testid="open-risk-workflow-commands"
          @click="riskCommandsVisible = true">分派、接单与风险接受</el-button>
      </div>
      <el-alert v-if="riskWorkflowNotice" :title="riskWorkflowNotice" type="warning" :closable="false" class="mt-2" />
    </el-card>


    <section v-if="taskRuns.length" aria-labelledby="ticket-task-results-heading" data-testid="ticket-task-results">
      <el-card shadow="hover" class="mb-4">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <h2 id="ticket-task-results-heading" class="m-0 text-base font-semibold">任务结果</h2>
            <el-button size="small" :loading="ticketQuery.isFetching.value" data-testid="ticket-task-results-refresh"
              @click="ticketQuery.refetch()">刷新任务结果</el-button>
          </div>
        </template>
        <ul class="m-0 list-none p-0" aria-live="polite" :aria-busy="ticketQuery.isFetching.value">
          <li v-for="run in taskRuns" :key="run.operation_id" class="border-0 border-b border-solid border-[var(--el-border-color-lighter)] py-3 last:border-b-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="m-0 text-sm font-semibold">{{ taskActionLabels.get(run.action) ?? '工单任务' }}</h3>
              <el-tag size="small" :type="run.status === 'succeeded' ? 'success' : run.status === 'failed_no_effect' ? 'danger' : 'info'">
                {{ run.reason === 'document_outcome_unconfirmed' ? '结果待核实' : taskStatusLabels.get(run.status) ?? '状态待核实' }}
              </el-tag>
            </div>
            <template v-if="run.status === 'succeeded' && run.result">
              <p v-if="'report_profile' in run.result" class="my-2 text-sm">
                已提交证据字段 {{ run.result.submitted_field_count }} 项，{{ run.result.has_comment ? '已附说明' : '未附说明' }}
              </p>
              <p v-else class="my-2 text-sm">
                清单数据版本 {{ run.result.document_revision }}{{ run.result.noop ? '，数据已是目标值' : '' }}
              </p>
            </template>
            <p v-if="run.reason" class="my-2 text-sm">{{ taskReasonLabels.get(run.reason) ?? '原因暂不可用' }}</p>
            <dl class="mt-2 mb-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--el-text-color-secondary)]">
              <div><dt class="inline">来源节点 </dt><dd class="m-0 inline">{{ STATUS_LABEL[run.node] ?? run.node }}</dd></div>
              <div><dt class="inline">原工单版本 </dt><dd class="m-0 inline">{{ run.ticket_revision }}</dd></div>
              <div><dt class="inline">创建时间 </dt><dd class="m-0 inline">{{ formatTime(run.created_at) }}</dd></div>
              <div v-if="run.completed_at"><dt class="inline">完成时间 </dt><dd class="m-0 inline">{{ formatTime(run.completed_at) }}</dd></div>
              <div class="min-w-0 break-all"><dt class="inline">操作号 </dt><dd class="m-0 inline">{{ run.operation_id }}</dd></div>
              <div class="min-w-0 break-all"><dt class="inline">任务号 </dt><dd class="m-0 inline">{{ run.task_id }}</dd></div>
            </dl>
          </li>
        </ul>
      </el-card>
    </section>

    <el-card shadow="hover" class="mb-4">
      <template #header><span class="font-semibold">描述</span></template>
      <pre class="ticket-description whitespace-pre-wrap text-sm" data-testid="ticket-description">{{ ticket?.description || '（无描述）' }}</pre>
    </el-card>

    <!-- B1-5 自定义字段回显（01 号 §3.5——"填了看不见"痛点收口件） -->
    <el-alert
      v-if="ticketDefinition?.resolution === 'legacy' && typeFieldsQuery.isError.value"
      :title="apiReadError(typeFieldsQuery.error.value, '工单字段加载失败，请重试')"
      type="error" show-icon :closable="false" class="mb-4"
    >
      <el-button size="small" @click="typeFieldsQuery.refetch()">重试读取</el-button>
    </el-alert>
    <el-card v-if="customFields.length" shadow="hover" class="mb-4">
      <template #header><span class="font-semibold">自定义字段</span></template>
      <template v-for="(message, code) in dictErrors" :key="code">
        <el-alert v-if="message" :title="message" type="error" :closable="false"><el-button size="small" @click="loadDictionary(code)">重试字段选项</el-button></el-alert>
      </template>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item
          v-for="f in customFields"
          :key="f.field_key"
          :label="f.field_label"
          :span="f.field_type === 'richtext' || f.field_type === 'textarea' ? 2 : 1"
        >
          <!-- richtext=服务端渲染 HTML（goldmark+bluemonday 消毒 SSOT——非前端自渲染） -->
          <!-- eslint-disable-next-line vue/no-v-html -- XSS SSOT：服务端 goldmark+bluemonday 消毒出站 HTML（F-E-1 修复 2026-10-22——不直接注入 MD 源文本） -->
          <div v-if="f.field_type === 'richtext' && renderedHtml[f.field_key]?.html" class="richtext-view" v-html="renderedHtml[f.field_key]?.html" />
          <span v-else-if="f.field_type === 'multi_select' && Array.isArray(customValue(f.field_key))">
            <!-- B1-7 批3（三路F-E-4）：字典项显示 label 而非 code -->
            <el-tag v-for="v in customValue(f.field_key) as string[]" :key="v" size="small" class="mr-1">{{ labelOf(f, v) }}</el-tag>
          </span>
          <span v-else-if="(f.field_type === 'select' || f.field_type === 'radio') && customValue(f.field_key) != null">{{
            labelOf(f, String(customValue(f.field_key)))
          }}</span>
          <!-- B1-6 批3 file 字段闭环（2026-10-30 审计补）：create 端 object_key 数组入
               custom_data，详情此前落 String() 裸 key 兜底——渲染代理下载链接（同附件面）。
               注：后端建单时会把 file 字段 key 自动绑附件区（file_name 友好名在彼处），
               此处链接文本用「附件 N」避免与附件卡重复裸 uuid -->
          <span v-else-if="f.field_type === 'file' && Array.isArray(customValue(f.field_key)) && (customValue(f.field_key) as string[]).length">
            <a
              v-for="(k, i) in customValue(f.field_key) as string[]"
              :key="k" :href="`/api/v1/files/${k}`" target="_blank" rel="noopener"
              :title="k" class="mr-2 text-[var(--el-color-primary)] hover:underline"
            >{{ `附件 ${i + 1}` }}</a>
          </span>
          <span v-else>{{ formatCustomValue(f) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- B5-3 工单附件区（05 号 §5——列表/上传/删除/下载，代理端点稳定 URL） -->
    <el-card shadow="hover" class="mb-4">
      <template #header><span class="font-semibold">附件</span></template>
      <TicketAttachments ref="attachments" :ticket-id="ticketId" :can-edit="canUseOtherWrites" />
    </el-card>

    <!-- S10 B10-1 抄送人区（抄送即可见——被抄送人收通知并可见此单；摘他人无权由后端 403 兜底） -->
    <el-card shadow="hover" class="mb-4" data-testid="ticket-cc-card">
      <template #header>
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="font-semibold">抄送（{{ ccRows.length }}）</span>
          <div v-if="canUseOtherWrites" class="flex items-center gap-2">
            <el-button size="small" :loading="ccSaving" data-testid="cc-self" @click="addSelfCC">抄送我</el-button>
            <UserPicker v-model="ccForm.userId" :context="{ purpose: 'cc', ticketId }" :active="active" class="!w-[220px]" />
            <el-button size="small" type="primary" plain :disabled="!ccForm.userId" :loading="ccSaving" data-testid="cc-add" @click="addCC">添加抄送</el-button>
          </div>
        </div>
      </template>
      <div v-if="ccRows.length" class="flex flex-wrap gap-2">
        <el-tag
          v-for="cc in ccRows"
          :key="cc.user_id"
          :closable="canUseOtherWrites"
          :data-testid="`cc-row-${cc.user_id}`"
          @close="removeCC(cc)"
        >{{ ccLabel(cc) }}</el-tag>
      </div>
      <el-alert v-if="ccQuery.isError.value" :title="apiReadError(ccQuery.error.value, '抄送列表加载失败，请重试')" type="error" show-icon :closable="false">
        <el-button size="small" @click="ccQuery.refetch()">重试读取</el-button>
      </el-alert>
      <span v-else-if="ccQuery.isSuccess.value && !ccRows.length" class="text-xs text-gray-400">暂无抄送人</span>
    </el-card>

    <!-- S10 B10-2 标签（默认共享——挂载人留痕；摘他人挂的由后端 update 权兜底） -->
    <el-card shadow="hover" class="mb-4" data-testid="ticket-tags-card">
      <template #header>
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="font-semibold">标签</span>
          <div v-if="canUseOtherWrites" class="flex items-center gap-2">
            <el-input
              v-model="tagInput" placeholder="输入标签回车添加" maxlength="50" class="!w-[200px]"
              data-testid="tag-input" @keyup.enter="addTag"
            />
            <el-button size="small" type="primary" plain :disabled="!tagInput.trim()" :loading="tagSaving" @click="addTag">添加</el-button>
          </div>
        </div>
      </template>
      <div v-if="tagRows.length" class="flex flex-wrap gap-2">
        <el-tag
          v-for="row in tagRows"
          :key="row.tag"
          :closable="canUseOtherWrites"
          :data-testid="`tag-${row.tag}`"
          @close="removeTag(row)"
        >{{ row.tag }}</el-tag>
      </div>
      <el-alert v-if="tagsQuery.isError.value" :title="apiReadError(tagsQuery.error.value, '标签加载失败，请重试')" type="error" show-icon :closable="false">
        <el-button size="small" @click="tagsQuery.refetch()">重试读取</el-button>
      </el-alert>
      <span v-else-if="tagsQuery.isSuccess.value && !tagRows.length" class="text-xs text-gray-400">暂无标签</span>
    </el-card>

    <!-- 评论/备注（S10 分层：is_internal 标内部备注；可见性由服务端过滤） -->
    <el-card shadow="hover" class="mb-4">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">评论与备注</span>
          <span v-if="commentsQuery.isSuccess.value" class="text-xs text-gray-400">
            共 {{ commentsQuery.data.value?.length ?? 0 }} 条（全部加载——接口无分页{{ (commentsQuery.data.value?.length ?? 0) >= COMMENT_DISPLAY_LIMIT ? '，超长历史请联系管理员' : '' }}）
          </span>
        </div>
      </template>

      <div class="space-y-3 mb-4">
        <div v-for="c in commentsQuery.data.value ?? []" :key="c.id" class="border rounded p-3">
          <div class="flex items-center gap-2 mb-1">
            <UserNameText class="text-xs" :name="c.created_by_name" :no="c.created_by_no" :fallback="`用户 #${c.user_id}`" />
            <el-tag v-if="c.is_internal" size="small" type="warning">内部备注</el-tag>
            <span class="text-xs text-gray-400">{{ formatTime(c.created_at) }}</span>
          </div>
          <div class="text-sm whitespace-pre-wrap">{{ c.content }}</div>
        </div>
        <el-alert v-if="commentsQuery.isError.value" :title="apiReadError(commentsQuery.error.value, '评论与备注加载失败，请重试')" type="error" show-icon :closable="false">
          <el-button size="small" @click="commentsQuery.refetch()">重试读取</el-button>
        </el-alert>
        <el-empty v-else-if="commentsQuery.isSuccess.value && !commentsQuery.data.value?.length" description="暂无评论" :image-size="60" />
      </div>

      <div v-if="canUseOtherWrites && userStore.hasAny('ticket:comment', 'ticket:note')" class="border-t pt-3">
        <el-input
          v-model="composer.content" type="textarea" :rows="2"
          :placeholder="composer.internal ? '内部备注内容（仅创建人/处理人/admin 可见）' : '公开评论内容'"
        />
        <div class="mt-2 flex items-center gap-3">
          <el-checkbox v-permission="'ticket:note'" v-model="composer.internal">内部备注</el-checkbox>
          <el-button type="primary" size="small" :loading="composerLoading" @click="submitComposer">
            {{ composer.internal ? '发表备注' : '发表评论' }}
          </el-button>
          <span v-if="composerError" class="text-xs text-[var(--el-color-danger)]">{{ composerError }}</span>
        </div>
      </div>
    </el-card>

    <!-- 关联工单（正反向渲染；判重 409/自关联 400 内联） -->
    <el-card shadow="hover">
      <template #header><span class="font-semibold">关联工单</span></template>
      <div class="space-y-2 mb-4">
        <div v-for="r in relationsQuery.data.value ?? []" :key="r.id" class="flex items-center gap-2 text-sm">
          <el-tag size="small" type="info">{{ r.relation_type || 'related' }}</el-tag>
          <template v-if="r.source_ticket_id === ticketId">
            <span>关联 → <el-link type="primary" class="!align-baseline" @click="goTicket(r.target_ticket_id)">#{{ r.target_ticket_id }}</el-link></span>
          </template>
          <template v-else>
            <span>被关联 ← <el-link type="primary" class="!align-baseline" @click="goTicket(r.source_ticket_id)">#{{ r.source_ticket_id }}</el-link></span>
          </template>
        </div>
        <div v-if="relationsQuery.isError.value" class="flex gap-2 items-center">
          <el-alert :title="apiReadError(relationsQuery.error.value, '关联列表加载失败，请重试', '当前工单不可用')" type="error" show-icon :closable="false" />
          <el-button size="small" @click="relationsQuery.refetch()">重试读取</el-button>
        </div>
        <el-empty v-else-if="relationsQuery.isSuccess.value && !relationsQuery.data.value?.length" description="暂无关联" :image-size="60" />
      </div>

      <div v-if="canUseOtherWrites && userStore.hasPermission('ticket:relation')" class="border-t pt-3">
        <div class="flex items-center gap-2" @input="onRelationInput" @compositionend="onRelationInput">
          <!-- 候选由服务端按当前关联资格返回；提交仍会重新校验双端授权。 -->
          <el-select
            :model-value="relation.target" filterable remote clearable :disabled="relation.saving"
            :debounce="0" @update:model-value="relationSession.choose"
            :remote-method="relationSession.search" :loading="relation.searching" @clear="relationSession.clear"
            :no-match-text="relation.searchError || '无符合条件的工单'"
            :no-data-text="relation.searchError || (relation.searched ? '无符合条件的工单' : '输入标题或工单号')"
            placeholder="搜索标题或工单号" class="!w-[340px]"
          >
            <el-option v-for="o in relation.options" :key="o.id" :value="o.id" :label="`#${o.id} ${o.title}`">
              <span class="flex items-center gap-2">
                <span>{{ `#${o.id} ${o.title}` }}</span>
                <el-tag size="small" type="info">{{ STATUS_LABEL[o.status] ?? o.status }}</el-tag>
                <!-- 查看详情：新标签打开不丢已填关联态；@click.stop 防触发选中/收起下拉 -->
                <el-link type="primary" class="!h-auto ml-auto !align-baseline" @click.stop="openInTab(o.id)">查看</el-link>
              </span>
            </el-option>
          </el-select>
          <el-button size="small" :loading="relation.saving" :disabled="relation.searching" @click="relationSession.submit">建立关联</el-button>
        </div>
        <div v-if="relation.searchError" class="mt-2 flex gap-2 items-center">
          <el-alert :title="relation.searchError" type="error" show-icon :closable="false" />
          <el-button size="small" @click="relationSession.retry">重试搜索</el-button>
        </div>
        <el-alert v-if="relation.saveError" :title="relation.saveError" type="error" show-icon class="mt-2" :closable="false" />
      </div>
    </el-card>

    <!-- 编辑对话框 -->
    </div>
    <RemediationDialog
      v-model="riskWorkflowVisible"
      :ticket-id="ticketId"
      :attachments="attachments?.evidenceSources ?? []"
      :references="publicEvidence"
      :can-read="canInspectRiskWorkflow"
      :current-actor-id="userStore.profile?.id ?? ''"
      :refresh-context="refreshRiskWorkflowContext"
      :can-finish="hasRiskAction('finish') && assignedActor && riskWorkflowContext?.status === 'in_progress'"
      :can-review="hasRiskAction('review') && riskWorkflowContext?.status === 'pending_verify'
        && riskWorkflowContext?.items.some(item => item.is_risk_owner)"
      :can-handoff="hasRiskAction('handoff')"
      :ticket-actions="availableActions"
      @result="onRiskWorkflowResult"
      @read-denied="onRiskWorkflowReadDenied"
    />
    <RemediationCommandDialog
      v-model="riskCommandsVisible"
      :current="riskCommandContext"
      :can-read="canInspectRiskWorkflow"
      :refresh-context="refreshRiskWorkflowContext"
      :permissions="riskCommandPermissions"
      :assigned-to="ticket?.assigned_to"
      :current-actor-id="userStore.profile?.id ?? ''"
      :inspect-operation="getRemediationOperationApi"
      :ticket-actions="availableActions"
      @operation="retainRiskCommand"
      @result="onRiskWorkflowResult"
    />


    <TransitionActionDialog
      v-if="actionDialog"
      :model-value="canWriteTicket"
      :action="actionDialog"
      :submitting="transition.state.busy || transitionRefreshing"
      :failure="transition.state.message"
      :retry-only="transition.state.phase === 'unknown'"
      :refresh-required="transitionNeedsRefresh"
      @update:model-value="visible => { if (!visible) dismissTransition() }"
      @confirm="submitTransition"
      @refresh="refreshTransitionState"
    />
    <el-dialog v-if="canUseOtherWrites" v-model="editVisible" :close-on-click-modal="false" title="编辑工单" width="520px">
      <el-form ref="editFormRef" :model="editForm" label-width="80px">
        <el-form-item label="标题" required>
          <el-input v-model="editForm.title" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="editForm.priority" :disabled="activeRiskWorkflow" class="!w-[140px]">
            <el-option label="紧急" :value="1" />
            <el-option label="高" :value="2" />
            <el-option label="中" :value="3" />
            <el-option label="低" :value="4" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="4" />
        </el-form-item>
      </el-form>
      <el-alert v-if="editError" :title="editError" type="error" show-icon class="mb-2" :closable="false" />
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分派对话框 -->
    <el-dialog v-if="canUseOrdinaryLifecycle" v-model="assignVisible" :close-on-click-modal="false" title="分派工单" width="420px">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="处理人">
          <UserPicker v-model="assignForm.userId" :context="{ purpose: 'assign', ticketId }" :active="active && assignVisible" />
        </el-form-item>
        <!-- S10 B10-4：催办上级人工指定（可选——随分派事务落库；不填保持不动） -->
        <el-form-item label="催办上级">
          <UserPicker v-model="assignForm.escalationSupervisor" :context="{ purpose: 'assign', ticketId }" :active="active && assignVisible" />
        </el-form-item>
      </el-form>
      <div class="text-xs text-gray-400 mb-2">分派后工单进入「已分派」（B1-2 起选人补全替代手输 ID——姓名（工号）搜索）。</div>
      <el-alert v-if="assignError" :title="assignError" type="error" show-icon :closable="false" />
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" :loading="assignLoading" @click="submitAssign">分派</el-button>
      </template>
    </el-dialog>

    <!-- 关闭对话框（可选关闭说明） -->
    <el-dialog v-if="canUseLegacyClose" v-model="closeVisible" :close-on-click-modal="false" title="关闭工单" width="460px">
      <el-input v-model="closeForm.comment" type="textarea" :rows="3" placeholder="关闭说明（可选）" />
      <el-alert v-if="closeError" :title="closeError" type="error" show-icon class="mt-2" :closable="false" />
      <template #footer>
        <el-button @click="closeVisible = false">取消</el-button>
        <el-button type="warning" :loading="closeLoading" @click="submitClose">确认关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ticket-description { overflow-wrap: anywhere; }
.richtext-view :deep(img) { max-width: 100%; border-radius: 4px; }
.richtext-view :deep(code) { background: var(--el-fill-color-light); padding: 1px 4px; border-radius: 2px; font-size: 0.9em; }
.richtext-view :deep(pre) { background: var(--el-fill-color-light); padding: 8px; border-radius: 4px; overflow-x: auto; }
</style>
