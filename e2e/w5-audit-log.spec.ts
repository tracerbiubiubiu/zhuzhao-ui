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

  // 载荷弹窗打开（request_body JSON 美化区）——内容级断言（2026-10-02 加固）：
  // pre 必须非空（'（无 body）' 占位亦算——空 pre=弹层渲染坏也绿的原假绿面）
  await rows.first().getByRole('button', { name: '载荷' }).click()
  const dlg = page.locator('.el-dialog').filter({ hasText: '载荷' })
  await expect(dlg).toBeVisible()
  const preText = await dlg.locator('pre').innerText({ timeout: 10_000 })
  expect(preText.trim().length, '载荷 pre 内容为空——美化区未渲染').toBeGreaterThan(0)
  // 关弹窗（防遮罩挡 Tab 切换）
  await dlg.getByRole('button', { name: /关闭|×/ }).click().catch(() => page.keyboard.press('Escape'))
  await expect(dlg).not.toBeVisible({ timeout: 5_000 })

  // ── Panic 聚合 Tab（复核报告建议：唯一零覆盖且带新 UI 的面）──
  await page.getByRole('tab', { name: 'Panic 聚合' }).click()
  await expect(page.getByText('Panic 聚合（同指纹计数——最近优先）')).toBeVisible({ timeout: 10_000 })
  // 数据面：有 panic 则断言行渲染+路径列非空+分页器在位（P2-8）；无则断言空表+计数 0
  const panicPane = page.locator('.el-tab-pane').filter({ hasText: 'Panic 聚合' })
  const panicRows = panicPane.locator('.el-table__row')
  await page.waitForTimeout(1_000) // 首入惰性拉取（watch 触发 fetchPanics）
  const panicCount = await panicRows.count()
  if (panicCount > 0) {
    await expect(panicRows.first()).toBeVisible()
    const pathText = await panicRows.first().locator('td').nth(1).innerText()
    expect(pathText.trim().length, 'panic 行路径列为空').toBeGreaterThan(0)
    await expect(panicPane.locator('.el-pagination')).toBeVisible({ timeout: 5_000 })
  } else {
    await expect(page.getByText(/共 0 个聚合指纹/)).toBeVisible({ timeout: 5_000 })
  }

  // ── 路由对账 Tab（同页覆盖）──
  await page.getByRole('tab', { name: '路由对账' }).click()
  await expect(page.getByRole('button', { name: '立即对账' })).toBeVisible({ timeout: 10_000 })
})
