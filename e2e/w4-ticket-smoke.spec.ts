/**
 * W4 工单域冒烟：列表页渲染（admin 经 ticket_list 菜单可达）+ 类型/状态筛选 + 详情跳转链路
 * （详情完整交互随 W4 详情批；发起表单随 form-create 批）
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test('W4 冒烟：工单列表渲染+状态筛选+详情静态路由可达', async ({ page }) => {
  const state = loadState()
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/tickets')

  // 表头渲染（工单列表页在位——种子工单由 globalSetup/历史 E2E 造过则见行，无则空态）
  await expect(page.getByRole('columnheader', { name: '标题' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '状态' })).toBeVisible()

  // 状态筛选控件在位（六态下拉）
  await page.locator('.el-form-item').filter({ hasText: '状态' }).locator('.el-select').click()
  await expect(page.getByRole('option', { name: '已关闭' })).toBeVisible()
  await page.keyboard.press('Escape')

  // 详情静态路由：无工单时直接手输一个 ID——参数路由可达（渲染详情壳，404 由接口层表达）
  await page.goto('/#/tickets/1')
  await expect(page.getByText('#1').first()).toBeVisible()

  // 发起页占位可达
  await page.goto('/#/tickets/new')
  await expect(page.locator('.font-semibold').filter({ hasText: '发起工单' })).toBeVisible()
})
