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
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { KunCodeCourt, KunCodeMotif } from '@/components/kuncode-court'
import { Button } from '@/components/ui/button'

const PRACTICE_PILLARS = [
  {
    icon: '🎤',
    title: 'Sing · Ultimate response',
    description:
      'Code moves like a song. Every response is timed to the beat: no noise, just a crisp 200 OK.',
    watermark: 'CHART',
  },
  {
    icon: '💃',
    title: 'Dance · Flexible architecture',
    description:
      'The architecture stays flexible without losing balance, holding steady even under high concurrency.',
    watermark: 'DANCE',
  },
  {
    icon: '📻',
    title: 'Rap · Fast concurrency',
    description:
      'Speed meets solid logic. The asynchronous engine keeps high-frequency traffic and long-lived connections flowing.',
    watermark: 'RAP',
  },
  {
    icon: '🏀',
    title: 'Basketball · Core relay',
    description:
      'From dribble to delivery, the core routing layer makes sure every request lands exactly where it should.',
    watermark: 'BALL',
  },
] as const

export function KunCodeAboutPage() {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLButtonElement>(null)
  const avatarRef = useRef<HTMLSpanElement>(null)
  const dustTimerRef = useRef<number>(undefined)
  const performingRef = useRef(false)
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    return () => window.clearTimeout(dustTimerRef.current)
  }, [])

  const performShoulderBump = () => {
    if (
      performingRef.current ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !avatarRef.current?.animate
    ) {
      return
    }

    performingRef.current = true
    avatarRef.current.animate(
      [
        { transform: 'translateX(0) rotate(0deg) scale(1)' },
        { transform: 'translateX(36px) rotate(15deg) scale(0.9)' },
        {
          transform: 'translateX(-132px) rotate(-28deg) scale(1.15)',
          filter: 'brightness(1.2)',
        },
        { transform: 'translateX(30px) rotate(8deg) scale(1)' },
        { transform: 'translateX(-10px) rotate(0deg) scale(1)' },
        {
          transform: 'translateX(0) rotate(0deg) scale(1)',
          filter: 'brightness(1)',
        },
      ],
      {
        duration: 650,
        easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      }
    )

    dustTimerRef.current = window.setTimeout(() => {
      stageRef.current
        ?.querySelectorAll<HTMLElement>('[data-dust]')
        .forEach((dust) => {
          dust.animate(
            [
              {
                opacity: 0,
                transform: 'translate(0, 0) scale(0.7)',
              },
              {
                opacity: 0.8,
                transform: 'translate(-150px, 42px) scale(2)',
                offset: 0.4,
              },
              {
                opacity: 0,
                transform: 'translate(-220px, 72px) scale(0.5)',
              },
            ],
            { duration: 600, easing: 'ease-out' }
          )
        })
      performingRef.current = false
    }, 180)
  }

  return (
    <KunCodeCourt>
      <main className='mx-auto max-w-6xl px-6 pt-28 pb-16 md:px-10 md:pt-36 md:pb-24'>
        <header className='mx-auto mb-20 max-w-4xl text-center md:mb-28'>
          <span className='bg-primary text-primary-foreground inline-flex rounded-full px-6 py-2.5 text-xs font-black shadow-[0_4px_15px_rgba(0,0,0,0.1)]'>
            {t('Two and a half years of practice')}
          </span>
          <h1 className='mt-8 text-[clamp(3.25rem,8vw,6rem)] leading-[1.02] font-black tracking-[-0.055em]'>
            {t('More than code')}
            <span className='from-primary mt-2 block bg-gradient-to-r to-[var(--practice-highlight)] bg-clip-text text-transparent'>
              {t('This is my rhythm')}
            </span>
          </h1>
        </header>

        <section className='mb-24 grid items-center gap-12 md:mb-32 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20'>
          <div>
            <h2 className='relative inline-block pb-4 text-3xl font-black tracking-tight md:text-4xl'>
              {t('A studio of one')}
              <span className='bg-primary absolute bottom-0 left-0 h-1.5 w-12 rounded-full' />
            </h2>
            <div className='text-muted-foreground mt-8 space-y-6 text-base leading-8 md:text-lg'>
              <p>
                {t(
                  'Many people ask me how many people are behind KunCode. I can only say: "It has always been just me."'
                )}
              </p>
              <p>
                {t(
                  'From the first line of rhythm to the last line of code, I built and optimized everything myself. There is no unnecessary team chatter here, only steady progress.'
                )}
              </p>
              <p>
                {t(
                  'Every API endpoint has been refined over two and a half years. It has the agility of a dancer and the resilience of a solid defense, all shaped by one developer.'
                )}
              </p>
            </div>
          </div>

          <Button
            ref={stageRef}
            type='button'
            variant='ghost'
            onClick={performShoulderBump}
            aria-label={t('Trigger the KunCode shoulder bump animation')}
            className='border-foreground bg-card hover:bg-card relative mx-auto h-[22rem] w-full max-w-md overflow-hidden rounded-[3rem] border-4 shadow-[20px_20px_0_var(--practice-highlight)] transition-shadow active:translate-x-2 active:translate-y-2 active:shadow-[10px_10px_0_var(--practice-highlight)]'
          >
            <span
              ref={avatarRef}
              aria-hidden='true'
              className='relative z-10 inline-flex drop-shadow-[0_10px_20px_rgba(0,0,0,0.1)]'
            >
              <KunCodeMotif className='size-44 text-[8rem]' />
            </span>
            <span className='text-muted-foreground absolute inset-x-6 bottom-7 text-xs font-black tracking-wider'>
              {t('Click to trigger: Perfect shoulder bump')}
            </span>
            <span
              data-dust
              aria-hidden='true'
              className='absolute top-[55%] left-[46%] size-3 rounded-full bg-slate-400 opacity-0'
            />
            <span
              data-dust
              aria-hidden='true'
              className='absolute top-[59%] left-[50%] size-3 rounded-full bg-slate-400 opacity-0'
            />
            <span
              data-dust
              aria-hidden='true'
              className='absolute top-[53%] left-[54%] size-3 rounded-full bg-slate-400 opacity-0'
            />
          </Button>
        </section>

        <section aria-label={t('KunCode practice pillars')}>
          <div className='grid gap-6 md:grid-cols-2 md:gap-8'>
            {PRACTICE_PILLARS.map((pillar) => (
              <article
                key={pillar.title}
                className='group border-border bg-card hover:border-primary/50 hover:shadow-primary/10 relative overflow-hidden rounded-[2rem] border p-7 shadow-[0_10px_35px_rgba(0,0,0,0.035)] transition-all duration-300 hover:-translate-y-2 hover:shadow-xl md:p-10'
              >
                <span aria-hidden='true' className='text-5xl'>
                  {pillar.icon}
                </span>
                <h3 className='mt-6 text-2xl font-black tracking-tight'>
                  {t(pillar.title)}
                </h3>
                <p className='text-muted-foreground mt-4 text-sm leading-7 md:text-base'>
                  {t(pillar.description)}
                </p>
                <span
                  aria-hidden='true'
                  className='pointer-events-none absolute -right-2 -bottom-3 text-7xl font-black tracking-tighter text-black/[0.025] italic select-none dark:text-white/[0.035]'
                >
                  {pillar.watermark}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className='relative mt-28 overflow-hidden rounded-[3rem] bg-[#1a1a1a] px-6 py-20 text-center text-white shadow-[0_40px_100px_-20px_rgba(0,0,0,0.3)] md:mt-36 md:px-12 md:py-28'>
          <div aria-hidden='true'>
            <KunCodeMotif className='pointer-events-none absolute -right-8 -bottom-8 size-64 text-[14rem] opacity-10' />
          </div>
          <h2 className='text-3xl font-black tracking-tight md:text-5xl'>
            {t('Producers, watch closely')}
          </h2>
          <p className='mx-auto mt-5 max-w-2xl text-base leading-8 text-white/75 md:text-lg'>
            {t(
              'I am ready. Are you ready to connect to KunCode? Let us bring the stage to life.'
            )}
          </p>
          <Button
            className='mt-9 h-14 rounded-2xl bg-white px-8 text-base font-black text-[#1a1a1a] shadow-lg transition-transform hover:scale-105 hover:-rotate-1 hover:bg-white/90'
            render={<Link to='/keys' />}
          >
            {t('Start practicing now')}
            <ArrowRight className='size-4' />
          </Button>
        </section>

        <p className='text-muted-foreground mt-20 text-center text-xs font-semibold tracking-wide'>
          {t('© {{year}} KunCode Practice Studio · Keep practicing', {
            year: currentYear,
          })}
        </p>
      </main>
    </KunCodeCourt>
  )
}
