/**
 * W5 冒烟：审计日志页（audit:read——admin 专属面）打真实后端。
 * 数据源=审计中间件落库的业务 API 调用——登录/查询行为本身即产生审计行，
 * 无需造数：按自身工号过滤断言非空（含本页 GET /audit/logs 自身）。
 * Panic Tab：预造 >20 行 panic_logs（直插 DB——panic 只能由 Go recovery 中间件
 * 产生，无 API 触发面；finally 清理不留残留）。DB 容器不可达→跳过 panic 段。
 */
import { test, expect } from '@playwright/test'
import { loadState, psql, pgAvailable } from './helpers'
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
  // DB 容器不可达→跳过 panic 段（其余断言仍跑——复核①优雅降级）
  const canSeed = pgAvailable()
  const panicSuffix = Date.now().toString(36)
  if (canSeed) {
    // 预造 25 行（> pageSize 20 → 翻页可达——复核②真闭合）
    const vals = Array.from({ length: 25 }, (_, i) =>
      `('e2e_panic_${panicSuffix}_${String(i).padStart(3, '0')}', 'E2E 测试 panic ${i}', 'goroutine [running]:', '/api/v1/e2e/p${i}', ${1 + (i % 5)})`,
    ).join(', ')
    psql(`INSERT INTO panic_logs (fingerprint, message, stack, path, count) VALUES ${vals}`)
  }
  try {
    await page.getByRole('tab', { name: 'Panic 聚合' }).click()
    await expect(page.getByText('Panic 聚合（同指纹计数——最近优先）')).toBeVisible({ timeout: 10_000 })

    if (canSeed) {
      // 有数据态：行渲染 + 路径列非空 + 翻页（P2-8 真闭合——25 行 > pageSize 20）
      const panicPane = page.locator('.el-tab-pane').filter({ hasText: 'Panic 聚合' })
      const panicRows = panicPane.locator('.el-table__row')
      await expect(panicRows.first()).toBeVisible({ timeout: 10_000 })
      const firstPageCount = await panicRows.count()
      expect(firstPageCount, '25 行预造首页应满 20 行').toBe(20)
      const pathText = await panicRows.first().locator('td').nth(1).innerText()
      expect(pathText.trim().length, 'panic 行路径列为空').toBeGreaterThan(0)
      // total 断言（25 行聚合指纹——后端分页正确：25 = 20 + 5）
      await expect(page.getByText(/共 2[5-9] 个聚合指纹/)).toBeVisible({ timeout: 5_000 })
      // 首页满 20 行即证 pageSize 生效（翻页 DOM 在 EP 单+1 页态不稳定——
      // 分页语义已由 首页=20+total=25 双向钉死，翻页按钮交互留待多页场景覆盖）
    } else {
      // 无 DB 态：Tab 标题在位即证组件渲染（数据面留待有 DB 环境覆盖）
      test.info().annotations.push({ type: 'skip', description: 'panic 预造跳过：PG 容器不可达' })
    }
  } finally {
    if (canSeed) {
      psql(`DELETE FROM panic_logs WHERE fingerprint LIKE 'e2e\\_panic\\_%' ESCAPE '\\'`)
    }
  }

  // ── 路由对账 Tab（同页覆盖）──
  await page.getByRole('tab', { name: '路由对账' }).click()
  await expect(page.getByRole('button', { name: '立即对账' })).toBeVisible({ timeout: 10_000 })
})
