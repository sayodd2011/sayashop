// server.js — точка входа. Запуск: node server.js  (или npm start)
require('dotenv').config(); // должен быть ДО require('./db') и require('./routes'), чтобы переменные из .env успели подхватиться

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const UPLOAD_LIMIT_MB = Number(process.env.UPLOAD_LIMIT_MB) || 10;

// CORS_ORIGIN: "*" (по умолчанию) или список доменов через запятую,
// например: https://sayashop.tj,https://admin.sayashop.tj
const corsOrigin = (process.env.CORS_ORIGIN || '*').trim();
const corsOptions = corsOrigin === '*'
  ? {}
  : { origin: corsOrigin.split(',').map(s => s.trim()) };

// на всякий случай создаём папку для загруженных файлов
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors(corsOptions));            // разрешаем запросы с frontend.html / admin.html
app.use(express.json({ limit: `${UPLOAD_LIMIT_MB}mb` }));
app.use('/uploads', express.static(uploadsDir)); // фото товаров и чеки отдаём как обычные файлы

// Лёгкий эндпоинт для "будильника" (пинг от фронтенда и от внешнего cron-сервиса,
// чтобы бесплатный Render не засыпал). Специально без БД и без авторизации — отвечает мгновенно.
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.use('/api', routes);

// Сам сайт: магазин и админка раздаются этим же сервером (папка public)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/frontend.html'));

app.use((req, res) => res.status(404).json({ error: 'Эндпоинт не найден' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err && (err.name === 'MulterError' || /изображения/.test(err.message || ''))) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`✅ SayaShop backend запущен (${NODE_ENV}): http://localhost:${PORT}`);
  console.log(`   Магазин:  http://localhost:${PORT}/frontend.html`);
  console.log(`   Админка:  http://localhost:${PORT}/admin.html   (логин: ${process.env.ADMIN_PHONE || 'admin'})`);
  console.log(`   Данные хранятся в data/db.json, файлы — в uploads/`);
  if (corsOrigin === '*') console.log('   ⚠️  CORS_ORIGIN=* — для продакшена укажите в .env конкретный домен сайта.');
});
