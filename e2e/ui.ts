import type { Page } from '@playwright/test'

/** UI 登录（登录页选择器锚点：工号/密码 placeholder + 主按钮） */
export async function uiLogin(page: Page, employeeNo: string, password: string): Promise<void> {
  await page.goto('/#/login')
  await page.getByPlaceholder('工号').fill(employeeNo)
  await page.getByPlaceholder('密码').fill(password)
  await page.getByRole('button', { name: /登/ }).click()
}
