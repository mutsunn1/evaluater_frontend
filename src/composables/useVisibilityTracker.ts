import { onBeforeUnmount, onMounted, type Ref } from 'vue'

interface UseVisibilityTrackerOptions {
  enabled: Ref<boolean>
  onHidden: () => Promise<void> | void
  onVisible: () => Promise<void> | void
}

export function useVisibilityTracker(options: UseVisibilityTrackerOptions) {
  let lastHidden = false

  const handleVisibilityChange = async () => {
    if (!options.enabled.value) return

    const nowHidden = document.hidden
    if (nowHidden === lastHidden) return
    lastHidden = nowHidden

    if (nowHidden) {
      await options.onHidden()
      return
    }

    await options.onVisible()
  }

  onMounted(() => {
    lastHidden = document.hidden
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })
}
