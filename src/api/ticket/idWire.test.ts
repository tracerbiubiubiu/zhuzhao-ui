import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import { addTicketCCApi, assignTicketApi, createTicketApi } from './index'
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

  it('keeps recipient arrays exact beyond the JavaScript safe integer boundary', async () => {
    vi.mocked(request.post).mockResolvedValue({ cc: [] } as never)
    await addTicketCCApi({ ticket_id: '23', user_ids: ['9007199254740993', '9007199254740995'] })
    expect(request.post).toHaveBeenCalledWith('/api/v1/tickets/cc', {
      ticket_id: '23', user_ids: ['9007199254740993', '9007199254740995'],
    }, { _silentError: true })
  })

  it('keeps the supervisor selected during ticket creation as a string', async () => {
    vi.mocked(request.post).mockResolvedValue({ id: '23' } as never)
    await createTicketApi({ type_code: 'audit', title: 'synthetic', org_id: '1', escalation_supervisor_id: '9007199254740993' })
    expect(request.post).toHaveBeenCalledWith('/api/v1/tickets', {
      type_code: 'audit', title: 'synthetic', org_id: '1', escalation_supervisor_id: '9007199254740993',
    }, { _silentError: true })
  })

  it('sorts adjacent large identifiers without collapsing them into one float', () => {
    expect(['9007199254740992', '9007199254740993', '10', '9'].sort(compareInt64Desc))
      .toEqual(['9007199254740993', '9007199254740992', '10', '9'])
    expect(compareInt64Desc('9007199254740993', '9007199254740993')).toBe(0)
  })
})
