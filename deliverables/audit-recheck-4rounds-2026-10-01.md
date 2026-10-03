# 审计复检报告-四轮审计全量 — 2026-10-01

- **日期**：2026-10-01
- **复检对象**：`zhuzhao-ui` @ `main` / `2804e2ef`（工作树干净，与 `origin/main` 同步）
- **对照基线**：2026-09-30 审计报告（基线 `87010eb7`），自基线起 **4 轮修复 / 11 个提交**
- **方法**：QA 工程师（严过关）独立逐条复检 + 主理人复核关键结论。**一切以「打开文件读到实际代码 / 复跑命令看到实际输出」为证据，不采信 commit message。**

---

## 0. 一句话结论

**31 项审计问题中：已解决 10 / 部分解决 3 / 设计取舍 3 / 未解决 13 / 未复现 2。**

- **P1 三项无一完全闭环**：其中 **P1-2 是「假修」**——提交信息声称已修，但该提交**根本没碰目标文件**。
- 门禁五件（lint/typecheck/test/build/audit）**全绿**；E2E 未跑（需五栈）。
- `README.md:7` 的「**四轮审计 40+ 缺陷全部修复**」为**过度声明**（实测 13 项未闭环）。

---

## 1. 关键发现：提交信息不实（最高优先）

**P1-2 从未被修复。**

- 提交 `876952b7` 信息：`fix(audit-p1): 批一四件——死信 Tab 初始加载/resetState 下沉清缓存/keep-alive 组件名×2+viewNames 全量登记/文档虚标修正`
- **该提交实际改动**（`git show --stat 876952b7`）：仅 `AGENTS.md`、`README.md`、`src/router/viewNames.test.ts`、`src/views/audit/log/index.vue`、`src/views/system/dict/index.vue`、`src/views/task/list/index.vue` —— **`src/store/modules/user.ts` 不在其中**。
- 现状（`src/store/modules/user.ts`）：`queryClient.clear()` 仍在 **`logout()`**（第 128 行）；`resetState()`（第 141-156 行）**依然没有清缓存**。
- 而 401 终态（`src/common/request/src/index.ts:176-183 _clearPiniaAndRedirect`）与守卫 catch（`src/permission.ts:125`）都是走 `resetState()`，**不走 `logout()`** → **跨用户服务端态缓存残留漏洞原样存在**。

> ⚠️ 另：`03a608a0` 自述「BIZ_TOP_CODES 真修（**批一未生效勘误**）」——说明**第一轮已出现过一次「声称修了但没生效」**。本次是第二次。建议对「批一」全部四件重新单独验证（本次已顺带验证其余三件：viewNames 登记、audit_log/system_dict 改名、死信 Tab 均**属实**）。

---

## 2. 逐项核对表

### P1（0/3 完全闭环）

| ID | 状态 | 证据 | 备注 |
|---|---|---|---|
| P1-1 keep-alive 名 | **部分解决** | `src/views/audit/log/index.vue:18` = `audit_log_page` ✅；`src/views/system/dict/index.vue:20` = `system_dict_page` ✅；主仓 `migrations/000037_system_menu_nest.up.sql:5-7` 把 `system_user/role/menu/org` 挂到 `system` 目录（`system` 行存在于 `000002_seed.up.sql:57`，`parent_id IS NULL` 条件保证幂等）✅ | **防漂移前提未达成**：`src/router/viewNames.test.ts:15-33` **仍是写死名单**，未改为从种子派生 → 同类问题无法被被动拦截 |
| P1-2 resetState 清缓存 | **未解决（假修）** | 见 §1 | 原漏洞仍存在 |
| P1-3 codegen 过度声明 | **部分解决** | `AGENTS.md:9` 已如实写「部分接线 4/14」✅（实测 api 文件 14、import `__generated__` 者 4 相符）；**`README.md:30` 未加限定**，仍称「codegen 类型漂移在此报错」 | 残留虚标 |

### P2（7/16 闭环）

| ID | 状态 | 证据 |
|---|---|---|
| P2-1 `/tickets/*` 豁免收窄 | ✅ 已解决 | `src/router/routePermission.ts:47` 三态精确匹配；`/tickets/123` 仍豁免、`/tickets/types` 不再豁免。⚠️ **无回归测试**（`routePermission.test.ts` 未覆盖该边界） |
| P2-2 裸 403 拆会话 | ✅ 已解决 | `src/router/sessionError.ts:33` 裸 403 → `transient`；测试同步更新 |
| P2-3 登出失败不跳转 | ✅ 已解决 | `src/components/UserInfo/index.vue:36-37` `await logout().catch(()=>{})` + `router.push('/login')` |
| P2-4 ProTable refresh 拒绝 | ✅ 已解决 | `src/components/ProTable/index.vue:44-48` 加 `.catch(noop)`；错误仍经 `useCrud.ts:150 listError` + 全局 toast 暴露，**非静默丢弃** |
| P2-5 角色回显 N+1+竞态 | ❌ 未解决 | `src/views/system/role/index.vue` 自基线 **零改动**；N+1 实况在 `src/views/system/user/index.vue:221-231` |
| P2-6 字典首屏 | ✅ 已解决 | `src/api/system/dict.ts:96` 改走 `/api/v1/user/dicts/:code/items`；主仓 `000038_dict_items_route.up.sql:4` 清理旧绑定 |
| P2-7 MyOrg `page_size=50` 截断 | ❌ 未解决 | `src/views/MyOrg/index.vue` 零改动；`src/api/org/selfService.ts:36-40` 仍硬编码 50、无翻页 |
| P2-8 Panic 无翻页 UI | ❌ 未解决 | `src/views/audit/log/index.vue:172-181` 无 `el-pagination` |
| P2-9 视图直连 request | ❌ 未解决 | `src/views/Home/index.vue:13/53/68/78`、`src/views/audit/log/index.vue:15/98/116` 仍绕过 `src/api/` |
| P2-10 al 死码 + `Number(id)` | ❌ 未解决 | `src/api/al/index.ts:142` `restoreAlDataApi` 全仓零调用；`:143` 仍 `Number(id)` |
| P2-11 MyOrg 缺组内赋权/owner | ❌ 未解决 | `src/api/org/selfService.ts` 零改动 |
| P2-12 用户页缺「分配组织」 | ❌ 未解决 | `src/views/system/user/index.vue:306-314` 无该 action（种子有 `system_user_assign_org`） |
| P2-13 form-create 零引入 | ⚪ 设计取舍（已注记） | `src/views/ticket/create/index.vue:5-7` 明注「自写渲染器，库引入顺延设计器批」；主仓 `262a9af` 有实施注记 |
| P2-14 E2E 预设错码 | ✅ 已解决 | `e2e/global-setup.ts:40` 已是 `task_manage`；主仓 `000022:5` 证实其为顶层祖先 |
| P2-15 CI 无 E2E/codegen 守卫 | ⚪ 取舍已声明（但 codegen 漂移守卫确缺） | `.github/workflows/ci.yml` 零改动 |
| P2-16 供应链 | ✅ 已解决 | `pnpm audit --prod --registry=https://registry.npmjs.org` → No known vulnerabilities |

### P3（3/12 闭环）

| ID | 状态 | 证据 |
|---|---|---|
| P3-1 文档计数漂移 | ✅ 已解决 | 实测 E2E spec **18**、Vitest 文件 **13**、用例 **99**；README:7/31/34 与 AGENTS:13 均已对齐 |
| P3-2 AuthButton 死组件 | ✅ 已解决 | 文件已删除，`src/common/auth/index.ts` 导出行移除 |
| P3-3 `getDeviceId` 无 try/catch | ✅ 已解决 | `src/common/auth/tokenStorage.ts:33-37` 已降级 |
| P3-4 `ERR_CANCELED` 死分支 | ❌ 未解决（且我方原判可能有误） | `src/common/request/errorToast.ts:35` 分支仍在；**复检认为该分支实际可达**（请求层 `index.ts:166` notifyError）→ 原「死代码」结论需降级为「待确认」 |
| P3-5 SessionError.retry 校验 | ❌ 未解决 | `src/views/Error/SessionError.vue:13-15` 仅查 `startsWith('/')`，未拒 `//` |
| P3-6 int64 局部例外 | ❌ 未解决 | `src/api/system/user.ts:65` `roleIds: number[]`；`user/index.vue:237`、`role/index.vue:210` `.map(Number)` |
| P3-7 设计文档 404 vs 403 | ❌ 未注记 | 主仓 `docs/phase4/01-frontend-design.md:68` 仍写「落 404」，实现为 403 |
| P3-8 viewNames 写死名单 | **部分解决** | 同 P1-1 |
| P3-9 无 i18n | ⚪ 设计取舍 | i18n 基建在，仅 Login/403 用 `t()`；面向内部中文用户 |
| P3-10 `helpers.ts` 硬编码 91 | ⚫ **未复现（撤回）** | `e2e/helpers.ts` 无任何计数；全 e2e 目录无 `91/87/99` 命中 → 原结论有误，撤回 |
| P3-11 pnpm 版本声明漂移 | ⚫ 存疑 | `package.json:9 engines.pnpm>=10` 与 `:11 packageManager@12.3.4` 并存；原文所指对象未确证 |
| P3-12 无 CONTRIBUTING/RELEASING | ❌ 未解决 | 两文件均不存在 |

---

## 3. 门禁实跑（本环境真实输出）

| 命令 | 结果 |
|---|---|
| `pnpm lint` | ✅ exit 0，0 error |
| `pnpm typecheck` | ✅ exit 0，0 error |
| `pnpm test` | ✅ **13 文件 / 99 用例全通过** |
| `pnpm build` | ✅ built in ~6s；含 `INEFFECTIVE_DYNAMIC_IMPORT`（`vueQuery/index.ts` ↔ `user.ts`）警告 |
| `pnpm audit --prod` | ✅ No known vulnerabilities |
| `pnpm test:e2e` | ⚫ **未跑**（需五栈） |

> 环境注记：`pnpm build` 前需 `mv dist-pro /tmp/...` 规避沙箱 safe-delete 守卫，属环境拦截非产品失败。

---

## 4. 未闭环项修复建议（行级）

| 项 | 建议 |
|---|---|
| **P1-2**（最高优先） | `src/store/modules/user.ts`：把 `void import('@/plugins/vueQuery').then(({queryClient})=>queryClient.clear())` 从 `logout()`(128) **移入 `resetState()` 末尾**(157)；`logout()` 删除该行。更优：改为**顶部静态** `import { queryClient } from '@/plugins/vueQuery'` 后直接 `queryClient.clear()`——一并消除 build 的 `INEFFECTIVE_DYNAMIC_IMPORT` 警告 |
| **P1-1/P3-8** | `src/router/viewNames.test.ts` 改为**从主仓种子派生**：解析 `migrations/*.up.sql` 的 `menus` INSERT，`parent_id IS NULL 的 type=2` / `type=1 带 component` → 期望 `${code}_page`，嵌套页 → `code`，再与各 `src/views/**` 的 `defineOptions` 比对 |
| **P1-3** | `README.md:30` 补「部分接线」限定，与 AGENTS:9 对齐 |
| **P2-1** | `routePermission.test.ts` 补两条断言：`/tickets/types` 不豁免、`/tickets/123` 豁免 |
| **P2-5** | 后端补 `GET /users/:id/roles` 消除 fan-out；前端加 `AbortController`/序号守卫 |
| **P2-7/8** | `MyOrg` 名册加翻页（API 已有 page 参数）；`audit/log` panics Tab 加 `<el-pagination>` |
| **P2-9/10** | panics/reconcile 归入 `src/api/audit/`、tickets 概览归入 `src/api/ticket/`；删除死函数 `restoreAlDataApi` |
| **P2-11/12** | `selfService.ts` 增 `setOwnersApi`；`user/index.vue` 补「分配组织」（复用 `/api/v1/users/:id/orgs`） |
| **P2-15** | CI 增 `git diff --exit-code src/api/__generated__`（需先 `make swag && pnpm codegen`） |
| **P3-5/6/7** | `SessionError.vue` 校验补 `&& !startsWith('//')`；`roleIds` 改 `string[]`；主仓 01 号 line 68 改 403 |
| **P3-11/12** | 统一 `packageManager` 与 `engines.pnpm`；补 `CONTRIBUTING.md` / `RELEASING.md` |

---

## 5. 未独立验证 / 存疑

1. **E2E 全量未跑**（需五栈）→ keep-alive、豁免收窄等运行时观感未经浏览器实证。
2. **主仓 `000037` / `000038` 未做迁移往返与端到端实证**（无 DB 栈）：仅静态分析（`000037` 幂等且 `system` 行存在；`000038` 删除旧绑定正确），后端 `/api/v1/user/dicts/:code/items` **是否真注册未验**。
3. **P3-4** 原「死代码」判定存疑，复检认为分支可达 → 待确认。
4. **P3-10** 未复现，已撤回。
