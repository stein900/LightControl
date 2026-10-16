/** The LightControl mark: a ring of LEDs fading like a comet tail, drawn in the current text color. */
export function BrandMark({ className }: { className?: string }) {
  const leds = Array.from({ length: 12 }, (_, i) => {
    const angle = -Math.PI / 4 - (i / 12) * Math.PI * 2
    return {
      cx: 12 + 8 * Math.cos(angle),
      cy: 12 + 8 * Math.sin(angle),
      opacity: Math.max(0.18, Math.pow(1 - i / 12, 1.6))
    }
  })
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {leds.map((led, i) => (
        <circle key={i} cx={led.cx} cy={led.cy} r={1.6} fill="currentColor" opacity={led.opacity} />
      ))}
      <circle cx={12} cy={12} r={3.2} fill="none" stroke="currentColor" strokeWidth={1.8} opacity={0.9} />
    </svg>
  )
}
