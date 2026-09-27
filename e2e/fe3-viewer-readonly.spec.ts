import { expect, test } from '@playwright/test'
import { API_BASE, loadState } from './helpers'
import { uiLogin } from './ui'

/**
 * FE3 viewer 只读（主仓 03 号 S17 / 02 号 W2 出口标准）
 * - 导航：业务域可见（工单/任务/名单/home），管理面+审计不可见（菜单树按角色绑定过滤）
 * - 只读：viewer 只绑页面+读按钮（globalSetup 预设）→ API 双检 GET /tickets=200 且 POST /tickets=403
 *   （T7 反转断言形态：只勾页面不勾写按钮）
 */
test('FE3 viewer 只读：无管理面菜单 + 业务可读 + 写端点 403', async ({ page, request }) => {
  const { viewer } = loadState()

  await uiLogin(page, viewer.employeeNo, viewer.password)
  await expect(page).toHaveURL(/#\/home/, { timeout: 30_000 })

  const menu = page.locator('.el-menu')
  await expect(menu.getByText('工单管理', { exact: true })).toBeVisible()
  await expect(menu.getByText('系统管理')).toHaveCount(0)
  await expect(menu.getByText(/审计/)).toHaveCount(0)

  // API 双检：以 viewer 自己的 Token 直打后端（不经 UI——权限判定在服务端）
  const login = await request.post(`${API_BASE}/api/v1/auth/login`, {
    data: { employee_no: viewer.employeeNo, password: viewer.password, device_id: 'e2e-fe3-api' },
  })
  const pair = ((await login.json()) as { data: { access_token: string } }).data
  const headers = { authorization: `Bearer ${pair.access_token}` }

  const list = await request.get(`${API_BASE}/api/v1/tickets?page=1&page_size=5`, { headers })
  expect(list.status()).toBe(200)

  const create = await request.post(`${API_BASE}/api/v1/tickets`, { headers, data: {} })
  expect(create.status()).toBe(403)
})
