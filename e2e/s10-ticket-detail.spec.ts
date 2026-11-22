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
 * - 流转（S11）：分派（UserPicker 按工号选人——B1-2 起替代手输 ID）→ 已分派；取消分派 → 待处理；
 *   关闭（带说明）→ 已关闭且编辑/分派/关闭动作隐藏（后端 409+90004 兜底，前端按钮级防呆）
 * - 用户切换后必须 page.reload()：hash 导航不重载 SPA，vue-query 缓存会带着
 *   上一个会话的数据串台（评论断言曾因此误绿）
 * - 清理：工单走 API 软删，已发布临时类型走停用。类型用临时专属——dev 栈走查数据可能含
 *   incident 全量命中的自动分派规则，新单秒变 assigned 会击穿「待处理」起点断言（2026-10-26 实证）
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData, publishTicketType, tempTicketType } from './helpers'
import { uiLogin } from './ui'
import { descriptionMetrics, setDarkTheme } from './appearance'

test.setTimeout(180_000)

test('S10/S11：详情评论/备注分层+关联判重+分派/关闭流+viewer 只读', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)

  // ── API setup：admin 建两单（root 组织）──
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 's10-setup')
  const h = { token: admin.env!.data.access_token } as const
  const orgId = ((await api('/api/v1/orgs', { token: h.token })).env!.data as Array<{ id: string }>)[0].id
  const tt = await tempTicketType(h, 'e2e_s10')
  const ticketIds: string[] = []
  const mk = async (title: string, description?: string) => {
    const created = await mustData(api<{ id: string }>('/api/v1/tickets', {
      ...h, method: 'POST', body: { type_code: tt.code, title, org_id: orgId, description },
    }), 'S10 建单')
    ticketIds.push(created.id)
    return created.id
  }
  try {
    await mustData(api('/api/v1/ticket-types/fields/replace', {
      ...h, method: 'POST', body: {
        code: tt.code,
        fields: [{ field_key: 'close_reason', field_label: '关闭说明', field_type: 'textarea', sort_order: 1 }],
      },
    }), 'S10 保存关闭字段')
    await mustData(api('/api/v1/ticket-types/update', {
      ...h, method: 'POST', body: {
        code: tt.code,
        transition_meta: { 'open>closed': { collect_fields: [{ key: 'close_reason', required: true }] } },
      },
    }), 'S10 保存关闭动作')
    await publishTicketType(h.token, tt.code)

    const longDescription = '首行：保留  两个空格。\nhttps://example.invalid/' + 'abcd1234efgh'.repeat(40) + '\n末行：完整保留。'
    const t1 = await mk(`S10 主单_${suffix}`, longDescription)
    let t2 = await mk(`S10 从单_${suffix}`)
    // 单跑也须覆盖逐键输入多位 ID。
    for (let i = 0; t2.length < 2 && i < 9; i++) {
      t2 = await mk(`S10 从单_${suffix}_${i}`)
    }
    expect(t2).toMatch(/^\d{2,}$/)

    // viewer 绑根组织并显式采用 group 工单范围，以只读旁观者验证评论分层。
    const viewerLogin = await apiLogin(state.viewer.employeeNo, state.viewer.password, 's10-viewer')
    const viewerUid = (await api('/api/v1/user/profile', { token: viewerLogin.env!.data.access_token })).env!.data as { id: string }
    const bind = await api('/api/v1/orgs/members', { ...h, method: 'POST', body: { org_id: orgId, user_id: viewerUid.id, is_primary: false, ticket_scope: 'group' } })
    expect([0, 10005]).toContain(bind.env!.code) // 0=新绑；409=已绑定（前次运行残留）

    // ── admin：评论/备注（UI composer）──
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 }) // 等登录重定向落定——勿带竞态 goto（fe3 同款）
    await page.goto(`/#/tickets/${t1}`)
    await expect(page.getByText(`S10 主单_${suffix}`).first()).toBeVisible()

    // F13：合法长URL在两种主题和常用/宽屏均可完整阅读，原文不插入断词字符。
    const initialViewport = page.viewportSize()
    const initialDark = await page.getByRole('switch', { name: 'Toggle dark mode' }).isChecked()
    const description = page.getByTestId('ticket-description')
    for (const dark of [false, true]) {
      await setDarkTheme(page, dark)
      for (const size of [{ width: 1024, height: 900 }, { width: 2560, height: 1440 }]) {
        await page.setViewportSize(size)
        const metrics = await descriptionMetrics(description)
        expect(metrics.text).toBe(longDescription)
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
        expect(metrics.linesInside, '每行文字框都在描述区域内').toBe(true)
        expect(metrics.documentX).toBe(0)
        expect(metrics.sectionX).toBe(0)
      }
    }
    await setDarkTheme(page, initialDark)
    if (initialViewport) await page.setViewportSize(initialViewport)

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
    // 2026-10-29 适配：关联入口改远程搜索下拉（keyword 支持 纯数字=工单 ID），选项名 `#<id> <标题>`
    const relationCard = page.locator('.el-card').filter({ hasText: '关联工单' })
    const candidateSearch = (url: URL) => url.pathname === '/api/v1/tickets'
      && url.searchParams.get('relation_source_id') === t1 && url.searchParams.get('keyword') === t2
    const pickRelation = async (expectedStatus: number, retry = false) => {
      // EP select 的下拉 teleport 到 body。候选查找与写入分别断言。
      if (retry) {
        await page.route(candidateSearch, route => route.fulfill({
          status: 503,
          json: { code: 10008, message: '合成候选读取故障' },
        }), { times: 1 })
      }
      const picker = relationCard.locator('.el-select')
      await picker.click()
      const searchBox = picker.getByRole('combobox')
      await Promise.all([
        page.waitForRequest(req => req.method() === 'GET' && candidateSearch(new URL(req.url())), { timeout: 10_000 }),
        searchBox.pressSequentially(t2, { delay: 80 }),
      ])
      await expect(searchBox).toHaveValue(t2)
      const candidate = page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: `#${t2} ` }).first()
      if (retry) {
        await expect(relationCard.getByText('合成候选读取故障')).toBeVisible()
        await Promise.all([
          page.waitForResponse(res => candidateSearch(new URL(res.url())) && res.ok(), { timeout: 10_000 }),
          relationCard.getByRole('button', { name: '重试搜索' }).click(),
        ])
        await picker.click()
      } else {
        // Chromium can end composition without another non-composing input.
        // Committing the same term must restore the invalidated candidate list.
        await expect(candidate).toBeVisible()
        await Promise.all([
          page.waitForResponse(res => candidateSearch(new URL(res.url())) && res.ok(), { timeout: 10_000 }),
          searchBox.evaluate((node, term) => {
            const input = node as HTMLInputElement
            input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
            input.value = term
            input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: term }))
            input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: term }))
          }, t2),
        ])
      }
      await candidate.click()
      const [saved] = await Promise.all([
        page.waitForResponse(res => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/v1/tickets/relations', { timeout: 10_000 }),
        relationCard.getByRole('button', { name: '建立关联' }).click(),
      ])
      expect(saved.status()).toBe(expectedStatus)
    }
    await pickRelation(200, true)
    await expect(relationCard.getByText(`关联 → #${t2}`)).toBeVisible()
    await pickRelation(409)
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
    await expect(relationCard.getByRole('button', { name: '建立关联' })).toHaveCount(0) // viewer 无 ticket:relation
    await expect(relationCard.getByText(`关联 → #${t2}`)).toBeVisible() // 读侧关联可见

    // ── admin：分派/取消分派/关闭流（S11）——载于 t2（保持 open 态）──
    await page.evaluate(() => localStorage.clear())
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto(`/#/tickets/${t2}`)
    await page.reload()

    await expect(relationCard.getByText(`被关联 ← #${t1}`)).toBeVisible({ timeout: 20_000 })

    const statusTag = page.locator('.el-card').first().locator('.el-tag').first()
    await expect(statusTag).toHaveText('待处理', { timeout: 20_000 })

    await page.getByRole('button', { name: '分派', exact: true }).click()
    const assignDialog = page.locator('.el-dialog').filter({ hasText: '分派工单' })
    // UserPicker（remote el-select）：键入工号 → 下拉出「姓名（工号）」→ 点选；下拉 teleport 到 body
    const assigneeBox = assignDialog.getByRole('combobox', { name: '处理人' })
    await assigneeBox.click()
    await assigneeBox.fill(state.admin.employeeNo)
    await page.getByRole('option', { name: new RegExp(state.admin.employeeNo) }).click({ timeout: 10_000 })
    await assignDialog.getByRole('button', { name: '分派', exact: true }).click()
    await expect(statusTag).toHaveText('已分派', { timeout: 10_000 })

    await page.getByRole('button', { name: '取消分派' }).click()
    const confirmBox = page.locator('.el-message-box')
    await confirmBox.getByRole('button', { name: /确/ }).click()
    await expect(statusTag).toHaveText('待处理', { timeout: 10_000 })

    // 关闭（带说明）→ 已关闭 → 编辑/分派/关闭动作隐藏（删除保留）
    const closeAction = page.getByTestId('btn-transition-closed')
    const closeActionTitle = (await closeAction.innerText()).trim()
    await closeAction.click()
    const closeDialog = page.getByRole('dialog', { name: closeActionTitle, exact: true })
    await closeDialog.getByRole('textbox', { name: '关闭说明' }).fill('S10 关闭说明')
    await closeDialog.getByRole('button', { name: `确认${closeActionTitle}`, exact: true }).click()
    await expect(statusTag).toHaveText('已关闭', { timeout: 10_000 })
    const closed = await mustData(api<{ custom_data: { close_reason: string } }>(`/api/v1/tickets/${t2}`, h), 'S10 回读关闭说明')
    expect(closed.custom_data.close_reason).toBe('S10 关闭说明')
    await expect(page.getByRole('button', { name: '编辑' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '分派', exact: true })).toHaveCount(0)
    await expect(closeAction).toHaveCount(0)
    // 限定头卡：附件/抄送/标签等列表行也带「删除」，页面级匹配会撞 strict mode
    await expect(page.locator('.el-card').first().getByRole('button', { name: '删除' })).toBeVisible()
  } finally {
    for (const id of ticketIds) {
      await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id } }).catch(() => {})
    }
    await tt.cleanup()
  }
})
