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
export const LOGIC_EXPECTED = {
  answer: 21,
  round: 9,
  star: 12,
} as const

export const KNOWLEDGE_EXPECTED: Record<'q1' | 'q2' | 'q3', string[]> = {
  q1: ['Pierre Agostini', 'Ferenc Krausz', "Anne L'Huillier"],
  q2: ['2023-10-02'],
  q3: ['Jon Fosse'],
}

export const MAX_OUTPUT_TOKENS = {
  logic: 1024,
  drawing: 9216,
  knowledge: 2048,
} as const

export const TASK_TIMEOUT_MS = {
  logic: 120_000,
  // Generating a full animated HTML document can take 10-30 minutes; the relay
  // allows up to 30 minutes for upstream headers, so leave a small margin for
  // the backend to report its own timeout first.
  drawing: 1_860_000,
  knowledge: 120_000,
} as const

export const DRAWING_SIZE = {
  width: 1200,
  height: 800,
} as const

export const DRAWING_STYLES = [
  {
    name: 'Iron Man',
    description: 'red and gold armored suit with a glowing chest reactor',
  },
  {
    name: 'Spider-Man',
    description: 'red and blue suit with a web pattern and mask',
  },
  {
    name: 'Batman',
    description: 'dark cowl, cape, and utility belt',
  },
  {
    name: 'Astronaut',
    description: 'white spacesuit with a clear helmet and life-support pack',
  },
] as const

export const LOGIC_PROMPT = `袋中有三种口味、两种形状的糖。可以凭手感主动选择圆形或五角星形，但不能辨认口味。数量：圆形苹果7、桃子9、西瓜8；五角星苹果7、桃子6、西瓜4。活动前要固定选择两种形状各取多少颗。最少取多少颗，能保证“圆形苹果+五角星桃子”或“圆形桃子+五角星苹果”至少一种配对？

只返回 JSON，不要解释 JSON 之外的任何内容：
{"answer":最少总数整数,"round":圆形取数整数,"star":五角星取数整数,"explanation":"保证性和最小性的理由"}

必须按“先固定圆形和五角星形各自取数，再面对所有可能的抽取结果”来论证。不要把不能主动选择形状的随机抓取问题混入最终结论。`

export function buildDrawingPrompt(
  styleName: string,
  styleDescription: string
) {
  const styleLine =
    styleName === styleDescription
      ? `本轮鹈鹕造型由用户指定：${styleDescription}。`
      : `本轮鹈鹕造型：${styleName}，${styleDescription}。`

  return `创建一个完整的 HTML，主体是 SVG 绘制的鹈鹕骑自行车的 2D 动画。鹈鹕要有长喙和喉囊，腿脚与踏板、车轮动作协调。使用内联 SVG、CSS 或 SMIL 动画；不要 JavaScript、外部资源、链接、图片或字体。画面尺寸 1200x800。

${styleLine}动画加载后必须自动播放，并且必须使用 CSS animation-iteration-count: infinite 或 SMIL repeatCount="indefinite" 无缝循环；鹈鹕腿部、踏板和车轮的动作周期要协调，整个画面始终位于 1200x800 范围内。

只返回完整 HTML 源码，不要代码块，不要解释。`
}

export const KNOWLEDGE_PROMPT = `完成三题知识抽查，独立回答，不联网、不调用工具。只给答案，不要猜测或自报知识截止日期。 q1: 2023 年诺贝尔物理学奖的全部获奖者是谁？按官方英文姓名返回列表。 q2: Python 3.12.0 正式版实际发布日期是哪一天（不是预发布或计划日期）？返回 YYYY-MM-DD。 q3: 2023 年诺贝尔文学奖的获奖者是谁？返回官方英文姓名。

只返回JSON：{"answers":[{"id":"q1","answer":["简短答案"]}]}。 每题都返回，用q1到q3标识。answer必须为数组，实体分别放入，名字/作品按题目要求使用英文；日期使用YYYY-MM-DD。 无法回答时answer为null。不要输出解释或省略题目。`
