import { expect, it, vi } from 'vitest'
import { preparePage, setupPage } from '@/test/sfcHarness'
import { ref } from 'vue'
import source from './index.vue?raw'

preparePage(source)
it('列表、统计和导出消费同一组已生效筛选，输入防抖期间沿用上次条件', async () => {
  const list = vi.fn(), stats = vi.fn(), xlsx = vi.fn().mockRejectedValue(new Error())
  let apply = () => {}
  const allowStats = ref(true)
  let statsQuery: any
  const { page } = setupPage(source, {
    '@/api/ticket': { listTicketsApi: list, getTicketStatsApi: stats, exportTicketsApi: xlsx, STATUS_LABEL: {} },
    '@/common/auth': { usePermission: () => ({ hasPerm: (code: string) => code === 'ticket:stats' && allowStats.value }) },
    'vue-router': { useRoute: () => ({ query: { exclude_statuses: 'closed,cancelled', assignee: 'me' } }), useRouter: () => ({}) },
    'element-plus': { ElMessage: { error: vi.fn() } },
    '@tanstack/vue-query': { useQuery: (config: any) => { if (config.enabled) statsQuery = config; return { data: ref() } } },
    '@vea/hooks': { useDatePresetRange: () => ({ range: ref(['2026-01-01', '2026-01-31']) }),
      useAutoFilterRun: (_: unknown, callback: () => void) => { apply = callback } },
    '@/components/FilterBar/index.vue': {}, '@/components/ProTable/index.vue': {}, '@/components/UserNameText/index.vue': {},
  })
  const filters = { exclude_statuses: 'closed,cancelled', assignee: 'me', created_from: '2026-01-01', created_to: '2026-01-31' }
  page.search.keyword = '  合成  '
  await page.onExport()
  expect(xlsx.mock.lastCall?.[0]).toEqual(filters)
  apply()
  await page.fetcher({ page: 2, page_size: 20 })
  await page.onExport()
  expect(list.mock.lastCall?.[0]).toEqual({ ...filters, keyword: '合成', page: 2, page_size: 20 })
  expect(xlsx.mock.lastCall?.[0]).toEqual({ ...filters, keyword: '合成' })
  expect(statsQuery.enabled.value).toBe(false)
  page.statsVisible.value = true
  expect(statsQuery.enabled.value).toBe(true)
  await statsQuery.queryFn({ queryKey: statsQuery.queryKey.value })
  expect(stats.mock.lastCall?.[0]).toEqual({ ...filters, keyword: '合成', group_by: 'status' })
  allowStats.value = false
  expect(page.statsVisible.value).toBe(false)
  expect(statsQuery.enabled.value).toBe(false)
})
