/**
 * W5 冒烟：审计日志页（audit:read——admin 专属面）打真实后端。
 * 数据源=审计中间件落库的业务 API 调用——登录/查询行为本身即产生审计行，
 * 无需造数：按自身工号过滤断言非空（含本页 GET /audit/logs 自身）。
 * Panic Tab：预造 2 行 panic_logs（直插 DB——panic 只能由 Go recovery 中间件
 * 产生，无 API 触发面；finally 清理不留残留）。
 */
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { loadState } from './helpers'
import { uiLogin } from './ui'

const PSQL = 'docker exec zhuzhao-dev-postgres psql -U zhuzhao -d zhuzhao -qt -A -c'

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
  // 预造 2 行 panic_logs（fingerprint 唯一化，finally 清理）
  const panicSuffix = Date.now().toString(36)
  execSync(`${PSQL} "INSERT INTO panic_logs (fingerprint, message, stack, path, count) VALUES ('e2e_panic_a_${panicSuffix}', 'E2E 测试 panic A', 'goroutine 1 [running]:', '/api/v1/e2e/a', 3), ('e2e_panic_b_${panicSuffix}', 'E2E 测试 panic B', 'goroutine 2 [running]:', '/api/v1/e2e/b', 1)"`)
  try {
    await page.getByRole('tab', { name: 'Panic 聚合' }).click()
    await expect(page.getByText('Panic 聚合（同指纹计数——最近优先）')).toBeVisible({ timeout: 10_000 })
    // 有数据态：行渲染 + 路径列非空 + 分页器在位（P2-8）
    const panicPane = page.locator('.el-tab-pane').filter({ hasText: 'Panic 聚合' })
    const panicRows = panicPane.locator('.el-table__row')
    await expect(panicRows.first()).toBeVisible({ timeout: 10_000 })
    expect(await panicRows.count(), '预造 2 行 panic 至少渲染 2 行').toBeGreaterThanOrEqual(2)
    const pathText = await panicRows.first().locator('td').nth(1).innerText()
    expect(pathText.trim().length, 'panic 行路径列为空').toBeGreaterThan(0)
    // 分页器（P2-8）：total 区域非零即证分页区块渲染（EP 单页态 prev/pager 可能
    // 全 disabled 零尺寸——改断兄弟 total 文本而非 pagination 可见性）
    await expect(page.getByText(/共 [1-9]\d* 个聚合指纹/)).toBeVisible({ timeout: 5_000 })
  } finally {
    execSync(`${PSQL} "DELETE FROM panic_logs WHERE fingerprint LIKE 'e2e\\\\_panic\\\\_%' ESCAPE '\\\\'"`)
  }

  // ── 路由对账 Tab（同页覆盖）──
  await page.getByRole('tab', { name: '路由对账' }).click()
  await expect(page.getByRole('button', { name: '立即对账' })).toBeVisible({ timeout: 10_000 })
})
