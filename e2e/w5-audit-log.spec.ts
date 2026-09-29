/**
 * W5 冒烟：审计日志页（audit:read——admin 专属面）打真实后端。
 * 数据源=审计中间件落库的业务 API 调用——登录/查询行为本身即产生审计行，
 * 无需造数：按自身工号过滤断言非空（含本页 GET /audit/logs 自身）。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(90_000)

test('W5 冒烟：审计日志页渲染+工号过滤+载荷弹窗', async ({ page }) => {
  const state = loadState()
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await expect(page.getByRole('menuitem', { name: '审计日志' })).toBeVisible({ timeout: 15_000 })

  await page.goto('/#/audit')
  // 表头渲染（audit 页在位）
  await expect(page.getByRole('columnheader', { name: '操作人' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('columnheader', { name: 'request_id' })).toBeVisible()

  // 按自身工号过滤——登录与本页查询刚产生审计行，必非空
  await page.getByPlaceholder('如 E000001（含已删用户）').fill(state.admin.employeeNo)
  await page.getByRole('button', { name: '查询' }).click()
  const rows = page.locator('.el-table__row')
  await expect(rows.first()).toBeVisible({ timeout: 10_000 })
  const count = await rows.count()
  expect(count).toBeGreaterThan(0)

  // 载荷弹窗打开（request_body JSON 美化区）
  await rows.first().getByRole('button', { name: '载荷' }).click()
  await expect(page.locator('.el-dialog').filter({ hasText: '载荷' })).toBeVisible()
})
