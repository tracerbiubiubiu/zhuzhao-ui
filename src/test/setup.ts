/**
 * Vitest 全局 setup——最小浏览器 API 垫片（node 环境无 DOM）
 *
 * tokenStorage（AT/RT/device_id）与请求层依赖 localStorage。此处提供内存实现，
 * 避免为纯逻辑测试引入 jsdom/@vue/test-utils（控制成本，01 §7）。
 */

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}
