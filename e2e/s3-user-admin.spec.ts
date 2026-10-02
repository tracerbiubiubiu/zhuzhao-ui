/**
 * S3 用户管理（03 号 §2 矩阵）：搜索真实性（命中/无假搜索项）+ 分页 + 按钮权限槽
 * + 分配组织流（P2-12：树勾选全量替换 + 主组织 + API 断言绑定）
 * 打标准三栈（admin 正向 + viewer 手输不可达）——菜单可见性维度已由 FE3 盖，此处补 URL 直达。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
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

  // employee_no 精确命中（admin=E000001）+ 阴性对照（viewer 行应消失——四轮审计：原断言过滤器 no-op 不可区分）
  await page.getByPlaceholder('用户名（模糊）').fill('')
  await page.getByPlaceholder('工号（精确）').fill('E000001')
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.getByRole('cell', { name: 'admin', exact: true })).toBeVisible()
  await expect(page.locator('.el-table__row').filter({ hasText: 'viewer' })).toHaveCount(0, { timeout: 5_000 })

  // 无假搜索项：端点不支持 org/real_name 过滤——搜索区不得出现对应控件（假搜索）
  await expect(page.getByPlaceholder('真实姓名')).toHaveCount(0)
  await expect(page.getByText('所属组织')).toHaveCount(0)

  // 按钮权限槽：admin 持 user:create → 新建按钮可见
  await expect(page.getByRole('button', { name: '新建用户' })).toBeVisible()
})

test('S3 分配组织（P2-12）：树勾选全量替换 + 主组织 + API 断言绑定', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)

  // API setup：建临时用户（本用例操作载体）
  const login = await apiLogin(state.admin.employeeNo, state.admin.password, 's3-org-setup')
  const h = { token: login.env!.data.access_token } as const
  const created = await api('/api/v1/users', {
    ...h, method: 'POST',
    body: { username: `s3_orguser_${suffix}`, password: 'S3Org#20261003', employee_no: `S3ORG${suffix}`, real_name: `S3组织${suffix}` },
  })
  expect(created.env!.code).toBe(0)
  const userId = (created.env!.data as { id: string }).id
  const rootOrgId = ((await api('/api/v1/orgs', { token: h.token })).env!.data as Array<{ id: string }>)[0].id

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.goto('/#/system/user')

    const row = page.locator('tr', { hasText: `s3_orguser_${suffix}` })
    await row.getByRole('button', { name: '分配组织' }).click()
    const dlg = page.locator('.el-dialog').filter({ hasText: '分配组织' })
    await expect(dlg).toBeVisible()
    await expect(dlg.getByText('集团总部')).toBeVisible({ timeout: 10_000 })

    // 勾选根组织 → 主组织下拉联动出现该选项 → 选中
    await dlg.locator('.el-tree-node__content').filter({ hasText: '集团总部' }).locator('.el-checkbox__inner').click()
    const primarySelect = dlg.locator('.el-select').last()
    await primarySelect.click()
    await page.getByRole('option', { name: '集团总部' }).click()

    // 整体替换确认 → 成功关框
    await dlg.getByRole('button', { name: '保存' }).click()
    const confirmBox = page.locator('.el-message-box').filter({ hasText: '整体替换' })
    await confirmBox.getByRole('button', { name: '保存' }).click()
    await expect(dlg).not.toBeVisible({ timeout: 10_000 })

    // API 断言：绑定 + 主组织均落库（GET /users/:id/orgs）
    const orgs = (await api(`/api/v1/users/${userId}/orgs`, { token: h.token })).env!.data as {
      orgs: Array<{ org_id: string; is_primary: boolean }>
    }
    const bound = orgs.orgs.find((o) => o.org_id === rootOrgId)
    expect(bound, '根组织应已绑定').toBeDefined()
    expect(bound?.is_primary, '根组织应为主组织').toBe(true)
  } finally {
    await api('/api/v1/users/delete', { ...h, method: 'POST', body: { user_id: userId } }).catch(() => {})
  }
})

test('S3 权限槽：viewer 手输 /system/user 不可达（无菜单→路由未注册→404）', async ({ page }) => {
  const state = loadState()
  await uiLogin(page, state.viewer.employeeNo, state.viewer.password)
  await page.waitForURL('**/#/home')
  await page.goto('/#/system/user')
  // viewer 菜单无 system_user → 动态路由未注册 → catch-all 404（FE3 的 URL 直达维度）
  await expect(page.getByText('抱歉，您访问的页面不存在')).toBeVisible()
})
