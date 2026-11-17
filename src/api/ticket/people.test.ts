import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from '@vea/request'
import { searchTicketPeopleApi } from './people'
vi.mock('@vea/request', () => ({ default: { get: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())
describe('business picker projection', () => {
  it('requests concrete ticket context with local errors', async () => { vi.mocked(request.get).mockResolvedValue({ list: [{ id: '12', label: 'Alice' }] } as never); await expect(searchTicketPeopleApi({ purpose: 'assign', ticketId: '44' }, 'alice')).resolves.toEqual([{ id: '12', label: 'Alice' }]); expect(request.get).toHaveBeenCalledWith('/api/v1/tickets/people', { params: { purpose: 'assign', ticket_id: '44', q: 'alice' }, _silentError: true }) })
  it.each([{}, { list: null }, { list: [{ id: 9007199254740992, label: 'bad' }] }, { list: [{ id: '0', label: 'bad' }] }, { list: [{ id: '12', label: '' }] }, { list: [{ id: '12', label: 'Alice' }, { id: '12', label: 'Duplicate' }] }, { list: Array.from({ length: 21 }, (_, i) => ({ id: String(i + 1), label: 'Too many' })) }])('malformed projection is an error, never empty success: %j', async (body) => { vi.mocked(request.get).mockResolvedValue(body as never); await expect(searchTicketPeopleApi({ purpose: 'cc', ticketId: '44' }, 'alice')).rejects.toThrow() })
  it('legal empty result and exact large identity survive', async () => { vi.mocked(request.get).mockResolvedValueOnce({ list: [] } as never).mockResolvedValueOnce({ list: [{ id: '9223372036854775807', label: 'Max' }] } as never); await expect(searchTicketPeopleApi({ purpose: 'rule-target', orgId: '77' }, 'alice')).resolves.toEqual([]); await expect(searchTicketPeopleApi({ purpose: 'create-supervisor', orgId: '77', typeCode: 'incident' }, 'alice')).resolves.toEqual([{ id: '9223372036854775807', label: 'Max' }]) })
})
