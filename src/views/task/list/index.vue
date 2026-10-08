<script setup lang="ts">
/**
 * 任务中心（P4-W5——task_center 菜单页四 Tab：运行记录/死信/任务定义/提交任务）
 *
 * - runs/jobs：offset 分页有 total（ProTable）；死信：{list,page,page_size} 无 total——
 *   按页号上一页/下一页（十三批「无 total 形态」）
 * - 干预按钮挂 task:operate，禁用态对齐后端前置态（十三批 S13）：取消仅 pending、
 *   重试仅 failed/dead——不符仍可点（409 透传内联），禁用只是前置提示
 * - 提交表单不渲染 callback_url（W0 P0-5：传非空即 400——服务端定）；params 旁
 *   「勿填口令/密钥/PII」（共享队列全可见，E-⑤ 前端配合面）；64KB 上限前端预检
 * - jobs 写操作挂 task:manage；trigger 对 enabled=false 后端 409——按钮同步禁用
 * - 「只看我提交的」仅运行记录（submitted_by=me 由 zhuzhao 代理换 actor 透传）
 */
import { reactive, ref, watch } from 'vue'
import { useTableFit } from '@vea/hooks'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElMessage, ElMessageBox, ElOption, ElSelect, ElSwitch, ElTabPane, ElTabs, ElTable,
  ElTableColumn, ElTag, ElDescriptions, ElDescriptionsItem,
} from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import {
  cancelTaskApi, createJobApi, getTaskApi, listDeadLettersApi, listJobsApi, listRunsApi,
  retryTaskApi, submitTaskApi, triggerJobApi, updateJobApi,
  RUN_STATUS, type DeadLetterRow, type TaskDetail, type TaskJobRow, type TaskRunRow,
} from '@/api/task'

// keep-alive 契约：name=动态路由名（菜单 code task_center，组件路径 task/list/index）
defineOptions({ name: 'task_center' })

const activeTab = ref('runs')

// ─── Tab1 运行记录（offset+total——ProTable）───
const runsTableRef = ref<InstanceType<typeof ProTable>>()
const runsSearch = reactive({ request_id: '', action: '', status: '', mine: false })

function fetchRuns(params: { page: number; page_size: number }) {
  return listRunsApi({
    page: params.page,
    page_size: params.page_size,
    ...(runsSearch.request_id ? { request_id: runsSearch.request_id } : {}),
    ...(runsSearch.action ? { action: runsSearch.action } : {}),
    ...(runsSearch.status ? { status: runsSearch.status } : {}),
    ...(runsSearch.mine ? { submitted_by: 'me' as const } : {}),
  })
}

// 勾选（开关）型筛选即时生效（同 ticket/list——开关即查询，回第一页）
watch(() => runsSearch.mine, () => {
  runsTableRef.value?.refresh({ resetPage: true })
})

function statusInfo(s: string) {
  return RUN_STATUS[s] ?? { label: s, tag: 'info' as const }
}

const runColumns: ProTableColumn[] = [
  { prop: 'task_id', label: '任务 ID', minWidth: 210 },
  { prop: 'action', label: '动作', minWidth: 150 },
  { prop: 'dept', label: '归属', width: 110 },
  { prop: 'status', label: '状态', width: 100, align: 'center', slot: 'status' },
  { prop: 'attempts', label: '次数', width: 70, align: 'center' },
  { prop: 'duration_ms', label: '耗时(ms)', width: 90, align: 'right' },
  { prop: 'submitted_by', label: '提交人', minWidth: 120 },
  { prop: 'enqueued_at', label: '入队时间', width: 170, slot: 'time' },
  { prop: 'actions', label: '操作', width: 250, fixed: 'right', slot: 'actions', wrap: true },
]

/** 详情弹窗（getTask——job_runs 快照+live_state 实时态） */
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<TaskDetail | null>(null)

async function openDetail(row: TaskRunRow) {
  detailVisible.value = true
  detailLoading.value = true
  try {
    detail.value = await getTaskApi(row.task_id)
  } catch {
    detail.value = null
  } finally {
    detailLoading.value = false
  }
}

async function onCancelRun(row: TaskRunRow) {
  try {
    await ElMessageBox.confirm(`确认取消任务 ${row.task_id}？`, '取消任务', { type: 'warning' })
  } catch { return }
  try {
    await cancelTaskApi(row.task_id)
    ElMessage.success('已取消')
    runsTableRef.value?.refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '取消失败')
  }
}

async function onRetryRun(row: TaskRunRow) {
  try {
    await retryTaskApi(row.task_id)
    ElMessage.success('已重新入队')
    runsTableRef.value?.refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '重试失败')
  }
}

// ─── Tab2 死信（只读+重试；page/page_size 无 total）───
const deadList = ref<DeadLetterRow[]>([])
const deadLoading = ref(false)
const deadPage = ref(1)
const deadPageSize = 20
const deadEmptyPage = ref(false) // 空页=遍历终止（无 total 只能按空判）

// 审计修复（2026-09-30 P1）：死信 Tab 无初始加载触发点——首入惰性拉取（audit 页同款范式）
watch(activeTab, (t) => {
  if (t === 'dead' && !deadList.value.length && !deadLoading.value) fetchDead()
})

async function fetchDead(p = deadPage.value) {
  deadLoading.value = true
  try {
    const res = await listDeadLettersApi({ page: p, page_size: deadPageSize })
    deadList.value = res.list ?? []
    deadPage.value = res.page
    deadEmptyPage.value = deadList.value.length === 0
  } catch {
    deadList.value = []
  } finally {
    deadLoading.value = false
  }
}

async function onRetryDead(row: DeadLetterRow) {
  try {
    await retryTaskApi(row.task_id)
    ElMessage.success('已重新入队（死信移出）')
    fetchDead()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '重试失败')
  }
}

// ─── Tab3 任务定义（offset+total——ProTable；写挂 task:manage）───
const jobsTableRef = ref<InstanceType<typeof ProTable>>()

function fetchJobs(params: { page: number; page_size: number }) {
  return listJobsApi({ page: params.page, page_size: params.page_size })
}

const jobColumns: ProTableColumn[] = [
  { prop: 'job_id', label: '任务 ID', width: 200 },
  { prop: 'action_id', label: '动作', width: 150 },
  { prop: 'trigger_type', label: '触发', width: 90, align: 'center', slot: 'trigger' },
  { prop: 'cron_spec', label: 'cron', width: 120 },
  { prop: 'dept', label: '归属', width: 110 },
  { prop: 'enabled', label: '启用', width: 80, align: 'center', slot: 'enabled' },
  { prop: 'description', label: '说明', minWidth: 160 },
  { prop: 'updated_at', label: '更新时间', width: 170, slot: 'time' },
  { prop: 'actions', label: '操作', width: 200, fixed: 'right', slot: 'jobActions', wrap: true },
]

async function onToggleJob(row: TaskJobRow, enabled: boolean) {
  try {
    await updateJobApi({ job_id: row.job_id, enabled })
    ElMessage.success(enabled ? '已启用' : '已停用')
    jobsTableRef.value?.refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '操作失败')
  }
}

async function onTriggerJob(row: TaskJobRow) {
  try {
    await triggerJobApi(row.job_id)
    ElMessage.success('已手动触发')
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    ElMessage.error(resp?.message ?? '触发失败')
  }
}

/** 新建任务定义 */
const jobVisible = ref(false)
const jobSaving = ref(false)
const jobError = ref('')
const jobForm = reactive({
  action_id: '',
  trigger_type: 'cron',
  cron_spec: '',
  dept: '',
  timeout_secs: 0,
  description: '',
  paramsText: '{}',
})

function openCreateJob() {
  jobError.value = ''
  Object.assign(jobForm, { action_id: '', trigger_type: 'cron', cron_spec: '', dept: '', timeout_secs: 0, description: '', paramsText: '{}' })
  jobVisible.value = true
}

async function submitJob() {
  if (!jobForm.action_id.trim()) {
    jobError.value = '请输入 action_id（须在服务端动作注册表内）'
    return
  }
  let params: unknown
  try {
    params = jobForm.paramsText.trim() ? JSON.parse(jobForm.paramsText) : undefined
  } catch {
    jobError.value = 'params 须为合法 JSON'
    return
  }
  jobSaving.value = true
  jobError.value = ''
  try {
    await createJobApi({
      action_id: jobForm.action_id.trim(),
      trigger_type: jobForm.trigger_type,
      ...(jobForm.trigger_type === 'cron' ? { cron_spec: jobForm.cron_spec } : {}),
      ...(jobForm.dept ? { dept: jobForm.dept } : {}),
      ...(params !== undefined ? { params } : {}),
      ...(jobForm.timeout_secs ? { timeout_secs: jobForm.timeout_secs } : {}),
      ...(jobForm.description ? { description: jobForm.description } : {}),
    })
    ElMessage.success('任务定义已创建')
    jobVisible.value = false
    jobsTableRef.value?.refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { message?: string } } })?.response?.data
    jobError.value = resp?.message ?? '创建失败，请稍后重试'
  } finally {
    jobSaving.value = false
  }
}

// ─── Tab4 提交任务（task:submit；受理≠成功——结果经查询获取）───
const submitForm = reactive({ action: '', dept: '', timeout_secs: 0, paramsText: '' })
const submitBusy = ref(false)
const submitError = ref('')
const submittedId = ref('')

async function onSubmitTask() {
  if (!submitForm.action.trim()) {
    submitError.value = '请输入 action（须在服务端动作注册表内）'
    return
  }
  if (submitForm.paramsText.length > 64 * 1024) {
    submitError.value = 'params 超过上限（64KB）'
    return
  }
  let params: unknown
  try {
    params = submitForm.paramsText.trim() ? JSON.parse(submitForm.paramsText) : undefined
  } catch {
    submitError.value = 'params 须为合法 JSON'
    return
  }
  submitBusy.value = true
  submitError.value = ''
  try {
    const { task_id } = await submitTaskApi({
      action: submitForm.action.trim(),
      ...(submitForm.dept ? { dept: submitForm.dept } : {}),
      ...(params !== undefined ? { params } : {}),
      ...(submitForm.timeout_secs ? { timeout_secs: submitForm.timeout_secs } : {}),
    })
    submittedId.value = task_id
    ElMessage.success(`已受理（task_id：${task_id}）——执行结果在「运行记录」查询`)
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    submitError.value = resp?.message ?? '提交失败，请稍后重试'
  } finally {
    submitBusy.value = false
  }
}

function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

const deadTable = ref()
useTableFit(deadTable, () => deadList.value)
</script>

<template>
  <div class="fill-page p-4">
    <el-card shadow="never">
      <el-tabs v-model="activeTab" class="fill-tabs">
        <!-- ── Tab1 运行记录 ── -->
        <el-tab-pane label="运行记录" name="runs">
          <ProTable ref="runsTableRef" :columns="runColumns" :fetcher="fetchRuns" fill>
            <template #search>
              <el-form inline @submit.prevent>
                <el-form-item label="request_id">
                  <el-input v-model="runsSearch.request_id" placeholder="请求 ID 精确查" clearable class="!w-52" />
                </el-form-item>
                <el-form-item label="动作">
                  <el-input v-model="runsSearch.action" placeholder="action" clearable class="!w-36" />
                </el-form-item>
                <el-form-item label="状态">
                  <el-select v-model="runsSearch.status" placeholder="全部" clearable class="!w-32">
                    <el-option v-for="(v, k) in RUN_STATUS" :key="k" :label="v.label" :value="k" />
                  </el-select>
                </el-form-item>
                <el-form-item label="只看我提交的">
                  <el-switch v-model="runsSearch.mine" />
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" @click="runsTableRef?.refresh({ resetPage: true })">查询</el-button>
                </el-form-item>
              </el-form>
            </template>

            <template #status="{ row }">
              <el-tag :type="statusInfo((row as TaskRunRow).status).tag" size="small">
                {{ statusInfo((row as TaskRunRow).status).label }}
              </el-tag>
            </template>
            <template #time="{ row }">{{ formatTime((row as TaskRunRow).enqueued_at) }}</template>
            <template #actions="{ row }">
              <el-button link type="primary" size="small" @click="openDetail(row as TaskRunRow)">详情</el-button>
              <!-- 禁用态=后端前置态提示（十三批 S13）：不符仍可点、409 内联 -->
              <el-button
                v-permission="'task:operate'" link type="warning" size="small"
                :disabled="(row as TaskRunRow).status !== 'pending'"
                @click="onCancelRun(row as TaskRunRow)"
              >取消</el-button>
              <el-button
                v-permission="'task:operate'" link type="danger" size="small"
                :disabled="!['failed', 'dead'].includes((row as TaskRunRow).status)"
                @click="onRetryRun(row as TaskRunRow)"
              >重试</el-button>
            </template>
          </ProTable>
        </el-tab-pane>

        <!-- ── Tab2 死信（只读+重试；无 total 按页号翻） ── -->
        <el-tab-pane label="死信" name="dead">
          <div class="min-h-0 flex-initial">
            <el-table ref="deadTable" :data="deadList" v-loading="deadLoading" row-key="task_id" height="100%">
            <el-table-column prop="task_id" label="任务 ID" min-width="210" show-overflow-tooltip />
            <el-table-column prop="action" label="动作" width="150" show-overflow-tooltip />
            <el-table-column prop="error" label="最后错误" min-width="220" show-overflow-tooltip />
            <el-table-column prop="failed_at" label="失败时间" width="170">
              <template #default="{ row }">{{ formatTime((row as DeadLetterRow).failed_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="110" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-permission="'task:operate'" link type="danger" size="small"
                  @click="onRetryDead(row as DeadLetterRow)"
                >重试</el-button>
              </template>
            </el-table-column>
            </el-table>
          </div>
          <div class="flex items-center justify-between mt-3">
            <span class="text-xs text-gray-400">第 {{ deadPage }} 页 · 每页 {{ deadPageSize }} 条（无总数统计）</span>
            <div>
              <el-button size="small" :disabled="deadPage <= 1 || deadLoading" @click="fetchDead(deadPage - 1)">上一页</el-button>
              <el-button size="small" :disabled="deadEmptyPage || deadList.length < deadPageSize || deadLoading" @click="fetchDead(deadPage + 1)">下一页</el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- ── Tab3 任务定义（写挂 task:manage） ── -->
        <el-tab-pane label="任务定义" name="jobs">
          <ProTable ref="jobsTableRef" :columns="jobColumns" :fetcher="fetchJobs" fill>
            <template #toolbar>
              <div>
                <el-button v-permission="'task:manage'" type="primary" @click="openCreateJob">新建任务</el-button>
              </div>
              <div />
            </template>
            <template #trigger="{ row }">
              <el-tag size="small" :type="(row as TaskJobRow).trigger_type === 'cron' ? 'warning' : 'info'">
                {{ (row as TaskJobRow).trigger_type === 'cron' ? '定时' : (row as TaskJobRow).trigger_type }}
              </el-tag>
            </template>
            <template #enabled="{ row }">
              <el-switch
                :model-value="(row as TaskJobRow).enabled" v-permission="'task:manage'"
                @change="(v: string | number | boolean) => onToggleJob(row as TaskJobRow, Boolean(v))"
              />
            </template>
            <template #time="{ row }">{{ formatTime((row as TaskJobRow).updated_at) }}</template>
            <template #jobActions="{ row }">
              <el-button
                v-permission="'task:manage'" link type="primary" size="small"
                :disabled="!(row as TaskJobRow).enabled"
                @click="onTriggerJob(row as TaskJobRow)"
              >手动触发</el-button>
            </template>
          </ProTable>
        </el-tab-pane>

        <!-- ── Tab4 提交任务（task:submit） ── -->
        <el-tab-pane label="提交任务" name="submit">
          <div class="max-w-[640px]">
            <el-alert
              title="提交≠执行成功：受理后由队列异步执行，结果在「运行记录」按 task_id 查询"
              type="info" show-icon :closable="false" class="mb-4"
            />
            <el-alert v-if="submitError" :title="submitError" type="error" show-icon class="mb-4" :closable="false" />
            <el-alert v-if="submittedId" :title="`最近提交：${submittedId}`" type="success" show-icon class="mb-4" :closable="false" />
            <el-form label-width="110px">
              <el-form-item label="action" required>
                <el-input v-model="submitForm.action" placeholder="服务端动作注册表内的 action_id" />
              </el-form-item>
              <el-form-item label="归属标签">
                <el-input v-model="submitForm.dept" placeholder="dept（可选——一次性任务归属）" />
              </el-form-item>
              <el-form-item label="超时（秒）">
                <el-input-number v-model="submitForm.timeout_secs" :min="0" :max="86400" />
                <span class="text-xs text-gray-400 ml-2">0=默认 30s</span>
              </el-form-item>
              <el-form-item label="params">
                <el-input v-model="submitForm.paramsText" type="textarea" :rows="5" placeholder='JSON 对象（可选），如 {"user_id":"1"}' />
                <div class="text-xs text-[var(--el-color-danger)] mt-1">
                  ⚠ 勿填写口令/密钥/PII——共享队列全可见（params 全量快照随执行记录留存）
                </div>
              </el-form-item>
              <el-form-item>
                <el-button v-permission="'task:submit'" type="primary" :loading="submitBusy" @click="onSubmitTask">提交任务</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 任务详情（job_runs 快照 + live_state） -->
    <el-dialog v-model="detailVisible" title="任务详情" width="720px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="任务 ID">{{ detail.task_id }}</el-descriptions-item>
            <el-descriptions-item label="request_id">{{ detail.request_id || '—' }}</el-descriptions-item>
            <el-descriptions-item label="action">{{ detail.action }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              {{ statusInfo(detail.status).label }}
              <el-tag v-if="detail.live_state" size="small" class="ml-2">实时：{{ detail.live_state }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="提交人">{{ detail.submitted_by }}</el-descriptions-item>
            <el-descriptions-item label="耗时">{{ detail.duration_ms }} ms / {{ detail.attempts }} 次</el-descriptions-item>
            <el-descriptions-item label="入队">{{ formatTime(detail.enqueued_at) }}</el-descriptions-item>
            <el-descriptions-item label="完成">{{ formatTime(detail.finished_at) }}</el-descriptions-item>
          </el-descriptions>
          <div class="mt-3">
            <div class="text-xs text-gray-400 mb-1">params（快照）</div>
            <pre class="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded">{{ detail.params || '（无）' }}</pre>
          </div>
          <div v-if="detail.error" class="mt-2">
            <div class="text-xs text-gray-400 mb-1">错误</div>
            <pre class="whitespace-pre-wrap text-xs text-[var(--el-color-danger)]">{{ detail.error }}</pre>
          </div>
        </template>
        <div v-else-if="!detailLoading" class="text-sm text-gray-400">未查到该任务</div>
      </div>
    </el-dialog>

    <!-- 新建任务定义 -->
    <el-dialog v-model="jobVisible" title="新建任务定义" width="560px">
      <el-alert v-if="jobError" :title="jobError" type="error" show-icon class="mb-4" :closable="false" />
      <el-form label-width="100px">
        <el-form-item label="action_id" required>
          <el-input v-model="jobForm.action_id" placeholder="服务端动作注册表内" />
        </el-form-item>
        <el-form-item label="触发类型">
          <el-select v-model="jobForm.trigger_type" class="!w-40">
            <el-option label="cron 定时" value="cron" />
            <el-option label="手动" value="manual" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="jobForm.trigger_type === 'cron'" label="cron 表达式">
          <el-input v-model="jobForm.cron_spec" placeholder="如 0 3 * * *（每日 3 点）" />
        </el-form-item>
        <el-form-item label="归属标签">
          <el-input v-model="jobForm.dept" placeholder="dept（可选）" />
        </el-form-item>
        <el-form-item label="超时（秒）">
          <el-input-number v-model="jobForm.timeout_secs" :min="0" :max="86400" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="jobForm.description" />
        </el-form-item>
        <el-form-item label="params">
          <el-input v-model="jobForm.paramsText" type="textarea" :rows="4" />
          <div class="text-xs text-[var(--el-color-danger)] mt-1">⚠ 勿填写口令/密钥/PII（同提交表单口径）</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="jobVisible = false">取消</el-button>
        <el-button type="primary" :loading="jobSaving" @click="submitJob">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>
