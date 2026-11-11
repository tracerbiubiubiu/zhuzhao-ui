/**
 * P5-S6 通知面收口（2026-10-26 批）：通知配置页模板/规则编辑面——
 * 此前页面纯只读三 Tab，「多模板」对管理员只是纸面能力（端点 B6-6 既有、UI 未接）。
 * 模板：新建→行可见→编辑改主题→落库→删除；规则：新建（事件=工单评论，当前无种子规则、
 * 测试内建删不留痕）→行可见→编辑换收件人档→删除。断言走「对话框关闭+表格状态」口径（S4 立规，不赌 toast）。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

test('P5-S6 通知配置：模板与订阅规则编辑面 CRUD', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const tplCode = `e2e_notify_tpl_${suffix}`

  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'p5-notify')
  expect(admin.env?.code).toBe(0)
  const h = { token: admin.env!.data.access_token } as const

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto('/#/system/notification')
    await page.reload() // 直达 URL 冷启动保险
    await expect(page.getByText('消息模板')).toBeVisible({ timeout: 20_000 })

    // ── 模板：新建 ──
    await page.getByTestId('tpl-create').click()
    const tplDlg = page.locator('.el-dialog').filter({ hasText: '新建消息模板' })
    await expect(tplDlg).toBeVisible()
    await tplDlg.locator('input').nth(0).fill(tplCode)
    await tplDlg.getByPlaceholder('模板名称').fill(`E2E通知模板_${suffix}`)
    await tplDlg.getByPlaceholder(/通知主题/).fill('[{{ticket.human_key}}] E2E {{ticket.title}}')
    await tplDlg.getByPlaceholder(/通知正文/).fill('E2E 正文 {{ticket.link}}')
    await tplDlg.getByRole('button', { name: '创建' }).click()
    await expect(tplDlg).not.toBeVisible({ timeout: 10_000 })
    const tplRow = page.locator('tr', { hasText: tplCode })
    await expect(tplRow).toBeVisible({ timeout: 10_000 })

    // ── 模板：编辑（改主题——断表格回显）──
    await tplRow.getByRole('button', { name: '编辑' }).click()
    const editDlg = page.locator('.el-dialog').filter({ hasText: `编辑模板 ${tplCode}` })
    await expect(editDlg).toBeVisible()
    await editDlg.getByPlaceholder(/通知主题/).fill('[OVR] E2E 主题已编辑')
    await editDlg.getByRole('button', { name: '保存' }).click()
    await expect(editDlg).not.toBeVisible({ timeout: 10_000 })
    await expect(tplRow).toContainText('[OVR] E2E 主题已编辑', { timeout: 10_000 })

    // ── 规则：新建（工单评论——当前无种子规则；建删不留痕）──
    await page.getByRole('tab', { name: '订阅规则' }).click()
    await page.getByTestId('rule-create').click()
    const ruleDlg = page.locator('.el-dialog').filter({ hasText: '新建订阅规则' })
    await expect(ruleDlg).toBeVisible()
    // 事件动作（第二项 form-item 是 select：工单评论）
    await ruleDlg.locator('.el-form-item').filter({ hasText: '事件动作' }).click()
    await page.getByRole('option', { name: /工单评论/ }).click()
    await ruleDlg.locator('.el-form-item').filter({ hasText: '使用模板' }).click()
    await page.getByRole('option', { name: new RegExp(tplCode) }).click()
    await ruleDlg.getByRole('button', { name: '创建' }).click()
    await expect(ruleDlg).not.toBeVisible({ timeout: 10_000 })
    const ruleRow = page.locator('tr', { hasText: 'ticket.commented' })
    await expect(ruleRow).toBeVisible({ timeout: 10_000 })
    await expect(ruleRow).toContainText(tplCode)

    // ── 规则：编辑（收件人 assignee→cc——upsert 同键改绑）──
    await ruleRow.getByRole('button', { name: '编辑' }).click()
    const ruleEdit = page.locator('.el-dialog').filter({ hasText: '编辑规则 ticket:ticket.commented' })
    await expect(ruleEdit).toBeVisible()
    await ruleEdit.locator('.el-form-item').filter({ hasText: '收件人类型' }).click()
    await page.getByRole('option', { name: '抄送人 cc' }).click()
    await ruleEdit.getByRole('button', { name: '保存' }).click()
    await expect(ruleEdit).not.toBeVisible({ timeout: 10_000 })
    await expect(ruleRow).toContainText('cc', { timeout: 10_000 })

    // ── 规则：删除 ──
    await ruleRow.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').filter({ hasText: '危险操作' }).getByRole('button', { name: '删除' }).click()
    await expect(ruleRow).toHaveCount(0, { timeout: 10_000 })

    // ── 模板：删除（收尾经 UI，同时验证删除面）──
    await page.getByRole('tab', { name: '消息模板' }).click()
    await tplRow.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').filter({ hasText: '危险操作' }).getByRole('button', { name: '删除' }).click()
    await expect(tplRow).toHaveCount(0, { timeout: 10_000 })
  } finally {
    // UI 中途失败兜底：规则按事件键删（返回数组）、模板按 code 删
    const rules = await api<Array<{ id: string; event_action: string }>>('/api/v1/message-rules', h).catch(() => null)
    for (const r of rules?.env?.data ?? []) {
      if (r.event_action === 'ticket.commented') {
        await api('/api/v1/message-rules/delete', { ...h, method: 'POST', body: { id: r.id } }).catch(() => {})
      }
    }
    await api('/api/v1/message-templates/delete', { ...h, method: 'POST', body: { code: tplCode } }).catch(() => {})
  }
})
