import { listEntries } from '@/api/local-service'
import {
  buildConditionCard,
  buildPackagePassport,
  conditionCardSignature,
  nextVersionLabel,
  qualityVerdict,
  repairMissingRows,
  restoreOriginalInput,
  reviewVersion,
  admissionVerdict,
} from '@/data/cleanse-engine'
import {
  addInput,
  allPassports,
  findVersion,
  latestVersionOf,
  lookupPassport,
  markAccepted,
  passportByNo,
  passportStore,
  replacePassportStore,
  savePassport,
  passportsForPackage,
  saveVersion,
  versionsOf,
} from '@/data/cleanse-ledger'
import type {
  ActionResultWithPassport,
  AdmissionVerdict,
  CleanseInput,
  CleanseSample,
  PackagePassport,
  RuleVersionSnapshot,
  VersionReview,
} from '@/data/cleanse-passport.types'
import { saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { digestOf, nowStamp } from '@/utils/passport'

export const CLEANSE_ACTOR = '值班管理员'

function cleanseRules(): EntryRow[] {
  return listEntries('cleanse').items
}

export function ruleById(ruleId: number): EntryRow | null {
  return cleanseRules().find((row) => Number(row.id) === ruleId) ?? null
}

/** 规则行上的版本若形如 v1.0 就沿用，否则从 v1.0 起编。 */
function initialVersionLabel(rule: EntryRow): string {
  const label = String(rule['规则版本'] ?? '').trim()
  return /^v\d+\.\d+$/.test(label) ? label : 'v1.0'
}

function snapshotFromRule(rule: EntryRow, version: string): RuleVersionSnapshot {
  return {
    version,
    ruleId: Number(rule.id),
    ruleCode: String(rule['规则编号'] ?? `CLEA-${String(rule.id).padStart(4, '0')}`),
    inputTable: String(rule['输入表名'] ?? ''),
    outputTable: String(rule['目标表名'] ?? ''),
    nullHandling: String(rule['空值处理'] ?? ''),
    formatCheck: String(rule['格式校验'] ?? ''),
    abnormalThreshold: String(rule['异常阈值'] ?? ''),
    conditionCard: buildConditionCard(rule),
    createdAt: nowStamp(),
    active: true,
  }
}

/** 让规则至少有一个版本快照；已有快照时原样返回。 */
export function ensureVersion(rule: EntryRow): RuleVersionSnapshot {
  const existing = latestVersionOf(Number(rule.id))
  if (existing) {
    return existing
  }
  const snapshot = snapshotFromRule(rule, initialVersionLabel(rule))
  saveVersion(snapshot.ruleId, snapshot)
  return snapshot
}

export function listVersions(ruleId: number): RuleVersionSnapshot[] {
  return versionsOf(ruleId)
}

/** 当前可用于签发新护照的版本：最新的 active 版本。 */
export function activeVersion(ruleId: number): RuleVersionSnapshot | null {
  const list = versionsOf(ruleId)
  if (!list.length) {
    const rule = ruleById(ruleId)
    return rule ? ensureVersion(rule) : null
  }
  return [...list].reverse().find((item) => item.active) ?? list[list.length - 1]
}

function setRuleVersionLabel(ruleId: number, label: string): void {
  const rows = cleanseRules()
  const index = rows.findIndex((row) => Number(row.id) === ruleId)
  if (index < 0) {
    return
  }
  // 只更新规则行的版本展示字段；状态流转仍由 local-service 负责。
  const next = [...rows]
  next[index] = { ...next[index], 规则版本: label }
  saveRows('cleanse', next)
}

/**
 * 生成候选清洗版本：只新增快照并把旧版本标记为只读，旧包仍凭各自快照还原。
 * 候选版本允许调整阈值与空值填充口径，但不会重写任何已有护照。
 */
export function createCandidateVersion(
  ruleId: number,
  changes: { abnormalThreshold?: string; nullFill?: string; note?: string },
): { ok: boolean; message: string; snapshot?: RuleVersionSnapshot } {
  const rule = ruleById(ruleId)
  if (!rule) {
    return { ok: false, message: `没有找到编号为 ${ruleId} 的清洗规则` }
  }
  const current = ensureVersion(rule)
  const baseRule: EntryRow = { ...rule }
  if (changes.abnormalThreshold !== undefined) {
    baseRule['异常阈值'] = changes.abnormalThreshold
  }
  if (changes.nullFill !== undefined) {
    baseRule['空值处理'] = changes.nullFill
  }
  const card = buildConditionCard(baseRule)
  if (changes.note) {
    card.caliber.note = changes.note
  }
  if (conditionCardSignature(card) === conditionCardSignature(current.conditionCard)) {
    return { ok: false, message: '条件卡没有实质变化，未生成候选版本' }
  }
  const label = nextVersionLabel(listVersions(ruleId))
  const snapshot: RuleVersionSnapshot = { ...snapshotFromRule(baseRule, label), conditionCard: card }
  for (const item of versionsOf(ruleId)) {
    saveVersion(ruleId, { ...item, active: false })
  }
  saveVersion(ruleId, snapshot)
  setRuleVersionLabel(ruleId, label)
  return {
    ok: true,
    message: `已生成候选清洗版本 ${label}，新包按该版本签发护照，已存在的 ${current.version} 护照保持原样`,
    snapshot,
  }
}

// ---------------------------------------------------------------- 样本批次

export type SampleBatchKind = 'clean' | 'mixed' | 'light'

const FIXTURES: Record<SampleBatchKind, Record<string, string>[]> = {
  // 全部通过：用于完整护照包
  clean: [
    { 客户编号: 'kl-2001', 手机号: '138-0000-2001', 邮箱: 'Grace@Example.com ', 金额: '66.00', 状态: '有效', 地区: ' 华东 ' },
    { 客户编号: 'MN-2002', 手机号: '13900002002', 邮箱: 'henry@example.com', 金额: '0', 状态: '待激活', 地区: '华南' },
    { 客户编号: 'op-2003', 手机号: '137-0000-2003', 邮箱: 'IVY@example.com', 金额: '1000', 状态: '停用', 地区: '华北' },
    { 客户编号: 'QR-2004', 手机号: '13600002004', 邮箱: 'jack@example.com', 金额: '18.80', 状态: '有效', 地区: '西北' },
  ],
  // 6 行 3 行异常（越界/枚举外/缺主键），异常率 50%，触发阻断
  mixed: [
    { 客户编号: 'ab-1001', 手机号: '138-0000-0001', 邮箱: 'Alice@Example.COM ', 金额: '120.50', 状态: '有效', 地区: ' 华东 ' },
    { 客户编号: 'CD-1002', 手机号: '', 邮箱: 'bob@example.com', 金额: '88', 状态: '待激活', 地区: '华南' },
    { 客户编号: 'ef-1003', 手机号: '13900000003', 邮箱: 'carol@example.com', 金额: '250000', 状态: '停用', 地区: '华北' },
    { 客户编号: 'GH-1004', 手机号: '13700000004', 邮箱: 'dave@example.com', 金额: '560.00', 状态: '未知', 地区: '西南' },
    { 客户编号: '', 手机号: '13600000005', 邮箱: 'erin@example.com', 金额: '42', 状态: '有效', 地区: '东北' },
    { 客户编号: 'IJ-1006', 手机号: '135-0000-0006', 邮箱: 'frank@example.com', 金额: '999', 状态: '有效', 地区: '华中' },
  ],
  // 5 行 1 行异常（越界），异常率 20% 低于阈值，隔离样本留存但整包可流转
  light: [
    { 客户编号: 'st-3001', 手机号: '138-0000-3001', 邮箱: 'kate@example.com ', 金额: '36.00', 状态: '有效', 地区: ' 华东 ' },
    { 客户编号: 'UV-3002', 手机号: '13900003002', 邮箱: 'Leo@example.com', 金额: '240000', 状态: '停用', 地区: '华南' },
    { 客户编号: 'wx-3003', 手机号: '137-0000-3003', 邮箱: 'mia@example.com', 金额: '520', 状态: '待激活', 地区: '华北' },
    { 客户编号: 'YZ-3004', 手机号: '13600003004', 邮箱: 'nina@example.com', 金额: '9.90', 状态: '有效', 地区: '西南' },
    { 客户编号: 'AC-3005', 手机号: '135-0000-3005', 邮箱: 'omar@example.com', 金额: '1800', 状态: '停用', 地区: '东北' },
  ],
}

export function sampleBatch(kind: SampleBatchKind): CleanseSample[] {
  return FIXTURES[kind].map((values, index) => ({ rowNo: index + 1, values: { ...values } }))
}

export function createSampleInput(
  ruleId: number,
  kind: SampleBatchKind,
  options: { interruptRows?: number[]; source?: string; packageKey?: string } = {},
): { ok: boolean; message: string; input?: CleanseInput } {
  const rule = ruleById(ruleId)
  if (!rule) {
    return { ok: false, message: `没有找到编号为 ${ruleId} 的清洗规则` }
  }
  ensureVersion(rule)
  const ruleCode = String(rule['规则编号'] ?? `CLEA-${String(ruleId).padStart(4, '0')}`)
  const count = Object.values(passportStore().inputs).filter((input) => input.ruleId === ruleId).length + 1
  const packageKey = options.packageKey ?? `PKG-${ruleCode}-${String(count).padStart(2, '0')}`
  const samples = sampleBatch(kind)
  const input: CleanseInput = {
    id: `IN-${digestOf({ packageKey, ruleId, sample: samples, at: Date.now() })}`,
    packageKey,
    ruleId,
    samples,
    submittedAt: nowStamp(),
    source: options.source ?? CLEANSE_ACTOR,
    failRowNos: options.interruptRows,
    failReason: options.interruptRows?.length ? '清洗实例在签发这些行时超时退出，未完成盖章' : undefined,
  }
  addInput(input)
  return {
    ok: true,
    message: `已登记样本包 ${packageKey}（${
      kind === 'clean' ? '全部合规' : kind === 'mixed' ? '高异常' : '少量异常'
    }，${samples.length} 行）`,
    input,
  }
}

export function listInputs(ruleId: number): CleanseInput[] {
  return Object.values(passportStore().inputs)
    .filter((input) => input.ruleId === ruleId)
    .sort((a, b) => a.packageKey.localeCompare(b.packageKey))
}

export function inputById(inputId: string): CleanseInput | null {
  return passportStore().inputs[inputId] ?? null
}

// ---------------------------------------------------------------- 处理与补齐

/**
 * 处理样本包：
 * - 不指定版本时按「包」判定：该包已有护照就直接返回原护照号，不改用当前版本；
 * - 指定版本时按「包 + 清洗版本」判定，供候选版本为新护照重签使用。
 * 首次处理可按登记的中断行留下未盖章样本。
 */
export function processInput(inputId: string, versionOverride?: string): ActionResultWithPassport {
  const input = inputById(inputId)
  if (!input) {
    return { ok: false, message: '没有找到该样本包' }
  }
  const rule = ruleById(input.ruleId)
  if (!rule) {
    return { ok: false, message: `没有找到编号为 ${input.ruleId} 的清洗规则` }
  }
  if (!versionOverride) {
    ensureVersion(rule)
    const previous = passportsForPackage(input.packageKey).slice(-1)[0] ?? null
    if (previous) {
      const at = nowStamp()
      const touched: PackagePassport = {
        ...previous,
        trace: [
          ...previous.trace,
          {
            at,
            action: '重复处理',
            actor: CLEANSE_ACTOR,
            detail: `命中已有护照 ${previous.passportNo}（包 ${input.packageKey} / ${previous.ruleVersion}），返回原护照号，未重新盖章`,
          },
        ],
      }
      savePassport(touched)
      return {
        ok: true,
        reused: true,
        message:
          previous.missingRows > 0
            ? `样本包 ${input.packageKey} 已有护照 ${previous.passportNo}，但仍有 ${previous.missingRows} 行未盖章，请补齐后再流转`
            : `样本包 ${input.packageKey} 已处理过，返回原护照号 ${previous.passportNo}`,
        passport: touched,
      }
    }
  }
  const snapshot = versionOverride ? findVersion(input.ruleId, versionOverride) : activeVersion(input.ruleId)
  if (!snapshot) {
    return { ok: false, message: `清洗版本 ${versionOverride ?? ''} 不存在，无法处理样本包` }
  }
  if (!snapshot.active) {
    return { ok: false, message: `清洗版本 ${snapshot.version} 已只读，不能为新包签发护照；历史护照仍可查看和还原` }
  }
  const existing = lookupPassport(input.packageKey, snapshot.version)
  if (existing) {
    const at = nowStamp()
    const touched: PackagePassport = {
      ...existing,
      trace: [
        ...existing.trace,
        {
          at,
          action: '重复处理',
          actor: CLEANSE_ACTOR,
          detail: `命中已有护照 ${existing.passportNo}（包 ${input.packageKey} / ${snapshot.version}），未重新盖章`,
        },
      ],
    }
    savePassport(touched)
    return {
      ok: true,
      reused: true,
      message: `样本包 ${input.packageKey} 已按 ${snapshot.version} 处理过，返回原护照号 ${existing.passportNo}`,
      passport: touched,
    }
  }
  const at = nowStamp()
  const passport = buildPackagePassport(input, snapshot, at, {
    interruptedRowNos: input.failRowNos,
    failReason: input.failReason,
  })
  const otherVersions = allPassports().filter(
    (item) => item.packageKey === input.packageKey && item.ruleVersion !== snapshot.version,
  )
  passport.trace = [
    ...passport.trace,
    ...otherVersions.map((item) => ({
      at,
      action: '版本并存',
      actor: CLEANSE_ACTOR,
      detail: `同一包在 ${item.ruleVersion} 下已有护照 ${item.passportNo}，本次按 ${snapshot.version} 另行签发新护照`,
    })),
  ]
  savePassport(passport)
  if (passport.missingRows > 0) {
    return {
      ok: false,
      message: `护照 ${passport.passportNo} 已签发，但有 ${passport.missingRows} 行未盖章，需补齐后才能流转`,
      passport,
    }
  }
  return { ok: true, message: `护照 ${passport.passportNo} 已签发（${snapshot.version}）`, passport }
}

/** 失败后补齐：只对 missing 行盖章，已通过/已隔离行保持原护照。 */
export function repairPackage(passportNo: string): ActionResultWithPassport {
  const passport = passportByNo(passportNo)
  if (!passport) {
    return { ok: false, message: `没有找到护照 ${passportNo}` }
  }
  if (passport.missingRows === 0) {
    return { ok: false, message: `护照 ${passportNo} 没有未盖章样本，无需补齐`, passport }
  }
  const repaired = repairMissingRows(passport, nowStamp(), CLEANSE_ACTOR)
  savePassport(repaired)
  return {
    ok: true,
    message: `已补齐 ${passport.missingRows} 行未盖章样本，护照号仍为 ${repaired.passportNo}，已通过行未重制`,
    passport: repaired,
  }
}

/** 重复处理已有护照：返回原护照号，只追加一次尝试轨迹。 */
export function reprocessPassport(passportNo: string): ActionResultWithPassport {
  const passport = passportByNo(passportNo)
  if (!passport) {
    return { ok: false, message: `没有找到护照 ${passportNo}` }
  }
  const at = nowStamp()
  const touched: PackagePassport = {
    ...passport,
    trace: [
      ...passport.trace,
      { at, action: '重复处理', actor: CLEANSE_ACTOR, detail: `返回原护照号 ${passport.passportNo}，未重新盖章` },
    ],
  }
  savePassport(touched)
  return { ok: true, reused: true, message: `重复处理请求命中护照 ${passportNo}，返回原护照号`, passport: touched }
}

// ---------------------------------------------------------------- 查询、质量与回看

export function listPassports(ruleId?: number): PackagePassport[] {
  const list = allPassports()
  return (ruleId === undefined ? list : list.filter((item) => item.ruleId === ruleId)).sort(
    (a, b) => a.packageKey.localeCompare(b.packageKey) || a.ruleVersion.localeCompare(b.ruleVersion),
  )
}

export function getPassport(passportNo: string): PackagePassport | null {
  return passportByNo(passportNo)
}

export function passportQuality(passportNo: string): ReturnType<typeof qualityVerdict> | null {
  const passport = passportByNo(passportNo)
  return passport ? qualityVerdict(passport) : null
}

export function passportAdmission(passportNo: string): AdmissionVerdict | null {
  const passport = passportByNo(passportNo)
  if (!passport) {
    return null
  }
  const latest = activeVersion(passport.ruleId)
  return admissionVerdict(passport, latest?.version ?? null)
}

export function reviewPassportVersion(passportNo: string): VersionReview | null {
  const passport = passportByNo(passportNo)
  if (!passport) {
    return null
  }
  const latest = activeVersion(passport.ruleId)
  return reviewVersion(passport, latest?.version ?? null)
}

export function restorePassport(passportNo: string) {
  const passport = passportByNo(passportNo)
  if (!passport) {
    return null
  }
  return restoreOriginalInput(passport, inputById(passport.inputId))
}

/** 转换编排接收护照包：准入不通过就不登记接收。 */
export function admitPassport(passportNo: string): ActionResultWithPassport {
  const passport = passportByNo(passportNo)
  if (!passport) {
    return { ok: false, message: `没有找到护照 ${passportNo}` }
  }
  const verdict = passportAdmission(passportNo)
  if (!verdict || !verdict.accepted) {
    return {
      ok: false,
      message: `护照包 ${passportNo} 未通过准入：${verdict?.reasons.join('；') || '未知原因'}`,
      passport,
    }
  }
  if (passportStore().accepted[passportNo]) {
    return { ok: true, reused: true, message: `护照包 ${passportNo} 已在转换编排中接收，无需重复接收`, passport }
  }
  markAccepted(passportNo, nowStamp(), CLEANSE_ACTOR)
  const touched: PackagePassport = {
    ...passport,
    trace: [
      ...passport.trace,
      { at: nowStamp(), action: '接收', actor: CLEANSE_ACTOR, detail: '转换编排准入通过，护照包已接收' },
    ],
  }
  savePassport(touched)
  return { ok: true, message: `护照包 ${passportNo} 已接收进转换编排（${passport.ruleVersion}）`, passport: touched }
}

export function acceptedMap(): Record<string, { at: string; actor: string }> {
  return passportStore().accepted
}

// ---------------------------------------------------------------- 播种

function seedPackage(
  rule: EntryRow,
  packageKey: string,
  kind: SampleBatchKind,
  submittedAt: string,
  interrupted?: number[],
): PackagePassport {
  const snapshot = ensureVersion(rule)
  const ruleCode = String(rule['规则编号'] ?? `CLEA-${String(rule.id).padStart(4, '0')}`)
  const input: CleanseInput = {
    id: `IN-SEED-${packageKey}`,
    packageKey,
    ruleId: Number(rule.id),
    samples: sampleBatch(kind),
    submittedAt,
    source: '示例数据',
    failRowNos: interrupted,
    failReason: interrupted?.length ? '清洗实例在签发这些行时超时退出，未完成盖章' : undefined,
  }
  addInput(input)
  const passport = buildPackagePassport(input, snapshot, submittedAt, {
    interruptedRowNos: interrupted,
    failReason: input.failReason,
  })
  passport.trace = [
    ...passport.trace,
    { at: submittedAt, action: '登记', actor: '示例数据', detail: `样本包 ${ruleCode} / ${packageKey} 导入清洗加工` },
  ]
  savePassport(passport)
  return passport
}

/**
 * 首次打开时播种护照样例（只在账本为空时执行一次）：
 * - 规则 1 包 01（少量异常）：完整护照，可用作准入演示；包 02（全部合规）盖章中断，留待补齐
 * - 规则 2 包 01（高异常）：完整但质量阻断
 * - 规则 3 包 01（全部合规）：完整护照，可重复处理演示
 */
export function ensureCleanseSeed(): void {
  const store = passportStore()
  if (store.initialized) {
    return
  }
  const rules = cleanseRules()
  if (!rules.length) {
    return
  }
  const rule = (id: number) => rules.find((row) => Number(row.id) === id) ?? null
  const seededAt = '2026-11-12 09:30:00'
  const rule1 = rule(1)
  const rule2 = rule(2)
  const rule3 = rule(3)
  if (rule1) {
    seedPackage(rule1, 'PKG-CLEA-0001-01', 'light', seededAt)
    seedPackage(rule1, 'PKG-CLEA-0001-02', 'clean', '2026-11-12 10:05:00', [2])
  }
  if (rule2) {
    seedPackage(rule2, 'PKG-CLEA-0002-01', 'mixed', '2026-11-12 10:20:00')
  }
  if (rule3) {
    const accepted = seedPackage(rule3, 'PKG-CLEA-0003-01', 'clean', '2026-11-12 10:40:00')
    // 规则 3 的完整护照包在示例里已接收，用来演示转换节点的准入闸门。
    markAccepted(accepted.passportNo, '2026-11-12 10:45:00', '示例数据')
  }
  replacePassportStore({ ...passportStore(), initialized: true })
}
