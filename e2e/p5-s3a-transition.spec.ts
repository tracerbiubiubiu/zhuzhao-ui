/**
 * P5-S3a 统一转换端点（B3-1）：详情页按 GET /tickets/:id/transitions/available 渲染转换按钮，
 * 点击走 POST /tickets/transition → 状态标签变更 → 按钮集随新状态刷新；available **按人过滤**
 * （无处理人时 in_progress 不渲染——仅处理人可推进）。走 incident 默认图 open→assigned→in_progress；
 * 末尾以 API 复核落库状态（非前端乐观更新）。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData } from './helpers'
import { uiLogin } from './ui'

test('P5-S3a：转换按钮按 available 渲染并驱动 open→assigned→in_progress', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)

  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'p5-s3a-t')
  expect(admin.env?.code).toBe(0)
  const h = { token: admin.env!.data.access_token } as const
  const me = await mustData(api<{ id: string }>('/api/v1/user/profile', h), 'GET /user/profile')
  const orgId = (await mustData(api<Array<{ id: string }>>('/api/v1/orgs', h), 'GET /orgs'))[0].id
  const created = await api<{ id: string }>('/api/v1/tickets', {
    ...h, method: 'POST', body: { type_code: 'incident', title: `P5-S3a 转换_${suffix}`, org_id: orgId },
  })
  expect(created.env?.code, '建单须成功').toBe(0)
  const tid = created.env!.data.id

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto(`/#/tickets/${tid}`)

    const statusTag = page.locator('.el-card').first().locator('.el-tag').first()
    await expect(statusTag).toHaveText('待处理', { timeout: 20_000 })

    // open → [assigned, closed]（incident 默认图）；in_progress 不可直达
    await expect(page.getByTestId('btn-transition-assigned')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('btn-transition-closed')).toBeVisible()
    await expect(page.getByTestId('btn-transition-in_progress')).toHaveCount(0)

    await page.getByTestId('btn-transition-assigned').click()
    await expect(statusTag).toHaveText('已分派', { timeout: 10_000 })
    // assigned → 图上 [in_progress, open]，但 available **按人过滤**：本单无处理人，推进 in_progress
    // 仅处理人可触发 → 不渲染；回退 open 对管理员可见；closed 不再可达（图约束）
    await expect(page.getByTestId('btn-transition-open')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('btn-transition-in_progress')).toHaveCount(0)
    await expect(page.getByTestId('btn-transition-closed')).toHaveCount(0)

    // 分派给 admin（API）→ 成为处理人 → in_progress 可达 → 点击推进
    const assign = await api('/api/v1/tickets/assign', { ...h, method: 'POST', body: { id: tid, assigned_to: me.id } })
    expect(assign.env?.code).toBe(0)
    await page.reload()
    await expect(statusTag).toHaveText('已分派', { timeout: 20_000 })
    await expect(page.getByTestId('btn-transition-in_progress')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('btn-transition-in_progress').click()
    await expect(statusTag).toHaveText('进行中', { timeout: 10_000 })

    const got = await api<{ status: string }>(`/api/v1/tickets/${tid}`, h)
    expect(got.env?.data.status, '状态须落库').toBe('in_progress')
  } finally {
    await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: tid } }).catch(() => {})
  }
})
