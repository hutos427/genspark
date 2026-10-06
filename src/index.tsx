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
  const { username, password, name, email } = b
  if (!username || !password || !name || !email) return c.json({ error: '필수 항목을 입력해주세요.' }, 400)
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) return c.json({ error: '아이디는 영문/숫자 4~20자입니다.' }, 400)
  if (password.length < 6) return c.json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400)
  const ex = await c.env.DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()
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
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username || '').first<any>()
  if (!u || (await hashPw(password || '', u.salt)) !== u.password_hash)
    return c.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401)
  const token = randHex(32)
  await c.env.DB.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)')
    .bind(token, u.id, Date.now() + 30 * 86400e3).run()
  setCookie(c, 'sid', token, { httpOnly: true, path: '/', sameSite: 'Lax', maxAge: 30 * 86400, secure: true })
  return c.json({ ok: true })
})

app.post('/api/auth/logout', async (c) => {
  const t = getCookie(c, 'sid')
  if (t) await c.env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(t).run()
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

app.post('/api/auth/find-id', async (c) => {
  const { name, email } = await c.req.json()
  const r = await c.env.DB.prepare('SELECT username FROM users WHERE name=? AND email=?').bind(name || '', email || '').all<any>()
  if (!r.results.length) return c.json({ error: '일치하는 회원 정보가 없습니다.' }, 404)
  const mask = (s: string) => s.slice(0, Math.max(2, s.length - 3)) + '*'.repeat(Math.min(3, s.length - 2))
  return c.json({ usernames: r.results.map((x) => mask(x.username)) })
})

app.post('/api/auth/reset-password', async (c) => {
  const { username, email } = await c.req.json()
  const u = await c.env.DB.prepare('SELECT id FROM users WHERE username=? AND email=?').bind(username || '', email || '').first<any>()
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
  const t = getCookie(c, 'sid')
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

// ---------- generic CRUD ----------
const tables: Record<string, string[]> = {
  schedules: ['date', 'time', 'title', 'memo', 'done'],
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

// ---------- SPA shell ----------
app.get('*', (c) =>
  c.html(`<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1">
<title>FitLife - 건강 관리</title>
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
