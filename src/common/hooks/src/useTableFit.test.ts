import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import { useTableFit } from './useTableFit'

const lifecycle = vi.hoisted(() => ({ mounted: [] as Array<() => void>, unmounted: [] as Array<() => void> }))
vi.mock('vue', async (original) => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => lifecycle.mounted.push(callback),
  onBeforeUnmount: (callback: () => void) => lifecycle.unmounted.push(callback),
}))

afterEach(() => { vi.unstubAllGlobals(); lifecycle.mounted.length = 0; lifecycle.unmounted.length = 0 })

it('observes the first mounted table, replaces its target and cleans up without unobserving undefined', async () => {
  const observe = vi.fn()
  const unobserve = vi.fn((element: Element) => { if (!element) throw new TypeError('ResizeObserver target must be an Element') })
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe = observe; unobserve = unobserve; disconnect = disconnect })
  const addEventListener = vi.fn()
  const removeEventListener = vi.fn()
  vi.stubGlobal('window', { addEventListener, removeEventListener })
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const first = {} as HTMLElement
  const second = {} as HTMLElement
  const initial = { doLayout: vi.fn(), $el: { parentElement: first } as HTMLElement }
  const replacement = { doLayout: vi.fn(), $el: { parentElement: second } as HTMLElement }
  const table = shallowRef(initial)
  const scope = effectScope()
  scope.run(() => useTableFit(table))
  try {
    lifecycle.mounted.forEach((callback) => callback())
    expect(observe).toHaveBeenCalledWith(first)
    expect(unobserve).not.toHaveBeenCalled()
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    table.value = replacement
    await nextTick()
    frames.shift()?.(0)
    await nextTick()
    expect(unobserve).toHaveBeenCalledExactlyOnceWith(first)
    expect(observe).toHaveBeenLastCalledWith(second)
    expect(replacement.doLayout).toHaveBeenCalledOnce()
    lifecycle.unmounted.forEach((callback) => callback())
    expect(disconnect).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
  } finally {
    scope.stop()
  }
})
