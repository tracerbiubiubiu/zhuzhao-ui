# AGENTS.md — zhuzhao-ui 前端协作协议

> 本文件对每次在本仓库工作的 AI/协作方生效。设计 SSOT 在主仓 `zhuzhao/docs/phase4/01-frontend-design.md`。

## 前端门禁（每批交付前必跑）

```bash
pnpm lint          # ESLint + Prettier
pnpm typecheck     # vue-tsc --noEmit
pnpm test          # Vitest（composables/动态路由解析/单飞刷新）
pnpm audit --prod  # npm 供应链（对称 Go 侧 govulncheck）
pnpm build         # 产物构建
pnpm test:e2e      # Playwright（标准三栈 compose——不用 stub；脚本见主仓 scripts/dev-stack.sh）
```

**纪律**：门禁不全绿不得标记完成；E2E 打真后端（菜单可见性/权限码必须打真实数据）。

## 提交规范

- 中文提交信息，描述改动+原因+验证证据
- 分支：建设期每 Wave 开短分支（p4-w2-shell…），门禁绿后合入 main 即删

## 变更评审三节（前端适配）

每次交付附：
1. **改动摘要**：哪些文件/组件、为什么改、核心逻辑（≤10 行）
2. **影响面**：涉及的路由/页面/组件/store/共享封装
3. **验证证据**：跑了哪些门禁、结果、未覆盖路径

## 前端契约速查（详细见主仓 01 号）

- 信封：`{code:0, message, data, request_id}`——按 HTTP 状态分流（code≠0 恒非 2xx）
- 登录：`employee_no` + `password` + `device_id`（浏览器级 UUID 必传）
- 401 分码：20002 过期→静默刷新 / 20003 无效→跳登录 / 5xx 不清会话
- 权限码：`button:{permission}`（非 menus.code）+ `route:{path}`
- int64 全仓 string 序列化
- 菜单：`GET /user/menus` → `data:{menus:[...]}` / `GET /user/permissions` → `data:{permissions:[...]}`
