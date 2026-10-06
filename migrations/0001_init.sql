CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  birth TEXT,
  gender TEXT,
  height REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT,
  title TEXT NOT NULL,
  memo TEXT,
  done INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sleep_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  bed_time TEXT NOT NULL,
  wake_time TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  quality INTEGER DEFAULT 3,
  states TEXT,
  memo TEXT
);
CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  calories INTEGER DEFAULT 0,
  intensity TEXT,
  memo TEXT
);
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  food TEXT NOT NULL,
  calories INTEGER DEFAULT 0,
  protein REAL DEFAULT 0,
  carbs REAL DEFAULT 0,
  fat REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inbody (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  weight REAL,
  muscle REAL,
  fat_mass REAL,
  fat_pct REAL,
  bmi REAL,
  bmr INTEGER
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,           -- 'monthly' | 'long'
  month TEXT,                   -- YYYY-MM (monthly)
  deadline TEXT,                -- YYYY-MM-DD (long)
  title TEXT NOT NULL,
  target REAL,
  current REAL DEFAULT 0,
  unit TEXT,
  done INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sched ON schedules(user_id, date);
CREATE INDEX IF NOT EXISTS idx_sleep ON sleep_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_work ON workouts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_meal ON meals(user_id, date);
CREATE INDEX IF NOT EXISTS idx_inbody ON inbody(user_id, date);
CREATE INDEX IF NOT EXISTS idx_goals ON goals(user_id, kind);
