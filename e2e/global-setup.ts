import { writeFileSync } from 'node:fs'
import { api, apiLogin, STATE_FILE, type TokenPair } from './helpers'

/**
 * E2E 幂等建号（02 号 P4-W1「验收账号与权限基座」拍板口径）：
 * - 测试账号不进 migrations/（迁移落包括生产在内的每个环境，已知凭证是更低安全水位）
 * - admin 凭据闭环：首跑经强制改密改到 E2E 固定口令（env 可覆盖），后续运行直接复用
 * - operator/viewer 建号 + 角色预设绑定（W1 B 案「页面=读、写挂按钮」的推荐分配预设）：
 *   viewer   = 业务域页面 + *_read_btn 读按钮（只读——「工单 list/read」预设含读按钮，03 号 S17）
 *   operator = viewer 预设 + 业务写按钮（task:manage / ticket:type:manage 除外=管理面专属）
 * - S1 强制改密账号：管理员重置密码即置 must_change_password=true（user_service.go UpdatePassword 第三参），
 *   每次运行重置到同一口令 → 流程确定性可重放
 */
const DEVICE = 'e2e-setup-device-01'

const ADMIN_NO = process.env.E2E_ADMIN_EMPLOYEE_NO ?? 'E000001'
const SEED_PWD = process.env.E2E_ADMIN_SEED_PASSWORD ?? 'admin123'
// E2E 旧固定口令——2026-10-13 起降级为：登录候选（历史状态迁移）+ mcp 两步轮换过渡值
// （终态翻转见 main ① 注释；新测试账号口令模式参考 runbook §4）
const ADMIN_PWD = process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdmin#2609'
// admin 唯一终态口令（全生态收敛：后端 acceptance phase1 幂等流 / break-glass CLI 复原值
// / E2E 本闭环三处同值；dev 栈公开测试凭据，台账=主仓 docs/runbook.md §4）
const ACCEPTANCE_PWD = process.env.E2E_ADMIN_ACCEPTANCE_PASSWORD ?? 'admin12345'

const OPERATOR = {
  username: 'e2e_operator',
  employeeNo: 'E2E9020',
  password: process.env.E2E_OPERATOR_PASSWORD ?? 'E2eOper#2609',
}
const VIEWER = {
  username: 'e2e_viewer',
  employeeNo: 'E2E9030',
  password: process.env.E2E_VIEWER_PASSWORD ?? 'E2eView#2609',
}
const S1 = {
  username: 'e2e_s1',
  employeeNo: 'E2E9040',
  password: 'E2eS1cur#2609', // 每次运行被管理员重置到该值（must_change=true）
  newPassword: 'E2eS1done#2609', // 用例内改密目标（下次运行会被重置回上一行，可无限重放）
}

/** 业务域顶层菜单 code（system/audit=管理面专属不进预设；home 单独放行） */
const BIZ_TOP_CODES = new Set(['ticket_manage', 'task_manage', 'al_manage']) // 审计修正：top 取顶层祖先 code——task_center 是 task_manage 的子页（原写致任务域整体被排除出 viewer/operator 预设）
/** operator 也排除的管理面写权限（02 号 W1 B 案：/jobs* 与类型管理=admin 专属） */
const ADMIN_ONLY_PERMS = new Set(['task:manage', 'ticket:type:manage'])

interface MenuNode {
  id: string
  code: string
  name: string
  menu_type: number
  permission: string
  children?: MenuNode[]
}

function envFail(where: string, status: number, code: number | undefined, message: string | undefined): never {
  throw new Error(`globalSetup ${where} 失败：HTTP ${status} code=${code} message=${message ?? '(无信封)'}`)
}

async function main(): Promise<void> {
  // ── ① admin 凭据闭环（2026-10-13 统一口径翻转：终态 = ACCEPTANCE_PWD/admin12345） ──
  // 此前终态 = E2eAdmin#2609，与后端 acceptance（phase1 幂等流认 admin12345）/
  // break-glass CLI（复原值 admin12345）结构性互踢——同日内三次互改实证。
  // 现全生态收敛到唯一终值 admin12345（dev 栈公开测试凭据，台账见主仓 runbook §4）；
  // E2eAdmin#2609 降级为：登录候选（历史状态迁移）+ mcp=true 时的两步轮换过渡值。
  let adminToken: string | undefined
  for (const candidate of [ACCEPTANCE_PWD, ADMIN_PWD, SEED_PWD]) {
    const r = await apiLogin(ADMIN_NO, candidate, DEVICE)
    const pair = r.env?.data
    if (r.status === 200 && r.env?.code === 0 && pair?.access_token) {
      if (candidate === ACCEPTANCE_PWD && !pair.must_change_password) {
        adminToken = pair.access_token // 已是统一终态（重放的常态路径，零改密）
      } else if (candidate === ACCEPTANCE_PWD && pair.must_change_password) {
        // 已在终值但带强制改密标记（break-glass 直改后未轮换）——同值改密被
        // B2-2 拒，两步过：先到 E2eAdmin#2609 过渡，再回终值
        const tmp = await api<TokenPair>('/api/v1/auth/password/update', {
          method: 'POST',
          token: pair.access_token,
          body: { old_password: ACCEPTANCE_PWD, new_password: ADMIN_PWD, device_id: DEVICE },
        })
        const tmpToken = tmp.env?.data?.access_token
        if (!tmpToken) throw new Error('admin 两步轮换第一步失败（终值→过渡值）')
        const back = await api<TokenPair>('/api/v1/auth/password/update', {
          method: 'POST',
          token: tmpToken,
          body: { old_password: ADMIN_PWD, new_password: ACCEPTANCE_PWD, device_id: DEVICE },
        })
        if (back.env?.code === 0) adminToken = back.env.data?.access_token
      } else {
        // 首跑（种子强制改密）或口令漂移（E2E 旧口令/验收态/他改）→ 统一到终值
        const upd = await api<TokenPair>('/api/v1/auth/password/update', {
          method: 'POST',
          token: pair.access_token,
          body: { old_password: candidate, new_password: ACCEPTANCE_PWD, device_id: DEVICE },
        })
        if (upd.env?.code === 0) adminToken = upd.env.data?.access_token
      }
      break
    }
  }
  if (!adminToken) {
    throw new Error(
      `admin 登录闭环失败（终值 admin12345 / E2E 旧口令 / 种子口令均不可用）。` +
        `检查：① 后端已起（主仓 INTERNAL_JOBS_SK=xxx make dev，dev 栈 scripts/dev-stack.sh up）` +
        `② 若 admin 口令已被改为未知他值，主仓 break-glass CLI 复原：` +
        `printf 'admin12345\\n' | go run ./cmd/server reset-password --username admin --password-stdin --yes（runbook §1）`,
    )
  }

  // ── ② 角色锚点（operator/viewer 种子角色，000002） ─────────────
  const rolesResp = await api<{ list?: Array<{ id: string; code: string }> } | Array<{ id: string; code: string }>>('/api/v1/roles?page=1&page_size=100', { token: adminToken })
  if (rolesResp.env?.code !== 0) envFail('GET /roles', rolesResp.status, rolesResp.env?.code, rolesResp.env?.message)
  const rolesRaw = rolesResp.env?.data
  const roles = Array.isArray(rolesRaw) ? rolesRaw : (rolesRaw?.list ?? [])
  const operatorRole = roles.find((x) => x.code === 'operator')
  const viewerRole = roles.find((x) => x.code === 'viewer')
  if (!operatorRole || !viewerRole) throw new Error('globalSetup：种子角色 operator/viewer 缺失（000002 种子被改动？）')

  // ── ③ 菜单树 → 预设（W1 B 案「页面=读 API、写端点挂按钮」） ────
  const menusResp = await api<MenuNode[]>('/api/v1/menus', { token: adminToken })
  if (menusResp.env?.code !== 0) envFail('GET /menus', menusResp.status, menusResp.env?.code, menusResp.env?.message)
  const flat: Array<MenuNode & { top: string }> = []
  const walk = (nodes: MenuNode[], top: string): void => {
    for (const n of nodes) {
      const t = top || n.code
      flat.push({ ...n, top: t })
      if (n.children?.length) walk(n.children, t)
    }
  }
  walk(menusResp.env?.data ?? [], '')
  const home = flat.find((n) => n.code === 'home')
  if (!home) throw new Error('globalSetup：home 菜单缺失（所有登录用户的首页锚点）')

  const biz = flat.filter((n) => BIZ_TOP_CODES.has(n.top))
  const viewerMenuIds = [
    home.id,
    ...biz.filter((n) => n.menu_type !== 3 || n.code.endsWith('_read_btn')).map((n) => n.id),
  ]
  const operatorMenuIds = [
    ...new Set([
      ...viewerMenuIds,
      ...biz
        .filter((n) => n.menu_type === 3 && !n.code.endsWith('_read_btn') && !ADMIN_ONLY_PERMS.has(n.permission))
        .map((n) => n.id),
    ]),
  ]

  // AssignMenus 替换语义——重复运行幂等重放同一预设
  for (const [role, menuIds] of [
    [viewerRole, viewerMenuIds],
    [operatorRole, operatorMenuIds],
  ] as const) {
    const resp = await api('/api/v1/roles/menus', {
      method: 'POST',
      token: adminToken,
      body: { role_id: String(role.id), menu_ids: menuIds.map(String) },
    })
    if (resp.env?.code !== 0) envFail(`POST /roles/menus(${role.code})`, resp.status, resp.env?.code, resp.env?.message)
  }

  // ── ④ 幂等建号（employee_no 精确查重 → 缺则建） ────────────────
  const findUser = async (employeeNo: string): Promise<string | undefined> => {
    const resp = await api<{ list?: Array<{ id: string }> }>(`/api/v1/users?employee_no=${encodeURIComponent(employeeNo)}`, { token: adminToken })
    return resp.env?.data?.list?.[0]?.id
  }
  const ensureUser = async (u: { username: string; employeeNo: string; password: string }, roleIds: string[]): Promise<string> => {
    let id = await findUser(u.employeeNo)
    if (!id) {
      const created = await api('/api/v1/users', {
        method: 'POST',
        token: adminToken,
        body: { username: u.username, password: u.password, employee_no: u.employeeNo, real_name: `E2E ${u.username}` },
      })
      if (created.env?.code !== 0) envFail(`POST /users(${u.employeeNo})`, created.status, created.env?.code, created.env?.message)
      id = await findUser(u.employeeNo)
    }
    if (!id) throw new Error(`globalSetup：建号后查不到 ${u.employeeNo}`)
    for (const roleId of roleIds) {
      const resp = await api('/api/v1/users/roles', {
        method: 'POST',
        token: adminToken,
        body: { user_id: id, role_ids: [roleId] },
      })
      if (resp.env?.code !== 0) envFail(`POST /users/roles(${u.employeeNo})`, resp.status, resp.env?.code, resp.env?.message)
    }
    return id
  }

  await ensureUser(OPERATOR, [String(operatorRole.id)])
  await ensureUser(VIEWER, [String(viewerRole.id)])

  // ── ⑤ S1 账号：重置密码 → must_change_password=true（确定性重放） ─
  // 绑 viewer 角色：保证改密后菜单非空、/#/home 可达（不引入与断言无关的空菜单边界）
  const s1Id = await ensureUser(S1, [String(viewerRole.id)])
  const reset = await api('/api/v1/users/password/reset', {
    method: 'POST',
    token: adminToken,
    body: { user_id: s1Id, password: S1.password },
  })
  if (reset.env?.code !== 0) envFail('POST /users/password/reset(S1)', reset.status, reset.env?.code, reset.env?.message)

  writeFileSync(STATE_FILE, JSON.stringify({
    admin: { employeeNo: ADMIN_NO, password: ACCEPTANCE_PWD }, // 终态=统一口令（specs 登录用）
    operator: { employeeNo: OPERATOR.employeeNo, password: OPERATOR.password },
    viewer: { employeeNo: VIEWER.employeeNo, password: VIEWER.password },
    s1: { employeeNo: S1.employeeNo, password: S1.password, newPassword: S1.newPassword },
  }, null, 2))
  // eslint-disable-next-line no-console
  console.log('✅ E2E globalSetup：admin 闭环 + operator/viewer 预设绑定 + S1 重置完成')
}

export default main
