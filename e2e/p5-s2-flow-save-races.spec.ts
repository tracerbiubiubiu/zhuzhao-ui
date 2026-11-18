import { errors, test, expect, type Page, type Response } from '@playwright/test'
import { api, apiLogin, loadState, mustData, waitUserRateBudget } from './helpers'
import { uiLogin } from './ui'

const updatePath = '/api/v1/ticket-types/update'
type Graph = { states: string[]; transitions: Record<string, string[]> }

async function flushResponse(page: Page, response: Response) {
  // 等浏览器接收完整响应，再让 XHR 与 Vue 的异步续段跑完。
  expect(await response.finished()).toBeNull()
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

test('P5-S2：旧影响查询和保存响应不得接管重开的类型编辑', async ({ page }) => {
  const { admin } = loadState()
  const login = await mustData(apiLogin(admin.employeeNo, admin.password, 'flow-save-races'), '流程编辑登录')
  const auth = { token: login.access_token }
  const suffix = Date.now().toString(36)
  const codeA = `e2e_graph_a_${suffix}`
  const codeB = `e2e_graph_b_${suffix}`
  const graphA: Graph = {
    states: ['open', 'assigned', 'closed', 'legacy'],
    transitions: { open: ['assigned', 'legacy'], assigned: ['closed'], legacy: ['closed'] },
  }
  const graphB: Graph = {
    states: ['open', 'assigned', 'closed', 'review_b'],
    transitions: { open: ['assigned', 'review_b'], assigned: ['closed'], review_b: ['closed'] },
  }
  const metaB = { 'open>assigned': { roles: ['creator'], validator: 'priority == 1' } }
  const created: string[] = []
  const writes: unknown[] = []
  const impact = Promise.withResolvers<string>()
  const releaseImpact = Promise.withResolvers<void>()
  const failedImpact = Promise.withResolvers<string>()
  const releaseFailedImpact = Promise.withResolvers<void>()
  const impactFailureMessage = '合成：旧类型的影响查询失败'
  let failNextImpact = false
  const saving = Promise.withResolvers<void>()
  const releaseSaving = Promise.withResolvers<void>()
  try {
    for (const code of [codeA, codeB]) {
      await mustData(api('/api/v1/ticket-types', { ...auth, method: 'POST', body: { code, name: code } }), '创建合成工单类型')
      created.push(code)
    }
    await mustData(api(updatePath, { ...auth, method: 'POST', body: { code: codeA, ...graphA } }), '设置 A 的旧状态')
    await mustData(api(updatePath, { ...auth, method: 'POST', body: { code: codeB, transition_meta: metaB } }), '设置 B 的转换元数据')
    const readTypes = () => mustData(api<{ types: Array<Graph & { code: string; name: string; version: number; transition_meta: unknown }> }>('/api/v1/ticket-types', auth), '回读工单类型')
    const before = (await readTypes()).types
    const beforeA = before.find(({ code }) => code === codeA)!
    const beforeB = before.find(({ code }) => code === codeB)!
    expect(beforeA.states).toEqual(graphA.states)
    expect(beforeB.transition_meta).toEqual(metaB)
    await waitUserRateBudget()
    await uiLogin(page, admin.employeeNo, admin.password)
    await page.waitForURL(/#\/home/)
    await page.goto('/#/tickets/types')
    await page.getByPlaceholder('按名称/编码过滤').fill(suffix)

    await page.route('**/api/v1/tickets?**', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('type_code') !== codeA || url.searchParams.get('status') !== 'legacy') return route.continue()
      const shouldFail = failNextImpact
      failNextImpact = false
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      if (shouldFail) {
        failedImpact.resolve(url.href)
        await releaseFailedImpact.promise
        return route.fulfill({
          status: 503,
          json: { code: 10008, message: impactFailureMessage, data: null },
        })
      }
      impact.resolve(url.href)
      await releaseImpact.promise
      await route.fulfill({ response })
    })
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === updatePath) writes.push(request.postDataJSON())
    })
    await page.route(`**${updatePath}`, async (route) => {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      saving.resolve()
      await releaseSaving.promise
      await route.fulfill({ response })
    }, { times: 1 })

    const dialog = page.getByRole('dialog', { name: '编辑类型', exact: true })
    const save = dialog.getByRole('button', { name: '保存', exact: true })
    const cancel = dialog.getByRole('button', { name: '取消', exact: true })
    const titleField = dialog.locator('input[maxlength="100"]')
    const open = async (code: string) => {
      await page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: '编辑', exact: true }).click()
      await expect(dialog.getByTestId('fg-canvas').getByText('open', { exact: true })).toBeVisible()
    }
    const editGraph = async (graph: Graph) => {
      await dialog.getByTestId('graph-mode').getByText('JSON 源码').click()
      await dialog.getByPlaceholder(/"open","assigned"/).fill(JSON.stringify(graph.states))
      await dialog.getByPlaceholder(/\{"open":\["assigned","closed"\]/).fill(JSON.stringify(graph.transitions))
    }

    await open(codeA)
    await editGraph({ states: ['open', 'assigned', 'closed'], transitions: { open: ['assigned'], assigned: ['closed'] } })
    await save.click()
    const impactUrl = await impact.promise
    await expect(save).toBeDisabled()
    await cancel.click()
    await expect(dialog).toBeHidden()

    await open(codeB)
    await editGraph(graphB)
    const newName = `流程 B ${suffix}`
    await titleField.fill(newName)
    const description = '本次保存来自类型 B 的编辑草稿'
    await dialog.locator('textarea').first().fill(description)
    await save.evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
    await saving.promise
    await expect(save).toBeDisabled()

    const oldImpact = page.waitForResponse((response) => response.url() === impactUrl, { timeout: 10_000 })
    releaseImpact.resolve()
    await flushResponse(page, await oldImpact)
    await expect(save).toBeDisabled()
    expect(writes).toEqual([{
      code: codeB, name: newName, description, is_active: true, version: beforeB.version,
      ...graphB, transition_meta: metaB,
    }])

    await cancel.click()
    await expect(dialog).toBeHidden()
    await open(codeA)
    const oldSaved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === updatePath && response.request().postDataJSON()?.code === codeB,
    { timeout: 10_000 })
    releaseSaving.resolve()
    await flushResponse(page, await oldSaved)
    await expect(dialog).toBeVisible()
    await expect(titleField).toHaveValue(codeA)
    await expect(save).toBeEnabled()
    await expect(page.getByText('类型已更新', { exact: true })).toHaveCount(0)

    const after = (await readTypes()).types
    expect(after.find(({ code }) => code === codeA)).toEqual(beforeA)
    expect(after.find(({ code }) => code === codeB)).toMatchObject({
      name: newName, version: beforeB.version + 1, ...graphB, transition_meta: metaB,
    })

    // 画布实例有自己的撤销栈，切换类型后撤销不得恢复上一类型的图。
    const canvas = dialog.getByTestId('fg-canvas')
    await expect(canvas.getByText('legacy', { exact: true })).toBeVisible()
    failNextImpact = true
    await editGraph({ states: ['open', 'assigned', 'closed'], transitions: { open: ['assigned'], assigned: ['closed'] } })
    await save.click()
    const failedImpactUrl = await failedImpact.promise
    await cancel.click()
    await expect(dialog).toBeHidden()

    // API 回读证明已落库，再等页面缓存自身完成刷新，避免从旧表格行打开 B。
    await expect(page.getByRole('row').filter({ hasText: codeB }).getByText(newName, { exact: true })).toBeVisible()
    await open(codeB)
    await expect(canvas.getByText('review_b', { exact: true })).toBeVisible()

    const oldFailure = page.waitForResponse((response) =>
      response.url() === failedImpactUrl && response.status() === 503, { timeout: 10_000 })
    // 错误提示组件是异步加载的。监听这条唯一消息，避免在错误组件尚未挂载时断言通过。
    const staleToast = page.getByText(impactFailureMessage, { exact: true }).waitFor({ state: 'visible', timeout: 2_500 })
      .then(() => true, (err: unknown) => {
        if (!(err instanceof errors.TimeoutError)) throw err
        return false
      })
    releaseFailedImpact.resolve()
    await flushResponse(page, await oldFailure)
    expect(await staleToast).toBe(false)
    await expect(page.getByRole('dialog', { name: '改图影响在途工单' })).toBeHidden()
    await expect(titleField).toHaveValue(newName)
    await expect(save).toBeEnabled()
    await canvas.click({ position: { x: 20, y: 300 } })
    await page.keyboard.press('ControlOrMeta+z')
    await expect(canvas.getByText('legacy', { exact: true })).toHaveCount(0)
    await expect(canvas.getByText('review_b', { exact: true })).toBeVisible()

    const canvasName = `${newName} 画布保存`
    await titleField.fill(canvasName)
    const canvasSaved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === updatePath && response.request().postDataJSON()?.name === canvasName,
    { timeout: 10_000 })
    await save.click()
    await flushResponse(page, await canvasSaved)
    await expect(dialog).toBeHidden()

    const canvasGraphB = { ...graphB, transitions: { ...graphB.transitions, closed: [] } }
    expect(writes).toHaveLength(2)
    expect(writes[1]).toMatchObject({
      code: codeB, name: canvasName, version: beforeB.version + 1, ...canvasGraphB, transition_meta: metaB,
    })
    const finalTypes = (await readTypes()).types
    expect(finalTypes.find(({ code }) => code === codeA)).toEqual(beforeA)
    expect(finalTypes.find(({ code }) => code === codeB)).toMatchObject({
      name: canvasName, version: beforeB.version + 2, ...canvasGraphB, transition_meta: metaB,
    })
  } finally {
    releaseImpact.resolve()
    releaseSaving.resolve()
    releaseFailedImpact.resolve()
    for (const code of created) {
      await mustData(api('/api/v1/ticket-types/delete', { ...auth, method: 'POST', body: { code } }), '清理合成工单类型')
    }
  }
})
