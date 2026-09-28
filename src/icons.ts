import accountGroup from '@iconify-icons/mdi/account-group'
import account from '@iconify-icons/mdi/account'
import accountMultiple from '@iconify-icons/mdi/account-multiple'
import cart from '@iconify-icons/mdi/cart'
import check from '@iconify-icons/mdi/check'
import chevronDoubleLeft from '@iconify-icons/mdi/chevron-double-left'
import chevronDoubleRight from '@iconify-icons/mdi/chevron-double-right'
import clipboardList from '@iconify-icons/mdi/clipboard-list'
import close from '@iconify-icons/mdi/close'
import cog from '@iconify-icons/mdi/cog'
import currencyCny from '@iconify-icons/mdi/currency-cny'
import dotsHorizontal from '@iconify-icons/mdi/dots-horizontal'
import fileDocumentOutline from '@iconify-icons/mdi/file-document-outline'
import fileTree from '@iconify-icons/mdi/file-tree'
import folderOpenOutline from '@iconify-icons/mdi/folder-open-outline'
import folderOutline from '@iconify-icons/mdi/folder-outline'
import formatListBulleted from '@iconify-icons/mdi/format-list-bulleted'
import helpCircle from '@iconify-icons/mdi/help-circle'
import home from '@iconify-icons/mdi/home'
import menu from '@iconify-icons/mdi/menu'
import menuOpen from '@iconify-icons/mdi/menu-open'
import playlistCheck from '@iconify-icons/mdi/playlist-check'
import shieldAccount from '@iconify-icons/mdi/shield-account'
import sitemapOutline from '@iconify-icons/mdi/sitemap-outline'
import table from '@iconify-icons/mdi/table'
import ticketOutline from '@iconify-icons/mdi/ticket-outline'
import tune from '@iconify-icons/mdi/tune'
import messageText from '@iconify-icons/mdi/message-text'
import minus from '@iconify-icons/mdi/minus'
import pageFirst from '@iconify-icons/mdi/page-first'
import pageLast from '@iconify-icons/mdi/page-last'
import reload from '@iconify-icons/mdi/reload'
import sync from '@iconify-icons/mdi/sync'
import tagOutline from '@iconify-icons/mdi/tag-outline'
import translate from '@iconify-icons/mdi/translate'
import viewDashboard from '@iconify-icons/mdi/view-dashboard'
import viewQuiltOutline from '@iconify-icons/mdi/view-quilt-outline'
import type { IconRegistry } from '@vea/components'

export const icons = {
  'mdi:account-group': accountGroup,
  'mdi:account': account,
  'mdi:account-multiple': accountMultiple,
  'mdi:cart': cart,
  'mdi:check': check,
  'mdi:chevron-double-left': chevronDoubleLeft,
  'mdi:chevron-double-right': chevronDoubleRight,
  'mdi:clipboard-list': clipboardList,
  'mdi:close': close,
  'mdi:cog': cog,
  'mdi:currency-cny': currencyCny,
  'mdi:dots-horizontal': dotsHorizontal,
  'mdi:file-document-outline': fileDocumentOutline,
  'mdi:file-tree': fileTree,
  'mdi:folder-open-outline': folderOpenOutline,
  'mdi:folder-outline': folderOutline,
  'mdi:format-list-bulleted': formatListBulleted,
  'mdi:help-circle': helpCircle,
  'mdi:home': home,
  'mdi:menu': menu,
  'mdi:menu-open': menuOpen,
  'mdi:message-text': messageText,
  'mdi:minus': minus,
  'mdi:page-first': pageFirst,
  'mdi:page-last': pageLast,
  'mdi:playlist-check': playlistCheck,
  'mdi:reload': reload,
  'mdi:shield-account': shieldAccount,
  'mdi:sitemap-outline': sitemapOutline,
  'mdi:sync': sync,
  'mdi:table': table,
  'mdi:tag-outline': tagOutline,
  'mdi:ticket-outline': ticketOutline,
  'mdi:tune': tune,
  'mdi:translate': translate,
  'mdi:view-dashboard': viewDashboard,
  'mdi:view-quilt-outline': viewQuiltOutline
} satisfies IconRegistry

/**
 * 菜单 icon 种子值 → 注册名映射表（01 §1：「icon 列种子值建集中映射表解析」）
 *
 * 键值照抄主仓菜单种子（000002/000010/000018/000022/000024/000025——勿「纠正」拼写：
 * ⚠ settings（system 目录）与 setting（ticket_type_manage）近似键并存系种子实况）。
 * 后端新增菜单种子时在此登记，漏登记会触发 resolveMenuIcon 的 warn-once 提示。
 */
export const MENU_ICON_MAP: Readonly<Record<string, string>> = {
  // 000002 system 域
  home: 'mdi:home',
  settings: 'mdi:cog',
  user: 'mdi:account',
  role: 'mdi:shield-account',
  menu: 'mdi:file-tree',
  org: 'mdi:sitemap-outline',
  // 000010 ticket 域
  ticket: 'mdi:ticket-outline',
  'ticket-list': 'mdi:format-list-bulleted',
  // 000018 ticket 类型配置（⚠ 近似键 setting 与 settings 并存——照抄种子）
  setting: 'mdi:tune',
  // 000022 task 域
  task: 'mdi:clipboard-list',
  'task-list': 'mdi:playlist-check',
  // 000024 al 域
  al: 'mdi:account-multiple',
  'al-data': 'mdi:table',
  'al-types': 'mdi:tag-outline',
  // 000025 audit 域
  'audit-log': 'mdi:file-document-outline',
}

const warnedMenuIcons = new Set<string>()

/**
 * 种子 icon 值解析：裸名（种子形态）查映射表；已 namespaced（mdi:*）与未知值直通
 * （未知仅 warn 一次——离线 iconify 对未注册名零渲染，静默漏映射极难发现）。
 */
export function resolveMenuIcon(name: string): string {
  if (!name) return ''
  if (name.includes(':')) return name
  const mapped = MENU_ICON_MAP[name]
  if (mapped) return mapped
  if (!warnedMenuIcons.has(name)) {
    warnedMenuIcons.add(name)
    console.warn(`[icons] 菜单 icon 未映射: "${name}"（查主仓菜单种子并在 MENU_ICON_MAP 登记）`)
  }
  return name
}
