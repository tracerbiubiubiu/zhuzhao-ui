/**
 * W5 冒烟：al 域两页（types/data）打真实四栈——zhuzhao 网关（JWT/Casbin/AK-SK 出站签名）
 * → activelist 上游（验签+动态建表）。幂等：API 造带后缀类型+25 行数据（跨 cursor 页界），
 * finally 废弃类型（数据留存——软删语义；类型废弃防列表无限堆积）。
 *
 * 运行前提（宿主形态）：activelist 本地起（ACTIVELIST_PG_PORT=15432 +
 * ACTIVELIST_CALLER_ZHUZHAO_SK=dev-gateway-sk go run ./cmd/apiserver）+
 * zhuzhao gateway target 指向 127.0.0.1:8080（compose 形态天然可达）。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(120_000)

test('W5 冒烟：al 类型注册/数据写入/cursor 分页/软删恢复', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const typeName = `e2e_al_${suffix}`

  // ── API setup：造类型 + 25 行数据（page_size 默认 20——跨页界验证 cursor）──
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'w5-al-setup')
  const h = { token: admin.env!.data.access_token } as const
  const created = await api('/al/api/v1/admin/types', {
    ...h, method: 'POST',
    body: { type_name: typeName, fields: [{ name: 'name', type: 'string', required: true }, { name: 'score', type: 'int' }] },
  })
  expect(created.env!.code).toBe(0)

  for (let i = 1; i <= 25; i++) {
    const r = await api(`/al/api/v1/data/${typeName}`, {
      ...h, method: 'POST',
      body: { data: { name: `row_${String(i).padStart(2, '0')}`, score: i } },
    })
    expect(r.env!.code).toBe(0)
  }

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    // al 页是动态菜单路由：等菜单加载+动态路由注册完成（uiLogin 点完即返——静态路由 spec
    // 无感，动态路由竞态会弹回登录）。「名单类型」是折叠子菜单（hidden）——等父级项
    await expect(page.getByRole('menuitem', { name: '名单管理' })).toBeVisible({ timeout: 15_000 })

    // ── types 页：造的类型行可见 ──
    await page.goto('/#/al/types')
    await expect(page.locator('.el-table__row').filter({ hasText: typeName })).toBeVisible()
    await expect(page.locator('.el-table__row').filter({ hasText: typeName }).locator('.el-tag')).toContainText('使用中')

    // ── data 页：选类型 → 动态列渲染 + cursor 分页（25 行=2 页）──
    await page.goto('/#/al/data')
    const typeSelect = page.locator('.el-select').first()
    await typeSelect.click()
    await page.getByRole('option', { name: typeName }).click()
    await expect(page.getByRole('columnheader', { name: 'name' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'score' })).toBeVisible()
    await expect(page.locator('.el-table__row')).toHaveCount(20) // 第 1 页满页

    // 翻页：下一页 5 条（满页才给 next_cursor——空页终止）
    await page.getByRole('button', { name: '下一页' }).click()
    await expect(page.locator('.el-table__row')).toHaveCount(5)
    await expect(page.getByText('第 2 页')).toBeVisible()
    await page.getByRole('button', { name: '上一页' }).click()
    await expect(page.locator('.el-table__row')).toHaveCount(20)

    // ── 写入 → 刷新回首页含新行（对话框 footer 与工具栏按钮同名——弹窗范围限定）──
    await page.getByRole('button', { name: '写入' }).click()
    await page.locator('.el-form-item').filter({ hasText: 'name' }).locator('input').fill('row_ui_written')
    await page.locator('.el-dialog').getByRole('button', { name: '写入' }).click()
    await expect(page.locator('.el-dialog').first()).not.toBeVisible()
    await expect(page.locator('.el-table__row').filter({ hasText: 'row_ui_written' })).toBeVisible()

    // ── 软删（列表 WHERE status='active' 硬过滤——删除即行消失；恢复无 UI 入口走 API 闭环，
    //    顺带消费 000032 整改端点形态 body={type_name,id}）──
    const uiRow = page.locator('.el-table__row').filter({ hasText: 'row_ui_written' })
    const writtenId = (await uiRow.locator('td').first().innerText()).trim()
    await uiRow.getByRole('button', { name: '删除' }).click()
    // 分步归因：先等弹窗本体（写入 Dialog 关闭动画收尾期点击存在吞没窗口），再点确认
    const confirmBox = page.locator('.el-message-box')
    await expect(confirmBox).toBeVisible({ timeout: 10_000 })
    await confirmBox.getByRole('button', { name: '删除' }).click()
    await expect(uiRow).toHaveCount(0, { timeout: 10_000 }) // 行从列表消失

    // API 恢复 → UI 刷新行回来（行为闭环）
    const restored = await api('/al/api/v1/data/restore', { ...h, method: 'POST', body: { type_name: typeName, id: Number(writtenId) } })
    expect(restored.env!.code).toBe(0)
    await page.reload()
    // reload 重置组件态（类型选择丢失）——重选后断言行回来
    await page.locator('.el-select').first().click()
    await page.getByRole('option', { name: typeName }).click()
    await expect(page.locator('.el-table__row').filter({ hasText: 'row_ui_written' })).toBeVisible({ timeout: 10_000 })
  } finally {
    // 清理：废弃类型（幂等；数据留存——历史行无跨 spec 约束）
    await api('/al/api/v1/admin/types/deprecate', { ...h, method: 'POST', body: { type_name: typeName } }).catch(() => {})
  }
})
