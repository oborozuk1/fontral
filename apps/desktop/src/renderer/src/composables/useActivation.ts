import { ref } from 'vue'
import type { ActivationRecord, FontFaceSummary } from '@fontral/contracts'
import { useI18n } from './useI18n'

export function useActivation(api: typeof window.fontral, onError: (message: string) => void) {
  const { t } = useI18n()
  const activeFaceIds = ref(new Set<number>())
  const activatingFaceIds = ref(new Set<number>())

  function applyRecord(record: ActivationRecord) {
    const active = new Set(activeFaceIds.value)
    const pending = new Set(activatingFaceIds.value)
    for (const faceId of record.faceIds) {
      if (record.status === 'active' || record.status === 'already_available') active.add(faceId)
      else active.delete(faceId)
      if (record.status === 'activating' || record.status === 'deactivating') pending.add(faceId)
      else pending.delete(faceId)
    }
    activeFaceIds.value = active
    activatingFaceIds.value = pending
    if ((record.status === 'failed' || record.status === 'conflict') && record.error) onError(record.error.message)
  }

  async function initialize() {
    const active = new Set<number>()
    const pending = new Set<number>()
    for (const record of await api.activation.list()) {
      if (record.status === 'active' || record.status === 'already_available') record.faceIds.forEach(id => active.add(id))
      if (record.status === 'activating' || record.status === 'deactivating') record.faceIds.forEach(id => pending.add(id))
    }
    activeFaceIds.value = active
    activatingFaceIds.value = pending
  }

  async function toggleActivation(face: FontFaceSummary) {
    if (activatingFaceIds.value.has(face.id)) return
    activatingFaceIds.value = new Set(activatingFaceIds.value).add(face.id)
    try {
      if (activeFaceIds.value.has(face.id)) {
        applyRecord(await api.activation.deactivate(face.id))
      } else {
        applyRecord(await api.activation.activate(face.id))
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('ui.couldNotUpdateFontActivation'))
      const next = new Set(activatingFaceIds.value)
      next.delete(face.id)
      activatingFaceIds.value = next
    }
  }

  function handleActivationStatus(event: Event) {
    applyRecord((event as CustomEvent<ActivationRecord>).detail)
  }

  return {
    activeFaceIds,
    activatingFaceIds,
    initialize,
    toggleActivation,
    handleActivationStatus,
  }
}
