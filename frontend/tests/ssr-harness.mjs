import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'

// 用 Vite 的 SSR 模块加载器编译 .vue 单文件组件，再真实渲染一次。
// onMounted 在 SSR 下不会触发，所以这里先手工播种护照账本，确保模板里的数据绑定有内容可算。
let server = null

export async function renderToSSR(entry) {
  if (!server) {
    server = await createServer({
      root: process.cwd(),
      server: { middlewareMode: true },
      appType: 'custom',
      logLevel: 'error',
    })
  }
  const { ensureCleanseSeed, listPassports } = await server.ssrLoadModule('/src/api/cleanse-service.ts')
  const { qualityVerdict } = await server.ssrLoadModule('/src/data/cleanse-engine.ts')
  const { admissionVerdict } = await server.ssrLoadModule('/src/data/cleanse-engine.ts')
  ensureCleanseSeed()
  const { default: Component } = await server.ssrLoadModule(entry)
  let props = {}
  if (entry.includes('PassportDetail')) {
    const passport = listPassports(1)[0]
    props = {
      passport,
      quality: qualityVerdict(passport),
      admission: admissionVerdict(passport, passport.ruleVersion),
      accepted: false,
      review: null,
      restored: '',
    }
  } else if (entry.includes('ConditionCardView')) {
    props = { card: listPassports(1)[0].conditionCard }
  }
  const app = createSSRApp(Component, props)
  app.use(createPinia())
  return renderToString(app)
}

export async function closeHarness() {
  if (server) {
    await server.close()
    server = null
  }
}
