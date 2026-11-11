import type { Locator, Page } from '@playwright/test'

/** 实际鼠标default/hover/active；在外侧松手取消点击，避免触发业务操作。 */
export async function primaryButtonStates(page: Page, button: Locator) {
  const read = async (state: string) => {
    await button.evaluate(async (el) => {
      // 连续切换会取消旧transition；跨帧重读，避免已取消promise形成忙循环。
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await nextFrame()
      for (let round = 0; round < 12; round++) {
        const running = el.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)
        if (!running.length) return
        await Promise.allSettled(running.map((a) => a.finished))
        await nextFrame()
      }
      throw new Error('按钮动画未稳定，不能测量最终颜色')
    })
    return button.evaluate((el, stateName) => {
      const style = getComputedStyle(el)
      const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => {
        const c = v / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
      const foreground = luminance(style.color), background = luminance(style.backgroundColor)
      return {
        state: stateName, color: style.color, background: style.backgroundColor,
        ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        hover: el.matches(':hover'), active: el.matches(':active'),
        disabled: (el as HTMLButtonElement).disabled, opacity: style.opacity,
      }
    }, state)
  }
  await page.mouse.move(0, 0)
  const states = [await read('default')]
  await button.hover()
  states.push(await read('hover'))
  await page.mouse.down()
  try { states.push(await read('active')) } finally {
    await page.mouse.move(0, 0)
    await page.mouse.up()
  }
  return states
}
