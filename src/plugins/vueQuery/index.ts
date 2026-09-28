/**
 * vue-query 接入（01 §4 状态分界：服务端态 = 一切列表/详情/树数据）
 *
 * QueryClient 单例导出——登出时会话拆除须 queryClient.clear()（userStore.logout 调用，
 * 防跨用户残留上一账号的缓存数据，与 Pinia resetState 同语义）。
 */
import type { App } from 'vue'
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 内部管理台口径：失败快反馈（默认 3 次重试会拖长错误态）、切窗口不自动重拉
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

export const setupVueQuery = (app: App<Element>) => {
  app.use(VueQueryPlugin, { queryClient })
}
