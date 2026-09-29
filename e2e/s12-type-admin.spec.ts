/**
 * S12 类型配置三件套（03 号 §2 / FE2「管理全流程无 SQL」）：类型 CRUD + 字段全量替换
 * （危险确认弹窗硬要求）+ 模板 CRUD + admin 专属边界。打标准三栈。
 *
 * 断言口径（S4 立规）：瞬态 toast 不可靠（实测 ElMessage 紧跟 ElMessageBox 关闭
 * 同帧触发时偶发不渲染——EP popup 拆卸竞态），一律断「对话框关闭 + 状态落库」。
 * 幂等：临时类型/模板 finally 删除。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(180_000)

test('S12：类型/字段/模板三件套全流程 + admin 专属边界', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const typeCode = `s12_type_${suffix}`
  const tplCode = `s12_tpl_${suffix}`

  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await page.waitForURL(/#\/home/, { timeout: 30_000 })
  await page.goto('/#/tickets/types')
  await page.reload() // 直达 URL 冷启动保险（防动态路由竞态）

  // ── 类型：新建（断状态：表格出现新行）──
  await page.getByRole('button', { name: '新建类型' }).click()
  const typeDialog = page.locator('.el-dialog').filter({ hasText: '新建类型' })
  await typeDialog.getByRole('textbox').nth(0).fill(typeCode)
  await typeDialog.getByRole('textbox').nth(1).fill(`S12类型_${suffix}`)
  await typeDialog.getByRole('button', { name: '保存' }).click()
  const typeRow = page.locator('tr', { hasText: typeCode })
  await expect(typeRow).toBeVisible({ timeout: 10_000 })

  // ── 字段编辑器：添加一行 → 全量替换（危险确认）→ 回显持久化 ──
  await typeRow.getByRole('button', { name: '字段配置' }).click()
  const fieldsDialog = page.locator('.el-dialog').filter({ hasText: '字段配置' })
  await expect(fieldsDialog).toBeVisible()
  await fieldsDialog.getByRole('button', { name: '添加字段' }).click()
  const row = fieldsDialog.locator('.el-table__row').first()
  await row.getByPlaceholder('英文键').fill('contact')
  await row.locator('input').nth(1).fill('联系方式')
  await fieldsDialog.getByRole('button', { name: '保存（整体替换）' }).click()
  // S12/S23 硬要求：全量替换前必现危险确认弹窗
  const confirmBox = page.locator('.el-message-box').filter({ hasText: '全量替换' })
  await expect(confirmBox).toBeVisible()
  await confirmBox.getByRole('button', { name: '整体替换' }).click()
  await expect(fieldsDialog).not.toBeVisible({ timeout: 10_000 }) // 成功关闭（行为断言）

  await typeRow.getByRole('button', { name: '字段配置' }).click()
  await expect(fieldsDialog.getByPlaceholder('英文键')).toHaveValue('contact', { timeout: 10_000 }) // 替换已落库
  await fieldsDialog.getByRole('button', { name: '取消' }).click()

  // ── 类型：编辑（patch + version CAS——断表格描述列更新）──
  await typeRow.getByRole('button', { name: '编辑' }).click()
  const editDialog = page.locator('.el-dialog').filter({ hasText: '编辑类型' })
  await editDialog.getByRole('textbox').nth(2).fill(`S12类型_${suffix}（已编辑）`)
  await editDialog.getByRole('button', { name: '保存' }).click()
  await expect(editDialog).not.toBeVisible({ timeout: 10_000 })
  await expect(typeRow).toContainText(`S12类型_${suffix}（已编辑）`, { timeout: 10_000 })

  // ── 模板：新建 + 删除 ──
  await page.getByRole('tab', { name: '工单模板' }).click()
  await page.getByRole('button', { name: '新建模板' }).click()
  const tplDialog = page.locator('.el-dialog').filter({ hasText: '新建模板' })
  await tplDialog.getByRole('textbox').nth(0).fill(tplCode)
  await tplDialog.getByRole('textbox').nth(1).fill(`S12模板_${suffix}`)
  await tplDialog.locator('.el-select').nth(0).click() // 工单类型
  await page.getByRole('option', { name: `s12_type_${suffix}` }).click() // option=label（code），按 code 匹配
  await tplDialog.locator('.el-select').nth(1).click() // 归属组织
  await page.getByRole('option', { name: '集团总部' }).click({ timeout: 15_000 })
  await tplDialog.getByRole('button', { name: '保存' }).click()
  const tplRow = page.locator('tr', { hasText: tplCode })
  await expect(tplRow).toBeVisible({ timeout: 10_000 })

  await tplRow.getByRole('button', { name: '删除' }).click()
  const tplDelBox = page.locator('.el-message-box').filter({ hasText: '危险操作' })
  await tplDelBox.getByRole('button', { name: '删除' }).click()
  await expect(tplRow).toHaveCount(0, { timeout: 10_000 })

  // ── 类型：删除（无工单可删）──
  await page.getByRole('tab', { name: '工单类型' }).click()
  await typeRow.getByRole('button', { name: '删除' }).click()
  const typeDelBox = page.locator('.el-message-box').filter({ hasText: '危险操作' })
  await typeDelBox.getByRole('button', { name: '删除' }).click()
  await expect(typeRow).toHaveCount(0, { timeout: 10_000 })

  // ── viewer 只读边界（B 案：预设绑 biz 域页面=4 共享 GET 可达，写码 ticket:type:manage
  //    排除——页面可看、写按钮全不渲染）──
  await page.evaluate(() => localStorage.clear())
  await uiLogin(page, state.viewer.employeeNo, state.viewer.password)
  await page.waitForURL(/#\/home/, { timeout: 30_000 })
  await page.goto('/#/tickets/types')
  await page.reload()
  await expect(page.getByText('工单类型')).toBeVisible({ timeout: 20_000 }) // 页面可达（页面行=元数据读）
  await expect(page.getByRole('button', { name: '新建类型' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '编辑' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '字段配置' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '删除' })).toHaveCount(0)
  await page.getByRole('tab', { name: '工单模板' }).click()
  await expect(page.getByRole('button', { name: '新建模板' })).toHaveCount(0) // 模板 Tab 同界
})
