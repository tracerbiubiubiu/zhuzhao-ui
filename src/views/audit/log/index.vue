<script setup lang="ts">
/**
 * 审计日志（P4-W5——audit_log 菜单页，audit:read；纯查询页无写操作）
 *
 * - 搜索四维：工号（含软删用户——历史审计可查 D2-27）/path/时间范围（YYYY-MM-DD
 *   服务端严格解析，start>end 由后端 400 显式提示）
 * - offset 分页（ProTable）；行展开显 request_body/user_agent（审计溯源载荷）
 * - P4-8 对账/指标极简查询页：后端本体未开工（穿插池件），本页不含——随本体批交付
 */
import { formatDateTime } from '@/utils/datetime'
import { reactive, ref, watch } from 'vue'
import { ElMessage, ElAlert, ElButton, ElCard, ElDatePicker, ElDescriptions, ElDescriptionsItem, ElDrawer, ElForm, ElFormItem, ElInput, ElOption, ElPagination, ElSelect, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag, ElRadioButton, ElRadioGroup} from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import UserNameText from '@/components/UserNameText/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import { listAuditLogsApi, type AuditLogRow, listPanicsApi, reconcileAuditApi, type PanicRow } from '@/api/audit'
import { useAutoFilterRun, useDatePresetRange, useTableFit } from '@vea/hooks'

// keep-alive 契约：name=动态路由名（菜单 code audit_log，组件路径 audit/log/index）
defineOptions({ name: 'audit_log_page' })

const tableRef = ref<InstanceType<typeof ProTable>>()
const search = reactive({ employee_no: '', path: '', method: [] as string[], range: [] as string[] })
// 日期快捷段（2026-10-29 统一形态批）：preset 选择/重置驱动 search.range
const datePreset = useDatePresetRange()
const presetValue = datePreset.preset
const applyPreset = datePreset.apply
watch(datePreset.range, (r) => { search.range = (r ?? []) as string[] })

// 筛选即时生效（筛选栏配方触发口径：全部控件变更即查，文本防抖 300ms 收敛）
useAutoFilterRun(
  () => ({ ...search, range: search.range }),
  () => tableRef.value?.refresh({ resetPage: true }),
)

function onReset() {
  search.employee_no = ''
  search.path = ''
  search.method = []
  search.range = []
  datePreset.reset()
  tableRef.value?.refresh({ resetPage: true })
}

function fetcher(params: { page: number; page_size: number }) {
  return listAuditLogsApi({
    page: params.page,
    page_size: params.page_size,
    ...(search.employee_no ? { employee_no: search.employee_no.trim() } : {}),
    ...(search.path ? { path: search.path.trim() } : {}),
    ...(search.method.length ? { method: search.method.join(',') } : {}),
    ...(search.range?.[0] ? { start: String(search.range[0]) } : {}),
    ...(search.range?.[1] ? { end: String(search.range[1]) } : {}),
  })
}

const columns: ProTableColumn[] = [
  { prop: 'id', label: 'ID', width: 90 },
  // 操作人快照（000044）：人名(工号)，存量行无快照降级 username（登录账号名）
  { prop: 'username', label: '操作人', width: 150, slot: 'operator' },
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
  return formatDateTime(iso)
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

/** 一键复制请求报文（格式化 JSON；空报文提示） */
async function copyRequestBody() {
  if (!payloadRow.value) return
  const text = prettyBody(payloadRow.value)
  if (!text || text === '（无 body）') {
    ElMessage.info('该请求无报文（GET 类或空 body）')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制请求报文')
  } catch {
    ElMessage.error('复制失败（浏览器剪贴板权限）')
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
      <!-- 卡头不重复 Tab 名（Tab=审计日志）——卡头让位给页内筛选说明 -->
      <template #header>
        <span class="text-xs text-gray-400">平台操作审计——登录、API 调用与导出行为记录（只读，可查已删除用户）</span>
      </template>
      <ProTable ref="tableRef" :columns="columns" :fetcher="fetcher" fill>
        <template #search>
          <el-form inline @submit.prevent>
            <!-- placeholder 式+日期快捷段（2026-10-29 统一形态批：label 式/常驻 daterange 双漂移整改） -->
            <el-form-item>
              <el-input v-model="search.employee_no" placeholder="工号，如 E000001" clearable class="!w-[160px]" title="可查已删除用户的审计记录" />
            </el-form-item>
            <el-form-item>
              <el-select v-model="search.method" multiple collapse-tags placeholder="全部方法" clearable class="!w-[150px]" data-testid="audit-method-filter">
                <el-option v-for="m in ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-input v-model="search.path" placeholder="路径，如 /api/v1/users" clearable class="!w-[190px]" />
            </el-form-item>
            <el-form-item>
              <el-radio-group
                :model-value="presetValue" size="small"
                @update:model-value="(v: string | number | boolean | undefined) => applyPreset(v)"
              >
                <el-radio-button value="">全部</el-radio-button>
                <el-radio-button value="7d">近 7 天</el-radio-button>
                <el-radio-button value="30d">近 30 天</el-radio-button>
                <el-radio-button value="custom">自定义</el-radio-button>
              </el-radio-group>
              <el-date-picker
                v-if="presetValue === 'custom'"
                :model-value="search.range" type="daterange" value-format="YYYY-MM-DD" format="MM-DD"
                start-placeholder="起" end-placeholder="止" class="audit-daterange !flex-none"
                :style="{ '--el-date-editor-width': '210px' }"
                @update:model-value="(v: [string, string] | null) => { search.range = (v ?? []) as string[] }"
              />
            </el-form-item>
            <el-form-item class="ml-auto !mr-0">
              <el-button @click="onReset">重置</el-button>
            </el-form-item>
          </el-form>
        </template>

        <template #operator="{ row }">
          <UserNameText
            :name="(row as AuditLogRow).real_name"
            :no="(row as AuditLogRow).employee_no"
            :fallback="(row as AuditLogRow).username"
          />
        </template>
        <template #status="{ row }">
          <el-tag :type="statusTag((row as AuditLogRow).status_code)" size="small">
            {{ (row as AuditLogRow).status_code }}
          </el-tag>
        </template>
        <template #time="{ row }">{{ formatTime((row as AuditLogRow).created_at) }}</template>
        <template #actions="{ row }">
          <el-button link type="primary" size="small" @click="openPayload(row as AuditLogRow)">详情</el-button>
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
    <!-- 请求详情：右侧抽屉（看报文时保留列表上下文——2026-10-28 走查批由居中弹窗改）
         + 一键复制报文（格式化 JSON） -->
    <el-drawer v-model="payloadVisible" :title="`#${payloadRow?.id ?? ''} 请求详情`" size="620px">
      <template #header>
        <div class="flex items-center gap-2">
          <span class="font-semibold">#{{ payloadRow?.id ?? '' }} 请求详情</span>
          <el-button link type="primary" size="small" data-testid="audit-copy-body" @click="copyRequestBody">复制报文</el-button>
        </div>
      </template>
      <el-descriptions v-if="payloadRow" :column="2" border size="small">
        <el-descriptions-item label="操作人">{{ payloadRow.username || '—' }}</el-descriptions-item>
        <el-descriptions-item label="时间">{{ formatTime(payloadRow.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="方法">{{ payloadRow.method }}</el-descriptions-item>
        <el-descriptions-item label="状态码">
          <el-tag :type="statusTag(payloadRow.status_code)" size="small">{{ payloadRow.status_code }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="路径" :span="2">{{ payloadRow.path }}</el-descriptions-item>
        <el-descriptions-item label="耗时">{{ payloadRow.duration }} ms</el-descriptions-item>
        <el-descriptions-item label="IP">{{ payloadRow.ip || '—' }}</el-descriptions-item>
        <el-descriptions-item label="request_id" :span="2">{{ payloadRow.request_id || '—' }}</el-descriptions-item>
        <el-descriptions-item label="User-Agent" :span="2">{{ payloadRow.user_agent || '—' }}</el-descriptions-item>
        <el-descriptions-item label="请求体" :span="2">
          <pre class="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded max-h-[280px] overflow-auto m-0">{{ prettyBody(payloadRow) }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>
