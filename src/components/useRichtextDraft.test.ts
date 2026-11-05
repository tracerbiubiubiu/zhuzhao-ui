import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import { richtextDraftKey, useRichtextDraft } from './useRichtextDraft'

const scopes: EffectScope[] = []
function editor(user = 'A', type = 'incident', field = 'detail') {
  const model = ref('')
  const key = ref(richtextDraftKey(user, type, field))
  const scope = effectScope()
  scopes.push(scope)
  const draft = scope.run(() => useRichtextDraft(() => model.value, () => key.value, (v) => { model.value = v }))!
  return { ...draft, model, key, scope }
}

beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })
afterEach(() => { scopes.splice(0).forEach((s) => s.stop()); vi.useRealTimers() })

describe('富文本草稿隔离与生命周期（B08-F01）', () => {
  it('账号、类型、字段分别隔离；同属主同类型可恢复', () => {
    const a = editor()
    a.content.value = 'A 私有哨兵'
    vi.advanceTimersByTime(2000)
    expect(editor('B').content.value).toBe('')
    expect(editor('A', 'request').content.value).toBe('')
    expect(editor('A', 'incident', 'another').content.value).toBe('')
    expect(editor().content.value).toBe('A 私有哨兵')
    expect(editor().draftRestored.value).toBe(true)
  })

  it('无属主旧 key 只删除不恢复；无登录身份不持久化', () => {
    localStorage.setItem('richtext-draft:ticket_create_detail', JSON.stringify({ content: 'legacy secret', ts: 1 }))
    const a = editor('')
    a.content.value = '匿名'
    vi.advanceTimersByTime(2000)
    expect(localStorage.length).toBe(0)
  })

  it('元组 key 无分隔符碰撞', () => {
    expect(richtextDraftKey('a:b', 'c', 'd')).not.toBe(richtextDraftKey('a', 'b:c', 'd'))
  })

  it('丢弃草稿清空编辑器与父表单，提示消失，后续卸载不重新保存', () => {
    const a = editor()
    a.content.value = '旧草稿'
    a.scope.stop()
    const b = editor()
    expect(b.content.value).toBe('旧草稿')
    b.discardDraft()
    expect(b.content.value).toBe('')
    expect(b.model.value).toBe('')
    expect(b.draftRestored.value).toBe(false)
    b.scope.stop()
    vi.advanceTimersByTime(2000)
    expect(localStorage.getItem(b.key.value!)).toBeNull()
  })

  it('提交 clear 取消未触发的保存，卸载和旧 timer 不复活草稿', () => {
    const a = editor()
    a.content.value = '刚输入即提交'
    a.clearDraft()
    a.scope.stop()
    vi.advanceTimersByTime(2000)
    expect(localStorage.getItem(a.key.value!)).toBeNull()
  })

  it('未提交退出在 scope 销毁时保存，清空输入则删除旧草稿', () => {
    const a = editor()
    a.content.value = '未提交'
    a.scope.stop()
    const b = editor()
    expect(b.content.value).toBe('未提交')
    b.content.value = ''
    b.scope.stop()
    expect(localStorage.getItem(b.key.value!)).toBeNull()
  })

  it('父表单重置同步编辑器；scope 销毁后没有延迟写入', () => {
    const a = editor()
    a.content.value = '输入'
    a.model.value = ''
    expect(a.content.value).toBe('')
    a.scope.stop()
    vi.advanceTimersByTime(2000)
    expect(localStorage.getItem(a.key.value!)).toBeNull()
  })

  it('损坏或无效草稿删除；storage 配额异常不阻断编辑和丢弃', () => {
    const key = richtextDraftKey('A', 'incident', 'detail')!
    localStorage.setItem(key, '{bad')
    expect(editor().content.value).toBe('')
    expect(localStorage.getItem(key)).toBeNull()
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const a = editor()
    a.content.value = '可继续编辑'
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow()
    a.discardDraft()
    expect(a.content.value).toBe('')
    spy.mockRestore()
  })
})
