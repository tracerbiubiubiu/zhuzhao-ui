/**
 * CronBuilder 预设 → robfig/cron 五段表达式纯函数（S4 B4-2——04 号附录 A.3）。
 *
 * 五段 = `分 时 日 月 周`（对齐 taskrunner NewParser(Minute|Hour|Dom|Month|Dow)
 * ——无秒字段；六段带秒输入必须被判非法）。双向：presetToSpec 生成 /
 * specToPreset 反解析（可识别时回显预设，不可识别保持专家态不强行归一）。
 * 纯函数零依赖——vitest 直测承重（每种预设生成/反解析/非法值）。
 */

export type PresetKind = 'daily' | 'weekly' | 'hourly' | 'monthly'

export interface PresetConfig {
  kind: PresetKind
  /** 每天/每周/每月：HH:mm 的时与分；每小时：间隔小时数 N（1–23） */
  hour?: number
  minute?: number
  /** weekly：周几 0–6（0=周日）；monthly：几号 1–31 */
  day?: number
}

const pad2 = (n: number) => String(n)  // cron 段惯例单数字（robfig 解析 9 与 09 等价——生成侧取无前导零形态）

/** 配置合法性预检（返回错误文案；空=合法）——五段非法值前端第一道检 */
export function validatePreset(p: PresetConfig): string {
  const m = p.minute ?? 0
  if (!Number.isInteger(m) || m < 0 || m > 59) return '分钟须为 0–59'
  switch (p.kind) {
    case 'daily':
    case 'weekly':
    case 'monthly':
      if (!Number.isInteger(p.hour) || p.hour! < 0 || p.hour! > 23) return '小时须为 0–23'
      break
    case 'hourly':
      if (!Number.isInteger(p.hour) || p.hour! < 1 || p.hour! > 23) return '间隔小时须为 1–23'
      break
  }
  if (p.kind === 'weekly' && (!Number.isInteger(p.day) || p.day! < 0 || p.day! > 6)) return '星期须为 0–6（0=周日）'
  if (p.kind === 'monthly' && (!Number.isInteger(p.day) || p.day! < 1 || p.day! > 31)) return '日期须为 1–31'
  return ''
}

/** 预设 → 五段表达式 */
export function presetToSpec(p: PresetConfig): string {
  const m = pad2(p.minute ?? 0)
  switch (p.kind) {
    case 'daily':
      return `${m} ${pad2(p.hour!)} * * *`
    case 'weekly':
      return `${m} ${pad2(p.hour!)} * * ${p.day}`
    case 'hourly':
      // 每 N 小时：第 0 分起整点间隔
      return `0 */${p.hour} * * *`
    case 'monthly':
      return `${m} ${pad2(p.hour!)} ${p.day} * *`
  }
}

/** 专家表达式五段合法性（粗检——taskrunner ParseSpec 兜底 400） */
export function validateSpec(spec: string): string {
  const t = spec.trim()
  if (!t) return '表达式不能为空'
  const parts = t.split(/\s+/)
  if (parts.length === 6) return '须为五段表达式（分 时 日 月 周）——不支持秒字段'
  if (parts.length !== 5) return `须为五段表达式，当前 ${parts.length} 段`
  const [mi, h, dom, mon, dow] = parts
  if (!/^[0-9*,/\-]+$/.test(mi) || !/^[0-9*,/\-]+$/.test(h) || !/^[0-9*,/\-]+$/.test(dom) || !/^[0-9*,/\-]+$/.test(mon) || !/^[0-9*,/\-]+$/.test(dow)) {
    return '含非法字符（仅数字 * , / -）'
  }
  return ''
}

/** 表达式 → 预设（可识别时；不可识别返回 null=保持专家态） */
export function specToPreset(spec: string): PresetConfig | null {
  const parts = spec.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [mi, h, dom, , dow] = parts
  if (!/^\d{1,2}$/.test(mi)) return null
  const minute = Number(mi)
  if (minute > 59) return null
  // 步进小时（*/N）优先于 daily 判定（h 为步进形态非纯数字）
  if (dom === '*' && dow === '*' && h.startsWith('*/')) {
    const n = Number(h.slice(2))
    if (mi === '0' && n >= 1 && n <= 23) return { kind: 'hourly', hour: n }
    return null
  }
  if (!/^\d{1,2}$/.test(h)) return null
  const hour = Number(h)
  if (hour > 23) return null
  if (dom === '*' && dow === '*') return { kind: 'daily', hour, minute }
  if (dom === '*' && /^\d$/.test(dow)) {
    const d = Number(dow)
    if (d <= 6) return { kind: 'weekly', hour, minute, day: d }
    return null
  }
  if (dow === '*' && /^\d{1,2}$/.test(dom)) {
    const d = Number(dom)
    if (d >= 1 && d <= 31) return { kind: 'monthly', hour, minute, day: d }
  }
  return null
}

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
