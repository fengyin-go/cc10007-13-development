import type { CleanseInput, PackagePassport, PassportStore, RuleVersionSnapshot } from '@/data/cleanse-passport.types'

// 护照账本同样放在 localStorage；与各模块的 entries 分开存，避免把护照字段混进列表行。
const STORAGE_KEY = 'data-layer-studio:cleanse-passports'
const SCHEMA_VERSION = 1

function emptyStore(): PassportStore {
  return {
    schema: SCHEMA_VERSION,
    initialized: false,
    inputs: {},
    passports: {},
    keyIndex: {},
    versions: {},
    accepted: {},
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: PassportStore | null = null

function persist(store: PassportStore): void {
  cache = store
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  }
}

export function passportStore(): PassportStore {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = emptyStore()
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = emptyStore()
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PassportStore>
    if (parsed.schema !== SCHEMA_VERSION) {
      cache = emptyStore()
      return cache
    }
    cache = {
      ...emptyStore(),
      ...parsed,
      inputs: parsed.inputs ?? {},
      passports: parsed.passports ?? {},
      keyIndex: parsed.keyIndex ?? {},
      versions: parsed.versions ?? {},
      accepted: parsed.accepted ?? {},
    }
    return cache
  } catch {
    cache = emptyStore()
    return cache
  }
}

/** 丢弃内存缓存并重新读取 localStorage，模拟刷新后重新打开页面。 */
export function reloadPassportStore(): PassportStore {
  cache = null
  return passportStore()
}

export function replacePassportStore(next: PassportStore): void {
  persist(clone(next))
}

export function resetPassports(): void {
  persist(emptyStore())
}

export function passportStorageKey(): string {
  return STORAGE_KEY
}

export function addInput(input: CleanseInput): void {
  const store = clone(passportStore())
  store.inputs[input.id] = input
  persist(store)
}

export function saveVersion(ruleId: number, snapshot: RuleVersionSnapshot): void {
  const store = clone(passportStore())
  const list = store.versions[String(ruleId)] ?? []
  const index = list.findIndex((item) => item.version === snapshot.version)
  if (index >= 0) {
    list[index] = snapshot
  } else {
    list.push(snapshot)
  }
  store.versions[String(ruleId)] = list
  persist(store)
}

export function versionsOf(ruleId: number): RuleVersionSnapshot[] {
  return passportStore().versions[String(ruleId)] ?? []
}

export function latestVersionOf(ruleId: number): RuleVersionSnapshot | null {
  const list = versionsOf(ruleId)
  return list.length ? list[list.length - 1] : null
}

export function findVersion(ruleId: number, version: string): RuleVersionSnapshot | null {
  return versionsOf(ruleId).find((item) => item.version === version) ?? null
}

export function savePassport(passport: PackagePassport): void {
  const store = clone(passportStore())
  store.passports[passport.passportNo] = passport
  store.keyIndex[`${passport.packageKey}::${passport.ruleVersion}`] = passport.passportNo
  persist(store)
}

export function lookupPassport(packageKey: string, ruleVersion: string): PackagePassport | null {
  const store = passportStore()
  const no = store.keyIndex[`${packageKey}::${ruleVersion}`]
  return no ? store.passports[no] ?? null : null
}

/** 同一包已签发的护照：重复处理按包判定，无论当时用的是哪个版本。 */
export function passportsForPackage(packageKey: string): PackagePassport[] {
  return Object.values(passportStore().passports)
    .filter((passport) => passport.packageKey === packageKey)
    .sort((a, b) =>
      a.ruleVersion.localeCompare(b.ruleVersion, undefined, { numeric: true }) ||
      a.createdAt.localeCompare(b.createdAt),
    )
}

export function passportByNo(passportNo: string): PackagePassport | null {
  return passportStore().passports[passportNo] ?? null
}

export function allPassports(): PackagePassport[] {
  return Object.values(passportStore().passports)
}

export function markAccepted(passportNo: string, at: string, actor: string): void {
  const store = clone(passportStore())
  store.accepted[passportNo] = { at, actor }
  persist(store)
}
