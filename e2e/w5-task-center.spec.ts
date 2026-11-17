/** W5: task administration does not imply the independent audit_archive maintenance grant.
 * Standard-stack admin has no maintainer grant. No successful maintenance action is fabricated.
 * Core HTTP tests own zero-outbound/zero-archive-side-effect assertions; browser checks denial UX and unchanged runs/jobs.
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData } from './helpers'
import { uiLogin } from './ui'

test('W5：任务中心读旅程与未获维护资格的audit_archive拒绝', async ({ page }) => {
  const state = loadState()
  const login = await apiLogin(state.admin.employeeNo, state.admin.password, 'w5-maintenance-denied')
  const h = { token: login.env!.data.access_token } as const
  const runsPath = '/api/v1/runs?action=audit_archive&page=1&page_size=100'
  const beforeRuns = await mustData(api<{ total: number }>(runsPath, h), 'runs before')
  const beforeJobs = await mustData(api<{ total: number }>('/api/v1/jobs?page=1&page_size=100', h), 'jobs before')
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/tasks')
  await expect(page.getByRole('tab', { name: '运行记录' })).toBeVisible()
  await page.getByRole('tab', { name: '任务定义' }).click()
  await page.getByRole('button', { name: '新建任务' }).click()
  const dlg = page.locator('.el-dialog:visible')
  await dlg.getByTestId('job-action-select').click()
  const maintenanceAction = page.getByRole('option', { name: /\baudit_archive\b/ })
  await expect(maintenanceAction).toHaveCount(1)
  await maintenanceAction.click()
  await dlg.locator('.el-form-item').filter({ hasText: '说明' }).locator('input').fill('e2e must not create maintenance definition')
  await dlg.locator('.el-form-item').filter({ hasText: '触发类型' }).locator('.el-select').click()
  await page.getByRole('option', { name: '手动', exact: true }).click()
  const deniedResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/jobs' && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '创建', exact: true }).click()
  const denied = await deniedResponse
  expect(denied.status()).toBe(403)
  expect((await denied.json()).code).toBe(10003)
  await expect(dlg).toBeVisible()
  await expect(dlg.getByText('禁止访问', { exact: true })).toBeVisible()
  await dlg.getByRole('button', { name: '取消', exact: true }).click()
  const submit = await api('/api/v1/tasks', { ...h, method: 'POST', body: { action: 'audit_archive' } })
  expect(submit.status).toBe(403)
  expect(submit.env?.code).toBe(10003)
  expect((await mustData(api<{ total: number }>(runsPath, h), 'runs after')).total).toBe(beforeRuns.total)
  expect((await mustData(api<{ total: number }>('/api/v1/jobs?page=1&page_size=100', h), 'jobs after')).total).toBe(beforeJobs.total)
  const deadResponse = page.waitForResponse((r) => r.url().includes('/api/v1/dead-letters'))
  await page.getByRole('tab', { name: '死信' }).click()
  expect((await deadResponse).status()).toBe(200)
  await expect(page.getByRole('columnheader', { name: '任务 ID' })).toBeVisible()
})
