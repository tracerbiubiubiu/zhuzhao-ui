import { expect, type Locator, type Page } from '@playwright/test'

/** 只操作真实主题开关，不读取组件内部实例。 */
export async function setDarkTheme(page: Page, dark: boolean): Promise<void> {
  const toggle = page.getByRole('switch', { name: 'Toggle dark mode' })
  if ((await toggle.isChecked()) !== dark) await page.locator('.el-switch').click()
  await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark).*/)
}

/** 文字本体、所有行框与scrollWidth共同验证，外层不溢出不能代替文本未裁剪。 */
export async function descriptionMetrics(description: Locator) {
  return description.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = Array.from(range.getClientRects()).map((r) => ({ left: r.left, right: r.right }))
    const section = document.querySelector('.v-app-view')!
    return {
      text: element.textContent,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      linesInside: lines.length > 0 && lines.every((r) => r.left >= rect.left - 1 && r.right <= rect.right + 1),
      documentX: document.documentElement.scrollWidth - innerWidth,
      sectionX: section.scrollWidth - section.clientWidth,
    }
  })
}

