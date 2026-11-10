-- AI 맞춤 1주 운동·식단 계획
CREATE TABLE IF NOT EXISTS ai_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  goal TEXT,
  level TEXT,
  input TEXT,            -- 사용자가 입력한 조건(JSON)
  plan TEXT NOT NULL,    -- AI가 만든 계획(JSON)
  applied INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_plans ON ai_plans(user_id, created_at);
-- AI 계획에서 캘린더로 등록된 일정 표시용
ALTER TABLE schedules ADD COLUMN plan_id INTEGER;
