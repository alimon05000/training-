const CACHE_NAME = 'training-calendar-v1.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/images/icon-72.png',
  '/images/icon-96.png',
  '/images/icon-128.png',
  '/images/icon-144.png',
  '/images/icon-152.png',
  '/images/icon-192.png',
  '/images/icon-384.png',
  '/images/icon-512.png'
];

// Установка Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация и очистка старых кэшей
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия кэширования: Network First, Fallback to Cache
self.addEventListener('fetch', event => {
  // Для API запросов используем сеть с fallback
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Клонируем ответ для кэширования
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  } else {
    // Для статики используем Cache First
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            return response;
          }
          
          return fetch(event.request).then(response => {
            // Проверяем валидность ответа
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            
            // Клонируем ответ для кэширования
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return response;
          });
        })
    );
  }
});

// Фоновая синхронизация данных
self.addEventListener('sync', event => {
  if (event.tag === 'sync-workouts') {
    event.waitUntil(syncWorkouts());
  }
});

// Пуш-уведомления
self.addEventListener('push', event => {
  const options = {
    body: event.data?.text() || 'Время тренировки!',
    icon: 'images/icon-192.png',
    badge: 'images/icon-96.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    },
    actions: [
      {
        action: 'start',
        title: 'Начать тренировку'
      },
      {
        action: 'snooze',
        title: 'Напомнить позже'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Тренировочный Календарь', options)
  );
});

// Обработка кликов по уведомлениям
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'start') {
    // Открыть приложение и начать тренировку
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/?start-workout');
        }
      })
    );
  } else if (event.action === 'snooze') {
    // Напомнить позже
    event.waitUntil(
      self.registration.showNotification('Тренировочный Календарь', {
        body: 'Напоминание о тренировке через 1 час',
        icon: 'images/icon-192.png'
      })
    );
  } else {
    // Простой клик по уведомлению
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Функция синхронизации тренировок
async function syncWorkouts() {
  try {
    const db = await openDB();
    const workouts = await db.getAll('workouts');
    
    // Отправляем данные на сервер
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(workouts)
    });
    
    if (response.ok) {
      console.log('Workouts synced successfully');
      // Помечаем тренировки как синхронизированные
      const tx = db.transaction('workouts', 'readwrite');
      workouts.forEach(workout => {
        workout.synced = true;
        tx.objectStore('workouts').put(workout);
      });
      await tx.complete;
    }
  } catch (error) {
    console.error('Sync failed:', error);
  }
}

// IndexedDB helper
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TrainingCalendarDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Создаем хранилище для тренировок
      if (!db.objectStoreNames.contains('workouts')) {
        const store = db.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
      }
      
      // Создаем хранилище для упражнений
      if (!db.objectStoreNames.contains('exercises')) {
        const store = db.createObjectStore('exercises', { keyPath: 'id' });
        store.createIndex('muscleGroup', 'muscleGroup', { unique: false });
      }
      
      // Создаем хранилище для статистики
      if (!db.objectStoreNames.contains('stats')) {
        db.createObjectStore('stats', { keyPath: 'id' });
      }
    };
  });
}
