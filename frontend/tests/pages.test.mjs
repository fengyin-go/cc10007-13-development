import assert from 'node:assert/strict'

import { closeHarness, renderToSSR } from './ssr-harness.mjs'

// 页面级冒烟：把清洗加工 / 质量校验 / 转换编排三个页面渲染一遍。
// onMounted 在 SSR 下不执行，因此另渲染两个护照展示组件，并用真实播种数据喂 props，
// 确保模板里的方法、计算属性与数据绑定都能被真实求值，任何运行时异常都会以非零退出码暴露。
const pages = ['./src/views/cleanse/index.vue', './src/views/quality/index.vue', './src/views/transform/index.vue']

for (const page of pages) {
  const html = await renderToSSR(page)
  assert.ok(html.includes('class="page"'), `${page} 未渲染出页面容器`)
  assert.ok(html.length > 800, `${page} 渲染结果过短`)
  console.log(`rendered ok: ${page} (${html.length} chars)`)
}

const detailHtml = await renderToSSR('./src/components/passport/PassportDetail.vue')
assert.ok(detailHtml.length > 5000, '护照详情组件渲染过短')
assert.ok(detailHtml.includes('PASS') || detailHtml.includes('FMT') || detailHtml.includes('RANGE'), '缺少判定码')
assert.ok(detailHtml.includes('质量校验（按护照计算）'))
assert.ok(detailHtml.includes('缺席理由'))
assert.ok(detailHtml.includes('本包固化的条件卡'))
console.log(`rendered ok: PassportDetail (${detailHtml.length} chars)`)

const cardHtml = await renderToSSR('./src/components/passport/ConditionCardView.vue')
assert.ok(cardHtml.includes('异常率阻断阈值'))
assert.ok(cardHtml.includes('判定规则'))
assert.ok(cardHtml.includes('允许范围'))
console.log(`rendered ok: ConditionCardView (${cardHtml.length} chars)`)

await closeHarness()
console.log('page smoke tests: all passed')
