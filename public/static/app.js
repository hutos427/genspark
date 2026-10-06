// ================= FitLife SPA =================
const $app = document.getElementById('app')
const S = {
  user: null, tab: 'home', authView: 'login', findTab: 'id',
  date: kstToday(), calMonth: kstToday().slice(0, 7),
  statDays: 7, statMetric: 'kcal', healthTab: 'ai', aiGoal: 'health', aiLevel: 'beginner',
  goalMonth: kstToday().slice(0, 7), myTab: 'profile',
}
let charts = []

function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmtMin = (m) => { m = Math.round(m || 0); return `${Math.floor(m / 60)}시간 ${m % 60}분` }
const KDAY = ['일', '월', '화', '수', '목', '금', '토']
const fmtDate = (d) => { const x = new Date(d + 'T00:00:00'); return `${x.getMonth() + 1}월 ${x.getDate()}일 (${KDAY[x.getDay()]})` }

async function api(path, opt = {}) {
  const res = await fetch('/api' + path, {
    method: opt.method || 'GET', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && !path.startsWith('/auth/')) { S.user = null; render(); throw new Error('로그인이 필요합니다') }
  if (!res.ok) throw new Error(data.error || '요청 실패')
  return data
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200)
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()) }
function closeModal() { document.querySelector('.modal-bg')?.remove() }
function modal(title, inner, onSubmit) {
  closeModal()
  const bg = document.createElement('div'); bg.className = 'modal-bg'
  bg.innerHTML = `<form class="modal"><div class="flex justify-between items-center mb-2">
    <h3 class="text-lg font-bold">${title}</h3><button type="button" class="text-slate-400 text-xl" data-close><i class="fas fa-xmark"></i></button></div>
    ${inner}<button class="btn btn-primary mt-5">저장</button></form>`
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) closeModal() })
  bg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try { await onSubmit(formData(e.target), e.target); closeModal(); toast('저장되었습니다'); render() } catch (err) { toast(err.message) }
  })
  document.body.appendChild(bg)
}
const field = (label, name, type = 'text', val = '', extra = '') =>
  `<label class="label">${label}</label><input class="input" name="${name}" type="${type}" value="${esc(val)}" ${extra}>`

// ================= AUTH =================
function renderAuth() {
  const v = S.authView
  const header = `<div class="text-center pt-14 pb-8">
    <div class="w-20 h-20 mx-auto rounded-3xl header-grad flex items-center justify-center text-4xl shadow-lg"><i class="fas fa-heart-pulse"></i></div>
    <h1 class="text-3xl font-extrabold mt-4 text-slate-800">FitLife</h1>
    <p class="text-slate-500 mt-1 text-sm">운동 · 식단 · 수면을 한 곳에서</p></div>`
  let body = ''
  if (v === 'login') {
    body = `<form id="login-form" class="card">
      ${field('아이디', 'username', 'text', '', 'required autocomplete="username"')}
      ${field('비밀번호', 'password', 'password', '', 'required autocomplete="current-password"')}
      <button class="btn btn-primary mt-5">로그인</button>
      <div class="flex justify-center gap-4 mt-4 text-sm text-slate-500">
        <button type="button" data-go="signup">회원가입</button><span>|</span>
        <button type="button" data-go="find">아이디/비밀번호 찾기</button></div></form>`
  } else if (v === 'signup') {
    body = `<form id="signup-form" class="card">
      <h2 class="font-bold text-lg mb-1">회원가입</h2>
      ${field('아이디 (영문/숫자 4~20자) *', 'username', 'text', '', 'required')}
      ${field('비밀번호 (6자 이상) *', 'password', 'password', '', 'required minlength="6"')}
      ${field('비밀번호 확인 *', 'password2', 'password', '', 'required')}
      ${field('이름 *', 'name', 'text', '', 'required')}
      ${field('이메일 *', 'email', 'email', '', 'required')}
      ${field('휴대폰', 'phone', 'tel')}
      <div class="grid grid-cols-2 gap-2"><div>${field('생년월일', 'birth', 'date')}</div>
      <div><label class="label">성별</label><select class="input" name="gender"><option value="">선택</option><option value="M">남성</option><option value="F">여성</option></select></div></div>
      ${field('키 (cm)', 'height', 'number', '', 'step="0.1"')}
      <button class="btn btn-primary mt-5">가입하기</button>
      <button type="button" class="w-full text-sm text-slate-500 mt-3" data-go="login">← 로그인으로</button></form>`
  } else {
    const t = S.findTab
    body = `<div class="card"><div class="seg mb-3">
      <button class="${t === 'id' ? 'active' : ''}" data-find="id">아이디 찾기</button>
      <button class="${t === 'pw' ? 'active' : ''}" data-find="pw">비밀번호 찾기</button></div>
      ${t === 'id'
        ? `<form id="findid-form">${field('이름', 'name', 'text', '', 'required')}${field('가입 이메일', 'email', 'email', '', 'required')}<button class="btn btn-primary mt-5">아이디 찾기</button></form>`
        : `<form id="findpw-form">${field('아이디', 'username', 'text', '', 'required')}${field('가입 이메일', 'email', 'email', '', 'required')}<button class="btn btn-primary mt-5">임시 비밀번호 발급</button></form>`}
      <div id="find-result" class="mt-4"></div>
      <button type="button" class="w-full text-sm text-slate-500 mt-3" data-go="login">← 로그인으로</button></div>`
  }
  $app.innerHTML = `<div class="page">${header}${body}</div>`
  $app.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { S.authView = b.dataset.go; render() }))
  $app.querySelectorAll('[data-find]').forEach((b) => (b.onclick = () => { S.findTab = b.dataset.find; render() }))
  const on = (id, fn) => { const f = document.getElementById(id); if (f) f.onsubmit = async (e) => { e.preventDefault(); try { await fn(formData(f)) } catch (err) { toast(err.message) } } }
  on('login-form', async (d) => { await api('/auth/login', { method: 'POST', body: d }); await boot() })
  on('signup-form', async (d) => {
    if (d.password !== d.password2) throw new Error('비밀번호가 일치하지 않습니다')
    await api('/auth/signup', { method: 'POST', body: d }); toast('가입 완료! 로그인해주세요'); S.authView = 'login'; render()
  })
  on('findid-form', async (d) => {
    const r = await api('/auth/find-id', { method: 'POST', body: d })
    document.getElementById('find-result').innerHTML = `<div class="stat-box text-center">회원님의 아이디<br><b class="text-indigo-600 text-lg">${r.usernames.map(esc).join(', ')}</b></div>`
  })
  on('findpw-form', async (d) => {
    const r = await api('/auth/reset-password', { method: 'POST', body: d })
    document.getElementById('find-result').innerHTML = `<div class="stat-box text-center">임시 비밀번호<br><b class="text-indigo-600 text-xl tracking-widest">${esc(r.tempPassword)}</b><p class="text-xs text-slate-500 mt-1">로그인 후 내 정보에서 비밀번호를 꼭 변경해주세요.</p></div>`
  })
}

// ================= SHELL =================
const TABS = [['home', 'fa-house', '홈'], ['health', 'fa-dumbbell', '헬스'], ['sleep', 'fa-moon', '수면'], ['my', 'fa-user', '내정보']]
async function render() {
  charts.forEach((c) => c.destroy()); charts = []
  if (!S.user) return renderAuth()
  $app.innerHTML = `<main id="tab-content"><div class="p-10 text-center text-slate-400"><i class="fas fa-spinner fa-spin"></i></div></main>
    <nav class="tabbar">${TABS.map(([k, i, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'active' : ''}"><i class="fas ${i}"></i>${l}</button>`).join('')}</nav>`
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; window.scrollTo(0, 0); render() }))
  const el = document.getElementById('tab-content')
  try { await ({ home: renderHome, health: renderHealth, sleep: renderSleep, my: renderMy })[S.tab](el) }
  catch (e) { el.innerHTML = `<div class="p-10 text-center text-red-500">${esc(e.message)}</div>` }
}
const pageHeader = (title, sub = '') => `<header class="header-grad px-5 pt-8 pb-6 rounded-b-3xl mb-[-12px]">
  <p class="text-indigo-100 text-sm">${sub}</p><h1 class="text-2xl font-extrabold">${title}</h1></header>`
function bind(root, sel, ev, fn) { root.querySelectorAll(sel).forEach((n) => n.addEventListener(ev, (e) => fn(n, e))) }

// ================= HOME =================
function calendarHTML(marks) {
  const [y, m] = S.calMonth.split('-').map(Number)
  const first = new Date(y, m - 1, 1), start = new Date(y, m - 1, 1 - first.getDay())
  const map = {}; marks.forEach((x) => { (map[x.date] ||= new Set()).add(x.t) })
  let cells = ''
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const cls = ['cal-day', d.getMonth() !== m - 1 && 'other', ds === kstToday() && 'today', ds === S.date && 'selected'].filter(Boolean).join(' ')
    const dots = [...(map[ds] || [])].sort().map((t) => `<span class="dot-${t}"></span>`).join('')
    const color = d.getDay() === 0 ? 'text-red-400' : d.getDay() === 6 ? 'text-blue-400' : ''
    cells += `<div class="${cls}" data-date="${ds}"><span class="${ds === S.date ? '' : color}">${d.getDate()}</span><div class="cal-dots">${dots}</div></div>`
    if (i >= 34 && d.getMonth() !== m - 1 && d.getDay() === 6) break
  }
  return `<section class="card" id="calendar">
    <div class="card-title"><button data-cal="-1" class="px-2 text-slate-400"><i class="fas fa-chevron-left"></i></button>
    <span>${y}년 ${m}월</span><button data-cal="1" class="px-2 text-slate-400"><i class="fas fa-chevron-right"></i></button></div>
    <div class="cal-grid text-xs text-slate-400 mb-1">${KDAY.map((k) => `<div>${k}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="flex justify-center gap-3 mt-2 text-[11px] text-slate-500">
      <span><i class="fas fa-circle text-amber-500 text-[7px]"></i> 일정</span><span><i class="fas fa-circle text-emerald-500 text-[7px]"></i> 운동</span>
      <span><i class="fas fa-circle text-indigo-500 text-[7px]"></i> 수면</span><span><i class="fas fa-circle text-red-500 text-[7px]"></i> 식단</span></div></section>`
}

async function renderHome(el) {
  const [sum, st] = await Promise.all([api(`/summary?date=${S.date}`), api(`/stats?days=${S.statDays}`)])
  const monthMarks = S.calMonth === S.date.slice(0, 7) ? sum.marks : (await api(`/summary?date=${S.calMonth}-01`)).marks
  const wMin = sum.workouts.reduce((a, b) => a + b.duration_min, 0), wKcal = sum.workouts.reduce((a, b) => a + (b.calories || 0), 0)
  const mKcal = sum.meals.reduce((a, b) => a + (b.calories || 0), 0)
  el.innerHTML = `${pageHeader(`${esc(S.user.name)}님, 안녕하세요 👋`, fmtDate(kstToday()))}<div class="page">
    ${calendarHTML(monthMarks)}
    <h2 class="font-bold text-slate-700 mb-2 px-1">${fmtDate(S.date)}</h2>
    <div class="grid grid-cols-3 gap-2 mb-3">
      <div class="card !mb-0 text-center"><i class="fas fa-moon text-indigo-500"></i><p class="text-xs text-slate-500 mt-1">수면</p><b class="text-sm">${sum.sleep ? fmtMin(sum.sleep.duration_min) : '-'}</b></div>
      <div class="card !mb-0 text-center"><i class="fas fa-fire text-emerald-500"></i><p class="text-xs text-slate-500 mt-1">운동</p><b class="text-sm">${wMin}분 · ${wKcal}kcal</b></div>
      <div class="card !mb-0 text-center"><i class="fas fa-utensils text-red-500"></i><p class="text-xs text-slate-500 mt-1">섭취</p><b class="text-sm">${mKcal.toLocaleString()}kcal</b></div></div>

    <section class="card" id="schedule-card"><div class="card-title"><span><i class="fas fa-calendar-check text-amber-500 mr-1"></i> 일정</span>
      <button class="btn btn-ghost btn-sm" id="add-schedule"><i class="fas fa-plus"></i> 추가</button></div>
      ${sum.schedules.length ? sum.schedules.map((s) => `<div class="list-item">
        <input type="checkbox" class="w-5 h-5 accent-indigo-500" data-sdone="${s.id}" ${s.done ? 'checked' : ''}>
        <div class="flex-1 ${s.done ? 'line-through text-slate-400' : ''}"><b class="text-sm">${esc(s.title)}</b>
        <p class="text-xs text-slate-400">${esc(s.time || '종일')} ${s.memo ? '· ' + esc(s.memo) : ''}</p></div>
        <button class="text-slate-300" data-del="schedules/${s.id}"><i class="fas fa-trash"></i></button></div>`).join('') : '<p class="empty">등록된 일정이 없습니다</p>'}</section>

    <section class="card" id="sleep-card"><div class="card-title"><span><i class="fas fa-bed text-indigo-500 mr-1"></i> 수면 시간</span>
      <button class="btn btn-ghost btn-sm" data-goto="sleep">기록하기</button></div>
      ${sum.sleep ? `<div class="flex items-center justify-between"><div><b class="text-2xl text-indigo-600">${fmtMin(sum.sleep.duration_min)}</b>
        <p class="text-xs text-slate-500">${esc(sum.sleep.bed_time)} → ${esc(sum.sleep.wake_time)}</p></div>
        <div class="text-amber-400">${'★'.repeat(sum.sleep.quality || 0)}<span class="text-slate-200">${'★'.repeat(5 - (sum.sleep.quality || 0))}</span></div></div>` : '<p class="empty">수면 기록이 없습니다</p>'}</section>

    <section class="card" id="workout-card"><div class="card-title"><span><i class="fas fa-person-running text-emerald-500 mr-1"></i> 운동 기록</span>
      <button class="btn btn-ghost btn-sm" id="add-workout"><i class="fas fa-plus"></i> 추가</button></div>
      ${sum.workouts.length ? sum.workouts.map((w) => `<div class="list-item"><div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center"><i class="fas fa-dumbbell"></i></div>
        <div class="flex-1"><b class="text-sm">${esc(w.type)}</b><p class="text-xs text-slate-400">${w.duration_min}분 · ${w.calories || 0}kcal ${w.intensity ? '· ' + esc(w.intensity) : ''}</p></div>
        <button class="text-slate-300" data-del="workouts/${w.id}"><i class="fas fa-trash"></i></button></div>`).join('') : '<p class="empty">운동 기록이 없습니다</p>'}</section>

    <section class="card" id="meal-card"><div class="card-title"><span><i class="fas fa-bowl-food text-red-500 mr-1"></i> 식단 칼로리</span>
      <div class="flex gap-1"><label class="btn btn-ghost btn-sm cursor-pointer"><i class="fas fa-camera"></i> AI<input type="file" accept="image/*" class="hidden" data-photo></label>
      <button class="btn btn-ghost btn-sm" data-goto="health" data-htab="diet">식단 관리</button></div></div>
      ${['아침', '점심', '저녁', '간식'].map((t) => { const k = sum.meals.filter((m) => m.meal_type === t).reduce((a, b) => a + (b.calories || 0), 0)
        return `<div class="flex justify-between text-sm py-1"><span class="text-slate-500">${t}</span><b>${k} kcal</b></div>` }).join('')}
      <div class="flex justify-between border-t mt-2 pt-2"><b>합계</b><b class="text-red-500">${mKcal.toLocaleString()} kcal</b></div></section>

    <section class="card" id="stats-card"><div class="card-title"><span><i class="fas fa-chart-line text-violet-500 mr-1"></i> 구간별 통계</span></div>
      <div class="seg mb-2">${[[7, '1주'], [30, '1개월'], [90, '3개월'], [365, '1년']].map(([d, l]) => `<button data-days="${d}" class="${S.statDays == d ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="seg mb-3">${[['kcal', '운동량'], ['mins', '운동시간'], ['body', '신체정보']].map(([k, l]) => `<button data-metric="${k}" class="${S.statMetric === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="h-56"><canvas id="stat-chart"></canvas></div><div id="stat-sum" class="grid grid-cols-3 gap-2 mt-3 text-center"></div></section>
  </div>`

  bind(el, '[data-date]', 'click', (n) => { S.date = n.dataset.date; S.calMonth = S.date.slice(0, 7); render() })
  bind(el, '[data-cal]', 'click', (n) => { const [y, m] = S.calMonth.split('-').map(Number); const d = new Date(y, m - 1 + Number(n.dataset.cal), 1)
    S.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; render() })
  bind(el, '[data-days]', 'click', (n) => { S.statDays = Number(n.dataset.days); render() })
  bind(el, '[data-metric]', 'click', (n) => { S.statMetric = n.dataset.metric; render() })
  bind(el, '[data-goto]', 'click', (n) => { S.tab = n.dataset.goto; if (n.dataset.htab) S.healthTab = n.dataset.htab; render() })
  bind(el, '[data-photo]', 'change', (n) => { const f = n.files[0]; n.value = ''; if (f) aiPhotoFlow(f) })
  bind(el, '[data-del]', 'click', async (n) => { if (!confirm('삭제할까요?')) return; await api('/' + n.dataset.del, { method: 'DELETE' }); render() })
  bind(el, '[data-sdone]', 'change', async (n) => { await api(`/schedules/${n.dataset.sdone}`, { method: 'PUT', body: { done: n.checked ? 1 : 0 } }); render() })
  el.querySelector('#add-schedule').onclick = () => modal('일정 추가', field('날짜', 'date', 'date', S.date, 'required') + field('제목', 'title', 'text', '', 'required') +
    field('시간', 'time', 'time') + field('메모', 'memo'), (d) => api('/schedules', { method: 'POST', body: d }))
  el.querySelector('#add-workout').onclick = () => workoutModal()
  drawStats(st)
}

function workoutModal() {
  const types = ['걷기', '러닝', '사이클', '수영', '웨이트', '요가', '필라테스', '등산', 'HIIT', '기타']
  modal('운동 기록 추가', field('날짜', 'date', 'date', S.date, 'required') +
    `<label class="label">운동 종류</label><select class="input" name="type">${types.map((t) => `<option>${t}</option>`).join('')}</select>` +
    `<div class="grid grid-cols-2 gap-2"><div>${field('운동 시간(분)', 'duration_min', 'number', '30', 'required min="1"')}</div><div>${field('소모 칼로리', 'calories', 'number', '', 'placeholder="자동 계산"')}</div></div>` +
    `<label class="label">강도</label><select class="input" name="intensity"><option>낮음</option><option selected>보통</option><option>높음</option></select>` + field('메모', 'memo'),
    (d) => {
      if (!d.calories) { const met = { 걷기: 3.5, 러닝: 9, 사이클: 7, 수영: 8, 웨이트: 5, 요가: 3, 필라테스: 3.5, 등산: 6.5, HIIT: 10, 기타: 4 }[d.type] * ({ 낮음: .8, 보통: 1, 높음: 1.25 }[d.intensity])
        d.calories = Math.round(met * (S.weight || 65) * d.duration_min / 60) }
      return api('/workouts', { method: 'POST', body: { ...d, duration_min: Number(d.duration_min), calories: Number(d.calories) } })
    })
}

function dateRange(start, end) { const out = []; let d = new Date(start + 'T00:00:00Z'); const e = new Date(end + 'T00:00:00Z')
  while (d <= e) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400e3) } return out }
function bucketize(dates, days) { // group by week when >30d, by month when >90d
  const key = (d) => days > 90 ? d.slice(0, 7) : days > 30 ? (() => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); return x.toISOString().slice(0, 10) })() : d
  const keys = []; dates.forEach((d) => { const k = key(d); if (!keys.includes(k)) keys.push(k) }); return { key, keys }
}
function drawStats(st) {
  const ctx = document.getElementById('stat-chart'); if (!ctx || !window.Chart) return
  const dates = dateRange(st.start, st.end), { key, keys } = bucketize(dates, S.statDays)
  const label = (k) => k.length === 7 ? `${Number(k.slice(5))}월` : `${Number(k.slice(5, 7))}/${Number(k.slice(8))}`
  const agg = (rows, f) => { const m = {}; rows.forEach((r) => { const k = key(r.date); m[k] = (m[k] || 0) + (r[f] || 0) }); return keys.map((k) => m[k] || 0) }
  const sumBox = document.getElementById('stat-sum'); let cfg
  if (S.statMetric === 'body') {
    const ib = st.inbody
    cfg = { type: 'line', data: { labels: ib.map((r) => label(r.date)), datasets: [
      { label: '체중(kg)', data: ib.map((r) => r.weight), borderColor: '#6366f1', tension: .3 },
      { label: '골격근(kg)', data: ib.map((r) => r.muscle), borderColor: '#10b981', tension: .3 },
      { label: '체지방률(%)', data: ib.map((r) => r.fat_pct), borderColor: '#ef4444', tension: .3 }] } }
    const f = ib[0], l = ib[ib.length - 1], diff = (k) => f && l && l[k] != null && f[k] != null ? (l[k] - f[k]).toFixed(1) : '-'
    sumBox.innerHTML = ib.length ? [['체중', 'weight', 'kg'], ['골격근', 'muscle', 'kg'], ['체지방률', 'fat_pct', '%']].map(([n, k, u]) =>
      `<div class="stat-box"><p class="text-xs text-slate-500">${n} 변화</p><b>${diff(k) > 0 ? '+' : ''}${diff(k)}${u}</b></div>`).join('')
      : '<p class="empty col-span-3">기간 내 인바디 기록이 없습니다</p>'
  } else {
    const isK = S.statMetric === 'kcal', data = agg(st.workouts, S.statMetric)
    cfg = { type: 'bar', data: { labels: keys.map(label), datasets: [{ label: isK ? '소모 칼로리(kcal)' : '운동 시간(분)', data, backgroundColor: isK ? '#10b981' : '#6366f1', borderRadius: 6 },
      ...(isK ? [{ type: 'line', label: '섭취 칼로리(kcal)', data: agg(st.meals, 'kcal'), borderColor: '#ef4444', tension: .3 }] : [])] } }
    const total = data.reduce((a, b) => a + b, 0), active = st.workouts.length
    sumBox.innerHTML = `<div class="stat-box"><p class="text-xs text-slate-500">합계</p><b>${total.toLocaleString()}${isK ? 'kcal' : '분'}</b></div>
      <div class="stat-box"><p class="text-xs text-slate-500">일평균</p><b>${Math.round(total / dates.length)}${isK ? 'kcal' : '분'}</b></div>
      <div class="stat-box"><p class="text-xs text-slate-500">운동일</p><b>${active}일</b></div>`
  }
  cfg.options = { maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { y: { beginAtZero: S.statMetric !== 'body' } } }
  charts.push(new Chart(ctx, cfg))
}

// ================= HEALTH =================
async function renderHealth(el) {
  const t = S.healthTab
  el.innerHTML = `${pageHeader('헬스', 'AI 맞춤 운동 · 식단 · 목표')}<div class="page">
    <div class="seg mb-3 bg-white shadow-sm">${[['ai', 'AI운동가이드'], ['diet', '식단'], ['long', '장기목표'], ['monthly', '월별목표']].map(([k, l]) =>
      `<button data-ht="${k}" class="${t === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="health-body"></div></div>`
  bind(el, '[data-ht]', 'click', (n) => { S.healthTab = n.dataset.ht; render() })
  const body = el.querySelector('#health-body')
  if (t === 'ai') return renderAI(body)
  if (t === 'diet') return renderDiet(body)
  return renderGoals(body, t)
}

async function renderAI(body) {
  const g = await api(`/ai-guide?goal=${S.aiGoal}&level=${S.aiLevel}`)
  const todayIdx = (new Date().getDay() + 6) % 7
  body.innerHTML = `<section class="card"><div class="card-title"><span><i class="fas fa-robot text-violet-500 mr-1"></i> 나의 목표</span></div>
    <div>${[['diet', '🔥 체중감량'], ['muscle', '💪 근력증가'], ['health', '🌿 건강유지']].map(([k, l]) => `<span class="chip ${S.aiGoal === k ? 'on' : ''}" data-goal="${k}">${l}</span>`).join('')}</div>
    <div class="mt-1">${[['beginner', '초급'], ['intermediate', '중급'], ['advanced', '고급']].map(([k, l]) => `<span class="chip ${S.aiLevel === k ? 'on' : ''}" data-level="${k}">${l}</span>`).join('')}</div></section>
    <section class="card"><div class="card-title"><span><i class="fas fa-lightbulb text-amber-500 mr-1"></i> AI 분석 리포트</span></div>
      ${g.insights.map((s) => `<p class="text-sm text-slate-600 py-1.5 flex gap-2"><i class="fas fa-check-circle text-indigo-400 mt-0.5"></i><span>${esc(s)}</span></p>`).join('')}</section>
    <section class="card"><div class="card-title"><span><i class="fas fa-calendar-week text-emerald-500 mr-1"></i> 주간 운동 루틴</span></div>
      ${g.plan.map((p, i) => `<details class="border-b border-slate-100 py-2" ${i === todayIdx ? 'open' : ''}><summary class="cursor-pointer flex items-center gap-2">
        <span class="w-7 h-7 rounded-lg ${i === todayIdx ? 'header-grad' : 'bg-slate-100 text-slate-500'} text-xs flex items-center justify-center font-bold">${p.day}</span>
        <b class="text-sm">${esc(p.focus)}</b>${i === todayIdx ? '<span class="text-[10px] bg-indigo-100 text-indigo-600 px-2 rounded-full">오늘</span>' : ''}</summary>
        <ul class="ml-9 mt-1 text-sm text-slate-600 list-disc pl-4">${p.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}
      <button class="btn btn-ghost w-full mt-3" id="ai-log"><i class="fas fa-plus"></i> 오늘 운동 기록하기</button></section>
    <section class="card"><div class="card-title"><span><i class="fas fa-apple-whole text-red-500 mr-1"></i> 권장 영양</span></div>
      <div class="grid grid-cols-3 gap-2 text-center text-sm">
        <div class="stat-box"><p class="text-xs text-slate-500">기초대사량</p><b>${g.nutrition.bmr}</b></div>
        <div class="stat-box"><p class="text-xs text-slate-500">활동대사량</p><b>${g.nutrition.tdee}</b></div>
        <div class="stat-box bg-indigo-50"><p class="text-xs text-indigo-500">목표 섭취</p><b class="text-indigo-600">${g.nutrition.kcal}</b></div>
        <div class="stat-box"><p class="text-xs text-slate-500">탄수화물</p><b>${g.nutrition.carbs}g</b></div>
        <div class="stat-box"><p class="text-xs text-slate-500">단백질</p><b>${g.nutrition.protein}g</b></div>
        <div class="stat-box"><p class="text-xs text-slate-500">지방</p><b>${g.nutrition.fat}g</b></div></div></section>`
  S.targetKcal = g.nutrition.kcal
  bind(body, '[data-goal]', 'click', (n) => { S.aiGoal = n.dataset.goal; render() })
  bind(body, '[data-level]', 'click', (n) => { S.aiLevel = n.dataset.level; render() })
  body.querySelector('#ai-log').onclick = () => { S.date = kstToday(); workoutModal() }
}

const FOODS = [['쌀밥 1공기', 300, 6, 66, 1], ['현미밥 1공기', 290, 6, 61, 2], ['닭가슴살 100g', 165, 31, 0, 4], ['계란 1개', 75, 6, 1, 5], ['고구마 1개', 130, 2, 31, 0],
  ['바나나 1개', 90, 1, 23, 0], ['샐러드', 120, 3, 10, 7], ['김치찌개', 250, 15, 12, 15], ['비빔밥', 550, 18, 85, 15], ['라면', 500, 10, 79, 16], ['프로틴쉐이크', 130, 24, 4, 2], ['우유 200ml', 130, 6, 10, 7]]
// ---- AI photo calorie flow ----
function resizeImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file)
    img.onload = () => { const r = Math.min(1, max / Math.max(img.width, img.height))
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); resolve(cv.toDataURL('image/jpeg', quality)) }
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다'))
    img.src = url
  })
}
function guessMealType() { const h = new Date().getHours(); return h < 10 ? '아침' : h < 15 ? '점심' : h < 21 ? '저녁' : '간식' }
async function aiPhotoFlow(file) {
  if (!file.type.startsWith('image/')) return toast('이미지 파일만 가능합니다')
  let full, thumb
  try { [full, thumb] = await Promise.all([resizeImage(file, 1024, 0.85), resizeImage(file, 240, 0.7)]) } catch (e) { return toast(e.message) }
  closeModal()
  const bg = document.createElement('div'); bg.className = 'modal-bg'
  bg.innerHTML = `<div class="modal" id="ai-modal"><div class="flex justify-between items-center mb-3"><h3 class="text-lg font-bold"><i class="fas fa-wand-magic-sparkles text-violet-500"></i> AI 칼로리 분석</h3>
    <button type="button" class="text-slate-400 text-xl" data-close><i class="fas fa-xmark"></i></button></div>
    <img src="${full}" class="w-full max-h-64 object-cover rounded-2xl" alt="음식 사진">
    <div class="flex gap-2 mt-3"><input class="input flex-1" id="ai-hint" placeholder="(선택) 메모: 예) 밥 반공기, 소스 없음"><button class="btn btn-primary !w-auto" id="ai-run"><i class="fas fa-magnifying-glass"></i> 분석</button></div>
    <div id="ai-result" class="mt-3"></div></div>`
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove() })
  document.body.appendChild(bg)
  const box = bg.querySelector('#ai-result')
  const run = async () => {
    box.innerHTML = `<div class="text-center py-8 text-slate-500"><div class="ai-spinner"></div><p class="mt-3 text-sm">AI가 음식을 분석하고 있어요...</p><p class="text-xs text-slate-400">약 5~15초 소요</p></div>`
    bg.querySelector('#ai-run').disabled = true
    try { const r = await api('/meals/analyze', { method: 'POST', body: { image: full, hint: bg.querySelector('#ai-hint').value } }); showResult(r) }
    catch (e) { box.innerHTML = `<div class="stat-box text-center text-red-500 text-sm"><i class="fas fa-circle-exclamation"></i> ${esc(e.message)}</div>` }
    finally { bg.querySelector('#ai-run').disabled = false }
  }
  const showResult = (r) => {
    const items = r.items.map((i) => ({ ...i, on: true }))
    const draw = () => {
      const sel = items.filter((i) => i.on), tot = sel.reduce((a, i) => ({ k: a.k + i.calories, c: a.c + i.carbs, p: a.p + i.protein, f: a.f + i.fat }), { k: 0, c: 0, p: 0, f: 0 })
      box.innerHTML = `<div class="stat-box bg-gradient-to-br from-indigo-50 to-violet-50 text-center">
        <p class="text-xs text-slate-500">총 추정 칼로리 <span class="ai-badge">신뢰도 ${esc(r.confidence)}</span></p>
        <b class="text-3xl text-indigo-600">${tot.k.toLocaleString()}</b> <span class="text-slate-500">kcal</span>
        <p class="text-xs text-slate-500 mt-1">탄 ${tot.c}g · 단 ${tot.p}g · 지 ${tot.f}g</p></div>
        ${r.comment ? `<p class="text-xs text-slate-600 bg-amber-50 rounded-lg p-2 mt-2"><i class="fas fa-lightbulb text-amber-500"></i> ${esc(r.comment)}</p>` : ''}
        <p class="text-xs text-slate-500 mt-3 mb-1">인식된 음식 (칼로리 수정 가능, 체크 해제 시 제외)</p>
        ${items.map((i, k) => `<div class="list-item"><input type="checkbox" class="w-5 h-5 accent-indigo-500" data-ion="${k}" ${i.on ? 'checked' : ''}>
          <div class="flex-1 ${i.on ? '' : 'opacity-40'}"><b class="text-sm">${esc(i.name)}</b><p class="text-xs text-slate-400">${esc(i.amount)} · 탄${i.carbs} 단${i.protein} 지${i.fat}</p></div>
          <input type="number" class="input !w-20 !py-1 text-right text-sm" data-ikcal="${k}" value="${i.calories}"><span class="text-xs text-slate-400">kcal</span></div>`).join('')}
        <div class="grid grid-cols-2 gap-2 mt-3"><div><label class="label !mt-0">날짜</label><input type="date" class="input" id="ai-date" value="${S.date}"></div>
        <div><label class="label !mt-0">끼니</label><select class="input" id="ai-type">${['아침', '점심', '저녁', '간식'].map((t) => `<option ${t === (S.aiMealType || guessMealType()) ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
        <button class="btn btn-primary mt-4" id="ai-save" ${sel.length ? '' : 'disabled'}><i class="fas fa-check"></i> 식단에 기록하기</button>
        <p class="text-[11px] text-slate-400 text-center mt-2">AI 추정치이며 실제와 다를 수 있습니다.</p>`
      box.querySelectorAll('[data-ion]').forEach((c) => (c.onchange = () => { items[c.dataset.ion].on = c.checked; draw() }))
      box.querySelectorAll('[data-ikcal]').forEach((c) => (c.onchange = () => {
        const it = items[c.dataset.ikcal], nv = Math.max(0, Math.round(+c.value || 0)), ratio = it.calories ? nv / it.calories : 1
        it.carbs = Math.round(it.carbs * ratio); it.protein = Math.round(it.protein * ratio); it.fat = Math.round(it.fat * ratio); it.calories = nv; draw() }))
      box.querySelector('#ai-save').onclick = async (e) => {
        e.target.disabled = true
        const date = box.querySelector('#ai-date').value, meal_type = box.querySelector('#ai-type').value
        try {
          for (const [k, i] of sel.entries())
            await api('/meals', { method: 'POST', body: { date, meal_type, food: i.amount ? `${i.name} (${i.amount})` : i.name, calories: i.calories, carbs: i.carbs, protein: i.protein, fat: i.fat, ai: 1, photo: k === 0 ? thumb : null } })
          bg.remove(); S.date = date; S.calMonth = date.slice(0, 7); toast(`${tot.k}kcal 기록 완료!`); render()
        } catch (err) { toast(err.message); e.target.disabled = false }
      }
    }
    draw()
  }
  bg.querySelector('#ai-run').onclick = run
  run()
}

async function renderDiet(body) {
  const meals = await api(`/meals?from=${S.date}&to=${S.date}`)
  const tot = meals.reduce((a, m) => ({ k: a.k + (m.calories || 0), p: a.p + (m.protein || 0), c: a.c + (m.carbs || 0), f: a.f + (m.fat || 0) }), { k: 0, p: 0, c: 0, f: 0 })
  const target = S.targetKcal || 2000, pct = Math.min(100, Math.round(tot.k / target * 100))
  body.innerHTML = `<section class="card"><div class="flex items-center justify-between mb-2">
      <input type="date" class="input !w-auto !py-1.5" id="diet-date" value="${S.date}"><span class="text-xs text-slate-500">목표 ${target}kcal</span></div>
    <div class="flex items-end gap-1"><b class="text-3xl text-red-500">${tot.k.toLocaleString()}</b><span class="text-slate-500 mb-1">/ ${target} kcal</span></div>
    <div class="progress my-2"><div style="width:${pct}%"></div></div>
    <div class="grid grid-cols-3 gap-2 text-center text-sm mt-3"><div class="stat-box"><p class="text-xs text-slate-500">탄수화물</p><b>${tot.c.toFixed(0)}g</b></div>
    <div class="stat-box"><p class="text-xs text-slate-500">단백질</p><b>${tot.p.toFixed(0)}g</b></div><div class="stat-box"><p class="text-xs text-slate-500">지방</p><b>${tot.f.toFixed(0)}g</b></div></div>
    <div class="h-40 mt-3"><canvas id="macro-chart"></canvas></div></section>
    <section class="card ai-photo-card" id="ai-photo-card"><div class="flex items-center gap-3">
      <div class="w-12 h-12 rounded-2xl header-grad flex items-center justify-center text-xl"><i class="fas fa-camera"></i></div>
      <div class="flex-1"><b>AI 사진 칼로리 측정</b><p class="text-xs text-slate-500">음식 사진을 올리면 AI가 칼로리·영양소를 분석해요</p></div></div>
      <div class="grid grid-cols-2 gap-2 mt-3">
        <label class="btn btn-primary text-center cursor-pointer text-sm"><i class="fas fa-camera"></i> 촬영하기<input type="file" accept="image/*" capture="environment" class="hidden" data-photo></label>
        <label class="btn btn-ghost text-center cursor-pointer text-sm"><i class="fas fa-image"></i> 앨범에서 선택<input type="file" accept="image/*" class="hidden" data-photo></label></div></section>
    ${['아침', '점심', '저녁', '간식'].map((t) => { const ms = meals.filter((m) => m.meal_type === t)
      return `<section class="card"><div class="card-title"><span>${{ 아침: '🌅', 점심: '☀️', 저녁: '🌙', 간식: '🍪' }[t]} ${t} <span class="text-xs text-slate-400 font-normal">${ms.reduce((a, b) => a + (b.calories || 0), 0)}kcal</span></span>
      <button class="btn btn-ghost btn-sm" data-addmeal="${t}"><i class="fas fa-plus"></i></button></div>
      ${ms.length ? ms.map((m) => `<div class="list-item">${m.photo ? `<img src="${m.photo}" class="meal-thumb" data-viewphoto="${m.id}" alt="${esc(m.food)}">` : ''}<div class="flex-1"><b class="text-sm">${esc(m.food)}</b>${m.ai ? ' <span class="ai-badge">AI</span>' : ''}<p class="text-xs text-slate-400">탄 ${m.carbs ?? 0}g · 단 ${m.protein ?? 0}g · 지 ${m.fat ?? 0}g</p></div>
        <b class="text-sm">${m.calories}kcal</b><button class="text-slate-300 ml-2" data-delmeal="${m.id}"><i class="fas fa-trash"></i></button></div>`).join('') : '<p class="empty">기록 없음</p>'}</section>` }).join('')}`
  body.querySelector('#diet-date').onchange = (e) => { S.date = e.target.value; S.calMonth = S.date.slice(0, 7); render() }
  bind(body, '[data-delmeal]', 'click', async (n) => { await api(`/meals/${n.dataset.delmeal}`, { method: 'DELETE' }); render() })
  bind(body, '[data-photo]', 'change', (n) => { const f = n.files[0]; n.value = ''; if (f) aiPhotoFlow(f) })
  bind(body, '[data-viewphoto]', 'click', (n) => { const bg = document.createElement('div'); bg.className = 'modal-bg !items-center'
    bg.innerHTML = `<img src="${n.src}" class="max-w-[92%] max-h-[80vh] rounded-2xl">`; bg.onclick = () => bg.remove(); document.body.appendChild(bg) })
  bind(body, '[data-addmeal]', 'click', (n) => {
    S.aiMealType = n.dataset.addmeal
    modal(`${n.dataset.addmeal} 식단 추가`, `<label class="label">빠른 선택</label><div id="quick-foods">${FOODS.map((f, i) => `<span class="chip" data-food="${i}">${f[0]}</span>`).join('')}</div>
      <input type="hidden" name="meal_type" value="${n.dataset.addmeal}"><input type="hidden" name="date" value="${S.date}">
      ${field('음식명', 'food', 'text', '', 'required')}${field('칼로리(kcal)', 'calories', 'number', '', 'required')}
      <div class="grid grid-cols-3 gap-2"><div>${field('탄수(g)', 'carbs', 'number', '0', 'step="0.1"')}</div><div>${field('단백질(g)', 'protein', 'number', '0', 'step="0.1"')}</div><div>${field('지방(g)', 'fat', 'number', '0', 'step="0.1"')}</div></div>`,
      (d) => api('/meals', { method: 'POST', body: { ...d, calories: +d.calories, carbs: +d.carbs, protein: +d.protein, fat: +d.fat } }))
    const mf = document.querySelector('.modal'), form = mf.elements
    mf.querySelectorAll('[data-food]').forEach((c) => (c.onclick = () => { const f = FOODS[c.dataset.food]
      form.food.value = f[0]; form.calories.value = f[1]; form.protein.value = f[2]; form.carbs.value = f[3]; form.fat.value = f[4] }))
  })
  if (tot.k) charts.push(new Chart(document.getElementById('macro-chart'), { type: 'doughnut',
    data: { labels: ['탄수화물', '단백질', '지방'], datasets: [{ data: [tot.c * 4, tot.p * 4, tot.f * 9].map(Math.round), backgroundColor: ['#f59e0b', '#6366f1', '#ef4444'] }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } } }))
}

async function renderGoals(body, kind) {
  const q = kind === 'monthly' ? `?kind=monthly&month=${S.goalMonth}` : '?kind=long'
  const goals = await api('/goals' + q)
  let auto = null
  if (kind === 'monthly') { const [y, m] = S.goalMonth.split('-').map(Number); const last = new Date(y, m, 0).getDate()
    const w = await api(`/workouts?from=${S.goalMonth}-01&to=${S.goalMonth}-${last}`)
    auto = { days: new Set(w.map((x) => x.date)).size, mins: w.reduce((a, b) => a + b.duration_min, 0), kcal: w.reduce((a, b) => a + (b.calories || 0), 0) } }
  const dday = (d) => { if (!d) return ''; const n = Math.ceil((new Date(d) - new Date(kstToday())) / 86400e3); return n > 0 ? `D-${n}` : n === 0 ? 'D-Day' : `D+${-n}` }
  body.innerHTML = `${kind === 'monthly' ? `<section class="card"><div class="flex items-center justify-between"><input type="month" class="input !w-auto !py-1.5" id="goal-month" value="${S.goalMonth}">
      <span class="text-xs text-slate-500">이번 달 실적</span></div><div class="grid grid-cols-3 gap-2 text-center mt-3">
      <div class="stat-box"><p class="text-xs text-slate-500">운동일</p><b>${auto.days}일</b></div><div class="stat-box"><p class="text-xs text-slate-500">운동시간</p><b>${auto.mins}분</b></div>
      <div class="stat-box"><p class="text-xs text-slate-500">소모</p><b>${auto.kcal}kcal</b></div></div></section>` : `<section class="card header-grad"><p class="text-sm text-indigo-100">장기 목표</p>
      <p class="font-bold">꾸준함이 가장 큰 힘입니다 💪</p><p class="text-xs text-indigo-100 mt-1">달성 ${goals.filter((g) => g.done).length} / 전체 ${goals.length}</p></section>`}
    <section class="card"><div class="card-title"><span>${kind === 'monthly' ? '🎯 월별 목표' : '🏔️ 장기 목표'}</span><button class="btn btn-ghost btn-sm" id="add-goal"><i class="fas fa-plus"></i> 추가</button></div>
    ${goals.length ? goals.map((g) => { const p = g.target ? Math.min(100, Math.round((g.current || 0) / g.target * 100)) : (g.done ? 100 : 0)
      return `<div class="py-3 border-b border-slate-100 last:border-0"><div class="flex items-center gap-2">
        <input type="checkbox" class="w-5 h-5 accent-indigo-500" data-gdone="${g.id}" ${g.done ? 'checked' : ''}>
        <b class="flex-1 text-sm ${g.done ? 'line-through text-slate-400' : ''}">${esc(g.title)}</b>
        ${g.deadline ? `<span class="text-xs bg-amber-100 text-amber-600 px-2 rounded-full">${dday(g.deadline)}</span>` : ''}
        <button class="text-slate-400 text-sm" data-gedit="${g.id}"><i class="fas fa-pen"></i></button><button class="text-slate-300 text-sm" data-gdel="${g.id}"><i class="fas fa-trash"></i></button></div>
        ${g.target ? `<div class="flex items-center gap-2 mt-2 ml-7"><div class="progress flex-1"><div style="width:${p}%"></div></div><span class="text-xs text-slate-500">${g.current || 0}/${g.target}${esc(g.unit || '')} (${p}%)</span></div>` : ''}</div>` }).join('')
      : '<p class="empty">목표를 추가해보세요</p>'}</section>`
  body.querySelector('#goal-month')?.addEventListener('change', (e) => { S.goalMonth = e.target.value; render() })
  const goalForm = (g = {}) => field('목표', 'title', 'text', g.title || '', `required placeholder="${kind === 'monthly' ? '예) 운동 20일 하기' : '예) 체중 65kg 달성'}"`) +
    `<div class="grid grid-cols-3 gap-2"><div>${field('목표값', 'target', 'number', g.target ?? '', 'step="0.1"')}</div><div>${field('현재값', 'current', 'number', g.current ?? 0, 'step="0.1"')}</div><div>${field('단위', 'unit', 'text', g.unit || '', 'placeholder="kg, 일, 회"')}</div></div>` +
    (kind === 'long' ? field('목표 기한', 'deadline', 'date', g.deadline || '') : '')
  body.querySelector('#add-goal').onclick = () => modal('목표 추가', goalForm(), (d) => api('/goals', { method: 'POST', body: { ...d, kind, month: kind === 'monthly' ? S.goalMonth : null } }))
  bind(body, '[data-gedit]', 'click', (n) => { const g = goals.find((x) => x.id == n.dataset.gedit)
    modal('목표 수정', goalForm(g), (d) => api(`/goals/${g.id}`, { method: 'PUT', body: d })) })
  bind(body, '[data-gdel]', 'click', async (n) => { if (confirm('삭제할까요?')) { await api(`/goals/${n.dataset.gdel}`, { method: 'DELETE' }); render() } })
  bind(body, '[data-gdone]', 'change', async (n) => { await api(`/goals/${n.dataset.gdone}`, { method: 'PUT', body: { done: n.checked ? 1 : 0 } }); render() })
}

// ================= SLEEP =================
const SLEEP_STATES = ['개운함', '피곤함', '자주 깸', '악몽', '코골이', '잠들기 어려움', '늦잠', '낮잠', '카페인 섭취', '음주', '운동 후', '스트레스']
function calcDuration(bed, wake) { const [bh, bm] = bed.split(':').map(Number), [wh, wm] = wake.split(':').map(Number)
  let d = wh * 60 + wm - (bh * 60 + bm); if (d <= 0) d += 1440; return d }
async function renderSleep(el) {
  const from = new Date(Date.now() - 13 * 86400e3).toISOString().slice(0, 10)
  const logs = await api(`/sleep?from=${from}`)
  const bedStart = localStorage.getItem('fl_bed')
  const avg = logs.length ? logs.reduce((a, b) => a + b.duration_min, 0) / logs.length : 0
  const avgQ = logs.length ? logs.reduce((a, b) => a + (b.quality || 0), 0) / logs.length : 0
  el.innerHTML = `${pageHeader('수면', '좋은 수면이 건강의 시작')}<div class="page">
    <section class="card text-center" id="sleep-timer">
      ${bedStart ? `<p class="text-sm text-slate-500">잠든 시각 ${new Date(+bedStart).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</p>
        <p class="text-4xl font-extrabold text-indigo-600 my-3" id="elapsed">--</p>
        <button class="btn btn-primary" id="wake-btn"><i class="fas fa-sun"></i> 기상하기</button>
        <button class="text-xs text-slate-400 mt-2" id="cancel-bed">취소</button>`
      : `<div class="text-5xl mb-2">🌙</div><p class="text-slate-500 text-sm mb-3">잠자리에 들 때 눌러주세요</p>
        <button class="btn btn-primary" id="bed-btn"><i class="fas fa-moon"></i> 지금 잠들기</button>`}</section>

    <form class="card" id="sleep-form"><div class="card-title"><span><i class="fas fa-clock text-indigo-500 mr-1"></i> 수면 시간 체크</span></div>
      ${field('날짜 (기상일)', 'date', 'date', kstToday(), 'required')}
      <div class="grid grid-cols-2 gap-2"><div>${field('취침 시각', 'bed_time', 'time', '23:00', 'required')}</div><div>${field('기상 시각', 'wake_time', 'time', '07:00', 'required')}</div></div>
      <p class="text-center mt-3 text-sm">총 수면 <b class="text-indigo-600 text-lg" id="dur-preview">8시간 0분</b></p>
      <div class="card-title mt-4 !mb-1"><span><i class="fas fa-face-smile text-amber-500 mr-1"></i> 수면 상태 체크</span></div>
      <p class="text-xs text-slate-500">수면 만족도</p><div id="stars">${[1, 2, 3, 4, 5].map((i) => `<span class="star ${i <= 3 ? 'on' : ''}" data-star="${i}">★</span>`).join('')}</div>
      <input type="hidden" name="quality" value="3">
      <p class="text-xs text-slate-500 mt-2">상태 (복수 선택)</p><div id="state-chips">${SLEEP_STATES.map((s) => `<span class="chip" data-st="${s}">${s}</span>`).join('')}</div>
      ${field('메모', 'memo', 'text', '', 'placeholder="꿈, 컨디션 등"')}
      <button class="btn btn-primary mt-4">수면 기록 저장</button></form>

    <section class="card"><div class="card-title"><span><i class="fas fa-chart-column text-violet-500 mr-1"></i> 최근 2주 수면</span></div>
      <div class="grid grid-cols-2 gap-2 text-center mb-3"><div class="stat-box"><p class="text-xs text-slate-500">평균 수면</p><b>${fmtMin(avg)}</b></div>
      <div class="stat-box"><p class="text-xs text-slate-500">평균 만족도</p><b>${avgQ.toFixed(1)} / 5</b></div></div>
      ${avg && avg < 420 ? '<p class="text-xs bg-amber-50 text-amber-700 rounded-lg p-2 mb-2"><i class="fas fa-triangle-exclamation"></i> 성인 권장 수면은 7~9시간입니다. 수면 시간을 늘려보세요.</p>' : ''}
      <div class="h-48"><canvas id="sleep-chart"></canvas></div></section>

    <section class="card"><div class="card-title"><span>수면 기록</span></div>
      ${logs.length ? logs.map((l) => `<div class="list-item"><div class="w-10 text-center"><b class="text-sm">${Number(l.date.slice(8))}</b><p class="text-[10px] text-slate-400">${KDAY[new Date(l.date + 'T00:00:00').getDay()]}</p></div>
        <div class="flex-1"><b class="text-sm">${fmtMin(l.duration_min)}</b> <span class="text-amber-400 text-xs">${'★'.repeat(l.quality || 0)}</span>
        <p class="text-xs text-slate-400">${esc(l.bed_time)}~${esc(l.wake_time)} ${l.states ? '· ' + esc(l.states) : ''}</p></div>
        <button class="text-slate-300" data-sdel="${l.id}"><i class="fas fa-trash"></i></button></div>`).join('') : '<p class="empty">기록이 없습니다</p>'}</section></div>`

  const form = el.querySelector('#sleep-form').elements, formEl = el.querySelector('#sleep-form'), states = new Set()
  const upd = () => (el.querySelector('#dur-preview').textContent = fmtMin(calcDuration(form.bed_time.value, form.wake_time.value)))
  form.bed_time.oninput = form.wake_time.oninput = upd
  bind(el, '[data-star]', 'click', (n) => { form.quality.value = n.dataset.star; el.querySelectorAll('[data-star]').forEach((s) => s.classList.toggle('on', +s.dataset.star <= +n.dataset.star)) })
  bind(el, '[data-st]', 'click', (n) => { states.has(n.dataset.st) ? states.delete(n.dataset.st) : states.add(n.dataset.st); n.classList.toggle('on') })
  formEl.onsubmit = async (e) => { e.preventDefault(); const d = formData(formEl)
    try { await api('/sleep', { method: 'POST', body: { ...d, quality: +d.quality, duration_min: calcDuration(d.bed_time, d.wake_time), states: [...states].join(', ') } }); toast('수면 기록 저장 완료'); render() } catch (err) { toast(err.message) } }
  bind(el, '[data-sdel]', 'click', async (n) => { if (confirm('삭제할까요?')) { await api(`/sleep/${n.dataset.sdel}`, { method: 'DELETE' }); render() } })

  const hhmm = (d) => d.toTimeString().slice(0, 5)
  el.querySelector('#bed-btn')?.addEventListener('click', () => { localStorage.setItem('fl_bed', Date.now()); toast('좋은 꿈 꾸세요 🌙'); render() })
  el.querySelector('#cancel-bed')?.addEventListener('click', () => { localStorage.removeItem('fl_bed'); render() })
  el.querySelector('#wake-btn')?.addEventListener('click', () => { const b = new Date(+bedStart), w = new Date()
    form.bed_time.value = hhmm(b); form.wake_time.value = hhmm(w); form.date.value = kstToday(); upd()
    localStorage.removeItem('fl_bed'); el.querySelector('#sleep-timer').innerHTML = '<p class="py-3">☀️ 좋은 아침! 아래에서 수면 상태를 체크하고 저장하세요.</p>'
    formEl.scrollIntoView({ behavior: 'smooth' }) })
  if (bedStart) { const tick = () => { const e = document.getElementById('elapsed'); if (!e) return clearInterval(iv); e.textContent = fmtMin((Date.now() - bedStart) / 60000) }; const iv = setInterval(tick, 30000); tick() }

  const dates = dateRange(from, kstToday()), m = {}; logs.forEach((l) => (m[l.date] = Math.max(m[l.date] || 0, l.duration_min)))
  charts.push(new Chart(el.querySelector('#sleep-chart'), { type: 'bar', data: { labels: dates.map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`),
    datasets: [{ label: '수면(시간)', data: dates.map((d) => +((m[d] || 0) / 60).toFixed(1)), backgroundColor: dates.map((d) => (m[d] || 0) >= 420 ? '#6366f1' : '#f59e0b'), borderRadius: 6 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, suggestedMax: 10 } } } }))
}

// ================= MY =================
async function renderMy(el) {
  const { user: u, inbody: ib } = await api('/me'); S.user = u; S.weight = ib?.weight
  const t = S.myTab
  el.innerHTML = `${pageHeader(esc(u.name) + '님', '@' + esc(u.username))}<div class="page">
    <section class="card"><div class="grid grid-cols-4 gap-2 text-center">
      <div><p class="text-xs text-slate-500">키</p><b class="text-sm">${u.height || '-'}cm</b></div><div><p class="text-xs text-slate-500">체중</p><b class="text-sm">${ib?.weight ?? '-'}kg</b></div>
      <div><p class="text-xs text-slate-500">골격근</p><b class="text-sm">${ib?.muscle ?? '-'}kg</b></div><div><p class="text-xs text-slate-500">체지방률</p><b class="text-sm">${ib?.fat_pct ?? '-'}%</b></div></div>
      ${ib ? `<p class="text-[11px] text-slate-400 text-center mt-2">최근 인바디 측정일 ${esc(ib.date)}</p>` : ''}</section>
    <div class="seg mb-3 bg-white shadow-sm">${[['profile', '개인정보'], ['password', '비밀번호 변경'], ['inbody', '인바디 갱신']].map(([k, l]) => `<button data-mt="${k}" class="${t === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="my-body"></div>
    <button class="btn w-full bg-white text-red-500 shadow-sm mt-2" id="logout-btn"><i class="fas fa-right-from-bracket"></i> 로그아웃</button></div>`
  bind(el, '[data-mt]', 'click', (n) => { S.myTab = n.dataset.mt; render() })
  el.querySelector('#logout-btn').onclick = async () => { await api('/auth/logout', { method: 'POST' }); S.user = null; S.authView = 'login'; render() }
  const body = el.querySelector('#my-body')
  const submit = (id, fn) => (body.querySelector(id).onsubmit = async (e) => { e.preventDefault(); try { await fn(formData(e.target)); toast('저장되었습니다'); render() } catch (err) { toast(err.message) } })
  if (t === 'profile') {
    body.innerHTML = `<form class="card" id="profile-form"><div class="card-title"><span><i class="fas fa-id-card text-indigo-500 mr-1"></i> 개인정보</span></div>
      <label class="label">아이디</label><input class="input bg-slate-50" value="${esc(u.username)}" disabled>
      ${field('이름', 'name', 'text', u.name, 'required')}${field('이메일', 'email', 'email', u.email, 'required')}${field('휴대폰', 'phone', 'tel', u.phone || '')}
      <div class="grid grid-cols-2 gap-2"><div>${field('생년월일', 'birth', 'date', u.birth || '')}</div><div><label class="label">성별</label><select class="input" name="gender">
      <option value="">선택</option><option value="M" ${u.gender === 'M' ? 'selected' : ''}>남성</option><option value="F" ${u.gender === 'F' ? 'selected' : ''}>여성</option></select></div></div>
      ${field('키 (cm)', 'height', 'number', u.height || '', 'step="0.1"')}
      <p class="text-[11px] text-slate-400 mt-2">가입일 ${esc((u.created_at || '').slice(0, 10))}</p><button class="btn btn-primary mt-4">저장</button></form>`
    submit('#profile-form', (d) => api('/me', { method: 'PUT', body: { ...d, height: d.height ? +d.height : null } }))
  } else if (t === 'password') {
    body.innerHTML = `<form class="card" id="pw-form"><div class="card-title"><span><i class="fas fa-lock text-indigo-500 mr-1"></i> 비밀번호 변경</span></div>
      ${field('현재 비밀번호', 'current', 'password', '', 'required')}${field('새 비밀번호 (6자 이상)', 'next', 'password', '', 'required minlength="6"')}${field('새 비밀번호 확인', 'next2', 'password', '', 'required')}
      <button class="btn btn-primary mt-4">비밀번호 변경</button></form>`
    submit('#pw-form', (d) => { if (d.next !== d.next2) throw new Error('새 비밀번호가 일치하지 않습니다'); return api('/me/password', { method: 'PUT', body: d }) })
  } else {
    const hist = await api('/inbody')
    body.innerHTML = `<form class="card" id="inbody-form"><div class="card-title"><span><i class="fas fa-weight-scale text-indigo-500 mr-1"></i> 인바디 정보 갱신</span></div>
      ${field('측정일', 'date', 'date', kstToday(), 'required')}
      <div class="grid grid-cols-2 gap-2"><div>${field('체중 (kg)', 'weight', 'number', ib?.weight ?? '', 'step="0.1" required')}</div><div>${field('골격근량 (kg)', 'muscle', 'number', ib?.muscle ?? '', 'step="0.1"')}</div>
      <div>${field('체지방량 (kg)', 'fat_mass', 'number', ib?.fat_mass ?? '', 'step="0.1"')}</div><div>${field('체지방률 (%)', 'fat_pct', 'number', ib?.fat_pct ?? '', 'step="0.1"')}</div>
      <div>${field('BMI', 'bmi', 'number', '', 'step="0.1" placeholder="자동 계산"')}</div><div>${field('기초대사량 (kcal)', 'bmr', 'number', ib?.bmr ?? '')}</div></div>
      <button class="btn btn-primary mt-4">인바디 저장</button></form>
      <section class="card"><div class="card-title"><span>측정 이력</span></div>
      ${hist.length ? `<div class="overflow-x-auto"><table class="w-full text-xs text-center"><thead class="text-slate-500"><tr><th class="py-1">날짜</th><th>체중</th><th>골격근</th><th>체지방률</th><th>BMI</th><th></th></tr></thead>
      <tbody>${hist.map((h) => `<tr class="border-t border-slate-100"><td class="py-2">${esc(h.date.slice(2))}</td><td>${h.weight ?? '-'}</td><td>${h.muscle ?? '-'}</td><td>${h.fat_pct ?? '-'}</td><td>${h.bmi ?? '-'}</td>
      <td><button class="text-slate-300" data-idel="${h.id}"><i class="fas fa-trash"></i></button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">측정 이력이 없습니다</p>'}</section>`
    submit('#inbody-form', (d) => { const n = (k) => (d[k] === '' ? null : +d[k])
      const bmi = n('bmi') ?? (u.height && n('weight') ? +(n('weight') / (u.height / 100) ** 2).toFixed(1) : null)
      const fat_pct = n('fat_pct') ?? (n('fat_mass') && n('weight') ? +(n('fat_mass') / n('weight') * 100).toFixed(1) : null)
      return api('/inbody', { method: 'POST', body: { date: d.date, weight: n('weight'), muscle: n('muscle'), fat_mass: n('fat_mass'), fat_pct, bmi, bmr: n('bmr') } }) })
    bind(body, '[data-idel]', 'click', async (n) => { if (confirm('삭제할까요?')) { await api(`/inbody/${n.dataset.idel}`, { method: 'DELETE' }); render() } })
  }
}

// ================= BOOT =================
async function boot() {
  try { const r = await api('/me'); S.user = r.user; S.weight = r.inbody?.weight } catch { S.user = null }
  render()
}
boot()
