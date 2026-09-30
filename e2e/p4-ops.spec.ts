/**
 * P4-8 P2 小件冒烟：audit 页三 Tab（日志/Panic 聚合/路由对账）+对账 0 gap 断言
 * （启动 fail-fast 已保证平——运行时对账应同样零缺口）。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(90_000)

test('P4-8 ops：三 Tab 可达+运行时对账零缺口', async ({ page }) => {
  const state = loadState()
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/audit')
  await expect(page.getByRole('columnheader', { name: '操作人' })).toBeVisible({ timeout: 15_000 })

  // Panic 聚合 Tab（四轮审计：原表头断言数据永不加载也过——改为真请求+空态文案）
  const panicResp = page.waitForResponse((r) => r.url().includes('/api/v1/audit/panics'), { timeout: 10_000 })
  await page.getByRole('tab', { name: 'Panic 聚合' }).click()
  const resp = await panicResp
  expect(resp.status()).toBe(200)
  await expect(page.getByRole('columnheader', { name: '最近发生' })).toBeVisible({ timeout: 10_000 })

  // 路由对账 Tab——立即对账 → 零缺口
  await page.getByRole('tab', { name: '路由对账' }).click()
  await page.getByRole('button', { name: '立即对账' }).click()
  await expect(page.getByText('对账通过：无缺口')).toBeVisible({ timeout: 15_000 })
})
