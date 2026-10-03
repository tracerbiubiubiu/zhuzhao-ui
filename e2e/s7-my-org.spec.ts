/**
 * S7 我的组织（03 号 §2——**W3 出口标准**：owner 账号过「我的组织」委托操作）
 * setup 全走 API（幂等时间戳）：建实体组织+虚拟组 → 建 owner/成员账号（API 过强制改密）→
 * 绑定成员 → UI 登录 owner → 名册可见+改组内角色（委托操作）→ 普通成员只读对照。
 */
import { test, expect, type Browser } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

const S7_PWD = 'S7Owner#2609'

// 6 账号级联 setup（建号/绑角色/API 改密）+两轮 UI 登录——默认 60s 不够
test.setTimeout(150_000)

test('S7：owner 过「我的组织」名册+委托操作；普通成员只读', async ({ page, browser }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)

  // ── API setup（admin）──
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 's7-setup')
  const at = admin.env!.data.access_token
  const h = { token: at } as const

  // 登录令牌
  const loginAndGet = async (employeeNo: string, pwd: string) => {
    const r = await apiLogin(employeeNo, pwd, `s7-${suffix}`)
    return r.env!.data.access_token
  }

  // 1) 实体组织 + 虚拟组
  const orgCode = `s7o_${suffix}`
  const org = await api<{ id: string }>('/api/v1/orgs', { ...h, method: 'POST', body: { code: orgCode, name: `S7实体_${suffix}` } })
  expect(org.env!.code).toBe(0)
  const orgId = String(org.env!.data.id)
  const vg = await api<{ id: string }>('/api/v1/orgs', { ...h, method: 'POST', body: { code: `vg_${orgCode}`, name: `S7虚拟_${suffix}`, parent_id: orgId, is_virtual: true } })
  expect(vg.env!.code).toBe(0)
  const vgId = String(vg.env!.data.id)

  // 2) owner + 两个成员账号（建号→API 过强制改密；⚠ 新旧密码不得相同——70003）
  const mkuser = async (name: string, initPwd: string, finalPwd: string) => {
    const emp = `S7${suffix.slice(-6)}${name.toUpperCase()}`
    const r = await api<{ id: string }>('/api/v1/users', { ...h, method: 'POST', body: { username: `s7_${name}_${suffix}`, password: initPwd, employee_no: emp } })
    expect(r.env!.code).toBe(0)
    const uid = String(r.env!.data.id)
    // 绑 viewer 角色（70003=未分配角色——改密链路要求用户有角色；同 globalSetup 预设模式）
    const roles = await api<Array<{ id: string; code: string }>>('/api/v1/roles', h)
    const viewer = roles.env!.data.find((x: { code: string }) => x.code === 'viewer')
    const bind = await api('/api/v1/users/roles', { ...h, method: 'POST', body: { user_id: uid, role_ids: [viewer!.id] } })
    expect(bind.env!.code).toBe(0)
    // 过强制改密（初始→目标两段密码；device_id 同源）
    const tok = await loginAndGet(emp, initPwd)
    const up = await api('/api/v1/auth/password/update', { token: tok, method: 'POST', body: { old_password: initPwd, new_password: finalPwd, device_id: `s7-pw-${name}-${suffix}` } })
    expect(up.env!.code).toBe(0)
    return { uid, emp, pwd: finalPwd }
  }
  const owner = await mkuser('own', 'S7Init#2609', S7_PWD)
  const mem = await mkuser('mem', 'S7Init#2609', S7_PWD)
  const mem2 = await mkuser('m2', 'S7Init#2609', S7_PWD) // 只读对照（不参与角色变更）

  // 3) 成员进组 + 设 owner
  for (const u of [owner, mem, mem2]) {
    const add = await api(`/api/v1/orgs/members`, { ...h, method: 'POST', body: { org_id: vgId, user_id: u.uid } })
    expect(add.env!.code).toBe(0)
  }
  const setOwner = await api('/api/v1/orgs/owners', { ...h, method: 'POST', body: { org_id: vgId, owner_user_ids: [owner.uid] } })
  expect(setOwner.env!.code).toBe(0)

  try {
    // ── UI：owner 视角 ──
    await uiLogin(page, owner.emp, owner.pwd)
    await page.goto('/#/my-org')
    // 先锚页面骨架（header 必现），数据断言放宽窗口（守卫三件+组织列表串行加载）
    await expect(page.getByText('我的组织', { exact: true }).first()).toBeVisible()
    // 数据源富化行：虚拟组卡片 + 我的角色=负责人
    await expect(page.getByText(`S7虚拟_${suffix}`, { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/负责人/).first()).toBeVisible()
    // 名册：owner 与成员两行
    await expect(page.getByRole('cell', { name: `s7_mem_${suffix}`, exact: true })).toBeVisible()

    // 委托操作：把成员组内角色 member→admin（行内 select）
    const memRow = page.locator('tr', { hasText: `s7_mem_${suffix}` })
    await memRow.locator('.el-select').first().click()
    await page.getByRole('option', { name: '管理员' }).click()
    await expect(page.locator('.el-message').filter({ hasText: '管理员' })).toBeVisible()
    // 行为断言：保存后名册刷新，成员行角色 select 值=管理员
    await expect(memRow.getByText('管理员')).toBeVisible()

    // ── 设为负责人（P2-11 正向 UI——复核覆盖缺口②）──
    // 提升 mem（admin→owner）；mem2 保持 member 作后续只读对照
    await memRow.getByRole('button', { name: '设为负责人' }).click()
    const promoteBox = page.locator('.el-message-box').filter({ hasText: '负责人并存' })
    await expect(promoteBox).toBeVisible({ timeout: 10_000 })
    await promoteBox.getByRole('button', { name: /确认/ }).click()
    // 行为断言（S4 立规：不依赖瞬态 toast）：名册刷新后 mem 行角色 tag 变「负责人」
    await expect(memRow.locator('.el-tag').filter({ hasText: '负责人' })).toBeVisible({ timeout: 15_000 })

    // ── 名册翻页（P2-7——复核覆盖缺口③）──
    const rosterPagination = page.locator('.el-tab-pane, .el-card').filter({ hasText: '成员名册' }).locator('.el-pagination')
    // 3 成员 < pageSize 20 → EP total ≤ page_size 时分页器仍渲染（有 total 文本即可）
    await expect(rosterPagination).toBeVisible({ timeout: 5_000 })
    await expect(rosterPagination).toContainText(/共 3/)

    // ── UI：普通成员视角（只读降级）──
    // 独立 context：同页二次登录会复用 owner 的 keep-alive 实例（产品路径登出必清缓存，
    // E2E 直连登录页属捷径——新 context 模拟干净浏览器）
    const ctx2 = await (browser as Browser).newContext()
    const page2 = await ctx2.newPage()
    try {
      await uiLogin(page2, mem2.emp, mem2.pwd)
    await page2.goto('/#/my-org')
    await expect(page2.getByText('我的组织', { exact: true }).first()).toBeVisible()
    await expect(page2.getByText(`S7虚拟_${suffix}`, { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page2.getByText('只读（普通成员视图）')).toBeVisible()
    await expect(page2.getByRole('cell', { name: '用户名' })).toHaveCount(0) // 名册不渲染
    } finally {
      await ctx2.close()
    }
  } finally {
    // 清理：删虚拟组+实体组织（owner 离组后 admin 直接委托删）
    await api('/api/v1/orgs/members/delete', { ...h, method: 'POST', body: { org_id: vgId, user_id: mem.uid } }).catch(() => {})
    await api('/api/v1/orgs/members/delete', { ...h, method: 'POST', body: { org_id: vgId, user_id: mem2.uid } }).catch(() => {})
    await api('/api/v1/orgs/members/delete', { ...h, method: 'POST', body: { org_id: vgId, user_id: owner.uid } }).catch(() => {})
    await api('/api/v1/orgs/delete', { ...h, method: 'POST', body: { org_id: vgId } }).catch(() => {})
    await api('/api/v1/orgs/delete', { ...h, method: 'POST', body: { org_id: orgId } }).catch(() => {})
    await api('/api/v1/users/delete', { ...h, method: 'POST', body: { user_id: mem.uid } }).catch(() => {})
    await api('/api/v1/users/delete', { ...h, method: 'POST', body: { user_id: mem2.uid } }).catch(() => {})
    await api('/api/v1/users/delete', { ...h, method: 'POST', body: { user_id: owner.uid } }).catch(() => {})
  }
})
