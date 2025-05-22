// lang.js
const translations = {
    ru: {
      welcome: "Добро пожаловать в Привет Сосед!",
      profile: "Профиль",
      neighbors: "Соседи",
      map: "Карта",
      chats: "Чаты",
      // ... другие переводы
    },
    en: {
      welcome: "Welcome to Hi Neighbor!",
      profile: "Profile",
      neighbors: "Neighbors",
      map: "Map",
      chats: "Chats",
      // ... other translations
    }
  };
  
  function getTranslations(lang = 'ru') {
    return translations[lang] || translations.ru;
  }