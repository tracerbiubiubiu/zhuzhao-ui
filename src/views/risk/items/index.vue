<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElAlert, ElButton, ElCard, ElCheckbox, ElDatePicker, ElDescriptions, ElDescriptionsItem, ElDialog,
  ElDrawer, ElEmpty, ElForm, ElFormItem, ElInput, ElOption, ElSelect, ElTag,
} from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn, ProTableFetcherParams } from '@/components/ProTable/types'
import { usePermission } from '@/common/auth'
import {
  isRiskId, ownerUnconfirmed, riskListParams, riskReceiptMatches, validateRiskRegistration,
  type RiskAssignCommand, type RiskAssessCommand, type RiskCommand, type RiskCreateCommand,
  type RiskFilters, type RiskId, type RiskLevel, type RiskReader, type RiskRegistrationDraft,
  type RiskState, type RiskTreatment, type RiskViewDto, type RiskWriter,
} from '@/api/risk/contracts'
import { riskHttpReader, riskHttpWriter } from '@/api/risk'
import type { DispatchInput, DispatchPlanInput, DispatchResult, TicketReference } from '@/api/risk/dispatch'
import { newRiskOperationId } from '@/api/risk/operationKey'
import { formatDateTime } from '@/utils/datetime'
import { riskReadAborted, useRiskReads } from './riskReads'
import { createWriteSessions, type WritePhase } from './riskWrites'
import DispatchDialog from './DispatchDialog.vue'

// 菜单组件路径 risk/items/index；嵌套页面行 keep-alive 名 = 菜单 code（viewNames 哨兵派生）。
defineOptions({ name: 'risk_list' })
const props = defineProps<{ reader?: RiskReader, writer?: RiskWriter }>()
const { hasPerm, hasRoute } = usePermission()
const router = useRouter()
const active = ref(true)
// 读入口绑定菜单页面行 route:/risks（MenuService 页面行不授按钮码，000089 B 案种子）
const canRead = computed(() => hasRoute('/risks'))
const canRegister = computed(() => active.value && canRead.value && hasPerm('risk:manage'))
const dispatchReadAllowed = computed(() => active.value && canRead.value)
// 复用当前风险写入口；派单的组织/类型映射与对象权仍由服务端预览及执行校验。
const canDispatch = computed(() => canRegister.value)
// 默认走真实请求端口（@/api/risk）；props 注入仅作测试替身。
const reader = computed(() => active.value && canRead.value ? props.reader ?? riskHttpReader : undefined)
const writer = computed(() => active.value && canRegister.value ? props.writer ?? riskHttpWriter : undefined)
const { list, detail, fetchList, clearList, openDetail, closeDetail } = useRiskReads(() => reader.value)

const levelNames: Record<RiskLevel, string> = { urgent: '紧急', high: '高', medium: '中', low: '低' }
const statusNames: Record<RiskState, string> = {
  new: '待评估', assessed: '已评估', remediating: '整改中',
  pending_verify: '待复测', accepted: '已接受', closed: '已关闭',
}
const statusTagTypes: Record<RiskState, 'info' | 'primary' | 'warning' | 'success'> = {
  new: 'info', assessed: 'primary', remediating: 'warning', pending_verify: 'warning', accepted: 'success', closed: 'info',
}
const treatmentNames: Record<RiskTreatment, string> = { mitigate: '缓解', accept: '接受', transfer: '转移', avoid: '规避' }
// 核实/定级仅服务端 new|assessed 状态可用（交接清单 §3）；其余动作可用性由服务端 L3 判定。
const ASSESSABLE_STATES: readonly RiskState[] = ['new', 'assessed']
const assessable = (row: RiskViewDto) => ASSESSABLE_STATES.includes(row.status)

const riskColumns: ProTableColumn[] = [
  { prop: 'number', label: '编号', minWidth: 135 },
  { prop: 'title', label: '标题', minWidth: 180 },
  { prop: 'level', label: '整改级别', width: 96 },
  { prop: 'status', label: '状态', width: 96 },
  { prop: 'owner', label: '责任', width: 150 },
  { prop: 'deadline', label: '整改期限', width: 170 },
  { prop: 'actions', label: '操作', width: 200, showOverflowTooltip: false, wrap: true },
]
const columns = computed<ProTableColumn[]>(() => canDispatch.value
  ? [{ prop: 'dispatchSelect', label: '选择', width: 64, showOverflowTooltip: false }, ...riskColumns]
  : riskColumns)
const table = ref<InstanceType<typeof ProTable>>()
const emptyFilters = (): RiskFilters => ({ q: '', level: '' })
const filters = ref(emptyFilters())
let filterTimer: ReturnType<typeof setTimeout> | undefined

function cancelFilterTimer() {
  clearTimeout(filterTimer)
  filterTimer = undefined
}

function applyFilters() {
  cancelFilterTimer()
  if (reader.value) table.value?.refresh({ resetPage: true })
}

function onFilterEnter(event: Event) {
  if ('isComposing' in event && event.isComposing) return
  event.preventDefault()
  applyFilters()
}

function resetFilters() {
  filters.value = emptyFilters()
  applyFilters()
}

watch(filters, () => {
  cancelFilterTimer()
  clearDispatchSelection()
  clearList()
  if (reader.value) filterTimer = setTimeout(applyFilters, 300)
}, { deep: true, flush: 'sync' })

async function fetchPage(params: ProTableFetcherParams) {
  if (filterTimer !== undefined) throw riskReadAborted()
  clearDispatchSelection()
  const page = await fetchList(riskListParams(params, filters.value))
  currentRiskRows.value = page.list
  return page
}

const showPager = computed(() => list.value.kind === 'ready'
  || (list.value.kind === 'empty' && list.value.total > 0))

// 仅从当前成功读面选择；换页、筛选、重读和撤权均撤销勾选，不猜测隐藏对象。
const currentRiskRows = ref<RiskViewDto[]>([])
const selectedRiskRows = ref<RiskViewDto[]>([])
const dispatchTarget = reactive({ orgId: '', typeCode: '' })
const dispatchVisible = ref(false)
const dispatchInput = ref<DispatchPlanInput>({ items: [], target_org_id: '', target_type_code: '' })
const dispatchItemDetails = ref<RiskViewDto[]>([])
const dispatchOperation = ref<DispatchInput | null>(null)
const dispatchSelectionValid = computed(() => canDispatch.value && list.value.kind === 'ready'
  && selectedRiskRows.value.length > 0 && isRiskId(dispatchTarget.orgId.trim()) && !!dispatchTarget.typeCode.trim())

function snapshotRisk(row: RiskViewDto): RiskViewDto {
  return {
    ...row, risk: { ...row.risk },
    asset_ref: row.asset_ref ? { ...row.asset_ref } : null,
    source_severity: row.source_severity ? { ...row.source_severity } : null,
    dispatch_blockers: [...(row.dispatch_blockers ?? [])],
  }
}

function clearDispatchSelection() {
  currentRiskRows.value = []
  selectedRiskRows.value = []
}

function riskSelected(row: RiskViewDto) {
  return selectedRiskRows.value.some(item => item.risk.id === row.risk.id && item.risk.revision === row.risk.revision)
}

function selectDispatchRisk(row: RiskViewDto, checked: unknown) {
  if (!canDispatch.value || list.value.kind !== 'ready') return
  const current = currentRiskRows.value.find(item => item.risk.id === row.risk.id && item.risk.revision === row.risk.revision)
  if (!current) return
  selectedRiskRows.value = selectedRiskRows.value.filter(item => item.risk.id !== current.risk.id)
  if (checked === true) selectedRiskRows.value.push(snapshotRisk(current))
}

function openDispatch() {
  if (!dispatchSelectionValid.value) return
  dispatchItemDetails.value = selectedRiskRows.value.map(snapshotRisk)
  dispatchInput.value = {
    items: dispatchItemDetails.value.map(row => ({ risk_id: row.risk.id, expected_revision: row.risk.revision })),
    target_org_id: dispatchTarget.orgId.trim(), target_type_code: dispatchTarget.typeCode.trim(),
  }
  dispatchVisible.value = true
}

function rememberDispatchOperation(input: DispatchInput) {
  dispatchOperation.value = { ...input }
}

function reopenDispatch() {
  if (dispatchReadAllowed.value && dispatchOperation.value) dispatchVisible.value = true
}

function receiveDispatchResult(_result: DispatchResult) {
  if (reader.value) void table.value?.refresh()
}

function openDispatchTicket(ticket: TicketReference | undefined) {
  if (!dispatchReadAllowed.value || !hasPerm('ticket:read') || !ticket
    || !isRiskId(ticket.id) || typeof ticket.ref !== 'string' || !ticket.ref.trim()) return
  void router.push(`/tickets/${ticket.id}`)
}

// ─── 写会话：登记/核实/责任各占一个槽位，operation_id 在会话内保持稳定 ───
type CreateInput = Omit<RiskCreateCommand, 'operation_id'>
type AssessInput = Omit<RiskAssessCommand, 'operation_id'>
type AssignInput = Omit<RiskAssignCommand, 'operation_id'>
interface ActionTarget {
  id: RiskId
  human_key: string
  revision: string
}
const REGISTRATION_KEY = 'registration'
const assessKeyOf = (id: RiskId) => `assess:${id}`
const assignKeyOf = (id: RiskId) => `assign:${id}`

// writeVersion 只作会话查询的重算触发；会话本体在管理器内（对话框关闭不销毁）。
const writeVersion = ref(0)
const createWrites = createWriteSessions<CreateInput, unknown>({
  newId: newRiskOperationId,
  run: (input, operationId) => writer.value!.create({ ...input, operation_id: operationId }),
})
const assessWrites = createWriteSessions<AssessInput, unknown>({
  newId: newRiskOperationId,
  run: (input, operationId) => writer.value!.assess({ ...input, operation_id: operationId }),
})
const assignWrites = createWriteSessions<AssignInput, unknown>({
  newId: newRiskOperationId,
  run: (input, operationId) => writer.value!.assign({ ...input, operation_id: operationId }),
})
const createSession = computed(() => (writeVersion.value, createWrites.session(REGISTRATION_KEY)))
const assessSession = computed(() => (writeVersion.value,
  assessTarget.value ? assessWrites.session(assessKeyOf(assessTarget.value.id)) : undefined))
const assignSession = computed(() => (writeVersion.value,
  assignTarget.value ? assignWrites.session(assignKeyOf(assignTarget.value.id)) : undefined))
const createPending = computed(() => createSession.value?.phase === 'pending')
const assessPending = computed(() => assessSession.value?.phase === 'pending')
const assignPending = computed(() => assignSession.value?.phase === 'pending')

// ─── 提交结果未知的只读核查（断网/超时/5xx ⇒ 待核查，不换号重做） ───
const verifying = ref(false)
const verifyNote = ref('')

/** statusOfError: 404=服务端尚无该号收据（保持待核查）；其余故障=核查请求失败 */
function verifyMutation(session: { phase: WritePhase, operationId: string } | undefined,
  command: RiskCommand, onConfirmed: () => void): Promise<void> | undefined {
  if (!session || session.phase !== 'unknown' || verifying.value || !reader.value) return
  verifying.value = true
  verifyNote.value = ''
  return reader.value.operation(session.operationId).then(receipt => {
    if (!riskReceiptMatches(receipt, session.operationId, command)) {
      verifyNote.value = '核查回执与本次命令不一致，请勿重做；可再次核查、原号重投或放弃此次提交'
      return
    }
    onConfirmed()
  }).catch(error => {
    const status = (error as { response?: { status?: number } } | null)?.response?.status
    verifyNote.value = status === 404
      ? '服务端暂无该操作号收据，保持待核查；可稍后再次核查、原号重投或放弃此次提交'
      : '核查请求失败，请稍后再次核查'
  }).finally(() => {
    verifying.value = false
  })
}

// ─── 登记风险 ───
const blankDraft = (): RiskRegistrationDraft => ({ title: '', description: '', org_id: '', affected_org_id: '', owner_user_id: '' })
const draft = ref(blankDraft())
const registrationVisible = ref(false)
const touched = reactive({ title: false, org_id: false, affected_org_id: false, owner_user_id: false })
const registration = computed(() => validateRiskRegistration(draft.value))

function hydrateCreateDraft(input: CreateInput) {
  draft.value = {
    title: input.title, description: input.description, org_id: input.org_id,
    affected_org_id: input.affected_org_id ?? '', owner_user_id: input.owner_user_id ?? '',
  }
  touched.title = touched.org_id = touched.affected_org_id = touched.owner_user_id = true
}

function openRegistration() {
  if (!canRegister.value) return
  const session = createWrites.session(REGISTRATION_KEY)
  if (session && (session.phase === 'unknown' || session.phase === 'pending')) hydrateCreateDraft(session.input)
  verifyNote.value = ''
  registrationVisible.value = true
}

function closeRegistration() {
  registrationVisible.value = false
  if (createWrites.session(REGISTRATION_KEY)?.phase === 'unknown') return
  draft.value = blankDraft()
  touched.title = touched.org_id = touched.affected_org_id = touched.owner_user_id = false
}

function discardCreate() {
  createWrites.discard(REGISTRATION_KEY)
  writeVersion.value++
  draft.value = blankDraft()
  touched.title = touched.org_id = touched.affected_org_id = touched.owner_user_id = false
  verifyNote.value = ''
}

async function submitRegistration() {
  const current = createSession.value
  const valid = registration.value.draft
  const input: CreateInput | null = current?.phase === 'unknown' ? current.input
    : valid && { ...valid, expected_revision: '0', attributes: {} }
  if (!input || !writer.value || createPending.value) return
  const pending = createWrites.submit(REGISTRATION_KEY, input)
  writeVersion.value++
  const outcome = await pending
  writeVersion.value++
  if (outcome.kind === 'done') {
    closeRegistration()
    void table.value?.refresh()
  } else if (outcome.kind === 'unknown') {
    hydrateCreateDraft(input)
  }
}

/** 只读核查确认提交生效（同号同命令）：销毁会话、关闭对话框并刷新列表 */
function verifyCreate(): Promise<void> | undefined {
  return verifyMutation(createSession.value, 'create', () => {
    createWrites.confirm(REGISTRATION_KEY)
    writeVersion.value++
    closeRegistration()
    void table.value?.refresh()
  })
}

// ─── 核实风险（定级/策略/期限；仅 new|assessed 行开放） ───
const assessVisible = ref(false)
const assessTarget = ref<ActionTarget | null>(null)
const assessForm = reactive<{ level: RiskLevel | '', note: string, treatment: RiskTreatment, deadline: Date | null }>({
  level: '', note: '', treatment: 'mitigate', deadline: null,
})

function resetAssessForm() {
  assessForm.level = ''
  assessForm.note = ''
  assessForm.treatment = 'mitigate'
  assessForm.deadline = null
}

function hydrateAssessForm(input: AssessInput) {
  assessForm.level = input.level
  assessForm.note = input.assessment_note
  assessForm.treatment = input.treatment
  assessForm.deadline = input.deadline ? new Date(input.deadline) : null
}

function openAssess(row: RiskViewDto) {
  if (!canRegister.value || !assessable(row)) return
  assessTarget.value = { id: row.risk.id, human_key: row.risk.human_key, revision: row.risk.revision }
  const session = assessWrites.session(assessKeyOf(row.risk.id))
  if (session && (session.phase === 'unknown' || session.phase === 'pending')) hydrateAssessForm(session.input)
  else resetAssessForm()
  verifyNote.value = ''
  assessVisible.value = true
}

function closeAssess() {
  assessVisible.value = false
  assessTarget.value = null
}

const assessInputValid = computed(() => !!assessTarget.value && !!assessForm.level && !!assessForm.note.trim())

function buildAssessInput(): AssessInput | null {
  const target = assessTarget.value
  if (!target || !assessForm.level) return null
  return {
    id: target.id,
    expected_revision: target.revision,
    level: assessForm.level,
    assessment_note: assessForm.note.trim(),
    treatment: assessForm.treatment,
    ...(assessForm.deadline && { deadline: assessForm.deadline.toISOString() }),
  }
}

async function submitAssess() {
  const current = assessSession.value
  const input = current?.phase === 'unknown' ? current.input : buildAssessInput()
  if (!input || !writer.value || assessPending.value) return
  const pending = assessWrites.submit(assessKeyOf(input.id), input)
  writeVersion.value++
  const outcome = await pending
  writeVersion.value++
  if (outcome.kind === 'done') {
    if (assessTarget.value?.id === input.id) closeAssess()
    refreshAfterMutation(input.id)
  } else if (outcome.kind === 'unknown' && assessTarget.value?.id === input.id) {
    hydrateAssessForm(input)
  } else if (outcome.kind === 'definitive' && outcome.conflict) {
    void table.value?.refresh()
  }
}

function discardAssess() {
  if (!assessTarget.value) return
  assessWrites.discard(assessKeyOf(assessTarget.value.id))
  writeVersion.value++
  resetAssessForm()
  verifyNote.value = ''
}

/** 只读核查确认核实生效（同号同命令）：销毁会话并刷新列表与打开中的详情 */
function verifyAssess(): Promise<void> | undefined {
  const target = assessTarget.value
  if (!target) return
  return verifyMutation(assessSession.value, 'assess', () => {
    assessWrites.confirm(assessKeyOf(target.id))
    writeVersion.value++
    closeAssess()
    refreshAfterMutation(target.id)
  })
}

// ─── 指定责任人（主锚管理者） ───
const assignVisible = ref(false)
const assignTarget = ref<ActionTarget | null>(null)
const assignForm = reactive<{ owner: string, reason: string }>({ owner: '', reason: '' })

function resetAssignForm() {
  assignForm.owner = ''
  assignForm.reason = ''
}

function hydrateAssignForm(input: AssignInput) {
  assignForm.owner = input.owner_user_id
  assignForm.reason = input.reason
}

function openAssign(row: RiskViewDto) {
  if (!canRegister.value) return
  assignTarget.value = { id: row.risk.id, human_key: row.risk.human_key, revision: row.risk.revision }
  const session = assignWrites.session(assignKeyOf(row.risk.id))
  if (session && (session.phase === 'unknown' || session.phase === 'pending')) hydrateAssignForm(session.input)
  else resetAssignForm()
  verifyNote.value = ''
  assignVisible.value = true
}

function closeAssign() {
  assignVisible.value = false
  assignTarget.value = null
}

const assignOwnerValid = computed(() => isRiskId(assignForm.owner.trim()))
const assignInputValid = computed(() => !!assignTarget.value && assignOwnerValid.value && !!assignForm.reason.trim())

function buildAssignInput(): AssignInput | null {
  const target = assignTarget.value
  const owner = assignForm.owner.trim()
  if (!target || !isRiskId(owner)) return null
  return {
    id: target.id,
    expected_revision: target.revision,
    owner_user_id: owner,
    reason: assignForm.reason.trim(),
  }
}

async function submitAssign() {
  const current = assignSession.value
  const input = current?.phase === 'unknown' ? current.input : buildAssignInput()
  if (!input || !writer.value || assignPending.value) return
  const pending = assignWrites.submit(assignKeyOf(input.id), input)
  writeVersion.value++
  const outcome = await pending
  writeVersion.value++
  if (outcome.kind === 'done') {
    if (assignTarget.value?.id === input.id) closeAssign()
    refreshAfterMutation(input.id)
  } else if (outcome.kind === 'unknown' && assignTarget.value?.id === input.id) {
    hydrateAssignForm(input)
  } else if (outcome.kind === 'definitive' && outcome.conflict) {
    void table.value?.refresh()
  }
}

function discardAssign() {
  if (!assignTarget.value) return
  assignWrites.discard(assignKeyOf(assignTarget.value.id))
  writeVersion.value++
  resetAssignForm()
  verifyNote.value = ''
}

/** 只读核查确认责任确认生效（同号同命令）：销毁会话并刷新列表与打开中的详情 */
function verifyAssign(): Promise<void> | undefined {
  const target = assignTarget.value
  if (!target) return
  return verifyMutation(assignSession.value, 'assign', () => {
    assignWrites.confirm(assignKeyOf(target.id))
    writeVersion.value++
    closeAssign()
    refreshAfterMutation(target.id)
  })
}

/** 版本冲突：列表已回读最新 revision，提示关闭后按最新内容重试；不盲目覆盖。 */
function conflictHint(session: { phase: WritePhase, conflict: boolean } | undefined): boolean {
  return !!session && session.phase !== 'unknown' && session.conflict
}

function refreshAfterMutation(id: RiskId) {
  void table.value?.refresh()
  if (detail.value.kind === 'ready' && detail.value.id === id) void openDetail(id)
}

function clearReads() {
  cancelFilterTimer()
  clearDispatchSelection()
  clearList()
  closeDetail()
}

onMounted(applyFilters)
watch(reader, source => {
  clearReads()
  if (source) void nextTick(applyFilters)
}, { flush: 'sync' })
watch(canRegister, allowed => {
  if (!allowed) {
    clearDispatchSelection()
    closeRegistration()
    closeAssess()
    closeAssign()
  }
}, { flush: 'sync' })
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false })
onScopeDispose(clearReads)
</script>

<template>
  <div class="fill-page">
    <el-card class="fill-card" shadow="never">
      <el-alert v-if="!canRead" title="无权查看" type="warning" :closable="false" />
      <ProTable
        v-else
        ref="table"
        :class="{ 'risk-table--hide-rows': list.kind !== 'ready', 'risk-table--hide-pager': !showPager }"
        :aria-busy="list.kind === 'loading'"
        :columns="columns"
        :fetcher="fetchPage"
        :immediate="false"
        row-key="risk.id"
        fill
      >
        <template #search>
          <el-form inline class="risk-filters" @submit.prevent>
            <el-form-item label="关键词">
              <el-input
                v-model="filters.q" clearable placeholder="标题或编号" class="!w-[160px]"
                @keydown.enter="onFilterEnter"
              />
            </el-form-item>
            <el-form-item label="整改级别">
              <el-select v-model="filters.level" clearable value-on-clear="" placeholder="全部" class="!w-[120px]">
                <el-option v-for="(name, value) in levelNames" :key="value" :label="name" :value="value" />
              </el-select>
            </el-form-item>
            <el-form-item class="ml-auto !mr-0">
              <el-button @click="resetFilters">重置</el-button>
              <el-button v-if="canRegister" type="primary" @click="openRegistration">登记风险</el-button>
            </el-form-item>
          </el-form>
        </template>
        <template v-if="canDispatch || (dispatchReadAllowed && dispatchOperation)" #toolbar>
          <div class="risk-dispatch-tools">
            <el-form v-if="canDispatch" inline class="risk-filters" @submit.prevent>
              <el-form-item label="目标组织 ID">
                <el-input v-model="dispatchTarget.orgId" data-testid="dispatch-target-org" inputmode="numeric" placeholder="输入已获准的组织 ID" class="!w-[180px]" />
              </el-form-item>
              <el-form-item label="整改类型代码">
                <el-input v-model="dispatchTarget.typeCode" data-testid="dispatch-target-type" placeholder="输入已获准的类型代码" class="!w-[180px]" />
              </el-form-item>
              <el-form-item>
                <span class="mr-3">已选 {{ selectedRiskRows.length }} 项（当前页）</span>
                <el-button data-testid="risk-dispatch-open" :disabled="!dispatchSelectionValid" type="primary" @click="openDispatch">预览派单</el-button>
              </el-form-item>
            </el-form>
            <el-button v-if="dispatchReadAllowed && dispatchOperation" data-testid="risk-dispatch-progress" @click="reopenDispatch">派单进度</el-button>
          </div>
        </template>
        <template #dispatchSelect="{ row }">
          <el-checkbox
            v-if="canDispatch" :model-value="riskSelected(row)" :disabled="list.kind !== 'ready'"
            :aria-label="`选择 ${row.risk.human_key} 派单`" @update:model-value="value => selectDispatchRisk(row, value)"
          />
        </template>
        <template #number="{ row }">{{ row.risk.human_key }}</template>
        <template #level="{ row }">{{ row.level ? levelNames[row.level as RiskLevel] : '未评估' }}</template>
        <template #status="{ row }">
          <el-tag :type="statusTagTypes[row.status as RiskState]">{{ statusNames[row.status as RiskState] }}</el-tag>
        </template>
        <template #owner="{ row }">
          <template v-if="row.owner_user_id">{{ row.owner_user_id }}</template>
          <el-tag v-else-if="ownerUnconfirmed(row)" type="warning">责任待确认</el-tag>
          <template v-else>—</template>
        </template>
        <template #deadline="{ row }">{{ formatDateTime(row.deadline) || '—' }}</template>
        <template #actions="{ row }">
          <button
            type="button" class="risk-action" :aria-label="`查看 ${row.risk.human_key} 详情`"
            @click="openDetail(row.risk.id)"
          >详情</button>
          <template v-if="canRegister">
            <button
              v-if="assessable(row)" type="button" class="risk-action"
              :aria-label="`核实 ${row.risk.human_key}`" @click="openAssess(row)"
            >核实</button>
            <button
              type="button" class="risk-action" :aria-label="`指定 ${row.risk.human_key} 责任人`"
              @click="openAssign(row)"
            >责任</button>
          </template>
        </template>
      </ProTable>
      <template v-if="reader">
        <div v-if="list.kind === 'error'" class="risk-feedback">
          <el-alert :title="list.message" type="error" :closable="false" />
          <el-button @click="table?.refresh()">重试</el-button>
        </div>
        <el-empty
          v-else-if="list.kind === 'empty'"
          :description="list.total ? '当前页无记录' : '暂无匹配记录'"
          role="status"
        />
        <p v-else-if="list.kind !== 'ready'" role="status">正在加载列表…</p>
      </template>
    </el-card>

    <DispatchDialog
      v-model="dispatchVisible" :items="dispatchInput.items" :target-org-id="dispatchInput.target_org_id"
      :target-type-code="dispatchInput.target_type_code" :item-details="dispatchItemDetails"
      :can-read="dispatchReadAllowed" :can-dispatch="canDispatch"
      :can-read-tickets="dispatchReadAllowed && hasPerm('ticket:read')"
      @operation="rememberDispatchOperation" @result="receiveDispatchResult" @open-ticket="openDispatchTicket"
    />

    <el-drawer
      :model-value="detail.kind !== 'closed'" title="风险详情" direction="rtl"
      size="min(560px, 100vw)" :close-on-press-escape="true"
      @update:model-value="visible => { if (!visible) closeDetail() }"
    >
      <p v-if="detail.kind === 'loading'" role="status">正在加载详情…</p>
      <div v-else-if="detail.kind === 'error'" class="risk-feedback">
        <el-alert :title="detail.message" type="error" :closable="false" />
        <el-button @click="openDetail(detail.id)">重试</el-button>
      </div>
      <el-descriptions v-else-if="detail.kind === 'ready'" :column="1" border>
        <el-descriptions-item label="编号">{{ detail.record.view.risk.human_key }}</el-descriptions-item>
        <el-descriptions-item label="标题">{{ detail.record.view.title }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="statusTagTypes[detail.record.view.status]">{{ statusNames[detail.record.view.status] }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="整改级别">{{ detail.record.view.level ? levelNames[detail.record.view.level] : '未评估' }}</el-descriptions-item>
        <el-descriptions-item label="处置策略">{{ detail.record.view.treatment ? treatmentNames[detail.record.view.treatment] : '—' }}</el-descriptions-item>
        <el-descriptions-item label="责任">
          <template v-if="detail.record.view.owner_user_id">{{ detail.record.view.owner_user_id }}</template>
          <el-tag v-else-if="ownerUnconfirmed(detail.record.view)" type="warning">责任待确认</el-tag>
          <template v-else>—</template>
        </el-descriptions-item>
        <el-descriptions-item label="首次期限">{{ formatDateTime(detail.record.view.init_deadline) || '—' }}</el-descriptions-item>
        <el-descriptions-item label="整改期限">{{ formatDateTime(detail.record.view.deadline) || '—' }}</el-descriptions-item>
        <el-descriptions-item label="来源严重性">
          <template v-if="detail.record.view.source_severity">
            {{ detail.record.view.source_severity.scheme }} / {{ detail.record.view.source_severity.value }}
          </template>
          <template v-else>—</template>
        </el-descriptions-item>
        <el-descriptions-item label="受影响资产">
          <template v-if="detail.record.view.asset_ref">
            {{ detail.record.view.asset_ref.provider }} / {{ detail.record.view.asset_ref.external_id }}
          </template>
          <template v-else>—</template>
        </el-descriptions-item>
        <el-descriptions-item label="风险管理组织">{{ detail.record.view.org_id }}</el-descriptions-item>
        <el-descriptions-item label="受影响组织">{{ detail.record.view.affected_org_id || '—' }}</el-descriptions-item>
        <el-descriptions-item label="说明">
          <div class="risk-description">{{ detail.record.description || '—' }}</div>
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>

    <el-dialog
      v-if="canRegister" :model-value="registrationVisible" title="登记风险" width="min(520px, 100vw)"
      :close-on-click-modal="false" :close-on-press-escape="true"
      @update:model-value="visible => { if (!visible) closeRegistration() }"
    >
      <el-alert
        v-if="createSession?.phase === 'unknown'" :title="createSession.error" type="warning" :closable="false"
      />
      <el-alert v-else-if="createSession?.error" :title="createSession.error" type="error" :closable="false" />
      <p v-if="createSession?.phase === 'unknown'" class="risk-operation-id">
        原操作号（待核查）：<code>{{ createSession.operationId }}</code>
      </p>
      <p v-if="createSession?.phase === 'unknown' && verifyNote" class="risk-verify-note" role="status">{{ verifyNote }}</p>
      <el-form label-position="top" class="mt-4" @submit.prevent>
        <el-form-item label="标题" required :error="touched.title ? registration.errors.title : undefined">
          <el-input v-model="draft.title" :disabled="createPending || createSession?.phase === 'unknown'" @blur="touched.title = true" />
        </el-form-item>
        <el-form-item label="风险管理组织 ID" required :error="touched.org_id ? registration.errors.org_id : undefined">
          <el-input
            v-model="draft.org_id" inputmode="numeric" :disabled="createPending || createSession?.phase === 'unknown'"
            @blur="touched.org_id = true"
          />
        </el-form-item>
        <el-form-item label="受影响组织 ID" :error="touched.affected_org_id ? registration.errors.affected_org_id : undefined">
          <el-input
            v-model="draft.affected_org_id" inputmode="numeric" :disabled="createPending || createSession?.phase === 'unknown'"
            @blur="touched.affected_org_id = true"
          />
        </el-form-item>
        <el-form-item label="责任人 ID" :error="touched.owner_user_id ? registration.errors.owner_user_id : undefined">
          <el-input
            v-model="draft.owner_user_id" inputmode="numeric" placeholder="留空则责任待确认"
            :disabled="createPending || createSession?.phase === 'unknown'" @blur="touched.owner_user_id = true"
          />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="draft.description" type="textarea" :rows="3" :disabled="createPending || createSession?.phase === 'unknown'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          v-if="createSession?.phase === 'unknown'" :disabled="verifying || createPending"
          @click="verifyCreate"
        >{{ verifying ? '核查中…' : '只读核查' }}</el-button>
        <el-button
          v-if="createSession?.phase === 'unknown'" :disabled="verifying"
          @click="discardCreate"
        >放弃此次提交</el-button>
        <el-button v-else @click="closeRegistration">取消</el-button>
        <el-button
          type="primary" :disabled="!registration.draft || createPending || verifying"
          @click="submitRegistration"
        >{{ createPending ? '提交中…' : createSession?.phase === 'unknown' ? '原号重投' : '提交登记' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-if="canRegister" :model-value="assessVisible" title="核实风险" width="min(520px, 100vw)"
      :close-on-click-modal="false" :close-on-press-escape="true"
      @update:model-value="visible => { if (!visible) closeAssess() }"
    >
      <p class="risk-dialog-target">{{ assessTarget?.human_key }}</p>
      <el-alert
        v-if="assessSession?.phase === 'unknown'" :title="assessSession.error" type="warning" :closable="false"
      />
      <el-alert v-else-if="assessSession?.error" :title="assessSession.error" type="error" :closable="false" />
      <p v-if="assessSession?.phase === 'unknown'" class="risk-operation-id">
        原操作号（待核查）：<code>{{ assessSession.operationId }}</code>
      </p>
      <p v-if="assessSession?.phase === 'unknown' && verifyNote" class="risk-verify-note" role="status">{{ verifyNote }}</p>
      <p v-if="conflictHint(assessSession)" class="risk-conflict-hint" role="status">
        列表已刷新到最新内容，请关闭后重试。
      </p>
      <el-form label-position="top" class="mt-4" @submit.prevent>
        <el-form-item label="整改级别" required>
          <el-select v-model="assessForm.level" placeholder="请选择级别" :disabled="assessPending || assessSession?.phase === 'unknown'">
            <el-option v-for="(name, value) in levelNames" :key="value" :label="name" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="处置策略" required>
          <el-select v-model="assessForm.treatment" :disabled="assessPending || assessSession?.phase === 'unknown'">
            <el-option v-for="(name, value) in treatmentNames" :key="value" :label="name" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="整改期限">
          <el-date-picker
            v-model="assessForm.deadline" type="datetime" placeholder="可选，留空按级别策略"
            :disabled="assessPending || assessSession?.phase === 'unknown'" class="!w-full"
          />
        </el-form-item>
        <el-form-item label="核实说明" required>
          <el-input
            v-model="assessForm.note" type="textarea" :rows="3"
            :disabled="assessPending || assessSession?.phase === 'unknown'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          v-if="assessSession?.phase === 'unknown'" :disabled="verifying || assessPending"
          @click="verifyAssess"
        >{{ verifying ? '核查中…' : '只读核查' }}</el-button>
        <el-button v-if="assessSession?.phase === 'unknown'" :disabled="verifying" @click="discardAssess">放弃此次提交</el-button>
        <el-button v-else @click="closeAssess">取消</el-button>
        <el-button
          type="primary" :disabled="!assessInputValid || assessPending || verifying" @click="submitAssess"
        >{{ assessPending ? '提交中…' : assessSession?.phase === 'unknown' ? '原号重投' : '提交核实' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-if="canRegister" :model-value="assignVisible" title="指定责任人" width="min(520px, 100vw)"
      :close-on-click-modal="false" :close-on-press-escape="true"
      @update:model-value="visible => { if (!visible) closeAssign() }"
    >
      <p class="risk-dialog-target">{{ assignTarget?.human_key }}</p>
      <el-alert
        v-if="assignSession?.phase === 'unknown'" :title="assignSession.error" type="warning" :closable="false"
      />
      <el-alert v-else-if="assignSession?.error" :title="assignSession.error" type="error" :closable="false" />
      <p v-if="assignSession?.phase === 'unknown'" class="risk-operation-id">
        原操作号（待核查）：<code>{{ assignSession.operationId }}</code>
      </p>
      <p v-if="assignSession?.phase === 'unknown' && verifyNote" class="risk-verify-note" role="status">{{ verifyNote }}</p>
      <p v-if="conflictHint(assignSession)" class="risk-conflict-hint" role="status">
        列表已刷新到最新内容，请关闭后重试。
      </p>
      <el-form label-position="top" class="mt-4" @submit.prevent>
        <el-form-item label="责任人 ID" required>
          <el-input
            v-model="assignForm.owner" inputmode="numeric" :disabled="assignPending || assignSession?.phase === 'unknown'"
          />
        </el-form-item>
        <el-form-item label="确认说明" required>
          <el-input
            v-model="assignForm.reason" type="textarea" :rows="3"
            :disabled="assignPending || assignSession?.phase === 'unknown'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          v-if="assignSession?.phase === 'unknown'" :disabled="verifying || assignPending"
          @click="verifyAssign"
        >{{ verifying ? '核查中…' : '只读核查' }}</el-button>
        <el-button v-if="assignSession?.phase === 'unknown'" :disabled="verifying" @click="discardAssign">放弃此次提交</el-button>
        <el-button v-else @click="closeAssign">取消</el-button>
        <el-button
          type="primary" :disabled="!assignInputValid || assignPending || verifying" @click="submitAssign"
        >{{ assignPending ? '提交中…' : assignSession?.phase === 'unknown' ? '原号重投' : '确认责任' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.risk-filters {
  display: flex;
  flex-wrap: wrap;
}
.risk-filters :deep(.el-form-item) {
  margin-right: 16px;
  margin-bottom: 8px;
}
/* ProTable 的内置空态和已知总数仅用于成功结果。 */
.risk-table--hide-rows :deep(.pro-table__table),
.risk-table--hide-pager :deep(.el-pagination) {
  display: none;
}
.risk-feedback {
  display: flex;
  align-items: center;
  gap: 12px;
}
.risk-action {
  color: var(--el-color-primary);
  cursor: pointer;
  margin-right: 12px;
}
.risk-action:last-child {
  margin-right: 0;
}
.risk-action:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
.risk-description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.risk-dialog-target {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
}
.risk-operation-id {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
}
.risk-operation-id code {
  color: var(--el-text-color-regular);
  overflow-wrap: anywhere;
}
.risk-verify-note {
  margin: 8px 0 0;
  color: var(--el-color-warning);
}
.risk-conflict-hint {
  margin: 8px 0 0;
  color: var(--el-color-warning);
}
</style>
