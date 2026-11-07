import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import request from '@vea/request'
import {
  bindAvatar, confirmUpload, deleteAttachment, listAttachments,
  type AttachmentView, type ConfirmResponse,
} from './index'

vi.mock('@vea/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

describe('storage identity wire contract', () => {
  beforeEach(() => { vi.mocked(request.get).mockReset(); vi.mocked(request.post).mockReset() })

  it('binds response ID types to generated string contracts', () => {
    expectTypeOf<ConfirmResponse['id']>().toEqualTypeOf<string>()
    expectTypeOf<AttachmentView['id']>().toEqualTypeOf<string>()
    expectTypeOf<AttachmentView['ticket_id']>().toEqualTypeOf<string>()
  })

  it('keeps adjacent large attachment IDs distinct after JSON parsing', async () => {
    // Client-side preservation only; the Go real-HTTP regression establishes
    // that the server emits these strings instead of numeric JSON values.
    vi.mocked(request.get).mockResolvedValue(JSON.parse('[{"id":"9007199254740992","object_key":"tickets/a.png"},{"id":"9007199254740993","object_key":"tickets/b.png"}]') as never)
    const rows = await listAttachments('9007199254740995')
    expect(rows.map(row => row.id)).toEqual(['9007199254740992', '9007199254740993'])
    expect(new Set(rows.map(row => row.id)).size).toBe(2)
    expect(request.get).toHaveBeenCalledWith('/api/v1/tickets/9007199254740995/attachments')
  })

  it('keeps confirm, avatar binding and deletion addressed by object keys', async () => {
    const object = { id: '9007199254740993', object_key: 'avatars/synthetic.png' }
    vi.mocked(request.post).mockResolvedValue(object as never)
    expect((await confirmUpload({ object_key: object.object_key })).id).toBe('9007199254740993')
    expect((await bindAvatar({ object_key: object.object_key })).object_key).toBe(object.object_key)
    await deleteAttachment({ ticket_id: '9007199254740995', object_key: 'tickets/synthetic.png' })
    expect(request.post).toHaveBeenNthCalledWith(1, '/api/v1/tickets/attachments/confirm', { object_key: object.object_key })
    expect(request.post).toHaveBeenNthCalledWith(2, '/api/v1/storage/avatar/bind', { object_key: object.object_key })
    expect(request.post).toHaveBeenNthCalledWith(3, '/api/v1/tickets/attachments/delete', { ticket_id: '9007199254740995', object_key: 'tickets/synthetic.png' })
  })
})
