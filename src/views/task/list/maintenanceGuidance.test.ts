import { describe, expect, it } from 'vitest'
import { maintenanceGuidance, taskMutationError } from './maintenanceGuidance'

describe('task maintenance guidance', () => {
  it('explains the separate grant and safe default before submitting audit maintenance', () => {
    const guidance = maintenanceGuidance('audit_archive')
    expect(guidance).toEqual(expect.any(String))
    expect(guidance).toContain('任务管理权限不包含审计维护资格')
    expect(guidance).toContain('未配置维护者时，人工归档默认拒绝')
    expect(guidance).toContain('联系运维')
    expect(guidance).toContain('临时调整须另行批准')
  })

  it.each([undefined, '', 'ordinary_task', 'AUDIT_ARCHIVE', 'audit_archive_other'])('does not describe %s as audit maintenance', (action) => {
    expect(maintenanceGuidance(action)).toBeUndefined()
  })

  it('keeps the server reason and adds a maintenance checklist only for a forbidden maintenance action', () => {
    const error = { response: { status: 403, data: { code: 10003, message: '禁止访问' } } }
    const message = taskMutationError(error, 'audit_archive', '提交失败')
    expect(message).toContain('禁止访问')
    expect(message).toContain('联系运维核查独立维护资格、账号状态及批准条件')
    expect(message).not.toContain('未配置维护者')
  })

  it.each([
    [403, 10003, 'ordinary_task'],
    [403, 20007, 'audit_archive'],
    [503, 10003, 'audit_archive'],
    [401, 20002, 'audit_archive'],
  ])('does not diagnose http %s/code %s/%s as a missing maintenance grant', (status, code, action) => {
    const error = { response: { status, data: { code, message: '服务端原始原因' } } }
    expect(taskMutationError(error, action, '提交失败')).toBe('服务端原始原因')
  })

  it('uses the operation fallback for a network failure without diagnosing authorization', () => {
    expect(taskMutationError(new Error('network'), 'audit_archive', '提交失败')).toBe('提交失败')
  })
})
