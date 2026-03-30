import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const WEATHER_MAP: Record<string, string> = { clear: '晴天', rain: '下雨', snow: '下雪' }
const STATE_MAP:   Record<string, string> = {
  sleeping: '在睡觉', wakingUp: '刚醒来', idle: '发呆', walking: '在走路',
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const { weather = 'clear', state = 'idle', hour = 12, affection = 50 } = req.body ?? {}

  const context = [
    `时间：${hour}点`,
    `天气：${WEATHER_MAP[weather] ?? weather}`,
    `状态：${STATE_MAP[state] ?? state}`,
    `和主人的亲密度：${affection}/100`,
  ].join('，')

  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 20,
      system: `你是一只住在森林里的小狐狸，偶尔会轻声自言自语。
规则：
- 用中文，最多10个字
- 像动物的内心独白，不是对话，不打招呼
- 必须符合当前时间/天气/状态的情境
- 有30%概率保持沉默（返回空字符串）
示例好句：「好冷啊」「月亮好圆」「肚子有点饿」「困了困了」「有虫子吗」「雨下不停」`,
      messages: [{ role: 'user', content: context }],
    })

    const raw  = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    // 去掉可能的引号
    const text = raw.replace(/^[「『"']+|[」』"']+$/g, '')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.json({ text })
  } catch {
    res.status(500).json({ text: '' })
  }
}
