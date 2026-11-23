import { constants } from 'node:fs'
import { access, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { item9Only, requiredB2Env } from './b2-browser-env'

type Checkpoint = {
  operationId: string
  planId: string
  planHash: string
  actorId: string
  groups: {
    groupKey: string; groupOperationId: string; ticketId: string; ownerId: string; ownerOrgId: string; riskIds: string[]
  }[]
}

type Snapshot = {
  parentOperationIds: string[]
  groupReceipts: { groupKey: string; groupOperationId: string; ticketId: string; ownerId: string; ownerOrgId: string }[]
  ticketIds: string[]
  ticketRefs?: { id: string; ref: string }[]
  riskRefs?: { id: string; ref: string }[]
  activeLinks: { id: string; riskId: string; ticketId: string; ownerId: string }[]
  riskHistory: { id: string; riskId: string; operationId: string }[]
  ticketHistory: { id: string; ticketId: string; action: 'created' | 'assigned'; actorId: string }[]
  requiredIntents: { id: string; key: string }[]
}

type Restarted = {
  operationId: string
  planId: string
  coreArtifact: string
  beforeInstance: string
  afterInstance: string
  ready: true
  before: Snapshot
}

export async function verifyRestartDirectory(
  dir = process.env.B2_RISK_DISPATCH_RESTART_DIR, key = 'B2_RISK_DISPATCH_RESTART_DIR',
): Promise<string> {
  try {
    if (!dir || !isAbsolute(dir)) throw new Error('relative')
    const path = await realpath(dir)
    const worktree = await realpath(fileURLToPath(new URL('..', import.meta.url)))
    const info = await stat(path)
    if (!relative(worktree, path).startsWith(`..${sep}`) || !info.isDirectory()
      || info.uid !== process.geteuid?.() || (info.mode & 0o077) !== 0) throw new Error('ownership')
    await access(path, constants.R_OK | constants.W_OK | constants.X_OK)
    if ((await readdir(path)).length !== 0) throw new Error('not empty')
    return path
  } catch {
    throw new Error(`${key} 需为仓库外、本轮执行用户独占且可读写的空目录`)
  }
}

export function verifyLifecycleRestartDirectory(): Promise<string> {
  const key = 'B2_RISK_LIFECYCLE_RESTART_DIR'
  return verifyRestartDirectory(requiredB2Env(key), key)
}

// Playwright loads the config again in each worker; emptiness only applies
// before the run and before each restart case creates its first handoff marker.
export default async function verifyB2RestartFixture(): Promise<void> {
  if (item9Only) {
    await verifyLifecycleRestartDirectory()
    if (!/^sha256:[a-f0-9]{64}$/.test(requiredB2Env('B2_EXPECTED_CORE_DIGEST'))) {
      throw new Error('第 9 项需要固定的 Core 镜像 ID')
    }
  } else {
    await verifyRestartDirectory()
  }
}

/** 独占运行器在 committed 事件后、停 Core 前独立读取 PG；保留同一数据库和制品。
 * 真正完成停机、启动、就绪检查后写 restarted。原页面 GET 后再按同一边界读取 PG，写 readback。
 * 快照覆盖本次派单涉及的风险、工单和原操作的全部命中项。riskHistory 取派单事件，ticketHistory 取首次建单及分派动作。
 * 意图 key 是候选的稳定业务去重键。数组按稳定标识排序，错误与凭据留运行器本地。 */
async function publish(dir: string, event: string, operationId: string, data: object) {
  const file = join(dir, `${event}.${operationId}.json`)
  try {
    await writeFile(`${file}.tmp`, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
    await rename(`${file}.tmp`, file)
  } catch {
    throw new Error(`无法写入本轮派单 ${event} 交接事件`)
  }
}

async function readEvent<T>(dir: string, event: string, operationId: string): Promise<T> {
  let value: T | undefined
  await expect.poll(async () => {
    try {
      value = JSON.parse(await readFile(join(dir, `${event}.${operationId}.json`), 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`无法读取本轮派单 ${event} 交接事件`)
    }
    return value !== undefined
  }, { timeout: 60_000, message: `等待独占运行器的 ${event} 事件` }).toBe(true)
  if (!value) throw new Error(`本轮派单 ${event} 交接事件缺少数据`)
  return value
}

function distinctIds(ids: string[], count: number) {
  expect(ids).toHaveLength(count)
  expect(new Set(ids).size).toBe(count)
  for (const id of ids) expect(id).toMatch(/\S/)
}

function verifyCommittedSnapshot(snapshot: Snapshot, checkpoint: Checkpoint, coverage: { groups: number; risks: number }) {
  const { groups, operationId, actorId } = checkpoint
  expect(groups).toHaveLength(coverage.groups)
  distinctIds(groups.flatMap(group => group.riskIds), coverage.risks)
  expect(snapshot.parentOperationIds).toEqual([operationId])
  expect(snapshot.ticketIds.slice().sort()).toEqual(groups.map(group => group.ticketId).sort())
  expect(snapshot.groupReceipts).toHaveLength(coverage.groups)
  expect(snapshot.groupReceipts).toEqual(expect.arrayContaining(groups.map(({ riskIds: _riskIds, ...receipt }) => receipt)))
  distinctIds(snapshot.activeLinks.map(link => link.id), coverage.risks)
  expect(snapshot.activeLinks).toEqual(expect.arrayContaining(groups.flatMap(group => group.riskIds.map(riskId =>
    expect.objectContaining({ riskId, ticketId: group.ticketId, ownerId: group.ownerId }),
  ))))
  distinctIds(snapshot.riskHistory.map(event => event.id), coverage.risks)
  expect(snapshot.riskHistory).toEqual(expect.arrayContaining(groups.flatMap(group => group.riskIds.map(riskId =>
    expect.objectContaining({ riskId, operationId }),
  ))))
  distinctIds(snapshot.ticketHistory.map(event => event.id), 2 * coverage.groups)
  expect(snapshot.ticketHistory).toEqual(expect.arrayContaining(groups.flatMap(({ ticketId }) => [
    expect.objectContaining({ ticketId, action: 'created', actorId }),
    expect.objectContaining({ ticketId, action: 'assigned', actorId }),
  ])))
  distinctIds(snapshot.requiredIntents.map(intent => intent.id), snapshot.requiredIntents.length)
  distinctIds(snapshot.requiredIntents.map(intent => intent.key), snapshot.requiredIntents.length)
  if (item9Only) {
    const schedules = snapshot.requiredIntents.filter(intent => intent.id.startsWith('assignment:'))
    expect(schedules).toHaveLength(coverage.groups)
    for (const group of groups) {
      expect(schedules).toContainEqual(expect.objectContaining({
        key: expect.stringMatching(new RegExp('^' + group.ticketId + ':1:')),
      }))
    }
    expect(snapshot.ticketRefs).toEqual(groups.map(group => ({
      id: group.ticketId, ref: expect.stringMatching(/\S/),
    })))
    expect(snapshot.riskRefs).toEqual(groups.flatMap(group => group.riskIds.map(id => ({
      id, ref: expect.stringMatching(/\S/),
    }))))
  }
}

export async function confirmDispatchRestart(dir: string, checkpoint: Checkpoint, coverage = { groups: 2, risks: 3 }) {
  const { operationId, planId } = checkpoint
  await publish(dir, 'committed', operationId, checkpoint)
  const restarted = await readEvent<Restarted>(dir, 'restarted', operationId)
  expect(restarted).toMatchObject({ operationId, planId, ready: true })
  expect(restarted.coreArtifact).toMatch(/\S/)
  if (item9Only) expect(restarted.coreArtifact).toBe(requiredB2Env('B2_EXPECTED_CORE_DIGEST'))
  expect(restarted.beforeInstance).toMatch(/\S/)
  expect(restarted.afterInstance).toMatch(/\S/)
  expect(restarted.afterInstance).not.toBe(restarted.beforeInstance)
  verifyCommittedSnapshot(restarted.before, checkpoint, coverage)
  return restarted
}

export async function confirmRestartReadback(dir: string, operationId: string, restarted: Restarted) {
  const { planId, coreArtifact, afterInstance } = restarted
  await publish(dir, 'looked-up', operationId, { operationId, planId, coreArtifact, afterInstance })
  const readback = await readEvent<{
    operationId: string; planId: string; coreArtifact: string; afterInstance: string; snapshot: Snapshot
  }>(dir, 'readback', operationId)
  expect(readback).toMatchObject({ operationId, planId, coreArtifact, afterInstance })
  expect(readback.snapshot).toEqual(restarted.before)
}
