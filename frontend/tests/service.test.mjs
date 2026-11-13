import assert from 'node:assert/strict'

import { ensureCleanseSeed } from '../src/api/cleanse-service.ts'
import * as svc from '../src/api/cleanse-service.ts'
import { transformGate } from '../src/data/transform-gate.ts'
import { passportStore } from '../src/data/cleanse-ledger.ts'

ensureCleanseSeed()

const seeded = svc.listPassports()
assert.equal(seeded.length, 4, '种子应生成 4 个护照包')
const interrupted = seeded.find((item) => item.packageKey === 'PKG-CLEA-0001-02')
assert.ok(interrupted)
assert.equal(interrupted.missingRows, 1)
assert.equal(interrupted.complete, false)

// 1. 重复处理同一包：返回原护照号，行护照不变
const inputs = svc.listInputs(1)
const cleanInput = inputs.find((item) => item.packageKey === 'PKG-CLEA-0001-01')
const first = svc.processInput(cleanInput.id)
assert.equal(first.reused, true)
assert.equal(first.passport.passportNo, seeded.find((p) => p.packageKey === 'PKG-CLEA-0001-01').passportNo)
assert.ok(first.message.includes('返回原护照号'))

// 1b. 不指定版本的重复处理按「包」判定：同一包只返回一张原护照号
const samePackage = svc.listPassports(1).filter((item) => item.packageKey === 'PKG-CLEA-0001-01')
assert.equal(samePackage.length, 1)

// 2. 补齐未盖章样本：只补 missing 行
const beforeRepair = interrupted.rows[0].passportNo
const repaired = svc.repairPackage(interrupted.passportNo)
assert.equal(repaired.ok, true)
assert.ok(repaired.passport.complete)
assert.equal(repaired.passport.rows[0].passportNo, beforeRepair, '已通过行不重制')
assert.match(repaired.message, /已通过行未重制/)
assert.equal(svc.repairPackage(interrupted.passportNo).ok, false, '无未盖章行时拒绝补齐')

// 3. 高异常包质量阻断，且不能准入
const dirty = seeded.find((item) => item.packageKey === 'PKG-CLEA-0002-01')
assert.equal(svc.passportQuality(dirty.passportNo).blocked, true)
assert.equal(svc.passportAdmission(dirty.passportNo).accepted, false)
assert.equal(svc.admitPassport(dirty.passportNo).ok, false)

// 4. 完整低异常包可准入；重复准入返回原护照号且不重盖章
const light = seeded.find((item) => item.packageKey === 'PKG-CLEA-0001-01')
assert.equal(svc.passportQuality(light.passportNo).blocked, false)
const admitted = svc.admitPassport(light.passportNo)
assert.equal(admitted.ok, true)
const reAdmitted = svc.admitPassport(light.passportNo)
assert.equal(reAdmitted.reused, true)
assert.equal(svc.acceptedMap()[light.passportNo] !== undefined, true)

// 5. 转换编排闸门：输入表由清洗产出时，必须已接收同版本护照包
assert.equal(transformGate('下游未接入表').ok, true)
const gateForDwd = transformGate(light.outputTable)
assert.equal(gateForDwd.ok, true)
assert.match(gateForDwd.message, /已接收护照包/)

// 6. 候选版本：生成新版本；旧包版本号与条件卡不变
const beforeCard = JSON.stringify(svc.getPassport(light.passportNo).conditionCard)
const candidate = svc.createCandidateVersion(1, { abnormalThreshold: '40%' })
assert.equal(candidate.ok, true)
assert.equal(candidate.snapshot.version, 'v1.1')
assert.equal(JSON.stringify(svc.getPassport(light.passportNo).conditionCard), beforeCard, '旧包条件卡不被改写')
assert.equal(svc.getPassport(light.passportNo).ruleVersion, 'v1.0')

// 7a. 候选版本之后，不指定版本的重复处理仍返回原护照号（不切到新版本）
const idempotent = svc.processInput(cleanInput.id)
assert.equal(idempotent.reused, true)
assert.equal(idempotent.passport.ruleVersion, 'v1.0')
assert.equal(idempotent.passport.passportNo, light.passportNo)

// 7. 旧版本只读：不能为新包签发护照
const frozen = svc.processInput(cleanInput.id, 'v1.0')
assert.equal(frozen.ok, false)
assert.match(frozen.message, /已只读/)

// 8. 新版本处理新包 → 新护照号，旧包仍可还原
const created = svc.createSampleInput(1, 'light')
assert.equal(created.ok, true)
const fresh = svc.processInput(created.input.id)
assert.equal(fresh.ok, true)
assert.notEqual(fresh.passport.passportNo, light.passportNo)
assert.equal(fresh.passport.ruleVersion, 'v1.1')
const restored = svc.restorePassport(light.passportNo)
assert.equal(restored.ruleVersion, 'v1.0')
assert.equal(restored.samples.length, light.rows.length)
assert.ok(restored.trace.length >= 1)

// 9. 回看版本：旧包按自身版本核对
const review = svc.reviewPassportVersion(light.passportNo)
assert.equal(review.packageVersion, 'v1.0')
assert.equal(review.currentVersion, 'v1.1')
assert.equal(review.match, false)

// 10. 台账里同一包可有多个版本护照
const versionsOfPackage = svc
  .listPassports(1)
  .filter((item) => item.packageKey === light.packageKey)
  .map((item) => item.ruleVersion)
assert.deepEqual([...new Set(versionsOfPackage)].sort(), ['v1.0'])

// 11. 护照账本持久化结构保持
assert.equal(passportStore().schema, 1)
assert.equal(passportStore().initialized, true)

console.log('service tests: all passed')
