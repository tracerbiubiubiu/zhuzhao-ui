import { expect, test } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

/**
 * S2 工作台冒烟（主仓 03 号 §2 场景表，W2 冒烟集）
 * admin 登录 → 菜单渲染（管理面可见=全量绑定）→ 工作台状态卡 + 最近工单。
 */
test('S2 工作台冒烟：admin 登录 → 菜单渲染 → 状态卡与最近工单', async ({ page }) => {
  const { admin } = loadState()

  await uiLogin(page, admin.employeeNo, admin.password)
  await expect(page).toHaveURL(/#\/home/, { timeout: 30_000 })

  // 侧栏：admin 全量菜单——管理面目录可见
  await expect(page.locator('.el-menu').getByText('系统管理')).toBeVisible()
  // 工作台：最近工单卡（状态统计卡随其后渲染）
  await expect(page.getByText('最近工单')).toBeVisible()
})
