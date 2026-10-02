# 复核报告-CI修复与E2E加固 — 2026-10-02

- **对象**：zhuzhao-ui `main` @ `4ad3bbf9`（工作树干净，与 `origin/main` 同步）
- **范围**：`d70cebb3 → 4ad3bbf9`（10 个提交，含 4 次 merge）
- **方法**：逐文件读代码 + 复跑门禁 + **查真实 CI 运行记录**（`gh run list`）+ 仓库可见性核验

---

## ✅ 结论：本批全部正确，并修掉一个真实的流程问题

### 1【重要】上一批的种子派生测试曾把 CI 打红「三连挂」——现已修复且验证生效

`gh run list` 实证：

| Run ID | 提交 | 结果 |
|---|---|---|
| 36750054460 | merge 复检真修批（含 viewNames 种子派生） | ❌ failure |
| 36881512873 | merge AGENTS 契约速查 | ❌ failure |
| 36970634103 | merge 10-02 复核跟进批 | ❌ failure |
| **36971865314** | **merge CI 修复（test job 补主仓 checkout）** | ✅ **success** |
| 36977475846 / 36983804646 / 36984548961 | 后续三次（HEAD） | ✅ success ×3 |

**根因**：种子派生测试硬依赖 `../zhuzhao/migrations`。本地同级仓存在 → 假绿；CI 单仓 checkout → 挂。
**修法（正确）**：`.github/workflows/ci.yml` 的 `test` job 增加 `actions/checkout` 拉取 `tracerbiubiubiu/zhuzhao` 到 `zhuzhao/`，并设 `ZHUZHAO_REPO: ${{ github.workspace }}/zhuzhao`。仅 `test` job 需要（lint/typecheck/build 不执行该测试）——边界正确。
**主仓可见性**：`gh repo view` 确认 `tracerbiubiubiu/zhuzhao` 为 **PUBLIC** → 默认 `GITHUB_TOKEN` 可读，无需额外 secret。✅

**教训已固化**：`AGENTS.md` 纪律行新增「**推送后核实 CI run 转绿才算交付闭环**（本地绿≠CI 绿；跨仓依赖的测试改动合入前先过一遍『CI 无同级仓』假设）」；`README.md` 顶部加 CI badge 治「挂三天无人知」的观察盲区。

### 2. 上一轮报的两处小瑕疵已修

| 瑕疵 | 修复 |
|---|---|
| `src/plugins/vueQuery/index.ts:4` 注释仍写「logout 调用」 | 改为「userStore.**resetState** 调用，登出/401 终态/守卫失败三路共用——复检 P1-2」 ✅ |
| `src/icons.test.ts` 扫描面窄（仅双引号、不含 `components/`） | 扫面加 `src/components`（**TagsView 有 3 处直写曾在盲区**）；正则改 `(["'])mdi:[a-z0-9-]+\1` 兼容单双引号；`:icon="'mdi:x'"` 因全仓零用例显式不扩并注记 ✅ |

### 3. E2E 两处「假绿面」消除（实质加固）

- **`e2e/s2-home-smoke.spec.ts`**：原仅断言「系统管理」「最近工单」两个标题**文本可见** → 现改为：API 预造一张 open 工单 → 断「待处理」卡数字为纯数字且 **≥1**、断「我的待办 / 我的已办」两卡数字渲染、断最近工单表**含该行**、断行内状态 tag = 待处理，并以 `finally` 删单清理（唯一 suffix，可重放）。
- **`e2e/w5-audit-log.spec.ts`**：载荷弹窗由「弹层可见即过」→ 断言 `<pre>` 文本 **trim 后非空**。

### 4. i18n 口径拍板（P3-9 由「未修」转「有记录的设计取舍」）

英文面**显式暂不启用**（触发器=外部协作者/英文用户出现，未命中）；`src/locales/` 骨架与 en 词包为**预留基建勿删**。三处同口径：`README.md`、`AGENTS.md`、主仓 `02 §5.4`。

---

## 门禁实跑

| 命令 | 结果 |
|---|---|
| `pnpm lint`（`npx eslint .`） | ✅ exit 0 |
| `pnpm typecheck` | ✅ 0 error |
| `pnpm test` | ✅ **13 文件 / 102 用例全绿** |
| `pnpm build` | ✅ `✓ built in 5.07s`，exit 0 |
| **CI（GitHub Actions，HEAD `4ad3bbf9`）** | ✅ **success**（`gh run list` 实证） |
| `pnpm test:e2e` | ⚫ 本地未跑（需五栈；CI 不跑 E2E，与既定口径一致） |
| `pnpm audit --prod` | ⚫ 本轮回跑卡网络；本批未改 `package.json`/lockfile |

---

## 仍未完成（12 遗留 + 1 存疑）

`P2-5` 角色回显 N+1/竞态 · `P2-7` MyOrg `page_size=50` 截断 · `P2-8` Panic 无翻页 UI · `P2-9` 视图直连 `request` · `P2-10` al `restoreAlDataApi` 死码 + `Number(id)` · `P2-11` MyOrg 缺组内赋权/owner · `P2-12` 用户页缺「分配组织」 · `P3-4` `ERR_CANCELED` 分支 · `P3-5` `SessionError.retry` 校验口径 · `P3-6` int64 局部例外 · `P3-7` 主仓 01 号 404/403 矛盾 · `P3-12` 无 CONTRIBUTING/RELEASING ；`P3-11` pnpm 版本声明存疑。

> 已闭环合计：P1 三项（P1-1/P1-2/P1-3）+ P3-8 + P3-9（转取舍）+ 本轮两项瑕疵。
