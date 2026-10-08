<script setup lang="ts">
/**
 * 工单列表（P4-W4——列表页消费既有四参数端点：type_code/status 筛选+分页）
 *
 * - 搜索严格按端点（无 keyword/assignee——不假搜索；assignee=me 随后端件点亮待办视图）
 * - 详情入口（ticket:read）→ 静态路由 /tickets/:id（§3.2④；发起页/详情页均菜单外静态路由）
 * - 新建入口（ticket:create）→ /tickets/new（发起表单页=W4 下一批 form-create 渲染器）
 */
import { reactive, ref } from 'vue'
import { ElButton, ElCard, ElForm, ElFormItem, ElOption, ElSelect, ElTag } from 'element-plus'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { listTicketTypesApi, listTicketsApi, STATUS_LABEL, TICKET_STATUSES } from '@/api/ticket'

// keep-alive 契约：name=动态路由名（菜单 code ticket_list，组件路径 ticket/list/index）
defineOptions({ name: 'ticket_list' })

const router = useRouter()
const tableRef = ref<InstanceType<typeof ProTable>>()

const typesQuery = useQuery({ queryKey: ['ticket', 'types'], queryFn: listTicketTypesApi })

const search = reactive({ type_code: '', status: '' })

function onSearch() {
  tableRef.value?.refresh({ resetPage: true })
}

function onReset() {
  search.type_code = ''
  search.status = ''
  tableRef.value?.refresh({ resetPage: true })
}

function fetcher(params: { page: number; page_size: number }) {
  return listTicketsApi({
    page: params.page,
    page_size: params.page_size,
    ...(search.type_code ? { type_code: search.type_code } : {}),
    ...(search.status ? { status: search.status } : {}),
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
  { prop: 'title', label: '标题', minWidth: 220 },
  { prop: 'type_code', label: '类型', width: 130, slot: 'type_code' },
  { prop: 'status', label: '状态', width: 100, align: 'center', slot: 'status' },
  { prop: 'priority', label: '优先级', width: 90, align: 'center', slot: 'priority' },
  { prop: 'assignee_name', label: '处理人', width: 110, slot: 'assignee' },
  { prop: 'sla_due_at', label: 'SLA 截止', width: 170, slot: 'sla_due_at' },
  { prop: 'created_at', label: '创建时间', width: 170, slot: 'created_at' },
  { prop: 'actions', label: '操作', width: 90, fixed: 'right', slot: 'actions', wrap: true },
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
            <el-form-item label="类型">
              <el-select v-model="search.type_code" placeholder="全部" clearable class="!w-[160px]">
                <el-option v-for="t in typesQuery.data.value ?? []" :key="t.code" :label="t.name" :value="t.code" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="search.status" placeholder="全部" clearable class="!w-[120px]">
                <el-option v-for="s in TICKET_STATUSES" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
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

        <template #actions="{ row }">
          <el-button v-permission="'ticket:read'" link type="primary" size="small" @click="router.push(`/tickets/${row.id}`)">
            详情
          </el-button>
        </template>
      </ProTable>
    </el-card>
  </div>
</template>
