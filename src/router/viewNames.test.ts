/**
 * 视图组件名 ↔ 动态路由名 防漂移测试（keep-alive 契约）
 *
 * AppView 的 `<keep-alive :include="cachedViews">` 按**组件名**匹配，而 tagsView 存的是
 * **路由名**（= 菜单 code，顶层页面特例为 `${code}_page`）。视图全是 index.vue（推断名恒
 * "index"），必须 defineOptions 声明与路由名一致的组件名，否则 keep-alive 整体空转
 * （历史缺陷：全部页面无缓存、refreshTag 清缓存为空操作）。
 *
 * 名单与主仓菜单种子对齐（000002/000031）；W3/W4/W5 新增页面时在此同步登记。
 */
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/** [视图文件, 期望组件名（=该页最深匹配路由名）] */
const VIEW_NAMES: Array<[string, string]> = [
  ['views/Home/index.vue', 'home_page'], // §3.2③：type=1 带 component 特例，渲染子路由 `${code}_page`
  ['views/system/user/index.vue', 'system_user'],
  ['views/system/role/index.vue', 'system_role'],
  ['views/system/menu/index.vue', 'system_menu'],
  ['views/system/org/index.vue', 'system_org'],
  ['views/Profile/index.vue', 'Profile'], // §3.2④ 静态补充路由（常量路由实名）
  ['views/MyOrg/index.vue', 'MyOrg'], // §3.2④ 同款
  ['views/ticket/detail/index.vue', 'TicketDetail'], // §3.2④ 参数路由（详情）
]

test.each(VIEW_NAMES)('%s 声明了与路由名一致的 defineOptions name（%s）', (file, expected) => {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8')
  // ^\s* 行首锚定（m 标志）：注释行 `// defineOptions(...)` 不得假绿（检视 P3）
  expect(source).toMatch(new RegExp(`^\\s*defineOptions\\(\\{\\s*name:\\s*'${expected}'`, 'm'))
})
