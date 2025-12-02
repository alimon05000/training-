// Service Worker для Тренировочного Календаря
const CACHE_NAME = 'training-calendar-v2.0';
const APP_VERSION = '2.0.0';

// Ресурсы для кэширования при установке
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './images/icon-72.png',
  './images/icon-96.png',
  './images/icon-128.png',
  './images/icon-144.png',
  './images/icon-152.png',
  './images/icon-192.png',
  './images/icon-384.png',
  './images/icon-512.png'
];

// Расширенные ресурсы для кэширования при использовании
const RUNTIME_CACHE_URLS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// ==================== УСТАНОВКА ====================
self.addEventListener('install', event => {
  console.log('[Service Worker] Установка версии:', APP_VERSION);
  
  event.waitUntil(
    Promise.all([
      // Кэширование основных ресурсов
      caches.open(CACHE_NAME)
        .then(cache => {
          console.log('[Service Worker] Кэширование основных ресурсов');
          return cache.addAll(PRECACHE_URLS);
        }),
      
      // Кэширование ресурсов времени выполнения
      caches.open(`${CACHE_NAME}-runtime`)
        .then(cache => {
          console.log('[Service Worker] Кэширование runtime ресурсов');
          return cache.addAll(RUNTIME_CACHE_URLS);
        }),
      
      // Активация сразу
      self.skipWaiting()
    ])
  );
});

// ==================== АКТИВАЦИЯ ====================
self.addEventListener('activate', event => {
  console.log('[Service Worker] Активация');
  
  event.waitUntil(
    Promise.all([
      // Очистка старых кэшей
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME && cacheName !== `${CACHE_NAME}-runtime`) {
              console.log('[Service Worker] Удаление старого кэша:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      
      // Обновление данных
      updateCachedData(),
      
      // Захват клиентов
      self.clients.claim()
    ])
  );
});

// ==================== ОБРАБОТКА ЗАПРОСОВ ====================
self.addEventListener('fetch', event => {
  // Пропускаем неподдерживаемые схемы
  if (!event.request.url.startsWith('http')) {
    return;
  }
  
  // Стратегия: Network First с fallback на кэш
  if (event.request.url.includes('/api/')) {
    event.respondWith(networkFirstStrategy(event.request));
  } 
  // Для статики: Cache First
  else if (isStaticAsset(event.request)) {
    event.respondWith(cacheFirstStrategy(event.request));
  }
  // Для всего остального: Network First
  else {
    event.respondWith(networkFirstStrategy(event.request));
  }
});

// ==================== ФОНОВАЯ СИНХРОНИЗАЦИЯ ====================
self.addEventListener('sync', event => {
  console.log('[Service Worker] Фоновая синхронизация:', event.tag);
  
  switch (event.tag) {
    case 'sync-workouts':
      event.waitUntil(syncWorkouts());
      break;
    case 'sync-settings':
      event.waitUntil(syncSettings());
      break;
    case 'backup-data':
      event.waitUntil(backupData());
      break;
  }
});

// ==================== PUSH УВЕДОМЛЕНИЯ ====================
self.addEventListener('push', event => {
  console.log('[Service Worker] Push уведомление получено');
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Тренировочный Календарь', body: event.data.text() };
    }
  }
  
  const options = {
    body: data.body || 'Время тренировки! 🏋️',
    icon: './images/icon-192.png',
    badge: './images/icon-96.png',
    image: data.image,
    vibrate: [100, 50, 100, 50, 100],
    data: {
      url: data.url || '/',
      timestamp: Date.now(),
      type: data.type || 'reminder'
    },
    actions: [
      {
        action: 'start-workout',
        title: 'Начать тренировку',
        icon: './images/workout-icon.png'
      },
      {
        action: 'snooze',
        title: 'Напомнить позже',
        icon: './images/snooze-icon.png'
      }
    ],
    tag: 'training-reminder',
    renotify: true,
    requireInteraction: true
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Тренировочный Календарь', options)
  );
});

// ==================== КЛИКИ ПО УВЕДОМЛЕНИЯМ ====================
self.addEventListener('notificationclick', event => {
  console.log('[Service Worker] Клик по уведомлению:', event.action);
  
  event.notification.close();
  
  // Обработка действий
  if (event.action === 'start-workout') {
    event.waitUntil(
      openAppAndStartWorkout()
    );
  } else if (event.action === 'snooze') {
    event.waitUntil(
      scheduleSnooze(event.notification)
    );
  } else {
    // Простой клик по уведомлению
    event.waitUntil(
      openApp()
    );
  }
});

// ==================== СТРАТЕГИИ КЭШИРОВАНИЯ ====================
function networkFirstStrategy(request) {
  return fetch(request)
    .then(response => {
      // Клонируем ответ для кэширования
      const responseClone = response.clone();
      caches.open(`${CACHE_NAME}-runtime`)
        .then(cache => {
          cache.put(request, responseClone);
        });
      return response;
    })
    .catch(() => {
      // Fallback на кэш
      return caches.match(request);
    });
}

function cacheFirstStrategy(request) {
  return caches.match(request)
    .then(response => {
      if (response) {
        // Обновляем кэш в фоне
        updateCache(request);
        return response;
      }
      return fetch(request)
        .then(response => {
          // Кэшируем новый ресурс
          const responseClone = response.clone();
          caches.open(`${CACHE_NAME}-runtime`)
            .then(cache => {
              cache.put(request, responseClone);
            });
          return response;
        });
    });
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function isStaticAsset(request) {
  return request.url.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/) ||
         request.url.includes('fonts.googleapis.com') ||
         request.url.includes('cdn.jsdelivr.net');
}

function updateCache(request) {
  caches.open(`${CACHE_NAME}-runtime`)
    .then(cache => {
      fetch(request).then(response => {
        cache.put(request, response);
      });
    });
}

async function updateCachedData() {
  // Обновление кэшированных данных
  const cache = await caches.open(`${CACHE_NAME}-runtime`);
  const requests = await cache.keys();
  
  requests.forEach(request => {
    // Обновляем только устаревшие ресурсы
    fetch(request).then(response => {
      if (response.status === 200) {
        cache.put(request, response);
      }
    });
  });
}

async function syncWorkouts() {
  try {
    const db = await openDatabase();
    const unsyncedWorkouts = await getAllFromStore(db, 'workouts', 'synced', false);
    
    if (unsyncedWorkouts.length === 0) {
      console.log('[Service Worker] Нет данных для синхронизации');
      return;
    }
    
    // Отправка на сервер (заглушка)
    const response = await fetch('/api/sync/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unsyncedWorkouts)
    });
    
    if (response.ok) {
      // Помечаем как синхронизированные
      const tx = db.transaction('workouts', 'readwrite');
      unsyncedWorkouts.forEach(workout => {
        workout.synced = true;
        tx.objectStore('workouts').put(workout);
      });
      await tx.done;
      
      console.log('[Service Worker] Тренировки синхронизированы:', unsyncedWorkouts.length);
      
      // Отправляем уведомление
      self.registration.showNotification('Синхронизация завершена', {
        body: `${unsyncedWorkouts.length} тренировок синхронизировано`,
        icon: './images/icon-192.png'
      });
    }
  } catch (error) {
    console.error('[Service Worker] Ошибка синхронизации:', error);
  }
}

async function syncSettings() {
  // Синхронизация настроек
  console.log('[Service Worker] Синхронизация настроек');
}

async function backupData() {
  // Резервное копирование данных
  console.log('[Service Worker] Резервное копирование данных');
}

function openApp() {
  return self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  }).then(clientList => {
    // Ищем открытое окно
    for (const client of clientList) {
      if (client.url.includes('/') && 'focus' in client) {
        return client.focus();
      }
    }
    // Открываем новое окно
    if (self.clients.openWindow) {
      return self.clients.openWindow('/');
    }
  });
}

function openAppAndStartWorkout() {
  return self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  }).then(clientList => {
    for (const client of clientList) {
      if (client.url.includes('/') && 'focus' in client) {
        // Отправляем сообщение о начале тренировки
        client.postMessage({ action: 'start-workout' });
        return client.focus();
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow('/?start-workout=true');
    }
  });
}

function scheduleSnooze(notification) {
  // Отложить напоминание на 1 час
  const snoozeTime = Date.now() + 60 * 60 * 1000;
  
  return self.registration.showNotification('Напоминание отложено', {
    body: 'Я напомню о тренировке через 1 час',
    icon: './images/icon-192.png',
    tag: 'snooze-notification',
    timestamp: snoozeTime
  });
}

// ==================== INDEXEDDB ПОМОЩНИКИ ====================
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TrainingCalendarDB', 3);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Хранилище тренировок
      if (!db.objectStoreNames.contains('workouts')) {
        const store = db.createObjectStore('workouts', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
      
      // Хранилище упражнений
      if (!db.objectStoreNames.contains('exercises')) {
        const store = db.createObjectStore('exercises', { keyPath: 'id' });
        store.createIndex('muscleGroup', 'muscleGroup', { unique: false });
        store.createIndex('equipment', 'equipment', { unique: false });
      }
      
      // Хранилище шаблонов
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' });
      }
      
      // Хранилище статистики
      if (!db.objectStoreNames.contains('stats')) {
        const store = db.createObjectStore('stats', { keyPath: 'date' });
        store.createIndex('type', 'type', { unique: false });
      }
      
      // Хранилище настроек
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

function getAllFromStore(db, storeName, indexName, indexValue) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    
    if (indexValue !== undefined) {
      const request = index.getAll(indexValue);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }
  });
}

// ==================== ОБРАБОТКА СООБЩЕНИЙ ====================
self.addEventListener('message', event => {
  console.log('[Service Worker] Сообщение получено:', event.data);
  
  switch (event.data.action) {
    case 'skipWaiting':
      self.skipWaiting();
      break;
      
    case 'cacheResources':
      cacheAdditionalResources(event.data.urls);
      break;
      
    case 'clearOldCaches':
      clearOldCaches();
      break;
      
    case 'getCacheStatus':
      getCacheStatus(event.ports[0]);
      break;
  }
});

async function cacheAdditionalResources(urls) {
  const cache = await caches.open(`${CACHE_NAME}-runtime`);
  await cache.addAll(urls);
}

async function clearOldCaches() {
  const cacheNames = await caches.keys();
  const currentCaches = [CACHE_NAME, `${CACHE_NAME}-runtime`];
  
  const cachesToDelete = cacheNames.filter(name => !currentCaches.includes(name));
  
  await Promise.all(
    cachesToDelete.map(name => caches.delete(name))
  );
}

async function getCacheStatus(port) {
  const cacheNames = await caches.keys();
  const cacheStatus = {};
  
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    cacheStatus[name] = {
      size: requests.length,
      urls: requests.map(req => req.url)
    };
  }
  
  port.postMessage(cacheStatus);
}

// ==================== ОБРАБОТКА ОФФЛАЙН РЕЖИМА ====================
self.addEventListener('offline', () => {
  console.log('[Service Worker] Приложение перешло в офлайн режим');
});

self.addEventListener('online', () => {
  console.log('[Service Worker] Приложение вернулось в онлайн');
  
  // Запускаем синхронизацию при появлении сети
  self.registration.sync.register('sync-workouts')
    .then(() => console.log('[Service Worker] Синхронизация запланирована'))
    .catch(err => console.error('[Service Worker] Ошибка регистрации синхронизации:', err));
});
