# Phase 4 实现整理 — W2–W5 四波+穿插池全貌与审计清账终态

- **日期**：2026-10-03
- **基线**：`zhuzhao-ui` @ `main` / `c534889e`（工作树干净，与 `origin/main` 同步）
- **性质**：实现视角的时点整理（**是什么/有什么/怎么验**）；审计问题链视角见 [audit-recheck-4rounds-2026-10-01.md](./audit-recheck-4rounds-2026-10-01.md)（31 项台账 SSOT），设计依据见主仓 `docs/phase4/01–03` 号
- **方法**：数字均为本日实测（`pnpm test` / `grep` 逐 spec 计数 / 目录清点），非转抄

---

## 总览

Phase 4（前端控制台单仓单 SPA）**完成定义已达成**：2026-09-29 收官、四轮审计后 2026-09-30 终态、2026-10-01→10-03 六批复核清账至 31 项全清。当前终态：

| 维度 | 实测值 |
|---|---|
| 六件门禁 | lint / typecheck / test / audit / build / test:e2e 全绿 |
| 单元测试 | 14 文件 / 108 用例（本日实跑全绿） |
| E2E | 19 spec / 21 用例，打真实栈（W5 场景五栈），不用 stub |
| 视图文件 | 23 个 `.vue`（五业务域 + 壳层/错误页） |
| API 层 | 14 个 ts 文件；codegen 类型接线 4/14（system/user、system/role、org/selfService、user） |
| 审计台账 | 31 项 = 27 解决 / 3 设计取舍 / 0 遗留 / 1 撤回 |

## 交付时间线（git 实录）

| 波次 | 交付内容（代表性提交） |
|---|---|
| **W2 壳层**（约 40 提交） | 底座种子拷入（vue-element-plus-admin v3，`.seed-commit` 锚点）拍平为单应用；**壳层四件**——TokenStorage（device_id UUID 持久化）/ 请求层（axios 拦截器链）/ 守卫六步 / 权限三件套（v-permission 指令+AuthButton+usePermission）；页面层（登录/改密/首页/system 占位）；ESLint+明暗主题；E2E 起建（S1/S2/FE3 打标准三栈）+ codegen 类型链 + CI 上线 |
| **W3 system 域** | Profile 个人中心（vue-query 接入+codegen 接线首例）→ 用户管理（ProTable 列表范例页）→ 角色管理（表单范例+AssignMenus check-strictly 勾选树）→ 菜单只读树+组织管理（树 CRUD/move/ticket_visibility）→ 「我的组织」自服务页收口 |
| **W4 ticket 域** | 工单列表+详情/发起路由骨架 → 发起页**动态字段渲染器（七类型）** → 工作台待办/已办卡 → 详情批（评论/备注/关联/流转动作）→ 类型配置三件套（类型/字段/模板） |
| **W5 三域** | al（types 注册/演进/废弃 + data cursor 分页/动态列/导入导出）→ task 中心四 Tab（运行记录/死信/任务定义/提交）→ audit 日志（三维过滤+载荷弹窗） |
| **P4-9 部署件** | nginx 静态容器 + `/api`·`/al/api` 精确反代 + SPA fallback + 缓存策略，冒烟经 nginx 全链绿 |
| **穿插池+加成** | P4-7 验证码插槽（后端 enabled 才渲染）、P4-3 字典管理页（左类型/右项）、P4-6 PAT 区块（Profile 明文一次弹窗+吊销）、P4-8 audit 三 Tab（日志/Panic 聚合/路由对账）；README 状态段口径=点名五件（通知/字典/导出/验证码/P2 小件）+加成（PAT/P4-8 四件套/cron 收归 B-1 根治） |
| **审计链**（09-30→10-03） | 四轮审计修复批（P1×4/P2×8/二至四轮+假绿断言加固）→ 10-01 复检基线（31 项台账）→ 补修批（P1-1/2/3+P3-8）→ 快赢批（P3-5/6/7/11）→ 用户价值批（P2-7/11/12）→ 卫生批（P2-8/9/10）→ 收尾批（P2-5+P3-4 定性+P3-12）→ 复核跟进五小批至 10-03 终极终态 |

## 架构分层

- **底座**：vue-element-plus-admin v3 种子拷入（degit 不 fork），`packages/{components,hooks,request,styles}` 内联为 `src/common/`，workspace 清零；TypeScript 5.7 strict
- **技术栈**：Vue 3 + Vite 8 ｜ Element Plus 2.14 ｜ Pinia 4（客户端态）+ vue-query（服务端态，W3 起）｜ Playwright 1.63
- **状态分界**：Pinia 仅持客户端态（`app/locale/permission/tagsView/user` 五模块，`src/store/modules/`）；服务端态全走 vue-query 缓存（`src/plugins/vueQuery`，登出/401 终态 `resetState` 清缓存防跨用户残留——审计 P1-2 修复点）
- **请求层**（`src/common/request/`）：Bearer + req-32hex RequestID ｜ 401 分码（20002 过期→单飞静默刷新；20003 无效→跳登录；5xx 不清会话）｜ 403+20007→跳改密页不清会话 ｜ 信封 `{code,message,data,request_id}` 按 HTTP 状态分流、data 直返
- **路由与守卫**（`src/router/` + `src/permission.ts`）：守卫六步（白名单→AT 检查→session 三件并行→强制改密→动态路由→catch-all 尾注册仅一次）；`routePermission` 参数路由三态精确匹配（`/tickets/:id` 豁免、`/tickets/types` 不豁免）；`sessionError` 裸 403 归 transient 可重试页
- **权限体系**（`src/common/auth/`）：权限码 `button:{permission}` + `route:{path}` 双命名空间；三件套消费（指令移除 DOM 防 DevTools 放显 / AuthButton 置灰+tooltip / usePermission 四函数）
- **keep-alive 防漂移**：`viewNames.test.ts` 从主仓种子 migrations **派生**期望组件名（`${code}_page`），与 `src/views/**` 的 `defineOptions` 比对——加页忘登记会挂测试
- **codegen**：主仓 `make swag` → `pnpm codegen`（swagger 2.0→3.0 + openapi-typescript）→ `src/api/__generated__/`（随仓提交不手改）；**部分接线 4/14**，漂移仅接线面编译期报错（AGENTS 口径）

## 页面与功能清单（23 视图文件）

| 域 | 页面 | 要点 |
|---|---|---|
| 壳层 | Login / ChangePassword / Home / Profile / Redirect | 工号登录+must_change_password 透传；改密成功 TokenPair 轮换；首页四状态卡+最近工单；Profile 含 PAT 凭据区块 |
| 自服务 | MyOrg | 名册（翻页）+owner 委托控件+只读降级 |
| system | user / role / menu / org / dict | 用户页含分配组织+角色回显（新端点去 N+1+竞态守卫）；角色页 AssignMenus 勾选树；菜单只读树；组织树 CRUD+乐观锁；字典左类型/右项+启停 |
| ticket | list / create / detail / type | 发起页自写动态字段渲染器（七类型+校验预检+组织双源，form-create 顺延——取舍注记）；详情评论/备注/关联/流转；type 三件套（类型/字段/模板） |
| task | list（四 Tab） | 运行记录（submitted_by=me）/死信（真分页+重试）/任务定义（CRUD+启停+手动触发）/提交（PII 提示） |
| al | types / data | 类型注册/演进/废弃/历史；数据页 cursor 分页+动态 schema 列+写入编辑+导入导出 |
| audit | log（三 Tab） | 日志三维过滤（工号/路径/时间）+载荷弹窗；Panic 聚合（真分页）；路由对账 |
| 错误 | 403 / 404 / SessionError | SessionError 可重试+回跳安全校验（拒 `//`） |

## 测试资产

- **单测 14 文件 / 108 用例**：请求层单飞刷新（17）/ errorToast / tokenStorage / 守卫与路由三件（routing / routePermission / sessionError）/ viewNames 种子派生防漂移 / permissionRoutes / user store / useCrud / useForm / icons 图标映射 / cursorPager / **epImports 全仓扫描闸**（EP 组件缺失导入+prefix-icon/suffix-icon 字符串闸，48 文件扫描——10-03 三处缺失导入修后固化，防同类第 9 处）
- **E2E 19 spec / 21 用例**（`e2e/`）：S1–S8 / S10 / S12 / S16 / FE3 / W4 冒烟 / W5 三域 / P4 穿插池（dict/pat/ops）；**打真实栈**（标准三栈起、W5 场景五栈），断言为真数据级；globalSetup 幂等建号可无限重放
- **防漂移设计**：种子派生类断言（viewNames/icons）让「后端种子改了前端没跟」直接挂测试；epImports 让「EP 组件忘了 import」挂测试

## 质量终态

- **审计链全部闭环**（2026-10-03）：四轮审计 31 项 → 27 解决 / 3 设计取舍 / 0 遗留 / 1 撤回；逐项台账见基线报告+`archive/` 八份跟进报告（发现→修复→复核确认全链）
- **CI**（`.github/workflows/ci.yml`）：lint/typecheck/build/test 四件；test job 已补主仓 checkout（viewNames 种子派生环境差——三连挂教训）；E2E 与 Go 仓 acceptance 同口径走本地人工验收
- **纪律闭环**：推送后 `gh run` 核实 CI 转绿才算交付闭环（README badge 钉 main）

## 设计取舍与已知边界（有意为之，非遗漏）

| 项 | 口径 |
|---|---|
| codegen 接线 4/14 | 出参类型全手写；改 API 形状先 `pnpm codegen`，补接线随域渐进（AGENTS typecheck 注） |
| form-create 未引入 | 发起页自写渲染器；库引入顺延设计器批（P2-13 注记） |
| i18n 英文面暂不启用 | 2026-10-02 拍板 zh-only，触发器=英文用户出现；`src/locales/` 为预留基建勿删（主仓 02 §5.4） |
| CI 不跑 E2E/codegen 漂移守卫 | E2E 走本地人工验收口径（P2-15 取舍） |
| ERR_CANCELED 分支保留 | 复核定性为可达路径（P3-4 闭账） |

## 文档索引

- 设计 SSOT：主仓 `zhuzhao/docs/phase4/01-frontend-design.md` / `02-implementation-plan.md` / `03-scenarios-and-tests.md`
- 审计台账：[audit-recheck-4rounds-2026-10-01.md](./audit-recheck-4rounds-2026-10-01.md)（基线）+ [archive/](./archive/)（八份跟进复核）
- 随仓操作文档：`README.md`（状态/门禁/E2E 运行前提）、`AGENTS.md`（协作协议/契约速查）
