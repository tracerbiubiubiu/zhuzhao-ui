/**
 * task 域 API（P4-W5——经 zhuzhao 网关任务管理代理 E-④ → taskrunner 上游）
 *
 * wire 实况（与 taskrunner handler 对齐注记）：
 * - runs/jobs：offset 分页 {list,total,page,page_size}（OKPage——有 total 可用 ProTable）
 * - 死信：{list,page,page_size} **无 total**（十三批「无 total 形态」=al 域+死信；offset 非 cursor）
 * - 干预（cancel/retry）body={task_id}（C10 zhuzhao 风格）
 * - Submit 不传 callback_url（W0 P0-5 服务端定——传非空即 400）；params 上限 64KB
 * - submitted_by=me：zhuzhao 代理替换为 actor（username）透传（W5 随批件）
 */
import request from '@vea/request'

/** 执行记录行（RunView 投影——params 是字符串快照非对象） */
export interface TaskRunRow {
  task_id: string
  request_id: string
  action: string
  job_id: string
  dept: string
  params: string
  status: string
  attempts: number
  error: string
  duration_ms: number
  submitted_by: string
  enqueued_at: string
  started_at?: string | null
  finished_at?: string | null
}

/** 任务全景（GetTask——job_runs 快照 + live_state 实时态） */
export interface TaskDetail extends TaskRunRow {
  source_ip?: string
  live_state?: string
}

/** 死信行 */
export interface DeadLetterRow {
  task_id: string
  request_id?: string
  action: string
  job_id?: string
  dept?: string
  params?: string
  error: string
  attempts?: number
  failed_at?: string
  [k: string]: unknown
}

/** 任务定义（JobView 投影） */
export interface TaskJobRow {
  job_id: string
  action_id: string
  trigger_type: string
  cron_spec: string
  callback_url: string
  params: unknown
  dept: string
  enabled: boolean
  timeout_secs: number
  description: string
  created_by: string
  owner_service: string
  created_at: string
  updated_at: string
}

// ─── 提交/查询（task:submit / task:read）───

/** 提交一次性任务（受理≠执行成功——结果经查询获取；action 白名单属服务端 action 注册表） */
export async function submitTaskApi(input: {
  action: string
  dept?: string
  params?: unknown
  timeout_secs?: number
}): Promise<{ task_id: string }> {
  const data = await request.post('/api/v1/tasks', input, { _silentError: true })
  return data as unknown as { task_id: string }
}

export async function getTaskApi(taskId: string): Promise<TaskDetail> {
  const data = await request.get(`/api/v1/tasks/${encodeURIComponent(taskId)}`)
  return data as unknown as TaskDetail
}

// ─── 运行记录（task:read；submitted_by=me 由 zhuzhao 代理换 actor）───

export interface RunListQuery {
  request_id?: string
  action?: string
  status?: string
  job_id?: string
  dept?: string
  from?: string
  to?: string
  submitted_by?: 'me'
}

export async function listRunsApi(
  params: { page: number; page_size: number } & RunListQuery,
): Promise<{ list: TaskRunRow[]; total: number }> {
  const data = await request.get('/api/v1/runs', { params })
  return data as unknown as { list: TaskRunRow[]; total: number }
}

// ─── 死信（只读列表+重试；task:read / task:operate）───

export async function listDeadLettersApi(
  params: { page: number; page_size: number },
): Promise<{ list: DeadLetterRow[]; page: number; page_size: number }> {
  const data = await request.get('/api/v1/dead-letters', { params })
  return data as unknown as { list: DeadLetterRow[]; page: number; page_size: number }
}

// ─── 干预（task:operate；409=前置态不符透传）───

export async function cancelTaskApi(taskId: string): Promise<void> {
  await request.post('/api/v1/tasks/cancel', { task_id: taskId }, { _silentError: true })
}

export async function retryTaskApi(taskId: string): Promise<void> {
  await request.post('/api/v1/tasks/retry', { task_id: taskId }, { _silentError: true })
}

// ─── 任务定义（task:manage）───

export async function listJobsApi(
  params: { page: number; page_size: number; dept?: string; action_id?: string; enabled?: boolean },
): Promise<{ list: TaskJobRow[]; total: number }> {
  const data = await request.get('/api/v1/jobs', { params })
  return data as unknown as { list: TaskJobRow[]; total: number }
}

export async function createJobApi(input: {
  action_id: string
  trigger_type: string
  cron_spec?: string
  params?: unknown
  dept?: string
  timeout_secs?: number
  description?: string
}): Promise<TaskJobRow> {
  const data = await request.post('/api/v1/jobs', input, { _silentError: true })
  return data as unknown as TaskJobRow
}

/** patch：enabled 启停为主（cron/params/description 指针可改） */
export async function updateJobApi(input: {
  job_id: string
  enabled?: boolean
  cron_spec?: string
  params?: unknown
  description?: string
}): Promise<void> {
  await request.post('/api/v1/jobs/update', input, { _silentError: true })
}

/** 手动触发（enabled=false 时 409——按钮禁用态对齐 S13） */
export async function triggerJobApi(jobId: string): Promise<void> {
  await request.post('/api/v1/jobs/trigger', { job_id: jobId }, { _silentError: true })
}

/** 任务状态（runs.status 枚举——live_state 实时态另有 active/pending/canceled 等队列态） */
export const RUN_STATUS: Record<string, { label: string; tag: 'success' | 'warning' | 'danger' | 'info' }> = {
  succeeded: { label: '成功', tag: 'success' },
  failed: { label: '失败', tag: 'danger' },
  dead: { label: '死信', tag: 'danger' },
  canceled: { label: '已取消', tag: 'info' },
  running: { label: '执行中', tag: 'warning' },
  pending: { label: '排队中', tag: 'warning' },
}
