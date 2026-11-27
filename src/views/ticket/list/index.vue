<script setup lang="ts">
/**
 * 工单列表（P4-W4；2026-10-08 筛选与导航批）
 *
 * - 搜索严格按端点（无假搜索项）：type_code/status/priority/assignee=me/created_by=me/
 *   keyword/created_from~to——priority 存量即支持，keyword/时间/created_by 为 2026-10-08
 *   后端同补参数（keyword=标题 ILIKE 子串，纯数字 OR 工单 ID；时间=YYYY-MM-DD UTC 切日）
 * - 详情入口=标题链接（ticket:read 权限判定，无权限降级纯文本）——操作列删除
 *   （原操作列仅「详情」一按钮，标题即业界标准详情靶点）
 * - 详情路由 → 静态路由 /tickets/:id（§3.2④；发起页/详情页均菜单外静态路由）
 * - 新建入口（ticket:create）→ /tickets/new（发起表单页=form-create 渲染器）
 */
import { formatDateTime } from '@/utils/datetime'
import { computed, onActivated, onDeactivated, reactive, ref, watch } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElCheckbox, ElDrawer, ElDatePicker, ElInput, ElLink,
  ElOption, ElSelect, ElTag, ElRadioButton, ElRadioGroup} from 'element-plus'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { useAutoFilterRun, useDatePresetRange} from '@vea/hooks'
import FilterBar from '@/components/FilterBar/index.vue'
import ProTable from '@/components/ProTable/index.vue'
import UserNameText from '@/components/UserNameText/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { getTicketStatsApi, type TicketStatsGroup, exportTicketsApi, listTicketTypesApi, listTicketsApi, STATUS_LABEL, TICKET_STATUSES } from '@/api/ticket'
import { apiReadError } from '@/utils/apiError'
import { usePermission } from '@/common/auth'

// keep-alive 契约：name=动态路由名（菜单 code ticket_list，组件路径 ticket/list/index）
defineOptions({ name: 'ticket_list' })

const router = useRouter()
const route = useRoute()
const { hasPerm } = usePermission()
const tableRef = ref<InstanceType<typeof ProTable>>()

const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })

const search = reactive({
  keyword: '',
  type_code: '',
  status: '',
  excludeStatuses: '',
  priority: '' as '' | number,
  mineHandle: false, // assignee=me（仅字面量 me，后端解析为当前用户）
  mineCreated: false, // created_by=me
  tag: '', // 标签（S10 B10-2——精确匹配）
})

// URL 参数预填（首页统计卡/外部入口跳转——FE4 配套基础设施）：白名单键，非法值忽略。
// 状态三种模式互斥，首页/角标各自兑现其服务端统计口径。
function applyRouteFilters() {
  const q = route.query
  // 普通无 query 页签仍保留用户筛选；显式深链每次激活都重新兑现其筛选口径。
  // AppView 按 fullPath 缓存，手动改筛选后再次点同一首页卡会复用该实例。
  if (!['status', 'statuses', 'exclude_statuses', 'assignee', 'created_by', 'keyword', 'type_code', 'tag'].some((key) => key in q)) return
  Object.assign(search, {
    status: typeof q.exclude_statuses === 'string' ? '' : (typeof q.statuses === 'string' ? q.statuses : (typeof q.status === 'string' ? q.status : '')),
    excludeStatuses: typeof q.exclude_statuses === 'string' ? q.exclude_statuses : '',
    mineHandle: q.assignee === 'me',
    mineCreated: q.created_by === 'me',
    keyword: typeof q.keyword === 'string' ? q.keyword : '',
    type_code: typeof q.type_code === 'string' ? q.type_code : '',
    tag: typeof q.tag === 'string' ? q.tag : '',
    priority: '',
  })
}
applyRouteFilters()

/** 创建日期范围 [from, to]（YYYY-MM-DD）——快捷段+自定义（2026-10-29 统一形态批，composable） */
const { preset: datePreset, range: dateRange, apply: applyDatePreset, reset: presetReset } = useDatePresetRange()
onActivated(() => {
  if (route.path !== '/tickets') return
  applyRouteFilters()
  if (['status', 'statuses', 'exclude_statuses', 'assignee', 'created_by', 'keyword', 'type_code', 'tag'].some((key) => key in route.query)) presetReset()
})

// 首页两状态与角标非终态均走后端过滤；选择普通单状态或清空时退出集合模式。
const statusSelection = computed({
  get: () => search.excludeStatuses ? `exclude:${search.excludeStatuses}` : search.status,
  set: (value: string | undefined) => {
    const selected = value ?? ''
    search.excludeStatuses = selected.startsWith('exclude:') ? selected.slice(8) : ''
    search.status = selected.startsWith('exclude:') ? '' : selected
  },
})
const statusFilter = () => search.excludeStatuses
  ? { exclude_statuses: search.excludeStatuses }
  : (search.status.includes(',') ? { statuses: search.status } : (search.status ? { status: search.status } : {}))
const statusSetLabel = computed(() => search.excludeStatuses
  ? `排除 ${search.excludeStatuses.split(',').map((s) => STATUS_LABEL[s] ?? s).join(' / ')}`
  : (search.status === 'assigned,in_progress' ? '待办（已分派 / 进行中）'
    : search.status.split(',').map((s) => STATUS_LABEL[s] ?? s).join(' / ')))

function readFilters() {
  return {
    ...(search.keyword.trim() ? { keyword: search.keyword.trim() } : {}),
    ...(search.type_code ? { type_code: search.type_code } : {}),
    ...statusFilter(),
    ...(search.priority !== '' ? { priority: search.priority } : {}),
    ...(search.mineHandle ? { assignee: 'me' as const } : {}),
    ...(search.mineCreated ? { created_by: 'me' as const } : {}),
    ...(search.tag.trim() ? { tag: search.tag.trim() } : {}),
    ...(dateRange.value ? { created_from: dateRange.value[0], created_to: dateRange.value[1] } : {}),
  }
}
const appliedFilters = ref(readFilters())
function applyFilters() {
  appliedFilters.value = readFilters()
  tableRef.value?.refresh({ resetPage: true })
}
useAutoFilterRun(() => ({ ...search, range: dateRange.value }), applyFilters)

const statsVisible = ref(false)
const statsGroup = ref<TicketStatsGroup>('status')
const canReadStats = computed(() => hasPerm('ticket:stats'))
watch(canReadStats, allowed => { if (!allowed) statsVisible.value = false }, { flush: 'sync' })
onDeactivated(() => { statsVisible.value = false })
const statsQuery = useQuery({
  queryKey: computed(() => ['ticket', 'stats', { ...appliedFilters.value, group_by: statsGroup.value }] as const),
  queryFn: ({ queryKey, signal }) => getTicketStatsApi(queryKey[2], signal),
  enabled: computed(() => canReadStats.value && statsVisible.value),
  retry: false,
  staleTime: 0,
})

const exporting = ref(false)
async function onExport() {
  exporting.value = true
  try {
    const blob = await exportTicketsApi(appliedFilters.value)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tickets_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '导出失败（超 5 万行请收窄筛选）')
  } finally {
    exporting.value = false
  }
}

function onReset() {
  search.keyword = ''
  search.type_code = ''
  search.status = ''
  search.excludeStatuses = ''
  search.priority = ''
  search.mineHandle = false
  search.mineCreated = false
  search.tag = ''
  presetReset()
  applyFilters()
}

function fetcher(params: { page: number; page_size: number }) {
  return listTicketsApi({ ...appliedFilters.value, ...params })
}

const PRIORITY_TYPES = ['info', 'danger', 'warning', 'info', 'success'] as const
const PRIORITY_LABELS = ['', '紧急', '高', '中', '低']

const STATUS_TAG: Record<string, 'warning' | 'primary' | 'info' | 'success' | 'danger'> = {
  open: 'warning',
  assigned: 'primary',
  in_progress: 'info',
  pending_verify: 'info',
  closed: 'success',
  rejected: 'danger',
}

const columns: ProTableColumn[] = [
  { prop: 'id', label: 'ID', width: 90 },
  { prop: 'title', label: '标题', minWidth: 260, slot: 'title' },
  { prop: 'type_code', label: '类型', width: 130, slot: 'type_code' },
  { prop: 'status', label: '状态', width: 100, align: 'center', slot: 'status' },
  { prop: 'priority', label: '优先级', width: 90, align: 'center', slot: 'priority' },
  { prop: 'assignee_name', label: '处理人', width: 110, slot: 'assignee' },
  { prop: 'sla_due_at', label: 'SLA 截止', width: 170, slot: 'sla_due_at' },
  { prop: 'created_at', label: '创建时间', width: 170, slot: 'created_at' },
]

function formatTime(iso?: string): string {
  if (!iso) return '—'
  return formatDateTime(iso)
}

function typeLabel(code: string): string {
  return typesQuery.data.value?.find((t) => t.code === code)?.name ?? code
}
</script>

<template>
  <div class="fill-page p-4">
    <el-card shadow="never">
      <ProTable ref="tableRef" :columns="columns" :fetcher="fetcher" fill>
        <template #search>
        <FilterBar :visible="5">

            <div>
              <el-input
                v-model="search.keyword" placeholder="标题 / 工单号" clearable maxlength="50"
                class="!w-[160px]"
              />
            </div>
            <div>
              <el-select v-model="search.type_code" placeholder="全部" clearable class="!w-[120px]">
                <el-option v-for="t in typesQuery.data.value ?? []" :key="t.code" :label="t.name" :value="t.code" />
              </el-select>
            </div>
            <div>
              <el-select v-model="statusSelection" :title="statusSetLabel || '全部状态'" placeholder="全部" clearable :class="search.excludeStatuses || search.status.includes(',') ? '!w-[220px]' : '!w-[110px]'">
                <el-option v-if="search.excludeStatuses || search.status.includes(',')" :label="statusSetLabel" :value="statusSelection" />
                <el-option v-for="s in TICKET_STATUSES" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </div>
            <div>
              <el-input v-model="search.tag" placeholder="标签精确匹配" clearable maxlength="50" class="!w-[130px]" />
            </div>
            <div>
              <el-select v-model="search.priority" placeholder="全部" clearable class="!w-[100px]">
                <el-option v-for="(label, val) in PRIORITY_LABELS.slice(1)" :key="val" :label="label" :value="val + 1" />
              </el-select>
            </div>
            <div>
              <el-radio-group
                :model-value="datePreset" size="small"
                @update:model-value="(v: string | number | boolean | undefined) => applyDatePreset(v)"
              >
                <el-radio-button value="">全部</el-radio-button>
                <el-radio-button value="7d">近 7 天</el-radio-button>
                <el-radio-button value="30d">近 30 天</el-radio-button>
                <el-radio-button value="custom">自定义</el-radio-button>
              </el-radio-group>
              <el-date-picker
                v-if="datePreset === 'custom'"
                v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" format="MM-DD"
                start-placeholder="起" end-placeholder="止" class="ticket-daterange !flex-none"
                :style="{ '--el-date-editor-width': '210px' }"
              />
            </div>
            <div>
              <el-checkbox v-model="search.mineHandle">只看我处理的</el-checkbox>
              <el-checkbox v-model="search.mineCreated">我发起的</el-checkbox>
            </div>
            <div class="ml-auto !mr-0" data-ignore>
              <el-button @click="onReset">重置</el-button>
              <el-button v-if="canReadStats" @click="statsVisible = true">工单统计</el-button>
              <el-button :loading="exporting" data-testid="btn-export" @click="onExport">导出</el-button>
            </div>
          
        </FilterBar>
      </template>

        <template #toolbar>
          <div>
            <!-- 发起页=W4 下一批（form-create 动态表单，§3.2④ 静态路由） -->
            <el-button v-permission="'ticket:create'" type="primary" @click="router.push('/tickets/new')">新建工单</el-button>
          </div>
          <div />
        </template>

        <!-- 标题=详情入口（业界标准靶点）；无 ticket:read 权限降级纯文本 -->
        <template #title="{ row }">
          <el-link
            v-if="hasPerm('ticket:read')" type="primary" :underline="false"
            @click="router.push(`/tickets/${row.id}`)"
          >{{ row.title }}</el-link>
          <span v-else>{{ row.title }}</span>
        </template>

        <template #type_code="{ row }">{{ typeLabel(row.type_code) }}</template>

        <template #status="{ row }">
          <el-tag :type="STATUS_TAG[row.status] ?? 'info'" size="small">
            {{ STATUS_LABEL[row.status] ?? row.status }}
          </el-tag>
        </template>

        <template #priority="{ row }">
          <el-tag :type="PRIORITY_TYPES[row.priority] ?? 'info'" size="small">
            {{ PRIORITY_LABELS[row.priority] ?? '中' }}
          </el-tag>
        </template>

        <!-- 处理人：结构化回填（assignee_name + assignee_no，2026-10-13 展示统一批），
             未分派/回填缺失降级显 ID -->
        <template #assignee="{ row }">
          <UserNameText :name="row.assignee_name" :no="row.assignee_no" :fallback="row.assigned_to" />
        </template>

        <template #sla_due_at="{ row }">
          <span :class="row.sla_due_at && !['closed', 'cancelled'].includes(row.status) ? 'text-[var(--el-color-danger)]' : ''">
            {{ formatTime(row.sla_due_at) }}
          </span>
        </template>

        <template #created_at="{ row }">{{ formatTime(row.created_at) }}</template>
      </ProTable>
    </el-card>
    <el-drawer v-if="canReadStats" v-model="statsVisible" title="工单统计" size="min(620px, 95vw)">
      <el-radio-group v-model="statsGroup" aria-label="统计分组">
        <el-radio-button value="status">按状态</el-radio-button>
        <el-radio-button value="priority">按优先级</el-radio-button>
        <el-radio-button value="type_code">按类型</el-radio-button>
      </el-radio-group>
      <p v-if="statsQuery.isFetching.value" role="status">正在读取统计…</p>
      <el-alert v-else-if="statsQuery.isError.value" :title="apiReadError(statsQuery.error.value, '统计读取失败')" type="error" :closable="false">
        <el-button size="small" @click="statsQuery.refetch()">重试读取</el-button>
      </el-alert>
      <template v-else-if="statsVisible && statsQuery.data.value">
        <p>共 {{ statsQuery.data.value.total }} 份工单 · 统计时间 {{ formatTime(statsQuery.data.value.as_of) }}</p>
        <table v-if="statsQuery.data.value.items.length" class="stats-table">
          <thead><tr><th>分组</th><th>总数</th><th>进行中</th><th>逾期</th><th>逾期率</th></tr></thead>
          <tbody><tr v-for="item in statsQuery.data.value.items" :key="item.key">
            <th scope="row">{{ statsGroup === 'status' ? STATUS_LABEL[item.key] ?? item.key : statsGroup === 'priority' ? PRIORITY_LABELS[Number(item.key)] ?? item.key : typeLabel(item.key) }}</th>
            <td>{{ item.count }}</td><td>{{ item.in_progress_count }}</td><td>{{ item.overdue_count }}</td>
            <td>{{ item.overdue_rate === null ? '—' : (item.overdue_rate * 100).toFixed(1) + '%' }}</td>
          </tr></tbody>
        </table>
        <p v-else>当前筛选下没有可见工单</p>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.stats-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.stats-table th, .stats-table td { padding: 8px; text-align: right; border-bottom: 1px solid var(--el-border-color-lighter); }
.stats-table th:first-child { text-align: left; }
/* 筛选栏：EP inline 默认项距 32px 过疏——收半使首行多容一个字段；尾行「勾选居左+重置钉右」。
   inline 原生是 inline-flex 文本流（margin-left:auto 无效），转 flex+wrap 后 ml-auto 才成立 */
.ticket-filter {
  display: flex;
  flex-wrap: wrap;
}
.ticket-filter :deep(.el-form-item) {
  margin-right: 16px;
}
</style>
