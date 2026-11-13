import assert from 'node:assert/strict'

// 最小 localStorage 替身：验证播种、持久化与刷新后重复处理仍返回原护照号。
class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    this.map.set(key, String(value))
  }
  removeItem(key) {
    this.map.delete(key)
  }
}

const storage = new MemoryStorage()
globalThis.window = { localStorage: storage }

const { ensureCleanseSeed, listPassports, processInput, listInputs } = await import('../src/api/cleanse-service.ts')
const { passportStorageKey } = await import('../src/data/cleanse-ledger.ts')

// 首次打开：只播种一次
ensureCleanseSeed()
const seeded = listPassports()
assert.equal(seeded.length, 4)
const raw = storage.getItem(passportStorageKey())
assert.ok(raw && raw.length > 100, '护照账本已写入 localStorage')

// 模拟刷新：清掉模块内缓存，从 storage 重新读取
const { reloadPassportStore } = await import('../src/data/cleanse-ledger.ts')
reloadPassportStore()
const afterReload = listPassports()
assert.equal(afterReload.length, 4, '刷新后仍能读到护照')

// 再次调用播种不会重复
ensureCleanseSeed()
assert.equal(listPassports().length, 4)

// 刷新后重复处理同一包：仍返回原护照号
const input = listInputs(1)[0]
const first = processInput(input.id)
const again = processInput(input.id)
assert.equal(first.reused, true)
assert.equal(again.passport.passportNo, first.passport.passportNo)

console.log('persistence tests: all passed')
