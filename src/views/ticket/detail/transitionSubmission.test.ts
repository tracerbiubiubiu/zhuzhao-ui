import { describe, expect, it, vi } from 'vitest'
import { createTransitionSubmission } from './transitionSubmission'

const payload = {
  id: '1', to: 'pending_verify', expected_revision: '12', definition_version: '3',
  custom_data_patch: { proof: ['synthetic-proof'] },
}

function setup() {
  const send = vi.fn()
  const newKey = vi.fn().mockReturnValueOnce('original').mockReturnValueOnce('next')
  const submission = createTransitionSubmission({ send, newKey })
  return { send, newKey, submission }
}

describe('工单动作提交', () => {
  it('未知结果仅以同一载荷和操作号重试，并拒绝并行重复提交', async () => {
    const { send, newKey, submission } = setup()
    const original = structuredClone(payload)
    send.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(undefined)
    const first = submission.submit(original)
    await submission.submit({ ...payload, to: 'closed' })
    expect(await first).toBe(false)
    expect(submission.state.phase).toBe('unknown')
    original.custom_data_patch.proof.push('later-edit')
    await submission.submit(original)
    expect(send).toHaveBeenCalledTimes(1)
    expect(await submission.retry()).toBe(true)
    expect(send.mock.calls).toEqual([[payload, 'original'], [payload, 'original']])
    expect(newKey).toHaveBeenCalledTimes(1)
  })

  it('收到明确校验失败可修正重提，冲突时先刷新', async () => {
    const { send, submission } = setup()
    send.mockRejectedValueOnce({ response: { status: 400, data: { code: 90001, message: '附件无效' } } })
    send.mockRejectedValueOnce({ response: { status: 409, data: { code: 10006, message: '版本冲突' } } })
    await submission.submit(payload)
    expect(submission.state.phase).toBe('rejected')
    expect(submission.state.message).toContain('附件无效')
    const corrected = { ...payload, custom_data_patch: { proof: ['replacement'] } }
    await submission.submit(corrected)
    expect(submission.state.phase).toBe('refresh')
    expect(send.mock.lastCall).toEqual([corrected, 'next'])
    await submission.submit(corrected)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('保留 C04 离任拒绝，且拒绝未知结果的重试不抹掉原操作', async () => {
    const rejected = { response: { status: 403, data: { code: 10003, message: '当前任职已失效' } } }
    const firstTry = setup()
    firstTry.send.mockRejectedValueOnce(rejected)
    await firstTry.submission.submit(payload)
    expect(firstTry.submission.state.phase).toBe('refresh')
    expect(firstTry.submission.state.message).toContain('当前任职已失效')

    const replay = setup()
    replay.send.mockRejectedValueOnce(new Error('response lost')).mockRejectedValueOnce(rejected)
    await replay.submission.submit(payload)
    await replay.submission.retry()
    expect(replay.submission.state.phase).toBe('unknown')
    expect(replay.submission.state.message).toContain('当前任职已失效')
    expect(replay.send.mock.lastCall).toEqual([payload, 'original'])
  })

  it('同号操作仍在处理中时不误当版本冲突', async () => {
    const { send, submission } = setup()
    send.mockRejectedValue({ response: { status: 409, data: { code: 10006, data: { reason: 'operation_in_progress' } } } })
    await submission.submit(payload)
    expect(submission.state.phase).toBe('unknown')
    await submission.retry()
    expect(send.mock.lastCall).toEqual([payload, 'original'])
  })
})
