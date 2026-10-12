/**
 * FE4 哨兵：非 admin 角色可达路由遍历——零 4xx/5xx API 响应 + 零权限类 toast
 *
 * 背景（2026-10-12）：两例非 admin 路径缺陷均为 admin 单账号 E2E 的盲区——
 * ① 工单列表筛选占位符冲突 500（4a18789：viewer/operator 任意筛选即 500）；
 * ② 任务中心任务定义 Tab 急切拉 /jobs 403 toast（ce13f5d7：Tab 未按 task:manage 门控）。
 * 本 spec 以 operator/viewer 双角色遍历其可达路由，捕获一切 4xx/5xx API 响应与
 * 「无权限/内部错误」toast——非 admin 路径的自动哨兵。
 *
 * 覆盖路由集 = 菜单实际可达面（管理面 404 由 FE3 覆盖，不在此重复）；
 * 设计内探针 403（MyOrg 名册 L3 判定）走显式白名单。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(180_000)

const ROUTES = ['/home', '/tickets', '/tickets/new', '/tasks', '/al/types', '/al/data', '/my-org', '/profile']

const ROLE_ACCOUNTS = {
  operator: () => loadState().operator,
  viewer: () => loadState().viewer,
} as const

for (const [role, getAccount] of Object.entries(ROLE_ACCOUNTS)) {
  test(`FE4 ${role}：可达路由遍历零 4xx/5xx + 零权限类 toast`, async ({ page }) => {
    const acct = getAccount()
    await uiLogin(page, acct.employeeNo, acct.password)

    const failed: string[] = []
    // 设计内探针 403 白名单：MyOrg 以名册端点 403 判定「非 owner」→ 隐藏委托控件
    //（audit 期 L3 口径——前端故意调、403 即预期信号，非缺陷）
    const DESIGNED_PROBES = ['/api/v1/orgs/members/list']
    page.on('response', (resp) => {
      if (resp.url().includes('/api/') && resp.status() >= 400) {
        const path = new URL(resp.url()).pathname
        if (!DESIGNED_PROBES.some((p) => path.includes(p))) {
          failed.push(`${resp.status()} ${path}`)
        }
      }
    })

    for (const route of ROUTES) {
      await page.goto(`/#${route}`)
      // 页面活着即可（各页空态形态不同：表格/空态/卡片/表单任一存在）
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('main').first()).not.toContainText('不存在', { timeout: 10_000 })
    }

    // 收口断言：无权限/内部错误 toast 不应出现（403/500 类后端响应映射的两种形态）
    const toastText = await page.evaluate(() => document.body.textContent ?? '')
    expect(toastText).not.toContain('无权限')
    expect(toastText).not.toContain('内部错误')
    expect(failed, `${role} 可达路由出现 4xx/5xx API 响应`).toEqual([])
  })
}
