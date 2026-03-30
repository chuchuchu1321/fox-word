// 按情境索引的短语库，无需外部 API
type Ctx = { weather: string; state: string; hour: number; affection: number }

const phrases = {
  night:   ['月亮好圆','星星好多','好安静啊','有点饿了','夜风好凉'],
  dawn:    ['天亮了','鸟叫了','露水好凉','好困啊','睡不够'],
  morning: ['今天晴','虫子在哪','草很香','想跑跑','心情不错'],
  evening: ['夕阳好看','有点累了','风变凉了','要回家了','云好红'],
  rain:    ['下雨了','毛湿了','好讨厌水','躲一躲','雨声好听'],
  snow:    ['下雪了','好冷啊','爪子冻了','雪好软','白白的'],
  sleep:   ['呼……','zzz','好困','太暖了','别吵'],
  lonely:  ['好无聊','有人吗','等好久了','想玩','叹气'],
  happy:   ['开心！','蹦蹦跳','今天好','嘿嘿','最喜欢了'],
  walk:    ['去哪呢','溜达中','发现啥了','这边这边','脚好酸'],
}

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getSpeech(ctx: Ctx): string {
  if (Math.random() < 0.28) return ''  // 30% 沉默

  const h = ctx.hour
  if (ctx.state === 'sleeping') return pick(phrases.sleep)
  if (ctx.weather === 'rain')   return pick(phrases.rain)
  if (ctx.weather === 'snow')   return pick(phrases.snow)
  if (ctx.state === 'walking')  return pick(phrases.walk)
  if (ctx.affection > 70)       return pick(phrases.happy)
  if (ctx.affection < 25)       return pick(phrases.lonely)
  if (h >= 20 || h < 5)         return pick(phrases.night)
  if (h >= 5  && h < 8)         return pick(phrases.dawn)
  if (h >= 17 && h < 20)        return pick(phrases.evening)
  return pick(phrases.morning)
}

export default function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()
  const ctx: Ctx = {
    weather:   req.body?.weather   ?? 'clear',
    state:     req.body?.state     ?? 'idle',
    hour:      req.body?.hour      ?? 12,
    affection: req.body?.affection ?? 50,
  }
  res.json({ text: getSpeech(ctx) })
}
