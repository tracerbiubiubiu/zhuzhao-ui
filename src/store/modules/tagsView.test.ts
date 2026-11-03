/**
 * tagsView store 刷新恢复单测（2026-11-03 页签持久化批）
 *
 * 恢复语义钉死：① 权限过滤——resolve 不到（无权/已下线路由）一律丢弃；
 * ② meta 现取——title/icon 从 resolve 产物重建，持久化的过期 title 不复活；
 * ③ 同 path 去重；④ restored 幂等（每会话一次）；⑤ cachedViews 同步重建。
 * resolve 为注入函数（store 不 import router——防环），纯逻辑零 mock。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createTagView, useTagsViewStore, type TagViewRouteLike } from './tagsView'

/** 伪造 router.resolve 产物（结构子集——restoreViews 消费面） */
const resolved = (fullPath: string, opts?: { name?: string; title?: string; noTagsView?: boolean; noCache?: boolean }): TagViewRouteLike => ({
  path: fullPath.split('?')[0] ?? fullPath,
  fullPath,
  name: opts?.name,
  meta: { title: opts?.title, noTagsView: opts?.noTagsView, noCache: opts?.noCache },
  matched: [{ meta: {} }],
  query: {},
  hash: '',
})

describe('tagsView restoreViews（刷新恢复）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('有效页签重建：meta 从路由表现取（过期 title 不复活）+ cachedViews 同步', () => {
    const store = useTagsViewStore()
    // 模拟持久化水合出的旧数据：title 为改名前的旧值
    store.visitedViews = [
      { path: '/tasks', fullPath: '/tasks', name: 'task_list_page', title: '任务（旧名）', icon: 'mdi:old', query: {}, hash: '', affix: false, noCache: false },
    ]
    const table: Record<string, TagViewRouteLike> = {
      '/tasks': resolved('/tasks', { name: 'task_list_page', title: '任务中心', noCache: false }),
    }

    expect(store.restoreViews((fp) => (table[fp] ? createTagView(table[fp]) : undefined))).toBe(true)

    expect(store.visitedViews).toHaveLength(1)
    expect(store.visitedViews[0]?.title).toBe('任务中心')
    expect(store.visitedViews[0]?.icon).toBeUndefined()
    // noCache=false 且有 name → 进 keep-alive 白名单（syncCachedViews 重建）
    expect(store.cachedViews).toEqual(['task_list_page'])
  })

  it('无权/已下线/noTagsView 页签一律丢弃（权限过滤语义）', () => {
    const store = useTagsViewStore()
    store.visitedViews = [
      { path: '/system/user', fullPath: '/system/user', name: 'user_page', title: '用户管理', query: {}, hash: '', affix: false, noCache: false },
      { path: '/removed', fullPath: '/removed', name: 'removed_page', title: '已下线页', query: {}, hash: '', affix: false, noCache: false },
      { path: '/403', fullPath: '/403', name: 'Forbidden', title: '无权限', query: {}, hash: '', affix: false, noCache: false },
    ]
    // 路由表只认 /system/user；resolve 对 /403 命中 noTagsView（createTagView 返回 undefined）
    const table: Record<string, TagViewRouteLike> = {
      '/system/user': resolved('/system/user', { name: 'user_page', title: '用户管理' }),
      '/403': resolved('/403', { name: 'Forbidden', title: '无权限', noTagsView: true }),
    }

    store.restoreViews((fp) => (table[fp] ? createTagView(table[fp]) : undefined))

    expect(store.visitedViews.map((v) => v.path)).toEqual(['/system/user'])
    expect(store.cachedViews).toEqual(['user_page'])
  })

  it('同 path 去重（防存储异常重复条目）+ query 差异仍按 path 合流', () => {
    const store = useTagsViewStore()
    store.visitedViews = [
      { path: '/tasks', fullPath: '/tasks?status=open', name: 'task_list_page', title: '任务中心', query: { status: 'open' }, hash: '', affix: false, noCache: false },
      { path: '/tasks', fullPath: '/tasks?status=closed', name: 'task_list_page', title: '任务中心', query: { status: 'closed' }, hash: '', affix: false, noCache: false },
    ]
    const table: Record<string, TagViewRouteLike> = {
      '/tasks?status=open': resolved('/tasks?status=open', { name: 'task_list_page', title: '任务中心' }),
      '/tasks?status=closed': resolved('/tasks?status=closed', { name: 'task_list_page', title: '任务中心' }),
    }

    store.restoreViews((fp) => (table[fp] ? createTagView(table[fp]) : undefined))

    expect(store.visitedViews).toHaveLength(1)
    expect(store.visitedViews[0]?.fullPath).toBe('/tasks?status=open')
  })

  it('restored 幂等：二次调用不执行（每会话一次）', () => {
    const store = useTagsViewStore()
    store.visitedViews = [
      { path: '/tasks', fullPath: '/tasks', name: 'task_list_page', title: '任务中心', query: {}, hash: '', affix: false, noCache: false },
    ]
    const resolve = () => createTagView(resolved('/tasks', { name: 'task_list_page', title: '任务中心' }))

    expect(store.restoreViews(resolve)).toBe(true)
    // 二次调用不再重放（restored 标志——登出 $reset 复位后才会再跑）
    expect(store.restoreViews(resolve)).toBe(false)
    expect(store.visitedViews).toHaveLength(1)
  })

  it('noCache 页签不进 cachedViews（keep-alive 语义一致）', () => {
    const store = useTagsViewStore()
    store.visitedViews = [
      { path: '/tickets/new', fullPath: '/tickets/new', name: 'TicketCreate', title: '发起工单', query: {}, hash: '', affix: false, noCache: true },
    ]
    const table: Record<string, TagViewRouteLike> = {
      '/tickets/new': resolved('/tickets/new', { name: 'TicketCreate', title: '发起工单', noCache: true }),
    }

    store.restoreViews((fp) => (table[fp] ? createTagView(table[fp]) : undefined))

    expect(store.visitedViews).toHaveLength(1)
    expect(store.cachedViews).toEqual([])
  })
})

describe('tagsView moveView（拖拽排序——2026-11-03 批次②）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const seed = (store: ReturnType<typeof useTagsViewStore>) => {
    store.visitedViews = ['/a', '/b', '/c'].map((p) => ({
      path: p, fullPath: p, name: p, title: p, query: {}, hash: '', affix: false, noCache: false,
    }))
  }

  it('splice 语义：2→1 交换相邻顺序', () => {
    const store = useTagsViewStore()
    seed(store)
    store.moveView(2, 1)
    expect(store.visitedViews.map((v) => v.path)).toEqual(['/a', '/c', '/b'])
  })

  it('越界/同位 no-op（防 Sortable 异常索引破坏数组）', () => {
    const store = useTagsViewStore()
    seed(store)
    store.moveView(0, 0)
    store.moveView(-1, 2)
    store.moveView(0, 99)
    store.moveView(99, 0)
    expect(store.visitedViews.map((v) => v.path)).toEqual(['/a', '/b', '/c'])
  })
})

describe('tagsView addView affix 钉首位（2026-11-03 运行时验证批补）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const view = (path: string, affix = false) => ({
    path, fullPath: path, name: path, title: path, query: {}, hash: '', affix, noCache: false,
  })

  it('affix 页签到非空页签集 → 插最前（深链首跳/恢复场景 push 落尾回归）', () => {
    const store = useTagsViewStore()
    store.visitedViews = [view('/messages'), view('/tasks')]
    store.addView(view('/home', true))
    expect(store.visitedViews.map((v) => v.path)).toEqual(['/home', '/messages', '/tasks'])
    expect(store.visitedViews[0]?.affix).toBe(true)
  })

  it('全 affix 页签集追加仍有序；非 affix 照旧 push；已存在 path 原位替换', () => {
    const store = useTagsViewStore()
    store.visitedViews = [view('/home', true)]
    store.addView(view('/about', true))
    expect(store.visitedViews.map((v) => v.path)).toEqual(['/home', '/about'])
    store.addView(view('/tasks'))
    expect(store.visitedViews.map((v) => v.path)).toEqual(['/home', '/about', '/tasks'])
    store.addView(view('/tasks', false))
    expect(store.visitedViews.map((v) => v.path)).toEqual(['/home', '/about', '/tasks'])
  })
})
