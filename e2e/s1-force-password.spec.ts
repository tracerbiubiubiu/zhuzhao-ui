import { expect, test } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

/**
 * S1 首登强制改密（主仓 03 号 §2 场景表，W2 E2E）
 * 流程：登录（200+TokenPair，must_change_password=true）→ 首个受保护请求
 * 403+20007 → 改密页 → 改密（TokenPair 轮换+标志清除）→ 跳首页 →
 * 清会话后以新密码重登（改密即轮换验证）。
 * 账号由 globalSetup 幂等重置（每次运行回到 must_change 态），可无限重放。
 */
test('S1 首登强制改密：gate 跳转 → 改密 → 新 TokenPair 生效 → 重登', async ({ page }) => {
  const { s1 } = loadState()

  await uiLogin(page, s1.employeeNo, s1.password)
  await expect(page).toHaveURL(/#\/change-password/, { timeout: 30_000 })

  await page.getByPlaceholder('请输入当前密码').fill(s1.password)
  await page.getByPlaceholder('至少 8 位').fill(s1.newPassword)
  await page.getByPlaceholder('再次输入新密码').fill(s1.newPassword)
  await page.getByRole('button', { name: '确认修改' }).click()

  // 改密成功 → router.push('/') → 动态路由就绪后的 /#/home
  await expect(page).toHaveURL(/#\/home/, { timeout: 30_000 })

  // 清会话，以新密码重登
  await page.evaluate(() => localStorage.clear())
  await uiLogin(page, s1.employeeNo, s1.newPassword)
  await expect(page).toHaveURL(/#\/home/, { timeout: 30_000 })
})
