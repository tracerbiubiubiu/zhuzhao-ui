<script setup lang="ts">
/**
 * 审计日志（P4-W5——audit_log 菜单页，audit:read；纯查询页无写操作）
 *
 * - 搜索四维：工号（含软删用户——历史审计可查 D2-27）/path/时间范围（YYYY-MM-DD
 *   服务端严格解析，start>end 由后端 400 显式提示）
 * - offset 分页（ProTable）；行展开显 request_body/user_agent（审计溯源载荷）
 * - P4-8 对账/指标极简查询页：后端本体未开工（穿插池件），本页不含——随本体批交付
 */
import { reactive, ref } from 'vue'
import { ElButton, ElCard, ElDatePicker, ElDialog, ElForm, ElFormItem, ElInput, ElTag } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { listAuditLogsApi, type AuditLogRow } from '@/api/audit'

// keep-alive 契约：name=动态路由名（菜单 code audit_log，组件路径 audit/log/index）
defineOptions({ name: 'audit_log' })

const tableRef = ref<InstanceType<typeof ProTable>>()
const search = reactive({ employee_no: '', path: '', range: [] as string[] })

function onSearch() {
  tableRef.value?.refresh({ resetPage: true })
}

function onReset() {
  search.employee_no = ''
  search.path = ''
  search.range = []
  tableRef.value?.refresh({ resetPage: true })
}

function fetcher(params: { page: number; page_size: number }) {
  return listAuditLogsApi({
    page: params.page,
    page_size: params.page_size,
    ...(search.employee_no ? { employee_no: search.employee_no.trim() } : {}),
    ...(search.path ? { path: search.path.trim() } : {}),
    ...(search.range?.[0] ? { start: String(search.range[0]) } : {}),
    ...(search.range?.[1] ? { end: String(search.range[1]) } : {}),
  })
}

const columns: ProTableColumn[] = [
  { prop: 'id', label: 'ID', width: 90 },
  { prop: 'username', label: '操作人', width: 110 },
  { prop: 'method', label: '方法', width: 70, align: 'center' },
  { prop: 'path', label: '路径', minWidth: 220 },
  { prop: 'status_code', label: '状态', width: 80, align: 'center', slot: 'status' },
  { prop: 'duration', label: '耗时(ms)', width: 90, align: 'right' },
  { prop: 'ip', label: 'IP', width: 130 },
  { prop: 'request_id', label: 'request_id', width: 200 },
  { prop: 'created_at', label: '时间', width: 170, slot: 'time' },
  { prop: 'actions', label: '操作', width: 80, fixed: 'right', slot: 'actions' },
]

function statusTag(code: number): 'success' | 'danger' | 'warning' {
  if (code < 300) return 'success'
  if (code < 500) return 'warning'
  return 'danger'
}

function formatTime(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

const payloadVisible = ref(false)
const payloadRow = ref<AuditLogRow | null>(null)

function openPayload(row: AuditLogRow) {
  payloadRow.value = row
  payloadVisible.value = true
}

/** 展开区载荷（request_body 可能较大——审计溯源） */
function prettyBody(row: AuditLogRow): string {
  if (!row.request_body) return '（无 body）'
  try {
    return JSON.stringify(JSON.parse(row.request_body), null, 2)
  } catch {
    return row.request_body
  }
}
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header><span class="font-semibold">审计日志</span></template>
      <ProTable ref="tableRef" :columns="columns" :fetcher="fetcher">
        <template #search>
          <el-form inline @submit.prevent>
            <el-form-item label="工号">
              <el-input v-model="search.employee_no" placeholder="如 E000001（含已删用户）" clearable class="!w-44" />
            </el-form-item>
            <el-form-item label="路径">
              <el-input v-model="search.path" placeholder="如 /api/v1/users" clearable class="!w-52" />
            </el-form-item>
            <el-form-item label="时间范围">
              <el-date-picker
                v-model="search.range" type="daterange" value-format="YYYY-MM-DD"
                start-placeholder="开始" end-placeholder="结束" class="!w-60"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="onSearch">查询</el-button>
              <el-button @click="onReset">重置</el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #status="{ row }">
          <el-tag :type="statusTag((row as AuditLogRow).status_code)" size="small">
            {{ (row as AuditLogRow).status_code }}
          </el-tag>
        </template>
        <template #time="{ row }">{{ formatTime((row as AuditLogRow).created_at) }}</template>
        <template #actions="{ row }">
          <el-button link type="primary" size="small" @click="openPayload(row as AuditLogRow)">载荷</el-button>
        </template>
      </ProTable>
    </el-card>

    <!-- 审计载荷（request_body JSON 美化——溯源） -->
    <el-dialog v-model="payloadVisible" :title="`#${payloadRow?.id ?? ''} 载荷`" width="640px">
      <div v-if="payloadRow">
        <div class="text-xs text-gray-400 mb-1">{{ payloadRow.method }} {{ payloadRow.path }}</div>
        <div class="text-xs text-gray-400 mb-3">UA：{{ payloadRow.user_agent || '—' }}</div>
        <pre class="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded max-h-[420px] overflow-auto">{{ prettyBody(payloadRow) }}</pre>
      </div>
    </el-dialog>
  </div>
</template>
