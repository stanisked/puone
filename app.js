const tg = window.Telegram.WebApp;
tg.expand();
const user = tg.initDataUnsafe.user;
const userId = user?.id || 123456;
let mapInitialized = false;
let map;
let ws;
// Добавим в app.js
const INTERESTS = [
  { emoji: '⚽', name: 'спорт' },  
  { emoji: '📚', name: 'книги' },  
  { emoji: '🎮', name: 'компьютерные игры' },
  { emoji: '💻', name: 'технологии' },
  { emoji: '🍳', name: 'кулинария' },
  { emoji: '🍷', name: 'вино' },
  { emoji: '🎵', name: 'музыка' },
  { emoji: '🎨', name: 'искусство' },
  { emoji: '🐶', name: 'животные' },
  { emoji: '🎥', name: 'фильмы' },
  { emoji: '🎲', name: 'настольные игры' },  
  { emoji: '✈️', name: 'путешествия' },
  { emoji: '🏃', name: 'бег' },
  { emoji: '🏊‍♂️', name: 'плавание' },
  { emoji: '🚴‍♂️', name: 'велосипед' },
  { emoji: '🏋️‍♂️', name: 'фитнес' },
  { emoji: '🎯', name: 'охота' },
  { emoji: '🎣', name: 'рыбалка' },
];

// --- interests selector logic ---
function updateInterestsUI() {
  const selected = document.getElementById('interests').value.split(',').map(i => i.trim()).filter(i => i);
  document.querySelectorAll('#interestsContainer .interest-btn').forEach(btn => {
    const name = btn.dataset.name;
    if (selected.includes(name)) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
}

function showInterestsSelector() {
  const container = document.getElementById('interestsContainer');
  container.innerHTML = '';
  INTERESTS.forEach(interest => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'interest-btn';
    btn.dataset.name = interest.name;
    btn.innerHTML = `${interest.emoji} ${interest.name}`;
    btn.onclick = () => {
      toggleInterest(interest.name);
      updateInterestsUI();
    };
    container.appendChild(btn);
  });
  updateInterestsUI();
}

document.getElementById('interests').addEventListener('focus', showInterestsSelector);
document.getElementById('interestsContainer').addEventListener('click', e => {
  if (e.target.classList.contains('interest-btn')) {
    e.preventDefault();
    toggleInterest(e.target.dataset.name);
    updateInterestsUI();
  }
});

// --- maxDistance slider logic ---
const maxDistanceInput = document.getElementById('maxDistance');
const distanceValueSpan = document.getElementById('distanceValue');
maxDistanceInput.addEventListener('input', () => {
  distanceValueSpan.textContent = maxDistanceInput.value + ' км';
});

function toggleInterest(interest) {
  const current = document.getElementById('interests').value
    .split(',')
    .map(i => i.trim())
    .filter(i => i);
  
  if (current.includes(interest)) {
    const updated = current.filter(i => i !== interest);
    document.getElementById('interests').value = updated.join(', ');
  } else {
    current.push(interest);
    document.getElementById('interests').value = current.join(', ');
  }
}

async function initMap() {
  if (mapInitialized) return;

  mapInitialized = true;

  map = L.map('mapContainer').setView([55.75, 37.61], 12); // Москва по умолчанию

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; PeoneMap',
  }).addTo(map);

  const res = await fetch('https://localhost:3000/api/nearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegram_id: userId })
  });

  const data = await res.json();

  data.forEach(neighbor => {
    if (!neighbor.latitude || !neighbor.longitude) return;

    const marker = L.marker([neighbor.latitude, neighbor.longitude]).addTo(map);
    marker.bindPopup(`
      <b>${neighbor.name}</b><br/>
      🎯 ${neighbor.interests?.join(', ') || '—'}<br/>
      <a href="https://t.me/peone_around_bot?start=chat_${neighbor.telegram_id}" target="_blank">💬 Написать</a>
    `);
  });
}

async function loadNeighbors() {
  const container = document.getElementById('neighbors');
  container.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const res = await fetch('https://localhost:3000/api/nearby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        telegram_id: userId,
        maxDistance: document.getElementById('maxDistance').value
      })
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const data = await res.json();

    container.innerHTML = '';
    if (data.length === 0) {
        container.innerHTML = '<div class="no-neighbors">Соседей не найдено в заданном радиусе.</div>';
    } else {
        data.forEach(neighbor => {
          const div = document.createElement('div');
          div.className = 'card';
          div.innerHTML = `
            <b>${neighbor.name}</b><br/>
            📍 ${neighbor.distance_km} км<br/>
            🎯 ${neighbor.interests?.join(', ') || 'нет интересов'}
          `;
          container.appendChild(div);
        });
    }

  } catch (err) {
    console.error('Failed to load neighbors:', err);
    container.innerHTML = '<div class="error">Ошибка загрузки соседей.</div>';
    alert('Ошибка загрузки соседей');
  }
}

async function loadProfile() {
  const res = await fetch(`https://localhost:3000/api/profile/${userId}`);
  const data = await res.json();
  document.getElementById('avatar_url').value = data.avatar_url || '';
  document.getElementById('name').value = data.name || '';
  document.getElementById('bio').value = data.bio || '';
  document.getElementById('interests').value = (data.interests || []).join(', ');
  showInterestsSelector();
  // maxDistance (если есть)
  if (data.maxDistance) {
    maxDistanceInput.value = data.maxDistance;
    distanceValueSpan.textContent = data.maxDistance + ' км';
  }
}

document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await fetch('https://localhost:3000/api/profile/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegram_id: userId,
      name: document.getElementById('name').value,
      bio: document.getElementById('bio').value,
      interests: document.getElementById('interests').value.split(',').map(s => s.trim()).filter(Boolean),
      avatar_url: document.getElementById('avatar_url').value,
      maxDistance: maxDistanceInput.value
    })
  });
  alert('✅ Профиль обновлён!');
});

function sendLocation() {
  if (tg.isLocationRequested) {
    tg.requestGeoLocation();
  } else {
    alert('Геолокация недоступна. Разрешите доступ в настройках Telegram.');
  }
}

tg.onEvent('locationChanged', async location => {
  const { latitude, longitude } = location;
  await fetch('https://localhost:3000/api/profile/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegram_id: userId, latitude, longitude })
  });
  alert('📍 Геолокация сохранена!');
});

loadNeighbors();
loadProfile();

let currentConversationId = null;

async function loadConversation() {
  const res = await fetch(`https://localhost:3000/api/conversations/find`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegram_id: userId })
  });
  const data = await res.json();
  currentConversationId = data.id;
  pollMessages();
}

async function loadMessages() {
  if (!currentConversationId) return;
  const res = await fetch(`https://localhost:3000/api/messages/${currentConversationId}`);
  const data = await res.json();
  const msgDiv = document.getElementById('messages');
  msgDiv.innerHTML = '';
  data.forEach(m => {
    const div = document.createElement('div');
    div.textContent = `${m.sender_name}: ${m.content}`;
    msgDiv.appendChild(div);
  });
  msgDiv.scrollTop = msgDiv.scrollHeight;
}

document.getElementById('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('messageInput');
  const text = input.value;
  if (text.trim()) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'message',
        conversation_id: currentConversationId,
        sender_id: userId,
        content: text
      }));
      input.value = '';
    } else {
      alert('WebSocket соединение не установлено. Попробуйте позже.');
    }
  }
});

function pollMessages() {
  setInterval(loadMessages, 3000); // автообновление раз в 3 сек
}

async function loadConversations() {
  const res = await fetch(`https://localhost:3000/api/conversations/list/${userId}`);
  const data = await res.json();
  const chatList = document.getElementById('chatList');
  chatList.innerHTML = '';
  data.forEach(conv => {
    const div = document.createElement('div');
    div.className = 'chat-card';
    
    const lastSeen = conv.last_seen ? new Date(conv.last_seen) : null;
    let status = '⏱ неизвестно';

    if (lastSeen) {
      const diff = (Date.now() - lastSeen.getTime()) / 1000;
      if (diff < 120) status = '🟢 Онлайн';
      else status = `⏱ Был(а) ${Math.floor(diff / 60)} мин назад`;
    }

    div.innerHTML = `
  <div style="display:flex;align-items:center;gap:10px;">
    <img src="${conv.avatar_url || 'https://placekitten.com/60/60'}" width="40" height="40" style="border-radius:50%;">
    <div>
      <b>${conv.partner_name}</b><br/>
      ${status}<br/>
      <small>${conv.last_message || ''}</small>
    </div>
  </div>
`;

    div.onclick = () => {
      currentConversationId = conv.id;
      showTab('chat');
      loadMessages();
    };
    chatList.appendChild(div);
  });
}

function showTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  if (tabId === 'map') initMap();
  if (tabId === 'conversations') loadConversations();
}

function connectWebSocket() {
  if (!currentConversationId) return;

  ws = new WebSocket('wss://localhost:3000/ws'); // Заменить

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', conversation_id: currentConversationId }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'message') {
      appendMessage(data.sender_id, data.content);
    }
  };
}

function appendMessage(sender_id, content) {
  const msgDiv = document.getElementById('messages');
  const div = document.createElement('div');
  div.textContent = `${sender_id === userId ? 'Ты' : 'Собеседник'}: ${content}`;
  msgDiv.appendChild(div);
  msgDiv.scrollTop = msgDiv.scrollHeight;
}
