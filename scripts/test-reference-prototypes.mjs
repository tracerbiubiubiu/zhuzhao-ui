import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect as playwrightExpect } from '@playwright/test'

// This suite owns an ephemeral loopback server and an isolated browser context.
// It never starts Vite, calls business services, or loads E2E globalSetup.
const sourcePath = resolve('docs/design/prototypes/lifecycle-workspace.html')
const source = await readFile(sourcePath, 'utf8')
const selfTest = process.argv.includes('--self-test')
assert(process.argv.slice(2).every((arg) => arg === '--self-test'), 'unknown prototype test argument')
const output = resolve(process.env.QUALITY_ARTIFACT_DIR || '.codex/audits/tiered-gates-20261116', `prototype-${Date.now()}`)
await mkdir(output, { recursive: true })
const expect = playwrightExpect.configure({ timeout: 2000 })

const browser = await chromium.launch()
const results = []

async function withPrototype(html, task) {
  const server = createServer((request, response) => {
    if (request.url !== '/') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(html)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const errors = []
  const external = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      external.push(url.href)
      await route.abort()
      return
    }
    await route.continue()
  })
  await context.routeWebSocket('**/*', (socket) => {
    external.push(socket.url())
    socket.close()
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('websocket', (socket) => external.push(socket.url()))
  page.setDefaultTimeout(2000)
  try {
    await page.goto(origin, { waitUntil: 'networkidle' })
    await task(page)
    assert.deepEqual(errors, [], 'prototype has script errors')
    assert.deepEqual(external, [], 'prototype attempted external network access')
  } finally {
    await context.close()
    await new Promise((done) => server.close(done))
  }
}

async function navigate(page, view) {
  const target = page.locator(`.nav [data-view="${view}"]`)
  if (!await target.isVisible()) await page.locator('#menu-toggle').click()
  await target.click()
  await expect(page.locator('#main-content h1')).toBeVisible()
}

async function memberCannotReadTasks(page) {
  await expect(page.locator('[data-action="my-tasks"]')).toHaveCount(0)
  await expect(page.locator('.summary-card')).toHaveCount(2)
}

async function historyRequiresQuery(page) {
  await navigate(page, 'intel')
  const chosen = page.locator('[data-history="1"]')
  const value = await chosen.locator('strong').innerText()
  await chosen.click()
  await expect(page.locator('#intel-value')).toHaveValue(value)
  await expect(page.locator('#intel-result')).toContainText('准备查询当前结果')
  await expect(page.locator('.result-metadata')).toHaveCount(0)
}

async function dirtyNavigationRequiresDecision(page) {
  await page.locator('#role-control').selectOption('operator')
  await navigate(page, 'agent')
  await page.locator('#agent-name').fill('未保存的合成草稿')
  await navigate(page, 'tickets')
  await expect(page.locator('#modal[open]')).toBeVisible()
  await expect(page.locator('#modal-title')).toHaveText('尚有未保存的配置')
}

async function planRequiresAcknowledgement(page) {
  await page.locator('#role-control').selectOption('operator')
  await navigate(page, 'agent')
  await page.locator('[data-action="preview-plan"]').click()
  await expect(page.locator('#confirm-plan')).toBeDisabled()
}

async function checkLayoutAndScreenshot(page, label) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: document overflows viewport`)
  await page.screenshot({ path: resolve(output, `${label}.png`), fullPage: true })
}

async function fullSuite(page, viewport) {
  await page.setViewportSize(viewport)
  await memberCannotReadTasks(page)
  await checkLayoutAndScreenshot(page, `${viewport.width}-home`)
  await page.locator('#role-control').selectOption('operator')
  await expect(page.locator('.summary-card')).toHaveCount(3)
  await page.locator('[data-action="my-tasks"]').click()
  await expect(page.locator('#modal-body .evidence-row')).toHaveCount(2)
  await expect(page.locator('#modal-body')).not.toContainText('另一位成员的任务')
  await expect(page.locator('#modal-body')).not.toContainText('昨日例行摘要')
  await page.locator('#modal-footer [data-action="close-dialog"]').click()

  await navigate(page, 'tickets')
  await page.locator('#advanced-toggle').click()
  await page.locator('#date-filter').selectOption('due')
  await expect(page.locator('#ticket-rows tr')).toHaveCount(2)
  await page.locator('#advanced-toggle').click()
  await expect(page.locator('#advanced-filters')).toBeHidden()
  await expect(page.locator('#filter-chips')).toContainText('截止：今天至明天')
  await page.locator('#ticket-search').fill('不存在的合成记录')
  await expect(page.locator('#ticket-rows')).toContainText('没有符合条件的工单')
  await page.locator('#filter-chips [data-action="clear-filters"]').click()
  await expect(page.locator('#ticket-rows tr')).toHaveCount(6)
  await page.locator('[data-select-id="9007199254741001"]').check()
  await page.locator('[data-select-id="9007199254741002"]').check()
  await page.locator('[data-action="batch-tags"]').click()
  await page.locator('#batch-tag-input').fill('离线验证合成标签')
  await page.locator('[data-action="apply-tags"]').click()
  await expect(page.locator('#modal-body .partial-results li')).toHaveCount(2)
  await expect(page.locator('#modal-body')).toContainText('2项已添加')
  await page.locator('#modal-footer [data-action="close-dialog"]').click()
  await expect(page.locator('#ticket-rows tr').filter({ hasText: '离线验证合成标签' })).toHaveCount(2)
  await checkLayoutAndScreenshot(page, `${viewport.width}-tickets`)
  await page.locator('#ticket-rows [data-detail]').first().click()
  await expect(page.locator('#main-content')).toContainText('公开服务证书即将到期')
  await expect(page.locator('[data-action="assign"]')).toBeEnabled()
  await checkLayoutAndScreenshot(page, `${viewport.width}-detail`)

  await historyRequiresQuery(page)
  const value = await page.locator('#intel-value').inputValue()
  await page.locator('[data-action="query-intel"]').click()
  await expect(page.locator('.result-value')).toHaveText(value)
  await expect(page.locator('.result-metadata')).toContainText('示例情报服务S3')
  await checkLayoutAndScreenshot(page, `${viewport.width}-intel`)

  await dirtyNavigationRequiresDecision(page)
  await page.locator('#modal-footer [data-action="close-dialog"]').click()
  await expect(page.locator('#agent-name')).toHaveValue('未保存的合成草稿')
  await navigate(page, 'tickets')
  await page.locator('[data-action="discard-navigation"]').click()
  await expect(page.locator('#main-content h1')).toHaveText('工单')
  await planRequiresAcknowledgement(page)
  await expect(page.locator('#modal-body')).toContainText('Asia/Shanghai')
  await expect(page.locator('#modal-body')).toContainText('每次业务写入逐次确认')
  await page.locator('#plan-ack').check()
  await expect(page.locator('#confirm-plan')).toBeEnabled()
  await page.locator('#plan-ack').uncheck()
  await expect(page.locator('#confirm-plan')).toBeDisabled()
  await page.locator('#plan-ack').check()
  await page.locator('#confirm-plan').click()
  await expect(page.locator('.agent-run')).toContainText('确认演示已完成')
  await checkLayoutAndScreenshot(page, `${viewport.width}-agent`)

  await page.locator('#role-control').selectOption('member')
  await navigate(page, 'agent')
  await expect(page.locator('#agent-name')).toBeDisabled()
  await page.locator('[data-action="preview-plan"]').click()
  await expect(page.locator('#plan-ack')).toBeDisabled()
  await expect(page.locator('#confirm-plan')).toBeDisabled()
  await page.locator('#modal-footer [data-action="close-dialog"]').click()
  await navigate(page, 'devices')
  const deviceButtons = page.locator('[data-action="device-open"]')
  assert(await deviceButtons.count() > 0, 'device examples must exist')
  for (const button of await deviceButtons.all()) await expect(button).toBeDisabled()
  await checkLayoutAndScreenshot(page, `${viewport.width}-devices`)

  for (const view of ['home', 'tickets', 'intel', 'agent', 'devices']) {
    await navigate(page, view)
    for (const state of ['loading', 'error', 'empty']) {
      await page.locator('#state-control').selectOption(state)
      await expect(page.locator('#view .state-panel h2')).toBeVisible()
      if (state === 'error') {
        await page.locator('[data-action="retry-state"]').click()
        await expect(page.locator('#state-control')).toHaveValue('ready')
      }
    }
    await page.locator('#state-control').selectOption('ready')
  }
  await page.locator('#role-control').selectOption('empty')
  await expect(page.locator('[data-business]:visible')).toHaveCount(0)
  await expect(page.locator('#main-content')).toContainText('当前尚未分配业务页面')
  await page.locator('#main-content [data-action="messages"]').click()
  await expect(page.locator('#modal-title')).toHaveText('我的消息')
}

try {
  if (selfTest) {
    const cases = [
      ['task-role-boundary', "const canReadTasks=()=>app.role==='operator';", 'const canReadTasks=()=>true;', memberCannotReadTasks, 'toHaveCount'],
      ['history-explicit-query', 'app.intelQueried=false;render();document.querySelector', 'app.intelQueried=true;render();document.querySelector', historyRequiresQuery, 'toContainText'],
      ['dirty-leave-decision', "app.view==='agent'&&app.agentDirty&&!force&&view!==app.view", 'false', dirtyNavigationRequiresDecision, 'toBeVisible'],
      ['plan-explicit-ack', 'id="confirm-plan" data-action="confirm-plan" disabled', 'id="confirm-plan" data-action="confirm-plan"', planRequiresAcknowledgement, 'toBeDisabled'],
      ['external-network', '</body>', '<script>fetch("https://example.invalid/prototype-mutation").catch(()=>{})</script></body>', async () => {}, 'prototype attempted external network access'],
    ]
    for (const [name, before, after, check, expectedFailure] of cases) {
      assert.equal(source.split(before).length, 2, `${name}: mutation target must occur exactly once`)
      // The original must pass the same assertion before its isolated mutant runs.
      await withPrototype(source, check)
      let rejected = false
      try {
        await withPrototype(source.replace(before, after), check)
      } catch (error) {
        assert(error.message.includes(expectedFailure), `${name}: failed for an unrelated reason: ${error.message}`)
        rejected = true
        results.push({ name, result: 'rejected', reason: error.message.split('\n')[0] })
      }
      assert(rejected, `${name}: target defect was silently accepted`)
      process.stdout.write(`PASS mutation rejected: ${name}\n`)
    }
  } else {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await withPrototype(source, (page) => fullSuite(page, viewport))
      results.push({ viewport, result: 'pass' })
      process.stdout.write(`PASS offline prototype tasks: ${viewport.width}x${viewport.height}\n`)
    }
  }
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ source: sourcePath, selfTest, results }, null, 2) + '\n')
  process.stdout.write(`Artifacts: ${output}\n`)
} finally {
  await browser.close()
}
