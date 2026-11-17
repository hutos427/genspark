-- GoldenCare 발표용 DB 조회 (Cloudflare 대시보드 > D1 > goldencare-production > Console 에 붙여 넣고 실행)
-- ※ 한 번에 하나씩 실행하세요. 개인정보가 나오지 않게 demo 계정(user_id=1)만 조회합니다.

-- ① 테이블 목록 (앱 테이블 8개 + sessions)
SELECT name AS 테이블 FROM sqlite_master
WHERE type='table' AND name NOT LIKE 'sqlite%' AND name NOT LIKE '_cf%' AND name <> 'd1_migrations' ORDER BY name;

-- ② 테이블별 데이터 건수
SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM schedules) AS schedules,
       (SELECT COUNT(*) FROM sleep_logs) AS sleep_logs, (SELECT COUNT(*) FROM workouts) AS workouts,
       (SELECT COUNT(*) FROM meals) AS meals, (SELECT COUNT(*) FROM inbody) AS inbody,
       (SELECT COUNT(*) FROM goals) AS goals, (SELECT COUNT(*) FROM ai_plans) AS ai_plans;

-- ③ 비밀번호는 암호화(PBKDF2 해시)되어 저장
SELECT username AS 아이디, name AS 이름, substr(password_hash,1,20)||'...' AS 저장된_비밀번호
FROM users WHERE username='demo';

-- ④ AI가 만든 1주 계획 (JSON으로 저장)
SELECT start_date AS 시작일, goal AS 목표, json_extract(plan,'$.daily_kcal') AS 하루kcal,
       json_extract(plan,'$.days[0].focus') AS 첫날운동, json_extract(plan,'$.days[0].meals.점심.menu') AS 첫날점심
FROM ai_plans WHERE user_id=1;

-- ⑤ AI 계획 → 캘린더 일정 → 운동 기록 자동 연결
SELECT s.date AS 날짜, s.title AS AI일정, s.done AS 완료, w.type AS 운동기록, w.calories AS kcal
FROM schedules s LEFT JOIN workouts w
  ON w.user_id=s.user_id AND w.date=s.date AND w.memo LIKE 'AI 계획:%'
WHERE s.plan_id IS NOT NULL AND s.user_id=1 ORDER BY s.date;

-- ⑥ 날짜별 섭취 칼로리 (통계 그래프의 원본 데이터)
SELECT date AS 날짜, COUNT(*) AS 끼니, SUM(calories) AS 총kcal
FROM meals WHERE user_id=1 GROUP BY date ORDER BY date DESC LIMIT 7;
