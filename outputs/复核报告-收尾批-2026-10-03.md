# 复核报告-收尾批-2026-10-03

> 复核对象：`e6cd0316..a36f835a`（8 提交 / 26 文件 / +742 −67）
> 复核方式：独立实证（读源码 + 跑门禁 + 实跑 codegen 验零 diff + vue-router 路由探针），**不以提交信息/注释为证据**。
> 复核者：独立复核（无提交作者参与）。

## 一、门禁实测结果（本机独立复跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Lint | `npx eslint .` | ✅ 0 error / 0 warn |
| 类型 | `npx vue-tsc --noEmit --skipLibCheck` | ✅ 0 error |
| 单测 | `npx vitest run` | ✅ **13 文件 / 105 用例全过** |
| 构建 | `npx vite build --mode pro` | ✅ ✓ built in 4.87s |
| codegen 零 diff | `bash scripts/codegen.sh` → `diff` | ✅ **ZERO_DIFF**（生成物 = 当前主仓 swagger 真实产物） |
| CI | `gh run list` | ✅ 最近 8 次 run 全 `success`，含 merge `a36f835a`（run 37047650804，40s） |

⚠ **诚实标注**：`pnpm build` = `vite build --mode pro`（本机复跑同口径）；**CI 不含 E2E**（`.github/workflows/ci.yml` 注释明示「E2E 打标准三栈…本地人工执行」）。故提交信息所称「E2E 20/20」属**本地声明**，本次**未独立复跑**（需 dev PG/Redis + app@33333 五栈）。

## 二、逐项正确性核验（file:line 证据）

### 快赢批（474f6552）
| 项 | 判定 | 证据 |
|---|---|---|
| P3-5 安全回跳 | ✅ 真修 | `src/router/sessionError.ts:41-43` `isSafeRedirect`：`typeof===string && startsWith('/') && !startsWith('//')`；单测 7 例（含 `//evil.com`/`///`/绝对 URL/数组）全过 |
| P3-6 ID 数组 string | ✅ 真修 | `api/system/user.ts:66` `roleIds: string[]`；`api/system/role.ts:58` `menuIds: string[]`；调用方 `views/system/user/index.vue:236` string 直传、`views/system/role/index.vue:210` `keys.map(String)` |
| P3-9 改密回跳 | ✅ 真修 | `views/ChangePassword/index.vue:15,62` 复用 `isSafeRedirect` 校验 `route.query.redirect`，无 redirect 落 `/` |
| P3-11 版本对齐 | ✅ 真修 | `package.json` `engines.pnpm` `>=12.0.0` ↔ `packageManager: pnpm@12.3.4` 自洽；`.nvmrc`=20.19.0 ↔ `engines.node >=20.19.0` |

### 用户价值批（811c5acd）
| 项 | 判定 | 证据 |
|---|---|---|
| P2-12 分配组织 | ✅ 真实现 | `views/system/user/index.vue:400` 按钮 `v-permission="'user:assign_org'"`（非注释）；`:245-330` 树勾选+主组织+整体替换；API `api/system/user.ts:82,96` |
| — 权限码正确性 | ✅ | 主仓种子 `migrations/000002_seed.up.sql:73` `('system_user_assign_org', '分配组织', 'user:assign_org')`；`000031:56,113` 绑 `/api/v1/users/orgs` |
| — 端点存在性 | ✅ | 主仓 `internal/router/router.go:238 POST /users/orgs`、`:239 GET /users/:id/orgs` |
| P2-11 MyOrg 负责人 | ✅ 真实现 | `views/MyOrg/index.vue:142` `setOwnersApi` 全量 owner 预取（pageSize 100 上限守卫 `:134-137`）；`api/org/selfService.ts:69`；后端 `router.go:219 POST /orgs/owners` |
| — 字段正确性 | ✅ | `model/org_request.go:132` `MyOrgItem.OrgMemberRole json:"org_member_role"`；`:108` `OrgMemberRosterItem.OrgMemberRole` |
| P2-7 名册翻页 | ✅ 真翻页 | `views/MyOrg/index.vue:54-60` 传 page/pageSize；后端 `service/org_service.go:292,305` 真分页 + `_response` 带 `Total/Page/PageSize`；`repository/user_repo.go:686` pageSize 硬顶 100（与前端守卫一致） |

### 卫生批（91fb5b29）
| 项 | 判定 | 证据 |
|---|---|---|
| P2-9 视图直连归 API | ✅ 彻底 | `views/` 全域 grep `@vea/request`/`request.(get/post…)` **零命中**；`Home/index.vue` 改用 `listTicketsApi`（`api/ticket/index.ts:39`）；audit 页改用 `listPanicsApi`/`reconcileAuditApi`（`api/audit/index.ts:41-67`） |
| P2-8 panic 翻页 | ✅ 真加 | `views/audit/log/index.vue` panic Tab 增 `<el-pagination>`，`@current-change → fetchPanics(p)`；后端 `router.go:282 GET /audit/panics` |
| P2-10 al 死码删除 | ✅ | `api/al/index.ts` 删 `restoreAlDataApi`（含 `Number(id)` 死码） |

### 收尾批（50c63c07）
| 项 | 判定 | 证据 |
|---|---|---|
| P2-5 角色回显新端点 | ✅ 真接线 | `api/system/user.ts:90` `getUserRoleIdsApi` → `GET /users/:id/roles`；`views/system/user/index.vue:227` 用它替代原 N+1；竞态守卫 `rolesCheckSeq`（`:216,231,234`）；后端 `handler/user_handler.go:265 response.OK(gin.H{"role_ids": roleIDs})`；迁移 `000039_user_roles_route.up.sql` 挂 `system_user` 页面行 |
| P3-4 定性闭账 | ✅ 合理 | `common/request/errorToast.ts:35` `ERR_CANCELED` 分支定性「可达非死码」——复检已推翻「死分支」结论，注记与之一致 |
| P3-12 两份骨架 | ✅ 内容真实 | `CONTRIBUTING.md`/`RELEASING.md` 引用路径**全部存在**：`.nvmrc`、`deployments/{Dockerfile,README.md,nginx.conf.template}`（已 ls 核实）；未出现悬空引用 |
| schema.d.ts 重新生成 | ✅ 真生成 | 本批 `+234` 含 `/api/v1/auth/captcha`、`/api/v1/notifications` 等**上游新端点**（非手改可为之）；4 个相关端点全在；实跑 codegen 零 diff |

## 三、独立推翻的「疑似缺陷」（经实证非缺陷）

1. **`openOrgs` 中 `setCheckedKeys` 早于树数据灌入** → 疑似首次打开回显失效/勾选丢数据。
   - **实证推翻**：element-plus `tree-store.mjs:216-223` `setCheckedKeys` 先存 `defaultCheckedKeys`；`:58-64` `setData()` 之后调 `_initDefaultCheckedNodes()`（`:90-97`）按 `defaultCheckedKeys` 回补勾选 → 先 set 后灌数据**仍生效**。
2. **`/tickets/types` 被静态 `/tickets/:id` 吞掉（P2-1）** → 疑似菜单页渲染成详情壳。
   - **实证推翻**：vue-router **5.3.1** 探针（静态 `/tickets/:id` + 后 `addRoute('/tickets/types')`）实测：
     ```
     /tickets/new   => TicketCreate
     /tickets/types => ticket_type_manage_page   ← 未被吞
     /tickets/123   => TicketDetail (id=123)
     ```
     配合 `permission.ts:106` 按 `path` 重导航，守卫侧亦无残留。

## 四、遗留（**测试覆盖缺口**，非缺陷）

1. **无 `/tickets/types` 动态注册回归测试**：`router/routing.test.ts` 仅覆盖 `/tickets/new` 与 `/tickets/123`，未覆盖「动态 addRoute 后 `/tickets/types` 压过 `/tickets/:id`」——建议补一例固化（探针已验证行为正确，缺的是防漂移断言）。
2. **「分配组织」E2E 未覆盖「已有绑定回显」路径**：`e2e/s3-user-admin.spec.ts` 新增用例为「空绑定 → 勾选 → 保存 → API 断言」，未断言打开已绑用户对话框时复选框预勾选（源码分析已证安全，缺测试）。
3. **P2-11 超 100 人组织自助设负责人被禁用**：属**有记录的降级**（注释 `api/org/selfService.ts:65-67` + 视图提示），依赖后端补 owners 读端点后放开——非本批缺陷。
4. `no-console` 仍 warn（不阻断 CI）；`request↔user store` 动态 import 警告（`user.ts` 对 `@vea/request`，历史存在，非本批回归）。

## 五、结论

**收尾批修复正确，可判「真修」**。四批 12 项逐项经 file:line + 主仓契约对账 + 门禁实证确认；两处「疑似缺陷」经独立实证推翻；codegen 零 diff 与 CI 全绿构成强证据。**未独立核实项仅 E2E**（本地声明，CI 不覆盖）。遗留均为测试覆盖缺口与有记录的降级，无功能性缺陷。
