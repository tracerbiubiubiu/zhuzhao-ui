/**
 * S4 角色分配（03 号 §2 矩阵）：check-strictly 勾选（只勾页面不勾按钮可保存——B 案只读
 * 授权的 UI 前提）+ 精确回显（无级联虚增）+ 页面冒烟。打标准三栈。
 * 用临时角色（幂等：时间戳后缀；finally 删除清理）——不碰 admin/superadmin 系统角色。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test('S4：角色页冒烟 + 分配菜单勾选树（目录联动子孙 + 只勾页面可保存无虚增）', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const roleCode = `e2e_s4_${suffix}`
  const roleName = `S4测试角色_${suffix}`

  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/system/role')

  // 页面冒烟：表格渲染（系统角色行）+ 新建按钮权限槽
  await expect(page.getByRole('cell', { name: 'superadmin', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建角色' })).toBeVisible()

  // 建临时角色（本用例的操作载体）——EP 表单 label 不做 for 关联，按对话框内输入框序取
  await page.getByRole('button', { name: '新建角色' }).click()
  const editDialog = page.locator('.el-dialog').filter({ hasText: '新建角色' })
  await editDialog.getByRole('textbox').nth(0).fill(roleCode)
  await editDialog.getByRole('textbox').nth(1).fill(roleName)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('角色已创建')).toBeVisible()

  // 分配菜单：只勾「用户管理」页面节点（不勾其按钮）——check-strictly 前提下可保存
  const row = page.locator('tr', { hasText: roleCode })
  await row.getByRole('button', { name: '分配菜单' }).click()
  const dialog = page.locator('.el-dialog').filter({ hasText: '分配菜单' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('用户管理', { exact: true })).toBeVisible()

  // 勾选「用户管理」页面节点（check-strictly：不级联勾子按钮）
  // 定位用 __content 行（el-tree 节点 DOM 嵌套子孙，.el-tree-node+hasText 会误中祖先目录行）
  const userRow = dialog.locator('.el-tree-node__content').filter({ hasText: '用户管理' })
  // 目录级联动（应用层批量糖）：勾「系统管理」目录→子页面连带勾选；取消→连带取消。
  // 断言完复位，后续只勾页面的主流程不受污染
  const dirRow = dialog.locator('.el-tree-node__content').filter({ hasText: '系统管理' })
  await dirRow.locator('.el-checkbox__inner').click()
  await expect(dirRow.locator('.el-checkbox.is-checked')).toBeVisible()
  await expect(userRow.locator('.el-checkbox.is-checked')).toBeVisible()
  await dirRow.locator('.el-checkbox__inner').click()
  await expect(dirRow.locator('.el-checkbox.is-checked')).toHaveCount(0)
  await expect(userRow.locator('.el-checkbox.is-checked')).toHaveCount(0)
  await userRow.locator('.el-checkbox__inner').click()
  // 分步归因：勾选必须先生效（check-strictly 下无级联）
  await expect(userRow.locator('.el-checkbox.is-checked')).toBeVisible()
  await page.getByRole('button', { name: '保存（整体替换）' }).click()
  // 保存成功的行为断言：对话框关闭（瞬态 toast 3s 寿命不稳定不作断言锚点）
  await expect(dialog).not.toBeVisible()

  // 重新打开：精确回显——「用户管理」勾选中，其子按钮（如「新建用户」按钮节点）未被勾选
  await row.getByRole('button', { name: '分配菜单' }).click()
  await expect(dialog.getByText('用户管理', { exact: true })).toBeVisible()
  await expect(userRow.locator('.el-checkbox.is-checked')).toBeVisible()
  // check-strictly 核心断言：同页按钮节点不得因级联被勾（只读授权必须选得出来）
  const btnRow = dialog.locator('.el-tree-node__content').filter({ hasText: '新建用户' })
  await expect(btnRow.locator('.el-checkbox.is-checked')).toHaveCount(0)
  await page.getByRole('button', { name: '取消' }).click()

  // 清理：删除临时角色（显式等 confirm 弹窗再点——避免行内多删除按钮的解析竞态）
  await row.getByRole('button', { name: '删除' }).click()
  const confirmBox = page.locator('.el-message-box').filter({ hasText: '危险操作' })
  await expect(confirmBox).toBeVisible()
  await confirmBox.getByRole('button', { name: '删除' }).click()
  await expect(confirmBox).not.toBeVisible()
  await expect(row).toHaveCount(0)
})
