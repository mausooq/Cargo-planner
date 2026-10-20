export function CompassMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="2.25" />
      <circle cx="32" cy="32" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M32 8 L37.5 32 L32 27.5 L26.5 32 Z" fill="currentColor" />
      <path d="M32 56 L26.5 32 L32 36.5 L37.5 32 Z" fill="currentColor" opacity="0.35" />
      <path d="M8 32 L32 26.5 L27.5 32 L32 37.5 Z" fill="currentColor" opacity="0.2" />
      <path d="M56 32 L32 37.5 L36.5 32 L32 26.5 Z" fill="currentColor" opacity="0.2" />
    </svg>
  )
}
