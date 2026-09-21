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
import * as z from 'zod'

import { DRAWING_SIZE, KNOWLEDGE_EXPECTED, LOGIC_EXPECTED } from '../constants'
import type {
  DrawingValidationResult,
  KnowledgeResult,
  LogicResult,
} from '../types'

const logicSchema = z.object({
  answer: z.number().int(),
  round: z.number().int(),
  star: z.number().int(),
  explanation: z.string().trim().min(1),
})

const knowledgeSchema = z.object({
  answers: z.array(
    z.object({
      id: z.enum(['q1', 'q2', 'q3']),
      answer: z.array(z.string()).nullable(),
    })
  ),
})

function findBalancedJson(source: string): string | null {
  const start = source.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') {
      depth += 1
      continue
    }
    if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  return null
}

export function parseJsonObject(source: string): unknown | null {
  const fencedMatches = source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)

  for (const match of fencedMatches) {
    const candidate = findBalancedJson(match[1] ?? '')
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next candidate.
    }
  }

  const candidate = findBalancedJson(source)
  if (!candidate) return null

  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

export function extractCompleteHtml(source: string): string | null {
  const fencedMatches = source.matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)

  for (const match of fencedMatches) {
    const html = extractHtmlDocument(match[1] ?? '')
    if (html) return html
  }

  return extractHtmlDocument(source)
}

function extractHtmlDocument(source: string): string | null {
  const startMatch = /<!doctype\s+html|<html(?:\s|>)/i.exec(source)
  if (!startMatch || startMatch.index === undefined) return null

  const closingIndex = source.toLowerCase().lastIndexOf('</html>')
  if (closingIndex < startMatch.index) return null

  return source.slice(startMatch.index, closingIndex + '</html>'.length).trim()
}

export function evaluateLogic(rawResponse: string): LogicResult | null {
  const parsed = logicSchema.safeParse(parseJsonObject(rawResponse))
  if (!parsed.success) return null

  const result = parsed.data
  const passed =
    result.answer === LOGIC_EXPECTED.answer &&
    result.round === LOGIC_EXPECTED.round &&
    result.star === LOGIC_EXPECTED.star &&
    result.answer === result.round + result.star

  return {
    passed,
    ...result,
  }
}

function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .replaceAll('’', "'")
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en')
}

function answersMatch(actual: string[], expected: string[]): boolean {
  const actualSet = new Set(actual.map(normalizeAnswer))
  const expectedSet = new Set(expected.map(normalizeAnswer))

  return (
    actualSet.size === expectedSet.size &&
    [...actualSet].every((value) => expectedSet.has(value))
  )
}

export function evaluateKnowledge(rawResponse: string): KnowledgeResult | null {
  const parsed = knowledgeSchema.safeParse(parseJsonObject(rawResponse))
  if (!parsed.success) return null

  const answerMap = new Map(
    parsed.data.answers.map((item) => [item.id, item.answer])
  )
  const answers = (
    Object.keys(KNOWLEDGE_EXPECTED) as Array<'q1' | 'q2' | 'q3'>
  ).map((id) => {
    const expected = KNOWLEDGE_EXPECTED[id]
    const answer = answerMap.get(id) ?? null
    const passed =
      answer !== null &&
      answer.length === expected.length &&
      answersMatch(answer, expected)

    return { id, expected, answer, passed }
  })

  return {
    passed: answers.every((answer) => answer.passed),
    answers,
  }
}

const FORBIDDEN_TAGS = [
  'script',
  'iframe',
  'img',
  'link',
  'object',
  'embed',
  'foreignObject',
  'picture',
  'video',
  'audio',
  'canvas',
].join(',')

function hasExternalReference(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase()
  if (!normalized) return false
  if (normalized.startsWith('#')) return false
  return (
    normalized.startsWith('http:') ||
    normalized.startsWith('https:') ||
    normalized.startsWith('//') ||
    normalized.startsWith('javascript:') ||
    normalized.startsWith('data:text/html')
  )
}

function hasExternalCss(value: string): boolean {
  return (
    /@import/i.test(value) ||
    /url\(\s*['"]?(?:https?:|\/\/|data:text\/html)/i.test(value) ||
    /expression\s*\(/i.test(value)
  )
}

function hasExpectedDimensions(svg: Element): boolean {
  const width = Number.parseFloat(svg.getAttribute('width') ?? '')
  const height = Number.parseFloat(svg.getAttribute('height') ?? '')
  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const style = svg.getAttribute('style') ?? ''

  const hasRootSize =
    width === DRAWING_SIZE.width && height === DRAWING_SIZE.height
  const hasViewBox =
    viewBox.length === 4 &&
    viewBox[0] === 0 &&
    viewBox[1] === 0 &&
    viewBox[2] === DRAWING_SIZE.width &&
    viewBox[3] === DRAWING_SIZE.height
  const hasStyleSize =
    new RegExp(`width\\s*:\\s*${DRAWING_SIZE.width}px`, 'i').test(style) &&
    new RegExp(`height\\s*:\\s*${DRAWING_SIZE.height}px`, 'i').test(style)

  return hasRootSize || hasViewBox || hasStyleSize
}

export function validateDrawingHtml(html: string): DrawingValidationResult {
  const issues: string[] = []
  const parser = new DOMParser()
  const documentNode = parser.parseFromString(html, 'text/html')
  const svg = documentNode.querySelector('svg')

  if (/<!doctype\s+html/i.test(html) === false) {
    issues.push('The output must be a complete HTML document.')
  }
  if (!svg) {
    issues.push('The output must contain an SVG element.')
  }

  const forbiddenElements = documentNode.querySelectorAll(FORBIDDEN_TAGS)
  if (forbiddenElements.length > 0) {
    const names = new Set(
      [...forbiddenElements].map((element) =>
        element.tagName.toLocaleLowerCase()
      )
    )
    issues.push(`Forbidden elements: ${[...names].join(', ')}.`)
  }

  for (const element of documentNode.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      const attributeName = attribute.name.toLocaleLowerCase()
      const value = attribute.value
      if (attributeName.startsWith('on')) {
        issues.push('Event handler attributes are not allowed.')
        break
      }
      if (
        attributeName === 'src' ||
        attributeName === 'href' ||
        attributeName === 'xlink:href'
      ) {
        if (hasExternalReference(value)) {
          issues.push('External resources are not allowed.')
          break
        }
      }
      if (attributeName === 'style' && hasExternalCss(value)) {
        issues.push('External CSS resources are not allowed.')
        break
      }
    }
  }

  const css = [...documentNode.querySelectorAll('style')]
    .map((style) => style.textContent ?? '')
    .join('\n')
  if (hasExternalCss(css)) {
    issues.push('External CSS resources are not allowed.')
  }

  const hasDimensions = svg ? hasExpectedDimensions(svg) : false
  if (svg && !hasDimensions) {
    issues.push('The SVG must use a 1200x800 canvas.')
  }

  const hasSmilAnimation =
    svg?.querySelector('animate, animateTransform, animateMotion, set') !== null
  const hasCssAnimation = /@keyframes/i.test(css) && /animation\s*:/i.test(css)
  const animationDeclared = hasSmilAnimation || hasCssAnimation
  if (!animationDeclared) {
    issues.push('The output must declare SVG or CSS animation.')
  }

  const smilInfinite = [
    ...(svg?.querySelectorAll(
      'animate, animateTransform, animateMotion, set'
    ) ?? []),
  ].some((element) => element.getAttribute('repeatCount') === 'indefinite')
  const cssInfinite = /\binfinite\b/i.test(css)
  const infiniteLoop = smilInfinite || cssInfinite
  if (animationDeclared && !infiniteLoop) {
    issues.push('The animation must loop indefinitely.')
  }

  const clonedSvg = svg?.cloneNode(true) as SVGSVGElement | undefined
  if (clonedSvg) {
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const styleElements = [...documentNode.querySelectorAll('style')]
    if (styleElements.length > 0) {
      const defs = documentNode.createElementNS(
        'http://www.w3.org/2000/svg',
        'defs'
      )
      for (const styleElement of styleElements) {
        defs.appendChild(styleElement.cloneNode(true))
      }
      clonedSvg.prepend(defs)
    }
  }

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    html,
    svg: clonedSvg?.outerHTML ?? '',
    animationDeclared,
    infiniteLoop,
  }
}

function buildPreviewPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    'img-src data:',
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

export function buildSandboxedPreviewHtml(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildPreviewPolicy()}">`
  const headMatch = /<head[^>]*>/i.exec(html)

  if (headMatch?.index === undefined) {
    return html.replace(/<html[^>]*>/i, (tag) => `${tag}${meta}`)
  }

  const insertionIndex = headMatch.index + headMatch[0].length
  return `${html.slice(0, insertionIndex)}${meta}${html.slice(insertionIndex)}`
}

export async function renderDrawingScreenshot(svg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    const timeout = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Timed out while rendering the drawing.'))
    }, 15_000)

    const finish = (callback: () => void) => {
      window.clearTimeout(timeout)
      URL.revokeObjectURL(objectUrl)
      callback()
    }

    image.addEventListener(
      'load',
      () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = DRAWING_SIZE.width
          canvas.height = DRAWING_SIZE.height
          const context = canvas.getContext('2d')
          if (!context) {
            throw new Error('Canvas rendering is unavailable.')
          }
          context.drawImage(
            image,
            0,
            0,
            DRAWING_SIZE.width,
            DRAWING_SIZE.height
          )
          const screenshot = canvas.toDataURL('image/png')
          finish(() => resolve(screenshot))
        } catch (error) {
          finish(() => reject(error))
        }
      },
      { once: true }
    )

    image.addEventListener(
      'error',
      () => {
        finish(() => reject(new Error('Unable to render the SVG drawing.')))
      },
      { once: true }
    )

    image.src = objectUrl
  })
}
