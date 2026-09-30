import type { Page } from '@playwright/test'

/** UI 登录（登录页选择器锚点：工号/密码 placeholder + 主按钮） */
export async function uiLogin(page: Page, employeeNo: string, password: string): Promise<void> {
  await page.goto('/#/login')
  await page.getByPlaceholder('工号').fill(employeeNo)
  await page.getByPlaceholder('密码').fill(password)
  await page.getByRole('button', { name: /登/ }).click()
  // 四轮审计（2026-09-30）：统一等登录落定——POST 在途时 goto 受保护 URL 会被守卫弹回登录
  // （w5 spec 已实证该竞态）。等待 URL 进入 home 或 change-password（首登强制改密分支）
  await page.waitForURL(/#\/(home|change-password)/, { timeout: 15_000 }).catch(() => {
    // 超时不阻塞——调用方的后续断言自行兜底（可能测试的是登录失败场景）
  })
}
