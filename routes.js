// routes.js — все эндпоинты REST API магазина SayaShop
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { load, uid } = require('./db');

const router = express.Router();

// ---- загрузка файлов (фото товаров, чеки оплаты) ----
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'uploads'),
    filename: (req, file, cb) => cb(null, uid('img') + path.extname(file.originalname || '.jpg'))
  }),
  limits: { fileSize: (Number(process.env.UPLOAD_LIMIT_MB) || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Разрешены только изображения JPG, PNG, WebP или GIF'));
  }
});

function fileUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
}

// ---- простая авторизация по токену (без JWT, для демо-проекта достаточно) ----
function auth(required = true) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const db = load();
    const phone = token ? db.data.sessions[token] : null;
    const user = phone ? db.data.users.find(u => u.phone === phone) : null;
    if (required && !user) return res.status(401).json({ error: 'Требуется авторизация' });
    req.user = user || null;
    req.db = db;
    next();
  };
}
function withDb(req, res, next) { req.db = req.db || load(); next(); }
function isAdmin(req, res, next) {
  // Демо-упрощение: роль admin хранится в самом пользователе (isAdmin:true).
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Доступ только для администратора' });
  next();
}

function pushNotification(db, target, text) {
  if (!db.data.notifications[target]) db.data.notifications[target] = [];
  db.data.notifications[target].unshift({ id: uid('n'), text, date: new Date().toISOString(), read: false });
}

// =====================================================================
// АВТОРИЗАЦИЯ
// =====================================================================
router.post('/register', withDb, (req, res) => {
  const { name, phone, password } = req.body || {};
  if (!name || !phone || !password) return res.status(400).json({ error: 'Заполните имя, телефон и пароль' });
  const db = req.db;
  if (db.data.users.find(u => u.phone === phone)) return res.status(409).json({ error: 'Пользователь с таким телефоном уже существует' });
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = { id: uid('u'), name, phone, passwordHash, isAdmin: false, createdAt: Date.now() };
  db.data.users.push(user);
  const token = uid('tok');
  db.data.sessions[token] = phone;
  db.save();
  res.json({ token, user: { id: user.id, name: user.name, phone: user.phone, isAdmin: user.isAdmin } });
});

router.post('/login', withDb, (req, res) => {
  const { phone, password } = req.body || {};
  const db = req.db;
  const user = db.data.users.find(u => u.phone === phone);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Неверный телефон или пароль' });
  }
  const token = uid('tok');
  db.data.sessions[token] = phone;
  db.save();
  res.json({ token, user: { id: user.id, name: user.name, phone: user.phone, isAdmin: user.isAdmin } });
});

router.post('/logout', auth(false), (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) { delete req.db.data.sessions[token]; req.db.save(); }
  res.json({ ok: true });
});

// Демо-восстановление пароля: без реального SMS/email, только для прототипа
router.post('/reset-password', withDb, (req, res) => {
  const { phone, newPassword } = req.body || {};
  const db = req.db;
  const user = db.data.users.find(u => u.phone === phone);
  if (!user) return res.status(404).json({ error: 'Пользователь с таким телефоном не найден' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Пароль слишком короткий' });
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  db.save();
  res.json({ ok: true });
});

router.get('/profile', auth(true), (req, res) => {
  const { id, name, phone, isAdmin } = req.user;
  res.json({ id, name, phone, isAdmin });
});

// Список покупателей (для админки)
router.get('/users', auth(true), isAdmin, (req, res) => {
  res.json(req.db.data.users.filter(u => !u.isAdmin).map(u => ({ id: u.id, name: u.name, phone: u.phone, createdAt: u.createdAt })));
});

// =====================================================================
// ТОВАРЫ
// =====================================================================
router.get('/products', withDb, (req, res) => res.json(req.db.data.products));
router.get('/products/:id', withDb, (req, res) => {
  const p = req.db.data.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Товар не найден' });
  res.json(p);
});
router.post('/products', auth(true), isAdmin, (req, res) => {
  const p = { id: uid('p'), images: [], ...req.body };
  req.db.data.products.push(p);
  req.db.save();
  res.status(201).json(p);
});
router.put('/products/:id', auth(true), isAdmin, (req, res) => {
  const db = req.db;
  const idx = db.data.products.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Товар не найден' });
  db.data.products[idx] = { ...db.data.products[idx], ...req.body };
  db.save();
  res.json(db.data.products[idx]);
});
router.delete('/products/:id', auth(true), isAdmin, (req, res) => {
  const db = req.db;
  db.data.products = db.data.products.filter(x => x.id !== req.params.id);
  db.save();
  res.json({ ok: true });
});
// Загрузка фото товара (можно несколько файлов сразу) — возвращает публичные URL
router.post('/products/upload-images', auth(true), isAdmin, upload.array('images', 10), (req, res) => {
  const urls = (req.files || []).map(f => fileUrl(req, f.filename));
  res.json({ urls });
});

// =====================================================================
// КАТЕГОРИИ
// =====================================================================
// Категория хранится как { name, subcategories: [строки] }
router.get('/categories', withDb, (req, res) => res.json(req.db.data.categories));
router.post('/categories', auth(true), isAdmin, (req, res) => {
  const { name, subcategories } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Укажите название категории' });
  const db = req.db;
  if (db.data.categories.find(c => c.name === name)) return res.status(409).json({ error: 'Такая категория уже есть' });
  db.data.categories.push({ name, subcategories: Array.isArray(subcategories) ? subcategories.filter(Boolean) : [] });
  db.save();
  res.status(201).json(db.data.categories);
});
router.put('/categories/:name', auth(true), isAdmin, (req, res) => {
  const db = req.db;
  const oldName = req.params.name;
  const cat = db.data.categories.find(c => c.name === oldName);
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
  const newName = (req.body && req.body.name || '').trim();
  if (newName && newName !== oldName) {
    cat.name = newName;
    db.data.products.forEach(p => { if (p.category === oldName) p.category = newName; });
  }
  if (Array.isArray(req.body.subcategories)) cat.subcategories = req.body.subcategories.filter(Boolean);
  db.save();
  res.json(db.data.categories);
});
router.delete('/categories/:name', auth(true), isAdmin, (req, res) => {
  const db = req.db;
  db.data.categories = db.data.categories.filter(c => c.name !== req.params.name);
  db.save();
  res.json(db.data.categories);
});
// Добавить/удалить одну подкатегорию
router.post('/categories/:name/subcategories', auth(true), isAdmin, (req, res) => {
  const db = req.db;
  const cat = db.data.categories.find(c => c.name === req.params.name);
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
  const sub = (req.body && req.body.name || '').trim();
  if (!sub) return res.status(400).json({ error: 'Укажите название подкатегории' });
  if (!cat.subcategories.includes(sub)) cat.subcategories.push(sub);
  db.save();
  res.status(201).json(cat);
});
router.delete('/categories/:name/subcategories/:sub', auth(true), isAdmin, (req, res) => {
  const db = req.db;
  const cat = db.data.categories.find(c => c.name === req.params.name);
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
  cat.subcategories = cat.subcategories.filter(s => s !== req.params.sub);
  db.save();
  res.json(cat);
});

// =====================================================================
// ЗАКАЗЫ
// =====================================================================
router.get('/orders', auth(true), (req, res) => {
  const db = req.db;
  const orders = req.user.isAdmin ? db.data.orders : db.data.orders.filter(o => o.createdBy === req.user.phone);
  res.json(orders);
});
router.post('/orders', auth(true), (req, res) => {
  const db = req.db;
  const b = req.body || {};
  if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ error: 'Корзина пуста' });
  const items = [];
  for (const i of b.items) {
    const p = db.data.products.find(x => x.id === i.id);
    const qty = Math.max(1, parseInt(i.qty, 10) || 1);
    if (!p || !p.inStock) return res.status(400).json({ error: `Товар недоступен: ${i.name || i.id}` });
    items.push({ id: p.id, name: p.name, price: p.price, qty });
  }
  const order = {
    id: uid('order'), date: new Date().toISOString(),
    customerName: b.customerName || req.user.name, phone: b.phone || req.user.phone,
    address: b.address || '', comment: b.comment || '',
    items, total: items.reduce((s, i) => s + i.price * i.qty, 0),
    paymentMethod: b.paymentMethod || '',
    receiptPhoto: null, receiptFileName: null, receiptSize: null,
    paymentStatus: 'Ожидает проверки', adminComment: '', status: 'Новый',
    createdBy: req.user.phone
  };
  db.data.orders.unshift(order);
  pushNotification(db, 'admin', `Новый заказ №${order.id.slice(-6)} от ${order.customerName} на сумму ${order.total} смн`);
  pushNotification(db, req.user.phone, `Ваш заказ №${order.id.slice(-6)} создан. Статус: Новый.`);
  db.save();
  res.status(201).json(order);
});
// Загрузка фото чека оплаты
router.post('/orders/:id/receipt', auth(true), upload.single('receipt'), (req, res) => {
  const db = req.db;
  const order = db.data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  if (order.createdBy !== req.user.phone && !req.user.isAdmin) return res.status(403).json({ error: 'Это не ваш заказ' });
  if (!req.file) return res.status(400).json({ error: 'Файл чека не получен' });
  order.receiptPhoto = fileUrl(req, req.file.filename);
  order.receiptFileName = req.file.originalname;
  order.receiptSize = req.file.size;
  order.paymentStatus = 'Ожидает проверки';
  pushNotification(db, 'admin', `Загружен чек по заказу №${order.id.slice(-6)}`);
  pushNotification(db, order.createdBy, `Чек по заказу №${order.id.slice(-6)} отправлен на проверку.`);
  db.save();
  res.json(order);
});
// Админ меняет статус заказа / статус оплаты / комментарий
router.patch('/orders/:id', auth(true), isAdmin, (req, res) => {
  const db = req.db;
  const order = db.data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  const b = req.body || {};
  const changes = [];
  if (b.status && b.status !== order.status) { order.status = b.status; changes.push(`статус: ${b.status}`); }
  if (b.paymentStatus && b.paymentStatus !== order.paymentStatus) { order.paymentStatus = b.paymentStatus; changes.push(`оплата: ${b.paymentStatus}`); }
  if (b.adminComment !== undefined) order.adminComment = b.adminComment;
  if (changes.length) pushNotification(db, order.createdBy, `Заказ №${order.id.slice(-6)} — ${changes.join(', ')}${b.adminComment ? '. ' + b.adminComment : ''}`);
  db.save();
  res.json(order);
});

// =====================================================================
// УВЕДОМЛЕНИЯ
// =====================================================================
function canAccess(req, target) { return req.user.isAdmin || req.user.phone === target; }
router.get('/notifications/:target', auth(true), (req, res) => {
  if (!canAccess(req, req.params.target)) return res.status(403).json({ error: 'Нет доступа' });
  res.json(req.db.data.notifications[req.params.target] || []);
});
router.post('/notifications/:target/read', auth(true), (req, res) => {
  if (!canAccess(req, req.params.target)) return res.status(403).json({ error: 'Нет доступа' });
  const db = req.db;
  (db.data.notifications[req.params.target] || []).forEach(n => n.read = true);
  db.save();
  res.json({ ok: true });
});

// =====================================================================
// СООБЩЕНИЯ (чат покупатель ↔ администратор)
// =====================================================================
router.get('/messages/:phone', auth(true), (req, res) => {
  if (!canAccess(req, req.params.phone)) return res.status(403).json({ error: 'Нет доступа' });
  res.json(req.db.data.messages[req.params.phone] || []);
});
router.post('/messages/:phone/read', auth(true), (req, res) => {
  if (!req.user.isAdmin && req.user.phone !== req.params.phone) return res.status(403).json({ error: 'Нет доступа' });
  const thread = req.db.data.messages[req.params.phone] || [];
  thread.forEach(m => { if (m.from !== 'user') m.read = true; });
  req.db.save();
  res.json({ ok: true });
});
router.post('/messages/:phone/read-admin', auth(true), isAdmin, (req, res) => {
  const thread = req.db.data.messages[req.params.phone] || [];
  thread.forEach(m => { if (m.from === 'user') m.readByAdmin = true; });
  req.db.save();
  res.json({ ok: true });
});
// Список всех диалогов (для админки)
router.get('/messages', auth(true), isAdmin, (req, res) => {
  res.json(req.db.data.messages);
});
router.post('/messages/:phone', auth(true), upload.single('image'), (req, res) => {
  if (!canAccess(req, req.params.phone)) return res.status(403).json({ error: 'Нет доступа' });
  const db = req.db;
  const phone = req.params.phone;
  if (!(req.body.text || '').trim() && !req.file) return res.status(400).json({ error: 'Пустое сообщение' });
  if (!db.data.messages[phone]) db.data.messages[phone] = [];
  const from = req.user.isAdmin ? 'admin' : 'user';
  const msg = {
    id: uid('m'), from, text: req.body.text || '',
    image: req.file ? fileUrl(req, req.file.filename) : null,
    ts: Date.now(), read: from === 'admin' ? false : true, readByAdmin: from === 'admin'
  };
  db.data.messages[phone].push(msg);

  if (from === 'user') {
    if (db.data.adminOnline) {
      pushNotification(db, 'admin', `Новое сообщение от ${req.user.name} (${phone})`);
    } else {
      db.data.messages[phone].push({
        id: uid('m'), from: 'bot',
        text: `👋 Привет, ${req.user.name.split(' ')[0]}! Меня — владельца SayaShop — сейчас нет на связи, но ваше сообщение уже у меня в списке 📋\n\n⏱️ Обычно отвечаю лично в течение нескольких часов.\n🚚 Если вопрос о доставке — загляните в «Мои заказы».\n\nСпасибо, что написали! 🙌`,
        ts: Date.now() + 1, read: false, readByAdmin: true
      });
      pushNotification(db, 'admin', `Сообщение от ${req.user.name} (${phone}) — отправлен авто-ответ (вы офлайн)`);
    }
  } else {
    pushNotification(db, phone, 'Ответ от администратора магазина');
  }
  db.save();
  res.status(201).json(msg);
});

// Статус "администратор в сети"
router.get('/admin-online', withDb, (req, res) => res.json({ online: !!req.db.data.adminOnline }));
router.post('/admin-online', auth(true), isAdmin, (req, res) => {
  req.db.data.adminOnline = !!req.body.online;
  req.db.save();
  res.json({ online: req.db.data.adminOnline });
});

// =====================================================================
// НАСТРОЙКИ ОПЛАТЫ
// =====================================================================
router.get('/payment-settings', withDb, (req, res) => res.json(req.db.data.paymentSettings));
router.put('/payment-settings', auth(true), isAdmin, (req, res) => {
  req.db.data.paymentSettings = { ...req.db.data.paymentSettings, ...req.body };
  req.db.save();
  res.json(req.db.data.paymentSettings);
});

module.exports = router;
