const form = document.getElementById('profileForm');
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const tabProfile = document.getElementById('tab-profile');
const tabNearby = document.getElementById('tab-nearby');
const screenProfile = document.getElementById('profile-screen');
const screenNearby = document.getElementById('nearby-screen');
const nearbyList = document.getElementById('nearby-list');

let avatarUrl = '';
let latitude = null;
let longitude = null;
let telegram_id = 123456;
if (window.Telegram && window.Telegram.WebApp) {
    telegram_id = window.Telegram.WebApp.initDataUnsafe?.user?.id || 123456;
  }
// Получить геолокацию
navigator.geolocation.getCurrentPosition(
  (pos) => {
    latitude = pos.coords.latitude;
    longitude = pos.coords.longitude;
    status.textContent = '📍 Геолокация получена';
  },
  () => {
    status.textContent = '❌ Не удалось получить геолокацию';
  }
);

// Предпросмотр аватарки
document.getElementById('avatar').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      preview.src = reader.result;
      preview.hidden = false;
      avatarUrl = reader.result; // base64
    };
    reader.readAsDataURL(file);
  }
});

// Обработка формы
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const telegram_id = 123456; // fallback
  if (window.Telegram && window.Telegram.WebApp) {
    telegram_id = window.Telegram.WebApp.initDataUnsafe?.user?.id || 123456;
  }
  console.log('Telegram ID:', telegram_id);

  const name = document.getElementById('name').value;
  const interests = document.getElementById('interests').value;
  const bio = document.getElementById('bio').value;

  const data = {
    telegram_id,
    name,
    interests,
    bio,
    avatar_url: avatarUrl,
    latitude,
    longitude,
  };

  try {
    const res = await fetch('http://localhost:3000/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      status.textContent = '✅ Профиль сохранён!';
    } else {
      status.textContent = '❌ Ошибка при сохранении';
    }
  } catch (err) {
    status.textContent = '🚫 Не удалось подключиться к серверу';
  }
});

tabProfile.onclick = () => {
    tabProfile.classList.add('active');
    tabNearby.classList.remove('active');
    screenProfile.hidden = false;
    screenNearby.hidden = true;
  };
  
  tabNearby.onclick = async () => {
    tabProfile.classList.remove('active');
    tabNearby.classList.add('active');
    screenProfile.hidden = true;
    screenNearby.hidden = false;
  
    try {
      const res = await fetch(`http://localhost:3000/api/nearby/${telegram_id}`);
      const users = await res.json();
  
      if (!users.length) {
        nearbyList.innerHTML = '<p>😕 Никого рядом не найдено</p>';
        return;
      }
  
      nearbyList.innerHTML = '';
      users.forEach(user => {
        const card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML = `
          <img src="${user.avatar_url || ''}" alt="Аватар">
          <div class="info">
            <h3>${user.name || 'Без имени'}</h3>
            <p><strong>Интересы:</strong> ${user.interests || '-'}</p>
            <p><strong>О себе:</strong> ${user.bio || '-'}</p>
          </div>
        `;
        nearbyList.appendChild(card);
      });
    } catch (e) {
      nearbyList.innerHTML = 'Ошибка загрузки данных';
    }
  };
