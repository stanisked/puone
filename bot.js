require('dotenv').config({ path: '../.env' });
const TelegramBot = require('node-telegram-bot-api');
const { Client } = require('pg');
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Add WebSocket client
const WebSocket = require('ws');
const wsUrl = process.env.WS_URL || 'ws://localhost:3000'; // Should come from config
const wsClient = new WebSocket(wsUrl);

wsClient.on('open', function open() {
  console.log('WebSocket client connected to server');
});

wsClient.on('message', function message(data) {
  console.log(`Received message from server: ${data}`);
  // TODO: Handle messages received from the server via WebSocket
  // e.g., notifications about new messages from mini-app users
});

wsClient.on('error', function error(err) {
  console.error('WebSocket client error:', err);
});

wsClient.on('close', function close(code, reason) {
  console.log('WebSocket client disconnected:', code, reason ? reason.toString() : '');
  // TODO: Implement reconnection logic if necessary
});

const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false // отключаем SSL для локального подключения
  });
db.connect();

const userStates = new Map();
const activeChats = new Map();

// --- interests list for inline keyboard ---
const INTERESTS = [
  { emoji: '⚽', name: 'спорт' },
  { emoji: '📚', name: 'книги' },
  { emoji: '🎮', name: 'игры' },
  { emoji: '💻', name: 'технологии' },
  { emoji: '🍳', name: 'кулинария' },
  { emoji: '🎵', name: 'музыка' },
  { emoji: '🎨', name: 'искусство' },
  { emoji: '🐶', name: 'животные' },
  { emoji: '🎥', name: 'фильмы' },
  { emoji: '✈️', name: 'путешествия' }
];

function getUserId(telegramId) {
  return db.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId])
    .then(res => res.rows[0]?.id)
    .catch(err => {
      console.error('Error in getUserId:', err);
      return null;
    });
}

async function updateLastSeen(tgId) {
  try {
    await db.query(`UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE telegram_id = $1`, [tgId]);
  } catch (err) {
    console.error('Error updating last_seen:', err);
  }
}

// /start
bot.onText(/\/start/, async (msg) => {
  await updateLastSeen(msg.from.id);
  try {
    const id = msg.from.id;
    const name = msg.from.first_name;
    await db.query(
      'INSERT INTO users (telegram_id, name) VALUES ($1, $2) ON CONFLICT (telegram_id) DO UPDATE SET name = $2',
      [id, name]
    );
    bot.sendMessage(id, `Привет, ${name}! Добро пожаловать в Peone — соседский чат 🏡`);
  } catch (err) {
    console.error('Error in /start:', err);
    bot.sendMessage(msg.chat.id, 'Произошла ошибка при регистрации. Попробуйте позже.');
  }
});

// /profile
bot.onText(/\/profile/, async (msg) => {
  await updateLastSeen(msg.from.id);
  try {
    const id = msg.from.id;
    const res = await db.query('SELECT name, bio, interests FROM users WHERE telegram_id = $1', [id]);
    const u = res.rows[0];
    if (!u) return bot.sendMessage(id, 'Ты ещё не зарегистрирован. Напиши /start.');
    const bio = u.bio || 'не указано';
    const interests = u.interests?.join(', ') || 'не указаны';
    bot.sendMessage(id, `👤 Имя: ${u.name}\n📝 О себе: ${bio}\n🎯 Интересы: ${interests}`);
  } catch (err) {
    console.error('Error in /profile:', err);
    bot.sendMessage(msg.chat.id, 'Произошла ошибка при загрузке профиля.');
  }
});

// /location
bot.onText(/\/location/, async (msg) => {
  await updateLastSeen(msg.from.id);
  bot.sendMessage(msg.chat.id, '📍 Отправь свою геопозицию кнопкой ниже:', {
    reply_markup: {
      keyboard: [[{ text: '📍 Отправить геопозицию', request_location: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    },
  });
});

// /chats
bot.onText(/\/chats/, async (msg) => {
  await updateLastSeen(msg.from.id);
  try {
    const chatId = msg.chat.id;
    const myTgId = msg.from.id;
    const myId = await getUserId(myTgId);
    if (!myId) return bot.sendMessage(chatId, 'Пользователь не найден.');

    const res = await db.query(`
      SELECT 
        CASE WHEN user1_id = $1 THEN u2.name ELSE u1.name END AS name,
        CASE WHEN user1_id = $1 THEN u2.telegram_id ELSE u1.telegram_id END AS telegram_id
      FROM conversations
      JOIN users u1 ON user1_id = u1.id
      JOIN users u2 ON user2_id = u2.id
      WHERE user1_id = $1 OR user2_id = $1
    `, [myId]);
    if (res.rows.length === 0) return bot.sendMessage(chatId, 'У тебя пока нет чатов.');
    res.rows.forEach(row => {
      bot.sendMessage(chatId, `👤 ${row.name}`, {
        reply_markup: {
          inline_keyboard: [[{ text: '💬 Открыть чат', callback_data: `chat_${row.telegram_id}` }]]
        }
      });
    });
  } catch (err) {
    console.error('Error in /chats:', err);
    bot.sendMessage(msg.chat.id, 'Произошла ошибка при загрузке чатов.');
  }
});

// Функция для нахождения или создания беседы
async function findOrCreateConversation(user1TgId, user2TgId) {
  try {
    const user1Id = await getUserId(user1TgId);
    const user2Id = await getUserId(user2TgId);
    if (!user1Id || !user2Id) return null; // Один из пользователей не найден в БД

    const result = await db.query(`
      SELECT id FROM conversations
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
      LIMIT 1
    `, [user1Id, user2Id]);

    if (result.rows.length > 0) {
      return result.rows[0].id; // Беседа найдена
    } else {
      // Беседа не найдена, создаем новую
      const insert = await db.query(`
        INSERT INTO conversations (user1_id, user2_id)
        VALUES ($1, $2) RETURNING id
      `, [user1Id, user2Id]);
      return insert.rows[0].id; // Возвращаем ID новой беседы
    }
  } catch (err) {
    console.error('Error in findOrCreateConversation:', err);
    return null; // Ошибка при работе с БД
  }
}

// /chat <telegram_id>
bot.onText(/\/chat (\d+)/, async (msg, match) => {
  await updateLastSeen(msg.from.id);
  try {
    const fromTgId = msg.from.id;
    const toTgId = parseInt(match[1]);
    if (fromTgId === toTgId) return bot.sendMessage(fromTgId, 'Это ты сам 😅');

    const conversationId = await findOrCreateConversation(fromTgId, toTgId);

    if (conversationId) {
      activeChats.set(fromTgId, toTgId);
      activeChats.set(toTgId, fromTgId);
      bot.sendMessage(fromTgId, '💬 Чат открыт, пиши сообщение: (выйти - /end)');
      bot.sendMessage(toTgId, '💬 Кто-то начал с тобой чат! Чтобы выйти — напиши /end');
    } else {
      bot.sendMessage(fromTgId, 'Не удалось начать чат. Проверьте ID пользователя.');
    }
  } catch (err) {
    console.error('Error in /chat:', err);
    bot.sendMessage(msg.chat.id, 'Произошла ошибка при попытке начать чат.');
  }
});

// /end — завершить чат
bot.onText(/\/end/, async (msg) => {
  await updateLastSeen(msg.from.id);
  const id = msg.from.id;
  const peer = activeChats.get(id);
  if (peer) {
    activeChats.delete(id);
    activeChats.delete(peer);
    bot.sendMessage(id, '🚪 Ты вышел из чата.');
    bot.sendMessage(peer, '🚪 Собеседник вышел из чата.');
  } else {
    bot.sendMessage(id, 'Ты не в чате.');
  }
});

// Получение геопозиции
bot.on('location', async (msg) => {
  await updateLastSeen(msg.from.id);
  const { latitude, longitude } = msg.location;
  await db.query('UPDATE users SET latitude = $1, longitude = $2 WHERE telegram_id = $3', [latitude, longitude, msg.from.id]);
  bot.sendMessage(msg.chat.id, '📍 Геопозиция обновлена!');
  sendSetupMenu(msg.from.id);
});

// /like <telegram_id> - поставить лайк пользователю
bot.onText(/\/like (\d+)/, async (msg, match) => {
  await updateLastSeen(msg.from.id);
  const fromTgId = msg.from.id;
  const toTgId = parseInt(match[1]);

  if (fromTgId === toTgId) {
    return bot.sendMessage(fromTgId, 'Ты не можешь лайкнуть самого себя 😅');
  }

  try {
    const fromId = await getUserId(fromTgId);
    const toId = await getUserId(toTgId);

    if (!fromId || !toId) {
      return bot.sendMessage(fromTgId, 'Проверьте ID пользователя.');
    }

    // Проверяем, есть ли уже лайк от этого пользователя к другому
    const existingLike = await db.query(
      'SELECT id FROM likes WHERE liker_id = $1 AND liked_id = $2',
      [fromId, toId]
    );

    if (existingLike.rows.length > 0) {
      return bot.sendMessage(fromTgId, 'Ты уже поставил лайк этому пользователю!');
    }

    // Добавляем лайк
    await db.query(
      'INSERT INTO likes (liker_id, liked_id) VALUES ($1, $2)',
      [fromId, toId]
    );
    bot.sendMessage(fromTgId, `✅ Ты лайкнул пользователя с Telegram ID ${toTgId}`);

    // Оповещаем того, кого лайкнули, если это взаимный лайк (не реализовано)
    // Взаимные лайки можно отслеживать здесь и отправлять уведомление

  } catch (err) {
    console.error('Error in /like:', err);
    bot.sendMessage(fromTgId, 'Произошла ошибка при попытке поставить лайк.');
  }
});

// /likes - посмотреть, кто тебя лайкнул
bot.onText(/\/likes/, async (msg) => {
  await updateLastSeen(msg.from.id);
  const myTgId = msg.from.id;

  try {
    const myId = await getUserId(myTgId);
    if (!myId) {
      return bot.sendMessage(myTgId, 'Пользователь не найден.');
    }

    // Получаем список пользователей, которые лайкнули меня
    const likedBy = await db.query(
      'SELECT u.telegram_id, u.name FROM likes JOIN users u ON liker_id = u.id WHERE liked_id = $1',
      [myId]
    );

    if (likedBy.rows.length === 0) {
      return bot.sendMessage(myTgId, 'Тебя пока никто не лайкнул 😥');
    }

    const names = likedBy.rows.map(row => `${row.name} (ID: ${row.telegram_id})`).join('\n');
    bot.sendMessage(myTgId, `Тебя лайкнули:\n${names}`);

  } catch (err) {
    console.error('Error in /likes:', err);
    bot.sendMessage(myTgId, 'Произошла ошибка при загрузке списка лайков.');
  }
});

// Обработка сообщений по состояниям и активный чат
bot.on('message', async (msg) => {
  await updateLastSeen(msg.from.id);
  const userId = msg.from.id;
  const state = userStates.get(userId);

  // Обработка состояния ожидания био
  if (state === 'waiting_for_bio') {
    try {
      await db.query('UPDATE users SET bio = $1 WHERE telegram_id = $2', [msg.text, userId]);
      bot.sendMessage(msg.chat.id, '📝 Биография обновлена!');
      userStates.delete(userId);
      sendSetupMenu(userId);
    } catch (err) {
      console.error('Error updating bio:', err);
      bot.sendMessage(msg.chat.id, 'Произошла ошибка при обновлении биографии.');
      userStates.delete(userId); // Сбрасываем состояние при ошибке
    }
    return;
  }

  // Если активный чат
  const peerId = activeChats.get(userId);
  if (peerId) {
    try {
      bot.sendMessage(peerId, `📨 Сообщение от соседа:\n${msg.text}`);
      const senderDbId = await getUserId(userId);
      const receiverDbId = await getUserId(peerId);
      // Находим беседу (она должна существовать, если есть activeChats)
      const conv = await db.query(
        `SELECT id FROM conversations WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1) LIMIT 1`,
        [senderDbId, receiverDbId]
      );
      if (conv.rows.length) {
        await db.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [
          conv.rows[0].id, senderDbId, msg.text
        ]);
        // Отправлять сообщение через WebSocket, если собеседник в мини-приложении
        // Определить, использует ли собеседник мини-приложение, может быть сложно.
        // Простейший подход - всегда отправлять через WS и позволить серверу
        // решить, куда доставить (боту или WS).
        if (wsClient.readyState === WebSocket.OPEN) {
          const messageData = {
            type: 'message',
            conversationId: conv.rows[0].id,
            senderId: senderDbId, // This is DB ID, not Telegram ID
            content: msg.text,
            timestamp: new Date().toISOString()
          };
          wsClient.send(JSON.stringify(messageData));
          console.log('Message sent via WebSocket to server', messageData);
        } else {
          console.warn('WebSocket client is not open. Message not sent via WS.');
          // Fallback to sending via bot (already done above)
        }
      } else {
        // Этого не должно происходить, если activeChats корректен
        console.error(`Active chat with ${peerId} exists for user ${userId}, but no conversation found in DB.`);
        bot.sendMessage(userId, 'Ошибка чата: беседа не найдена.');
        activeChats.delete(userId); // Сбрасываем состояние чата
      }
    } catch (err) {
      console.error('Error sending message in active chat:', err);
      bot.sendMessage(userId, 'Произошла ошибка при отправке сообщения.');
    }
  }
});

bot.onText(/\/app/, async (msg) => {
  await updateLastSeen(msg.from.id);
    bot.sendMessage(msg.chat.id, '🚀 Открыть Peone Mini App:', {
      reply_markup: {
        inline_keyboard: [[
          {
            text: "👥 Соседи рядом",
            web_app: { url: "https://scintillating-sorbet-ac494e.netlify.app" }
          }
        ]]
      }
    });
  });

// /setup — пошаговая настройка профиля
bot.onText(/\/setup/, async (msg) => {
  await updateLastSeen(msg.from.id);
  const id = msg.from.id;
  await db.query(
    'INSERT INTO users (telegram_id, name) VALUES ($1, $2) ON CONFLICT (telegram_id) DO UPDATE SET name = $2',
    [id, msg.from.first_name]
  );
  sendSetupMenu(id);
});

async function sendSetupMenu(id) {
  const res = await db.query('SELECT name, bio, interests, latitude, longitude FROM users WHERE telegram_id = $1', [id]);
  const u = res.rows[0] || {};
  const bio = u.bio || 'не указано';
  const interests = (u.interests || []).join(', ') || 'не указаны';
  const loc = (u.latitude && u.longitude) ? `📍 ${u.latitude.toFixed(4)}, ${u.longitude.toFixed(4)}` : 'не указано';
  let text = `👤 Имя: ${u.name || 'не указано'}\n📝 О себе: ${bio}\n🎯 Интересы: ${interests}\n${loc}`;
  bot.sendMessage(id, 'Давай настроим твой профиль!\n\n' + text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📍 Указать местоположение', callback_data: 'set_location' }],
        [{ text: '🎯 Выбрать интересы', callback_data: 'set_interests' }],
        [{ text: '📝 Заполнить био', callback_data: 'set_bio' }],
        [{ text: '✅ Готово', callback_data: 'setup_done' }]
      ]
    }
  });
}

// Обработка callback_query для /setup и чатов
bot.on('callback_query', async (query) => {
  await updateLastSeen(query.from.id);
  const id = query.from.id;
  const data = query.data;
  const chatId = query.message.chat.id; // Для ответа в том же чате

  try {
    if (data === 'set_location') {
      bot.sendMessage(id, 'Пожалуйста, отправь свою геопозицию:', {
        reply_markup: {
          keyboard: [[{ text: '📍 Отправить геопозицию', request_location: true }]],
          one_time_keyboard: true
        }
      });
    } else if (data === 'set_interests') {
      // Отправляем кнопки с интересами, отмечаем выбранные
      const user = await db.query('SELECT interests FROM users WHERE telegram_id = $1', [id]);
      const selected = user.rows[0]?.interests || [];
      const keyboard = INTERESTS.map(i => [{
        text: `${selected.includes(i.name) ? '✅ ' : ''}${i.emoji} ${i.name}`,
        callback_data: `interest_${i.name}`
      }]);
      keyboard.push([{ text: '✅ Готово', callback_data: 'interests_done' }]);
      bot.sendMessage(id, 'Выбери свои интересы (можно несколько):', {
        reply_markup: { inline_keyboard: keyboard }
      });
    } else if (data === 'set_bio') {
      userStates.set(id, 'waiting_for_bio');
      bot.sendMessage(id, 'Напиши коротко о себе:');
    } else if (data === 'setup_done') {
      await sendSetupMenu(id);
      bot.sendMessage(id, '✅ Профиль сохранён! Можно пользоваться ботом. Для изменений — снова /setup.');
    } else if (data === 'interests_done') {
      await sendSetupMenu(id);
      bot.sendMessage(id, '🎯 Интересы обновлены!');
    } else if (data.startsWith('interest_')) {
      const interest = data.split('_')[1];
      const user = await db.query('SELECT interests FROM users WHERE telegram_id = $1', [id]);
      const current = user.rows[0]?.interests || [];
      const updated = current.includes(interest)
        ? current.filter(i => i !== interest)
        : [...current, interest];
      await db.query('UPDATE users SET interests = $1 WHERE telegram_id = $2', [updated, id]);
      // Перерисовать клавиатуру с актуальными галочками
      const keyboard = INTERESTS.map(i => [{
        text: `${updated.includes(i.name) ? '✅ ' : ''}${i.emoji} ${i.name}`,
        callback_data: `interest_${i.name}`
      }]);
      keyboard.push([{ text: '✅ Готово', callback_data: 'interests_done' }]);
      bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: id, message_id: query.message.message_id });
      bot.answerCallbackQuery(query.id, { text: 'Интересы обновлены!' });
    } else if (data.startsWith('chat_')) { // Обработка callback для открытия чата
      const peerTgId = parseInt(data.split('_')[1]);
      if (isNaN(peerTgId)) {
         bot.answerCallbackQuery(query.id, { text: 'Некорректный ID пользователя.' });
         return;
      }

      // Используем логику из /chat
      const fromTgId = id; // Тот, кто нажал кнопку
      if (fromTgId === peerTgId) {
         bot.answerCallbackQuery(query.id, { text: 'Нельзя начать чат с самим собой.' });
         return;
      }

      const conversationId = await findOrCreateConversation(fromTgId, peerTgId);

      if (conversationId) {
        activeChats.set(fromTgId, peerTgId);
        activeChats.set(peerTgId, fromTgId);
        bot.sendMessage(fromTgId, '💬 Чат открыт, пиши сообщение: (выйти - /end)');
        // Отправляем сообщение собеседнику только если он не в активном чате
        if (!activeChats.has(peerTgId) || activeChats.get(peerTgId) !== fromTgId) {
           bot.sendMessage(peerTgId, '💬 Кто-то начал с тобой чат! Чтобы выйти — напиши /end');
        }
        bot.answerCallbackQuery(query.id, { text: 'Чат открыт!' });
      } else {
        bot.answerCallbackQuery(query.id, { text: 'Не удалось начать чат.' });
      }
    }
    // Добавляем answerCallbackQuery для всех обработанных колбэков, чтобы убрать индикатор загрузки на кнопке
    bot.answerCallbackQuery(query.id);

  } catch (err) {
    console.error('Error in callback_query handler:', err);
    bot.answerCallbackQuery(query.id, { text: 'Произошла ошибка.' });
    bot.sendMessage(chatId, 'Произошла ошибка при обработке запроса.');
  }
});
  