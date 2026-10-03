/**
 * S16 跨用户会话（03 号 §5 S16 会话边界维度——复核覆盖缺口④）：
 * admin 登录→访问业务页→登出→viewer 同标签重登→断言无 admin 残留。
 * 盖 resetState 三路（登出路径）+ 服务端态缓存清空（P1-2 真修的 E2E 面）。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(90_000)

test('S16 跨用户：登出→换 viewer 同标签重登→无 admin 残留', async ({ page }) => {
  const state = loadState()

  // ── admin 登录→访问工单列表（服务端态缓存填充）──
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.goto('/#/tickets')
  await expect(page.getByRole('columnheader', { name: '标题' })).toBeVisible({ timeout: 15_000 })

  // ── 登出（真实产品路径——UserInfo 下拉→退出系统→确认弹窗）──
  await page.getByText('admin', { exact: true }).first().click() // 顶栏用户名触发下拉
  await page.getByText('退出系统').click()
  const confirmBox = page.locator('.el-message-box').filter({ hasText: '是否退出本系统' })
  await expect(confirmBox).toBeVisible({ timeout: 5_000 })
  await confirmBox.getByRole('button', { name: /确定/ }).click()
  await page.waitForURL(/#\/login/, { timeout: 15_000 })

  // ── viewer 同标签重登──
  await uiLogin(page, state.viewer.employeeNo, state.viewer.password)
  await page.waitForURL(/#\/home/, { timeout: 30_000 })

  // ── 断言无 admin 残留──
  // 1. 侧栏：viewer 不见管理面（FE3 口径——admin 的「系统管理」目录不残留）
  await expect(page.locator('.el-menu').getByText('系统管理')).toHaveCount(0)
  // 2. 侧栏：viewer 可见业务面（工单管理在——确认登录成功且非空白）
  await expect(page.locator('.el-menu').getByText('工单管理', { exact: true })).toBeVisible()
  // 3. viewer 直达管理面 → 404（动态路由已清——admin 的 system_user 路由不残留）
  await page.goto('/#/system/user')
  await expect(page.getByText('抱歉，您访问的页面不存在')).toBeVisible()
  // 4. 返回 home（确认会话仍活——登出未误清新 viewer 的会话）
  await page.goto('/#/home')
  await expect(page.getByText('最近工单')).toBeVisible({ timeout: 10_000 })
})
