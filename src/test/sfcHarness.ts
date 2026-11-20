import { transformSync } from 'esbuild'
import * as vue from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'
import { afterEach, vi } from 'vitest'
import * as apiError from '@/utils/apiError'
import * as datetime from '@/utils/datetime'

const scopes: vue.EffectScope[] = []
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.clearAllTimers()
  vi.useRealTimers()
})

const compiledPages = new Map<string, string>()
/** 与既有页面测试一致，在模块加载期编译，避免将编译器冷启动计入异步业务超时。 */
export function preparePage(source: string) {
  if (compiledPages.has(source)) return
  const script = compileScript(parse(source).descriptor, { id: 'page-regression', genDefaultAs: 'page' })
  const { code } = transformSync(script.content, { loader: 'ts', format: 'cjs' })
  compiledPages.set(source, code)
}
/** 执行真实 SFC setup，只替换请求、渲染依赖及生命周期调度。 */
export function setupPage<T = any>(source: string, libraries: Record<string, unknown>, props = {}) {
  preparePage(source)
  const code = compiledPages.get(source)!
  const lifecycle = { mount: () => {}, activate: () => {}, deactivate: () => {}, unmount: () => {} }
  const libs: Record<string, unknown> = {
    vue: {
      ...vue,
      onMounted: (fn: () => void) => { lifecycle.mount = fn },
      onActivated: (fn: () => void) => { lifecycle.activate = fn },
      onDeactivated: (fn: () => void) => { lifecycle.deactivate = fn },
      onUnmounted: (fn: () => void) => { lifecycle.unmount = fn },
    },
    '@vea/hooks': { useTableFit() {}, useAutoFilterRun() {}, useDatePresetRange: () => ({ preset: vue.ref(''), range: vue.ref(null), apply() {}, reset() {} }) },
    '@/utils/apiError': apiError,
    '@/utils/datetime': datetime,
    ...libraries,
  }
  const create = new Function('require', 'props', `${code}\nreturn page.setup(props, { expose() {}, emit() {} })`)
  const scope = vue.effectScope()
  const page = scope.run(() => create((name: string) => {
    if (!(name in libs)) throw new Error(`缺少显式测试依赖：${name}`)
    return libs[name]
  }, props)) as T
  scopes.push(scope)
  return { page, lifecycle }
}

export function deferred<T = any>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
export async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await vue.nextTick()
}
export const httpError = (status: number, message?: string) => ({ response: { status, data: { message } } })

/** 编译真实模板并返回 VNode，校验原生键盘控件和实际事件处理器。 */
export function renderPage(source: string, page: unknown, props = {}) {
  const descriptor = parse(source).descriptor
  const script = compileScript(descriptor, { id: 'page-render' })
  const template = compileTemplate({ source: descriptor.template!.content, filename: 'page.vue', id: 'page-render', compilerOptions: { bindingMetadata: script.bindings } })
  const { code } = transformSync(template.code, { loader: 'ts', format: 'cjs' })
  const render = new Function('require', 'module', `${code}\nreturn render`)(() => ({ ...vue, resolveComponent: (name: string) => name }), { exports: {} })
  const state = vue.proxyRefs(page as Record<string, unknown>)
  return render(state, [], props, state, {}, {}) as vue.VNode
}
export function findNode(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  if (Array.isArray(node.children)) for (const child of node.children) {
    const found = findNode(child, predicate)
    if (found) return found
  }
}
