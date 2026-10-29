<script setup lang="ts">
/**
 * 任务中心（P4-W5；2026-10-13 交互批——三 Tab：运行记录/任务定义/死信，提交=运行记录
 *  页首主按钮+对话框。一期改造：运行序号列与筛选/定义下拉带默认参数/无参任务隐藏参数区
 *  （admin 视角；S4 B4-1 起 operator 的 action 输入改**动作下拉**——数据源
 *   GET /jobs/actions 最小读面，加载失败回退手填））
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
import { formatDateTime } from '@/utils/datetime'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useAutoFilterRun, useTableFit } from '@vea/hooks'
import { usePermission } from '@/common/auth'
import {
  ElAlert, ElBadge, ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber,
  ElMessage, ElMessageBox, ElOption, ElSelect, ElSwitch, ElTabPane, ElTabs, ElTable,
  ElTableColumn, ElTag, ElDescriptions, ElDescriptionsItem,
} from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import CronBuilder from '@/components/CronBuilder/index.vue'
import type { ProTableColumn } from '@/components/ProTable/types'
import {
  cancelTaskApi, createJobApi, getTaskApi, listDeadLettersApi, listJobActionsApi, listJobsApi, listRunsApi,
  retryTaskApi, submitTaskApi, triggerJobApi, updateJobApi,
  RUN_STATUS, type DeadLetterRow, type JobActionRow, type TaskDetail, type TaskJobRow, type TaskRunRow,
} from '@/api/task'

// keep-alive 契约：name=动态路由名（菜单 code task_center，组件路径 task/list/index）
defineOptions({ name: 'task_center' })

const activeTab = ref('runs')

const { hasPerm } = usePermission()
/** 任务定义 Tab = /jobs* 数据面，B13 矩阵 admin 专属——无 task:manage 整个 Tab 不渲染
 *（此前仅按钮挂 v-permission，Tab 面板急切渲染仍对 operator/viewer 发 GET /jobs → 403 toast）*/
const canManageJobs = computed(() => hasPerm('task:manage'))

// ─── 队列水位条（页首——排队/执行/失败/死信计数，30s 轮询；点击即按状态过滤）
// 数据源=runs 端点按 status 各拉 total（零后端改动；语义=job_runs 表态，队列瞬时深度
// 走 P5-S4 登记的 asynq Inspector 端点，触发驱动）───
const waterline = ref<Record<string, number>>({})
const waterlineDefs = [
  { key: 'pending', label: '排队中', color: 'var(--el-color-warning)' },
  { key: 'running', label: '执行中', color: 'var(--el-color-primary)' },
  { key: 'failed', label: '已失败', color: 'var(--el-color-danger)' },
  { key: 'dead', label: '死信', color: 'var(--el-color-info)' },
]
let waterlineTimer: ReturnType<typeof setInterval> | undefined

async function fetchWaterline() {
  const results = await Promise.allSettled(
    waterlineDefs.map(({ key }) => listRunsApi({ status: key, page: 1, page_size: 1 })),
  )
  const next: Record<string, number> = {}
  results.forEach((r, i) => {
    next[waterlineDefs[i].key] = r.status === 'fulfilled' ? ((r.value as { total?: number })?.total ?? 0) : 0
  })
  waterline.value = next
}

function jumpWaterline(key: string) {
  runsSearch.status = key
  if (key === 'dead') {
    activeTab.value = 'dead'
    fetchDead()
  } else {
    activeTab.value = 'runs'
    runsTableRef.value?.refresh({ resetPage: true })
  }
}

onMounted(() => {
  fetchWaterline()
  waterlineTimer = setInterval(fetchWaterline, 30_000)
})
onUnmounted(() => {
  if (waterlineTimer) clearInterval(waterlineTimer)
})

// ─── Tab1 运行记录（offset+total——ProTable）───
const runsTableRef = ref<InstanceType<typeof ProTable>>()
const runsSearch = reactive({ seq: '', request_id: '', action: '', status: '', mine: false })

function fetchRuns(params: { page: number; page_size: number }) {
  return listRunsApi({
    page: params.page,
    page_size: params.page_size,
    ...(/^\d+$/.test(runsSearch.seq) ? { id: runsSearch.seq } : {}),
    ...(runsSearch.request_id ? { request_id: runsSearch.request_id } : {}),
    ...(runsSearch.action ? { action: runsSearch.action } : {}),
    ...(runsSearch.status ? { status: runsSearch.status } : {}),
    ...(runsSearch.mine ? { submitted_by: 'me' as const } : {}),
  })
}

// 筛选即时生效（筛选栏配方触发口径：runsSearch 全控件变更即查，文本防抖 300ms 收敛）
useAutoFilterRun(
  () => ({ ...runsSearch }),
  () => runsTableRef.value?.refresh({ resetPage: true }),
)

// 重置=清空筛选回首页（筛选栏配方「查询钮移除、重置保留」——与 audit/ticket/user 三页同款）
function onResetRuns() {
  runsSearch.seq = ''
  runsSearch.request_id = ''
  runsSearch.action = ''
  runsSearch.status = ''
  runsSearch.mine = false
  runsTableRef.value?.refresh({ resetPage: true })
}

function statusInfo(s: string) {
  return RUN_STATUS[s] ?? { label: s, tag: 'info' as const }
}

const runColumns: ProTableColumn[] = [
  { prop: 'id', label: '序号', width: 80 },
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
  void loadActionOptions() // 定义表单动作下拉与提交对话框共数据源（懒加载/失败回退同款）
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

// ─── 提交任务（task:submit；受理≠成功——结果经查询获取）───
// 交互（2026-10-13）：运行记录页首主按钮+对话框（原独立 Tab 收敛）。admin（task:manage）
// =任务定义下拉自动补全+带出定义默认参数（无参定义隐藏参数区）；operator（仅 task:submit，
// 无 /jobs 读权限——B13 数据面权限边界）暂保持 action 输入，选单依赖 P5-S4 动作注册表读端点
const submitVisible = ref(false)
const submitForm = reactive({ action: '', dept: '', timeout_secs: 0, paramsText: '' })
// S4 B4-1：动作下拉数据（提交对话框 operator 分支 + 新建定义表弹窗共用；加载失败回退手填输入——降级不阻塞）
const actionOptions = ref<JobActionRow[]>([])
const actionOptionsFailed = ref(false)
const actionLabel = (a: JobActionRow) => (a.name ? `${a.name}（${a.action_id}）` : a.action_id)

async function loadActionOptions() {
  if (actionOptions.value.length || actionOptionsFailed.value) return
  try {
    actionOptions.value = await listJobActionsApi()
  } catch {
    actionOptionsFailed.value = true // 回退手填（端点不可达不阻塞提交）
  }
}
const submitBusy = ref(false)
const submitError = ref('')
const submittedId = ref('')
const jobOptions = ref<TaskJobRow[]>([])
const jobOptionsLoading = ref(false)
const selectedJobId = ref('')
const selectedJob = computed(() => jobOptions.value.find((j) => j.job_id === selectedJobId.value) ?? null)
/** 定义级 params 归一化为编辑框文本（线上为 JSON 值——空对象/空=无参数） */
function jobParamsText(p: unknown): string {
  if (p == null) return ''
  if (typeof p === 'string') return p
  if (typeof p === 'object' && Object.keys(p as object).length === 0) return ''
  return JSON.stringify(p, null, 2)
}

/** admin 已选定义且有默认参数 → 显示参数编辑（带出定义默认值）；无参定义整块隐藏 */
const showSubmitParams = computed(() => (canManageJobs.value ? jobParamsText(selectedJob.value?.params) !== '' : true))

function jobLabel(j: TaskJobRow): string {
  return j.description ? `${j.description}（${j.action_id}）` : j.action_id
}

async function openSubmit() {
  submitError.value = ''
  submittedId.value = ''
  Object.assign(submitForm, { action: '', dept: '', timeout_secs: 0, paramsText: '' })
  void loadActionOptions()
  selectedJobId.value = ''
  jobOptions.value = []
  if (canManageJobs.value) {
    jobOptionsLoading.value = true
    try {
      const res = await listJobsApi({ page: 1, page_size: 200 })
      jobOptions.value = res.list ?? []
    } catch {
      jobOptions.value = []
    } finally {
      jobOptionsLoading.value = false
    }
  }
  submitVisible.value = true
}

// 选定义带出默认值（归属/超时/params 快照——定义级默认参数）
watch(selectedJobId, () => {
  const j = selectedJob.value
  if (!j) return
  submitForm.action = j.action_id
  submitForm.dept = j.dept || ''
  submitForm.timeout_secs = j.timeout_secs || 0
  // 定义级默认参数带出(归一化:对象格式化、字符串原样、空参为空串)
  submitForm.paramsText = jobParamsText(j.params)
})

async function onSubmitTask() {
  // 设计口径（§1 零权限判定注记）：canManageJobs 分支仅选择「表单形态」——
  // admin 走定义下拉取 action_id、operator 走手填 action，产出同一 wire 形态；
  // 真实边界在后端 task:submit，此处权限码不作任何业务许可判断
  const action = canManageJobs.value ? (selectedJob.value?.action_id ?? '') : submitForm.action
  if (!action.trim()) {
    submitError.value = canManageJobs.value ? '请选择任务定义' : '请选择动作'
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
      action: action.trim(),
      ...(submitForm.dept ? { dept: submitForm.dept } : {}),
      ...(params !== undefined ? { params } : {}),
      ...(submitForm.timeout_secs ? { timeout_secs: submitForm.timeout_secs } : {}),
    })
    submittedId.value = task_id
    ElMessage.success(`已受理（task_id：${task_id}）——执行结果在「运行记录」查询`)
    submitVisible.value = false
    activeTab.value = 'runs'
    runsTableRef.value?.refresh()
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { code?: number; message?: string } } })?.response?.data
    submitError.value = resp?.message ?? '提交失败，请稍后重试'
  } finally {
    submitBusy.value = false
  }
}

function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  return formatDateTime(iso)
}

const deadTable = ref()
useTableFit(deadTable, () => deadList.value)
</script>

<template>
  <div class="fill-page p-4">
    <el-card shadow="never">
      <!-- 队列水位条：排队/执行/失败/死信计数一屏可见（点击=按状态过滤；死信切 Tab） -->
      <div class="mb-3 flex items-center gap-3 flex-none" data-testid="queue-waterline">
        <span class="text-xs text-gray-400 flex-none">队列水位</span>
        <button
          v-for="w in waterlineDefs" :key="w.key" type="button"
          class="waterline-chip" @click="jumpWaterline(w.key)"
        >
          <span class="waterline-num" :style="{ color: w.color }">
            {{ waterline[w.key] ?? 0 }}
          </span>
          <span class="waterline-label">{{ w.label }}</span>
        </button>
        <el-button size="small" text bg class="!ml-auto" @click="fetchWaterline">刷新</el-button>
      </div>

      <el-tabs v-model="activeTab" class="fill-tabs">
        <!-- ── Tab1 运行记录 ── -->
        <el-tab-pane label="运行记录" name="runs">
          <ProTable ref="runsTableRef" :columns="runColumns" :fetcher="fetchRuns" fill>
            <template #toolbar>
              <div>
                <el-button v-permission="'task:submit'" type="primary" @click="openSubmit">提交任务</el-button>
              </div>
              <div />
            </template>
            <template #search>
              <el-form inline @submit.prevent>
                <!-- placeholder 式（筛选规范 v2 ⑧：禁 label 前缀敬语式，全仓形态统一 2026-10-29） -->
                <el-form-item>
                  <el-input v-model="runsSearch.seq" placeholder="任务序号，如 135" clearable class="!w-[140px]" />
                </el-form-item>
                <el-form-item>
                  <el-input v-model="runsSearch.request_id" placeholder="request_id（排障）" clearable class="!w-[180px]" />
                </el-form-item>
                <el-form-item>
                  <el-input v-model="runsSearch.action" placeholder="action" clearable class="!w-[120px]" />
                </el-form-item>
                <el-form-item>
                  <el-select v-model="runsSearch.status" placeholder="全部状态" clearable class="!w-[110px]">
                    <el-option v-for="(v, k) in RUN_STATUS" :key="k" :label="v.label" :value="k" />
                  </el-select>
                </el-form-item>
                <el-form-item>
                  <el-switch v-model="runsSearch.mine" active-text="只看我提交的" />
                </el-form-item>
                <el-form-item class="ml-auto !mr-0">
                  <el-button @click="onResetRuns">重置</el-button>
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

        <!-- ── Tab2 任务定义（B13：/jobs* admin 专属——无 task:manage 整 Tab 隐藏） ── -->
        <el-tab-pane v-if="canManageJobs" label="任务定义" name="jobs">
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

        <!-- ── Tab3 死信（第三位——需人工介入的告警面）（只读+重试；无 total 按页号翻；红点=存在待处理死信） ── -->
        <el-tab-pane name="dead">
          <template #label>
            <el-badge is-dot :hidden="!deadList.length" type="danger">死信</el-badge>
          </template>
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

    <!-- 提交任务（admin=定义下拉带默认参数；operator=action 输入——P5-S4 读端点后统一选单） -->
    <el-dialog v-model="submitVisible" title="提交任务" width="560px">
      <el-alert
        title="提交≠执行成功：受理后由队列异步执行，结果在「运行记录」查询"
        type="info" show-icon :closable="false" class="mb-4"
      />
      <el-alert v-if="submitError" :title="submitError" type="error" show-icon class="mb-4" :closable="false" />
      <el-form label-width="110px">
        <el-form-item v-if="canManageJobs" label="任务定义" required>
          <el-select
            v-model="selectedJobId" filterable :loading="jobOptionsLoading"
            placeholder="输入名称/动作过滤" class="!w-full"
          >
            <el-option v-for="j in jobOptions" :key="j.job_id" :label="jobLabel(j)" :value="j.job_id" />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="动作" required>
          <el-select
            v-if="!actionOptionsFailed"
            v-model="submitForm.action" filterable placeholder="选择动作（可搜索）" class="!w-[320px]" data-testid="action-select"
          >
            <el-option v-for="a in actionOptions" :key="a.action_id" :label="actionLabel(a)" :value="a.action_id">
              <span>{{ actionLabel(a) }}</span>
              <span v-if="a.description" class="text-xs text-gray-400 ml-2">{{ a.description }}</span>
            </el-option>
          </el-select>
          <el-input v-else v-model="submitForm.action" placeholder="action_id（回退手填）" title="动作清单加载失败时的手填回退" />
        </el-form-item>
        <el-form-item label="归属标签">
          <el-input v-model="submitForm.dept" placeholder="dept（可选）" />
        </el-form-item>
        <el-form-item label="超时（秒）">
          <el-input-number v-model="submitForm.timeout_secs" :min="0" :max="86400" />
          <span class="text-xs text-gray-400 ml-2">0=默认 30s</span>
        </el-form-item>
        <el-form-item v-if="showSubmitParams" label="params">
          <el-input v-model="submitForm.paramsText" type="textarea" :rows="5" placeholder='JSON 对象（可选）' />
          <div class="text-xs text-[var(--el-color-danger)] mt-1">
            ⚠ 勿填写口令/密钥/PII——共享队列全可见（params 全量快照随执行记录留存）
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitVisible = false">取消</el-button>
        <el-button v-permission="'task:submit'" type="primary" :loading="submitBusy" @click="onSubmitTask">提交任务</el-button>
      </template>
    </el-dialog>

    <!-- 新建任务定义 -->
    <el-dialog v-model="jobVisible" title="新建任务定义" width="560px">
      <el-alert v-if="jobError" :title="jobError" type="error" show-icon class="mb-4" :closable="false" />
      <el-form label-width="100px">
        <el-form-item label="动作" required>
          <!-- 手填 action_id 改动作下拉（与提交对话框同款：注册表清单可搜索、描述随行、加载失败回退手填） -->
          <el-select
            v-if="!actionOptionsFailed"
            v-model="jobForm.action_id" filterable placeholder="选择动作（可搜索）" class="!w-[320px]" data-testid="job-action-select"
          >
            <el-option v-for="a in actionOptions" :key="a.action_id" :label="actionLabel(a)" :value="a.action_id">
              <span>{{ actionLabel(a) }}</span>
              <span v-if="a.description" class="text-xs text-gray-400 ml-2">{{ a.description }}</span>
            </el-option>
          </el-select>
          <el-input v-else v-model="jobForm.action_id" placeholder="action_id（回退手填）" title="动作清单加载失败时的手填回退" />
        </el-form-item>
        <el-form-item label="触发类型">
          <el-select v-model="jobForm.trigger_type" class="!w-40">
            <el-option label="cron 定时" value="cron" />
            <el-option label="手动" value="manual" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="jobForm.trigger_type === 'cron'" label="cron 表达式">
          <!-- S4 B4-2：cron 构造器（预设/专家双模式——产物仍 cron_spec 五段，taskrunner 零改动） -->
          <CronBuilder v-model="jobForm.cron_spec" />
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

<style scoped>
/* 水位 chip：计数醒目、整块可点 */
.waterline-chip {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 8px 14px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  cursor: pointer;
}

.waterline-chip:hover {
  background: var(--el-fill-color);
}

.waterline-num {
  font-size: 20px;
  font-weight: 700;
}

.waterline-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
