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
import { reactive, ref } from 'vue'
import {
  ElButton, ElCard, ElCheckbox, ElDatePicker, ElForm, ElFormItem, ElInput, ElLink,
  ElOption, ElSelect, ElTag,
} from 'element-plus'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { listTicketTypesApi, listTicketsApi, STATUS_LABEL, TICKET_STATUSES } from '@/api/ticket'
import { usePermission } from '@/common/auth'

// keep-alive 契约：name=动态路由名（菜单 code ticket_list，组件路径 ticket/list/index）
defineOptions({ name: 'ticket_list' })

const router = useRouter()
const { hasPerm } = usePermission()
const tableRef = ref<InstanceType<typeof ProTable>>()

const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })

const search = reactive({
  keyword: '',
  type_code: '',
  status: '',
  priority: '' as '' | number,
  mineHandle: false, // assignee=me（仅字面量 me，后端解析为当前用户）
  mineCreated: false, // created_by=me
})
/** 创建日期范围 [from, to]（YYYY-MM-DD，value-format 对齐端点 UTC 切日口径） */
const dateRange = ref<[string, string] | null>(null)

function onSearch() {
  tableRef.value?.refresh({ resetPage: true })
}

function onReset() {
  search.keyword = ''
  search.type_code = ''
  search.status = ''
  search.priority = ''
  search.mineHandle = false
  search.mineCreated = false
  dateRange.value = null
  tableRef.value?.refresh({ resetPage: true })
}

function fetcher(params: { page: number; page_size: number }) {
  return listTicketsApi({
    page: params.page,
    page_size: params.page_size,
    ...(search.keyword.trim() ? { keyword: search.keyword.trim() } : {}),
    ...(search.type_code ? { type_code: search.type_code } : {}),
    ...(search.status ? { status: search.status } : {}),
    ...(search.priority !== '' ? { priority: search.priority } : {}),
    ...(search.mineHandle ? { assignee: 'me' as const } : {}),
    ...(search.mineCreated ? { created_by: 'me' as const } : {}),
    ...(dateRange.value ? { created_from: dateRange.value[0], created_to: dateRange.value[1] } : {}),
  })
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
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function typeLabel(code: string): string {
  return typesQuery.data.value?.find((t) => t.code === code)?.name ?? code
}
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <ProTable ref="tableRef" :columns="columns" :fetcher="fetcher">
        <template #search>
          <el-form inline @submit.prevent>
            <el-form-item label="关键字">
              <el-input
                v-model="search.keyword" placeholder="标题 / 工单号" clearable maxlength="50"
                class="!w-[200px]" @keyup.enter="onSearch"
              />
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="search.type_code" placeholder="全部" clearable class="!w-[150px]">
                <el-option v-for="t in typesQuery.data.value ?? []" :key="t.code" :label="t.name" :value="t.code" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="search.status" placeholder="全部" clearable class="!w-[120px]">
                <el-option v-for="s in TICKET_STATUSES" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="优先级">
              <el-select v-model="search.priority" placeholder="全部" clearable class="!w-[100px]">
                <el-option v-for="(label, val) in PRIORITY_LABELS.slice(1)" :key="val" :label="label" :value="val + 1" />
              </el-select>
            </el-form-item>
            <el-form-item label="创建时间">
              <el-date-picker
                v-model="dateRange" type="daterange" value-format="YYYY-MM-DD"
                start-placeholder="开始" end-placeholder="结束" class="!w-[240px]"
              />
            </el-form-item>
            <el-form-item>
              <el-checkbox v-model="search.mineHandle">只看我处理的</el-checkbox>
              <el-checkbox v-model="search.mineCreated">我发起的</el-checkbox>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="onSearch">查询</el-button>
              <el-button @click="onReset">重置</el-button>
            </el-form-item>
          </el-form>
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

        <!-- 处理人：W4 后端姓名回填（assignee_name），未分派/回填缺失降级显 ID -->
        <template #assignee="{ row }">
          {{ row.assignee_name ?? row.assigned_to ?? '—' }}
        </template>

        <template #sla_due_at="{ row }">
          <span :class="row.sla_due_at && row.status !== 'closed' ? 'text-[var(--el-color-danger)]' : ''">
            {{ formatTime(row.sla_due_at) }}
          </span>
        </template>

        <template #created_at="{ row }">{{ formatTime(row.created_at) }}</template>
      </ProTable>
    </el-card>
  </div>
</template>
