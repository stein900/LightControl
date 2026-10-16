import { useCallback, useEffect, useRef } from 'react'

/**
 * Leading and trailing throttle: the first call runs immediately, the last
 * call of a burst always runs. Used to stream slider values to the hardware.
 */
export function useThrottled<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay = 50
): (...args: Args) => void {
  const callbackRef = useRef(callback)
  const lastRun = useRef(0)
  const pending = useRef<Args | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  return useCallback(
    (...args: Args) => {
      const now = performance.now()
      const remaining = delay - (now - lastRun.current)
      if (remaining <= 0 && timer.current === null) {
        lastRun.current = now
        callbackRef.current(...args)
        return
      }
      pending.current = args
      if (timer.current !== null) return
      timer.current = window.setTimeout(
        () => {
          timer.current = null
          lastRun.current = performance.now()
          if (pending.current) callbackRef.current(...pending.current)
          pending.current = null
        },
        Math.max(remaining, 0)
      )
    },
    [delay]
  )
}
