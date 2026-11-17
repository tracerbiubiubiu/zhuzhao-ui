/** A dedicated startup maintainer uses the real browser -> core -> TR -> callback path.
 * No fake downstream, no automatic maintenance grant, and no shared-stack defaults.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { api, apiLogin, mustData, waitUserRateBudget } from './helpers'
import { uiLogin } from './ui'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`W5 maintenance requires ${name}; use an owned isolated stack and a dedicated approved account`)
  return value
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

test('W5：独立维护者从浏览器提交并取得双端持久成功与在线记录变化', async ({ page }) => {
  test.setTimeout(120_000)
  const employeeNo = required('E2E_MAINTAINER_EMPLOYEE_NO')
  const password = required('E2E_MAINTAINER_PASSWORD')
  const owner = required('E2E_MAINTENANCE_STACK_OWNER')
  const container = required('E2E_PG_CONTAINER')
  const pgUser = required('E2E_PG_USER')
  const pgDb = required('E2E_PG_DB')
  const sqlite = required('E2E_TASKRUNNER_DB')
  required('E2E_API_BASE')
  required('E2E_BASE_URL')
  expect(employeeNo, 'Use a dedicated account; never grant the seed account maintenance authority').toMatch(/^E\d{6}$/)
  expect(Number(employeeNo.slice(1))).toBeGreaterThanOrEqual(2)
  const labels = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', container], { encoding: 'utf8', timeout: 10_000 })) as Record<string, string>
  expect(labels['audit.owner'], 'The archive effect fixture must belong to the declared isolated stack').toBe(owner)
  expect(labels['com.docker.compose.project']).toBe(owner)

  const pg = (sql: string): string => execFileSync('docker', [
    'exec', container, 'psql', '-U', pgUser, '-d', pgDb, '-qt', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ], { encoding: 'utf8', timeout: 10_000 }).trim()
  const tr = (sql: string): string => execFileSync('sqlite3', [
    '-readonly', '-cmd', '.timeout 5000', sqlite, sql,
  ], { encoding: 'utf8', timeout: 10_000 }).trim()

  const login = await mustData(apiLogin(employeeNo, password, 'w5-approved-maintainer'), 'dedicated maintenance login')
  const h = { token: login.access_token }
  const tag = `w5_maintenance_${randomUUID()}`
  const oldPath = `/__e2e_maintenance/${tag}/old`
  const recentPath = `/__e2e_maintenance/${tag}/recent`
  const job = await mustData(api<{ job_id: string }>('/api/v1/jobs', {
    ...h, method: 'POST', body: { action_id: 'audit_archive', trigger_type: 'manual', params: {}, description: tag },
  }), 'create owned manual definition')
  try {
    pg(`INSERT INTO audit_logs(username,method,path,status_code,duration,created_at) VALUES ('e2e_maintenance','GET',${sqlString(oldPath)},200,1,NOW()-INTERVAL '200 days'), ('e2e_maintenance','GET',${sqlString(recentPath)},200,1,NOW())`)
    await uiLogin(page, employeeNo, password)
    await page.goto('/#/tasks')
    await expect(page.getByRole('tab', { name: '运行记录', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '提交任务', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '提交任务', exact: true })
    await dialog.getByRole('combobox', { name: /任务定义/ }).click()
    await page.getByRole('option', { name: `${tag}（audit_archive）`, exact: true }).click()
    await expect(dialog.getByTestId('maintenance-guidance')).toContainText('任务管理权限不包含审计维护资格')
    await dialog.getByPlaceholder('dept（可选）').fill(tag)
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/tasks' && r.request().method() === 'POST')
    await dialog.getByRole('button', { name: '提交任务', exact: true }).click()
    const submitted = await response
    expect(submitted.status()).toBe(200)
    const envelope = await submitted.json() as { code: number; data: { task_id: string } }
    expect(envelope.code).toBe(0)
    const taskId = envelope.data.task_id
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/)
    await expect(dialog).not.toBeVisible()

    await expect.poll(async () => {
      const detail = await mustData(api<{ status: string }>(`/api/v1/tasks/${encodeURIComponent(taskId)}`, h), 'maintenance task result')
      if (detail.status === 'failed' || detail.status === 'dead' || detail.status === 'canceled') throw new Error(`Maintenance task ended ${detail.status}`)
      return detail.status
    }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe('succeeded')
    expect(pg(`SELECT action || '|' || status FROM job_submissions WHERE task_id=${sqlString(taskId)}`)).toBe('audit_archive|succeeded')
    expect(tr(`SELECT action || '|' || status FROM job_runs WHERE task_id=${sqlString(taskId)}`)).toBe('audit_archive|succeeded')
    expect(pg(`SELECT count(*) FROM maintenance_task_admissions a JOIN users u ON u.id=a.principal_user_id WHERE a.task_id=${sqlString(taskId)} AND a.origin='manual' AND u.employee_no=${sqlString(employeeNo)}`)).toBe('1')
    expect(pg(`SELECT count(*) FROM audit_logs WHERE path=${sqlString(oldPath)}`)).toBe('0')
    expect(pg(`SELECT count(*) FROM audit_logs WHERE path=${sqlString(recentPath)}`)).toBe('1')

    await waitUserRateBudget()
    await page.reload()
    const row = page.getByRole('row').filter({ hasText: tag })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('成功')
    await row.getByRole('button', { name: '详情', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '任务详情', exact: true })
    await expect(drawer).toContainText(taskId)
    await expect(drawer).toContainText('成功')
    await test.info().attach('maintenance-chain.json', {
      body: JSON.stringify({ task_id: taskId, core: 'succeeded', taskrunner: 'succeeded', principal_bound: true, old_marker_removed: true, recent_marker_preserved: true }),
      contentType: 'application/json',
    })
  } finally {
    // Definitions have no delete API; leave the owned fixture disabled until stack teardown.
    await mustData(api('/api/v1/jobs/update', { ...h, method: 'POST', body: { job_id: job.job_id, enabled: false } }), 'disable owned maintenance definition')
    pg(`DELETE FROM audit_logs WHERE path IN (${sqlString(oldPath)},${sqlString(recentPath)})`)
  }
})
