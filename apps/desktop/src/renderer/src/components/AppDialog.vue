<script setup lang="ts">
import type { StyleValue } from 'vue'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  'backdrop-pointerdown': [event: PointerEvent]
  'backdrop-pointerup': [event: PointerEvent]
  'backdrop-pointercancel': []
}>()

withDefaults(defineProps<{
  ariaLabel: string
  dialogClass?: string
  dialogStyle?: StyleValue
  backdropClass?: string
  closeOnBackdrop?: boolean
}>(), {
  dialogClass: '',
  backdropClass: '',
  closeOnBackdrop: true,
})
</script>

<template>
  <Teleport to="body">
    <Transition name="app-dialog">
      <div
        v-if="open"
        class="app-dialog-backdrop"
        :class="backdropClass"
        @pointerdown="event => { emit('backdrop-pointerdown', event); if (event.target === event.currentTarget && closeOnBackdrop) open = false }"
        @pointerup="event => emit('backdrop-pointerup', event)"
        @pointercancel="emit('backdrop-pointercancel')"
      >
        <section class="app-dialog" :class="dialogClass" :style="dialogStyle" role="dialog" aria-modal="true" :aria-label="ariaLabel">
          <slot />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-dialog-backdrop {
  position: fixed;
  z-index: 1100;
  inset: 42px 0 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--overlay);
}

.app-dialog {
  width: min(420px, 100%);
  padding: 26px;
  border: 1px solid var(--modal-border);
  border-radius: 14px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);
}

:slotted(h2) {
  margin: 0;
}

.app-dialog-enter-active,
.app-dialog-leave-active { transition: opacity .2s ease; }
.app-dialog-enter-active .app-dialog,
.app-dialog-leave-active .app-dialog { transition: opacity .2s ease, transform .2s ease; }
.app-dialog-enter-from,
.app-dialog-leave-to { opacity: 0; }
.app-dialog-enter-from .app-dialog,
.app-dialog-leave-to .app-dialog { opacity: 0; transform: translateY(10px) scale(.96); }
</style>
