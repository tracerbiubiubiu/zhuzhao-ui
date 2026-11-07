/** 十进制int64标识符保持字符串；排序也不得经浮点数丢失相邻大ID。 */
export function compareInt64Desc(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x === y ? 0 : x > y ? -1 : 1
}
