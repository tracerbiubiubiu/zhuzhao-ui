/** 真实角色/菜单与写回；前两例读取注入延迟/503，冲突例无网络拦截。 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData, waitUserRateBudget } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(120_000)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture(label: string) {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const pair = await mustData(apiLogin(state.admin.employeeNo, state.admin.password, `s4-race-${suffix}`), 'S4管理员登录')
  const h = { token: pair.access_token }
  interface Node { id: string; code: string; children?: Node[] }
  const menus = await mustData(api<Node[]>('/api/v1/menus', h), '读取真实菜单树')
  const flat: Node[] = []
  const walk = (nodes: Node[]) => nodes.forEach((n) => { flat.push(n); walk(n.children ?? []) })
  walk(menus)
  const user = flat.find((n) => n.code === 'system_user')!
  const role = flat.find((n) => n.code === 'system_role')!
  expect(user).toBeTruthy()
  expect(role).toBeTruthy()
  const code = `s4race_${label}_${suffix}`
  const row = await mustData(api<{ id: string }>('/api/v1/roles', { ...h, method: 'POST', body: { code, name: `合成竞态角色_${suffix}`, priority: 10, status: 1 } }), '创建临时角色')
  const bind = (ids: string[]) => mustData(api('/api/v1/roles/menus', { ...h, method: 'POST', body: { role_id: row.id, menu_ids: ids } }), '写入真实角色菜单')
  const read = async () => (await mustData(api<{ menu_ids: string[] }>(`/api/v1/roles/${row.id}/menus`, h), '回读真实角色菜单')).menu_ids
  const cleanup = () => mustData(api('/api/v1/roles/delete', { ...h, method: 'POST', body: { role_id: row.id } }), '删除临时角色')
  try {
    await bind([user.id])
    return { state, code, id: row.id, user, role, bind, read, cleanup }
  } catch (err) {
    await cleanup()
    throw err
  }
}

test('S4：菜单ID先到而树延迟/失败时禁保存，重试真实树后精确写回', async ({ page }) => {
  const f = await fixture('tree')
  const release = deferred()
  let inject = true
  let posts = 0
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/v1/roles/menus')) posts++ })
  await page.route('**/api/v1/menus', async (route) => {
    if (!inject) return route.continue()
    await route.fetch() // 确认真实端点可读取；仅本次浏览器读取注入503。
    await release.promise
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 10008, message: '合成菜单树暂不可用', data: null }) })
  })
  try {
    await waitUserRateBudget()
    await uiLogin(page, f.state.admin.employeeNo, f.state.admin.password)
    await page.goto('/#/system/role')
    const row = page.locator('tr', { hasText: f.code })
    const idsResponse = page.waitForResponse((r) => r.url().endsWith(`/api/v1/roles/${f.id}/menus`))
    await row.getByRole('button', { name: '分配菜单' }).click()
    await idsResponse
    const dialog = page.locator('.el-dialog').filter({ hasText: '分配菜单' })
    const save = dialog.getByRole('button', { name: '保存（整体替换）' })
    await expect(save).toBeDisabled()
    expect(posts).toBe(0)
    expect(await f.read()).toEqual([f.user.id])
    release.resolve()
    await expect(dialog.getByText('合成菜单树暂不可用', { exact: true })).toBeVisible()
    await expect(save).toBeDisabled()
    expect(posts).toBe(0)
    inject = false
    await dialog.getByRole('button', { name: '重新读取' }).click()
    await expect(save).toBeEnabled()
    const userNode = dialog.locator('.el-tree-node__content').filter({ hasText: '用户管理' })
    await expect(userNode.locator('.el-checkbox.is-checked')).toBeVisible()
    await save.click()
    await expect(dialog).not.toBeVisible()
    expect(posts).toBe(1)
    expect(await f.read()).toEqual([f.user.id])
  } finally {
    release.resolve()
    await page.unroute('**/api/v1/menus')
    await f.cleanup()
  }
})

test('S4：关闭后重开同角色，迟到的真实旧读取不得覆盖新勾选或写错集合', async ({ page }) => {
  const f = await fixture('generation')
  const release = deferred()
  const captured = deferred()
  let first = true
  const path = `**/api/v1/roles/${f.id}/menus`
  await page.route(path, async (route) => {
    if (!first) return route.continue()
    first = false
    const response = await route.fetch()
    captured.resolve()
    await release.promise
    await route.fulfill({ response, headers: { ...response.headers(), 'x-e2e-generation': 'old' } })
  })
  try {
    await waitUserRateBudget()
    await uiLogin(page, f.state.admin.employeeNo, f.state.admin.password)
    await page.goto('/#/system/role')
    const row = page.locator('tr', { hasText: f.code })
    await row.getByRole('button', { name: '分配菜单' }).click()
    await captured.promise
    const dialog = page.locator('.el-dialog').filter({ hasText: '分配菜单' })
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await f.bind([f.role.id])
    await row.getByRole('button', { name: '分配菜单' }).click()
    const save = dialog.getByRole('button', { name: '保存（整体替换）' })
    await expect(save).toBeEnabled()
    const roleNode = dialog.locator('.el-tree-node__content').filter({ hasText: '角色管理' })
    const userNode = dialog.locator('.el-tree-node__content').filter({ hasText: '用户管理' })
    await expect(roleNode.locator('.el-checkbox.is-checked')).toBeVisible()
    const oldResponse = page.waitForResponse((r) => r.headers()['x-e2e-generation'] === 'old')
    release.resolve()
    await oldResponse
    await expect(roleNode.locator('.el-checkbox.is-checked')).toBeVisible()
    await expect(userNode.locator('.el-checkbox.is-checked')).toHaveCount(0)
    await save.click()
    await expect(dialog).not.toBeVisible()
    expect(await f.read()).toEqual([f.role.id])
  } finally {
    release.resolve()
    await page.unroute(path)
    await f.cleanup()
  }
})

test('S4：另一写方变更菜单后，真实 409 保留勾选草稿并回读新绑定', async ({ page }) => {
  const f = await fixture('conflict')
  let posts = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/roles/menus') posts++
  })
  try {
    await waitUserRateBudget()
    await uiLogin(page, f.state.admin.employeeNo, f.state.admin.password)
    await page.goto('/#/system/role')
    const row = page.locator('tr', { hasText: f.code })
    await row.getByRole('button', { name: '分配菜单' }).click()
    const dialog = page.locator('.el-dialog').filter({ hasText: '分配菜单' })
    const save = dialog.getByRole('button', { name: '保存（整体替换）' })
    await expect(save).toBeEnabled()
    const userNode = dialog.locator('.el-tree-node__content').filter({ hasText: '用户管理' })
    const roleNode = dialog.locator('.el-tree-node__content').filter({ hasText: '角色管理' })
    await expect(userNode.locator('.el-checkbox.is-checked')).toBeVisible()
    await expect(roleNode.locator('.el-checkbox.is-checked')).toHaveCount(0)
    await roleNode.locator('.el-checkbox__inner').click()
    await expect(dialog.locator('.el-checkbox.is-checked')).toHaveCount(2)

    // fixture 的独立 API 会话提交新集合，浏览器仍持有原读取与两项勾选草稿。
    await f.bind([f.role.id])
    expect(await f.read()).toEqual([f.role.id])
    const conflict = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/roles/menus')
    await save.click()
    const response = await conflict
    const sent = response.request().postDataJSON()
    expect(sent.role_id).toBe(f.id)
    expect(sent.original_menu_ids).toEqual([f.user.id])
    expect([...sent.menu_ids].sort()).toEqual([f.user.id, f.role.id].sort())
    expect(response.status()).toBe(409)
    expect(await response.json()).toMatchObject({ code: 10006 })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('菜单集合已变化，草稿已保留；请重新读取后核对再提交', { exact: true })).toBeVisible()
    await expect(save).toBeDisabled()
    await expect(userNode.locator('.el-checkbox.is-checked')).toBeVisible()
    await expect(roleNode.locator('.el-checkbox.is-checked')).toBeVisible()
    await expect(dialog.locator('.el-checkbox.is-checked')).toHaveCount(2)
    expect(await f.read()).toEqual([f.role.id])
    expect(posts).toBe(1)

    const reloaded = page.waitForResponse((response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/v1/roles/${f.id}/menus`)
    await dialog.getByRole('button', { name: '重新读取' }).click()
    expect((await reloaded).status()).toBe(200)
    await expect(save).toBeEnabled()
    await expect(userNode.locator('.el-checkbox.is-checked')).toHaveCount(0)
    await expect(roleNode.locator('.el-checkbox.is-checked')).toBeVisible()
    await expect(dialog.locator('.el-checkbox.is-checked')).toHaveCount(1)
    expect(await f.read()).toEqual([f.role.id])
    expect(posts).toBe(1)
  } finally {
    await f.cleanup()
  }
})
