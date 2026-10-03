# 验证报告-第三轮全量 — 2026-10-02

- **对象**：zhuzhao-ui `main` @ `e6cd0316`（工作树干净，与 `origin/main` 同步）
- **对照**：`4ad3bbf9`（上轮复核终点）
- **方法**：git 差分 + 主仓迁移/standards 对账 + 复跑门禁 + `gh run list` 实证 CI

---

## 结论

**zhuzhao-ui 侧无任何代码改动**，上轮全部结论原样成立。本轮的实际增量在**主仓**与**CI 状态**。

### 1. 本仓改动：只有一个文件

`git diff --stat 4ad3bbf9..HEAD` → 仅 `deliverables/archive/review-ci-e2e-fixes-2026-10-02.md`（+65，`1503c0e7` 入库）。提交信息记录对报告做了 **3 处计数勘误**：提交数 10→11、merge 4→5、i18n 落点三处→五处。

### 2. 主仓同期推进（与前端有耦合，须核）

- **无新迁移**（最大仍 `000038_dict_items_route`）→ 种子派生的 `viewNames.test.ts` 输入集不变，**不受影响** ✅
- `docs/standards.md` §3 新增**条 12**（四仓联合验证批）：
  - ① **date-only 业务字段须发 `YYYY-MM-DD`**（后端 `time.Parse("2006-01-02")` 硬校验；「前端曾以 datetime 控件直发 ISO 恒 400」的实测教训入册）
  - ② **ID 数组元素与标量同规——发送侧一律 string**；`jsonutil.Int64Slice` 双形态兼容仅为收方宽容，**明确点名「存量 `.map(Number)` 属违反本公约的欠账」**
- `2d1e608` 将 zhuzhao-ui 入册 standards 适用范围；时点报告口径定为：主仓 `deliverables/`、前端 `outputs/`，命名 `<类型>-<YYYY-MM-DD>.md`。（后续 2026-10-03 统一为各仓 `deliverables/` + 英文 kebab-case）

### 3. 新风险面主动核查：date-only 合规性

standards 条 12① 引入一个前端风险（工单自定义 `date` 字段曾直发 ISO → 恒 400）。实测：

| 位置 | 控件 | 结论 |
|---|---|---|
| `src/views/audit/log/index.vue:143-144` | `el-date-picker type="daterange"` | ✅ 显式 `value-format="YYYY-MM-DD"` |
| `src/views/ticket/create/index.vue:207-209` | `el-date-picker type="date"` | ✅ 显式 `value-format="YYYY-MM-DD"`（附后端严格校验注释） |

→ **前端日期面已合规，无新缺陷。**

### 4. P3-6 定性升级

由「契约自相矛盾」→「**已被 standards §3-12② 点名的主仓认可欠账**」。仍未修：`src/api/system/user.ts:65` `roleIds: number[]`（实测仍在）。

---

## 门禁实测（复跑）

| 项 | 结果 |
|---|---|
| `pnpm lint` | ✅ exit 0 |
| `pnpm typecheck` | ✅ 0 error |
| `pnpm test` | ✅ **13 文件 / 102 用例全绿** |
| `pnpm build` | ✅ `✓ built in 4.96s`，exit 0 |
| **CI（GitHub Actions）** | ✅ **最近 5 次 run 全 success**（含 HEAD `e6cd0316`） |
| `pnpm test:e2e` | ⚫ 本地未跑（需五栈；CI 按口径不跑 E2E） |
| `pnpm audit --prod` | ⚫ 未复跑（本批未改依赖） |

---

## 12 项遗留：抽样实证仍在（一件未动）

- `src/api/al/index.ts:142` `restoreAlDataApi` 死码仍在（P2-10）
- `src/views/system/user/index.vue` 的 `assign_org` **仅出现在第 9 行域说明注释里**，无实际按钮入口（P2-12）
- `src/api/system/user.ts:65` `roleIds: number[]` 仍在（P3-6）

其余：P2-5 / P2-7 / P2-8 / P2-9 / P2-11 / P3-4 / P3-5 / P3-7 / P3-12；另 P3-11 存疑。
