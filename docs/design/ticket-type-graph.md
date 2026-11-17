# 工单类型图写入合同（CF12）

状态：2026-11-17本地候选已通过组合验证，尚未合入main或部署；证据见[本轮正式报告](../../../zhuzhao/docs/review/reports/audit-baseline-repair-2026-11-17.md)，原材料ID为`maintenance/audit-baseline-repair-20261117/`。后端唯一权威为主仓 `internal/service/ticket/type_admin.go` 的 `validateTypeGraph`；UI预检不能代替后端判断。

保存及重新启用类型时，状态必须保留 `open`、`assigned`、`closed`，分别供建票、分派与关闭原动作使用；状态不得为空、带首尾空白或重复。自定义态和合法转换边继续保留，不另加可达性强约束。新建UI仍使用服务器默认六态图。

`FlowGraphDesigner/contract.ts` 是具体工单合同的局部镜像；通用mapper继续表示任意图。画布删除任一保留态后显示明确error，序列化拒绝保存；JSON源码模式走同一合同。孤立节点、普通死路和终态不可达等原lint仍是建议，不混同保留态写入错误。

历史坏图仍可读取。类型编辑发现旧图不满足合同即留在JSON源码模式，原始草稿不重写；补回必要状态后可以原地保存。重新启用沿同一编辑保存路径执行预检。后端Create对历史坏图的拒绝另由主仓实现，本页不改变存量工单状态。

本轮`e2e/p5-s2-flow-contract.spec.ts`的CF12已走真实读写：画布删除保留态、JSON逐项缺少内置态均明确阻止保存且零写请求；合法自定义态与转换成功保存一次，并通过真实类型列表回读核对两者。最终使用r2产品与r3-ui测试收据；r3-ui只修正类型列表`data.types`回读形状和另一任务页测试的可访问选项定位，两处均为测试修正，产品字节与r2相同。
