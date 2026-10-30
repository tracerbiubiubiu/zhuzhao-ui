# 前端 UI 规范 — zhuzhao-ui 视口锁定/页面骨架/表格/滚动统一约定

> 2026-10-08 制定（源头批次：视口填充统一 `30901a13`→`e4cde864`、Backtop 回归 `b00a15b5`、紧凑封顶
> `6001ba06`、列宽 `c3fadc90`、四页补齐+全页视口锁定=本批）。**新增/改动任何页面前通读本文**；
> 与本文冲突的实现视为待整改项。

## 总原则（一条铁律）

**页面不动：所有页面锁定视口，一切滚动条都在内部元素上。** 浏览器窗口/外层布局永远不产生滚动；
滚动只发生在——列表页的表格内部、内容页的内容区容器、对话框/抽屉的框体内部。

## 页面骨架：三种形态

所有页面根节点都用 `fill-page`（全局类，`@vea/styles` index.less）——锁定视口高度的弹性列。
**根层四向 padding 已全局归零**（2026-10-14 用户反馈三连：上下贴边+左右收窄）——呼吸间距由
section 一层统一承担（`--app-content-padding` 24px），页面根不再叠第二层；框体纵向拉满
（贴底 copyright）、横向对称 24px。区别只在「哪个内部元素负责滚动」：

| 形态 | 判定 | 滚动元素 | 配方 |
|---|---|---|---|
| **列表页** | 主体是一张列表（含 tabs/双栏） | 表格内部（表头钉住）+ 分页钉底 | ProTable 传 `fill`；手动表=包裹层 `min-h-0 flex-initial` + el-table `height="100%"` |
| **内容页**（详情/发起/表单/工作台） | 主体是卡片堆/表单流 | 页面内容区容器 | 根 `fill-page`（可叠 `max-w-[N] mx-auto` 居中），内容包 `<div class="min-h-0 flex-1 overflow-y-auto">` |
| **复合页** | 列表+其他区块共存（如 MyOrg） | 列表区块内滚，其余区块自然高 | 主列表卡吃满剩余高度；次区块加 `!flex-none` |

骨架链：`ElScrollbar view（.v-scroll-view 定高）→ AppView section（.v-app-view flex-1，
overflow-y-auto 仅为兜底——正常页面不该用到它）→ 页面根 .fill-page → 内部滚动元素`。

- tabs 型列表页：`el-tabs` 加 `fill-tabs`（每签独立成填充链），签内工具条加 `flex-none`。
- 复合页不想拉伸的直接子卡片：加 `!flex-none`（important 压过全局 `.fill-page > .el-card`）。
- 对话框/抽屉内长内容：`max-h-[420px] overflow-auto` 或 el-scrollbar，高度值不强制统一。
- **横向同理**：表内横向滚动量在常用宽度（≥1024）应为 0（靠 `minWidth` 列吸收）；极窄屏溢出属
  兜底，且拉宽后必须自愈（useTableFit 保证）。横向滚动条对用户操作不友好，能不出现在不出现。

## 表格规范

### 列宽（横向填充）

- **内容型列（标题/名称/ID/描述等长文本）用 `minWidth`；枚举/数值/时间/操作列用固定 `width`**。
- EP 剩余宽度只分配给 `minWidth` 列——**全固定宽的表在宽屏下右侧露死区**（运行记录表曾 964px）。
- 新表自检：至少一列 `minWidth`；长文本列配 `show-overflow-tooltip`；固定右列保持 `width`。

### 分页

- **ProTable 页统一**：`[10, 20, 50, 100]`、默认 20（组件默认，勿页面覆盖）。
- **无 total 形态**：cursor 分页（al 数据）=「第 N 页/每页 N 条 + 上一页/下一页」；死信=固定 20 同款。
  不假装有 total、不做跳页。
- **面板型固定 20**（MyOrg 名册/审计 Panic 聚合）：后端硬顶/附属视图——精简 layout，不加 sizes。
- 页面不要自带 `el-pagination` 造第二套交互（上述面板型除外，理由写页头注释）。
- **列表计数徽标（2026-10-28 指标目录批）**：指标目录 P1 计数（任务定义级调用计数、
  AL 类型数据条数等——phase6/04 号附录 A）在列表页的呈现 = 计数徽标/后缀
  （左栏条目「N 字段 · M 条」、定义行状态点），后端一条聚合出全量避免 N+1；
  模块仪表盘为同源扩展消费方（统计 DSL 立项时收编词表）。

### 空态与加载

- 加载：`v-loading`（ProTable 内置）；空数据：EP 空态 / `el-empty`（操作按钮挂空态槽写法参考 al 数据页）。
- **空态引导三件全表格覆盖（2026-10-28 走查批补齐）**：管理型表空态挂新建 CTA
  （`v-permission` 门控——无权限者只留引导文案），`#empty` 槽写法参考
  ticket/type / ticket/rules / system/dict / system/notification 四页。
- **空态文案不含页内标题/Tab 名子串**（2026-10-28 p5-s6 实测）：`getByText`/
  `getByRole name` 均为子串匹配，「暂无消息模板」会与 Tab「消息模板」撞 strict——
  文案用短形态（暂无模板/暂无规则），域名信息放 description 之外的引导动词里。

## 筛选栏配方（2026-10-12 立，工单列表批实测配方）

各列表页筛选栏统一按此配方（工单列表 `ticket/list` 为参照实现）：

1. **布局**：`el-form inline` 转 `display:flex; flex-wrap:wrap`（原生 inline-flex 文本流下
   margin-left:auto 无效）；项距 16px（EP 默认 32px 过疏）；控件标准宽——关键字 160/
   下拉 110~120/日期区间 210；
2. **动作钉右**：查询/重置所在 form-item 加 `ml-auto !mr-0`，钉在末行右缘——尾行
   不再出现大片空尾；
3. **触发口径（2026-10-13 统一为全即时）**：下拉/开关/勾选/日期变更**即查**
   （`useAutoFilterRun` 深度 watch + 300ms 防抖回首页）；文本输入 300ms 防抖即查
   （逐键请求由防抖收敛）；**查询按钮移除、重置保留**（Grafana/Datadog 类分析台形态）；
   URL 预填在筛选态声明期完成——不经过 watch，杜绝与 immediate 首查的二次请求；
4. **URL 参数化入口**：列表页挂载时从 `route.query` 白名单键预填（status/assignee=me/
   keyword/type_code）——首页统计卡、外部链接跳转依赖此基础设施；
5. **非 admin 口径**：新增筛选不得产生非 admin 4xx/5xx（FE4 哨兵断言延续，白名单
   显式登记设计内探针）。
6. **游标分页页变体（2026-10-28 al/data 批沉淀）**：cursor 分页页筛选不走
   `useAutoFilterRun`——筛选变更**重置游标从头查**；文本 300ms 防抖+fetchSeq
   竞态守卫照旧；服务端 `q/field/value` 形态参照 al/data（activelist 同批端点）；
   切类型清空筛选。

### 筛选栏折叠（2026-10-30 立，FilterBar 组件）

控件多到一行放不下的页（工单列表 7 控件/任务 5+/审计 4+）：`FilterBar` 组件
（`@/components/FilterBar`）——默认只显示前 `visible`（默认 4，页可覆盖）个
控件，超阈值出现「展开/收起」切换；动作钮（重置/导出）`data-ignore` 标记
**收起态仍可见**。折叠经 JS 直控子元素 display（nth-child+calc 非标准且
lightningcss 拒绝编译——实证）。E2E 定位注意：form-item 已 div 化，按
placeholder/testid/控件文本定位，禁 `.el-form-item` 过滤。

### 筛选配方 v2 补则（2026-10-28 筛选规范收敛批）

7. **客户端过滤豁免清单（登记制）**：数据全量在内存且量级 ≤ 数百行 → 客户端
   keyword 过滤合法，不入服务端配方。在册页：al/types（类型清单）、
   ticket/type（类型清单）、system/dict（类型表）；**触发器**：行数持续 >100 或
   需服务端字段筛选（日期/枚举）时升服务端配方。
8. **控件细节四条**：①输入/下拉一律 `clearable`（日期区间默认即清空）；②占位
   文案两式——下拉「全部」、文本提示式（`如 E000001`/`查询值关键字`），不写
   「请输入」敬语前缀；③**placeholder 长度约束**（2026-10-29 统一形态批）——
   ≤8 中文字符且须与控件宽匹配（160px 容器放不下「如 E000001（含已删用户）」
   实测截断），附注信息（「含已删用户」类）挪 `title` 悬停或旁注小字；
   ④**日期范围筛选统一快捷段形态**（同批立）——`全部/近7天/近30天/自定义`
   radio 段 + 自定义按需弹 daterange（`--el-date-editor-width:210px` 窄形态），
   公共实现=`useDatePresetRange`（@vea/hooks——三页共用防三处漂移：intel 历史/
   audit/工单列表），禁常驻 daterange 占宽（审计/工单旧形态 2026-10-29 整改）。
9. **字典页等旧按钮式触发**：客户端过滤页禁「搜索」按钮——输入 300ms 防抖
   即时生效（与服务端配方同手感；2026-10-28 整改 system/dict）。

## 分页统一约定（2026-10-28 立，筛选规范收敛批同批）

四形态分级（前三既有口径收拢，第四新增判定）：

| 形态 | 适用 | 规范 |
|---|---|---|
| **ProTable 内置** | 服务端 offset 分页主列表 | `[10,20,50,100]` 默认 20，勿覆盖 |
| **cursor 翻页** | 无 total 端点（al 数据/死信） | 「第 N 页+上一页/下一页」，不跳页不假装 total |
| **独立 el-pagination 面板型** | 附属视图（名册/收件箱/发送记录/**客户端切片型**——AL 类型/工单类型/模板/情报历史） | 见下三条（客户端切片型带 sizes，2026-10-29 细分） |
| **全量内滚（新增判定）** | 固定小量级配置/清单 | 数据行 ≤50 且预期不增长 → 全量+`height=100%` 内滚合法；超阈值必须过滤或分页（ticket/type 48 行=临界案例，本批加客户端过滤） |

独立 el-pagination 面板型四规（MyOrg 名册为参照实现）：
1. **布局钉右**：`flex justify-end`（禁居中——notification 发送记录曾 text-center，
   2026-10-28 整改）；
2. **layout 至少 `total, prev, pager, next`**：有 total 必显 total（message/center、
   notification 发送记录本批补齐）——无 total 端点才可省；
3. **禁 `page_size=100` 伪装全量**：要么真分页、要么后端全量端点；存量 system/dict
   双表（`page:1, page_size:100`）登记豁免+页头注释（字典量级小，超 100 属异常
   场景可接受静默截断——假设写明才算登记，不算违规）。
4. **客户端切片型带 sizes（2026-10-29 细分）**：数据全量在内存的前端 slice 分页
   （AL 类型/工单类型/工单模板/情报历史分组）——`page-sizes=[20,50,100]` +
   `layout="total, sizes, prev, pager, next"`（大数据量翻找提速，切片零成本）；
   **后端硬顶附属型**（MyOrg 名册等 API 固定 page_size）维持精简不带 sizes。
   情报历史/类型页的 page size 切换重置回首页由 v-model:page-size 天然触发重算。

## 数据密度与聚焦模式（2026-10-29 立，长列表翻找批；2026-10-30 控件形态修正批）

大 page_size（50/100）下翻找疲劳的统一解——三件全部内置 ProTable（**密度/聚焦=
数据面工具组 Tools.vue：toolbar 槽行右端 > 无槽页并入筛选行右端——孤行禁设**
（审计页式两枚小钮独占一行已废，2026-10-30 三修定形），**新列表页零额外接线**，
禁止页面自建同义控件（一致性口子只留这一处实现）：

1. **切页回顶**：页码/每页条数变更与重查（`refresh({resetPage:true})`，即筛选/URL
   预填触发的新查询）后表格内滚自动回顶；写操作后的原位刷新**不**回顶（保滚动
   上下文）。历史缺陷：切页停留原滚动位、新页从半截看起——已收口，页面勿自行处理滚动。
2. **密度切换（舒适/紧凑）**：紧凑档行高 ~32px、可视行数 +40%；`localStorage
   (pro_table_density)` 记忆、全页共享；默认舒适=历史形态零漂移。普通 el-table
   面板型小表不带此键。钮=行距图标+**目标形态文案**（舒适态显「紧凑」），tooltip
   写动作全称（「切换为紧凑」）——状态语义详「展示与交互惯例」#8。
3. **聚焦模式**：整卡 `position:fixed; inset:12px` 满屏，盖过侧栏/顶栏/面包屑——
   内部 flex 高度链全为相对值自动撑满（零布局改动）；Esc/再点/路由离开
   （onDeactivated 显式复位）退出；`z-index:1000` 低于 EP 弹层 2000+，聚焦态
   内开弹窗/抽屉不受影响。挂接条件=表格有 `.el-card` 祖先（无则按钮不渲染）；
   chrome 层越多收益越大（任务中心四层头 ≈ 表格可视高度翻倍）。钮=方框图标
   （`mdi:fullscreen`，聚焦态切 `fullscreen-exit`）+tooltip「整卡满屏，Esc 退出」。

设计取舍（勿翻案前重议）：筛选栏**不做默认收起**（即时筛选可发现性优先，省一行
~40px 不值）；**不做虚拟滚动**（el-table-v2 换表成本与现有插槽/列宽规范全冲突）。

## 错误码前端映射纪律（2026-10-28 立，100008 双语义 bug 批）

表单错误处理统一走 `src/utils/apiError.ts`（`apiErrorBody` 抽取 /
`apiErrorMessage` 透传 / `isConflictCode` 冲突码族判定），**禁止页面手写
response 三行抽取**：

1. **码面映射只做场景分档**：同码异义必须场景守卫（al/data 100008 案例——
   插入/编辑双语义，插入态透传后端原文，编辑态才映射乐观锁文案）；
2. **文案优先后端透传**：后端 message 已是人话（含 detail 折叠），前端不造
   第二套文案体系；兜底文案仅覆盖网络/非 HTTP 错误；
3. **新增双语义码 = 后端拆码或前端守卫二选一**，禁止无守卫的码面 if。

## 卡片头纪律（2026-10-30 立，卡片头收敛批）

判据两律+一禁：
1. **一屏一卡不加头**：整页只有一张主卡时，卡片头默认省略——面包屑已完成
   「你在哪」的定位；标题与菜单同名的卡头是同一句话说两遍（情报查询/
   通知配置/发起工单/系统设置/审计日志/活动类型六页 2026-10-30 整改）；
2. **一屏多卡区块必题**：同屏多张卡（工单详情八卡/Profile 三卡/Home/
   MyOrg/al-data 双栏/dict 双栏）的区块标题是块间导航，保留；header 槽
   承载操作（按钮/计数/动态标题——工单详情主卡、al-data 右栏）保留；
3. **实现注释不入 UI**：架构说明（"缓存代理先本地后上游"）/内部段编号
   （"S6 通知中心"）/开发者口径注记永不进卡片头——挪 placeholder/title
   悬停/文档（审计"可查已删除用户"已在筛选 title，卡头是第二遍）。

页面级卡头删除时的**按钮落位**=工具行（筛选栏「动作钉右」同款）：
筛选/说明左侧、主操作按钮 `ml-auto !mr-0` 钉右（al/types「注册类型」/
rules「新建规则」参照实现；org 页层级面包屑随工具行挪卡体顶部——
树内滚语义不变）。

## 菜单迁移联动清单（主仓迁移批随行——2026-10-28 补）

新增菜单行迁移批除主仓自身验收外，UI 仓两项联动**必须随批**：
① `icons.test` 种子清单同步（intel 图标曾静默空白——裸名未映射不报错只不渲染）；
② E2E 登录后可达断言（intel 000067 漏绑 role_menus 曾致全员不可见——绑定测试随批）。

现状对齐（2026-10-13 全即时口径收口）：工单列表（参照实现）/审计日志（含方法筛选）/
任务中心 runs/用户管理 ✅ 全对齐；字典/活动列表类型清单为客户端即时过滤或左栏清单，
不受服务端配方约束。

## 展示与交互惯例（2026-10-13 巡检反馈批沉淀）

1. **列表行点击进详情**：查看型列表（工单列表/最近工单/活动数据）行点击直达详情
   （`@row-click` + 行指针样式）；行内按钮 `@click.stop` 防冒泡。管理型 CRUD 页
   （用户/角色/类型）不适用——编辑走操作列按钮；
2. **用户展示统一 UserNameText**：凡展示"人名+工号"处一律用
   `src/components/UserNameText`（结构化「人名(工号)」+ fallback 语义统一返 `—`），
   禁止手拼字符串。契约字段：`*_name/*_no` + fallback `created_by/assigned_to` 等
   （后端快照见主仓 000044）；
3. **空态引导三件**：列表空态给行动出口——「去注册类型」（跨页跳转）、「写入首条」
   （主操作）、「从左侧选择」（指路），禁止裸空白；
4. **登录卡信息条**：环境徽标（base/dev/test/pro，生产转绿）+ 定位一句话 + 非 prod
   测试账号提示（防生产凭据外泄）——见 Login.vue `form-foot/form-hint`；
5. **统计卡/实体卡可点**：首页状态卡点击=按该口径过滤跳列表（URL 参数化依赖），
   卡片必须 `cursor-pointer` 且 hover 有反馈；
6. **侧栏折叠过渡纪律（2026-10-14）**：侧栏宽度有 0.2s 过渡，**凡随折叠显隐的元素一律
   常驻渲染+opacity 同周期过渡**，禁止 v-if 瞬时卸载——logo 标题（常驻+淡出裁剪）与
   菜单文字（`.v-menu__title` opacity/visibility 过渡）均已按此实现；
7. **导航开关图标=动作语义**（Geeker CollapseIcon 同款）：展开态=Fold（点击收起）、
   收起态=Expand（点击展开），aria-label 同步状态。⚠ 现状用离线包 chevron 字形——
   `@element-plus/icons-vue` 见踩坑⑨；
8. **切换类控件显示目标形态**（2026-10-30 审计页走查批立）：toggle 型按钮一律显示
   「点击后到达的状态」而非当前态（首例=ProTable 密度钮——舒适态显「紧凑」，与聚焦
   钮「聚焦→退出聚焦」同向）；当前态靠图标/上下文表达，tooltip 写动作全称。禁止
   「密度：舒适」式当前态直书——用户想切换时看到的恰是不想要的状态，语义拧；
9. **Tab 页卡头不重复 Tab 名**（2026-10-30 同批立）：Tab 已承担页名，卡头让位给
   页面级说明句（一句话定位/边界提示）或直接省略——禁止「审计日志」Tab+卡头双写
   同名词（首例审计页，全仓扫描仅此一处）。页面级总标题卡（卡头≠任何单个 Tab 名，
   如 notify「消息管理」下辖三 Tab）不受限；
10. **图标统一离线 mdi 包**：视图内图标一律 `@iconify/vue` + `mdi:` 字形，**新增
    字形必须入 `src/icons.ts` 注册**（`icons.test` 哨兵强制——视图直写未注册图标=
    静默零渲染，2026-10-30 实咬首例 format-line-spacing）；`@element-plus/icons-vue`
    本仓 pnpm 布局解析失败（CI 实证，踩坑⑨）勿引。

## 滚动条归属

- 填充页外层滚动量恒为 **0**；列表页滚动在表格 el-scrollbar，内容页在内容区容器——样式全仓一致。
- `.v-app-view`（AppView section）的 overflow-y-auto **只是兜底**，验收标准是任何页面不触发它
  （DOM 探针：`section.scrollHeight === section.clientHeight`）。
- **Backtop 盯 `.v-app-view`**（内容页内滚容器的回顶需求出现前不改挂载点；若某内容页需要回顶，
  单页评估）。

## 踩过的坑（勿重蹈）

1. EP `max-height="100%"` **不驱动内部 body 高度计算**（纯样式，行溢出滚动条不激活）——表格封顶必须
   `height="100%"` + 父层可收缩（`min-h-0 flex-initial`），让百分比解析到定高。
2. `.pro-table--fill > div { flex:none }`(0-1-1) 曾压过表格包裹层收缩规则 (0-1-0)——特异性要显式
   压制（现状已修）。
3. 表格外包 `div` 插进 `v-if`/`v-else` 之间会拆散配对（vue/valid-v-else）——`v-else` 移到包裹层上。
4. `.fill-page > .el-card` 给**所有**直接子卡片 `flex:1`——复合页次区块加 `!flex-none`。
5. 填充语义 = **紧凑+按需封顶**：行少时表格贴内容、分页紧跟（留白在页底背景，不是表格框内的洞）；
   行多时封顶内滚。不要回退「无脑拉满」——高屏会露框内死区。
6. 全局卡类等页面级 CSS 改动后，六张已填列表页+四张内容页都要回归（DOM 探针最便宜）。
   ✅ 回归记录：2026-10-15 四向归零(`padding:0`)批——十二页(含扩展树页)探针全过：
   secD/secX 全 0、topGap 24、贴底 0、表内横滚 0（MyOrg botFlush 861 为探针
   foot 匹配偏差+内容少于视口的自然留白，渲染确认正常）。
7. **EP `el-row :gutter` 负外边距 × 滚动容器 = 横向溢出**(2026-10-14 首页统计卡实测):gutter 靠行两侧 ±8px 负外边距实现,滚动容器内即成真实横向溢出——容器加 `overflow-x-hidden` 裁掉补偿区即可(列内 padding 保护,无可见损失)。
8. **EP 2.14 el-table 列宽拟合不随容器变化重排**（侧栏异步收起/窗口面板调整/数据晚到后，表格保持
   豁免：对话框/抽屉内定宽表（如 ticket/type 字段编辑器 860px）不挂 useTableFit，见 `src/tableFitScan` 豁免清单。
   首次拟合宽度——右侧残留死区或表内横向滚动条，window resize 也不自愈）。兜底=`useTableFit`
   （`@vea/hooks`，ResizeObserver 盯表格父容器+window resize→`doLayout`，数据晚到传 watchSource）；
   **ProTable 已内置**，手动 el-table 必须自行挂接（用法见 composable 头注释）。
9. **`@element-plus/icons-vue` 显式依赖在本仓 pnpm 布局下解析失败**（CI+本地双实证：
   顶层软链指向无 peer 后缀的 store 路径，实际目录带 `_vue@..._` 后缀；手工修链仅本地
   生效，CI 全新安装复现）——EP 图标字形一律走 `src/icons.ts` 在册 MDI 字形+`<Icon>`
   包装；Fold/Expand 形态待工具链修复后再对齐（Collapse 组件注释留痕）。

## 页面配方决策树（2026-10-30 立——spec coding 动线：新建列表页按序走）

> 十一节规则的**执行序**形态——AI/新人新建或大改一个列表页从此节按序走，
> 每步给「去哪节看细则」锚。跑完 = 六件门禁绿 + 哨兵全绿。

```
① 定形态（§页面骨架三形态）
   主列表一张表→列表页；表单/详情流→内容页；列表+其他区块→复合页
② 骨架（§页面骨架）——fill-page 根 + 形态对应滚动配方 + tabs 叠 fill-tabs
③ 分页选型（§分页统一约定四形态表）
   服务端 offset→ProTable；无 total 端点→cursor；内存全量≤50→内滚；
   客户端 slice→面板型带 sizes（哨兵：无分页设施=paginationCoverage 红）
④ 筛选栏（§筛选栏配方+§筛选栏折叠）
   控件≤4 直排；多则 FilterBar 包裹；日期范围一律 useDatePresetRange
   快捷段（禁常驻 daterange）；下拉变更即查/文本防抖 300ms/重置钉右
⑤ 表格列（§表格规范）——内容列 minWidth/枚举固定宽/操作列 fixed right
   + wrap；行点击进详情给 cursor-pointer（.stop 防冒泡）
⑥ 空态（§空态与加载）——#empty 槽+行动出口 CTA（首个X 专名防 strict；
   文案不含 Tab 名子目——uiConventions 哨兵）
⑦ 卡片头（§卡片头纪律）——一屏一卡不加头；按钮进工具行 ml-auto 钉右
⑧ 数据展示——时间 formatDateTime（禁手写 toLocaleString）；人名
   UserNameText；错误处理 apiErrorBody/apiErrorMessage（禁手写抽取）
⑨ 验收——pnpm gate 六件 + 哨兵（pnpm test 内）；视口探针 section
   滚动=0；双档自测 900/1440 高
```

## 新增页面 checklist

1. 根节点 `fill-page`（**无需再叠 p-4**——根层 padding 已全局归零，写了也被覆盖；
   居中窄栏叠 `max-w-[N] mx-auto`；tabs 叠 `fill-tabs`）。
2. 选形态：列表页→表格内滚配方；内容页→内容区包 `min-h-0 flex-1 overflow-y-auto`。
3. 列定义：≥1 个内容列 `minWidth`；操作列 `fixed:'right'` 固定宽。
4. 分页走 ProTable 默认；特殊形态按「分页」节口径，页头注释写明理由。
5. 双档自测：900 高（内容溢出→内滚生效、分页/底部控件可达）+ ≥1440 高（行不满屏无表内死区）；
   ≥2560 宽无右侧死区；**任何页面 section 滚动量=0**。
6. 数据面三件（切页回顶/密度切换/聚焦）ProTable 自带零接线，**勿自建同义控件**；
   普通 el-table 面板型小表不接密度/聚焦（「数据密度与聚焦模式」节）。

## 现状清单（2026-10-08 立，10-30 修订）

| 页面 | 形态 | 状态 |
|---|---|---|
| system/user · role · ticket/list · audit/log · task/list · al/types · system/ticket-type | 列表页（单表/tabs） | ✅ 表格内滚；列表页均无页面级卡头（2026-10-30 收敛批） |
| ticket/list · task/list · audit/log | 列表页（FilterBar 折叠筛选） | ✅ 2026-10-30 三页首批 |
| al/data | 双栏列表（类型清单+数据区） | ✅ 左清单右数据各自内滚（10-12 两栏改版）+搜索筛选（10-28 服务端 q/field/value） |
| intel/query | 双 Tab（查询/查询历史） | ✅ 查询=表单+结果双视图；历史=分组树+客户端分页+趋势抽屉（10-28/29） |
| system/notification | 三 Tab（模板/规则/发送记录） | ✅ 发送记录排障筛选（status/biz_id——主仓 cf01b7c） |
| system/dict | 双栏列表 | ✅ 双栏等高各自内滚；搜索即时化（10-28） |
| MyOrg | 复合页（组织卡+名册） | ✅ 名册内滚、组织卡 flex-none |
| system/org · menu | 内容页（树） | ✅ 内容区内滚；org 层级面包屑滚动联动（10-29） |
| ticket/detail · ticket/create · Profile · Home | 内容页 | ✅ 内容区内滚（Profile 头像链路三修+裁剪 10-29） |
| 登录/改密/403/404 | 独立布局 | ➖ 不适用（404 catch-all 注册 10-29） |

## 前端资产地图（2026-10-30 立——spec coding 速查：找组件/工具先查此表）

| 资产 | 位置 | 用途一句话 |
|---|---|---|
| ProTable | `@/components/ProTable` | 列表主组件（分页/空态/loading/useTableFit 内置） |
| FilterBar | `@/components/FilterBar` | 筛选栏折叠（默认 4 控件+展开切换） |
| UserPicker | `@/components/UserPicker` | 用户选择器（姓名+工号搜索——分派/抄送/催办） |
| UserNameText | `@/components/UserNameText` | 人名(工号)三态降级展示（禁手拼） |
| IntelResult | `views/intel/query/IntelResult.vue` | 任意 JSON 递归键值树（多列网格+点击复制） |
| CronBuilder / FormDesigner / FlowGraphDesigner | `@/components/*` | cron 构造/动态表单/流程画布 |
| useTableFit / useAutoFilterRun / useDatePresetRange | `@vea/hooks` | 列宽重排兜底/筛选即时触发/日期快捷段 |
| datetime / apiError / avatar | `@/utils/*` | 时间格式化单点/信封错误抽取/头像 URL 归一 |
| cursorPager | `views/al/data/cursorPager.ts` | 游标分页页栈（push/pop/reset） |

## 组件 props 契约速查（2026-10-30 立——省去读源码；完整签名以组件 types 为准）

**ProTable**（列表主组件）：
```ts
columns: ProTableColumn[]  // { prop, label, width?, minWidth?, align?, fixed?, slot?, showOverflowTooltip?, wrap? }
fetcher: (p: { page, page_size, ...筛选透传 }) => Promise<{ list: Row[], total: number }>
// slots：#search（筛选区）/ #toolbar（工具栏）/ 具名 slot = column.slot ?? prop（拿 { row }）
// expose：refresh({ resetPage?: boolean })；分页 [10,20,50,100] 默认 20 勿覆盖
```
**FilterBar**（筛选折叠）：`visible?: number`（默认 4）；槽内控件直挂；动作钮加
`data-ignore`（收起态仍可见）。注意：form-item 已 div 化——E2E 按 placeholder/文本定位。
**UserPicker**：`v-model` = 用户 ID（string）；远程搜索姓名/工号/用户名，回填 ID。
**UserNameText**：`{ name, no, fallback }`——三态降级（人名(工号)→其一→fallback）。
**useDatePresetRange**（@vea/hooks）：`{ preset, range, apply(v), reset() }`——
radio 快捷段四态 + range=[from,to]（YYYY-MM-DD）驱动服务端/客户端过滤。
**apiError**（@/utils）：`apiErrorBody(err)`（信封抽取）/ `apiErrorMessage(err, fallback?)` /
`isConflictCode(err)`（10006/100008 冲突族）。
**datetime**（@/utils）：`formatDateTime(v)`（完整）/ `formatDateTimeShort(v)`（M/D HH:mm）。

## 防漂移哨兵矩阵（2026-10-30 汇总——六扫描全在单测内，`pnpm test` 即跑）

| 哨兵 | 文件 | 拦截什么 |
|---|---|---|
| EP 导入完整性 | `src/epImports.test.ts` | 模板 el-* 缺 import（运行时静默失效）+字符串 prefix-icon 死图标 |
| useTableFit 挂接 | `src/epImports.test.ts` 第二用例 | 手动 el-table 漏挂（列宽不随容器重排） |
| 分页覆盖 | `src/paginationCoverage.test.ts` | 含 el-table 页面无任何分页设施（数据增长型缺口——247/51/84 三例事故后立） |
| UI 惯例 | `src/uiConventions.test.ts` | 主列表缺 #empty 空态引导/placeholder 超宽截断 |
| 图标注册 | `src/icons.test.ts` | 视图直写未注册图标（死图标） |
| apiPaths 前缀 | `src/api/apiPaths.test.ts` | API 路径漏网关前缀 |
