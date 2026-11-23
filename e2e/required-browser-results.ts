import { basename } from 'node:path'
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestStep } from '@playwright/test/reporter'

type Options = {
  expected: number | Record<string, number>
  listOnly?: boolean
  allowRetries?: boolean
}

function hasSkippedStep(step: TestStep): boolean {
  return step.annotations.some(({ type }) => type === 'skip') || step.steps.some(hasSkippedStep)
}

/** Playwright considers skips and expected failures successful. The acceptance gate requires executed assertions. */
export default class RequiredBrowserResults implements Reporter {
  private tests: TestCase[] = []

  constructor(private readonly options: Options) {}

  onBegin(_config: FullConfig, suite: Suite): void {
    this.tests = suite.allTests()
  }

  async onEnd(result: FullResult): Promise<{ status: 'failed' } | void> {
    if (result.status !== 'passed') return
    const { expected, listOnly, allowRetries } = this.options
    const counts = new Map<string, number>()
    for (const test of this.tests) {
      const file = basename(test.location.file)
      counts.set(file, (counts.get(file) ?? 0) + 1)
    }
    const inventoryMatches = typeof expected === 'number'
      ? this.tests.length === expected
      : counts.size === Object.keys(expected).length
        && Object.entries(expected).every(([file, count]) => counts.get(file) === count)
    if (!inventoryMatches) {
      process.stderr.write(`浏览器门禁发现清单不符（实测 ${this.tests.length} 条）\n`)
      return { status: 'failed' }
    }
    if (listOnly) return
    const incomplete = this.tests.filter(test => {
      const final = test.results.at(-1)
      const annotations = [...test.annotations, ...(final?.annotations ?? [])]
      return test.expectedStatus !== 'passed' || final?.status !== 'passed'
        || (!allowRetries && test.results.length !== 1)
        || annotations.some(({ type }) => type === 'skip' || type === '历史未覆盖')
        || final.steps.some(hasSkippedStep)
    })
    if (incomplete.length > 0) {
      for (const test of incomplete) {
        process.stderr.write(`浏览器门禁缺少有效通过结果：${test.title}\n`)
      }
      return { status: 'failed' }
    }
  }

  printsToStdio(): boolean {
    return false
  }
}
