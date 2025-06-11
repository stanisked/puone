require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { Client } = require('pg');
const WebSocket = require('ws');

console.log('ENV test:');
console.log('TELEGRAM_TOKEN:', process.env.TELEGRAM_TOKEN);
console.log('DATABASE_URL:', process.env.DATABASE_URL);


const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});
db.connect();

console.log('DATABASE_URL:', process.env.DATABASE_URL);

// Подключение к WebSocket-серверу
const ws = new WebSocket(process.env.WS_URL || 'ws://localhost:3000');
ws.on('open', () => console.log('✅ WebSocket клиент подключён'));
ws.on('error', (err) => console.error('WebSocket client error:', err));
ws.on('close', () => console.log('❌ WebSocket клиент отключился'));

// Функция обновления last_seen
async function updateLastSeen(telegram_id) {
  await db.query(`UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE telegram_id = $1`, [telegram_id]);
}

// Старт
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await updateLastSeen(chatId);
  await bot.sendMessage(chatId, '👋 Привет, сосед! Я - бот, я подскажу что сделать дальше. Отправь /profile чтобы заполнить анкету.');
});

// Профиль
bot.onText(/\/profile/, async (msg) => {
  const chatId = msg.chat.id;
  await updateLastSeen(chatId);

  const res = await db.query('SELECT * FROM users WHERE telegram_id = $1', [chatId]);
  const user = res.rows[0];
  if (!user) {
    await bot.sendMessage(chatId, '🤖 Ты пока не зарегистрирован. Отправь данные через Mini App.');
  } else {
    await bot.sendMessage(chatId, `🧑‍💬 Профиль:\n\nИмя: ${user.name || 'не указано'}\nИнтересы: ${user.interests || 'не указано'}\nО себе: ${user.bio || 'не указано'}`);
  }
});

// Любое сообщение = обновление last_seen
bot.on('message', async (msg) => {
  await updateLastSeen(msg.from.id);
});
