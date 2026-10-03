// server.js — точка входа. Запуск: node server.js  (или npm start)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 4000;

// на всякий случай создаём папку для загруженных файлов
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());                       // разрешаем запросы с frontend.html / admin.html
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadsDir)); // фото товаров и чеки отдаём как обычные файлы

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
  console.log(`✅ SayaShop backend запущен: http://localhost:${PORT}`);
  console.log(`   Магазин:  http://localhost:${PORT}/frontend.html`);
  console.log(`   Админка:  http://localhost:${PORT}/admin.html   (логин: admin)`);
  console.log(`   Данные хранятся в data/db.json, файлы — в uploads/`);
});
