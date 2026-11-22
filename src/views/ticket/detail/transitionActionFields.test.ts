import { describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import type { TicketTypeFieldDef } from '@/api/ticket'
import { uploadAndConfirm } from '@/api/storage'
import { preparePage, setupPage } from '@/test/sfcHarness'
import source from './TransitionActionDialog.vue?raw'
import * as transitionActionFields from './transitionActionFields'
import { collectTransitionInput, createActionFileQueue, type TransitionActionForm } from './transitionActionFields'

vi.mock('@/api/storage', () => ({ uploadAndConfirm: vi.fn() }))
preparePage(source)

function field(key: string, fieldType: TicketTypeFieldDef['field_type'], required = true): TransitionActionForm['fields'][number] {
  return {
    definition: { id: key, type_code: 'synthetic', field_key: key, field_type: fieldType, field_label: key, required: false, sort_order: 0 },
    required,
  }
}

function uploadResult(key: string, status = 'confirmed') {
  return { object_key: key, purpose: 'attachment_create', status } as Awaited<ReturnType<typeof uploadAndConfirm>>
}

describe('transition evidence', () => {
  const action: TransitionActionForm = {
    title: '送复测',
    fields: [field('notes', 'textarea'), field('score', 'number'), field('proof', 'file'), field('extra', 'input', false)],
    commentRequired: true,
  }

  it('collects only the action fields and preserves valid zero values and stable file keys', () => {
    const result = collectTransitionInput(action, { notes: '已整改', score: 0, unrelated: '忽略' }, {
      proof: ['tickets/one.pdf', 'tickets/two.pdf'],
    }, '复测说明')
    expect(result).toEqual({
      input: {
        custom_data_patch: { notes: '已整改', score: 0, proof: ['tickets/one.pdf', 'tickets/two.pdf'] },
        comment: '复测说明',
      },
    })
  })

  it('keeps mandatory text and attachment fields distinct from a required action comment', () => {
    const result = collectTransitionInput(action, { notes: ' ', score: 0, proof: ['unconfirmed'] }, {}, '')
    expect(result).toEqual({
      errors: { notes: '请填写「notes」', proof: '请上传「proof」' },
      commentError: '请填写办理说明',
    })
  })

  it('returns an empty patch for actions with no fields', () => {
    expect(collectTransitionInput({ title: '开始处理', fields: [] }, {}, {}, '')).toEqual({ input: { custom_data_patch: {} } })
  })

  it('revalidates when the first value is entered after an incomplete submission', () => {
    const form = { title: '送复测', fields: [field('environment', 'input')] }
    const values = vue.reactive<Record<string, unknown>>(Object.create(null))
    const result = vue.computed(() => collectTransitionInput(form, values, {}, ''))

    expect(result.value).toMatchObject({ errors: { environment: '请填写「environment」' } })
    values.environment = '隔离复测环境'
    expect(result.value).toEqual({ input: { custom_data_patch: { environment: '隔离复测环境' } } })
  })

  it('does not treat inherited properties as input for a valid field key', () => {
    expect(collectTransitionInput({ title: '送复测', fields: [field('constructor', 'file')] }, {}, {}, '')).toEqual({
      errors: { constructor: '请上传「constructor」' },
    })
  })

  it('keeps failed files retryable and appends confirmed keys using the unbound upload path', async () => {
    const first = new File(['1'], 'one.pdf', { type: 'application/pdf' })
    const second = new File(['2'], 'two.pdf', { type: 'application/pdf' })
    vi.mocked(uploadAndConfirm)
      .mockReset()
      .mockResolvedValueOnce(uploadResult('tickets/one.pdf'))
      .mockRejectedValueOnce(new Error('临时上传失败'))
      .mockResolvedValueOnce(uploadResult('tickets/two.pdf'))
    const queue = createActionFileQueue()
    const definition = field('proof', 'file').definition

    await queue.add(definition, [first, second])
    expect(uploadAndConfirm).toHaveBeenNthCalledWith(1, first, 'attachment_create')
    expect(uploadAndConfirm).toHaveBeenNthCalledWith(2, second, 'attachment_create')
    expect(queue.keys().proof).toEqual(['tickets/one.pdf'])
    expect(queue.hasUnconfirmed.value).toBe(true)
    const failed = queue.state.proof[1]
    expect(failed).toMatchObject({ status: 'failed', error: '临时上传失败' })

    await queue.retry(definition, failed.id)
    expect(uploadAndConfirm).toHaveBeenLastCalledWith(second, 'attachment_create')
    expect(queue.keys().proof).toEqual(['tickets/one.pdf', 'tickets/two.pdf'])
    expect(queue.hasUnconfirmed.value).toBe(false)
    queue.remove('proof', queue.state.proof[0].id)
    expect(queue.keys().proof).toEqual(['tickets/two.pdf'])
  })

  it('ignores old uploads and avoids starting old queued files after closing the dialog', async () => {
    let resolve!: (result: Awaited<ReturnType<typeof uploadAndConfirm>>) => void
    vi.mocked(uploadAndConfirm).mockReset().mockReturnValueOnce(new Promise(done => { resolve = done }))
    const queue = createActionFileQueue()
    const definition = field('proof', 'file').definition
    const pending = queue.add(definition, [new File(['1'], 'old.pdf'), new File(['2'], 'queued.pdf')])
    queue.reset()
    resolve(uploadResult('tickets/old.pdf'))
    await pending

    expect(queue.state).toEqual({})
    expect(uploadAndConfirm).toHaveBeenCalledTimes(1)
    expect(queue.hasUnconfirmed.value).toBe(false)
  })

  it('deduplicates file keys and shows a reason when an attachment is not permitted', async () => {
    vi.mocked(uploadAndConfirm).mockReset().mockResolvedValue(uploadResult('tickets/shared.pdf'))
    const queue = createActionFileQueue()
    const definition = { ...field('proof', 'file').definition, field_options: ['application/pdf'] }
    const pdf = new File(['1'], 'one.pdf', { type: 'application/pdf' })
    const png = new File(['2'], 'two.png', { type: 'image/png' })
    await queue.add(definition, [pdf, pdf, png])

    expect(uploadAndConfirm).toHaveBeenCalledTimes(2)
    expect(queue.keys().proof).toEqual(['tickets/shared.pdf'])
    expect(queue.state.proof).toEqual([
      expect.objectContaining({ status: 'confirmed', name: 'one.pdf' }),
      expect.objectContaining({ status: 'failed', name: 'two.png', error: '文件类型 image/png 不在允许范围内', retryable: false }),
    ])
  })

  it('keeps a pending object out of the field value even when the response includes a key', async () => {
    vi.mocked(uploadAndConfirm).mockReset().mockResolvedValueOnce(uploadResult('tickets/pending.pdf', 'pending'))
    const queue = createActionFileQueue()
    await queue.add(field('proof', 'file').definition, [new File(['1'], 'pending.pdf')])

    expect(queue.keys().proof).toEqual([])
    expect(queue.state.proof[0]).toMatchObject({ status: 'failed', retryable: true })
  })

  it('retains evidence until the action ends or is replaced, including when hidden or refresh is required', async () => {
    const props = vue.reactive({ modelValue: true, action: action as TransitionActionForm | null, refreshRequired: false })
    const { page } = setupPage(source, {
      vue: { ...vue, useId: () => 'evidence' },
      'element-plus': {},
      '@/api/system/dict': {},
      '@/common/auth/tokenStorage': { getSessionGeneration: () => 0 },
      './transitionActionFields': transitionActionFields,
    }, props)

    page.values.notes = '保留的整改说明'
    props.refreshRequired = true
    expect(page.confirmDisabled.value).toBe(true)
    expect(page.values.notes).toBe('保留的整改说明')
    props.modelValue = false
    await vue.nextTick()
    props.modelValue = true
    await vue.nextTick()
    expect(page.values.notes).toBe('保留的整改说明')

    props.action = null
    expect(page.values.notes).toBeUndefined()
  })
})
