// 行护照（row passport）的确定性计算：同一输入只会得到同一个指纹与护照号，
// 因此重复处理同一包时可以原样返回旧护照，不需要看时间戳或随机数。
//
// 实现说明：纯前端没有 crypto.subtle 的同步接口（部分环境也不可用），这里用
// FNV-1a 32 位算法拼出稳定指纹。它的用途是「同一输入可复现」，不是密码学校验。

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 单行值指纹：对该行除护照字段外的全部业务值做稳定序列化后取摘要。 */
export function fingerprintOf(values: Record<string, unknown>): string {
  return `fp-${fnv1a(stableStringify(values))}`
}

/** 处理轨迹摘要：清洗版本 + 条件卡 + 全部样本输入 + 输出结果，一起构成包哈希。 */
export function digestOf(values: unknown): string {
  return fnv1a(stableStringify(values))
}

/**
 * 护照号：按「同一包重复处理返回原护照号」的要求，由内容决定而不是由次数决定。
 * 前缀区分对象类型：PKG=包护照，ROW=行护照。
 */
export function passportNo(prefix: 'PKG' | 'ROW', digest: string): string {
  return `${prefix}-${digest.toUpperCase().slice(0, 12)}`
}

export function shortHash(text: string): string {
  return fnv1a(text)
}

export function nowStamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('')
}
