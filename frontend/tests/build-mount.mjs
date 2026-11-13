import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 把清洗加工页打包成可独立加载的 ESM（把 vue 一起打进去），
// 之后在 happy-dom 里真实挂载并模拟点击，验证交互链路。
const root = fileURLToPath(new URL('..', import.meta.url))

await build({
  root,
  configFile: false,
  logLevel: 'error',
  plugins: [vue()],
  resolve: { alias: { '@': `${root}/src` } },
  build: {
    lib: { entry: `${root}/tests/mount-entry.ts`, formats: ['es'], fileName: 'cleanse-mount' },
    outDir: `${root}/node_modules/.cache/cleanse-mount`,
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
console.log('mount bundle built')
