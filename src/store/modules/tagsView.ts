import { defineStore } from 'pinia'
import type { LocationQuery, RouteMeta, RouteRecordNameGeneric } from 'vue-router'

export interface TagView {
  path: string
  fullPath: string
  name?: string
  title?: string
  icon?: string
  query: LocationQuery
  hash: string
  affix: boolean
  noCache: boolean
}

export interface TagsViewState {
  visitedViews: TagView[]
  cachedViews: string[]
  /** 刷新恢复是否已执行（不持久化——登出 $reset 复位，重登录后重跑） */
  restored: boolean
}

/**
 * 页签元数据重建的路由来源——RouteLocationNormalizedLoaded 与 router.resolve()
 * 产物（RouteLocationResolved）的结构公共子集（restoreViews 校验面用后者）。
 * matched 只收敛到实际消费面（createTagView 仅读 meta.icon）；name 容纳
 * resolve 未匹配产物的 null。
 */
export interface TagViewRouteLike {
  path: string
  fullPath: string
  name: RouteRecordNameGeneric | null | undefined
  meta: RouteMeta
  matched: readonly { meta: RouteMeta }[]
  query: LocationQuery
  hash: string
}

export const createTagView = (route: TagViewRouteLike): TagView | undefined => {
  if (route.meta.noTagsView) return

  const icon = [...route.matched].reverse().find((record) => record.meta.icon)?.meta.icon

  return {
    path: route.path,
    fullPath: route.fullPath,
    name: typeof route.name === 'string' ? route.name : undefined,
    title: route.meta.title,
    icon: icon ?? route.meta.icon,
    query: { ...route.query },
    hash: route.hash,
    affix: Boolean(route.meta.affix),
    noCache: Boolean(route.meta.noCache)
  }
}

export const useTagsViewStore = defineStore('tagsView', {
  state: (): TagsViewState => ({
    visitedViews: [],
    cachedViews: [],
    restored: false
  }),
  actions: {
    /**
     * 刷新恢复（2026-11-03 业界对齐批——Chrome 会话恢复/vben·soybean 同款形态）：
     * 持久化的 path/query 元数据在动态路由注册完成后按**当前会话路由表**校验重建——
     * ① 权限过滤：动态路由本就按菜单权限注册，路由不存在/catch-all/noTagsView 一律丢弃
     *    （换账号/降权后绝不恢复无权页签——安全语义）；② title/icon/affix/noCache 从
     *    路由 meta 现取（持久化数据可能因菜单改名过期）；③ 活动页签无需单独恢复——
     *    F5 后 URL 不变，守卫重导航即命中（Chrome 同款）。
     * resolve 注入自 permission.ts（store 不 import router——防环）；每会话执行一次。
     */
    restoreViews(resolve: (fullPath: string) => TagView | undefined) {
      if (this.restored) return false

      const seen = new Set<string>()
      this.visitedViews = this.visitedViews.flatMap((view) => {
        // 防御性去重（按 path 合流——与 addView 同键语义）；异常存储手工改坏也不炸
        if (seen.has(view.path)) return []
        const revived = resolve(view.fullPath)
        if (!revived) return []
        seen.add(view.path)
        return [revived]
      })
      this.syncCachedViews()
      this.restored = true
      return true
    },
    syncCachedViews() {
      this.cachedViews = [
        ...new Set(
          this.visitedViews.flatMap((view) => (!view.noCache && view.name ? [view.name] : []))
        )
      ]
    },
    addView(view: TagView) {
      const index = this.visitedViews.findIndex((item) => item.path === view.path)
      if (index === -1) {
        this.visitedViews.push(view)
      } else {
        this.visitedViews[index] = view
      }
      this.syncCachedViews()
    },
    removeView(view: TagView) {
      this.visitedViews = this.visitedViews.filter((item) => item.path !== view.path)
      this.syncCachedViews()
    },
    /** 拖拽排序（2026-11-03 批次②）：store 为顺序唯一事实源（Sortable 的 DOM 搬移在
     *  组件层回滚，见 TagsView onEnd）；cachedViews 与顺序无关不动 */
    moveView(from: number, to: number) {
      if (from < 0 || to < 0 || from === to) return
      if (from >= this.visitedViews.length || to >= this.visitedViews.length) return
      const [moved] = this.visitedViews.splice(from, 1)
      if (moved) this.visitedViews.splice(to, 0, moved)
    },
    removeCachedView(name?: string) {
      if (name) {
        this.cachedViews = this.cachedViews.filter((item) => item !== name)
      }
    },
    removeAllViews(keepAffix = true) {
      this.visitedViews = keepAffix ? this.visitedViews.filter((view) => view.affix) : []
      this.syncCachedViews()
    },
    removeOtherViews(view: TagView) {
      this.visitedViews = this.visitedViews.filter((item) => item.affix || item.path === view.path)
      this.syncCachedViews()
    },
    removeLeftViews(view: TagView) {
      const index = this.visitedViews.findIndex((item) => item.path === view.path)
      if (index < 0) return

      this.visitedViews = this.visitedViews.filter(
        (item, itemIndex) => item.affix || itemIndex >= index
      )
      this.syncCachedViews()
    },
    removeRightViews(view: TagView) {
      const index = this.visitedViews.findIndex((item) => item.path === view.path)
      if (index < 0) return

      this.visitedViews = this.visitedViews.filter(
        (item, itemIndex) => item.affix || itemIndex <= index
      )
      this.syncCachedViews()
    }
  },
  // 持久化（2026-11-03 业界对齐批）：只落 visitedViews 元数据（title/icon 等 meta 不落——
  // 恢复时从路由表现取，见 restoreViews）；key 版本化对齐 app.ts 惯例，schema 演进时换 v2。
  // cachedViews 为派生态（syncCachedViews 重建）；restored 为会话内存态，均不落。
  persist: {
    key: 'vea-tagsview-v1',
    pick: ['visitedViews']
  }
})
