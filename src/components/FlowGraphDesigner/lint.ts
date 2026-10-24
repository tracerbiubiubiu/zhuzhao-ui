/**
 * 状态图 lint（S2 B2-4——02 号附录 A.5 三规则 + 两条图级前提）。**告警不阻断**（拍板点 2，
 * 2026-10-24 所有者确认）：画布角标列出 + 点击定位节点，保存不受影响；后端 validateTypeGraph
 * 只查端点合法性，以下语义检查全为前端增量。
 *
 * 终态/起始态按名约定（types.ts TERMINAL_STATES/START_STATE——后端 closed 唯一终态判定、
 * Create 恒置 open 的镜像），非"无出边=终态"：默认图 closed/rejected 有重开边。
 */
import { START_STATE, TERMINAL_STATES, type Adjacency, type LintIssue } from './types'

function outDeg(transitions: Adjacency, s: string): number {
  return (transitions[s] ?? []).length
}

/** 自 roots 出发沿邻接表可达的状态集 */
function reach(transitions: Adjacency, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const s = stack.pop()!
    if (seen.has(s)) continue
    seen.add(s)
    for (const to of transitions[s] ?? []) if (!seen.has(to)) stack.push(to)
  }
  return seen
}

/** 反向邻接表（to → from[]） */
function reverse(states: readonly string[], transitions: Adjacency): Adjacency {
  const rev: Adjacency = {}
  for (const s of states) rev[s] = []
  for (const [from, tos] of Object.entries(transitions)) {
    for (const to of tos) (rev[to] ??= []).push(from)
  }
  return rev
}

export function lintGraph(states: readonly string[], transitions: Adjacency): LintIssue[] {
  const issues: LintIssue[] = []
  const set = new Set(states)
  const terminals = TERMINAL_STATES.filter((t) => set.has(t))

  if (!set.has(START_STATE)) {
    issues.push({ code: 'missing_start', message: `缺少起始态 ${START_STATE}：新建工单默认为 ${START_STATE}，图中无此状态则新单无法流转` })
  }
  if (terminals.length === 0) {
    issues.push({ code: 'no_terminal', message: `图中没有终态（${TERMINAL_STATES.join('/')}）：工单将无法关闭` })
  }

  // ② 孤立状态：无入边且非起始态（不可达，画了也到不了）
  const rev = reverse(states, transitions)
  for (const s of states) {
    if (s !== START_STATE && (rev[s]?.length ?? 0) === 0) {
      issues.push({ code: 'isolated', state: s, message: `状态「${s}」没有任何入边，工单无法到达该状态` })
    }
  }

  // ③ 无出边死锁：非终态零出边（进入即卡死——AssertTransition 恒拒）
  for (const s of states) {
    if (!terminals.includes(s) && outDeg(transitions, s) === 0) {
      issues.push({ code: 'deadlock', state: s, message: `状态「${s}」没有出边（非终态死锁），进入后无法再流转` })
    }
  }

  // ① 终态可达性：每个非终态须存在到任一终态的路径（反向图自终态集可达 = 正向能到终态）
  if (terminals.length) {
    const canReachTerminal = reach(rev, terminals)
    for (const s of states) {
      if (terminals.includes(s) || outDeg(transitions, s) === 0) continue // 零出边已由 ③ 报，不叠报
      if (!canReachTerminal.has(s)) {
        issues.push({ code: 'unreachable_terminal', state: s, message: `状态「${s}」无法到达任何终态（${terminals.join('/')}）` })
      }
    }
  }
  return issues
}

/**
 * 改图会让在途单"僵死"的状态集（S2 B2-3——02 号附录 A.4 在途单告警的判据）：
 * ① 旧图有、新图删掉的状态（该状态上的单在新图 AssertTransition 恒拒）；
 * ② 新图仍在、但非终态且零出边的状态（A.4 原文只列①，②为同一"僵死"实险的自然延伸——
 *    状态没删但出边被清空，效果等同）。
 * 调用方按返回集逐状态查在途单量，命中才弹确认（纯体验层——绕过亦被后端兜底）。
 */
export function stuckStates(oldStates: readonly string[], newStates: readonly string[], newTransitions: Adjacency): string[] {
  const next = new Set(newStates)
  const removed = oldStates.filter((s) => !next.has(s))
  const deadEnds = newStates.filter((s) => !TERMINAL_STATES.includes(s) && outDeg(newTransitions, s) === 0)
  return [...new Set([...removed, ...deadEnds])]
}
