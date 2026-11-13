import { createApp } from 'vue'
import { createPinia } from 'pinia'

import Cleanse from '@/views/cleanse/index.vue'

// 供浏览器/无头 DOM 测试挂载的入口：真实执行 onMounted 与交互逻辑。
export function mountCleanse(el: Element) {
  const app = createApp(Cleanse)
  app.use(createPinia())
  app.mount(el)
  return app
}
