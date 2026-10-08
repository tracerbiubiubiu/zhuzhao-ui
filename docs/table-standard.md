# 表格与列表页规范 — zhuzhao-ui 列表类页面的填充/列宽/分页/滚动统一约定

> 2026-10-08 制定（源头批次：视口填充统一 `30901a13`→`e4cde864`、Backtop 回归修复 `b00a15b5`、
> 紧凑+按需封顶 `6001ba06`、运行记录列宽 `c3fadc90`、四页补齐=本批）。新增/改动列表类页面前
> 通读本文；与本文冲突的实现视为待整改项。

## 判定规则：这个页面要不要「填充」

- **页面主体是一张（或双栏/tabs 型）列表 → 填充**：页面锁定视口，表格内部滚动，分页钉底。
- **页面主体是表单/详情/工作台（如工单详情、发起页、个人中心）→ 不填充**：整页自然滚动。
- **表单页内的附属小表（如 Profile 的 Token 列表）→ 不填充**，随页滚动，可给 `max-h` 加内滚。
- 首页工作台（统计卡+精选列表）不填充。

## 纵向填充（页面不动、表格内滚、分页钉底）

机制三层，都在仓内：

1. **ProTable 页**：传 `fill` 属性即可（`<ProTable ... fill>`）。
2. **页面骨架**：根节点 `class="fill-page p-4"`（全局类，见 `@vea/styles` index.less）——卡片与
   卡片体自动弹性化；tabs 型页面在 `el-tabs` 上加 `class="fill-tabs"`（每签独立成填充链）。
3. **手动 el-table**（非 ProTable）：表格外包 `<div class="min-h-0 flex-initial">`，表格加
   `height="100%"`。

布局链：`ElScrollbar view（.v-scroll-view 定高）→ AppView section（.v-app-view flex-1 自滚，
非填充页在这里整页滚）→ .fill-page → .el-card(__body) → 表格 wrap → el-table height=100%`。

**坑（踩过的，勿重蹈）**：

- EP `max-height="100%"` **不驱动内部 body 高度计算**（纯样式，行溢出时滚动条不激活）——封顶必须
  用 `height="100%"` + 父层可收缩，让百分比解析到定高。
- `.fill-page > .el-card` 会给**所有**直接子卡片 `flex:1`——复合页中不想拉伸的卡片（如 MyOrg 的
  组织卡）加 `!flex-none`（important 压过全局类）。
- ProTable fill 模式内 `.pro-table--fill > div { flex:none }`(0-1-1) 会压过表格包裹层收缩规则
  (0-1-0)——包裹层选择器必须带类名提高特异性（现状已修，改动时保持）。
- 表格外包 `div` 若插在 `v-if`/`v-else` 之间会拆散配对（vue/valid-v-else）——`v-else` 移到包裹层上。
- 填充语义 = **紧凑+按需封顶**：行少时表格贴内容、分页紧跟其下（留白落在页底背景，不是表格框内
  的洞）；行多时表格封顶内滚、分页钉底。不要回到「无脑拉满」——高屏下行数不满一屏会在框内露死区。

## 横向填充（列铺满表格宽）

- **内容型列（标题/名称/ID/描述等长文本）用 `minWidth`，枚举/数值/时间/操作列用固定 `width`**。
- EP 剩余宽度只分配给 `minWidth` 列——**全固定宽的表在宽屏下右侧露死区**（运行记录表曾 964px）。
- 新表自检：至少一列 `minWidth`；`show-overflow-tooltip` 配长文本列防换行。
- 固定右列（`fixed: 'right'`）保持 `width`。

## 分页

- **ProTable 页统一**：`[10, 20, 50, 100]`、默认 20（组件默认，勿页面覆盖）。
- **无 total 的形态**：cursor 分页（al 数据）=「第 N 页/每页 N 条+上一页/下一页」；死信=固定
  page_size 20 同款。不假装有 total、不做跳页。
- **面板型固定 20**（MyOrg 名册/审计 Panic 聚合）：名册后端硬顶 100、聚合为附属视图——固定值+
  精简 layout（`total, prev, pager, next` 或 `prev, pager, next`），不加 sizes。
- 每页条数等交互属性一律来自 ProTable，页面不要自带 `el-pagination` 造第二套（面板型除外，理由
  见上）。

## 滚动条

- 填充页：外层**不出现**页面滚动条（section 滚动量恒 0），滚动只发生在表格内部（el-table 自带
  el-scrollbar，样式全仓一致）。
- 非填充页：整页滚动发生在 `.v-app-view`（AppView section）——**Backtop 盯这里**（`.v-app-view`），
  不要改回旧容器。
- 对话框内长内容（树/JSON payload）：`max-h-[420px] overflow-auto`（原生滚动条）或 el-scrollbar，
  高度值不强制统一。

## 空态与加载

- 表格加载：`v-loading`（ProTable 已内置）。
- 空数据：ProTable 用 EP 空态；手动表配 `el-empty`（al 数据「写入首条」按钮挂空态槽的写法可参考）。

## 新增列表页 checklist

1. 判定：主体是列表？→ 走填充；否则整页滚动。
2. 根节点 `fill-page p-4`（tabs 页另加 `fill-tabs`；复合页不想拉伸的卡片加 `!flex-none`）。
3. ProTable 传 `fill`；手动表按「纵向填充」第 3 条配方。
4. 列定义自检：内容列 `minWidth` ≥1 个；操作列 `fixed: 'right'` 固定宽。
5. 分页走 ProTable 默认；特殊形态按「分页」节口径并在页头注释写明理由。
6. 双档自测：高视口（≥1440）行不满屏无表内死区、矮视口（900）内滚+分页钉底；宽视口（≥2560）
   无右侧死区。

## 现状清单（2026-10-08）

| 页面 | 形态 | 状态 |
|---|---|---|
| system/user · system/role · ticket/list | ProTable 单表 | ✅ 填充 |
| audit/log · task/list | ProTable tabs + 面板表 | ✅ 填充 |
| al/data · al/types · system/ticket-type | 手动单表/tabs | ✅ 填充 |
| system/dict | 双栏列表 | ✅ 双栏等高内滚 |
| MyOrg | 复合页（组织卡+名册） | ✅ 名册填充、组织卡 flex-none |
| 工单详情/发起 · Profile · Home | 表单/详情/工作台 | ➖ 不填充（自然滚动） |
