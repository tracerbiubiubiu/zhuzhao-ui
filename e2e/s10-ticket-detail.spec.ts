/**
 * S10/S11 工单详情批（03 号 §2）：评论/备注分层渲染 + 关联判重 409 内联呈现 +
 * 分派/取消分派/关闭流 + viewer 只读边界。打标准三栈。
 *
 * - 评论分层（S10）：公开评论 viewer 可见；内部备注服务端过滤——viewer 看不到内容
 *   也看不到 composer（viewer 预设无 comment/note/relation 写码）
 * - viewer 可见性建立：viewer 预设无组织锚点（L2=仅「分派给我」，admin 建的未分派单
 *   对其 404）——本用例把 viewer 绑进根组织（幂等 upsert）成为「透明读旁观者」
 *   （BK-1：可见工单、内部备注仍被服务端过滤），与 S10 断言语义精确对齐
 * - 关联（S10）：UI 建关联成功；重复提交 → 后端 409 内联 el-alert 呈现
 * - 流转（S11）：分派（填用户 ID）→ 已分派；取消分派 → 待处理；关闭（带说明）→
 *   已关闭且编辑/分派/关闭动作隐藏（后端 409+90004 兜底，前端按钮级防呆）
 * - 用户切换后必须 page.reload()：hash 导航不重载 SPA，vue-query 缓存会带着
 *   上一个会话的数据串台（评论断言曾因此误绿）
 * - 清理：两单 API 软删（工单无级联约束，删类型不可行——用 incident 内置类型）
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(180_000)

test('S10/S11：详情评论/备注分层+关联判重+分派/关闭流+viewer 只读', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)

  // ── API setup：admin 建两单（root 组织）；取 admin 用户 ID（分派用）──
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 's10-setup')
  const h = { token: admin.env!.data.access_token } as const
  const uid = (await api('/api/v1/user/profile', { token: h.token })).env!.data as { id: string }
  const adminUid = uid.id
  const orgId = ((await api('/api/v1/orgs', { token: h.token })).env!.data as Array<{ id: string }>)[0].id
  const mk = async (title: string) => {
    const r = await api('/api/v1/tickets', { ...h, method: 'POST', body: { type_code: 'incident', title, org_id: orgId } })
    expect(r.env!.code).toBe(0)
    return (r.env!.data as { id: string }).id
  }
  const t1 = await mk(`S10 主单_${suffix}`)
  const t2 = await mk(`S10 从单_${suffix}`)

  // viewer 绑根组织（透明读旁观者——幂等 upsert，重复运行安全）。
  // ⚠ 必须显式 ticket_scope:'group'：AddMember 缺省 scope='assigned'（repo 159），
  // 不传则 viewer 仍只看「分派给我」，绑定形同虚设
  const viewerLogin = await apiLogin(state.viewer.employeeNo, state.viewer.password, 's10-viewer')
  const viewerUid = (await api('/api/v1/user/profile', { token: viewerLogin.env!.data.access_token })).env!.data as { id: string }
  const bind = await api('/api/v1/orgs/members', { ...h, method: 'POST', body: { org_id: orgId, user_id: viewerUid.id, is_primary: false, ticket_scope: 'group' } })
  expect([0, 10005]).toContain(bind.env!.code) // 0=新绑；409=已绑定（前次运行残留）

  try {
    // ── admin：评论/备注（UI composer）──
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 }) // 等登录重定向落定——勿带竞态 goto（fe3 同款）
    await page.goto(`/#/tickets/${t1}`)
    await expect(page.getByText(`S10 主单_${suffix}`).first()).toBeVisible()

    const composer = page.getByPlaceholder('公开评论内容')
    await composer.fill('S10 公开评论内容')
    await page.getByRole('button', { name: '发表评论' }).click()
    await expect(page.getByText('S10 公开评论内容')).toBeVisible()

    // EP checkbox 原生 input 视觉隐藏——点可见的 .el-checkbox 元素（同 S4 勾选树做法）
    await page.locator('.el-checkbox').filter({ hasText: '内部备注' }).click()
    await page.getByPlaceholder(/内部备注内容/).fill('S10 内部备注内容')
    await page.getByRole('button', { name: '发表备注' }).click()
    await expect(page.getByText('S10 内部备注内容')).toBeVisible()
    await expect(page.locator('.el-tag', { hasText: '内部备注' }).first()).toBeVisible()

    // ── 关联：UI 建 t1→t2 成功；重复提交 → 409 内联 el-alert ──
    const relationCard = page.locator('.el-card').filter({ hasText: '关联工单' })
    await relationCard.getByPlaceholder('对方工单 ID').fill(t2)
    await relationCard.getByRole('button', { name: '建立关联' }).click()
    await expect(relationCard.getByText(`关联 → #${t2}`)).toBeVisible()
    await relationCard.getByPlaceholder('对方工单 ID').fill(t2)
    await relationCard.getByRole('button', { name: '建立关联' }).click()
    await expect(relationCard.locator('.el-alert')).toBeVisible({ timeout: 10_000 }) // 判重 409 内联（勿纯 toast）

    // ── viewer 只读边界（S10）：公开评论可见/内部备注不可见/composer 不渲染 ──
    await page.evaluate(() => localStorage.clear())
    await uiLogin(page, state.viewer.employeeNo, state.viewer.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto(`/#/tickets/${t1}`)
    await page.reload() // 清 vue-query 缓存（hash 导航不重载 SPA——admin 会话缓存会串台）
    // reload 后 SPA 冷启动（boot+loadSession+动态路由+查询）可能超 expect 默认 5s——首断言给足
    await expect(page.getByText('S10 公开评论内容')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('S10 内部备注内容')).toHaveCount(0) // 服务端过滤（非前端隐藏）
    await expect(page.getByRole('button', { name: /发表(评论|备注)/ })).toHaveCount(0)
    await expect(relationCard.getByPlaceholder('对方工单 ID')).toHaveCount(0) // viewer 无 ticket:relation
    await expect(relationCard.getByText(`关联 → #${t2}`)).toBeVisible() // 读侧关联可见

    // ── admin：分派/取消分派/关闭流（S11）——载于 t2（保持 open 态）──
    await page.evaluate(() => localStorage.clear())
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto(`/#/tickets/${t2}`)
    await page.reload()

    const statusTag = page.locator('.el-card').first().locator('.el-tag').first()
    await expect(statusTag).toHaveText('待处理', { timeout: 20_000 })

    await page.getByRole('button', { name: '分派', exact: true }).click()
    const assignDialog = page.locator('.el-dialog').filter({ hasText: '分派工单' })
    await assignDialog.getByPlaceholder('用户 ID（数字）').fill(adminUid)
    await assignDialog.getByRole('button', { name: '分派', exact: true }).click()
    await expect(statusTag).toHaveText('已分派', { timeout: 10_000 })

    await page.getByRole('button', { name: '取消分派' }).click()
    const confirmBox = page.locator('.el-message-box')
    await confirmBox.getByRole('button', { name: /确/ }).click()
    await expect(statusTag).toHaveText('待处理', { timeout: 10_000 })

    // 关闭（带说明）→ 已关闭 → 编辑/分派/关闭动作隐藏（删除保留）
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    const closeDialog = page.locator('.el-dialog').filter({ hasText: '关闭工单' })
    await closeDialog.getByPlaceholder('关闭说明（可选）').fill('S10 关闭说明')
    await closeDialog.getByRole('button', { name: '确认关闭' }).click()
    await expect(statusTag).toHaveText('已关闭', { timeout: 10_000 })
    await expect(page.getByRole('button', { name: '编辑' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '分派', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '删除' })).toBeVisible()
  } finally {
    // 清理：两单软删（不污染列表）
    await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: t1 } }).catch(() => {})
    await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: t2 } }).catch(() => {})
  }
})
