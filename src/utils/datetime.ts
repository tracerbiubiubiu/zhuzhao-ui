/**
 * 时间格式化统一出口（走查反馈批 2026-10-28 收口——此前 13 文件 16 处散落
 * toLocaleString('zh-CN', { hour12: false }) 手写变体）。
 * 口径：zh-CN · 24 小时制；空值/非法值返回空串（列表兜底语义）。
 */

/** 完整形态：YYYY/M/D HH:mm:ss（列表时间列默认口径） */
export function formatDateTime(v?: string | number | Date | null): string {
  if (v === undefined || v === null || v === '') return ''
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false })
}

/** 分钟级短形态：M/D HH:mm（情报「缓存至」等紧凑展示位） */
export function formatDateTimeShort(v?: string | number | Date | null): string {
  if (v === undefined || v === null || v === '') return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
