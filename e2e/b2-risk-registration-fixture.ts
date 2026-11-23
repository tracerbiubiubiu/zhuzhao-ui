import { randomInt, randomUUID } from 'node:crypto'
import { b2Account } from './b2-browser-env'
import { api, mustData, type TokenPair } from './helpers'

type MenuNode = { id: string; code: string; children?: MenuNode[] }
type Account = { userId: string; employeeNo: string; password: string }

export async function provisionRiskRegistration(ui: string, core: string) {
  const call = <T>(path: string, opts?: Parameters<typeof api>[1]) => api<T>(path, opts, core)
  async function login(account: Pick<Account, 'employeeNo' | 'password'>) {
    const session = await mustData(call<TokenPair>('/api/v1/auth/login', {
      method: 'POST',
      body: { employee_no: account.employeeNo, password: account.password, device_id: `b2-risk6-${randomUUID()}` },
    }), '登录专项合成账号')
    if (!session?.access_token || session.must_change_password) throw new Error('专项账号应能直接登录')
    return { token: session.access_token }
  }

  const tag = randomUUID().replaceAll('-', '').slice(0, 12)
  const adminAccount = b2Account('B2_RISK_REGISTRATION_ADMIN', { allowSeed: true })
  const admin = await login(adminAccount)
  const profilePath = '/api/v1/user/profile'
  const [coreProfile, uiProfile] = await Promise.all([
    mustData(call<{ id: string; employee_no: string }>(profilePath, admin), 'Core 回读专项准备账号'),
    mustData(api<{ id: string; employee_no: string }>(profilePath, admin, ui), 'UI 网关回读专项准备账号'),
  ])
  if (!coreProfile?.id || uiProfile?.id !== coreProfile.id
    || coreProfile.employee_no?.toUpperCase() !== adminAccount.employeeNo.toUpperCase()
    || uiProfile.employee_no?.toUpperCase() !== adminAccount.employeeNo.toUpperCase()) {
    throw new Error('UI 网关与 Core 必须识别同一本轮准备账号')
  }
  const menus = await mustData(call<MenuNode[]>('/api/v1/menus', admin), '读取迁移菜单')
  const menuIdByCode = new Map<string, string>()
  function indexMenus(nodes: MenuNode[]) {
    for (const node of nodes) {
      menuIdByCode.set(node.code, node.id)
      indexMenus(node.children ?? [])
    }
  }
  indexMenus(menus)

  async function createRole(kind: string, codes: string[]) {
    const menuIds = codes.map(code => {
      const id = menuIdByCode.get(code)
      if (!id) throw new Error(`缺少专项所需的迁移菜单 ${code}`)
      return id
    })
    const role = await mustData(call<{ id: string }>('/api/v1/roles', {
      ...admin, method: 'POST', body: { code: `b2_risk6_${kind}_${tag}`, name: `B2 风险专项 ${kind} ${tag}`, priority: 10 },
    }), '创建隔离的专项角色')
    await mustData(call('/api/v1/roles/menus', {
      ...admin, method: 'POST', body: { role_id: role.id, menu_ids: menuIds },
    }), '绑定专项角色的迁移菜单')
    return role.id
  }

  const readMenus = ['home', 'risk_manage', 'risk_list']
  const managerRole = await createRole('manager', [...readMenus, 'risk_create_btn', 'risk_assess_btn', 'risk_assign_btn'])
  const readerRole = await createRole('reader', readMenus)
  const seederRole = await createRole('setup', ['home', 'system', 'system_org', 'system_org_create', 'system_org_member'])
  async function createAccount(kind: string, roleId: string): Promise<Account> {
    const password = `B2Risk6#${randomUUID()}`
    for (let attempt = 0; attempt < 5; attempt++) {
      const employeeNo = `E${randomInt(700000, 1000000)}`
      const response = await call<{ id: string }>('/api/v1/users', {
        ...admin, method: 'POST',
        body: { username: `b2_risk6_${kind}_${tag}`, employee_no: employeeNo, password, role_ids: [roleId] },
      })
      if (response.status === 409 && response.env?.code === 30007) continue
      const user = await mustData(Promise.resolve(response), '创建专属合成账号')
      return { userId: user.id, employeeNo, password }
    }
    throw new Error('专项合成工号连续冲突，未能创建专属账号')
  }

  const M = await createAccount('m', managerRole)
  const U = await createAccount('u', readerRole)
  const P = await createAccount('p', readerRole)
  const X = await createAccount('x', readerRole)
  const seeder = await login(await createAccount('setup', seederRole))

  // 组织与主锚关系由单独授予组织操作权限的合成账号通过产品 API 建立。
  const org = await mustData(call<{ id: string }>('/api/v1/orgs', {
    ...seeder, method: 'POST', body: { code: `b2_risk6_${tag}`, name: `B2 风险专项组织 ${tag}` },
  }), '创建合成风险管理组织')
  for (const [account, orgMemberRole] of [[M, 'admin'], [X, 'member']] as const) {
    await mustData(call('/api/v1/orgs/members', {
      ...seeder, method: 'POST', body: { org_id: org.id, user_id: account.userId, org_member_role: orgMemberRole },
    }), '建立合成主锚成员关系')
  }

  return { ui, call, tag, orgId: org.id, accounts: { M, U, P, X }, manager: await login(M), reader: await login(X) }
}
