/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useThemeCustomization } from '@/context/theme-customization-provider'
import { cn } from '@/lib/utils'

interface KunCodeCourtProps {
  children: ReactNode
  className?: string
}

export function KunCodeCourt(props: KunCodeCourtProps) {
  const glowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const moveGlow = (event: PointerEvent) => {
      const glow = glowRef.current
      if (!glow) return
      glow.style.transform = `translate3d(${event.clientX - 210}px, ${event.clientY - 210}px, 0)`
    }

    window.addEventListener('pointermove', moveGlow, { passive: true })
    return () => window.removeEventListener('pointermove', moveGlow)
  }, [])

  return (
    <div
      className={cn(
        'bg-background text-foreground relative min-h-svh overflow-x-clip',
        props.className
      )}
    >
      <div
        aria-hidden='true'
        className='kuncode-backdrop pointer-events-none absolute inset-0 opacity-80 dark:opacity-30'
      />
      <div
        ref={glowRef}
        aria-hidden='true'
        className='kuncode-glow pointer-events-none fixed top-0 left-0 z-0 hidden size-[420px] rounded-full md:block'
      />
      <div className='relative z-10'>{props.children}</div>
    </div>
  )
}

export function KunCodeMotif(props: { className?: string }) {
  const { t } = useTranslation()
  const { customization } = useThemeCustomization()

  if (customization.preset === 'basketball') {
    return (
      <span
        role='img'
        aria-label={t('Basketball')}
        className={cn(
          'inline-flex items-center justify-center',
          props.className
        )}
      >
        🏀
      </span>
    )
  }

  return (
    <svg
      role='img'
      aria-label={t('Black and white suspenders')}
      className={cn('inline-block', props.className)}
      viewBox='0 0 96 112'
      fill='none'
    >
      <path
        d='M29 7 13 13 3 36l17 8 5-10v33h46V34l5 10 17-8-10-23L67 7c-4 10-34 10-38 0Z'
        fill='#18181b'
        stroke='#a1a1aa'
        strokeWidth='2'
        strokeLinejoin='round'
      />
      <path
        d='m25 64-3 43h21l5-29 5 29h21l-3-43Z'
        fill='#52525b'
        stroke='#a1a1aa'
        strokeWidth='2'
        strokeLinejoin='round'
      />
      <path d='m30 8 6 60m30-60-6 60' stroke='#fafafa' strokeWidth='7' />
      <path d='m30 76-2 25m10-25-2 25m22-25 2 25m6-25 2 25' stroke='#a1a1aa' />
      <path d='M26 63h44' stroke='#18181b' strokeWidth='7' />
      <rect x='32' y='56' width='8' height='13' rx='2' fill='#fafafa' />
      <rect x='56' y='56' width='8' height='13' rx='2' fill='#fafafa' />
      <circle cx='36' cy='62' r='2' fill='#27272a' />
      <circle cx='60' cy='62' r='2' fill='#27272a' />
    </svg>
  )
}
