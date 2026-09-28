/**
 * S8 工单发起（03 号 §2）：动态字段渲染器 + required/regex 客户端预检 + org_id 必填 +
 * 提交成功跳详情。幂等：API 造带字段的临时类型（ticket:type:manage——admin 专属），
 * finally 删类型；发起的工单不清理（无端点级联约束，留作列表数据）。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(120_000)

test('S8：发起工单（动态字段+校验预检+跳详情）', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const typeCode = `s8_type_${suffix}`

  // ── API setup：造带自定义字段的类型（input+required+regex / select 两项 / tips）──
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 's8-setup')
  const h = { token: admin.env!.data.access_token } as const
  const created = await api('/api/v1/ticket-types', {
    ...h, method: 'POST',
    body: { code: typeCode, name: `S8类型_${suffix}`, description: 'E2E 临时', default_sla_hours: 4 },
  })
  expect(created.env!.code).toBe(0)
  const fields = await api('/api/v1/ticket-types/fields/replace', {
    ...h, method: 'POST',
    body: {
      code: typeCode,
      fields: [
        { field_key: 'contact', field_label: '联系方式', field_type: 'input', required: true, validate_regex: '^[0-9-]{5,20}$', sort_order: 1 },
        { field_key: 'env', field_label: '环境', field_type: 'select', required: true, field_options: ['生产', '测试'], sort_order: 2 },
        { field_key: 'note', field_label: '提示：请勿填写敏感信息', field_type: 'tips', sort_order: 3 },
      ],
    },
  })
  expect(fields.env!.code).toBe(0)

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.goto('/#/tickets/new')

    // 选类型 → 动态字段渲染（三项）
    await page.locator('.el-form-item').filter({ hasText: '工单类型' }).locator('.el-select').click()
    await page.getByRole('option', { name: `S8类型_${suffix}` }).click()
    await expect(page.getByText('联系方式')).toBeVisible()
    await expect(page.getByText('环境')).toBeVisible()

    // 校验预检：必填缺失提交 → 表单项报错（03 S8：G2 400 前置到表单）
    await page.getByRole('textbox').first().fill('S8 发起的工单标题')
    await page.getByRole('button', { name: '提交工单' }).click()
    await expect(page.getByText('请填写「联系方式」').first()).toBeVisible()

    // regex 预检：联系方式格式错 → 表单项报错
    await page.getByPlaceholder('必填').fill('abc')
    await page.getByRole('button', { name: '提交工单' }).click()
    await expect(page.getByText('「联系方式」格式不正确').first()).toBeVisible()

    // 修正字段 + 选环境（select 选项）+ 归属组织（admin 无自服务组织 → 管理面全量兜底）
    await page.getByPlaceholder('必填').fill('13800000000')
    const envItem = page.locator('.el-form-item').filter({ hasText: '环境' })
    await envItem.locator('.el-select').click()
    await page.getByRole('option', { name: '生产' }).click()
    await page.keyboard.press('Escape') // 关闭环境下拉，防组织下拉的 visible 定位撞车
    const orgItem = page.locator('.el-form-item').filter({ hasText: '归属组织' })
    await orgItem.locator('.el-select').click()
    // 按 option 名精确定位（与环境字段同模式）：role=option + name 只在组织浮层匹配——
    // 种子根组织「集团总部」由主仓迁移固化（S6 同依赖），天然绕开浮层歧义/hover 抖动/过渡态误判
    await page.getByRole('option', { name: '集团总部' }).click({ timeout: 15_000 })
    await expect(orgItem.locator('.el-select__placeholder')).toContainText('集团总部', { timeout: 10_000 })

    await page.getByRole('button', { name: '提交工单' }).click()
    // 成功跳详情（行为断言：URL 进入 /tickets/:id 且渲染标题）
    await page.waitForURL(/#\/tickets\/\d+/)
    await expect(page.getByText('S8 发起的工单标题').first()).toBeVisible()
  } finally {
    // 清理：删临时类型（工单留存——列表测试数据）
    await api('/api/v1/ticket-types/delete', { ...h, method: 'POST', body: { code: typeCode } }).catch(() => {})
  }

})
