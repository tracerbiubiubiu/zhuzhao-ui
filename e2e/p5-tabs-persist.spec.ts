import { expect, test } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

/**
 * 页签栏业界对齐批（2026-11-03——持久化/中键关闭；拖拽排序随批②追加）
 *
 * 打真实栈（admin 登录 → 系统管理页开非 affix 页签）：
 * ① 持久化：F5 后页签集（含顺序）原样恢复——affix 首页本就会被 filterAffixTags
 *   重建、不能证明持久化，故必开第二个非 affix 页签；恢复走「持久化元数据按
 *   当前会话路由表校验重建」（tagsView store restoreViews，权限过滤语义）。
 * ② 中键关闭：浏览器页签惯例——关活动页签回邻页签，且关闭态持久化（reload 不复活）。
 * 断言全走「前后集合相等」口径，不硬编码菜单标题（防文案漂移假红）。
 */

const tabs = (page: import('@playwright/test').Page) => page.locator('.v-tags-view__item')

test('页签持久化：开两页 → F5 → 页签集与顺序原样恢复，活动页保持', async ({ page }) => {
  const { admin } = loadState()
  await uiLogin(page, admin.employeeNo, admin.password)
  await expect(page).toHaveURL(/#\/home/, { timeout: 30_000 })

  // 开第二个页签（admin 管理面——非 affix）
  await page.goto('/#/system/user')
  await expect(tabs(page)).toHaveCount(2, { timeout: 15_000 })

  const before = await tabs(page).allInnerTexts()
  expect(before.length, '页签集非平凡（affix 首页+非 affix 一枚）').toBeGreaterThanOrEqual(2)

  await page.reload()
  await expect(tabs(page)).toHaveCount(before.length)
  const after = await tabs(page).allInnerTexts()
  expect(after, '页签集含顺序原样恢复').toEqual(before)
  // 活动页=F5 前所在页（URL 不变——活动高亮由路由驱动）
  await expect(page).toHaveURL(/#\/system\/user/)
})

test('中键关闭：关活动页签回邻页签，且关闭态持久化（reload 不复活）', async ({ page }) => {
  const { admin } = loadState()
  await uiLogin(page, admin.employeeNo, admin.password)
  await expect(page).toHaveURL(/#\/home/, { timeout: 30_000 })

  await page.goto('/#/system/user')
  await expect(tabs(page)).toHaveCount(2, { timeout: 15_000 })

  // 中键关活动页签（最后开的一枚）→ 关闭后回邻页签（首页 affix 不可关 → navigateTo 兜底）
  await tabs(page).last().click({ button: 'middle' })
  await expect(tabs(page)).toHaveCount(1)
  await expect(page).toHaveURL(/#\/home/, { timeout: 15_000 })

  // 关闭态持久化：reload 后不复活（storage 已随 removeView 写回）
  await page.reload()
  await expect(tabs(page)).toHaveCount(1)
})
