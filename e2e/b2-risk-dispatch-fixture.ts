import assert from 'node:assert/strict'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { b2Account } from './b2-browser-env'

type Risk = { risk_id: string; expected_revision: string }
type RiskTrio = [Risk, Risk, Risk]

type Fixture = {
  target: { org_id: string; type_code: string; definition_version: string }
  risks: RiskTrio
  ownerless: Risk
  restart: RiskTrio
}

function isInt64(value: unknown, allowZero = false): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)
    && (allowZero || value !== '0') && BigInt(value) <= 9223372036854775807n
}

function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), '专项夹具字段必须是对象')
  const record = value as Record<string, unknown>
  const allowed = [...keys, ...optional]
  assert.ok(keys.every(key => Object.hasOwn(record, key)) && Object.keys(record).every(key => allowed.includes(key)),
    '专项夹具对象字段与合同不符')
  return record
}

function risk(value: unknown): Risk {
  const { risk_id, expected_revision } = object(value, ['risk_id', 'expected_revision'])
  assert.ok(isInt64(risk_id) && isInt64(expected_revision, true), '风险 ID 和版本须为十进制字符串')
  return { risk_id, expected_revision }
}

function trio(value: unknown): RiskTrio {
  assert.ok(Array.isArray(value) && value.length === 3, '三资产夹具须按 A、B、C 提供三个不同风险')
  return [risk(value[0]), risk(value[1]), risk(value[2])]
}

/** 准备器在仓库外写独占环境的 JSON，账号由本轮环境变量提供。
 * risks 和 restart 分别是全新的 A/B/C，A/B 同负责人、C 另一负责人，两人都有主部门。
 * 每组三条合成风险标题共用可搜索前缀。ownerless 是其余前置满足的独立合成风险。 */
export function loadDispatchFixture(): Fixture {
  const file = process.env.B2_RISK_DISPATCH_FIXTURE
  assert.ok(file, '缺少 B2_RISK_DISPATCH_FIXTURE')
  let raw: unknown
  try {
    if (!isAbsolute(file)) throw new Error('relative')
    const path = realpathSync(file)
    const worktree = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
    const fromWorktree = relative(worktree, path)
    const info = statSync(path)
    if (!fromWorktree.startsWith(`..${sep}`) || !info.isFile()
      || info.uid !== process.geteuid?.() || (info.mode & 0o022) !== 0) throw new Error('ownership')
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('B2_RISK_DISPATCH_FIXTURE 需为仓库外、本轮执行用户拥有且仅其可写的 JSON 文件')
  }
  const { account, target, risks, ownerless, restart } = object(raw, ['target', 'risks', 'ownerless', 'restart'], ['account'])
  assert.ok(account === undefined || account === 'operator' || account === 'viewer', '旧版 account 字段须为合法槽名')
  const { org_id, type_code, definition_version } = object(target, ['org_id', 'type_code', 'definition_version'])
  assert.ok(isInt64(org_id) && isInt64(definition_version), '目标组织和发布版本须为正整数十进制字符串')
  assert.ok(typeof type_code === 'string' && type_code.trim() && type_code === type_code.trim(), '缺少已发布整改类型')
  const fixture: Fixture = {
    target: { org_id, type_code, definition_version }, risks: trio(risks), ownerless: risk(ownerless), restart: trio(restart),
  }
  const ids = [...fixture.risks, fixture.ownerless, ...fixture.restart].map(item => item.risk_id)
  assert.equal(new Set(ids).size, ids.length, '各场景必须使用不同风险')
  return fixture
}

export function dispatchAccount() {
  return b2Account('B2_RISK_DISPATCH')
}
