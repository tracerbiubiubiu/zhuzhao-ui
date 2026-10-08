<script setup lang="ts">
/**
 * 审计日志（P4-W5——audit_log 菜单页，audit:read；纯查询页无写操作）
 *
 * - 搜索四维：工号（含软删用户——历史审计可查 D2-27）/path/时间范围（YYYY-MM-DD
 *   服务端严格解析，start>end 由后端 400 显式提示）
 * - offset 分页（ProTable）；行展开显 request_body/user_agent（审计溯源载荷）
 * - P4-8 对账/指标极简查询页：后端本体未开工（穿插池件），本页不含——随本体批交付
 */
import { reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElDatePicker, ElDialog, ElForm, ElFormItem, ElInput, ElPagination, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { listAuditLogsApi, type AuditLogRow, listPanicsApi, reconcileAuditApi, type PanicRow } from '@/api/audit'
import { useTableFit } from '@vea/hooks'

// keep-alive 契约：name=动态路由名（菜单 code audit_log，组件路径 audit/log/index）
defineOptions({ name: 'audit_log_page' })

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
  { prop: 'actions', label: '操作', width: 80, fixed: 'right', slot: 'actions', wrap: true },
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

// ─── P4-8：panic 聚合 + 路由对账 ───
const activeTab = ref('logs')
const panics = ref<PanicRow[]>([])
const panicsLoading = ref(false)
const panicsTotal = ref(0)
const panicsPage = ref(1)
watch(activeTab, (t) => { if (t === 'panics' && !panics.value.length) fetchPanics() })

async function fetchPanics(p = panicsPage.value) {
  panicsLoading.value = true
  try {
    const data = await listPanicsApi(p, 20)
    panics.value = data.list ?? []
    panicsTotal.value = data.total
    panicsPage.value = data.page
  } finally {
    panicsLoading.value = false
  }
}

const reconcileGaps = ref<string[]>([])
const reconcileLoading = ref(false)
const reconcileAt = ref('')

async function runReconcile() {
  reconcileLoading.value = true
  try {
    const data = await reconcileAuditApi()
    reconcileGaps.value = data.gaps ?? []
    reconcileAt.value = data.checked_at
  } finally {
    reconcileLoading.value = false
  }
}

const panicsTable = ref()
useTableFit(panicsTable, () => panics.value)
</script>

<template>
  <div class="fill-page p-4">
    <el-tabs v-model="activeTab" class="fill-tabs">
      <el-tab-pane label="审计日志" name="logs">
    <el-card shadow="never">
      <template #header><span class="font-semibold">审计日志</span></template>
      <ProTable ref="tableRef" :columns="columns" :fetcher="fetcher" fill>
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
      </el-tab-pane>

      <!-- P4-8 panic 聚合 -->
      <el-tab-pane label="Panic 聚合" name="panics">
        <el-card shadow="never">
          <template #header><span class="font-semibold">Panic 聚合（同指纹计数——最近优先）</span></template>
          <div class="min-h-0 flex-initial">
            <el-table ref="panicsTable" :data="panics" v-loading="panicsLoading" row-key="id" height="100%">
              <el-table-column prop="count" label="次数" width="80" align="center" />
              <el-table-column prop="path" label="路径" min-width="200" />
              <el-table-column prop="message" label="消息" min-width="260" show-overflow-tooltip />
              <el-table-column prop="last_at" label="最近发生" width="170">
                <template #default="{ row }">{{ formatTime((row as { last_at: string }).last_at) }}</template>
              </el-table-column>
            </el-table>
          </div>
          <div class="mt-3 flex items-center justify-between">
            <span class="text-xs text-gray-400">共 {{ panicsTotal }} 个聚合指纹</span>
            <el-pagination
              :total="panicsTotal"
              :current-page="panicsPage"
              :page-size="20"
              layout="prev, pager, next"
              @current-change="(p: number) => fetchPanics(p)"
            />
          </div>
        </el-card>
      </el-tab-pane>

      <!-- P4-8 路由对账 -->
      <el-tab-pane label="路由对账" name="reconcile">
        <el-card shadow="never">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">路由 ↔ menu_apis 双向对账</span>
              <el-button size="small" :loading="reconcileLoading" @click="runReconcile">立即对账</el-button>
            </div>
          </template>
          <!-- 审计修复（2026-09-30 P2）：未执行不显示通过态（三态：未执行/通过/缺口） -->
          <el-alert v-if="!reconcileAt" type="info" title="尚未执行——点击「立即对账」"
            show-icon :closable="false" class="mb-3" />
          <el-alert v-else
            :type="reconcileGaps.length ? 'error' : 'success'"
            :title="reconcileGaps.length ? `发现 ${reconcileGaps.length} 项缺口` : '对账通过：无缺口'"
            :description="`检查时间：${reconcileAt}`"
            show-icon :closable="false" class="mb-3"
          />
          <pre v-if="reconcileGaps.length" class="text-xs whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 p-3 rounded max-h-[420px] overflow-auto">{{ reconcileGaps.join('\n') }}</pre>
        </el-card>
      </el-tab-pane>
    </el-tabs>

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
