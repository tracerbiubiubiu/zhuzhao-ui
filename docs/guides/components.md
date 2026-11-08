# 页面与组件开发 — 先选骨架，再复用已有资产

本篇从[UI设计约束](../design/frontend-ui.md)抽出实施步骤与参考，避免新页面从审计流水猜规范。先确定用户是读列表、看内容还是执行表单动作，再选对应骨架；涉及权限/路由还需主仓场景与菜单合同。

## 实施时先核三件事

1. 查当前页面/接口合同，标明数据是服务端offset、游标、客户端切片还是固定小清单，不能把没有total的响应接成有总数分页。
2. 查下方资产表，复用ProTable、FilterBar、UserNameText和hooks；不要新写同义组件/错误抽取。
3. 按页面执行序落地，验证不同视口、非admin行为与真实回读；UI约束的文字不是机械守卫，具体守卫边界见[测试指南](testing.md)。

## 页面实施顺序

1. **形态和骨架**：主表→列表页，表单/详情流→内容页，列表+其他区块→复合页；根用fill-page，tabs叠fill-tabs。细则见[页面骨架](../design/frontend-ui.md#页面骨架三种形态)。
2. **分页**：服务端offset→ProTable，AL无total→cursor，死信无total→offset上一/下一页，客户端slice→带sizes的面板型，固定不增长且≤50行→全量内滚。见[分页约定](../design/frontend-ui.md#分页统一约定2026-10-28-立筛选规范收敛批同批)。
3. **筛选**：少控件直排，多控件FilterBar；下拉即查、文本300ms防抖，重置钉右，日期用useDatePresetRange；游标页变更先reset游标。见[筛选配方](../design/frontend-ui.md#筛选栏配方2026-10-12-立工单列表批实测配方)。
4. **列与空态**：内容列minWidth、操作列fixed right，长文按wrap/tooltip语义选；#empty给可执行出口并按权限门控。见[表格规范](../design/frontend-ui.md#表格规范)。
5. **标题和数据展示**：一屏一卡省卡头；时间走datetime、人名用UserNameText、错误走apiError；接口ID不转Number。参照[卡片头](../design/frontend-ui.md#卡片头纪律2026-10-30-立卡片头收敛批)和[展示惯例](../design/frontend-ui.md#展示与交互惯例2026-10-13-巡检反馈批沉淀)。
6. **弹层和验收**：详情右抽屉、动作对话框；表单禁遮罩误关。核section外滚为0、窄/高/宽屏可达，再跑相关验证及pnpm gate。见[弹层](../design/frontend-ui.md#弹层形态纪律2026-11-03-立任务中心详情抽屉批)与[测试](testing.md)。

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
7. 弹层选型（UI设计的弹层形态纪律）：详情查看→右抽屉（键值 560/长文 620，抽屉内滚+
   长文配复制钮）；提交/编辑/确认→对话框。**详情类禁开 dialog**。
8. 数字输入（UI设计的数字输入形态纪律）：el-input-number 必带 `:controls="false"`。
9. 动作/表单对话框一律 `:close-on-click-modal="false"`（UI设计的弹层形态纪律 6——防误触遮罩丢输入）。

## 前端资产地图

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

## 组件 props 契约速查

**ProTable**（列表主组件；以下为类型形态示意，Row/Query由调用方声明，完整签名以组件types为准）：
```ts
columns: ProTableColumn[]  // { prop, label, width?, minWidth?, align?, fixed?, slot?, showOverflowTooltip?, wrap? }
fetcher: (p: { page: number; page_size: number } & Query) => Promise<{ list: Row[]; total: number }>
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
