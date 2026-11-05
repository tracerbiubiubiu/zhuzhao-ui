import { test, expect, type Page } from '@playwright/test'
import { api, apiLogin, loadState, mustData, tempTicketType } from './helpers'
import { uiLogin } from './ui'

async function chooseType(page: Page, code: string) {
  await page.goto('/#/tickets/new')
  await page.locator('.el-form-item').filter({ hasText: '工单类型' }).locator('.el-select').click()
  await page.getByRole('option', { name: `E2E 临时类型 ${code}`, exact: true }).click()
  return page.locator('.richtext-field .cm-content').first()
}

test('S8d：草稿按账号/类型隔离，丢弃与提交均清理（B08-F01）', async ({ page }) => {
  test.setTimeout(120_000)
  const state = loadState()
  const admin = await mustData(apiLogin(state.admin.employeeNo, state.admin.password, 's8-draft-setup'), '草稿 setup 登录')
  const h = { token: admin.access_token }
  const a = await tempTicketType(h, 's8_draft_a')
  const b = await tempTicketType(h, 's8_draft_b')
  let ticketId: string | undefined
  try {
    for (const code of [a.code, b.code]) {
      await mustData(api('/api/v1/ticket-types/fields/replace', {
        ...h, method: 'POST', body: { code, fields: [{ field_key: 'detail', field_label: '详情草稿', field_type: 'richtext', sort_order: 1 }] },
      }), '草稿字段')
    }
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    let editor = await chooseType(page, a.code)
    await editor.fill('账号 A 类型 A 草稿哨兵')
    // 导航卸载前的输入也须保存；不依赖固定 sleep 命中防抖 timer。
    await page.goto('/#/home')
    editor = await chooseType(page, b.code)
    await expect(editor).toHaveText('')
    await page.goto('/#/home')
    editor = await chooseType(page, a.code)
    await expect(editor).toHaveText('账号 A 类型 A 草稿哨兵')
    await page.getByRole('button', { name: '丢弃草稿', exact: true }).click()
    await expect(editor).toHaveText('')
    await page.goto('/#/home')
    editor = await chooseType(page, a.code)
    await expect(editor).toHaveText('')

    await editor.fill('提交后不应复活')
    await page.getByPlaceholder('一句话描述问题或请求').fill('S8d 草稿提交清理')
    await page.locator('.el-form-item').filter({ hasText: '归属组织' }).locator('.el-select').click()
    await page.getByRole('option', { name: '集团总部', exact: true }).click()
    await page.getByRole('button', { name: '提交工单', exact: true }).click()
    await page.waitForURL(/#\/tickets\/\d+/)
    ticketId = page.url().match(/tickets\/(\d+)/)?.[1]
    const stored = await mustData(api<{ custom_data?: { detail?: string } }>(`/api/v1/tickets/${ticketId}`, h), '回读工单')
    expect(stored.custom_data?.detail).toBe('提交后不应复活')
    editor = await chooseType(page, a.code)
    await expect(editor).toHaveText('')

    await editor.fill('不向操作员泄漏')
    await page.locator('.v-user-info').click()
    await page.getByText('退出系统', { exact: true }).click()
    await page.getByRole('button', { name: '确定', exact: true }).click()
    await page.waitForURL(/#\/login/)
    await uiLogin(page, state.operator.employeeNo, state.operator.password)
    editor = await chooseType(page, a.code)
    await expect(editor).toHaveText('')
    await expect(page.getByText('已恢复本地草稿', { exact: false })).toHaveCount(0)
  } finally {
    if (ticketId) await mustData(api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: ticketId } }), '清理草稿工单')
    await a.cleanup()
    await b.cleanup()
  }
})
