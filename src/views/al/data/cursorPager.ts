/**
 * keyset 游标分页页栈（al 域数据列表/死信 Tab 同形态——无 total，03 十三批）
 *
 * 语义：stack[k-1] = 第 k 页末尾的 next_cursor（翻页边界）。
 * 当前页号 = stack.length + 1；上一页 = 弹栈后用新栈顶 cursor 重拉（栈空=回首页）。
 * 纯函数无副作用——页面侧负责实际请求与状态落位。
 */

export interface CursorLike {
  after_created_at: string
  after_id: string
}

/** 翻下一页：压入当前页边界，返回应使用的请求 cursor（=刚压入的边界） */
export function pushCursor<C extends CursorLike>(stack: C[], next: C): C {
  stack.push(next)
  return next
}

/** 翻上一页：弹掉当前边界，返回弹栈后应使用的请求 cursor（null=回首页拉法） */
export function popCursor<C extends CursorLike>(stack: C[]): C | null {
  stack.pop()
  return stack.length ? stack[stack.length - 1] : null
}

/** 重置（切类型/刷新）：清空页栈回到首页 */
export function resetCursor<C extends CursorLike>(stack: C[]): void {
  stack.length = 0
}
