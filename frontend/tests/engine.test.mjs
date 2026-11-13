// 行护照引擎的行为验证：不依赖浏览器，用 node 跑。
// 运行：node tests/run-engine-tests.mjs（内部用 esbuild 打包后执行）
import assert from 'node:assert/strict'

import {
  buildConditionCard,
  buildPackagePassport,
  nextVersionLabel,
  qualityVerdict,
  repairMissingRows,
  settlePassport,
  admissionVerdict,
  reviewVersion,
  cleanseSample,
  parseThreshold,
  parseNullFill,
} from '../src/data/cleanse-engine.ts'

const rule = {
  id: 1,
  status: '已启用',
  pending: false,
  abnormal: false,
  规则编号: 'CLEA-0001',
  输入表名: 'ods_customer',
  目标表名: 'dwd_customer',
  空值处理: '空值填充:UNKNOWN',
  格式校验: '去空白/手机号取数字/邮箱小写',
  异常阈值: '25%',
  规则版本: 'v1.0',
  生效日期: '2026-09-01',
}

const card = buildConditionCard(rule)
const snapshot = {
  version: 'v1.0',
  ruleId: 1,
  ruleCode: 'CLEA-0001',
  inputTable: 'ods_customer',
  outputTable: 'dwd_customer',
  nullHandling: '空值填充:UNKNOWN',
  formatCheck: '去空白/手机号取数字/邮箱小写',
  abnormalThreshold: '25%',
  conditionCard: card,
  createdAt: '2026-01-01 00:00:00',
  active: true,
}

function input(samples, key = 'PKG-A') {
  return {
    id: `IN-${key}`,
    packageKey: key,
    ruleId: 1,
    samples,
    submittedAt: '2026-01-01 00:00:00',
    source: '测试',
  }
}

const cleanSamples = [
  { rowNo: 1, values: { 客户编号: 'ab-1001', 手机号: '138-0000-0001', 邮箱: 'A@Example.COM ', 金额: '12', 状态: '有效', 地区: ' 华东 ' } },
  { rowNo: 2, values: { 客户编号: 'CD-1002', 手机号: '', 邮箱: 'b@example.com', 金额: '8', 状态: '待激活', 地区: '华南' } },
]

// 1. 阈值与填充口径解析
assert.equal(parseThreshold('25%'), 0.25)
assert.equal(parseThreshold('0.3'), 0.3)
assert.equal(parseThreshold('30'), 0.3)
assert.equal(parseThreshold('清洗加工样例2'), 0.25)
assert.equal(parseNullFill('空值填充:UNKNOWN'), 'UNKNOWN')
assert.equal(parseNullFill('清洗加工样例2'), 'UNKNOWN')

// 2. 空值替换 + 格式规范化
const filled = cleanseSample(cleanSamples[1], card)
assert.equal(filled.quarantined, false)
assert.equal(filled.output['手机号'], 'UNKNOWN')
assert.equal(filled.code, 'FILL')
const normalized = cleanseSample(cleanSamples[0], card)
assert.equal(normalized.output['客户编号'], 'AB-1001')
assert.equal(normalized.output['邮箱'], 'a@example.com')
assert.equal(normalized.output['地区'], '华东')
assert.equal(normalized.code, 'FMT')

// 3. 越界 / 枚举外 / 缺主键 → 隔离并写明缺席理由
const overLimit = cleanseSample(
  { rowNo: 3, values: { 客户编号: 'EF-1003', 手机号: '13900000003', 邮箱: 'c@example.com', 金额: '250000', 状态: '停用', 地区: '华北' } },
  card,
)
assert.equal(overLimit.quarantined, true)
assert.equal(overLimit.code, 'RANGE')
assert.match(overLimit.absentReason, /超出允许范围/)

const badEnum = cleanseSample(
  { rowNo: 4, values: { 客户编号: 'GH-1004', 手机号: '13700000004', 邮箱: 'd@example.com', 金额: '10', 状态: '未知', 地区: '西南' } },
  card,
)
assert.equal(badEnum.code, 'ENUM')

const noKey = cleanseSample(
  { rowNo: 5, values: { 客户编号: '', 手机号: '13600000005', 邮箱: 'e@example.com', 金额: '10', 状态: '有效', 地区: '东北' } },
  card,
)
assert.equal(noKey.quarantined, true)
assert.match(noKey.absentReason, /主键/)

// 4. 护照号确定性：同一输入重复构建得到同一护照号
const pkgA = buildPackagePassport(input(cleanSamples), snapshot, '2026-01-01 10:00:00')
const pkgARepeat = buildPackagePassport(input(cleanSamples), snapshot, '2026-02-02 10:00:00')
assert.equal(pkgA.passportNo, pkgARepeat.passportNo)
assert.equal(pkgA.contentDigest, pkgARepeat.contentDigest)

// 5. 行护照带指纹、版本、判定码；隔离行有缺席理由
for (const row of pkgA.rows) {
  assert.ok(row.passportNo.startsWith('ROW-'))
  assert.equal(row.ruleVersion, 'v1.0')
  assert.ok(row.sourceFingerprint.startsWith('fp-'))
  assert.ok(row.decisionCode)
}
assert.equal(pkgA.complete, true)
assert.equal(pkgA.missingRows, 0)
assert.equal(pkgA.quarantinedRows, 0)
assert.equal(pkgA.stampedRows, 2)

// 6. 未盖章样本：补齐只补 missing，已通过行护照号不变
const interrupted = buildPackagePassport(input(cleanSamples), snapshot, '2026-01-01 10:00:00', {
  interruptedRowNos: [2],
  failReason: '实例超时',
})
assert.equal(interrupted.missingRows, 1)
assert.equal(interrupted.complete, false)
assert.equal(interrupted.rows[1].passportNo, '')
assert.equal(interrupted.rows[1].absentReason, '实例超时')
const before = interrupted.rows[0].passportNo
const repaired = repairMissingRows(interrupted, '2026-01-01 11:00:00', '测试')
assert.equal(repaired.rows[0].passportNo, before)
assert.equal(repaired.missingRows, 0)
assert.equal(repaired.complete, true)
assert.ok(repaired.rows[1].passportNo.startsWith('ROW-'))

// 7. 质量阻断：高异常率超过阈值
const dirtySamples = [
  ...cleanSamples,
  { rowNo: 3, values: { 客户编号: 'EF-1003', 手机号: '13900000003', 邮箱: 'c@example.com', 金额: '250000', 状态: '停用', 地区: '华北' } },
  { rowNo: 4, values: { 客户编号: 'GH-1004', 手机号: '13700000004', 邮箱: 'd@example.com', 金额: '10', 状态: '未知', 地区: '西南' } },
]
const dirty = buildPackagePassport(input(dirtySamples, 'PKG-B'), snapshot, '2026-01-01 10:00:00')
assert.equal(dirty.quarantinedRows, 2)
assert.equal(dirty.complete, true)
const dirtyVerdict = qualityVerdict(dirty)
assert.equal(dirtyVerdict.blocked, true)
assert.ok(dirtyVerdict.reasons.some((reason) => reason.includes('异常率')))
assert.ok(dirty.rows.filter((row) => row.status === 'quarantined').every((row) => row.absentReason.length > 0))

// 8. 低异常率可放行，但隔离样本仍保留缺席理由
const lightSamples = [
  ...cleanSamples,
  { rowNo: 3, values: { 客户编号: 'EF-1003', 手机号: '13900000003', 邮箱: 'c@example.com', 金额: '250000', 状态: '停用', 地区: '华北' } },
  { rowNo: 4, values: { 客户编号: 'GH-1004', 手机号: '13700000004', 邮箱: 'd@example.com', 金额: '10', 状态: '有效', 地区: '西南' } },
  { rowNo: 5, values: { 客户编号: 'IJ-1005', 手机号: '13600000005', 邮箱: 'e@example.com', 金额: '10', 状态: '有效', 地区: '东北' } },
  { rowNo: 6, values: { 客户编号: 'KL-1006', 手机号: '13500000006', 邮箱: 'f@example.com', 金额: '10', 状态: '有效', 地区: '华中' } },
  { rowNo: 7, values: { 客户编号: 'MN-1007', 手机号: '13500000007', 邮箱: 'g@example.com', 金额: '10', 状态: '有效', 地区: '华中' } },
  { rowNo: 8, values: { 客户编号: 'OP-1008', 手机号: '13500000008', 邮箱: 'h@example.com', 金额: '10', 状态: '有效', 地区: '华中' } },
]
const light = buildPackagePassport(input(lightSamples, 'PKG-C'), snapshot, '2026-01-01 10:00:00')
const lightVerdict = qualityVerdict(light)
assert.equal(lightVerdict.blocked, false)
assert.equal(light.quarantinedRows, 1)
assert.ok(light.rows.find((row) => row.rowNo === 3).absentReason.length > 0)

// 9. 准入：完整且同版本才可接收
assert.equal(admissionVerdict(light, 'v1.0').accepted, true)
assert.equal(admissionVerdict(interrupted, 'v1.0').accepted, false)
assert.equal(admissionVerdict(dirty, 'v1.0').accepted, false)
assert.equal(admissionVerdict({ ...light, rows: light.rows.map((row) => ({ ...row, ruleVersion: 'v1.1' })) }, 'v1.0').accepted, false)

// 10. 回看版本：旧包以自身固化版本为准
const review = reviewVersion(light, 'v1.2')
assert.equal(review.match, false)
assert.equal(review.packageVersion, 'v1.0')
assert.match(review.note, /旧包不受新版本影响/)
assert.equal(reviewVersion(light, 'v1.0').match, true)

// 11. 版本号递增
assert.equal(nextVersionLabel([]), 'v1.0')
assert.equal(nextVersionLabel([{ version: 'v1.0' }]), 'v1.1')
assert.equal(nextVersionLabel([{ version: 'v1.0' }, { version: 'v1.1' }]), 'v1.2')

// 12. 指纹篡改会被质量校验识别
const tampered = { ...light, rows: light.rows.map((row) => ({ ...row })) }
tampered.rows[0].raw = { ...tampered.rows[0].raw, 金额: '999999' }
assert.equal(qualityVerdict(tampered).blocked, true)

// 13. settle 在隔离行缺少缺席理由时阻断
const badReason = settlePassport({
  ...light,
  rows: light.rows.map((row) => (row.status === 'quarantined' ? { ...row, absentReason: '' } : row)),
})
assert.equal(badReason.blocked, true)
assert.equal(badReason.complete, false)

console.log('engine tests: all passed')
