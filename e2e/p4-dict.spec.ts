/**
 * P4-3 字典冒烟：UI 建类型+项→启停保留备注/名称/排序及版本→消费端点只回启用项
 * →类型删除级联清理。幂等：code 带时间戳后缀，finally API 清理。
 * 第二用例：删除请求体为确认前捕获的 id+code/version 快照；确认框打开期间并发推进版本
 * （可控合成，真实 API 触发）→ 409 零写、刷新权威行、无自动重试，重新确认后删除成功。
 */
import { test, expect } from '@playwright/test'
import type { DictItemRow, DictTypeRow } from '../src/api/system/dict'
import { api, apiLogin, loadState, mustData } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(90_000)

test('P4-3 字典：类型/项启停保真+消费端点启用过滤', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const typeCode = `e2e_dict_${suffix}`
  const typeRemark = '合成类型备注：启停保留'
  const itemRemark = '合成条目备注：启停保留'
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'dict-setup')
  const h = { token: admin.env!.data.access_token } as const
  const readType = async () => {
    const data = await mustData(api<{ list: DictTypeRow[] }>(`/api/v1/dicts?keyword=${typeCode}&page=1&page_size=100`, h), '回读字典类型')
    expect(data.list).toHaveLength(1)
    return data.list[0]
  }
  const readItems = async () => {
    const data = await mustData(api<{ list: DictItemRow[] }>(`/api/v1/dict-items?type_code=${typeCode}&page=1&page_size=100`, h), '回读字典项')
    expect(data.list).toHaveLength(2)
    return data.list
  }
  const consumedCodes = async () => {
    const data = await mustData(api<{ items: DictItemRow[] }>(`/api/v1/user/dicts/${typeCode}/items`, h), '回读消费字典项')
    return data.items.map(item => item.code)
  }

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await expect(page.getByRole('menuitem', { name: '字典管理' })).toBeVisible({ timeout: 15_000 })

    // ── UI 建类型 ──
    await page.goto('/#/system/dict')
    await page.getByRole('button', { name: '新建类型' }).click()
    const dlg = page.locator('.el-dialog')
    await dlg.locator('input').nth(0).fill(typeCode)
    await dlg.locator('input').nth(1).fill('E2E 字典类型')
    await dlg.getByPlaceholder('备注（可选）', { exact: true }).fill(typeRemark)
    await page.locator('.el-dialog').getByRole('button', { name: '创建' }).click()
    await expect(page.locator('.el-dialog:visible')).toHaveCount(0, { timeout: 10_000 })
    await page.getByPlaceholder('code/name 过滤', { exact: true }).fill(typeCode)
    const typeRow = page.locator('.el-table__row').filter({ hasText: typeCode })
    await expect(typeRow).toBeVisible()
    await typeRow.getByRole('cell', { name: typeCode, exact: true }).click()

    // ── UI 建两项（prod 启用 / stg 停用）──
    const rightCard = page.locator('.el-card').filter({ hasText: `字典项（${typeCode}）` })
    for (const [code, label, remark, sort] of [['prod', '生产', itemRemark, 13], ['stg', '预发', '', 23]] as const) {
      await rightCard.getByRole('button', { name: '新增项' }).click()
      await page.locator('.el-dialog:visible').locator('input').nth(0).fill(code)
      await page.locator('.el-dialog:visible').locator('input').nth(1).fill(label)
      await page.locator('.el-dialog:visible').getByRole('spinbutton').fill(String(sort))
      await page.locator('.el-dialog:visible').getByPlaceholder('备注（可选）', { exact: true }).fill(remark)
      await page.locator('.el-dialog:visible').getByRole('button', { name: '创建', exact: true }).click()
      await expect(page.locator('.el-dialog:visible')).toHaveCount(0, { timeout: 10_000 })
      await expect(rightCard.locator('.el-table__row').filter({ hasText: code })).toBeVisible()
    }

    // 空备注项停用作对照；非空备注项停用、启用均检查真实请求及持久回读。
    let currentItems = await readItems()
    for (const [code, enabled, label, remark, sort] of [
      ['stg', false, '预发', '', 23],
      ['prod', false, '生产', itemRemark, 13],
      ['prod', true, '生产', itemRemark, 13],
    ] as const) {
      const before = currentItems.find(item => item.code === code)!
      const unchanged = currentItems.find(item => item.code !== code)!
      const row = rightCard.locator('.el-table__row').filter({ hasText: code })
      const saved = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/v1/dict-items/update' && response.request().method() === 'POST',
        { timeout: 10_000 },
      )
      await row.locator('.el-switch').click()
      const response = await saved
      expect(response.status()).toBe(200)
      expect(response.request().postDataJSON()).toEqual({ id: before.id, label, sort_order: sort, enabled, remark, version: before.version })
      await expect(row.getByText(enabled ? '生效中' : '已停用', { exact: true })).toBeVisible()
      currentItems = await readItems()
      expect(currentItems.find(item => item.code === code)).toMatchObject({ ...before, label, sort_order: sort, enabled, remark, version: before.version + 1, updated_at: expect.any(String) })
      expect(currentItems.find(item => item.code !== code)).toEqual(unchanged)
      expect(await consumedCodes()).toEqual(enabled || code === 'stg' ? ['prod'] : [])
    }

    // 类型启停仍使用整行版本更新；条目持久字段不随类型启停变化。
    let currentType = await readType()
    expect(currentType).toMatchObject({ code: typeCode, name: 'E2E 字典类型', remark: typeRemark, enabled: true })
    for (const enabled of [false, true]) {
      const before = currentType
      const saved = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/v1/dicts/update' && response.request().method() === 'POST',
        { timeout: 10_000 },
      )
      await typeRow.locator('.el-switch').click()
      const response = await saved
      expect(response.status()).toBe(200)
      expect(response.request().postDataJSON()).toEqual({ id: before.id, name: 'E2E 字典类型', enabled, remark: typeRemark, version: before.version })
      await expect(typeRow.getByRole('switch')).toHaveAttribute('aria-checked', String(enabled))
      currentType = await readType()
      expect(currentType).toMatchObject({ ...before, enabled, remark: typeRemark, version: before.version + 1, updated_at: expect.any(String) })
      expect(await readItems()).toEqual(currentItems)
      expect(await consumedCodes()).toEqual(enabled ? ['prod'] : [])
    }
  } finally {
    await api('/api/v1/dicts/delete', { ...h, method: 'POST', body: { code: typeCode } }).catch(() => {})
  }
})

test('P4-3 字典删除：确认前快照提交 id+version，冲突刷新后须重新确认', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const typeCode = `e2e_del_${suffix}`
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'dict-del-setup')
  const h = { token: admin.env!.data.access_token } as const
  const readType = async () => {
    const data = await mustData(api<{ list: DictTypeRow[] }>(`/api/v1/dicts?keyword=${typeCode}&page=1&page_size=100`, h), '回读字典类型')
    expect(data.list).toHaveLength(1)
    return data.list[0]
  }
  const readItems = async () => {
    const data = await mustData(api<{ list: DictItemRow[] }>(`/api/v1/dict-items?type_code=${typeCode}&page=1&page_size=100`, h), '回读字典项')
    return data.list
  }
  // 可控合成：记录全部条目删除 POST，最终断言次数恰为人为确认次数（无自动重试）。
  const deletePosts: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/dict-items/delete') {
      deletePosts.push(request.postDataJSON())
    }
  })
  const itemDeleteResponse = () => page.waitForResponse(
    r => new URL(r.url()).pathname === '/api/v1/dict-items/delete' && r.request().method() === 'POST',
    { timeout: 10_000 },
  )

  try {
    // ── API 预置类型+两项（可控合成，减少 UI 建号时序）──
    await mustData(api('/api/v1/dicts', { ...h, method: 'POST', body: { code: typeCode, name: 'E2E 删除类型', remark: '合成删除场景备注' } }), '预置字典类型')
    for (const [code, label, sort] of [['prod', '生产', 1], ['stg', '预发', 2]] as const) {
      await mustData(api('/api/v1/dict-items', { ...h, method: 'POST', body: { type_code: typeCode, code, label, sort_order: sort } }), `预置字典项 ${code}`)
    }
    const items = await readItems()
    const prodBefore = items.find(item => item.code === 'prod')!
    const stgBefore = items.find(item => item.code === 'stg')!

    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.goto('/#/system/dict')
    await expect(page.getByRole('menuitem', { name: '字典管理' })).toBeVisible({ timeout: 15_000 })
    await page.getByPlaceholder('code/name 过滤', { exact: true }).fill(typeCode)
    const typeRow = page.locator('.el-table__row').filter({ hasText: typeCode })
    await expect(typeRow).toBeVisible()
    await typeRow.getByRole('cell', { name: typeCode, exact: true }).click()
    const rightCard = page.locator('.el-card').filter({ hasText: `字典项（${typeCode}）` })
    const rowOf = (code: string) => rightCard.locator('.el-table__row').filter({ hasText: code })

    // ── 条目删除：请求体为确认前捕获的 id+version 快照 ──
    const stgPending = itemDeleteResponse()
    await rowOf('stg').getByRole('button', { name: '删', exact: true }).click()
    await page.locator('.el-message-box').filter({ hasText: '预发' }).getByRole('button', { name: '确定' }).click()
    const stgResp = await stgPending
    expect(stgResp.status()).toBe(200)
    expect(stgResp.request().postDataJSON()).toEqual({ id: stgBefore.id, version: stgBefore.version })
    await expect(rowOf('stg')).toHaveCount(0, { timeout: 10_000 })

    // ── 冲突：确认框打开期间用真实 API 并发推进版本（可控合成竞态），确认后 409 零写 ──
    const prodPending = itemDeleteResponse()
    await rowOf('prod').getByRole('button', { name: '删', exact: true }).click()
    await expect(page.locator('.el-message-box').filter({ hasText: '生产' })).toBeVisible()
    await mustData(api('/api/v1/dict-items/update', {
      ...h, method: 'POST',
      body: { id: prodBefore.id, label: prodBefore.label, sort_order: prodBefore.sort_order, enabled: false, remark: prodBefore.remark, version: prodBefore.version },
    }), '并发推进条目版本')
    const afterBump = await readItems()
    expect(afterBump.find(item => item.id === prodBefore.id)?.version).toBe(prodBefore.version + 1)

    await page.locator('.el-message-box').filter({ hasText: '生产' }).getByRole('button', { name: '确定' }).click()
    const conflictResp = await prodPending
    expect(conflictResp.status()).toBe(409)
    expect(conflictResp.request().postDataJSON()).toEqual({ id: prodBefore.id, version: prodBefore.version })
    // 冲突提示要求重看当前对象；随后回读展示权威行（含并发改动），不自动重试。
    await expect(rightCard.getByTestId('dict-item-delete-conflict')).toContainText('请重新确认当前对象后再删除')
    await expect(rowOf('prod').getByText('已停用', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(800)
    expect(deletePosts).toHaveLength(2)

    // ── 重新确认后绑定当前版本删除成功 ──
    const prodRetry = itemDeleteResponse()
    await rowOf('prod').getByRole('button', { name: '删', exact: true }).click()
    await page.locator('.el-message-box').filter({ hasText: '生产' }).getByRole('button', { name: '确定' }).click()
    const retryResp = await prodRetry
    expect(retryResp.status()).toBe(200)
    expect(retryResp.request().postDataJSON()).toEqual({ id: prodBefore.id, version: prodBefore.version + 1 })
    await expect(rowOf('prod')).toHaveCount(0, { timeout: 10_000 })

    // ── 类型删除：id+code+version 快照，级联清理剩余项 ──
    // 先重过一次过滤让 UI 持有删除后的新鲜类型版本（条目删除不触发类型列表回读）。
    await page.getByPlaceholder('code/name 过滤', { exact: true }).fill('')
    await expect(typeRow).toHaveCount(0, { timeout: 10_000 })
    await page.getByPlaceholder('code/name 过滤', { exact: true }).fill(typeCode)
    await expect(typeRow).toBeVisible({ timeout: 10_000 })
    const current = await readType()
    const typePending = page.waitForResponse(
      r => new URL(r.url()).pathname === '/api/v1/dicts/delete' && r.request().method() === 'POST',
      { timeout: 10_000 },
    )
    await typeRow.getByRole('button', { name: '删', exact: true }).click()
    await page.locator('.el-message-box').filter({ hasText: '级联删除' }).getByRole('button', { name: '删除', exact: true }).click()
    const typeResp = await typePending
    expect(typeResp.status()).toBe(200)
    expect(typeResp.request().postDataJSON()).toEqual({ id: current.id, code: typeCode, version: current.version })
    await expect(typeRow).toHaveCount(0, { timeout: 10_000 })
    expect(deletePosts).toHaveLength(3)
  } finally {
    await api('/api/v1/dicts/delete', { ...h, method: 'POST', body: { code: typeCode } }).catch(() => {})
  }
})
