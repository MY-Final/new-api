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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { KunCodeCourt, KunCodeMotif } from '@/components/kuncode-court'
import { Button } from '@/components/ui/button'

import type { FreeGroupUsageState } from '../types'
import { FreeGroupUsage } from './free-group-usage'

interface KunCodeHomePageProps {
  apiBaseUrl: string
  freeGroupUsage: FreeGroupUsageState
}

export function KunCodeHomePage(props: KunCodeHomePageProps) {
  const { t } = useTranslation()

  const features = [
    {
      title: t('Because the speed is too fast'),
      description: t('Responses flow like a dribble, with no stutter.'),
    },
    {
      title: t('Elegant without losing style'),
      description: t('Full support for KunGe 2.5, even code can dance.'),
    },
    {
      title: t('Are you looking for trouble?'),
      description: t(
        'Ultra-high stability, with every request landing perfectly.'
      ),
    },
    {
      title: t('There is always a higher mountain'),
      description: t(
        'That is the charm of all-round routing. You know what I mean.'
      ),
    },
  ]

  return (
    <KunCodeCourt>
      <main className='mx-auto flex min-h-svh w-full max-w-[1680px] flex-col gap-10 px-6 pt-24 pb-16 md:px-10 md:pt-28 lg:pt-32 lg:pb-24'>
        <FreeGroupUsage {...props.freeGroupUsage} />

        <div className='flex w-full flex-col items-center gap-14 xl:flex-row xl:items-start xl:gap-12'>
          <section className='w-full min-w-0 flex-1 text-center xl:text-left'>
            <div className='border-primary/20 bg-card text-card-foreground inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold shadow-[0_4px_15px_rgba(0,0,0,0.08)]'>
              <span className='relative flex size-2'>
                <span className='absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none' />
                <span className='relative inline-flex size-2 rounded-full bg-emerald-500' />
              </span>
              {t('Practicing for two and a half years · Running smoothly')}
            </div>

            <p className='text-primary mt-8 mb-4 text-xs font-black tracking-[0.28em] uppercase md:text-sm'>
              {t('SING · DANCE · RAP · BASKETBALL')}
            </p>
            <h1 className='max-w-3xl text-[clamp(3.5rem,5.4vw,5.5rem)] leading-[0.98] font-black tracking-[-0.055em]'>
              <span className='xl:whitespace-nowrap'>
                {t('In the world of code')}
              </span>
              <br />
              <span className='from-primary bg-gradient-to-b to-[var(--practice-highlight)] bg-clip-text text-transparent xl:whitespace-nowrap'>
                {t('All-round trainee')}
              </span>
            </h1>
            <p className='text-muted-foreground mx-auto mt-8 max-w-2xl text-base leading-8 md:text-lg lg:mx-0'>
              {t(
                'Dear producers, this is an AI API built for developers. Whether you write code or create content, the response speed here will make you say: "Hey, not bad!"'
              )}
            </p>

            <div className='mt-10 grid gap-3 text-left sm:grid-cols-2'>
              {features.map((feature) => (
                <article
                  key={feature.title}
                  className='border-border/70 bg-card/70 rounded-xl border p-4 shadow-[0_5px_15px_rgba(0,0,0,0.02)] backdrop-blur-sm'
                >
                  <h2 className='text-sm font-extrabold'>{feature.title}</h2>
                  <p className='text-muted-foreground mt-1.5 text-xs leading-6'>
                    {feature.description}
                  </p>
                </article>
              ))}
            </div>

            <div className='mt-9 flex flex-col gap-4'>
              <div className='border-foreground bg-card flex max-w-xl flex-col gap-3 rounded-2xl border-2 p-3 shadow-[0_10px_25px_rgba(0,0,0,0.05)] sm:flex-row sm:items-center sm:justify-between'>
                <code className='text-card-foreground min-w-0 px-2 font-mono text-sm font-bold break-all'>
                  {props.apiBaseUrl}
                </code>
                <CopyButton
                  value={props.apiBaseUrl}
                  variant='outline'
                  size='sm'
                  className='border-primary text-primary hover:bg-primary hover:text-primary-foreground h-9 rounded-lg px-3'
                  iconClassName='size-3.5'
                >
                  {t('Copy API')}
                </CopyButton>
              </div>

              <Button
                className='group bg-primary text-primary-foreground hover:bg-primary/90 h-14 w-full max-w-sm rounded-2xl px-8 text-base font-extrabold shadow-[0_15px_35px_-5px_rgba(0,0,0,0.3)] transition-all hover:-translate-y-1'
                render={<Link to='/keys' />}
              >
                {t('Enter the practice room')}
                <span aria-hidden='true'>
                  <KunCodeMotif className='size-5' />
                </span>
                <ArrowRight className='size-4 transition-transform group-hover:translate-x-1' />
              </Button>
            </div>
          </section>

          <section
            aria-label={t('API call example')}
            className='relative w-full max-w-xl flex-1 xl:max-w-[40rem]'
          >
            <KunCodeMotif className='absolute -right-3 -bottom-8 z-20 size-24 -rotate-12 text-6xl drop-shadow-[0_15px_20px_rgba(0,0,0,0.3)] md:-right-8 md:-bottom-10 md:size-32 md:text-8xl' />
            <div className='relative overflow-hidden rounded-3xl border border-white/10 bg-[#171717] p-6 text-[#e5e7eb] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.6)] md:p-9'>
              <div className='mb-5 flex items-center gap-4'>
                <div className='flex gap-2' aria-hidden='true'>
                  <span className='size-3 rounded-full bg-[#ff5f56]' />
                  <span className='size-3 rounded-full bg-[#ffbd2e]' />
                  <span className='size-3 rounded-full bg-[#27c93f]' />
                </div>
                <h2 className='text-sm font-semibold text-white'>
                  {t('API call example')}
                </h2>
              </div>
              <p className='mb-5 text-xs text-gray-400'>
                {t('Replace the API key and model with your own.')}
              </p>
              <pre className='overflow-x-auto font-mono text-[12px] leading-7 md:text-[13px]'>
                <code>
                  <span className='text-[#a1a1aa]'>
                    {t('// Ready to start your performance')}
                  </span>
                  {'\n'}
                  <span className='text-[#e5e7eb]'>
                    const ikun = new OpenAI({'{'}
                  </span>
                  {'\n  baseURL: '}
                  <span className='text-[var(--practice-code-string)]'>
                    "{props.apiBaseUrl}"
                  </span>
                  ,{'\n  apiKey: '}
                  <span className='text-[var(--practice-code-string)]'>
                    "sk-practice-2.5-years"
                  </span>
                  {'\n});'}
                  {'\n\nawait ikun.chat.completions.create({'}
                  {'\n  model: '}
                  <span className='text-[var(--practice-code-value)]'>
                    "KunGe 2.5"
                  </span>
                  ,{'\n  messages: [{ role: '}
                  <span className='text-[var(--practice-code-value)]'>
                    "user"
                  </span>
                  {', content: '}
                  <span className='text-[var(--practice-code-value)]'>
                    "Dance with my code"
                  </span>
                  {' }]'}
                  {'\n});'}
                </code>
              </pre>
            </div>
          </section>
        </div>
      </main>
    </KunCodeCourt>
  )
}
