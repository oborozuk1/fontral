import { createApp } from 'vue'
import App from './App.vue'
import { setupTooltips } from './directives/tooltip'
import { setupI18n } from './composables/useI18n'
import './style.css'

const app = createApp(App)
setupTooltips(app)
app.mount('#app')
setupI18n()
