import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import { addTicketCCApi, assignTicketApi, createTicketApi, handleTicketApi } from './index'
import { compareInt64Desc } from '@/utils/int64'

vi.mock('@vea/request', () => ({ default: { post: vi.fn() } }))

describe('ticket identity wire contract', () => {
  beforeEach(() => vi.mocked(request.post).mockReset())

  it('keeps the selected escalation supervisor as an exact string', async () => {
    vi.mocked(request.post).mockResolvedValue(null as never)
    await assignTicketApi('23', '9007199254740993', '9007199254740995')
    expect(request.post).toHaveBeenCalledWith('/api/v1/tickets/assign', {
      id: '23', assigned_to: '9007199254740993', escalation_supervisor_id: '9007199254740995',
    }, { _silentError: true })
  })

  it('keeps cancellation as an explicit null without a supervisor patch', async () => {
    vi.mocked(request.post).mockResolvedValue(null as never)
    await assignTicketApi('23', null)
    expect(request.post).toHaveBeenCalledWith('/api/v1/tickets/assign', {
      id: '23', assigned_to: null,
    }, { _silentError: true })
  })

  it('keeps recipient arrays exact beyond the JavaScript safe integer boundary', async () => {
    vi.mocked(request.post).mockResolvedValue({ cc: [] } as never)
    await addTicketCCApi({ ticket_id: '23', user_ids: ['9007199254740993', '9007199254740995'] })
    expect(request.post).toHaveBeenCalledWith('/api/v1/tickets/cc', {
      ticket_id: '23', user_ids: ['9007199254740993', '9007199254740995'],
    }, { _silentError: true })
  })

  it('keeps the supervisor selected during ticket creation as a string', async () => {
    vi.mocked(request.post).mockResolvedValue({ id: '23' } as never)
    const custom = { summary: 'synthetic', related: ['alpha', 'beta'], optional: null }
    await createTicketApi({ type_code: 'audit', title: 'synthetic', org_id: '1', custom_data: custom, escalation_supervisor_id: '9007199254740993' })
    expect(request.post).toHaveBeenCalledWith('/api/v1/tickets', {
      type_code: 'audit', title: 'synthetic', org_id: '1', custom_data: custom, escalation_supervisor_id: '9007199254740993',
    }, { _silentError: true })
  })

  it('sorts adjacent large identifiers without collapsing them into one float', () => {
    expect(['9007199254740992', '9007199254740993', '10', '9'].sort(compareInt64Desc))
      .toEqual(['9007199254740993', '9007199254740992', '10', '9'])
    expect(compareInt64Desc('9007199254740993', '9007199254740993')).toBe(0)
  })
})

it('核对专用动作回执与原票和目标；响应不完整时保留未知结果', async () => {
  const command = { kind: 'transfer' as const, body: { id: '41', expected_revision: '7', to_user_id: '9007199254740993' } }
  const receipt = { id: '41', assigned_to: '9007199254740993', revision: '8', status: 'assigned' }
  for (const invalid of [null, { ...receipt, id: '42' }, { ...receipt, assigned_to: 9007199254740992 }, { ...receipt, revision: '7' }]) {
    vi.mocked(request.post).mockResolvedValueOnce(invalid as never)
    await expect(handleTicketApi(command, 'synthetic-key')).rejects.toThrow()
  }
  vi.mocked(request.post).mockResolvedValueOnce(receipt as never)
  await handleTicketApi(command, 'synthetic-key')
  expect(request.post).toHaveBeenLastCalledWith('/api/v1/tickets/transfer', command.body, {
    _silentError: true, headers: { 'Idempotency-Key': 'synthetic-key' },
  })
})
