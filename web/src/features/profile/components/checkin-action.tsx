import { Check } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { KunCodeMotif } from '@/components/kuncode-court'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useThemeCustomization } from '@/context/theme-customization-provider'
import { cn } from '@/lib/utils'

type CheckinActionProps = {
  loading: boolean
  checkedToday?: boolean
  compact?: boolean
  onCheckin: () => void
}

export function CheckinAction(props: CheckinActionProps) {
  const { t } = useTranslation()
  const { customization } = useThemeCustomization()
  const motifRef = useRef<HTMLSpanElement>(null)
  const basketball = customization.preset === 'basketball'

  let label = basketball
    ? t('Dribble to check in')
    : t('Shoulder bump to check in')
  if (props.loading) {
    label = t('Loading...')
  } else if (props.checkedToday) {
    label = t('Checked in')
  }
  let description = basketball
    ? t("Tap the basketball for today's reward.")
    : t('Suspenders on. Time for a shoulder bump.')
  if (props.checkedToday) {
    description = t('See you tomorrow')
  }

  return (
    <Button
      type='button'
      variant='outline'
      className={cn(
        'border-primary/20 bg-background/80 hover:bg-primary/5 h-auto w-full min-w-0 justify-start gap-4 overflow-hidden rounded-xl text-left whitespace-normal',
        props.compact ? 'min-h-24 p-3' : 'min-h-36 p-4'
      )}
      aria-label={label}
      aria-busy={props.loading}
      disabled={props.loading || props.checkedToday}
      onClick={() => {
        const motif = motifRef.current
        if (
          motif?.animate &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          motif.getAnimations().forEach((animation) => animation.cancel())
          motif.animate(
            basketball
              ? [
                  { transform: 'translateY(0) scale(1)' },
                  { transform: 'translateY(18px) scale(1.12, 0.88)' },
                  { transform: 'translateY(-10px) scale(0.96, 1.04)' },
                  { transform: 'translateY(12px) scale(1.06, 0.94)' },
                  { transform: 'translateY(0) scale(1)' },
                ]
              : [
                  { transform: 'translateX(0) rotate(0deg)' },
                  { transform: 'translateX(-8px) rotate(-14deg)' },
                  { transform: 'translateX(14px) rotate(16deg)' },
                  { transform: 'translateX(-4px) rotate(-6deg)' },
                  { transform: 'translateX(0) rotate(0deg)' },
                ],
            { duration: 650, easing: 'ease-in-out' }
          )
        }
        props.onCheckin()
      }}
    >
      <span
        aria-hidden='true'
        className={cn(
          'relative flex shrink-0 items-center justify-center',
          props.compact ? 'size-20' : 'size-28'
        )}
      >
        <span className='bg-primary/10 absolute bottom-0 h-1.5 w-12 rounded-[50%] blur-[2px]' />
        <span ref={motifRef} className='relative inline-flex origin-bottom'>
          <KunCodeMotif
            className={cn(
              props.compact ? 'size-16 text-6xl' : 'size-24 text-7xl'
            )}
          />
        </span>
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-2'>
        <span className='text-foreground flex items-center gap-2 text-sm font-semibold wrap-anywhere sm:text-base'>
          {props.loading && (
            <Spinner
              className='size-4 shrink-0 motion-reduce:animate-none'
              aria-hidden='true'
            />
          )}
          {props.checkedToday && !props.loading && (
            <Check className='size-4 shrink-0' aria-hidden='true' />
          )}
          {label}
        </span>
        <span className='text-muted-foreground text-xs leading-relaxed font-normal wrap-anywhere'>
          {description}
        </span>
      </span>
    </Button>
  )
}
