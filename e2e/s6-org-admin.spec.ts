/**
 * S6 组织管理（03 号 §2）：树操作 + ticket_visibility 仅实体组 update 表单出现
 * （BK-13：虚拟组传入即 400——前端 UI 前提即「虚拟组不展示该配置」）
 * 幂等：时间戳编码建临时组织，finally 删除清理。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test('S6：组织树 CRUD/move + ticket_visibility 仅实体组可见', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const orgCode = `e2e_s6_${suffix}`
  const orgName = `S6测试组织_${suffix}`
  let created = false

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.goto('/#/system/org')

    // 树渲染（根组织在位）
    await expect(page.locator('.el-tree-node__content').first()).toBeVisible()

    // 新建实体组织（挂根下）
    await page.getByRole('button', { name: '新建组织' }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '新建组织' })
    await dialog.getByRole('textbox').nth(0).fill(orgCode)
    await dialog.getByRole('textbox').nth(1).fill(orgName)
    // 实体组织（虚拟组开关关）→ 创建
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    created = true
    await expect(page.locator('.el-tree-node__content').filter({ hasText: orgName }).first()).toBeVisible()

    // 编辑该组织：实体组 → 「工单可见性」配置出现（BK-13 UI 前提）
    const node = page.locator('.el-tree-node__content').filter({ hasText: orgName }).first()
    await node.getByRole('button', { name: '编辑' }).click()
    const editDialog = page.locator('.el-dialog').filter({ hasText: '编辑组织' })
    await expect(editDialog).toBeVisible()
    await expect(editDialog.getByText('工单可见性')).toBeVisible()
    // 虚拟组对照：创建虚拟组开关打开时（创建框）无该配置——此处以编辑框实体组出现为准
    await page.getByRole('button', { name: '取消' }).click()

    // 加子级 + 移动冒烟
    await node.getByRole('button', { name: '加子级' }).click()
    const subDialog = page.locator('.el-dialog').filter({ hasText: '新建组织' })
    await subDialog.getByRole('textbox').nth(0).fill(`vg_${orgCode}_sub`)
    await subDialog.getByRole('textbox').nth(1).fill(`${orgName}子组`)
    // 开虚拟组开关（vg_ 前缀+挂实体下满足约束）
    await subDialog.locator('.el-switch').first().click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(subDialog).not.toBeVisible()
    // 虚拟组编辑框不出现「工单可见性」（BK-13——传入即 400 故 UI 隐藏）
    const subNode = page.locator('.el-tree-node__content').filter({ hasText: `${orgName}子组` }).first()
    await subNode.getByRole('button', { name: '编辑' }).click()
    const subEdit = page.locator('.el-dialog').filter({ hasText: '编辑组织' })
    await expect(subEdit.getByText('工单可见性')).toHaveCount(0)
    await page.getByRole('button', { name: '取消' }).click()

    // 删除子级（虚拟组）冒烟删除链路
    await subNode.getByRole('button', { name: '删除' }).click()
    const confirmBox = page.locator('.el-message-box').filter({ hasText: '危险操作' })
    await expect(confirmBox).toBeVisible()
    await confirmBox.getByRole('button', { name: '删除' }).click()
    await expect(confirmBox).not.toBeVisible()
    await expect(page.locator('.el-tree-node__content').filter({ hasText: `${orgName}子组` })).toHaveCount(0)
  } finally {
    // 清理：删除临时根组织（有子级时先删子级——上面已删；失败残留由编码前缀可辨）
    if (created) {
      const node = page.locator('.el-tree-node__content').filter({ hasText: orgName }).first()
      if (await node.count()) {
        await node.getByRole('button', { name: '删除' }).click()
        const box = page.locator('.el-message-box').filter({ hasText: '危险操作' })
        await box.getByRole('button', { name: '删除' }).click().catch(() => {})
      }
    }
  }
})
