require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// 📦 Подключение к БД
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});
db.connect();

// 📡 WS сервер
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 🛡️ Миддлвары ДО маршрутов
app.use(cors());
app.use(express.json({ limit: '5mb' })); // <== УВЕЛИЧЕННЫЙ ЛИМИТ

// 📌 Обработка профиля
app.post('/api/profile', async (req, res) => {
  const { telegram_id, name, interests, bio, avatar_url, latitude, longitude } = req.body;

  try {
    await db.query(
      `INSERT INTO users (telegram_id, name, interests, bio, avatar_url, latitude, longitude, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)
       ON CONFLICT (telegram_id) DO UPDATE SET
         name = EXCLUDED.name,
         interests = EXCLUDED.interests,
         bio = EXCLUDED.bio,
         avatar_url = EXCLUDED.avatar_url,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         last_seen = CURRENT_TIMESTAMP`,
      [telegram_id, name, interests, bio, avatar_url, latitude, longitude]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Ошибка сохранения профиля:', err);
    res.status(500).send('Ошибка сохранения');
  }
});

app.get('/api/nearby/:telegram_id', async (req, res) => {
  const { telegram_id } = req.params;

  const userRes = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);
  if (!userRes.rows.length) return res.json([]);

  const me = userRes.rows[0];
  const othersRes = await db.query('SELECT * FROM users WHERE telegram_id != $1', [telegram_id]);

  const nearby = othersRes.rows.filter((u) => {
    if (!u.latitude || !u.longitude) return false;
    const distance = require('geolib').getDistance(
      { latitude: me.latitude, longitude: me.longitude },
      { latitude: u.latitude, longitude: u.longitude }
    );
    return distance <= 2000;
  });

  res.json(nearby);
});


// 🛰️ WebSocket
wss.on('connection', (ws) => {
  console.log('📡 WS клиент подключён');
});

// 🚀 Старт
server.listen(PORT, () => {
  console.log(`🚀 Peone backend + WS на порту ${PORT}`);
});
