/**
 * S3 用户管理（03 号 §2 矩阵）：搜索真实性（命中/无假搜索项）+ 分页 + 按钮权限槽
 * 打标准三栈（admin 正向 + viewer 手输不可达）——菜单可见性维度已由 FE3 盖，此处补 URL 直达。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test('S3 admin：表格渲染 + 搜索命中 + 无假搜索项 + 分页器 + 新建按钮权限槽', async ({ page }) => {
  const state = loadState()
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/system/user')

  // 表格渲染（admin 种子行）
  await expect(page.getByRole('cell', { name: 'admin', exact: true })).toBeVisible()

  // 分页器在位
  await expect(page.locator('.el-pagination')).toBeVisible()

  // 搜索真实性：username 模糊命中
  await page.getByPlaceholder('用户名（模糊）').fill('adm')
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.getByRole('cell', { name: 'admin', exact: true })).toBeVisible()

  // employee_no 精确命中（admin=E000001）
  await page.getByPlaceholder('用户名（模糊）').fill('')
  await page.getByPlaceholder('工号（精确）').fill('E000001')
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.getByRole('cell', { name: 'admin', exact: true })).toBeVisible()

  // 无假搜索项：端点不支持 org/real_name 过滤——搜索区不得出现对应控件（假搜索）
  await expect(page.getByPlaceholder('真实姓名')).toHaveCount(0)
  await expect(page.getByText('所属组织')).toHaveCount(0)

  // 按钮权限槽：admin 持 user:create → 新建按钮可见
  await expect(page.getByRole('button', { name: '新建用户' })).toBeVisible()
})

test('S3 权限槽：viewer 手输 /system/user 不可达（无菜单→路由未注册→404）', async ({ page }) => {
  const state = loadState()
  await uiLogin(page, state.viewer.employeeNo, state.viewer.password)
  await page.waitForURL('**/#/home')
  await page.goto('/#/system/user')
  // viewer 菜单无 system_user → 动态路由未注册 → catch-all 404（FE3 的 URL 直达维度）
  await expect(page.getByText('抱歉，您访问的页面不存在')).toBeVisible()
})
