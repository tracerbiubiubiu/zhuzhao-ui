import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const mode = args[0]
if (args.length > 1 || (mode !== undefined && mode !== '--list' && mode !== '--preflight')) {
  process.stderr.write('用法：pnpm test:e2e:b2 [--list | --preflight]\n')
  process.exit(2)
}

const result = spawnSync('playwright', ['test', '--config', 'playwright.b2.config.ts', ...(mode ? ['--list'] : [])], {
  env: { ...process.env, B2_BROWSER_PREFLIGHT: mode === '--preflight' ? '1' : '0' },
  stdio: 'inherit',
})
if (result.error) process.stderr.write('无法启动 Playwright，请先安装本工作树的依赖。\n')
process.exitCode = result.status ?? 1
