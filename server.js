require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const geolib = require('geolib');
const app = express();
const PORT = process.env.PORT || 3000;
const http = require('http');
const WebSocket = require('ws');
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
  console.log(`🚀 Peone backend + WS на порту ${PORT}`);
});

app.use(cors());
app.use(async (req, res, next) => {
  const telegram_id = req.body?.telegram_id || req.query?.telegram_id;
  if (telegram_id) {
    await db.query(`UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE telegram_id = $1`, [telegram_id]);
  }
  next();
});
app.use(express.json());

const db = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'peone',
  password: '150281',
  port: 5432,
  ssl: false
});
  
db.connect();

app.post('/api/nearby', async (req, res) => {
  try {
    const tgId = req.body.telegram_id;
    const { interests = [], maxDistance = 5 } = req.body;
    // Логируем входные данные
    console.log('[nearby] input:', req.body);
    //
    if (!req.body.telegram_id) {
      return res.status(400).json({ error: 'telegram_id is required' });
    }
    // Проверка типов
    if (!tgId || typeof tgId !== 'string') {
      return res.status(400).json({ error: 'telegram_id (string) required' });
    }
    if (!Array.isArray(interests)) {
      return res.status(400).json({ error: 'interests must be array' });
    }
    if (isNaN(Number(maxDistance))) {
      return res.status(400).json({ error: 'maxDistance must be number' });
    }

    const meRes = await db.query('SELECT * FROM users WHERE telegram_id = $1', [tgId]);
    const me = meRes.rows[0];
    if (!me || !me.latitude || !me.longitude) {
      return res.status(400).json({ error: 'Location required' });
    }

    let query = 'SELECT * FROM users WHERE telegram_id != $1 AND latitude IS NOT NULL AND longitude IS NOT NULL';
    const params = [tgId];
    if (interests.length > 0) {
      query += ' AND interests && $2';
      params.push(interests);
    }
    query += ' LIMIT 100'; // safety cap

    const usersRes = await db.query(query, params);
    let users = usersRes.rows
      .map(u => ({
        ...u,
        distance_km: (geolib.getDistance(
          { latitude: me.latitude, longitude: me.longitude },
          { latitude: u.latitude, longitude: u.longitude }
        ) / 1000)
      }))
      .filter(u => u.distance_km <= maxDistance)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, 20); // top 20 ближайших

    // Логируем результат
    console.log(`[nearby] found ${users.length} users`);
    res.json(users);
  } catch (err) {
    console.error('[nearby] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Получить профиль по telegram_id
app.get('/api/profile/:tgid', async (req, res) => {
  const tgid = req.params.tgid;
  const result = await db.query(
    'SELECT name, bio, interests, avatar_url, last_seen FROM users WHERE telegram_id = $1',
    [tgid]
  );
  res.json(result.rows[0] || {});
});

// Обновить профиль
app.post('/api/profile/update', async (req, res) => {
  const { telegram_id, name, bio, interests, latitude, longitude, avatar_url, maxDistance } = req.body;
  const interestsArray = Array.isArray(interests)
    ? interests
    : (interests || '').split(',').map(s => s.trim()).filter(Boolean);

  try {
    await db.query(`
    UPDATE users
    SET
      avatar_url = COALESCE($7, avatar_url),
      name = COALESCE($2, name),
      bio = COALESCE($3, bio),
      interests = COALESCE($4, interestsArray),
      latitude = COALESCE($5, latitude),
      longitude = COALESCE($6, longitude),
      max_distance = COALESCE($8, max_distance)
    WHERE telegram_id = $1
  `, [telegram_id, name, bio, interestsArray, latitude, longitude, avatar_url, maxDistance]);

    res.json({ success: true });

  } catch (err) {
    console.error('/api/profile/update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/', (req, res) => {
  res.send('Peone backend работает!');
});

// Получить сообщения по conversation_id
app.get('/api/messages/:id', async (req, res) => {
  const id = req.params.id;
  const result = await db.query(`
    SELECT m.*, u.name AS sender_name
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.conversation_id = $1
    ORDER BY m.sent_at ASC
  `, [id]);
  res.json(result.rows);
});

// Отправить сообщение
app.post('/api/messages/send', async (req, res) => {
  const { telegram_id, conversation_id, content } = req.body;
  if (!telegram_id || !conversation_id || !content) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const user = await db.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
  const sender_id = user.rows[0]?.id;
  if (!sender_id) return res.status(400).json({ error: 'User not found' });

  await db.query(`
    INSERT INTO messages (conversation_id, sender_id, content)
    VALUES ($1, $2, $3)
  `, [conversation_id, sender_id, content]);

  res.json({ ok: true });
});

// Получить или создать беседу с соседом (заглушка)
app.post('/api/conversations/find', async (req, res) => {
  const { telegram_id } = req.body;
  const user = await db.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
  const myId = user.rows[0]?.id;

  // заглушка — всегда общаемся с user ID 2
  const targetId = myId === 1 ? 2 : 1;

  const result = await db.query(`
    SELECT * FROM conversations
    WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
    LIMIT 1
  `, [myId, targetId]);

  let conversation = result.rows[0];

  if (!conversation) {
    const insert = await db.query(`
      INSERT INTO conversations (user1_id, user2_id)
      VALUES ($1, $2) RETURNING *
    `, [myId, targetId]);
    conversation = insert.rows[0];
  }

  res.json(conversation);
});

// Список всех чатов
app.get('/api/conversations/list/:tgid', async (req, res) => {
  const tgid = req.params.tgid;
  const user = await db.query('SELECT id FROM users WHERE telegram_id = $1', [tgid]);
  const myId = user.rows[0]?.id;
  if (!myId) return res.status(404).json({ error: 'User not found' });

  const result = await db.query(`
    SELECT c.id, 
           CASE 
  WHEN c.user1_id = $1 THEN u2.name 
  ELSE u1.name 
END AS partner_name,
           CASE 
  WHEN c.user1_id = $1 THEN u2.last_seen 
  ELSE u1.last_seen 
END AS last_seen,
        CASE 
          WHEN c.user1_id = $1 THEN u2.avatar_url 
          ELSE u1.avatar_url 
END AS avatar_url
    FROM conversations c
    JOIN users u1 ON u1.id = c.user1_id
    JOIN users u2 ON u2.id = c.user2_id
    WHERE c.user1_id = $1 OR c.user2_id = $1
    ORDER BY last_time DESC NULLS LAST
  `, [myId]);

  res.json(result.rows);
});

const sockets = new Map(); // conversation_id → Set of sockets

wss.on('connection', (ws, req) => {
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'join') {
        const { conversation_id } = data;
        ws.conversation_id = conversation_id;
        if (!sockets.has(conversation_id)) sockets.set(conversation_id, new Set());
        sockets.get(conversation_id).add(ws);
      }

      if (data.type === 'message') {
        const { conversation_id, sender_id, content } = data;

        // Сохраняем в БД
        db.query(`
          INSERT INTO messages (conversation_id, sender_id, content)
          VALUES ($1, $2, $3)
        `, [conversation_id, sender_id, content]);

        // Рассылаем всем в беседе
        const payload = JSON.stringify({
          type: 'message',
          sender_id,
          content,
          sent_at: new Date().toISOString()
        });

        sockets.get(conversation_id)?.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        });
      }
    } catch (err) {
      console.error('WS error:', err);
    }
  });

  ws.on('close', () => {
    if (ws.conversation_id) {
      sockets.get(ws.conversation_id)?.delete(ws);
    }
  });
});
