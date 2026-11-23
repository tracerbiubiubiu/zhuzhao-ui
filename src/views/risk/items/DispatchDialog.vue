<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCheckbox, ElDialog, ElEmpty, ElTag } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn, ProTableFetcher } from '@/components/ProTable/types'
import UserNameText from '@/components/UserNameText/index.vue'
import { applyDispatch, getDispatchOperation, planDispatch, type DispatchInput, type DispatchPlan, type DispatchPlanInput, type DispatchResult, type TicketReference } from '@/api/risk/dispatch'
import type { RiskViewDto } from '@/api/risk/contracts'
import { formatDateTime } from '@/utils/datetime'
import { getSessionGeneration } from '@/common/auth/tokenStorage'
import { apiErrorMessage } from '@/utils/apiError'

// 入口与权限由风险页提供；目标只能来自该页获准的配置，不在此查找或猜默认值。
const props = defineProps<{
  modelValue: boolean
  items: DispatchPlanInput['items']
  targetOrgId: string
  targetTypeCode: string
  canDispatch: boolean
  canRead: boolean
  canReadTickets: boolean
  itemDetails?: RiskViewDto[]
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  result: [value: DispatchResult]
  'open-ticket': [ticket: TicketReference]
  // 主页面应保持本组件挂载；可保留此三元组供离页前受权核查。
  operation: [input: DispatchInput]
}>()

const plan = ref<DispatchPlan | null>(null)
const result = ref<DispatchResult | null>(null)
const confirmed = ref(false)
const busy = ref(false)
const error = ref('')
const attempt = ref<DispatchInput | null>(null)
const uncertain = ref(false)
const savedOperation = ref('')
const verificationNote = ref('')
const boundDetails = ref<RiskViewDto[]>([])
const displayDetails = computed(() => sessionInvalid.value || !props.canRead ? [] : boundDetails.value)
const sessionInvalid = ref(false)
const boundInput = ref<DispatchPlanInput | null>(null)
const resultVersion = ref(0)
const statusElement = ref<HTMLElement | null>(null)
const previewButton = ref<{ $el: HTMLElement } | null>(null)
let previewGeneration = 0
let session = getSessionGeneration()
let disposed = false

function input(): DispatchPlanInput {
  return { items: props.items.map(item => ({ risk_id: item.risk_id, expected_revision: item.expected_revision })), target_org_id: props.targetOrgId, target_type_code: props.targetTypeCode }
}
const inputKey = computed(() => JSON.stringify(input()))
const inputChanged = computed(() => !!boundInput.value && inputKey.value !== JSON.stringify(boundInput.value))
const displayInput = computed(() => boundInput.value ?? input())
const previewGroups = computed(() => sessionInvalid.value || !props.canRead ? [] : plan.value?.groups ?? [])
const resultGroups = computed(() => sessionInvalid.value || !props.canRead ? [] : result.value?.groups ?? [])
// 不把缺少引用当成没有在办票；预计涉及票数与新建票数不是同一个指标。
const projectedTickets = computed(() => previewGroups.value.length)
const finished = computed(() => !sessionInvalid.value && result.value?.status === 'completed' && !uncertain.value)
const dismissLocked = computed(() => busy.value || uncertain.value)
const canPreview = computed(() => !sessionInvalid.value && props.modelValue && props.canRead && props.canDispatch && !busy.value && !attempt.value && props.items.length > 0 && !!props.targetOrgId && !!props.targetTypeCode)
const canConfirm = computed(() => !sessionInvalid.value && props.modelValue && props.canRead && props.canDispatch && !busy.value && !attempt.value && !!plan.value && projectedTickets.value > 0 && confirmed.value && !inputChanged.value && Date.parse(plan.value.expires_at) > Date.now())
const canInspect = computed(() => !sessionInvalid.value && props.modelValue && props.canRead && !busy.value && !!attempt.value)
const canRetry = computed(() => !sessionInvalid.value && props.modelValue && props.canRead && props.canDispatch && !busy.value && !!attempt.value && !finished.value)

function sessionMatches() { return !sessionInvalid.value && session === getSessionGeneration() }
function checkSession() {
  if (sessionMatches()) return true
  sessionInvalid.value = true
  busy.value = false
  uncertain.value = false
  confirmed.value = false
  // 旧操作仍属于原会话；撤销所有引用，不能借新会话自动重放。
  if (plan.value) plan.value = { ...plan.value, groups: plan.value.groups.map(group => ({ ...group, ticket: undefined })) }
  if (result.value) result.value = { ...result.value, groups: result.value.groups.map(group => ({ ...group, ticket: undefined, items: group.items.map(item => ({ ...item, ticket: undefined })) })) }
  error.value = '会话已切换，原操作仅供原会话受权核查。请关闭本窗口，勿作为新派单重做。'
  return false
}
function openTicket(ticket: TicketReference) {
  if (checkSession() && props.canRead && props.canReadTickets) emit('open-ticket', ticket)
}

function resetPreview() {
  previewGeneration++
  plan.value = null
  boundDetails.value = []
  boundInput.value = null
  confirmed.value = false
  error.value = ''
  busy.value = false
}
watch(() => [props.modelValue, inputKey.value], () => {
  if (!checkSession()) return
  if (attempt.value) return // 关闭、权限或选择改变都保留原号；完成后显式开始下一次。
  resetPreview()
}, { flush: 'sync' })
onScopeDispose(() => { disposed = true; previewGeneration++ })

async function focusStatus() {
  await nextTick()
  if (!disposed && props.modelValue && session === getSessionGeneration()) statusElement.value?.focus()
}
function focusPreview(event?: Event) {
  event?.preventDefault()
  if (attempt.value) statusElement.value?.focus()
  else previewButton.value?.$el.focus()
}

async function preview() {
  if (!checkSession() || !canPreview.value) return
  resetPreview()
  session = getSessionGeneration()
  const generation = previewGeneration
  const requestInput = input()
  const requestDetails = (props.itemDetails ?? []).filter(row => requestInput.items.some(item => item.risk_id === row.risk.id && item.expected_revision === row.risk.revision)).map(row => ({ ...row, risk: { ...row.risk }, asset_ref: row.asset_ref ? { ...row.asset_ref } : null }))
  const current = () => !disposed && generation === previewGeneration && checkSession() && props.modelValue
  busy.value = true
  try {
    const response = await planDispatch(requestInput)
    if (!current()) return
    plan.value = response
    boundInput.value = requestInput
    boundDetails.value = requestDetails
  } catch (cause) {
    if (current()) error.value = apiErrorMessage(cause, '预览失败，请重试')
  } finally {
    if (current()) { busy.value = false; await focusStatus() }
  }
}

async function submit() {
  if (!checkSession()) return
  if (!attempt.value && plan.value && Date.parse(plan.value.expires_at) <= Date.now()) {
    confirmed.value = false
    error.value = '预览已过期，请重新预览后确认'
    return
  }
  if (!canConfirm.value || !plan.value) return
  try {
    attempt.value = { operation_id: crypto.randomUUID(), plan_id: plan.value.plan_id, plan_hash: plan.value.plan_hash }
  } catch {
    error.value = '无法生成操作号，请保留预览后重试'
    return
  }
  savedOperation.value = attempt.value.operation_id
  emit('operation', { ...attempt.value })
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
function startNext() {
  if (!checkSession() || !finished.value || busy.value || !props.canDispatch || !props.canRead) return
  attempt.value = null
  result.value = null
  uncertain.value = false
  verificationNote.value = ''
  resetPreview()
}
function revokeTicketReferences() {
  if (result.value) {
    result.value = { ...result.value, groups: result.value.groups.map(group => ({ ...group, ticket: undefined, items: group.items.map(item => ({ ...item, ticket: undefined })) })) }
    resultVersion.value++
  }
}
watch(() => props.canRead, allowed => {
  if (!allowed) {
    revokeTicketReferences()
    if (!attempt.value) resetPreview()
  }
}, { flush: 'sync' })
async function run(readOnly = false) {
  if (disposed || !checkSession() || !props.modelValue || (!readOnly && !props.canDispatch) || !props.canRead || !attempt.value || busy.value) return
  // 首个 await 前拍下并锁住，不读取后续 props，不再生成操作号或 plan。
  const original = { ...attempt.value }
  busy.value = true
  error.value = ''
  verificationNote.value = ''
  uncertain.value = true
  // 每次读取/续办都重新确认票读权，旧引用立即撤销。
  revokeTicketReferences()
  const current = () => !disposed && checkSession()
  try {
    const response = readOnly ? await getDispatchOperation(original.operation_id) : await applyDispatch(original)
    if (!current() || !props.canRead) return
    if (response.operation_id !== original.operation_id || response.plan_id !== original.plan_id) throw new Error('回执与原操作不匹配')
    result.value = response
    resultVersion.value++
    uncertain.value = false
    savedOperation.value = original.operation_id
    if (readOnly) verificationNote.value = '只读核查成功，未续建；只返回已提交组，未返回的组仍待核查。原操作号已保留在本页面内存，刷新或离页前请另行保存。'
    emit('result', response)
  } catch (cause) {
    if (current()) {
      const status = (cause as { response?: { status?: number } } | null)?.response?.status
      error.value = readOnly && status === 404
        ? '当前操作结果仍未知，404 不代表未提交；请保留原操作号，稍后只读核查。'
        : `${apiErrorMessage(cause, readOnly ? '只读核查失败' : '提交结果未确认')}。请按原操作号核查，保留原预览。`
    }
  } finally {
    if (current()) { busy.value = false; await focusStatus() }
  }
}
function close() {
  checkSession()
  if (!dismissLocked.value) emit('update:modelValue', false)
}
function updateVisible(value: boolean) {
  if (!value) close()
}

const reasons: Record<string, string> = {
  missing_personal_owner: '缺少具体负责人，须先确认负责人',
  incompatible_group_scope: '目标或获准范围不兼容', group_capacity_exceeded: '已达单票资产容量上限',
  unverified_risk: '风险事实尚未核实完整', duplicate_asset: '同组存在重复资产', duplicate_risk_id: '重复选择风险',
  view_stale: '风险版本已变更，请刷新后重新预览', risk_missing: '风险当前不可用', revision_changed: '风险版本已变更',
  status_not_dispatchable: '风险状态不允许派单', owner_unconfirmed: '负责人尚未确认', owner_changed: '负责人已变更',
  owner_unavailable: '负责人当前不可用', risk_identity_changed: '风险依据已变更', group_scope_drift: '分组或目标范围已变更',
  mapping_missing: '缺少获准目标配置', mapping_disabled: '目标配置已停用', dispatch_forbidden: '当前无派单权限', plan_expired: '预览已过期，未完成组无法派单',
}
function reasonText(reason: string) { return reasons[reason] ?? reason }
function itemResultText(value: string) {
  return ({ created: '已建票', linked: '已追加', already_linked: '已有关联', denied: '权限拒绝', invalid: '输入无效', conflict: '发生冲突' } as Record<string, string>)[value] ?? value
}
const previewColumns: ProTableColumn[] = [
  { prop: 'group_key', label: '分组', minWidth: 120, wrap: true },
  { prop: 'owner_user_id', label: '具体负责人', width: 120 },
  { prop: 'items', label: '风险 / 资产', minWidth: 240, wrap: true },
  { prop: 'ticket', label: '已授权原票引用', minWidth: 140, wrap: true },
]
const resultColumns: ProTableColumn[] = [
  { prop: 'group_key', label: '分组', minWidth: 120, wrap: true },
  { prop: 'status', label: '组结果', width: 100 },
  { prop: 'items', label: '逐项结果与原因', minWidth: 280, wrap: true },
  { prop: 'ticket', label: '已授权原票引用', minWidth: 140, wrap: true },
]
const previewFetcher: ProTableFetcher = async ({ page, page_size }) => ({ list: previewGroups.value.slice((page - 1) * page_size, page * page_size), total: previewGroups.value.length })
const resultFetcher: ProTableFetcher = async ({ page, page_size }) => ({ list: resultGroups.value.slice((page - 1) * page_size, page * page_size), total: resultGroups.value.length })
</script>

<template>
  <el-dialog :model-value="modelValue" title="风险派单" width="860px" :close-on-click-modal="false"
    :close-on-press-escape="!dismissLocked" :show-close="!dismissLocked" @update:model-value="updateVisible" @opened="focusPreview">
    <div class="dispatch-body">
      <div ref="statusElement" tabindex="-1" role="status" aria-live="polite" class="dispatch-status">
        <p v-if="canRead && sessionMatches()">已选 {{ displayInput.items.length }} 项风险；目标组织 {{ displayInput.target_org_id }}，整改类型 {{ displayInput.target_type_code }}。</p>
        <p v-if="plan && canRead && sessionMatches()">预计涉及 {{ projectedTickets }} 张工单。实际新建或追加以提交结果为准；预览不预留名额。</p>
        <p v-if="attempt">操作号：<code>{{ attempt.operation_id }}</code>（保存在本页面内存，离页前请保存）</p>
        <p v-else-if="savedOperation">上次操作号：<code>{{ savedOperation }}</code></p>
        <p v-if="verificationNote">{{ verificationNote }}</p>
        <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
        <el-alert v-if="!canDispatch" title="当前无派单权限，请受权核查" type="warning" :closable="false" />
        <el-alert v-if="attempt && inputChanged" title="选择或目标已变化，当前仍在核查原操作与原预览。" type="warning" :closable="false" />
        <el-alert v-if="uncertain" title="结果待核查，请保留此窗口并按原操作号核查。" type="warning" :closable="false" />
      </div>
      <template v-if="plan && canRead && sessionMatches()">
        <div>
          <ProTable :key="`${plan.plan_id}-${resultVersion}`" data-testid="dispatch-preview" :columns="previewColumns" :fetcher="previewFetcher" row-key="group_key">
            <template #group_key="{ row }">{{ row.group_key }}</template>
            <template #owner_user_id="{ row }"><UserNameText :fallback="row.owner_user_id" /></template>
            <template #items="{ row }"><ul class="dispatch-items"><li v-for="item in row.items" :key="item.risk_id">
              {{ item.human_key || item.risk_id }} · {{ item.title }}（版本 {{ item.revision }}）
              <template v-for="snapshot in displayDetails.filter(detail => detail.risk.id === item.risk_id && detail.risk.revision === item.revision)" :key="snapshot.risk.id">
                <div v-if="snapshot.asset_ref">原选择资产：{{ snapshot.asset_ref.provider }} / {{ snapshot.asset_ref.external_id }}</div>
                <div v-if="snapshot.owner_user_id">原选择负责人：{{ snapshot.owner_user_id }}</div>
                <div v-if="snapshot.deadline">原选择期限：{{ formatDateTime(snapshot.deadline) }}</div>
              </template>
            </li></ul></template>
            <template #ticket="{ row }">
              <el-button v-if="!attempt && canReadTickets && row.ticket" data-testid="authorized-ticket" link type="primary" @click="openTicket(row.ticket)">{{ row.ticket.ref }}</el-button>
              <span v-else>未返回可查看引用</span>
            </template>
            <template #empty><el-empty description="没有可派分组，请检查阻断项或重新选择" /></template>
          </ProTable>
        </div>
        <div v-if="plan.blocked.length" role="region" aria-label="受阻风险" class="mt-4">
          <p>以下风险不参与本次派单：</p>
          <ul class="dispatch-items"><li v-for="(block, index) in plan.blocked" :key="`${block.risk_id}-${index}`">{{ block.risk_id }}：{{ reasonText(block.reason) }}</li></ul>
        </div>
        <el-checkbox v-if="!attempt && projectedTickets" v-model="confirmed" :disabled="busy || !canDispatch" class="mt-4">我已核对分组、目标和受阻项，确认按此预览派单</el-checkbox>
      </template>
      <div v-if="result && canRead && sessionMatches()" class="mt-4">
        <p>{{ result.status === 'completed' ? '本次派单已完成' : result.status === 'partial' ? '部分组已完成，其余组尚未完成；请核对逐组结果' : '尚有未完成组，请核对原因' }}</p>
        <ProTable :key="resultVersion" data-testid="dispatch-results" :columns="resultColumns" :fetcher="resultFetcher" row-key="group_key">
          <template #group_key="{ row }">{{ row.group_key }}</template>
          <template #status="{ row }"><el-tag :type="row.status === 'completed' ? 'success' : 'danger'">{{ row.status === 'completed' ? '已完成' : '失败' }}</el-tag></template>
          <template #items="{ row }">
            <ul class="dispatch-items"><li v-for="item in row.items" :key="item.risk_id">
              {{ item.risk_id }}：{{ itemResultText(item.result) }}<span v-if="item.reason"> · {{ reasonText(item.reason) }}</span>
              <el-button v-if="canReadTickets && item.ticket" data-testid="authorized-item-ticket" link type="primary" @click="openTicket(item.ticket)">{{ item.ticket.ref }}</el-button>
            </li></ul>
          </template>
          <template #ticket="{ row }">
            <el-button v-if="canReadTickets && row.ticket" data-testid="authorized-ticket" link type="primary" @click="openTicket(row.ticket)">{{ row.ticket.ref }}</el-button>
            <span v-else>未返回可查看引用</span>
          </template>
        </ProTable>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="dismissLocked" @click="close">{{ attempt && !finished ? '关闭并保留本次操作' : '关闭' }}</el-button>
      <el-button v-if="!attempt" ref="previewButton" :disabled="!canPreview" :loading="busy" @click="preview">{{ plan ? '重新预览' : '预览派单' }}</el-button>
      <el-button v-if="!attempt" type="primary" :disabled="!canConfirm" @click="submit">确认派单</el-button>
      <el-button v-if="attempt" data-testid="dispatch-inspect" :disabled="!canInspect" :loading="busy" @click="inspect">按原号核查（只读）</el-button>
      <el-button v-if="attempt && !finished" data-testid="dispatch-resume" type="primary" :disabled="!canRetry" :loading="busy" @click="retry">按原号续办（可能提交未完成组）</el-button>
      <el-button v-if="attempt && finished" :disabled="busy || !canDispatch || !canRead" @click="startNext">开始下一次派单</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dispatch-body { max-height: 60vh; overflow: auto; overflow-wrap: anywhere; }
.dispatch-status:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.dispatch-items { margin: 0; padding-left: 18px; white-space: normal; }
</style>
