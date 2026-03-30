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

  const prompt = `你是一只住在森林里的小狐狸，偶尔会轻声自言自语。
规则：
- 用中文，最多10个字
- 像动物的内心独白，不是对话，不打招呼
- 必须符合当前时间/天气/状态的情境
- 有30%概率保持沉默（只输出一个英文句点"."）
示例：好冷啊 / 月亮好圆 / 肚子有点饿 / 困了困了 / 有虫子吗 / 雨下不停

当前情境：${context}
直接输出狐狸说的话（不超过10字），或者只输出一个句点表示沉默：`

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 24, temperature: 1.1 },
        }),
      }
    )
    const data = await resp.json()
    const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    const text = raw === '.' ? '' : raw.replace(/^[「『"'\s]+|[」』"'\s]+$/g, '').slice(0, 12)
    res.json({ text })
  } catch (err: any) {
    res.status(500).json({ text: '', error: err?.message ?? String(err) })
  }
}
