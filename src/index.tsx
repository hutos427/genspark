import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL?: string }
type Vars = { uid: number }
const app = new Hono<{ Bindings: Bindings; Variables: Vars }>()

// ---------- crypto helpers (Web Crypto) ----------
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const randHex = (n = 16) => toHex(crypto.getRandomValues(new Uint8Array(n)).buffer)
async function hashPw(pw: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256)
  return toHex(bits)
}
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) // KST

// ---------- auth ----------
app.post('/api/auth/signup', async (c) => {
  const b = await c.req.json()
  const username = String(b.username || '').trim().toLowerCase()
  const name = String(b.name || '').trim(), email = String(b.email || '').trim()
  const { password } = b
  if (!username || !password || !name || !email) return c.json({ error: '필수 항목을 입력해주세요.' }, 400)
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) return c.json({ error: '아이디는 영문/숫자 4~20자입니다.' }, 400)
  if (password.length < 6) return c.json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400)
  const ex = await c.env.DB.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').bind(username).first()
  if (ex) return c.json({ error: '이미 사용 중인 아이디입니다.' }, 409)
  const salt = randHex()
  const hash = await hashPw(password, salt)
  await c.env.DB.prepare(
    'INSERT INTO users (username,password_hash,salt,name,email,phone,birth,gender,height) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(username, hash, salt, name, email, b.phone || null, b.birth || null, b.gender || null, b.height || null).run()
  return c.json({ ok: true })
})

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json()
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE')
    .bind(String(username || '').trim()).first<any>()
  if (!u || (await hashPw(password || '', u.salt)) !== u.password_hash)
    return c.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401)
  const token = randHex(32)
  await c.env.DB.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)')
    .bind(token, u.id, Date.now() + 30 * 86400e3).run()
  setCookie(c, 'sid', token, { httpOnly: true, path: '/', sameSite: 'None', maxAge: 30 * 86400, secure: true, partitioned: true })
  return c.json({ ok: true, token })
})

const getToken = (c: any) => {
  const h = c.req.header('Authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7) : getCookie(c, 'sid')
}

app.post('/api/auth/logout', async (c) => {
  const t = getToken(c)
  if (t) await c.env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(t).run()
  deleteCookie(c, 'sid', { path: '/', secure: true, sameSite: 'None', partitioned: true })
  return c.json({ ok: true })
})

app.post('/api/auth/find-id', async (c) => {
  const { name, email } = await c.req.json()
  const r = await c.env.DB.prepare('SELECT username FROM users WHERE name=? AND email=? COLLATE NOCASE')
    .bind(String(name || '').trim(), String(email || '').trim()).all<any>()
  if (!r.results.length) return c.json({ error: '일치하는 회원 정보가 없습니다.' }, 404)
  const mask = (s: string) => s.slice(0, Math.max(2, s.length - 3)) + '*'.repeat(Math.min(3, s.length - 2))
  return c.json({ usernames: r.results.map((x) => mask(x.username)) })
})

app.post('/api/auth/reset-password', async (c) => {
  const { username, email } = await c.req.json()
  const u = await c.env.DB.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE AND email=? COLLATE NOCASE')
    .bind(String(username || '').trim(), String(email || '').trim()).first<any>()
  if (!u) return c.json({ error: '일치하는 회원 정보가 없습니다.' }, 404)
  const temp = randHex(4)
  const salt = randHex()
  await c.env.DB.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').bind(await hashPw(temp, salt), salt, u.id).run()
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id).run()
  return c.json({ tempPassword: temp })
})

// ---------- auth middleware ----------
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next()
  const t = getToken(c)
  if (!t) return c.json({ error: 'unauthorized' }, 401)
  const s = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token=?').bind(t).first<any>()
  if (!s || s.expires_at < Date.now()) return c.json({ error: 'unauthorized' }, 401)
  c.set('uid', s.user_id)
  await next()
})

// ---------- me ----------
app.get('/api/me', async (c) => {
  const u = await c.env.DB.prepare('SELECT id,username,name,email,phone,birth,gender,height,created_at FROM users WHERE id=?').bind(c.get('uid')).first()
  const ib = await c.env.DB.prepare('SELECT * FROM inbody WHERE user_id=? ORDER BY date DESC, id DESC LIMIT 1').bind(c.get('uid')).first()
  return c.json({ user: u, inbody: ib })
})
app.put('/api/me', async (c) => {
  const b = await c.req.json()
  if (!b.name || !b.email) return c.json({ error: '이름과 이메일은 필수입니다.' }, 400)
  await c.env.DB.prepare('UPDATE users SET name=?,email=?,phone=?,birth=?,gender=?,height=? WHERE id=?')
    .bind(b.name, b.email, b.phone || null, b.birth || null, b.gender || null, b.height || null, c.get('uid')).run()
  return c.json({ ok: true })
})
app.put('/api/me/password', async (c) => {
  const { current, next: np } = await c.req.json()
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(c.get('uid')).first<any>()
  if ((await hashPw(current || '', u.salt)) !== u.password_hash) return c.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, 400)
  if (!np || np.length < 6) return c.json({ error: '새 비밀번호는 6자 이상이어야 합니다.' }, 400)
  const salt = randHex()
  await c.env.DB.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').bind(await hashPw(np, salt), salt, u.id).run()
  return c.json({ ok: true })
})

// ---------- AI food photo calorie analysis ----------
app.post('/api/meals/analyze', async (c) => {
  const { image, hint } = await c.req.json()
  if (!c.env.OPENAI_API_KEY) return c.json({ error: 'AI API 키가 설정되지 않았습니다.' }, 500)
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(image))
    return c.json({ error: '이미지 형식이 올바르지 않습니다.' }, 400)
  if (image.length > 4_000_000) return c.json({ error: '이미지가 너무 큽니다.' }, 413)
  const prompt = `당신은 영양사입니다. 사진 속 음식을 분석해 각 음식의 1인분 섭취량 기준 칼로리와 영양소를 추정하세요.
그릇 크기, 양, 조리법(튀김/볶음 등)을 고려하세요. 비빔밥·찌개·덮밥처럼 하나의 요리는 재료로 쪼개지 말고 요리 단위 1개 항목으로, 밥·국·반찬처럼 따로 담긴 것은 각각 항목으로 나누세요(최대 8개). 음식이 아니면 is_food=false.
${hint ? `사용자 메모: ${String(hint).slice(0, 200)}\n` : ''}반드시 아래 JSON 형식으로만 한국어로 답하세요:
{"is_food":true,"items":[{"name":"음식명","amount":"추정 양(예: 1공기 210g)","calories":0,"carbs":0,"protein":0,"fat":0}],"total_calories":0,"confidence":"높음|보통|낮음","comment":"한 줄 영양 코멘트"}`
  const base = (c.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }],
      }),
    })
    if (!r.ok) return c.json({ error: `AI 분석 실패 (${r.status})` }, 502)
    const data: any = await r.json()
    const out = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    if (out.is_food === false || !Array.isArray(out.items) || !out.items.length)
      return c.json({ error: '음식을 인식하지 못했습니다. 다른 사진을 시도해주세요.' }, 422)
    const num = (v: any) => Math.max(0, Math.round(Number(v) || 0))
    const items = out.items.slice(0, 10).map((i: any) => ({
      name: String(i.name || '음식').slice(0, 60), amount: String(i.amount || '').slice(0, 40),
      calories: num(i.calories), carbs: num(i.carbs), protein: num(i.protein), fat: num(i.fat),
    }))
    return c.json({ items, total: items.reduce((a: number, b: any) => a + b.calories, 0),
      confidence: out.confidence || '보통', comment: String(out.comment || '').slice(0, 200) })
  } catch (e: any) {
    return c.json({ error: 'AI 분석 중 오류가 발생했습니다.' }, 502)
  }
})

// ---------- AI 맞춤 1주 운동·식단 계획 ----------
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const WORKOUT_TYPES = ['걷기', '러닝', '사이클', '수영', '웨이트', '요가', '필라테스', '등산', 'HIIT', '기타']
const MEALS = ['아침', '점심', '저녁', '간식']
const AI_PLAN_DAILY_LIMIT = 10
const clip = (v: any, n: number) => String(v ?? '').slice(0, n)
const int = (v: any, lo: number, hi: number, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }

function normalizePlan(out: any, start: string) {
  const days = (Array.isArray(out.days) ? out.days : []).slice(0, 7).map((d: any, i: number) => {
    const rest = !!d.rest
    const meals: Record<string, any> = {}
    for (const m of MEALS) {
      const x = d.meals?.[m]
      if (x && x.menu) meals[m] = { menu: clip(x.menu, 80), kcal: int(x.kcal, 0, 2000) }
    }
    return {
      date: addDays(start, i),
      rest,
      focus: clip(d.focus || (rest ? '휴식' : '운동'), 30),
      type: WORKOUT_TYPES.includes(d.type) ? d.type : (rest ? '기타' : '기타'),
      time: /^\d{2}:\d{2}$/.test(d.time) ? d.time : '19:00',
      duration_min: rest ? 0 : int(d.duration_min, 5, 180, 30),
      est_kcal: rest ? 0 : int(d.est_kcal, 0, 1500),
      intensity: ['낮음', '보통', '높음'].includes(d.intensity) ? d.intensity : '보통',
      exercises: (Array.isArray(d.exercises) ? d.exercises : []).slice(0, 8)
        .map((e: any) => ({ name: clip(e.name, 40), detail: clip(e.detail, 40) })).filter((e: any) => e.name),
      meals,
    }
  })
  if (days.length !== 7) throw new Error('AI가 7일 계획을 만들지 못했습니다. 다시 시도해주세요.')
  return {
    summary: clip(out.summary, 300),
    daily_kcal: int(out.daily_kcal, 800, 5000, 2000),
    macros: { carbs: int(out.macros?.carbs, 0, 800), protein: int(out.macros?.protein, 0, 400), fat: int(out.macros?.fat, 0, 300) },
    days,
    tips: (Array.isArray(out.tips) ? out.tips : []).slice(0, 5).map((t: any) => clip(t, 120)).filter(Boolean),
  }
}


// AI 연결 실패 시 대신 쓰는 기본 계획 (규칙 기반, 화면에 "기본 계획"으로 표시)
function fallbackPlan(input: any, w: number, h: number, female: boolean) {
  const bmr = Math.round(10 * w + 6.25 * h - 5 * 30 + (female ? -161 : 5))
  const tdee = Math.round(bmr * 1.4)
  const kcal = input.goal === 'diet' ? tdee - 400 : input.goal === 'muscle' ? tdee + 300 : tdee
  const sets = input.level === 'advanced' ? '4세트' : input.level === 'intermediate' ? '3세트' : '2세트'
  const home = [
    { focus: '하체 근력', type: '기타', ex: [['맨몸 스쿼트', `15회 × ${sets}`], ['런지', `10회 × ${sets}`], ['브릿지', `15회 × ${sets}`], ['카프 레이즈', `20회 × ${sets}`]] },
    { focus: '상체·코어', type: '기타', ex: [['푸시업', `10회 × ${sets}`], ['플랭크', '40초 × 3'], ['슈퍼맨', `12회 × ${sets}`], ['크런치', `15회 × ${sets}`]] },
    { focus: '유산소', type: 'HIIT', ex: [['제자리 걷기 워밍업', '5분'], ['점핑잭', '30초 × 6'], ['마운틴 클라이머', '30초 × 4'], ['스트레칭', '5분']] },
  ]
  const gym = [
    { focus: '하체', type: '웨이트', ex: [['스쿼트', `10회 × ${sets}`], ['레그프레스', `12회 × ${sets}`], ['레그컬', `12회 × ${sets}`]] },
    { focus: '가슴·등', type: '웨이트', ex: [['벤치프레스', `10회 × ${sets}`], ['랫풀다운', `12회 × ${sets}`], ['시티드 로우', `12회 × ${sets}`]] },
    { focus: '유산소·코어', type: '러닝', ex: [['트레드밀 인터벌', '20분'], ['플랭크', '45초 × 3'], ['행잉 레그레이즈', `10회 × ${sets}`]] },
  ]
  const outdoor = [
    { focus: '걷기·조깅', type: '러닝', ex: [['빠르게 걷기', '10분'], ['가벼운 조깅', '15분'], ['쿨다운 걷기', '5분']] },
    { focus: '자전거', type: '사이클', ex: [['자전거 타기', `${input.minutes}분`], ['스트레칭', '5분']] },
    { focus: '계단·언덕', type: '등산', ex: [['언덕/계단 오르기', '20분'], ['맨몸 스쿼트', `15회 × ${sets}`]] },
  ]
  const pool = input.place === 'gym' ? gym : input.place === 'outdoor' ? outdoor : home
  const menus = [
    ['현미밥, 계란말이, 김치', '닭가슴살 비빔밥', '두부조림, 잡곡밥, 나물', '바나나 1개'],
    ['오트밀, 우유', '김치찌개(밥 2/3), 계란찜', '연어구이, 샐러드, 고구마', '그릭요거트'],
    ['토스트, 삶은 계란', '제육볶음 정식(밥 2/3)', '닭가슴살 샐러드, 현미밥', '사과 1개'],
  ]
  const scale = kcal / 2000
  const kc = [450, 650, 600, 150].map((k) => Math.round(k * scale / 10) * 10)
  const step = 7 / input.days_per_week
  const workDays = new Set(Array.from({ length: input.days_per_week }, (_, i) => Math.floor(i * step)))
  let wi = 0
  const days = Array.from({ length: 7 }, (_, i) => {
    const rest = !workDays.has(i)
    const t = rest ? null : pool[wi++ % pool.length]
    const mn = menus[i % menus.length]
    const meals: Record<string, any> = {}
    MEALS.forEach((m, k) => {
      const avoid = input.avoid && mn[k].includes(input.avoid)
      meals[m] = { menu: avoid ? '현미밥, 닭가슴살, 채소' : mn[k], kcal: kc[k] }
    })
    return {
      date: addDays(input.start_date, i), rest,
      focus: rest ? '휴식 · 가벼운 스트레칭' : t!.focus, type: rest ? '기타' : t!.type, time: input.time,
      duration_min: rest ? 0 : input.minutes, est_kcal: rest ? 0 : Math.round(input.minutes * 6.5),
      intensity: input.level === 'beginner' ? '낮음' : input.level === 'advanced' ? '높음' : '보통',
      exercises: rest ? [] : t!.ex.map(([name, detail]) => ({ name, detail })), meals,
    }
  })
  return {
    summary: 'AI 연결이 안 되어 기본 규칙으로 만든 계획입니다. AI가 연결되면 다시 만들어 보세요.',
    daily_kcal: kcal,
    macros: { carbs: Math.round(kcal * 0.45 / 4), protein: Math.round(w * (input.goal === 'muscle' ? 1.8 : 1.4)), fat: Math.round(kcal * 0.25 / 9) },
    days, tips: ['운동 전후 5분 스트레칭을 해주세요.', '물을 하루 1.5~2L 마셔주세요.'], source: 'rule',
  }
}

app.post('/api/ai-plans/generate', async (c) => {
  const uid = c.get('uid'), DB = c.env.DB
  const used = await DB.prepare("SELECT COUNT(*) n FROM ai_plans WHERE user_id=? AND date(created_at)=date('now')").bind(uid).first<any>()
  if ((used?.n || 0) >= AI_PLAN_DAILY_LIMIT) return c.json({ error: `AI 계획은 하루 ${AI_PLAN_DAILY_LIMIT}번까지 만들 수 있어요.` }, 429)

  const b = await c.req.json().catch(() => ({}))
  const goalMap: Record<string, string> = { diet: '체중 감량', muscle: '근력·근육 증가', health: '건강 유지' }
  const levelMap: Record<string, string> = { beginner: '초급', intermediate: '중급', advanced: '고급' }
  const placeMap: Record<string, string> = { home: '집(맨몸·홈트)', gym: '헬스장', outdoor: '야외' }
  const input = {
    goal: goalMap[b.goal] ? b.goal : 'health',
    level: levelMap[b.level] ? b.level : 'beginner',
    days_per_week: int(b.days_per_week, 1, 7, 3),
    minutes: int(b.minutes, 10, 180, 40),
    place: placeMap[b.place] ? b.place : 'home',
    time: /^\d{2}:\d{2}$/.test(b.time) ? b.time : '19:00',
    diet_pref: clip(b.diet_pref, 100),
    avoid: clip(b.avoid, 100),
    memo: clip(b.memo, 200),
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(b.start_date) ? b.start_date : today(),
  }

  // 사용자 정보 모으기: 신체정보 · 최근 7일 운동/수면/식단 · 진행 중인 목표
  const from = addDays(today(), -7)
  const [u, ib, wk, sl, ml, goals] = await Promise.all([
    DB.prepare('SELECT gender, birth, height FROM users WHERE id=?').bind(uid).first<any>(),
    DB.prepare('SELECT weight, muscle, fat_pct, bmi, bmr FROM inbody WHERE user_id=? ORDER BY date DESC, id DESC LIMIT 1').bind(uid).first<any>(),
    DB.prepare('SELECT COALESCE(SUM(duration_min),0) m, COUNT(DISTINCT date) d FROM workouts WHERE user_id=? AND date>=?').bind(uid, from).first<any>(),
    DB.prepare('SELECT AVG(duration_min) a FROM sleep_logs WHERE user_id=? AND date>=?').bind(uid, from).first<any>(),
    DB.prepare('SELECT AVG(t) a FROM (SELECT SUM(calories) t FROM meals WHERE user_id=? AND date>=? GROUP BY date)').bind(uid, from).first<any>(),
    DB.prepare('SELECT title, target, current, unit FROM goals WHERE user_id=? AND done=0 ORDER BY id DESC LIMIT 5').bind(uid).all<any>(),
  ])
  const age = u?.birth ? Math.max(10, new Date().getFullYear() - Number(String(u.birth).slice(0, 4))) : null
  const profile = [
    `성별: ${u?.gender === 'F' ? '여성' : u?.gender === 'M' ? '남성' : '미입력'}`,
    `나이: ${age ?? '미입력'}`,
    `키: ${u?.height ?? '미입력'}cm`,
    `체중: ${ib?.weight ?? '미입력'}kg, 골격근량: ${ib?.muscle ?? '미입력'}kg, 체지방률: ${ib?.fat_pct ?? '미입력'}%, BMI: ${ib?.bmi ?? '미입력'}, 기초대사량: ${ib?.bmr ?? '미입력'}`,
    `최근 7일 운동: ${wk?.m || 0}분 (${wk?.d || 0}일)`,
    `최근 7일 평균 수면: ${sl?.a ? (sl.a / 60).toFixed(1) + '시간' : '기록 없음'}`,
    `최근 7일 하루 평균 섭취: ${ml?.a ? Math.round(ml.a) + 'kcal' : '기록 없음'}`,
    `진행 중인 목표: ${goals.results.length ? goals.results.map((g: any) => `${g.title}(${g.current ?? 0}/${g.target ?? '-'}${g.unit ?? ''})`).join(', ') : '없음'}`,
  ].join('\n')
  const dayNames = Array.from({ length: 7 }, (_, i) => { const d = addDays(input.start_date, i); return `${i}: ${d} (${'일월화수목금토'[new Date(d + 'T00:00:00Z').getUTCDay()]})` }).join(', ')

  const prompt = `당신은 퍼스널 트레이너이자 영양사입니다. 아래 사용자 정보와 조건으로 7일간의 운동 일정과 식단을 짜주세요.

[사용자 정보]
${profile}

[조건]
- 목표: ${goalMap[input.goal]}
- 운동 수준: ${levelMap[input.level]}
- 주 ${input.days_per_week}일 운동, 1회 ${input.minutes}분 안팎, 장소: ${placeMap[input.place]}, 선호 시간: ${input.time}
- 식단 선호: ${input.diet_pref || '없음'} / 피할 음식(알레르기 등): ${input.avoid || '없음'}
- 추가 요청: ${input.memo || '없음'}
- 날짜(day 순서): ${dayNames}

[규칙]
- days는 정확히 7개, 순서대로. 운동일은 정확히 ${input.days_per_week}일, 나머지는 rest=true(휴식/가벼운 스트레칭).
- 같은 부위를 연속으로 하지 말고, 수면이 부족하거나 운동량이 적으면 강도를 낮추세요. 미입력 정보는 일반 성인 기준으로 추정.
- type은 반드시 다음 중 하나: ${WORKOUT_TYPES.join(', ')}
- exercises는 운동일에 3~6개, detail은 "12회 × 3세트", "20분" 같은 짧은 형식.
- meals는 매일 아침/점심/저녁/간식, 한국인이 쉽게 구할 수 있는 메뉴로 짧게(예: "현미밥, 닭가슴살 샐러드"). 하루 합계가 daily_kcal에 가깝게.
- 피할 음식은 절대 넣지 마세요. 의학적 진단·처방은 하지 마세요.

반드시 아래 JSON 형식으로만 한국어로 답하세요:
{"summary":"이번 주 계획 핵심 한두 문장","daily_kcal":0,"macros":{"carbs":0,"protein":0,"fat":0},
"days":[{"rest":false,"focus":"하체 근력","type":"웨이트","time":"19:00","duration_min":40,"est_kcal":250,"intensity":"보통",
"exercises":[{"name":"스쿼트","detail":"12회 × 3세트"}],
"meals":{"아침":{"menu":"","kcal":0},"점심":{"menu":"","kcal":0},"저녁":{"menu":"","kcal":0},"간식":{"menu":"","kcal":0}}}],
"tips":["실천 팁"]}`

  const base = (c.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  let plan: any, aiError = ''
  try {
    if (!c.env.OPENAI_API_KEY) throw new Error('no key')
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5-mini', reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!r.ok) throw new Error(`AI 응답 오류 (${r.status})`)
    const data: any = await r.json()
    plan = { ...normalizePlan(JSON.parse(data.choices?.[0]?.message?.content || '{}'), input.start_date), source: 'ai' }
  } catch (e: any) {
    aiError = String(e?.message || e)
    if (b.no_fallback) return c.json({ error: 'AI 계획 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 502)
    plan = fallbackPlan(input, ib?.weight || 65, u?.height || 170, u?.gender === 'F')
  }
  const ins = await DB.prepare('INSERT INTO ai_plans (user_id,start_date,goal,level,input,plan) VALUES (?,?,?,?,?,?)')
    .bind(uid, input.start_date, input.goal, input.level, JSON.stringify(input), JSON.stringify(plan)).run()
  return c.json({ id: ins.meta.last_row_id, start_date: input.start_date, input, plan, applied: 0, ai_error: aiError || undefined })
})

const planRow = (r: any) => r && ({ id: r.id, start_date: r.start_date, input: JSON.parse(r.input || '{}'), plan: JSON.parse(r.plan), applied: r.applied, created_at: r.created_at })

app.get('/api/ai-plans/latest', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM ai_plans WHERE user_id=? ORDER BY id DESC LIMIT 1').bind(c.get('uid')).first<any>()
  return c.json(planRow(r) || null)
})

// 캘린더(일정)에 등록 — 다시 누르면 기존 등록분을 지우고 새로 등록
app.post('/api/ai-plans/:id/apply', async (c) => {
  const uid = c.get('uid'), DB = c.env.DB, id = Number(c.req.param('id'))
  const r = planRow(await DB.prepare('SELECT * FROM ai_plans WHERE id=? AND user_id=?').bind(id, uid).first<any>())
  if (!r) return c.json({ error: '계획을 찾을 수 없습니다.' }, 404)
  const end = addDays(r.start_date, 6)
  const stmts = [
    DB.prepare('DELETE FROM schedules WHERE user_id=? AND plan_id=?').bind(uid, id),
    // 같은 기간에 등록돼 있던 다른 AI 계획의 (완료 안 한) 일정은 정리 → 겹침 방지
    DB.prepare('DELETE FROM schedules WHERE user_id=? AND plan_id IS NOT NULL AND plan_id<>? AND done=0 AND date BETWEEN ? AND ?').bind(uid, id, r.start_date, end),
    DB.prepare('UPDATE ai_plans SET applied=0 WHERE user_id=? AND id<>?').bind(uid, id),
  ]
  let n = 0
  for (const d of r.plan.days) {
    if (d.rest) continue
    const memo = `${d.duration_min}분 · 약 ${d.est_kcal}kcal · ${d.intensity} | ` + d.exercises.map((e: any) => `${e.name} ${e.detail}`.trim()).join(', ')
    stmts.push(DB.prepare('INSERT INTO schedules (user_id,date,time,title,memo,done,plan_id) VALUES (?,?,?,?,?,0,?)')
      .bind(uid, d.date, d.time, `AI 운동: ${d.focus}`, memo.slice(0, 500), id))
    n++
  }
  stmts.push(DB.prepare('UPDATE ai_plans SET applied=1 WHERE id=?').bind(id))
  await DB.batch(stmts)
  return c.json({ ok: true, count: n })
})

app.delete('/api/ai-plans/:id/apply', async (c) => {
  const uid = c.get('uid'), id = Number(c.req.param('id'))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM schedules WHERE user_id=? AND plan_id=? AND done=0').bind(uid, id),
    c.env.DB.prepare('UPDATE ai_plans SET applied=0 WHERE id=? AND user_id=?').bind(id, uid),
  ])
  return c.json({ ok: true })
})

// AI 일정 완료 → 운동 기록에 자동 추가
app.post('/api/ai-plans/complete/:scheduleId', async (c) => {
  const uid = c.get('uid'), DB = c.env.DB
  const s = await DB.prepare('SELECT * FROM schedules WHERE id=? AND user_id=?').bind(c.req.param('scheduleId'), uid).first<any>()
  if (!s?.plan_id) return c.json({ error: 'AI 일정이 아닙니다.' }, 400)
  if (s.done) return c.json({ ok: true, already: true }) // 이미 완료 → 운동 기록 중복 추가 방지
  const r = planRow(await DB.prepare('SELECT * FROM ai_plans WHERE id=? AND user_id=?').bind(s.plan_id, uid).first<any>())
  const d = r?.plan.days.find((x: any) => x.date === s.date && !x.rest)
  if (!d) return c.json({ error: '계획에서 해당 날짜를 찾을 수 없습니다.' }, 404)
  await DB.batch([
    DB.prepare('UPDATE schedules SET done=1 WHERE id=?').bind(s.id),
    DB.prepare('INSERT INTO workouts (user_id,date,type,duration_min,calories,intensity,memo) VALUES (?,?,?,?,?,?,?)')
      .bind(uid, s.date, d.type, d.duration_min, d.est_kcal, d.intensity, `AI 계획: ${d.focus}`),
  ])
  return c.json({ ok: true })
})

// ---------- generic CRUD ----------
const tables: Record<string, string[]> = {
  schedules: ['date', 'time', 'title', 'memo', 'done', 'plan_id'],
  sleep: ['date', 'bed_time', 'wake_time', 'duration_min', 'quality', 'states', 'memo'],
  workouts: ['date', 'type', 'duration_min', 'calories', 'intensity', 'memo'],
  meals: ['date', 'meal_type', 'food', 'calories', 'protein', 'carbs', 'fat', 'photo', 'ai'],
  inbody: ['date', 'weight', 'muscle', 'fat_mass', 'fat_pct', 'bmi', 'bmr'],
  goals: ['kind', 'month', 'deadline', 'title', 'target', 'current', 'unit', 'done'],
}
const tname = (k: string) => (k === 'sleep' ? 'sleep_logs' : k)

for (const [key, cols] of Object.entries(tables)) {
  const T = tname(key)
  app.get(`/api/${key}`, async (c) => {
    const { from, to, kind, month } = c.req.query()
    let sql = `SELECT * FROM ${T} WHERE user_id=?`
    const args: any[] = [c.get('uid')]
    if (from) { sql += ' AND date>=?'; args.push(from) }
    if (to) { sql += ' AND date<=?'; args.push(to) }
    if (kind) { sql += ' AND kind=?'; args.push(kind) }
    if (month) { sql += ' AND month=?'; args.push(month) }
    sql += key === 'goals' ? ' ORDER BY id DESC' : ' ORDER BY date DESC, id DESC'
    const r = await c.env.DB.prepare(sql).bind(...args).all()
    return c.json(r.results)
  })
  app.post(`/api/${key}`, async (c) => {
    const b = await c.req.json()
    const ks = cols.filter((k) => b[k] !== undefined && b[k] !== '' && b[k] !== null)
    const r = await c.env.DB.prepare(
      `INSERT INTO ${T} (user_id${ks.map((k) => ',' + k).join('')}) VALUES (?${ks.map(() => ',?').join('')})`
    ).bind(c.get('uid'), ...ks.map((k) => b[k])).run()
    return c.json({ id: r.meta.last_row_id })
  })
  app.put(`/api/${key}/:id`, async (c) => {
    const b = await c.req.json()
    const ks = cols.filter((k) => k in b)
    if (!ks.length) return c.json({ ok: true })
    await c.env.DB.prepare(`UPDATE ${T} SET ${ks.map((k) => k + '=?').join(',')} WHERE id=? AND user_id=?`)
      .bind(...ks.map((k) => (b[k] === '' ? null : b[k])), c.req.param('id'), c.get('uid')).run()
    return c.json({ ok: true })
  })
  app.delete(`/api/${key}/:id`, async (c) => {
    await c.env.DB.prepare(`DELETE FROM ${T} WHERE id=? AND user_id=?`).bind(c.req.param('id'), c.get('uid')).run()
    return c.json({ ok: true })
  })
}

// ---------- home summary (per day) ----------
app.get('/api/summary', async (c) => {
  const uid = c.get('uid')
  const date = c.req.query('date') || today()
  const month = date.slice(0, 7)
  const DB = c.env.DB
  const [sched, sleep, work, meal, marks] = await Promise.all([
    DB.prepare('SELECT * FROM schedules WHERE user_id=? AND date=? ORDER BY time').bind(uid, date).all(),
    DB.prepare('SELECT * FROM sleep_logs WHERE user_id=? AND date=? ORDER BY id DESC LIMIT 1').bind(uid, date).first(),
    DB.prepare('SELECT * FROM workouts WHERE user_id=? AND date=?').bind(uid, date).all(),
    DB.prepare('SELECT * FROM meals WHERE user_id=? AND date=?').bind(uid, date).all(),
    DB.prepare(`SELECT date, 's' t FROM schedules WHERE user_id=?1 AND substr(date,1,7)=?2
      UNION SELECT date,'w' FROM workouts WHERE user_id=?1 AND substr(date,1,7)=?2
      UNION SELECT date,'z' FROM sleep_logs WHERE user_id=?1 AND substr(date,1,7)=?2
      UNION SELECT date,'m' FROM meals WHERE user_id=?1 AND substr(date,1,7)=?2`).bind(uid, month).all(),
  ])
  return c.json({ date, schedules: sched.results, sleep, workouts: work.results, meals: meal.results, marks: marks.results })
})

// ---------- stats ----------
app.get('/api/stats', async (c) => {
  const uid = c.get('uid')
  const days = Math.min(365, parseInt(c.req.query('days') || '7'))
  const end = today()
  const start = new Date(new Date(end).getTime() - (days - 1) * 86400e3).toISOString().slice(0, 10)
  const DB = c.env.DB
  const [w, m, s, ib] = await Promise.all([
    DB.prepare('SELECT date, SUM(duration_min) mins, SUM(calories) kcal, COUNT(*) cnt FROM workouts WHERE user_id=? AND date BETWEEN ? AND ? GROUP BY date').bind(uid, start, end).all<any>(),
    DB.prepare('SELECT date, SUM(calories) kcal FROM meals WHERE user_id=? AND date BETWEEN ? AND ? GROUP BY date').bind(uid, start, end).all<any>(),
    DB.prepare('SELECT date, MAX(duration_min) mins FROM sleep_logs WHERE user_id=? AND date BETWEEN ? AND ? GROUP BY date').bind(uid, start, end).all<any>(),
    DB.prepare('SELECT date, weight, muscle, fat_pct, bmi FROM inbody WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date').bind(uid, start, end).all<any>(),
  ])
  return c.json({ start, end, workouts: w.results, meals: m.results, sleep: s.results, inbody: ib.results })
})

// ---------- AI exercise guide (rule-based personalization) ----------
app.get('/api/ai-guide', async (c) => {
  const uid = c.get('uid')
  const goal = c.req.query('goal') || 'health' // diet | muscle | health
  const level = c.req.query('level') || 'beginner'
  const DB = c.env.DB
  const u = await DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first<any>()
  const ib = await DB.prepare('SELECT * FROM inbody WHERE user_id=? ORDER BY date DESC, id DESC LIMIT 1').bind(uid).first<any>()
  const from = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10)
  const wk = await DB.prepare('SELECT COALESCE(SUM(duration_min),0) m, COUNT(DISTINCT date) d FROM workouts WHERE user_id=? AND date>=?').bind(uid, from).first<any>()
  const sl = await DB.prepare('SELECT AVG(duration_min) a, AVG(quality) q FROM sleep_logs WHERE user_id=? AND date>=?').bind(uid, from).first<any>()

  const insights: string[] = []
  const bmi = ib?.bmi || (ib?.weight && u?.height ? ib.weight / (u.height / 100) ** 2 : null)
  if (bmi) {
    if (bmi >= 25) insights.push(`BMI ${bmi.toFixed(1)}로 비만 범위입니다. 관절 부담이 적은 유산소(사이클·수영·빠르게 걷기) 비중을 높이세요.`)
    else if (bmi < 18.5) insights.push(`BMI ${bmi.toFixed(1)}로 저체중입니다. 근력운동 위주로 하고 단백질·총 칼로리 섭취를 늘리세요.`)
    else insights.push(`BMI ${bmi.toFixed(1)}로 정상 범위입니다. 현재 체형을 유지하며 목표에 집중하세요.`)
  } else insights.push('인바디 정보를 등록하면 더 정확한 맞춤 가이드를 받을 수 있어요. (내 정보 > 인바디)')
  if (ib?.fat_pct) {
    const high = u?.gender === 'F' ? 32 : 25
    if (ib.fat_pct > high) insights.push(`체지방률 ${ib.fat_pct}%로 다소 높습니다. 주 4회 이상 30분+ 유산소를 권장합니다.`)
  }
  if (wk.m < 150) insights.push(`최근 7일 운동 ${wk.m}분 (WHO 권장 150분 미만). 이번 주는 ${150 - wk.m}분을 더 채워보세요.`)
  else insights.push(`최근 7일 운동 ${wk.m}분으로 권장량을 충족했어요! 강도를 조금씩 높여보세요.`)
  if (sl?.a && sl.a < 420) insights.push(`평균 수면 ${(sl.a / 60).toFixed(1)}시간으로 부족합니다. 고강도 운동보다 회복 위주(스트레칭·요가)를 섞어주세요.`)

  const sets = level === 'advanced' ? '4~5세트' : level === 'intermediate' ? '3~4세트' : '2~3세트'
  const plans: Record<string, any[]> = {
    diet: [
      { day: '월', focus: '유산소 + 하체', items: ['빠르게 걷기/러닝 30분', `스쿼트 15회 × ${sets}`, `런지 12회 × ${sets}`] },
      { day: '화', focus: 'HIIT', items: ['버피 30초/휴식 30초 × 8', '마운틴 클라이머 30초 × 4', '쿨다운 스트레칭 10분'] },
      { day: '수', focus: '상체 + 코어', items: [`푸시업 10~15회 × ${sets}`, `덤벨 로우 12회 × ${sets}`, '플랭크 45초 × 3'] },
      { day: '목', focus: '회복', items: ['가벼운 걷기 40분', '폼롤러 & 스트레칭 15분'] },
      { day: '금', focus: '전신 서킷', items: ['케틀벨 스윙 15회', '점프 스쿼트 12회', '버피 10회', `→ 서킷 ${sets}`] },
      { day: '토', focus: '장시간 유산소', items: ['사이클/등산/수영 50~60분'] },
      { day: '일', focus: '휴식', items: ['완전 휴식 또는 요가 20분'] },
    ],
    muscle: [
      { day: '월', focus: '가슴 · 삼두', items: [`벤치프레스 8~10회 × ${sets}`, `인클라인 덤벨프레스 10회 × ${sets}`, `딥스 10회 × ${sets}`] },
      { day: '화', focus: '등 · 이두', items: [`데드리프트 6~8회 × ${sets}`, `풀업/랫풀다운 10회 × ${sets}`, `바벨컬 12회 × ${sets}`] },
      { day: '수', focus: '휴식/유산소', items: ['가벼운 유산소 20분', '스트레칭'] },
      { day: '목', focus: '하체', items: [`스쿼트 8~10회 × ${sets}`, `레그프레스 12회 × ${sets}`, `루마니안 데드리프트 10회 × ${sets}`] },
      { day: '금', focus: '어깨 · 코어', items: [`밀리터리프레스 8~10회 × ${sets}`, `사이드 레터럴 레이즈 15회 × ${sets}`, '행잉 레그레이즈 12회 × 3'] },
      { day: '토', focus: '약점 보완', items: ['부족한 부위 집중 40분'] },
      { day: '일', focus: '휴식', items: ['완전 휴식 – 근성장은 휴식 중에!'] },
    ],
    health: [
      { day: '월', focus: '전신 근력', items: [`맨몸 스쿼트 15회 × ${sets}`, `푸시업 10회 × ${sets}`, '플랭크 30초 × 3'] },
      { day: '화', focus: '유산소', items: ['빠르게 걷기 30~40분'] },
      { day: '수', focus: '유연성', items: ['요가/필라테스 30분'] },
      { day: '목', focus: '전신 근력', items: [`런지 10회 × ${sets}`, `밴드 로우 15회 × ${sets}`, '브릿지 15회 × 3'] },
      { day: '금', focus: '유산소', items: ['자전거/수영 30분'] },
      { day: '토', focus: '야외 활동', items: ['등산·산책 등 즐거운 활동 60분'] },
      { day: '일', focus: '휴식', items: ['휴식 및 가벼운 스트레칭'] },
    ],
  }
  const w = ib?.weight || 65
  const bmr = ib?.bmr || Math.round(10 * w + 6.25 * (u?.height || 170) - 5 * 30 + (u?.gender === 'F' ? -161 : 5))
  const tdee = Math.round(bmr * 1.45)
  const kcal = goal === 'diet' ? tdee - 450 : goal === 'muscle' ? tdee + 300 : tdee
  const protein = Math.round(w * (goal === 'muscle' ? 2 : goal === 'diet' ? 1.6 : 1.2))
  return c.json({ goal, level, insights, plan: plans[goal] || plans.health,
    nutrition: { bmr, tdee, kcal, protein, carbs: Math.round((kcal * 0.45) / 4), fat: Math.round((kcal * 0.25) / 9) } })
})

// ---------- PWA (앱 설치) ----------
app.get('/manifest.webmanifest', (c) =>
  c.body(JSON.stringify({
    name: 'GoldenCare - 골든 케어',
    short_name: '골든케어',
    description: 'AI 기반 맞춤형 건강관리 앱 (일정·운동·식단·수면·인바디)',
    id: '/',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: '#6366f1',
    lang: 'ko',
    icons: [
      { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }), 200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' })
)

const SW_VERSION = 'gc-v1'
app.get('/sw.js', (c) =>
  c.body(`const CACHE='${SW_VERSION}';
const SHELL=['/','/static/app.js','/static/style.css','/static/icons/icon-192.png','/static/icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  const u=new URL(r.url);
  if(u.origin===location.origin && u.pathname.startsWith('/api/')) return; // API는 항상 네트워크
  if(r.mode==='navigate'){ // 화면: 네트워크 우선, 오프라인이면 캐시
    e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put('/',cp));return res}).catch(()=>caches.match('/')));
    return;
  }
  if(u.origin===location.origin){ // 내 정적 파일: 네트워크 우선
    e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r)));
    return;
  }
  // CDN(Tailwind, 아이콘, Chart.js): 캐시 우선
  e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));return res})));
});`, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' })
)

// ---------- SPA shell ----------
app.get('*', (c) =>
  c.html(`<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, viewport-fit=cover">
<title>GoldenCare - 골든 케어</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#6366f1">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="골든케어">
<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon-180.png">
<link rel="icon" type="image/png" href="/static/icons/favicon.png">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
</head><body class="bg-slate-100">
<div id="app" class="app-shell"></div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="/static/app.js"></script>
</body></html>`)
)

export default app
