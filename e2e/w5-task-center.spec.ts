/**
 * W5 冒烟：任务中心打真实五栈——zhuzhao 网关（JWT/Casbin 代理 E-④）→ taskrunner
 * （验签+Asynq 队列+SQLite）。幂等：说明列带时间戳后缀；action 用注册表在册的
 * audit_archive（S4 fail-fast 预校验落地后，未注册动作提交即 400）。
 *
 * 2026-10-13 交互批适配：三 Tab（运行记录/任务定义/死信）+ 提交=运行记录页首主按钮+对话框
 * （admin=任务定义下拉自动补全，action 由定义带出；无参定义隐藏参数区）。
 *
 * 2026-11-03 定义清理批：本 spec 建的任务定义 finally 直删（taskrunner SQLite——
 * jobs 无 API 删除面；DB 不可达→跳过清理不 fail，panic 预造段同款降级）。
 * 历史残留（192 个 manual 垃圾定义）已一次性清偿（2026-11-03，备份 /tmp）。
 *
 * 运行前提（宿主形态）：taskrunner @18080（TASKRUNNER_CALLER_ZHUZHAO_SK/TASKRUNNER_SELF_SK +
 * TASKRUNNER_HTTP_ADDR=:18080，Redis 复用 dev 栈 6379、SQLite 零依赖）+ zhuzhao app 带
 * TASKRUNNER_BASE_URL=http://127.0.0.1:18080 TASKRUNNER_SK=<同 caller sk> 启动。
 * 链路含 submitted_by=me（zhuzhao 代理换 actor——W5 随批件）的过滤行为断言。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, taskrunnerDbAvailable, taskrunnerSqlite } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(120_000)

test('W5 冒烟：任务中心三 Tab（提交对话框/runs 过滤/死信/jobs）', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const action = 'audit_archive' // 注册表在册动作（GET /jobs/actions）
  const desc = `e2e_task_${suffix}` // 唯一性走说明列

  // 定义清理（无 API 删除面——taskrunner SQLite 直删本次 desc；不可达→跳过不 fail）
  const canCleanup = taskrunnerDbAvailable()
  const cleanupJob = () => {
    if (!canCleanup) return
    try {
      taskrunnerSqlite(`DELETE FROM jobs WHERE description = '${desc}'`)
    } catch (err) {
      console.warn('[w5] 定义清理失败（残留可接受）:', err)
    }
  }

  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await expect(page.getByRole('menuitem', { name: '任务中心' })).toBeVisible({ timeout: 15_000 })
  await page.goto('/#/tasks')

  try {
    // ── 任务定义：先建 manual job（提交对话框的数据源）──
    await page.getByRole('tab', { name: '任务定义' }).click()
    await page.getByRole('button', { name: '新建任务' }).click()
    // 2026-10-27 适配 feat(task) 批：动作手填改注册表下拉（原输入框仅清单加载失败时 v-else 回退）
    await page.locator('.el-dialog').getByTestId('job-action-select').click()
    await page.getByRole('option', { name: action }).click()
    await page.locator('.el-dialog .el-form-item').filter({ hasText: '说明' }).locator('input').fill(desc)
    // 触发类型按表单项作用域定位（动作下拉居首后 .el-select first() 不再是它）
    await page.locator('.el-dialog .el-form-item').filter({ hasText: '触发类型' }).locator('.el-select').click()
    await page.getByRole('option', { name: '手动' }).click()
    await page.locator('.el-dialog').getByRole('button', { name: '创建' }).click()
    await expect(page.locator('.el-dialog')).not.toBeVisible({ timeout: 10_000 })
    const jobRow = page.locator('.el-table__row:visible').filter({ hasText: desc })
    await expect(jobRow).toBeVisible({ timeout: 15_000 })
    await expect(jobRow).toContainText('手动')

    // ── 运行记录：提交任务主按钮→对话框→定义下拉自动补全→受理 ──
    await page.getByRole('tab', { name: '运行记录' }).click()
    await page.getByRole('button', { name: '提交任务' }).click()
    const dlg = page.locator('.el-dialog:visible').filter({ hasText: '任务定义' })
    await expect(dlg).toBeVisible()
    // 无参定义 → 参数区隐藏（本批新增断言）
    await expect(dlg.locator('.el-form-item').filter({ hasText: 'params' })).toHaveCount(0)
    // 下拉自动补全（filterable）：展开后按说明文本点选
    await dlg.locator('.el-select').click()
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: desc }).first().click()
    // 受理：对话框关闭 + 自动回运行记录
    await dlg.getByRole('button', { name: '提交任务' }).click()
    await expect(dlg).not.toBeVisible({ timeout: 15_000 })

    // ── 运行记录：受理行出现 + submitted_by=me 过滤（zhuzhao 代理换 actor 透传）──
    // 动作筛选按 placeholder 精确锚定（隐藏的「新建任务定义」对话框 DOM 驻留，动作字样撞 strict）
    await page.getByPlaceholder('action', { exact: true }).fill(action)
    // runs 行不含说明列——唯一性锚 action 文本（audit_archive 全仓仅本 spec 提交），新行置顶取 first
    const runRow = page.locator('.el-table__row:visible').filter({ hasText: 'audit_archive' }).first()
    await expect(runRow).toBeVisible({ timeout: 15_000 })
    // submitted_by=zhuzhao username（actorOf——admin 账号即 'admin'，非工号）
    await expect(runRow).toContainText('admin')

    // 「只看我提交的」：开开关重查——me→actor 过滤后行仍在 + 阴性对照（operator 的 run 应消失——四轮审计）
    const opSetup = await apiLogin(state.operator.employeeNo, state.operator.password, 'w5-op')
    const opH = { token: opSetup.env!.data.access_token } as const
    await api('/api/v1/tasks', { ...opH, method: 'POST', body: { action: `${action}_other` } })
    // 2026-10-30 FilterBar 批适配：form-item div 化+开关在折叠阈值外——先展开再点
    await page.locator('.filter-collapse-toggle').click()
    await page.locator('.filter-bar').getByText('只看我提交的').click()
    await expect(page.locator('.el-table__row:visible').filter({ hasText: 'audit_archive' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.el-table__row:visible').filter({ hasText: 'audit_archive_other' })).toHaveCount(0, { timeout: 5_000 })

    // ── 死信（四轮审计：真请求断言）──
    const deadResp = page.waitForResponse((r) => r.url().includes('/api/v1/dead-letters'), { timeout: 10_000 })
    await page.getByRole('tab', { name: '死信' }).click()
    const dresp = await deadResp
    expect(dresp.status()).toBe(200)
    await expect(page.getByRole('columnheader', { name: '任务 ID' })).toBeVisible({ timeout: 10_000 })

    // ── 任务定义详情/编辑（2026-11-03 定义管理批：行数据直显抽屉 + updateJob patch 编辑框）──
    await page.getByRole('tab', { name: '任务定义' }).click()
    await jobRow.getByRole('button', { name: '详情' }).click()
    const jobDrawer = page.locator('.el-drawer:visible').filter({ hasText: '任务定义详情' })
    await expect(jobDrawer).toBeVisible()
    await expect(jobDrawer).toContainText(desc) // 说明列直显（行数据零请求）
    await expect(jobDrawer).toContainText(action)
    await jobDrawer.locator('.el-drawer__close-btn').click()
    await expect(jobDrawer).not.toBeVisible()

    await jobRow.getByRole('button', { name: '编辑' }).click()
    const editDlg = page.locator('.el-dialog:visible').filter({ hasText: '编辑任务定义' })
    await expect(editDlg).toBeVisible()
    // manual 类型：无 cron 编辑项（仅 cron 触发类型显示 CronBuilder）+ 只读边界提示
    await expect(editDlg.locator('.el-form-item').filter({ hasText: 'cron 表达式' })).toHaveCount(0)
    await expect(editDlg).toContainText('动作与触发类型创建后不可修改')
    await editDlg.getByRole('button', { name: '取消' }).click()
    await expect(editDlg).not.toBeVisible()
  } finally {
    cleanupJob()
  }
})
