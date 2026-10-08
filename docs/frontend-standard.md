# 前端 UI 规范 — zhuzhao-ui 视口锁定/页面骨架/表格/滚动统一约定

> 2026-10-08 制定（源头批次：视口填充统一 `30901a13`→`e4cde864`、Backtop 回归 `b00a15b5`、紧凑封顶
> `6001ba06`、列宽 `c3fadc90`、四页补齐+全页视口锁定=本批）。**新增/改动任何页面前通读本文**；
> 与本文冲突的实现视为待整改项。

## 总原则（一条铁律）

**页面不动：所有页面锁定视口，一切滚动条都在内部元素上。** 浏览器窗口/外层布局永远不产生滚动；
滚动只发生在——列表页的表格内部、内容页的内容区容器、对话框/抽屉的框体内部。

## 页面骨架：三种形态

所有页面根节点都用 `fill-page`（全局类，`@vea/styles` index.less）——锁定视口高度的弹性列。
区别只在「哪个内部元素负责滚动」：

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

### 空态与加载

- 加载：`v-loading`（ProTable 内置）；空数据：EP 空态 / `el-empty`（操作按钮挂空态槽写法参考 al 数据页）。

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

## 新增页面 checklist

1. 根节点 `fill-page p-4`（居中窄栏叠 `max-w-[N] mx-auto`；tabs 叠 `fill-tabs`）。
2. 选形态：列表页→表格内滚配方；内容页→内容区包 `min-h-0 flex-1 overflow-y-auto`。
3. 列定义：≥1 个内容列 `minWidth`；操作列 `fixed:'right'` 固定宽。
4. 分页走 ProTable 默认；特殊形态按「分页」节口径，页头注释写明理由。
5. 双档自测：900 高（内容溢出→内滚生效、分页/底部控件可达）+ ≥1440 高（行不满屏无表内死区）；
   ≥2560 宽无右侧死区；**任何页面 section 滚动量=0**。

## 现状清单（2026-10-08）

| 页面 | 形态 | 状态 |
|---|---|---|
| system/user · role · ticket/list · audit/log · task/list · al/data · al/types · system/ticket-type | 列表页（单表/tabs） | ✅ 表格内滚 |
| system/dict | 双栏列表 | ✅ 双栏等高各自内滚 |
| MyOrg | 复合页（组织卡+名册） | ✅ 名册内滚、组织卡 flex-none |
| ticket/detail · ticket/create · Profile · Home | 内容页 | ✅ 内容区内滚（本批） |
| 登录/改密/403/404 | 独立布局 | ➖ 不适用 |
