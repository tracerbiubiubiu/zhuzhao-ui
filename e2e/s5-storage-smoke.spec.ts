/**
 * S5 存储面 E2E 冒烟（B5-2/3/4/6——头像/附件/渲染/设置）
 * 前提：dev 栈 app+rustfs 运行中（STORAGE_ENABLED=true），global-setup 已完成。
 *
 * 登录与导航口径（2026-10-25 修正）：登录页主按钮无 submit 型、路由为 hash 模式
 * （/#/profile、/#/tickets/:id）——UI 用例一律走 e2e/ui.ts 的 uiLogin + hash 路径，
 * 勿在本文件私有重写登录选择器。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, waitUserRateBudget, API_BASE, type Envelope } from './helpers'
import { uiLogin } from './ui'

const state = loadState()
const admin = state.admin

test.describe('S5 存储面冒烟', () => {
  test.describe.configure({ mode: 'serial' })

  test('B5-4 richtext 渲染端点可达（登录态）', async ({ request }) => {
    // 直接 API 调用验证渲染端点（无需页面交互）
    const loginRes = await request.post(`${API_BASE}/api/v1/auth/login`, {
      data: { employee_no: admin.employeeNo, password: admin.password, device_id: 'e2e-s5' },
    })
    const loginBody = await loginRes.json() as Envelope<{ access_token: string }>
    expect(loginBody.code).toBe(0)

    const res = await request.post(`${API_BASE}/api/v1/tickets/richtext/render`, {
      headers: { Authorization: `Bearer ${loginBody.data.access_token}` },
      data: { content: '# E2E 冒烟\n\n<script>alert(1)</script>' },
    })
    const body = await res.json() as Envelope<{ html: string }>
    expect(body.code).toBe(0)
    expect(body.data.html).toContain('<h1>')
    expect(body.data.html).not.toContain('alert(1)')
  })

  test('B5-6 设置列表五键可见（admin 登录态）', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/api/v1/auth/login`, {
      data: { employee_no: admin.employeeNo, password: admin.password, device_id: 'e2e-s5' },
    })
    const loginBody = await loginRes.json() as Envelope<{ access_token: string }>
    expect(loginBody.code).toBe(0)

    const res = await request.get(`${API_BASE}/api/v1/system/settings`, {
      headers: { Authorization: `Bearer ${loginBody.data.access_token}` },
    })
    const body = await res.json() as Envelope<Array<{ key: string; source: string }>>
    expect(body.code).toBe(0)
    expect(body.data.length).toBe(5) // B5-6 四键 + S5 GC 第三段 orphan_gc_days
    expect(body.data[0].key).toContain('storage.')
  })

  test('B5-2 Profile 页头像组件挂载', async ({ page }) => {
    await uiLogin(page, admin.employeeNo, admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto('/#/profile')
    // StorageAvatarUpload 组件应挂载（el-upload 包裹 el-avatar）
    await expect(page.locator('.storage-avatar-upload')).toBeVisible({ timeout: 15_000 })
  })

  test('B5-3 工单详情附件区卡片可见', async ({ page }) => {
    // 先创建一张工单（API），再导航到详情页
    const login = await apiLogin(admin.employeeNo, admin.password, 'e2e-s5')
    expect(login.env?.code, '建单前置 API 登录须成功').toBe(0)
    const h = { token: login.env!.data.access_token }
    const orgId = ((await api('/api/v1/orgs', h)).env!.data as Array<{ id: string }>)[0].id
    const created = await api<{ id: string }>('/api/v1/tickets', {
      // 2026-11-03 数据态适配：dev 库 incident 类型 impact_scope（select）转必填——建单须带
      ...h, method: 'POST', body: { type_code: 'incident', title: 'E2E 附件冒烟', org_id: orgId, custom_data: { impact_scope: '单个部门' } },
    })
    // B1-7 批3（三路F-E-3）：硬断言建单成功——原 if(code===0) 包裹使建单失败静默通过
    expect(created.env?.code, '建单失败——附件断言须红').toBe(0)
    const ticketId = created.env!.data.id

    try {
      await waitUserRateBudget()
      await uiLogin(page, admin.employeeNo, admin.password)
      await page.waitForURL(/#\/home/, { timeout: 30_000 })
      const listURL = `**/api/v1/tickets/${ticketId}/attachments`
      // 仅断开真实列表请求，其他建单/上传/删除与后续重试仍打真实服务。
      await page.route(listURL, (route) => route.abort('failed'))
      await page.goto(`/#/tickets/${ticketId}`)
      // TicketAttachments 卡片应存在（详情页冷启动含 cc/tags/transitions 多路查询——首断言给足）
      const card = page.locator('.ticket-attachments')
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card.getByTestId('attachments-load-error')).toContainText('附件列表加载失败')
      await expect(card.getByText('暂无附件')).toHaveCount(0)
      await page.unroute(listURL)
      await card.getByRole('button', { name: '重试' }).click()
      // 新单零附件 → 必须是空态，且零附件行：若列表请求打错 URL 拿回 HTML，v-for 会把字符串逐字符
      // 渲染成上千行幽灵附件（2026-10-25 实证 3418 行）——仅断可见会漏检
      await expect(card.getByText('暂无附件')).toBeVisible({ timeout: 10_000 })
      await expect(card.locator('.attachment-item')).toHaveCount(0)

      await expect(page.locator('.el-message')).toHaveCount(0)
      await page.route(listURL, (route) => route.abort('failed'))
      const fileName = `b20-refresh-${ticketId}.txt`
      await card.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('synthetic attachment refresh regression') })
      await expect(card.getByTestId('attachments-load-error')).toContainText('附件已上传，但列表刷新失败')
      await expect(page.locator('.el-message--success')).toHaveCount(0)
      await expect(page.locator('.el-message--error')).toHaveCount(1)
      // 列表故障不得谎报写失败：绕开浏览器故障注入，经真实API回读确认已落绑。
      const uploaded = await api<Array<{ object_key: string; file_name: string }>>(`/api/v1/tickets/${ticketId}/attachments`, h)
      expect(uploaded.env?.code).toBe(0)
      expect(uploaded.env!.data.map((row) => row.file_name)).toEqual([fileName])
      await page.unroute(listURL)
      await card.getByRole('button', { name: '重试' }).click()
      await expect(card.locator('.attachment-item')).toHaveCount(1)
      await expect(card.getByText(fileName, { exact: true })).toBeVisible()

      await expect(page.locator('.el-message')).toHaveCount(0)
      await page.route(listURL, (route) => route.abort('failed'))
      await card.getByRole('button', { name: '删除', exact: true }).click()
      await page.locator('.el-message-box').getByRole('button', { name: '删除', exact: true }).click()
      await expect(card.getByTestId('attachments-load-error')).toContainText('附件已删除，但列表刷新失败')
      await expect(card.locator('.attachment-item')).toHaveCount(1) // 保留已知列表，明确提示待刷新
      await expect(page.locator('.el-message--success')).toHaveCount(0)
      await expect(page.locator('.el-message--error')).toHaveCount(1)
      const deleted = await api<unknown[]>(`/api/v1/tickets/${ticketId}/attachments`, h)
      expect(deleted.env?.code).toBe(0)
      expect(deleted.env!.data).toEqual([])
      await page.unroute(listURL)
      await card.getByRole('button', { name: '重试' }).click()
      await expect(card.getByText('暂无附件')).toBeVisible()
      await expect(card.locator('.attachment-item')).toHaveCount(0)
    } finally {
      await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: ticketId } }).catch(() => {})
    }
  })
})
