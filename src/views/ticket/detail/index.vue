<script setup lang="ts">
/**
 * 工单详情（P4-W4 详情批——评论/备注/关联/流转，03 S10/S11）
 *
 * - 处理动作=分派/取消分派/关闭/编辑/删除（S11：in_progress/pending_verify/rejected
 *   经 API 不可达，勿做流转 UI；closed 后编辑/分派/关闭隐藏——后端 409+90004 兜底）
 * - 评论/备注「全部展示+条数上限提示」（后端无分页，01 §8-W4 勿假设 page/total）；
 *   内部备注分层渲染（可见性由服务端过滤，viewer 只见公开评论——S10）
 * - 关联正反向渲染按 source 判方向；判重 409/自关联 400 内联呈现（勿纯 toast）
 * - 分派对话框填用户 ID（operator 无用户列表权限——不假搜索，ID 即工号外键）
 * - 按钮码（000010/000031 种子）：ticket:update/close/assign/delete/comment/note/relation
 * - 静态路由（§3.2④，菜单外——入口在列表页「详情」按钮，挂 ticket:read 码）
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ElAlert, ElButton, ElCard, ElCheckbox, ElDescriptions, ElDescriptionsItem, ElDialog,
  ElEmpty, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElTag,
} from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  addTicketCCApi, assignTicketApi, closeTicketApi, createTicketCommentApi, createTicketNoteApi,
  createTicketRelationApi, deleteTicketApi, getTicketApi, getTicketCommentsApi,
  getTicketRelationsApi, listAvailableTransitionsApi, listTicketCCApi, listTicketTagsApi,
  listTicketTypesApi, addTicketTagsApi, removeTicketCCApi, removeTicketTagApi,
  transitionTicketApi, STATUS_LABEL, updateTicketApi, type TagRow, type TicketCCRow,
} from '@/api/ticket'
import { useUserStoreWithOut } from '@/store/modules/user'
import UserNameText from '@/components/UserNameText/index.vue'
import { getTicketTypeFieldsApi, type TicketTypeFieldDef , renderRichtextApi } from '@/api/ticket'
import { getDictItemsByCodeApi } from '@/api/system/dict'
import UserPicker from '@/components/UserPicker/index.vue'
import TicketAttachments from '@/components/TicketAttachments.vue'

// keep-alive 契约：name=静态路由名（参数路由——同工单不同 ID 依赖 :key 路由 fullPath 分实例）
defineOptions({ name: 'TicketDetail' })

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()
const userStore = useUserStoreWithOut()

const ticketId = computed(() => String(route.params.id ?? ''))

const ticketQuery = useQuery({
  queryKey: computed(() => ['ticket', 'detail', ticketId.value]),
  queryFn: () => getTicketApi(ticketId.value),
  enabled: computed(() => ticketId.value !== '' && ticketId.value !== 'new'),
})
const commentsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'comments', ticketId.value]),
  queryFn: () => getTicketCommentsApi(ticketId.value),
  enabled: computed(() => ticketId.value !== ''),
})
const relationsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'relations', ticketId.value]),
  queryFn: () => getTicketRelationsApi(ticketId.value),
  enabled: computed(() => ticketId.value !== ''),
})
const ccQuery = useQuery({
  queryKey: computed(() => ['ticket', 'cc', ticketId.value]),
  queryFn: () => listTicketCCApi(ticketId.value),
  enabled: computed(() => ticketId.value !== ''),
})
const tagsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'tags', ticketId.value]),
  queryFn: () => listTicketTagsApi(ticketId.value),
  enabled: computed(() => ticketId.value !== ''),
})
const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })

const ticket = computed(() => ticketQuery.data.value)
const typeLabel = computed(
  () => typesQuery.data.value?.find((t) => t.code === ticket.value?.type_code)?.name ?? ticket.value?.type_code ?? '—',
)
const isClosed = computed(() => ticket.value?.status === 'closed')

// B1-5 自定义字段 schema + 回显（01 号 §3.5——"填了看不见"痛点收口件）
const typeFieldsQuery = useQuery({
  queryKey: ['ticket', 'typeFields', ticket.value?.type_code],
  queryFn: () => getTicketTypeFieldsApi(ticket.value!.type_code),
  enabled: computed(() => !!ticket.value?.type_code),
  staleTime: 60_000,
})
const customFields = computed(() => typeFieldsQuery.data.value ?? [])

// F-E-1 修复：richtext 字段经服务端 render 端点消毒出站 HTML——不直接注入 MD 源
const renderedHtml = ref<Record<string, string>>({})
watch(
  () => customFields.value.filter((f) => f.field_type === 'richtext').map((f) => ({
    key: f.field_key,
    src: String(customValue(f.field_key) ?? ''),
  })).filter((x) => x.src),
  async (items: Array<{ key: string; src: string }>) => {
    for (const { key, src } of items) {
      if (renderedHtml.value[key] !== undefined) continue
      renderedHtml.value[key] = '' // 占位防重复请求
      renderedHtml.value[key] = await renderRichtextApi(src).catch(() => '')
    }
  },
  { immediate: true },
)
const customValue = (key: string): unknown => {
  const cd = (ticket.value?.custom_data ?? {}) as Record<string, unknown>
  return cd[key]
}
const formatCustomValue = (f: TicketTypeFieldDef): string => {
  const v = customValue(f.field_key)
  if (v === undefined || v === null) return '—'
  if (f.field_type === 'tips') return f.field_label
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}

// ─── S3a B3-1 统一转换（available 按用户过滤——condition 语义；叠加 Close/Assign 既有按钮）───
const availableTransitions = ref<string[]>([])
const transitionLoading = ref(false)

async function loadAvailableTransitions() {
  if (!ticketId.value || isClosed.value) return
  try {
    availableTransitions.value = await listAvailableTransitionsApi(ticketId.value)
  } catch {
    availableTransitions.value = []
  }
}

watch(() => [ticketId.value, ticketQuery.data.value?.status], () => void loadAvailableTransitions(), { immediate: true })

async function doTransition(to: string) {
  transitionLoading.value = true
  try {
    await transitionTicketApi({ id: ticketId.value, to })
    ElMessage.success(`已转换到 ${STATUS_LABEL[to] ?? to}`)
    await queryClient.invalidateQueries({ queryKey: ['ticket'] })
    await loadAvailableTransitions()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '转换失败（可能不满足前置条件）')
  } finally {
    transitionLoading.value = false
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

async function doAddCC(userIds: number[]) {
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
  void doAddCC([Number(ccForm.userId)])
}

/** 抄送我：读可见面动作（无需 update 权） */
function addSelfCC() {
  const me = userStore.profile?.id
  if (!me) return
  if (ccRows.value.some((c) => c.user_id === me)) {
    ElMessage.info('你已在抄送列表中')
    return
  }
  void doAddCC([Number(me)])
}

async function removeCC(cc: TicketCCRow) {
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
watch(
  () => customFields.value,
  async (fs) => {
    const codes = new Set<string>()
    for (const f of fs ?? []) {
      const raw = f.field_options
      if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'string' && raw[0].startsWith('dict:')) {
        codes.add(raw[0].slice(5))
      }
    }
    for (const code of codes) {
      if (dictCache.value[code]) continue
      const items = (await getDictItemsByCodeApi(code).catch(() => [])) ?? []
      dictCache.value[code] = items.map((i) => ({ value: i.code, label: i.label }))
    }
  },
  { immediate: true },
)

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
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

/** 动作后统一失效（close/assign/update 无有效响应体——S10 靠失效刷新，勿依赖返回值） */
async function refreshAll() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['ticket', 'detail', ticketId.value] }),
    queryClient.invalidateQueries({ queryKey: ['ticket', 'comments', ticketId.value] }),
    queryClient.invalidateQueries({ queryKey: ['ticket', 'relations', ticketId.value] }),
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
  if (!ticket.value) return
  Object.assign(editForm, {
    title: ticket.value.title,
    description: ticket.value.description,
    priority: ticket.value.priority,
  })
  editError.value = ''
  editVisible.value = true
}

async function submitEdit() {
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid) return
  editLoading.value = true
  editError.value = ''
  try {
    await updateTicketApi(ticketId.value, {
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
  assignForm.userId = ''
  assignForm.escalationSupervisor = ''
  assignError.value = ''
  assignVisible.value = true
}

async function submitAssign() {
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
  try {
    await ElMessageBox.confirm('取消分派后工单将回到「待处理」，确认？', '取消分派', { type: 'warning' })
  } catch {
    return
  }
  try {
    await assignTicketApi(ticketId.value, null)
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
  closeForm.comment = ''
  closeError.value = ''
  closeVisible.value = true
}

async function submitClose() {
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
  try {
    await ElMessageBox.confirm(`确认删除工单 #${ticketId.value}？删除后列表不再展示。`, '危险操作', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  try {
    await deleteTicketApi(ticketId.value)
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

// ─── 关联（ticket:relation——正反向判重 409/自关联 400 内联）───
const relationForm = reactive({ targetId: '' })
const relationLoading = ref(false)
const relationError = ref('')

async function submitRelation() {
  const target = relationForm.targetId.trim()
  if (!/^\d+$/.test(target)) {
    relationError.value = '请填写数字工单 ID'
    return
  }
  if (target === ticketId.value) {
    relationError.value = '不能关联自身'
    return
  }
  relationLoading.value = true
  relationError.value = ''
  try {
    await createTicketRelationApi(ticketId.value, target)
    ElMessage.success(`已关联 #${target}`)
    relationForm.targetId = ''
    await queryClient.invalidateQueries({ queryKey: ['ticket', 'relations', ticketId.value] })
  } catch (err: unknown) {
    relationError.value = backendMessage(err)
  } finally {
    relationLoading.value = false
  }
}
</script>

<template>
  <div class="fill-page p-4" v-loading="ticketQuery.isLoading.value">
    <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
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

      <!-- 处理动作（S11：仅分派/取消/关闭/更新/删除——三态经 API 不可达不做流转；
           closed 后编辑/分派/关闭隐藏，后端 409 兜底） -->
      <div class="mt-4 flex gap-2 flex-wrap">
        <!-- S3a B3-1：condition 过滤后的可执行转换（后端语义+前端按钮一一对应） -->
        <template v-if="!isClosed && availableTransitions.length">
        <el-button
          v-for="to in availableTransitions"
          :key="to"
          type="primary"
          plain
          size="small"
          :loading="transitionLoading"
          :data-testid="`btn-transition-${to}`"
          @click="doTransition(to)"
        >→ {{ STATUS_LABEL[to] ?? to }}</el-button>
        </template>
        <el-button v-permission="'ticket:update'" v-if="!isClosed" @click="openEdit">编辑</el-button>
        <el-button v-permission="'ticket:assign'" v-if="!isClosed" type="primary" @click="openAssign">分派</el-button>
        <el-button v-permission="'ticket:assign'" v-if="!isClosed && ticket?.assigned_to" @click="unassign">取消分派</el-button>
        <el-button v-permission="'ticket:close'" v-if="!isClosed" type="warning" @click="openClose">关闭</el-button>
        <el-button v-permission="'ticket:delete'" type="danger" plain @click="onDelete">删除</el-button>
      </div>
    </el-card>

    <el-card shadow="hover" class="mb-4">
      <template #header><span class="font-semibold">描述</span></template>
      <pre class="whitespace-pre-wrap text-sm">{{ ticket?.description || '（无描述）' }}</pre>
    </el-card>

    <!-- B1-5 自定义字段回显（01 号 §3.5——"填了看不见"痛点收口件） -->
    <el-card v-if="customFields.length" shadow="hover" class="mb-4">
      <template #header><span class="font-semibold">自定义字段</span></template>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item
          v-for="f in customFields"
          :key="f.field_key"
          :label="f.field_label"
          :span="f.field_type === 'richtext' || f.field_type === 'textarea' ? 2 : 1"
        >
          <!-- richtext=服务端渲染 HTML（goldmark+bluemonday 消毒 SSOT——非前端自渲染） -->
          <!-- eslint-disable-next-line vue/no-v-html -- XSS SSOT：服务端 goldmark+bluemonday 消毒出站 HTML（F-E-1 修复 2026-10-22——不直接注入 MD 源文本） -->
          <div v-if="f.field_type === 'richtext' && renderedHtml[f.field_key]" class="richtext-view" v-html="renderedHtml[f.field_key]" />
          <span v-else-if="f.field_type === 'multi_select' && Array.isArray(customValue(f.field_key))">
            <!-- B1-7 批3（三路F-E-4）：字典项显示 label 而非 code -->
            <el-tag v-for="v in customValue(f.field_key) as string[]" :key="v" size="small" class="mr-1">{{ labelOf(f, v) }}</el-tag>
          </span>
          <span v-else-if="f.field_type === 'select' && customValue(f.field_key) != null">{{
            labelOf(f, String(customValue(f.field_key)))
          }}</span>
          <span v-else>{{ formatCustomValue(f) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- B5-3 工单附件区（05 号 §5——列表/上传/删除/下载，代理端点稳定 URL） -->
    <el-card shadow="hover" class="mb-4">
      <template #header><span class="font-semibold">附件</span></template>
      <TicketAttachments :ticket-id="ticketId" :can-edit="true" />
    </el-card>

    <!-- S10 B10-1 抄送人区（抄送即可见——被抄送人收通知并可见此单；摘他人无权由后端 403 兜底） -->
    <el-card shadow="hover" class="mb-4" data-testid="ticket-cc-card">
      <template #header>
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="font-semibold">抄送（{{ ccRows.length }}）</span>
          <div class="flex items-center gap-2">
            <el-button size="small" :loading="ccSaving" data-testid="cc-self" @click="addSelfCC">抄送我</el-button>
            <UserPicker v-model="ccForm.userId" class="!w-[220px]" />
            <el-button size="small" type="primary" plain :disabled="!ccForm.userId" :loading="ccSaving" data-testid="cc-add" @click="addCC">添加抄送</el-button>
          </div>
        </div>
      </template>
      <div v-if="ccRows.length" class="flex flex-wrap gap-2">
        <el-tag
          v-for="cc in ccRows"
          :key="cc.user_id"
          closable
          :data-testid="`cc-row-${cc.user_id}`"
          @close="removeCC(cc)"
        >{{ ccLabel(cc) }}</el-tag>
      </div>
      <span v-else class="text-xs text-gray-400">暂无抄送人</span>
    </el-card>

    <!-- S10 B10-2 标签（默认共享——挂载人留痕；摘他人挂的由后端 update 权兜底） -->
    <el-card shadow="hover" class="mb-4" data-testid="ticket-tags-card">
      <template #header>
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="font-semibold">标签</span>
          <div class="flex items-center gap-2">
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
          closable
          :data-testid="`tag-${row.tag}`"
          @close="removeTag(row)"
        >{{ row.tag }}</el-tag>
      </div>
      <span v-else class="text-xs text-gray-400">暂无标签</span>
    </el-card>

    <!-- 评论/备注（S10 分层：is_internal 标内部备注；可见性由服务端过滤） -->
    <el-card shadow="hover" class="mb-4">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">评论与备注</span>
          <span class="text-xs text-gray-400">
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
        <el-empty v-if="!commentsQuery.isLoading.value && !commentsQuery.data.value?.length" description="暂无评论" :image-size="60" />
      </div>

      <div v-if="userStore.hasAny('ticket:comment', 'ticket:note')" class="border-t pt-3">
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
            <span>关联 → <b>#{{ r.target_ticket_id }}</b></span>
          </template>
          <template v-else>
            <span>被关联 ← <b>#{{ r.source_ticket_id }}</b></span>
          </template>
        </div>
        <el-empty v-if="!relationsQuery.isLoading.value && !relationsQuery.data.value?.length" description="暂无关联" :image-size="60" />
      </div>

      <div v-if="userStore.hasPermission('ticket:relation')" class="border-t pt-3">
        <div class="flex items-center gap-2">
          <el-input v-model="relationForm.targetId" placeholder="对方工单 ID" class="!w-[200px]" @keyup.enter="submitRelation" />
          <el-button size="small" :loading="relationLoading" @click="submitRelation">建立关联</el-button>
        </div>
        <el-alert v-if="relationError" :title="relationError" type="error" show-icon class="mt-2" :closable="false" />
      </div>
    </el-card>

    <!-- 编辑对话框 -->
    </div>
    <el-dialog v-model="editVisible" title="编辑工单" width="520px">
      <el-form ref="editFormRef" :model="editForm" label-width="80px">
        <el-form-item label="标题" required>
          <el-input v-model="editForm.title" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="editForm.priority" class="!w-[140px]">
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
    <el-dialog v-model="assignVisible" title="分派工单" width="420px">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="处理人">
          <UserPicker v-model="assignForm.userId" />
        </el-form-item>
        <!-- S10 B10-4：催办上级人工指定（可选——随分派事务落库；不填保持不动） -->
        <el-form-item label="催办上级">
          <UserPicker v-model="assignForm.escalationSupervisor" />
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
    <el-dialog v-model="closeVisible" title="关闭工单" width="460px">
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
.richtext-view :deep(img) { max-width: 100%; border-radius: 4px; }
.richtext-view :deep(code) { background: var(--el-fill-color-light); padding: 1px 4px; border-radius: 2px; font-size: 0.9em; }
.richtext-view :deep(pre) { background: var(--el-fill-color-light); padding: 8px; border-radius: 4px; overflow-x: auto; }
</style>
