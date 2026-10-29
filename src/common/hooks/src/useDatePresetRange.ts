/**
 * 日期范围快捷段筛选（2026-10-29 统一形态批立——情报页单点形态升格全仓规范）：
 * 快捷段（全部/近7天/近30天）+ 自定义按需弹 daterange——替代常驻 daterange 占宽。
 * 三页共用（intel 历史 / audit / ticket 列表）；服务端参数页由调用方把 range
 * 映射进请求（from/to），客户端过滤页直接拿 range 比较。
 */
import { ref } from 'vue'

export type DatePreset = '' | '7d' | '30d' | 'custom'

function fmtDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function useDatePresetRange() {
  const preset = ref<DatePreset>('')
  const range = ref<[string, string] | null>(null)

  /** 快捷段选择（EP radio update 联合类型含 undefined——收宽后收窄）；custom 保留现值由 daterange 选 */
  function apply(v: string | number | boolean | undefined) {
    const p = (v ?? '') as DatePreset
    preset.value = p
    if (p === '7d' || p === '30d') {
      const today = new Date()
      const from = new Date(today.getTime() - (Number(p.slice(0, 1)) * 7 - 1) * 86400000)
      range.value = [fmtDay(from), fmtDay(today)]
    } else if (p === '') {
      range.value = null
    }
  }

  /** 重置（连同调用方筛选态一起清时调用；custom 拾取后由 daterange v-model 直接写 range） */
  function reset() {
    preset.value = ''
    range.value = null
  }

  return { preset, range, apply, reset }
}
