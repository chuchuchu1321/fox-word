import { useEffect, useRef, useState } from 'react'
import {
  Application, Container, Sprite, Texture,
  Graphics, Ticker, AnimatedSprite, Assets, Rectangle,
} from 'pixi.js'
import { createMachine, createActor } from 'xstate'
import { Howl } from 'howler'

type FoxState = 'sleeping' | 'wakingUp' | 'idle' | 'walking'
type Weather  = 'clear' | 'rain' | 'snow'
type BgKey    = 'meadow' | 'dawn' | 'mist' | 'autumn' | 'night' | 'sunset'

const BG_KEYS: BgKey[] = ['meadow', 'dawn', 'mist', 'autumn', 'night', 'sunset']
function getBgForHour(h: number): BgKey {
  if (h >= 5  && h < 8)  return 'dawn'
  if (h >= 8  && h < 17) return Math.random() < 0.5 ? 'meadow' : 'mist'
  if (h >= 17 && h < 19) return 'autumn'
  if (h >= 19 && h < 21) return 'sunset'
  return 'night'
}

const foxMachine = createMachine({
  id: 'fox', initial: 'sleeping',
  states: {
    sleeping: { on: { WAKE_UP:      'wakingUp' } },
    wakingUp: { on: { STRETCH_DONE: 'idle'     } },
    idle:     { on: { START_WALK: 'walking', FALL_ASLEEP: 'sleeping' } },
    walking:  { on: { STOP_WALK: 'idle',    FALL_ASLEEP: 'sleeping' } },
  },
})

interface Particle { x:number; y:number; speed:number; size:number; wobble:number; wobbleSpeed:number }
function makeParticle(w:number, h:number, top=false): Particle {
  return { x:Math.random()*w, y:top?-(10+Math.random()*h*0.3):Math.random()*h,
    speed:3+Math.random()*4, size:1+Math.random()*2.5,
    wobble:Math.random()*Math.PI*2, wobbleSpeed:0.02+Math.random()*0.03 }
}

interface Heart   { x:number; y:number; vx:number; vy:number; alpha:number; sc:number }
interface Star    { x:number; y:number; r:number; phase:number; speed:number }
interface Firefly { x:number; y:number; vx:number; vy:number; phase:number; timer:number }

// 环境光：随时间渐变的全屏色调叠加
function getTimeOverlay(m: number): [number, number, number, number] {
  const h = m / 60
  type S = { h:number; r:number; g:number; b:number; a:number }
  const stops: S[] = [
    { h:0,  r:0,   g:0,  b:40,  a:0.45 },
    { h:5,  r:180, g:60, b:20,  a:0.20 },
    { h:7,  r:255, g:160,b:30,  a:0.08 },
    { h:9,  r:0,   g:0,  b:0,   a:0.00 },
    { h:16, r:0,   g:0,  b:0,   a:0.00 },
    { h:18, r:255, g:110,b:10,  a:0.18 },
    { h:19, r:200, g:40, b:80,  a:0.28 },
    { h:20, r:60,  g:10, b:100, a:0.38 },
    { h:21, r:0,   g:0,  b:40,  a:0.45 },
    { h:24, r:0,   g:0,  b:40,  a:0.45 },
  ]
  let lo = stops[0], hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (h >= stops[i].h && h <= stops[i+1].h) { lo = stops[i]; hi = stops[i+1]; break }
  }
  const t = lo.h === hi.h ? 0 : Math.max(0, Math.min(1, (h - lo.h) / (hi.h - lo.h)))
  return [
    lo.r + (hi.r - lo.r) * t,
    lo.g + (hi.g - lo.g) * t,
    lo.b + (hi.b - lo.b) * t,
    lo.a + (hi.a - lo.a) * t,
  ]
}

const BG_LABELS: Record<BgKey, string> = {
  meadow:'🌿 草地', dawn:'🌸 黎明', mist:'🌫 薄雾',
  autumn:'🍂 秋野', night:'🌙 星空', sunset:'🌇 落日',
}
const STATE_LABELS: Record<FoxState, string> = {
  sleeping:'😴 睡觉', wakingUp:'✨ 惊醒', idle:'🐾 发呆', walking:'🏃 走路',
}
const WEATHER_LABELS: Record<Weather, string> = {
  clear:'☀️ 晴', rain:'🌧 雨', snow:'❄️ 雪',
}

const FRAME = 32
function sliceFrames(sheet: Texture, cells: [number,number][]): Texture[] {
  return cells.map(([r,c]) => new Texture({ source: sheet.source, frame: new Rectangle(c*FRAME, r*FRAME, FRAME, FRAME) }))
}
function buildAnimalTextures(sheet: Texture): Record<FoxState, Texture[]> {
  sheet.source.scaleMode = 'nearest'
  return {
    idle:     sliceFrames(sheet, [[0,0],[0,1],[0,2],[0,3]]),
    walking:  sliceFrames(sheet, [[3,0],[3,1],[3,2],[3,3],[3,4],[3,5]]),
    sleeping: sliceFrames(sheet, [[4,0],[4,1],[4,0],[4,1]]),
    wakingUp: sliceFrames(sheet, [[4,0],[5,0],[5,1],[5,2],[5,3],[0,0],[0,1]]),
  }
}

function makeSound(src: string, vol: number, loop = true) {
  return new Howl({ src:[src], loop, volume:0, onloaderror:()=>{} })
}

type Controls = {
  setBg:           (k: BgKey)    => void
  setFoxState:     (s: FoxState) => void
  setWeatherDirect:(w: Weather)  => void
}

export default function FoxCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef  = useRef<Controls | null>(null)
  const [displayTime,    setDisplayTime]  = useState('06:00')
  const [displayWeather, setWeather]      = useState<Weather>('rain')
  const [displayState,   setDisplayState] = useState<FoxState>('sleeping')

  useEffect(() => {
    if (!containerRef.current) return

    const now = new Date()
    let gameMinutes = now.getHours() * 60 + now.getMinutes()

    const app   = new Application()
    const actor = createActor(foxMachine)

    let currentFoxState: FoxState = 'sleeping'
    let elapsed = 0, stateElapsed = 0
    let baseX = 0, baseY = 0, targetX = 0, targetY = 0
    let facingLeft = true
    let weather: Weather = 'clear'
    let particles: Particle[] = []
    let hearts:    Heart[]    = []
    let pendingBgKey: BgKey | null = null
    let mouseX = 0, mouseY = 0
    let petCooldown = 0
    let nearbyGlow  = 0
    let currentBgKey: BgKey = getBgForHour(gameMinutes / 60)
    let timeInterval:  ReturnType<typeof setInterval> | null = null
    let weatherTimer:  ReturnType<typeof setInterval> | null = null
    let heartbeatTimer: ReturnType<typeof setTimeout>

    const snd = {
      wind:     makeSound('/audio/wind.mp3',     0.12),
      rain:     makeSound('/audio/rain.mp3',     0.55),
      snow:     makeSound('/audio/snow.mp3',     0.30),
      birds:    makeSound('/audio/birds.mp3',    0.45),
      crickets: makeSound('/audio/crickets.mp3', 0.50),
    }
    let audioStarted = false
    const startAudio = () => {
      if (audioStarted) return
      audioStarted = true
      snd.wind.play(); snd.wind.fade(0, 0.12, 2000)
      syncAudio()
    }
    document.addEventListener('pointerdown', startAudio, { once: true })

    const syncAudio = () => {
      if (!audioStarted) return
      const gh = gameMinutes / 60
      const isNight   = gh >= 21 || gh < 6
      const isMorning = gh >= 6  && gh < 17
      if (weather === 'rain') {
        if (!snd.rain.playing()) snd.rain.play()
        snd.rain.fade(snd.rain.volume(), 0.55, 1500)
        snd.snow.fade(snd.snow.volume(), 0, 1000)
        snd.birds.fade(snd.birds.volume(), 0, 1000)
      } else if (weather === 'snow') {
        if (!snd.snow.playing()) snd.snow.play()
        snd.snow.fade(snd.snow.volume(), 0.30, 1500)
        snd.rain.fade(snd.rain.volume(), 0, 1000)
        snd.birds.fade(snd.birds.volume(), 0, 1000)
      } else {
        snd.rain.fade(snd.rain.volume(), 0, 1200)
        snd.snow.fade(snd.snow.volume(), 0, 1200)
        if (isNight) {
          if (!snd.crickets.playing()) snd.crickets.play()
          snd.crickets.fade(snd.crickets.volume(), 0.50, 1500)
          snd.birds.fade(snd.birds.volume(), 0, 1200)
        } else if (isMorning) {
          if (!snd.birds.playing()) snd.birds.play()
          snd.birds.fade(snd.birds.volume(), 0.45, 1500)
          snd.crickets.fade(snd.crickets.volume(), 0, 1200)
        } else {
          snd.birds.fade(snd.birds.volume(), 0, 1200)
          snd.crickets.fade(snd.crickets.volume(), 0, 1200)
        }
      }
    }

    actor.subscribe((snap) => {
      const prev = currentFoxState
      const next = snap.value as FoxState
      if (prev === 'wakingUp' && next === 'idle' && Math.random() < 0.3)
        pendingBgKey = BG_KEYS[Math.floor(Math.random() * BG_KEYS.length)]
      currentFoxState = next
      stateElapsed    = 0
      setDisplayState(next)
      if (next === 'walking' && app.screen.width > 0) {
        const angle = Math.random() * Math.PI * 2
        const r = 200 + Math.random() * 150
        const W = app.screen.width, H = app.screen.height
        targetX = Math.max(W*0.1, Math.min(W*0.9, baseX + Math.cos(angle)*r))
        targetY = Math.max(H*0.58, Math.min(H*0.76, baseY + Math.sin(angle)*r*0.25))
      }
    })
    actor.start()

    const scheduleHeartbeat = () => {
      heartbeatTimer = setTimeout(() => {
        const s = currentFoxState, r = Math.random()
        if      (s === 'sleeping' && r < 0.25) actor.send({ type: 'WAKE_UP' })
        else if (s === 'idle') {
          if      (r < 0.40) actor.send({ type: 'START_WALK' })
          else if (r < 0.55) actor.send({ type: 'FALL_ASLEEP' })
        } else if (s === 'walking' && r < 0.30) actor.send({ type: 'STOP_WALK' })
        scheduleHeartbeat()
      }, 5000 + Math.random() * 5000)
    }
    scheduleHeartbeat()

    app.init({
      width: window.innerWidth, height: window.innerHeight,
      backgroundColor: 0x87ceeb, antialias: false,
    }).then(async () => {
      if (!containerRef.current) return
      containerRef.current.appendChild(app.canvas)

      const W = app.screen.width, H = app.screen.height
      baseX = W/2; baseY = H*0.70
      targetX = baseX; targetY = baseY
      mouseX = W/2; mouseY = H/2
      particles = Array.from({ length: 120 }, () => makeParticle(W, H))

      // 星星：只在屏幕上方 25% 分布
      const stars: Star[] = Array.from({ length: 80 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H * 0.25,
        r: 0.5 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.025 + Math.random() * 0.04,
      }))

      // 萤火虫：中下部区域漫游
      const fireflies: Firefly[] = Array.from({ length: 15 }, () => ({
        x: W*0.05 + Math.random()*W*0.90,
        y: H*0.45 + Math.random()*H*0.35,
        vx: (Math.random()-0.5)*0.7,
        vy: (Math.random()-0.5)*0.35,
        phase: Math.random()*Math.PI*2,
        timer: Math.random()*200,
      }))

      // 加载资产
      const allTextures = (await Promise.all([
        '/assets/background/meadow.jpg', '/assets/background/dawn.jpg',
        '/assets/background/mist.jpg',   '/assets/background/autumn.jpg',
        '/assets/background/night.jpg',  '/assets/background/sunset.jpg',
        '/assets/animals/MiniFox.png',
      ].map(p => Assets.load(p)))) as Texture[]

      const [meadowTex,dawnTex,mistTex,autumnTex,nightTex,sunsetTex,foxSheet] = allTextures
      const bgTex: Record<BgKey,Texture> = {
        meadow:meadowTex, dawn:dawnTex, mist:mistTex,
        autumn:autumnTex, night:nightTex, sunset:sunsetTex,
      }

      const PAR_ROOM = 1.15
      const makeBgSprite = (tex: Texture): Sprite => {
        const scale = Math.max(W/tex.width, H/tex.height) * PAR_ROOM
        const s = new Sprite(tex)
        s.anchor.set(0.5); s.scale.set(scale)
        s.x = W/2; s.y = H/2; return s
      }
      const bgContainer = new Container()
      let bgA: Sprite = makeBgSprite(bgTex[getBgForHour(gameMinutes/60)])
      bgContainer.addChild(bgA)
      let bgB: Sprite | null = null

      // 图层顺序（从底到顶）
      const skyGfx         = new Graphics()  // 星星 + 月亮
      const weatherGfx     = new Graphics()  // 雨 / 雪
      const timeOverlayGfx = new Graphics()  // 环境光色调
      const fxGfx          = new Graphics()  // 光晕 + 爱心（狐狸下方）
      const fireflyGfx     = new Graphics()  // 萤火虫（狐狸上方）

      app.stage.addChild(bgContainer)
      app.stage.addChild(skyGfx)
      app.stage.addChild(weatherGfx)
      app.stage.addChild(timeOverlayGfx)
      app.stage.addChild(fxGfx)

      const FOX_SCALE = (H * 0.14) / FRAME
      const foxContainer = new Container()
      foxContainer.x = baseX; foxContainer.y = baseY
      foxContainer.scale.set(FOX_SCALE)
      app.stage.addChild(foxContainer)
      app.stage.addChild(fireflyGfx)

      const texMap = buildAnimalTextures(foxSheet)
      const make = (key: FoxState, fps: number, loop = true): AnimatedSprite => {
        const a = new AnimatedSprite(texMap[key])
        a.animationSpeed = fps/60; a.loop = loop
        a.anchor.set(0.5, 1); a.visible = false
        foxContainer.addChild(a); return a
      }
      const foxAnims: Record<FoxState, AnimatedSprite> = {
        idle:     make('idle',     3),
        walking:  make('walking',  10),
        sleeping: make('sleeping', 2),
        wakingUp: make('wakingUp', 5, false),
      }
      foxAnims.wakingUp.onComplete = () => actor.send({ type: 'STRETCH_DONE' })
      let activeFox: AnimatedSprite = foxAnims['sleeping']
      activeFox.visible = true; activeFox.play()

      const switchAnim = (next: FoxState) => {
        activeFox.visible = false; activeFox.stop()
        activeFox = foxAnims[next]
        activeFox.gotoAndPlay(0); activeFox.visible = true
      }

      app.stage.eventMode = 'static'
      app.stage.on('pointermove', (e) => { mouseX = e.global.x; mouseY = e.global.y })

      foxContainer.eventMode = 'static'
      foxContainer.cursor = 'pointer'
      foxContainer.on('pointerdown', () => {
        if (petCooldown > 0) return
        petCooldown = 120
        for (let i = 0; i < 6; i++) {
          hearts.push({
            x: (Math.random()-0.5)*40,
            y: -FRAME*FOX_SCALE*0.8,
            vx: (Math.random()-0.5)*3,
            vy: -(2.5+Math.random()*2),
            alpha: 1, sc: 0.5+Math.random()*0.5,
          })
        }
        const origScale = Math.abs(foxContainer.scale.x)
        foxContainer.scale.set(origScale * 1.18)
        setTimeout(() => { if (!foxContainer.destroyed) foxContainer.scale.set(origScale) }, 200)
        if (currentFoxState === 'sleeping') actor.send({ type: 'WAKE_UP' })
        startAudio()
      })

      controlsRef.current = {
        setBg: (k) => { pendingBgKey = k },
        setFoxState: (s) => {
          switchAnim(s); currentFoxState = s; stateElapsed = 0; setDisplayState(s)
          if (s === 'walking') {
            const angle = Math.random()*Math.PI*2, r = 200+Math.random()*150
            targetX = Math.max(W*0.1, Math.min(W*0.9, foxContainer.x + Math.cos(angle)*r))
            targetY = Math.max(H*0.58, Math.min(H*0.76, foxContainer.y + Math.sin(angle)*r*0.25))
          }
        },
        setWeatherDirect: (w) => { weather = w; setWeather(w); syncAudio() },
      }

      let prevHour = Math.floor(gameMinutes / 60)
      timeInterval = setInterval(() => {
        gameMinutes = (gameMinutes + 1) % (24*60)
        const hh = Math.floor(gameMinutes/60), mm = gameMinutes%60
        setDisplayTime(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`)
        if (hh !== prevHour) {
          prevHour = hh; syncAudio()
          if (Math.random() < 0.25) pendingBgKey = getBgForHour(hh)
        }
      }, 1000)

      weatherTimer = setInterval(() => {
        const r = Math.random()
        const next: Weather = r < 0.33 ? 'clear' : r < 0.66 ? 'rain' : 'snow'
        weather = next; setWeather(next); syncAudio()
      }, 20000)

      let prevFoxState: FoxState = 'sleeping'

      app.ticker.add((ticker: Ticker) => {
        elapsed      += ticker.deltaTime
        stateElapsed += ticker.deltaTime
        if (petCooldown > 0) petCooldown -= ticker.deltaTime

        const gameHour = gameMinutes / 60
        const isNight  = gameHour >= 21 || gameHour < 6

        if (currentFoxState !== prevFoxState) {
          switchAnim(currentFoxState); prevFoxState = currentFoxState
        }

        // 背景视差
        const parallaxX = -(foxContainer.x - W/2) * 0.10
        bgA.x = W/2 + parallaxX
        if (bgB) bgB.x = W/2 + parallaxX

        // 背景淡入淡出
        if (pendingBgKey && !bgB) {
          bgB = makeBgSprite(bgTex[pendingBgKey])
          bgB.alpha = 0; bgContainer.addChild(bgB)
          currentBgKey = pendingBgKey; pendingBgKey = null
        }
        if (bgB) {
          bgB.alpha = Math.min(1, bgB.alpha + 0.008*ticker.deltaTime)
          bgB.x = W/2 + parallaxX
          if (bgB.alpha >= 1) {
            bgContainer.removeChild(bgA); bgA.destroy()
            bgA = bgB; bgB = null
          }
        }

        // ── 星星 + 月亮 ────────────────────────────────────────────
        skyGfx.clear()
        // 可见度：夜晚背景 或 20h渐入→整夜全亮→6h渐出
        const isNightBg = currentBgKey === 'night'
        const starAlpha = (() => {
          if (isNightBg || gameHour >= 20 || gameHour < 6) return 1
          if (gameHour < 7)   return 1 - (gameHour - 6)
          if (gameHour >= 18) return (gameHour - 18) / 2
          return 0
        })()

        if (starAlpha > 0.01) {
          // 星星
          for (const star of stars) {
            star.phase += star.speed * ticker.deltaTime
            const a = starAlpha * (0.5 + 0.5 * Math.sin(star.phase))
            skyGfx.circle(star.x, star.y, star.r)
            skyGfx.fill({ color: 0xffffff, alpha: a })
          }

          // 月亮：从右(20h)→顶部(0h)→左(6h) 弧形运动
          const moonProgress = gameHour >= 20
            ? (gameHour - 20) / 10
            : gameHour <= 7
              ? (gameHour + 4) / 10
              : 0
          const moonX = W*0.5 + Math.cos(moonProgress * Math.PI) * W*0.35
          const moonY = H*0.06 + (1 - Math.sin(moonProgress * Math.PI)) * H*0.32

          skyGfx.circle(moonX, moonY, 30)
          skyGfx.fill({ color: 0xfff8d0, alpha: starAlpha * 0.12 })
          skyGfx.circle(moonX, moonY, 20)
          skyGfx.fill({ color: 0xfff8d0, alpha: starAlpha * 0.22 })
          skyGfx.circle(moonX, moonY, 13)
          skyGfx.fill({ color: 0xfffce8, alpha: starAlpha * 0.90 })
        }

        // ── 天气粒子 ───────────────────────────────────────────────
        weatherGfx.clear()
        if (weather === 'rain') {
          for (const p of particles) {
            p.x += 1.8*ticker.deltaTime; p.y += p.speed*ticker.deltaTime
            if (p.y > H+10) Object.assign(p, makeParticle(W, H, true))
            weatherGfx.moveTo(p.x, p.y).lineTo(p.x-6, p.y-14)
          }
          weatherGfx.stroke({ width:1.5, color:0x88ccff, alpha:0.45 })
        } else if (weather === 'snow') {
          for (const p of particles) {
            p.wobble += p.wobbleSpeed*ticker.deltaTime
            p.x += Math.sin(p.wobble)*0.8*ticker.deltaTime
            p.y += p.speed*0.4*ticker.deltaTime
            if (p.y > H+10) Object.assign(p, makeParticle(W, H, true))
            weatherGfx.circle(p.x, p.y, p.size)
          }
          weatherGfx.fill({ color:0xeef4ff, alpha:0.75 })
        }

        // ── 时间环境光叠加 ─────────────────────────────────────────
        const [or, og, ob, oa] = getTimeOverlay(gameMinutes)
        timeOverlayGfx.clear()
        if (oa > 0.005) {
          const col = (Math.round(or) << 16) | (Math.round(og) << 8) | Math.round(ob)
          timeOverlayGfx.rect(0, 0, W, H)
          timeOverlayGfx.fill({ color: col, alpha: oa })
        }

        // ── 鼠标靠近 + 光晕 ────────────────────────────────────────
        fxGfx.clear()
        const foxScreenX = foxContainer.x
        const foxScreenY = foxContainer.y - FRAME*FOX_SCALE*0.5
        const mouseDist  = Math.sqrt((mouseX-foxScreenX)**2 + (mouseY-foxScreenY)**2)
        const targetGlow = mouseDist < 160 ? 1 : 0
        nearbyGlow += (targetGlow - nearbyGlow) * 0.06 * ticker.deltaTime

        if (nearbyGlow > 0.02) {
          foxAnims.idle.animationSpeed     = 3/60 + nearbyGlow*4/60
          foxAnims.sleeping.animationSpeed = 2/60 + nearbyGlow*3/60
          fxGfx.circle(foxContainer.x, foxContainer.y - FRAME*FOX_SCALE*0.45, FRAME*FOX_SCALE*0.8)
          fxGfx.fill({ color: 0xffdd88, alpha: nearbyGlow*0.18 })
        } else {
          foxAnims.idle.animationSpeed     = 3/60
          foxAnims.sleeping.animationSpeed = 2/60
        }

        if (isNight) {
          const nr = FRAME*FOX_SCALE*0.6
          fxGfx.circle(foxContainer.x, foxContainer.y - nr, nr)
          fxGfx.fill({ color: 0xff7c2a, alpha: 0.20 + Math.sin(elapsed*0.04)*0.08 })
        }

        // 爱心粒子
        for (let i = hearts.length-1; i >= 0; i--) {
          const hrt = hearts[i]
          hrt.x  += hrt.vx * ticker.deltaTime
          hrt.y  += hrt.vy * ticker.deltaTime
          hrt.vy += 0.12 * ticker.deltaTime
          hrt.alpha -= 0.012 * ticker.deltaTime
          if (hrt.alpha <= 0) { hearts.splice(i, 1); continue }
          const hx = foxContainer.x + hrt.x
          const hy = foxContainer.y + hrt.y
          const sc = 7 * hrt.sc
          fxGfx.circle(hx-sc*0.5, hy-sc*0.3, sc*0.55)
          fxGfx.circle(hx+sc*0.5, hy-sc*0.3, sc*0.55)
          fxGfx.poly([hx-sc, hy, hx+sc, hy, hx, hy+sc*1.2])
          fxGfx.fill({ color: 0xff4477, alpha: hrt.alpha })
        }

        // ── 萤火虫（18-22h） ──────────────────────────────────────
        fireflyGfx.clear()
        const fireflyAlpha = (() => {
          if (isNightBg || (gameHour >= 19 && gameHour < 21)) return 1
          if (gameHour >= 18 && gameHour < 19) return gameHour - 18
          if (gameHour >= 21 && gameHour < 22) return 1 - (gameHour - 21)
          return 0
        })()

        if (fireflyAlpha > 0.01) {
          for (const ff of fireflies) {
            ff.phase += 0.04 * ticker.deltaTime
            ff.timer -= ticker.deltaTime
            if (ff.timer <= 0) {
              ff.vx = (Math.random()-0.5)*0.7
              ff.vy = (Math.random()-0.5)*0.35
              ff.timer = 80 + Math.random()*160
            }
            ff.x += ff.vx * ticker.deltaTime
            ff.y += ff.vy * ticker.deltaTime
            if (ff.x < W*0.05 || ff.x > W*0.95) ff.vx *= -1
            if (ff.y < H*0.42 || ff.y > H*0.82) ff.vy *= -1

            const pulse = 0.3 + 0.7 * Math.abs(Math.sin(ff.phase))
            const fa = fireflyAlpha * pulse
            // 大光晕
            fireflyGfx.circle(ff.x, ff.y, 18);  fireflyGfx.fill({ color: 0x88ff00, alpha: fa*0.06 })
            fireflyGfx.circle(ff.x, ff.y, 10);  fireflyGfx.fill({ color: 0xaaff44, alpha: fa*0.14 })
            // 中圈
            fireflyGfx.circle(ff.x, ff.y, 5);   fireflyGfx.fill({ color: 0xccff66, alpha: fa*0.55 })
            // 亮核
            fireflyGfx.circle(ff.x, ff.y, 2);   fireflyGfx.fill({ color: 0xeeffcc, alpha: fa*0.95 })
          }
        }

        // ── 位置动画 ──────────────────────────────────────────────
        switch (currentFoxState) {
          case 'sleeping':
          case 'wakingUp':
            foxContainer.x += (baseX - foxContainer.x) * 0.04
            foxContainer.y += (baseY - foxContainer.y) * 0.04
            break
          case 'idle':
            foxContainer.x += (baseX - foxContainer.x) * 0.02
            foxContainer.y = baseY + Math.sin(stateElapsed*0.04) * 2
            break
          case 'walking': {
            const dx = targetX - foxContainer.x
            const dy = targetY - foxContainer.y
            const dist = Math.sqrt(dx*dx + dy*dy)
            const ease = Math.min(0.022, dist*0.00018 + 0.004)
            foxContainer.x += dx * ease
            foxContainer.y += dy * ease
            if (Math.abs(dx) > 2) facingLeft = dx < 0
            foxAnims.walking.animationSpeed = Math.min(0.20, 0.07 + dist*0.00015)
            if (dist < 3) {
              baseX = foxContainer.x; baseY = foxContainer.y
              actor.send({ type: 'STOP_WALK' })
            }
            break
          }
        }

        foxContainer.scale.x = (facingLeft ? 1 : -1) * Math.abs(foxContainer.scale.x)
      })

      syncAudio()
    })

    return () => {
      clearTimeout(heartbeatTimer)
      if (timeInterval) clearInterval(timeInterval)
      if (weatherTimer)  clearInterval(weatherTimer)
      document.removeEventListener('pointerdown', startAudio)
      Object.values(snd).forEach(s => s.unload())
      actor.stop()
      app.destroy(true)
    }
  }, [])

  const ctrl = controlsRef

  return (
    <div style={{ width:'100%', height:'100%', position:'relative' }}>
      <div ref={containerRef} style={{ width:'100%', height:'100%' }} />

      <div style={{ position:'absolute', top:16, left:'50%', transform:'translateX(-50%)',
        display:'flex', gap:10, pointerEvents:'none', userSelect:'none' }}>
        <Pill>🕐 {displayTime}</Pill>
        <Pill>{WEATHER_LABELS[displayWeather]}</Pill>
        <Pill>{STATE_LABELS[displayState]}</Pill>
      </div>

      <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
        display:'flex', flexDirection:'column', alignItems:'center', gap:8, userSelect:'none' }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
          {(Object.keys(BG_LABELS) as BgKey[]).map(k => (
            <CtrlBtn key={k} onClick={() => ctrl.current?.setBg(k)}>{BG_LABELS[k]}</CtrlBtn>
          ))}
        </div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
          {(Object.keys(STATE_LABELS) as FoxState[]).map(s => (
            <CtrlBtn key={s} onClick={() => ctrl.current?.setFoxState(s)}>{STATE_LABELS[s]}</CtrlBtn>
          ))}
          <div style={{ width:1, background:'rgba(255,255,255,0.2)', margin:'0 2px' }} />
          {(Object.keys(WEATHER_LABELS) as Weather[]).map(w => (
            <CtrlBtn key={w} onClick={() => ctrl.current?.setWeatherDirect(w)}>{WEATHER_LABELS[w]}</CtrlBtn>
          ))}
        </div>
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background:'rgba(0,0,0,0.48)', color:'#fff', fontFamily:'monospace',
      fontSize:13, padding:'6px 14px', borderRadius:20, letterSpacing:1.5,
      backdropFilter:'blur(6px)', whiteSpace:'nowrap' }}>
      {children}
    </div>
  )
}

function CtrlBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background:'rgba(0,0,0,0.52)', color:'#fff', fontFamily:'monospace',
      fontSize:12, padding:'5px 12px', borderRadius:16,
      border:'1px solid rgba(255,255,255,0.18)',
      backdropFilter:'blur(8px)', whiteSpace:'nowrap', cursor:'pointer',
      letterSpacing:1, transition:'background 0.15s',
    }}
    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.52)')}>
      {children}
    </button>
  )
}
