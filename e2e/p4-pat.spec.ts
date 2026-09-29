/**
 * P4-6 PAT 冒烟：Profile 页建凭据（明文一次展示）→Bearer 直发 /user/profile（等效登录态）
 * →UI 吊销→401。幂等：凭据带时间戳名，吊销即清理（行保留审计痕迹）。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(90_000)

test('P4-6 PAT：创建→Bearer 直发→吊销失效', async ({ page, request }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const patName = `E2E 凭据 ${suffix}`

  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/profile')
  await expect(page.getByText('API 凭据（PAT）')).toBeVisible({ timeout: 15_000 })

  // ── 创建：明文一次展示 ──
  await page.getByRole('button', { name: '新建凭据' }).click()
  await page.getByPlaceholder('凭据名称（如 CI 部署脚本）').fill(patName)
  await page.locator('.el-dialog').getByRole('button', { name: '创建' }).click()
  const secretBox = page.locator('.el-dialog pre')
  await expect(secretBox).toBeVisible({ timeout: 10_000 })
  const secret = (await secretBox.innerText()).trim()
  expect(secret.startsWith('zpat_')).toBe(true)
  await page.getByRole('button', { name: '我已保存，关闭' }).click()
  await expect(page.locator('.el-table__row').filter({ hasText: patName })).toBeVisible()

  // ── Bearer 直发（Playwright request 上下文——PAT 等效登录态）──
  const probe = await request.get('/api/v1/user/profile', { headers: { Authorization: `Bearer ${secret}` } })
  expect(probe.status()).toBe(200)
  const body = (await probe.json()) as { data: { employee_no?: string } }
  expect(body.data.employee_no).toBe(state.admin.employeeNo)

  // ── 吊销（UI）→ 再直发 401 ──
  const row = page.locator('.el-table__row').filter({ hasText: patName })
  await row.getByRole('button', { name: '吊销' }).click()
  await page.locator('.el-message-box').getByRole('button', { name: '吊销' }).click()
  await expect(row.getByText('已吊销')).toBeVisible({ timeout: 10_000 })
  const probe2 = await request.get('/api/v1/user/profile', { headers: { Authorization: `Bearer ${secret}` } })
  expect(probe2.status()).toBe(401)
})
