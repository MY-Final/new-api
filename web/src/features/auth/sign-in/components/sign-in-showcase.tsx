import { CalendarCheck, Code2, Cpu, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { KunCodeMotif } from '@/components/kuncode-court'

export function SignInShowcase() {
  const { t } = useTranslation()

  return (
    <section
      aria-label={t('Your creative backstage')}
      className='kuncode-auth-showcase relative isolate flex min-h-[560px] w-full flex-col overflow-hidden rounded-[2rem] border border-white/10 p-8 text-zinc-100 shadow-2xl'
    >
      <div
        aria-hidden='true'
        className='kuncode-auth-straps pointer-events-none absolute inset-0 -z-10'
      />
      <div className='flex items-center gap-3'>
        <span className='flex size-9 items-center justify-center rounded-xl border border-white/15 bg-white/5'>
          <Code2 className='size-4' aria-hidden='true' />
        </span>
        <p className='text-xs font-medium tracking-wider text-zinc-300'>
          {t('Your creative backstage')}
        </p>
      </div>

      <h2 className='mt-6 text-[clamp(2.5rem,3.5vw,3.5rem)] leading-[1.18] font-bold tracking-tight wrap-anywhere'>
        {t('Every idea deserves')}
        <span className='mt-1 block text-zinc-400'>
          {t('a place to shine.')}
        </span>
      </h2>
      <p className='mt-4 max-w-sm text-sm leading-7 text-zinc-400'>
        {t('Models, tools and inspiration. All in one place.')}
      </p>

      <div
        aria-hidden='true'
        className='relative my-3 flex min-h-56 flex-1 items-center justify-center'
      >
        <div className='absolute size-56 rounded-full border border-white/10' />
        <div className='absolute size-72 rounded-full border border-dashed border-white/5' />
        <div className='absolute size-44 rounded-full bg-white/[0.025] ring-1 ring-white/5' />
        <span className='absolute bottom-5 h-3 w-28 rounded-[50%] bg-black/50 blur-md' />
        <div className='kuncode-auth-motif relative drop-shadow-[0_24px_24px_rgba(0,0,0,0.4)]'>
          <KunCodeMotif className='size-44 -rotate-6 text-[10rem]' />
        </div>
        <span className='absolute top-10 right-6 flex size-8 rotate-12 items-center justify-center rounded-lg border border-white/15 bg-white/5'>
          <Sparkles className='size-4 text-zinc-300' />
        </span>
        <span className='absolute bottom-12 left-5 flex size-7 -rotate-12 items-center justify-center rounded-lg border border-white/10 bg-white/5'>
          <Code2 className='size-3.5 text-zinc-400' />
        </span>
      </div>

      <div className='relative border-t border-white/10 pt-5'>
        <p className='text-[10px] font-medium tracking-[0.2em] text-zinc-500 uppercase'>
          {t('SING · DANCE · RAP · BASKETBALL')}
        </p>
        <div className='mt-4 flex flex-wrap gap-x-5 gap-y-3 text-xs text-zinc-300'>
          <span className='inline-flex items-center gap-2'>
            <Cpu className='size-3.5 text-zinc-500' aria-hidden='true' />
            {t('AI models')}
          </span>
          <span className='inline-flex items-center gap-2'>
            <Code2 className='size-3.5 text-zinc-500' aria-hidden='true' />
            {t('Playground')}
          </span>
          <span className='inline-flex items-center gap-2'>
            <CalendarCheck
              className='size-3.5 text-zinc-500'
              aria-hidden='true'
            />
            {t('Daily Check-in')}
          </span>
        </div>
      </div>
    </section>
  )
}
