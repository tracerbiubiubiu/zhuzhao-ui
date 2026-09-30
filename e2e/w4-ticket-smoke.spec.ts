/**
 * W4 工单域冒烟：列表页渲染（admin 经 ticket_list 菜单可达）+ 类型/状态筛选 + 详情跳转链路
 * （详情完整交互随 W4 详情批；发起表单随 form-create 批）
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

test('W4 冒烟：工单列表渲染+状态筛选+详情静态路由可达', async ({ page }) => {
  const state = loadState()
  const setup = await apiLogin(state.admin.employeeNo, state.admin.password, 'w4-setup')
  const h = { token: setup.env!.data.access_token } as const
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/tickets')

  // 表头渲染（工单列表页在位——种子工单由 globalSetup/历史 E2E 造过则见行，无则空态）
  await expect(page.getByRole('columnheader', { name: '标题' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '状态' })).toBeVisible()

  // 状态筛选控件在位（六态下拉）
  await page.locator('.el-form-item').filter({ hasText: '状态' }).locator('.el-select').click()
  await expect(page.getByRole('option', { name: '已关闭' })).toBeVisible()
  await page.keyboard.press('Escape')

  // 四轮审计：原断言 '#1' 是路由参直出（404 也过）——改为造真单+断言标题文本
  const created = await api('/api/v1/tickets', {
    ...h, method: 'POST',
    body: { type_code: 'incident', title: 'W4 冒烟单据', org_id: '1', priority: 3 },
  })
  expect(created.env!.code).toBe(0)
  const tid = (created.env!.data as { id: string }).id
  await page.goto(`/#/tickets/${tid}`)
  await expect(page.getByText('W4 冒烟单据').first()).toBeVisible({ timeout: 10_000 })

  // 发起页占位可达
  await page.goto('/#/tickets/new')
  await expect(page.locator('.font-semibold').filter({ hasText: '发起工单' })).toBeVisible()
})
