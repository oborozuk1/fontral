<script setup lang="ts">
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'

const open = defineModel<boolean>('open', { required: true })

defineProps<{
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
}>()

const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <AppDialog v-model:open="open" :ariaLabel="title" dialog-class="confirm-dialog">
    <h2>{{ title }}</h2>
    <p>{{ message }}</p>
    <div class="confirm-dialog__actions">
      <AppButton variant="neutral" @click="open = false">{{ cancelLabel }}</AppButton>
      <AppButton variant="danger" @click="emit('confirm')">{{ confirmLabel }}</AppButton>
    </div>
  </AppDialog>
</template>

<style scoped>
.confirm-dialog { padding: 20px; }

.confirm-dialog h2 { margin: 0; font-size: 17px; }

.confirm-dialog p {
  margin: 10px 0 0;
  color: var(--ink-4);
  font-size: 13px;
  line-height: 1.55;
}

.confirm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
