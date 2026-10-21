/**
 * S5 存储面 E2E 冒烟（B5-2/3/4/6——头像/附件/渲染/设置）
 * 前提：dev 栈 app+rustfs 运行中（STORAGE_ENABLED=true），global-setup 已完成。
 */
import { test, expect } from '@playwright/test'
import { loadState, API_BASE, type Envelope } from './helpers'

const state = loadState()
const admin = state.admin

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[placeholder*="工号"]', admin.employeeNo)
  await page.fill('input[type="password"]', admin.password)
  await page.click('button[type="submit"]')
  await page.waitForURL('/**', { timeout: 10_000 })
}

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

  test('B5-6 设置列表四键可见（admin 登录态）', async ({ request }) => {
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
    expect(body.data.length).toBe(4)
    expect(body.data[0].key).toContain('storage.')
  })

  test('B5-2 Profile 页头像组件挂载', async ({ page }) => {
    await login(page)
    await page.goto('/profile')
    // StorageAvatarUpload 组件应挂载（el-upload 包裹 el-avatar）
    await expect(page.locator('.storage-avatar-upload')).toBeVisible({ timeout: 5_000 })
  })

  test('B5-3 工单详情附件区卡片可见', async ({ page }) => {
    await login(page)
    // 先创建一张工单（API），再导航到详情页
    const loginRes = await page.request.post(`${API_BASE}/api/v1/auth/login`, {
      data: { employee_no: admin.employeeNo, password: admin.password, device_id: 'e2e-s5' },
    })
    const { data: { access_token } } = await loginRes.json() as Envelope<{ access_token: string }>

    const createRes = await page.request.post(`${API_BASE}/api/v1/tickets`, {
      headers: { Authorization: `Bearer ${access_token}` },
      data: { type_code: 'incident', title: 'E2E 附件冒烟', priority: 3, org_id: 1 },
    })
    const createBody = await createRes.json() as Envelope<{ id: string }>
    if (createBody.code === 0) {
      await page.goto(`/ticket/detail/${createBody.data.id}`)
      // TicketAttachments 卡片应存在
      await expect(page.locator('.ticket-attachments')).toBeVisible({ timeout: 5_000 })
    }
  })
})
