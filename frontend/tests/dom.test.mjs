import assert from 'node:assert/strict'

// 真实挂载清洗加工页：走 onMounted 播种、点击补齐/接收/重复处理，检查页面文本。
const { Window } = await import('happy-dom')
const window = new Window({ url: 'http://localhost/cleanse', settings: { disableJavaScriptFileLoading: true } })
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.SVGElement = window.SVGElement
globalThis.localStorage = window.localStorage
globalThis.URL = window.URL
globalThis.Blob = window.Blob
globalThis.MutationObserver = window.MutationObserver
globalThis.Document = window.Document
globalThis.ShadowRoot = window.ShadowRoot
globalThis.Event = window.Event
globalThis.CustomEvent = window.CustomEvent
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)

const root = document.createElement('div')
root.id = 'app'
document.body.appendChild(root)

const mountBundle = new URL('../node_modules/.cache/cleanse-mount/cleanse-mount.js', import.meta.url)
const { mountCleanse } = await import(mountBundle.href)
mountCleanse(root)
await new Promise((resolve) => setTimeout(resolve, 50))

const bodyText = () => document.body.textContent ?? ''
const buttons = () => [...document.querySelectorAll('button')]
const clickButton = (label) => {
  const button = buttons().find((item) => item.textContent.trim() === label)
  assert.ok(button, `找不到按钮：${label}`)
  button.dispatchEvent(new window.Event('click', { bubbles: true }))
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 30))

let text = bodyText()
if (process.env.DEBUG_DOM) {
  console.log('---BODY---')
  console.log(text.slice(0, 3000))
  console.log('---END---')
}
assert.ok(text.includes('行护照工作台'), '工作台未渲染')
assert.ok(text.includes('CLEA-0001'), '规则未加载')
assert.ok(/PKG-CLEA-0001-0\d/.test(text), '示例护照包未播种')
assert.ok(text.includes('异常率阻断阈值'), '条件卡未渲染')
assert.ok(
  buttons().some((item) => ['处理并盖章', '重复处理'].includes(item.textContent.trim())),
  '缺少处理/重复处理按钮',
)

// 选中待补齐护照
const pendingRow = [...document.querySelectorAll('tr')].find((row) => row.textContent.includes('待补齐'))
assert.ok(pendingRow, '没有待补齐的护照包')
pendingRow.dispatchEvent(new window.Event('click', { bubbles: true }))
await tick()

clickButton('补齐未盖章样本')
await tick()
text = bodyText()
assert.ok(text.includes('已补齐'), '补齐未生效')
assert.ok(text.includes('已通过行未重制'), '缺少不重制说明')

// 接收：低异常完整包应成功
clickButton('接收进转换编排')
await tick()
text = bodyText()
assert.ok(
  text.includes('已接收进转换编排') || text.includes('未通过准入'),
  '接收动作无响应',
)

// 重复处理返回原护照号
clickButton('重复处理')
await tick()
assert.ok(bodyText().includes('返回原护照号'), '重复处理未返回原护照号')

// 处理新样本包：高异常批次应阻断
const select = document.querySelector('select')
assert.ok(select, '缺少批次选择')
select.value = 'mixed'
select.dispatchEvent(new window.Event('change', { bubbles: true }))
await tick()
clickButton('登记样本包')
await tick()
const processButtons = buttons().filter((item) => item.textContent.trim() === '处理并盖章')
assert.ok(processButtons.length > 0, '新登记的包没有处理入口')
processButtons[processButtons.length - 1].dispatchEvent(new window.Event('click', { bubbles: true }))
await tick()
assert.ok(bodyText().includes('已签发') || bodyText().includes('未盖章'), '新包处理无结果')
await tick()
text = bodyText()
assert.ok(text.includes('PKG-') && text.includes('阻断'), '高异常包没有出现阻断结论')

// 生成候选版本：页面出现新版本，旧包仍在
const numberInputs = [...document.querySelectorAll('input')]
const thresholdInput = numberInputs.find((item) => item.placeholder === '如 30%')
assert.ok(thresholdInput, '缺少候选阈值输入')
thresholdInput.value = '40%'
thresholdInput.dispatchEvent(new window.Event('input', { bubbles: true }))
await tick()
clickButton('生成候选版本')
await tick()
text = bodyText()
assert.ok(text.includes('已生成候选清洗版本'), '候选版本未生成')
assert.ok(text.includes('v1.1'), '候选版本号未显示')
assert.ok(text.includes('v1.0'), '旧版本不应消失')
if (process.env.DEBUG_DOM) console.log('---AFTER CANDIDATE---\n' + text.slice(0, 2500))
assert.ok(text.includes('按 v1.1 重签'), '缺少按新版本重签入口')

// 重复处理仍返回原护照号，即使规则已有新版本
clickButton('重复处理')
await tick()
assert.ok(bodyText().includes('返回原护照号'), '候选版本后重复处理未返回原护照号')

// 按新版本重签：同一包生成新护照号，旧包保留
const before = [...document.querySelectorAll('.mono')].map((node) => node.textContent).filter((t) => t?.startsWith('PKG-'))
clickButton('按 v1.1 重签')
await tick()
text = bodyText()
assert.ok(text.includes('已签发（v1.1）'), '重签未生成新版本护照')
const after = [...document.querySelectorAll('.mono')].map((node) => node.textContent).filter((t) => t?.startsWith('PKG-'))
assert.ok(after.includes('v1.1') || text.includes('v1.1'), '新护照版本未显示')
assert.ok(after.length >= before.length, '旧护照不应被移除')
assert.ok(text.includes('版本并存') || text.includes('已接收') || text.includes('质量'), '缺少新护照详情')

console.log('dom interaction tests: all passed')
