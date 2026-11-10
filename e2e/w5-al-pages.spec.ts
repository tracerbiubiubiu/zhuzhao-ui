/**
 * W5 冒烟：al 域两页（types/data）打真实四栈——zhuzhao 网关（JWT/Casbin/AK-SK 出站签名）
 * → activelist 上游（验签+动态建表）。幂等：API 造带后缀类型+25 行数据（跨 cursor 页界），
 * finally 废弃类型（数据留存——软删语义；类型废弃防列表无限堆积）。
 *
 * 运行前提（宿主形态）：activelist 本地起（ACTIVELIST_PG_PORT=15432 +
 * ACTIVELIST_CALLER_ZHUZHAO_SK=dev-gateway-sk go run ./cmd/apiserver）+
 * zhuzhao gateway target 指向 127.0.0.1:18081（分配表迁移后）（compose 形态天然可达）。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, waitUserRateBudget } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(120_000)

// Node 夹具与浏览器共用账号限流桶；先消除前一用例的额度占用。
test.beforeEach(async () => { await waitUserRateBudget() })

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
    // 25 行夹具消耗了同一账号的额度，给首次 profile/permissions/menu 加载留足预算。
    await waitUserRateBudget()
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    // al 页是动态菜单路由：等菜单加载+动态路由注册完成（uiLogin 点完即返——静态路由 spec
    // 无感，动态路由竞态会弹回登录）。「活动类型」是折叠子菜单（hidden）——等父级项
    await expect(page.getByRole('menuitem', { name: '活动列表' })).toBeVisible({ timeout: 15_000 })

    // ── types 页：造的类型行可见 ──
    await page.goto('/#/al/types')
    await expect(page.locator('.el-table__row').filter({ hasText: typeName })).toBeVisible()
    await expect(page.locator('.el-table__row').filter({ hasText: typeName }).locator('.el-tag')).toContainText('使用中')

    // ── data 页：选类型 → 动态列渲染 + cursor 分页（25 行=2 页）──
    await page.goto('/#/al/data')
    // 未选择类型只有选择引导，不暴露无目标的写入动作。
    await expect(page.getByText('从左侧选择一个类型以查看其数据')).toBeVisible()
    await expect(page.getByRole('button', { name: '写入首条', exact: true })).toHaveCount(0)
    // 两栏版：左栏类型清单搜索+点击切换（取代下拉）
    await page.getByPlaceholder('搜索类型').fill(typeName)
    await page.locator('.al-type-item').filter({ hasText: typeName }).click()
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

    // ── 软删 → 行转「已删除」灰态（include_deleted 混排——行不再消失）→ UI 恢复闭环
    //    （恢复消费 000032 整改端点形态 body={type_name,id}，入口在行操作列/详情抽屉）──
    const uiRow = page.locator('.el-table__row').filter({ hasText: 'row_ui_written' })
    await uiRow.getByRole('button', { name: '删除' }).click()
    // 分步归因：先等弹窗本体（写入 Dialog 关闭动画收尾期点击存在吞没窗口），再点确认
    const confirmBox = page.locator('.el-message-box')
    await expect(confirmBox).toBeVisible({ timeout: 10_000 })
    await confirmBox.getByRole('button', { name: '删除' }).click()

    // 行不消失：灰态行类 + 操作列变「恢复」（编辑随之隐藏）——
    // 2026-10-28 适配：状态列移除（软删信息由灰态+恢复按钮承载，无徽标）
    await expect(uiRow).toHaveClass(/al-row-deleted/, { timeout: 10_000 })
    await expect(uiRow.getByRole('button', { name: '恢复' })).toBeVisible()
    await expect(uiRow.getByRole('button', { name: '编辑' })).toHaveCount(0)

    // UI 恢复 → 行回正常态（灰态类消失、编辑回归、恢复按钮退场——行为闭环不再借道 API）
    await uiRow.getByRole('button', { name: '恢复' }).click()
    await expect(uiRow).toHaveClass(/al-data-row/, { timeout: 10_000 })
    await expect(uiRow.getByRole('button', { name: '恢复' })).toHaveCount(0)
    await expect(uiRow.getByRole('button', { name: '编辑' })).toBeVisible()
  } finally {
    // 清理：废弃类型（幂等；数据留存——历史行无跨 spec 约束）
    await api('/al/api/v1/admin/types/deprecate', { ...h, method: 'POST', body: { type_name: typeName } }).catch(() => {})
  }
})


test('活动列表：废弃类型只读视图（分组可选/写入隐藏/导出保留/行详情抽屉）', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const typeName = `e2e_al_dep_${suffix}`

  // ── API setup：注册类型+写 1 行 → 立即废弃（数据留存只读——gateType 对读/软删放行）──
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'w5-al-dep')
  const h = { token: admin.env!.data.access_token } as const
  const created = await api('/al/api/v1/admin/types', {
    ...h, method: 'POST',
    body: { type_name: typeName, fields: [{ name: 'name', type: 'string', required: true }] },
  })
  expect(created.env!.code).toBe(0)
  const written = await api(`/al/api/v1/data/${typeName}`, {
    ...h, method: 'POST', body: { data: { name: 'dep_row_1' } },
  })
  expect(written.env!.code).toBe(0)
  const dep = await api('/al/api/v1/admin/types/deprecate', { ...h, method: 'POST', body: { type_name: typeName } })
  expect(dep.env!.code).toBe(0)

  await waitUserRateBudget()
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await expect(page.getByRole('menuitem', { name: '活动列表' })).toBeVisible({ timeout: 15_000 })
  await page.goto('/#/al/data')
  await page.getByPlaceholder('搜索类型').fill(typeName)
  await page.locator('.al-type-item').filter({ hasText: typeName }).click()

  // 只读态：废弃 alert + 写入/导入隐藏 + 导出（存档）保留 + 数据行可见
  await expect(page.getByText('该类型已废弃')).toBeVisible()
  await expect(page.getByRole('button', { name: '写入' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导入' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导出' })).toBeVisible()
  const row = page.locator('.el-table__row').filter({ hasText: 'dep_row_1' })
  await expect(row).toBeVisible()

  // 行详情抽屉：点行开 → 全字段 descriptions；编辑随只读隐藏，关闭可退
  await row.click()
  const drawer = page.locator('.el-drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('.el-descriptions')).toContainText('dep_row_1')
  await expect(drawer.getByRole('button', { name: '编辑' })).toHaveCount(0)
  // exact：EP 抽屉自带关闭钮 aria-label「关闭此对话框」——子串会撞双
  await drawer.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(drawer).not.toBeVisible()
})


test('活动列表：导入为全量替换——强确认后替换且提示真实行数', async ({ page }) => {
  const state = loadState()
  const typeName = `e2e_al_imp_${Date.now().toString(36)}`
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'w5-al-import')
  const h = { token: admin.env!.data.access_token } as const
  const created = await api('/al/api/v1/admin/types', {
    ...h, method: 'POST', body: { type_name: typeName, fields: [{ name: 'name', type: 'string', required: true }] },
  })
  expect(created.env!.code).toBe(0)
  for (const n of ['old_1', 'old_2', 'old_3']) {
    const r = await api(`/al/api/v1/data/${typeName}`, { ...h, method: 'POST', body: { data: { name: n } } })
    expect(r.env!.code).toBe(0)
  }

  try {
    await waitUserRateBudget()
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await expect(page.getByRole('menuitem', { name: '活动列表' })).toBeVisible({ timeout: 15_000 })
    await page.goto('/#/al/data')
    await page.getByPlaceholder('搜索类型').fill(typeName)
    await page.locator('.al-type-item').filter({ hasText: typeName }).click()
    await expect(page.locator('.el-table__row')).toHaveCount(3)

    await page.getByRole('button', { name: '导入', exact: true }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '全量替换' })
    // 弹窗常驻替换警示；未勾选知晓前「导入（替换）」不可点
    await expect(dialog.getByText('导入为全量替换')).toBeVisible()
    const submit = dialog.getByRole('button', { name: '导入（替换）' })
    const consent = dialog.getByRole('checkbox')
    const consentLabel = dialog.getByText('我已知晓导入会')
    const fileInput = dialog.locator('input[type=file]')
    const payloadInput = dialog.locator('textarea')
    await expect(submit).toBeDisabled()

    // 旧内容即使已确认，换成超限文件后也不能继续提交。空数组是服务端合法清表操作。
    await payloadInput.fill('[]')
    await consentLabel.click()
    await expect(submit).toBeEnabled()
    await fileInput.setInputFiles({
      name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(1024 * 1024 + 1, 32),
    })
    await expect(dialog.getByText('文件超过 1 MiB')).toBeVisible()
    await expect(payloadInput).toHaveValue('')
    await expect(consent).not.toBeChecked()
    await expect(submit).toBeDisabled()

    await payloadInput.fill('{}')
    await expect(dialog.getByText('导入内容须为有效的 JSON 数组')).toBeVisible()
    await expect(consent).toBeDisabled()

    // 只延迟这一个文件的本地读取，后端请求和替换仍走真实网关。
    await page.evaluate(() => {
      const originalText = File.prototype.text
      File.prototype.text = function () {
        if (this.name !== 'delayed-import.json') return originalText.call(this)
        File.prototype.text = originalText
        return new Promise((resolve) => {
          document.addEventListener('resolve-delayed-import', () => resolve('[]'), { once: true })
        })
      }
    })
    await fileInput.setInputFiles({
      name: 'delayed-import.json', mimeType: 'application/json', buffer: Buffer.from('[]'),
    })
    await expect(dialog.getByRole('status')).toHaveText('正在读取文件…')
    await expect(submit).toBeDisabled()

    // 导入格式=带 id/status 的完整行（全量替换保留源 id）——与导出对称
    const payload = JSON.stringify([
      { id: '1', status: 'active', data: { name: 'new_1' } },
      { id: '2', status: 'active', data: { name: 'new_2' } },
    ])
    await payloadInput.fill(payload)
    await consentLabel.click()
    await page.evaluate(() => document.dispatchEvent(new Event('resolve-delayed-import')))
    await expect(payloadInput).toHaveValue(payload)
    await expect(submit).toBeEnabled()

    // 手动改动内容也要重新确认，即使随后改回原内容。
    await payloadInput.fill('[]')
    await expect(consent).not.toBeChecked()
    await expect(submit).toBeDisabled()
    await payloadInput.fill(payload)
    await consentLabel.click()
    await expect(submit).toBeEnabled()
    await submit.click()

    // 提示用服务端真实回包（rows/deleted），不再是「新增 ? 行」
    await expect(dialog.getByText('已替换为 2 行（清除原有 3 行）')).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(page.locator('.el-table__row')).toHaveCount(2)
    await expect(page.locator('.el-table__row').filter({ hasText: 'old_1' })).toHaveCount(0)
  } finally {
    await api('/al/api/v1/admin/types/deprecate', { ...h, method: 'POST', body: { type_name: typeName } }).catch(() => {})
  }
})
