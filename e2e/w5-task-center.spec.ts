/**
 * W5 冒烟：任务中心四 Tab 打真实五栈——zhuzhao 网关（JWT/Casbin 代理 E-④）→ taskrunner
 * （验签+Asynq 队列+SQLite）。幂等：action/job 带时间戳后缀，提交产生的 run 行留作列表数据。
 *
 * 运行前提（宿主形态）：taskrunner @8081（TASKRUNNER_CALLER_ZHUZHAO_SK/TASKRUNNER_SELF_SK +
 * TASKRUNNER_HTTP_ADDR=:8081，Redis 复用 dev 栈 6379、SQLite 零依赖）+ zhuzhao app 带
 * TASKRUNNER_BASE_URL=http://127.0.0.1:8081 TASKRUNNER_SK=<同 caller sk> 启动。
 * 链路含 submitted_by=me（zhuzhao 代理换 actor——W5 随批件）的过滤行为断言。
 */
import { test, expect } from '@playwright/test'
import { loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(120_000)

test('W5 冒烟：任务中心四 Tab（提交/runs 过滤/死信/jobs）', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const action = `e2e_w5_task_${suffix}`

  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  // 动态菜单路由：等父级菜单项出现即就绪（task_center）
  await expect(page.getByRole('menuitem', { name: '任务中心' })).toBeVisible({ timeout: 15_000 })

  // ── Tab4 提交任务：受理≠执行——提交后回显 task_id ──
  await page.goto('/#/tasks')
  await page.getByRole('tab', { name: '提交任务' }).click()
  await page.getByPlaceholder('服务端动作注册表内的 action_id').fill(action)
  await page.getByRole('button', { name: '提交任务' }).click()
  await expect(page.locator('.el-alert--success').filter({ hasText: '最近提交' })).toBeVisible({ timeout: 15_000 })

  // ── Tab1 运行记录：受理行出现 + submitted_by=me 过滤（zhuzhao 代理换 actor 透传）──
  await page.getByRole('tab', { name: '运行记录' }).click()
  await page.locator('.el-form-item').filter({ hasText: '动作' }).locator('input').fill(action)
  await page.getByRole('button', { name: '查询' }).click()
  const runRow = page.locator('.el-table__row').filter({ hasText: action })
  await expect(runRow).toHaveCount(1, { timeout: 15_000 })
  // submitted_by=zhuzhao username（actorOf——admin 账号即 'admin'，非工号）
  await expect(runRow).toContainText('admin')

  // 「只看我提交的」：开开关重查——me→actor 过滤后行仍在
  await page.locator('.el-form-item').filter({ hasText: '只看我提交的' }).locator('.el-switch').click()
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.locator('.el-table__row').filter({ hasText: action })).toHaveCount(1, { timeout: 15_000 })

  // ── Tab2 死信：只读列表可达（空态或历史行均可——本单只断渲染不炸）──
  await page.getByRole('tab', { name: '死信' }).click()
  await expect(page.getByRole('columnheader', { name: '任务 ID' })).toBeVisible({ timeout: 10_000 })

  // ── Tab3 任务定义：UI 建 manual job（无 cron）→ 列表出现 + 手动触发按钮 ──
  await page.getByRole('tab', { name: '任务定义' }).click()
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.locator('.el-dialog').getByPlaceholder('服务端动作注册表内').fill(action)
  await page.locator('.el-dialog .el-select').first().click()
  await page.getByRole('option', { name: '手动' }).click()
  await page.locator('.el-dialog').getByRole('button', { name: '创建' }).click()
  await expect(page.locator('.el-dialog')).not.toBeVisible({ timeout: 10_000 })
  // jobs 与 runs 同页多 Tab 表格并存（隐藏 pane DOM 仍在）——:visible 限定激活 Tab
  const jobRow = page.locator('.el-table__row:visible').filter({ hasText: action })
  await expect(jobRow).toBeVisible({ timeout: 15_000 })
  await expect(jobRow).toContainText('手动')
})
