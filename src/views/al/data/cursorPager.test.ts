import { describe, expect, it } from 'vitest'
import { popCursor, pushCursor, resetCursor, type CursorLike } from './cursorPager'

/** keyset 游标页栈语义防漂移：stack[k-1]=第 k 页末 cursor、页号=栈长+1（al 域无 total 形态） */
function c(n: number): CursorLike {
  return { after_created_at: `2026-09-29T00:00:${String(n).padStart(2, '0')}Z`, after_id: String(n) }
}

describe('cursorPager 页栈', () => {
  it('翻页：push 返回刚压入的边界，页号随栈长递增', () => {
    const stack: CursorLike[] = []
    expect(pushCursor(stack, c(1))).toEqual(c(1))
    expect(pushCursor(stack, c(2))).toEqual(c(2))
    expect(stack).toHaveLength(2) // 第 3 页
  })

  it('回退：pop 弹栈并返回新栈顶（栈空=回首页 null）', () => {
    const stack: CursorLike[] = [c(1), c(2), c(3)] // 第 4 页
    expect(popCursor(stack)).toEqual(c(2)) // 回第 3 页
    expect(popCursor(stack)).toEqual(c(1)) // 回第 2 页
    expect(popCursor(stack)).toBeNull() // 回首页
    expect(stack).toHaveLength(0)
  })

  it('首页连续 pop 不越界（恒 null）', () => {
    const stack: CursorLike[] = []
    expect(popCursor(stack)).toBeNull()
    expect(popCursor(stack)).toBeNull()
  })

  it('重置：清栈回首页（切类型/写入后刷新）', () => {
    const stack: CursorLike[] = [c(1), c(2)]
    resetCursor(stack)
    expect(stack).toHaveLength(0)
  })
})
