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
import { describe, expect, test } from 'vitest'

import {
  buildSandboxedPreviewHtml,
  evaluateKnowledge,
  evaluateLogic,
  extractCompleteHtml,
  parseJsonObject,
  validateDrawingHtml,
} from '../lib/evaluation'

const VALID_DRAWING_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
@keyframes pedal-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.pedal { animation: pedal-spin 1s linear infinite; }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<circle class="pedal" cx="300" cy="500" r="40" fill="#333333" />
</svg>
</body>
</html>`

describe('parseJsonObject', () => {
  test('parses JSON inside a fenced code block', () => {
    const source = 'Here is the result:\n```json\n{"answer":21}\n```\nDone.'
    expect(parseJsonObject(source)).toEqual({ answer: 21 })
  })

  test('parses an embedded JSON object surrounded by prose', () => {
    expect(parseJsonObject('prefix {"answer":21,"round":9} suffix')).toEqual({
      answer: 21,
      round: 9,
    })
  })

  test('returns null when no JSON object is present', () => {
    expect(parseJsonObject('no structured output here')).toBeNull()
  })
})

describe('extractCompleteHtml', () => {
  test('extracts a fenced HTML document', () => {
    const html = extractCompleteHtml(
      `\`\`\`html\n${VALID_DRAWING_HTML}\n\`\`\``
    )
    expect(html).toBe(VALID_DRAWING_HTML)
  })

  test('extracts a raw HTML document and ignores trailing prose', () => {
    const html = extractCompleteHtml(`${VALID_DRAWING_HTML}\nThis is the code.`)
    expect(html).toBe(VALID_DRAWING_HTML)
  })

  test('returns null when the document is incomplete', () => {
    expect(extractCompleteHtml('<html><body><svg /></body>')).toBeNull()
  })
})

describe('evaluateLogic', () => {
  test('passes the expected answer with round plus star equality', () => {
    const evaluation = evaluateLogic(
      '{"answer":21,"round":9,"star":12,"explanation":"Worst case needs 9 round and 12 star."}'
    )
    expect(evaluation?.passed).toBe(true)
  })

  test('fails when the reported total is wrong', () => {
    const evaluation = evaluateLogic(
      '{"answer":20,"round":9,"star":11,"explanation":"Incorrect total."}'
    )
    expect(evaluation?.passed).toBe(false)
  })

  test('fails when the total does not equal round plus star', () => {
    expect(
      evaluateLogic(
        '{"answer":21,"round":10,"star":12,"explanation":"inconsistent"}'
      )?.passed
    ).toBe(false)
  })

  test('fails when the explanation is empty', () => {
    expect(
      evaluateLogic('{"answer":21,"round":9,"star":12,"explanation":"  "}')
    ).toBeNull()
  })
})

describe('evaluateKnowledge', () => {
  const correct = JSON.stringify({
    answers: [
      {
        id: 'q1',
        answer: ['Anne L\u2019Huillier', 'Pierre Agostini', 'Ferenc Krausz'],
      },
      { id: 'q2', answer: ['2023-10-02'] },
      { id: 'q3', answer: ['Jon Fosse'] },
    ],
  })

  test('passes when all three answers match regardless of order', () => {
    const evaluation = evaluateKnowledge(correct)
    expect(evaluation?.passed).toBe(true)
    expect(evaluation?.answers.every((answer) => answer.passed)).toBe(true)
  })

  test('fails the whole check when one answer is missing', () => {
    const evaluation = evaluateKnowledge(
      JSON.stringify({
        answers: [
          {
            id: 'q1',
            answer: [
              'Pierre Agostini',
              'Ferenc Krausz',
              'Anne L\u2019Huillier',
            ],
          },
          { id: 'q3', answer: ['Jon Fosse'] },
        ],
      })
    )
    expect(evaluation?.passed).toBe(false)
    expect(
      evaluation?.answers.find((answer) => answer.id === 'q2')?.passed
    ).toBe(false)
  })

  test('fails when an answer list contains an extra entity', () => {
    const evaluation = evaluateKnowledge(
      JSON.stringify({
        answers: [
          {
            id: 'q1',
            answer: [
              'Pierre Agostini',
              'Ferenc Krausz',
              'Anne L\u2019Huillier',
              'Extra Person',
            ],
          },
          { id: 'q2', answer: ['2023-10-02'] },
          { id: 'q3', answer: ['Jon Fosse'] },
        ],
      })
    )
    expect(evaluation?.passed).toBe(false)
  })

  test('treats a null answer as not passed', () => {
    const evaluation = evaluateKnowledge(
      JSON.stringify({
        answers: [
          { id: 'q1', answer: null },
          { id: 'q2', answer: ['2023-10-02'] },
          { id: 'q3', answer: ['Jon Fosse'] },
        ],
      })
    )
    expect(evaluation?.passed).toBe(false)
    expect(
      evaluation?.answers.find((answer) => answer.id === 'q1')?.answer
    ).toBeNull()
  })
})

describe('validateDrawingHtml', () => {
  test('accepts a 1200x800 SVG with an infinite CSS animation', () => {
    const result = validateDrawingHtml(VALID_DRAWING_HTML)
    expect(result.issues).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.animationDeclared).toBe(true)
    expect(result.infiniteLoop).toBe(true)
  })

  test('accepts an infinite SMIL animation', () => {
    const html = `<!DOCTYPE html><html><body>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<circle cx="10" cy="10" r="5">
<animate attributeName="cx" values="10;20;10" dur="2s" repeatCount="indefinite" />
</circle>
</svg></body></html>`
    const result = validateDrawingHtml(html)
    expect(result.valid).toBe(true)
    expect(result.infiniteLoop).toBe(true)
  })

  test('rejects scripts and external resources', () => {
    const withScript = validateDrawingHtml(
      VALID_DRAWING_HTML.replace('<body>', '<body><script>alert(1)</script>')
    )
    expect(withScript.valid).toBe(false)
    expect(withScript.issues).toContain('Forbidden elements: script.')

    const withImage = validateDrawingHtml(
      VALID_DRAWING_HTML.replace(
        '<circle',
        '<image href="https://example.com/a.png" /><circle'
      )
    )
    expect(withImage.valid).toBe(false)
    expect(withImage.issues).toContain('External resources are not allowed.')
  })

  test('rejects a canvas that is not 1200x800', () => {
    const result = validateDrawingHtml(
      VALID_DRAWING_HTML.replace(
        'width="1200" height="800" viewBox="0 0 1200 800"',
        'width="800" height="600" viewBox="0 0 800 600"'
      )
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('The SVG must use a 1200x800 canvas.')
  })

  test('rejects an animation that does not loop indefinitely', () => {
    const result = validateDrawingHtml(
      VALID_DRAWING_HTML.replace('linear infinite', 'linear')
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('The animation must loop indefinitely.')
  })

  test('rejects output without an animation declaration', () => {
    const result = validateDrawingHtml(`<!DOCTYPE html><html><body>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<rect width="10" height="10" />
</svg></body></html>`)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain(
      'The output must declare SVG or CSS animation.'
    )
  })
})

describe('buildSandboxedPreviewHtml', () => {
  test('injects a restrictive CSP into the document head', () => {
    const preview = buildSandboxedPreviewHtml(VALID_DRAWING_HTML)
    expect(preview).toContain('Content-Security-Policy')
    expect(preview).toContain("script-src 'none'")
    expect(preview.indexOf('Content-Security-Policy')).toBeLessThan(
      preview.indexOf('<style>')
    )
  })
})
