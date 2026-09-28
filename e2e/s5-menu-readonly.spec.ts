/**
 * S5 菜单只读（03 号 §2）：只读树渲染 + 无任何写按钮（W1 后无写接口）
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test('S5：菜单只读树渲染（目录/页面/按钮三级）+ 无写操作', async ({ page }) => {
  const state = loadState()
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/system/menu')

  // 树渲染：根级可见（首页/系统管理）+ 按钮节点带 permission 字面值（user:create）
  await expect(page.locator('.el-tree-node__content').filter({ hasText: '系统管理' }).first()).toBeVisible()
  await expect(page.locator('.el-tree-node__content').filter({ hasText: '新建用户' }).first()).toBeVisible()
  await expect(page.getByText('user:create').first()).toBeVisible()

  // 只读：无新建/删除/编辑等任何写按钮（W1 菜单只读化——写能力在角色页 AssignMenus）
  await expect(page.getByRole('button', { name: '新建' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '删除' })).toHaveCount(0)
  // 分配入口存在（引去角色页）
  await expect(page.getByRole('button', { name: /去角色页分配菜单/ })).toBeVisible()
})
