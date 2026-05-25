const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = 3000;

const db = new sqlite3.Database('./vmig.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        name TEXT,
        phone TEXT,
        city TEXT,
        theme TEXT DEFAULT 'light'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS ads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT,
        category TEXT,
        subcategory TEXT,
        price REAL,
        phone TEXT,
        city TEXT,
        condition TEXT,
        description TEXT,
        image TEXT,
        views INTEGER DEFAULT 0
    )`);
});

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

const auth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });
    try {
        const decoded = jwt.verify(token, 'secret123');
        req.userId = decoded.id;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Ошибка' });
    }
};

app.post('/api/register', async (req, res) => {
    const { email, password, name, phone, city } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Заполните поля' });
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (email, password, name, phone, city) VALUES (?,?,?,?,?)`,
        [email, hash, name || '', phone || '', city || ''],
        function(err) {
            if (err) return res.status(400).json({ error: 'Email уже есть' });
            const token = jwt.sign({ id: this.lastID }, 'secret123', { expiresIn: '7d' });
            res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
            res.json({ success: true, user: { id: this.lastID, email, name, phone, city } });
        });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
        const token = jwt.sign({ id: user.id }, 'secret123', { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, phone: user.phone, city: user.city, theme: user.theme } });
    });
});

app.get('/api/user', auth, (req, res) => {
    db.get(`SELECT id, email, name, phone, city, theme FROM users WHERE id = ?`, [req.userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(user);
    });
});

app.put('/api/user/profile', auth, (req, res) => {
    const { name, phone, city } = req.body;
    db.run(`UPDATE users SET name=?, phone=?, city=? WHERE id=?`, [name || '', phone || '', city || '', req.userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.put('/api/user/theme', auth, (req, res) => {
    db.run(`UPDATE users SET theme=? WHERE id=?`, [req.body.theme, req.userId]);
    res.json({ success: true });
});

app.get('/api/ads', (req, res) => {
    db.all(`SELECT * FROM ads ORDER BY id DESC`, [], (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/my-ads', auth, (req, res) => {
    db.all(`SELECT * FROM ads WHERE user_id = ? ORDER BY id DESC`, [req.userId], (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/ads', auth, (req, res) => {
    const { title, category, subcategory, price, phone, city, condition, description, image } = req.body;
    db.run(`INSERT INTO ads (user_id, title, category, subcategory, price, phone, city, condition, description, image) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [req.userId, title, category, subcategory, price, phone, city, condition, description, image],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        });
});

app.delete('/api/ads/:id', auth, (req, res) => {
    db.run(`DELETE FROM ads WHERE id = ? AND user_id = ?`, [req.params.id, req.userId]);
    res.json({ success: true });
});

app.post('/api/ads/:id/view', (req, res) => {
    db.run(`UPDATE ads SET views = views + 1 WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as ads FROM ads`, [], (e, a) => {
        db.get(`SELECT COUNT(*) as users FROM users`, [], (e2, u) => {
            res.json({ ads: a?.ads || 0, users: u?.users || 0 });
        });
    });
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>В Миг - Доска объявлений</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
            padding: 20px;
            transition: background 0.3s ease;
        }
        body.dark { background: #121212; color: #e0e0e0; }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(15px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
        }
        
        .container { max-width: 1200px; margin: 0 auto; }
        
        .header {
            background: #002f34;
            color: white;
            padding: 15px 25px;
            border-radius: 16px;
            margin-bottom: 25px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 15px;
            animation: fadeIn 0.4s ease;
        }
        .logo {
            font-size: 28px;
            font-weight: bold;
            background: linear-gradient(135deg, #00d4aa, #00a896);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .logo:hover { transform: scale(1.02); }
        
        .btn {
            padding: 8px 18px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s;
        }
        .btn:hover { transform: translateY(-2px); opacity: 0.9; }
        .btn:active { transform: translateY(0); }
        .btn-primary { background: #00a896; color: white; }
        .btn-secondary { background: rgba(255,255,255,0.15); color: white; }
        .btn-chat { background: #9c27b0; color: white; }
        .btn-danger { background: #ff5252; color: white; }
        
        .card {
            background: white;
            border-radius: 20px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            transition: all 0.3s;
            animation: fadeIn 0.3s;
        }
        body.dark .card { background: #1e1e1e; }
        .card:hover { transform: translateY(-3px); box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
        .card h3 { color: #00a896; margin-bottom: 18px; }
        
        .form-group { margin-bottom: 16px; }
        label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 14px; }
        .required::after { content: " *"; color: #ff5252; }
        input, select, textarea {
            width: 100%;
            padding: 12px 14px;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            font-size: 14px;
            transition: all 0.2s;
            background: white;
        }
        body.dark input, body.dark select, body.dark textarea {
            background: #2d2d2d;
            border-color: #444;
            color: white;
        }
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: #00a896;
            box-shadow: 0 0 0 3px rgba(0,168,150,0.1);
        }
        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        
        .tabs {
            display: flex;
            gap: 8px;
            border-bottom: 2px solid #e0e0e0;
            margin-bottom: 20px;
        }
        body.dark .tabs { border-bottom-color: #333; }
        .tab {
            padding: 10px 20px;
            background: none;
            border: none;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            color: #666;
            transition: all 0.2s;
        }
        body.dark .tab { color: #aaa; }
        .tab:hover { color: #00a896; }
        .tab.active { color: #00a896; border-bottom: 3px solid #00a896; }
        .tab-content { display: none; animation: fadeIn 0.3s; }
        .tab-content.active { display: block; }
        
        .search-filters {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 15px;
        }
        .search-filters input, .search-filters select { flex: 1; min-width: 120px; }
        .price-input { width: 110px; }
        
        .ads-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 24px;
        }
        .ad-card {
            background: white;
            border-radius: 20px;
            overflow: hidden;
            cursor: pointer;
            transition: all 0.3s;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            animation: fadeIn 0.4s;
        }
        body.dark .ad-card { background: #1e1e1e; }
        .ad-card:hover { transform: translateY(-6px); box-shadow: 0 12px 28px rgba(0,0,0,0.15); }
        .ad-image {
            height: 200px;
            background: linear-gradient(135deg, #e0e0e0, #f0f0f0);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 48px;
            overflow: hidden;
        }
        .ad-card:hover .ad-image img { transform: scale(1.05); }
        .ad-image img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
        .ad-content { padding: 18px; }
        .ad-category {
            background: #00a896;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 11px;
            display: inline-block;
            margin-bottom: 10px;
        }
        .ad-subcategory {
            background: #002f34;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 11px;
            display: inline-block;
            margin-left: 6px;
        }
        .ad-title { font-size: 18px; font-weight: bold; margin: 10px 0; }
        .ad-price { font-size: 22px; color: #ff5252; font-weight: bold; margin: 8px 0; }
        .ad-meta { font-size: 12px; color: #888; margin: 8px 0; display: flex; gap: 12px; }
        .ad-phone { color: #00a896; font-weight: 600; margin: 8px 0; }
        
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(4px);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .modal.active { display: flex; }
        .modal-content {
            background: white;
            border-radius: 28px;
            padding: 28px;
            max-width: 500px;
            width: 90%;
            max-height: 85vh;
            overflow-y: auto;
            animation: fadeIn 0.3s;
        }
        body.dark .modal-content { background: #1e1e1e; }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .close {
            font-size: 28px;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .close:hover { transform: rotate(90deg); }
        
        .chat-messages {
            height: 320px;
            overflow-y: auto;
            border: 1px solid #e0e0e0;
            border-radius: 16px;
            padding: 15px;
            margin-bottom: 15px;
            background: #fafafa;
        }
        body.dark .chat-messages { background: #2d2d2d; border-color: #444; }
        .chat-message {
            margin-bottom: 12px;
            display: flex;
            flex-direction: column;
            animation: fadeIn 0.2s;
        }
        .chat-message.user { align-items: flex-end; }
        .chat-message.bot { align-items: flex-start; }
        .message-bubble {
            padding: 10px 16px;
            border-radius: 20px;
            max-width: 80%;
            font-size: 14px;
        }
        .chat-message.user .message-bubble {
            background: #00a896;
            color: white;
            border-radius: 20px 20px 4px 20px;
        }
        .chat-message.bot .message-bubble {
            background: #e0e0e0;
            color: #333;
            border-radius: 20px 20px 20px 4px;
        }
        body.dark .chat-message.bot .message-bubble { background: #444; color: white; }
        .chat-input { display: flex; gap: 10px; }
        .chat-input input { flex: 1; border-radius: 24px; }
        
        .empty { text-align: center; padding: 50px; color: #888; }
        .about-section { text-align: center; padding: 30px; margin-top: 30px; border-radius: 20px; background: white; }
        body.dark .about-section { background: #1e1e1e; }
        .stats { display: flex; justify-content: center; gap: 40px; margin: 20px 0; }
        .stat-number { font-size: 32px; font-weight: bold; color: #00a896; }
        
        @media (max-width: 768px) {
            body { padding: 12px; }
            .row { grid-template-columns: 1fr; }
            .ads-grid { grid-template-columns: 1fr; }
            .search-filters { flex-direction: column; }
            .price-input { width: 100%; }
        }
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <div class="logo" onclick="location.reload()">В МИГ</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button class="btn btn-chat" id="chatBtn">💬 Чат</button>
            <button class="btn btn-secondary" id="aboutBtn">📖 О нас</button>
            <button class="btn btn-secondary" id="themeBtn">🌓 Тема</button>
            <button class="btn btn-primary" id="authBtn">🔐 Войти</button>
            <button class="btn btn-secondary" id="userBtn" style="display:none">👤 Профиль</button>
        </div>
    </div>

    <div style="display: flex; gap: 24px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 300px;">
            <div class="card">
                <h3>📢 Создать объявление</h3>
                <form id="adForm">
                    <div class="form-group"><label class="required">Категория</label><select id="category" required><option value="">Выберите</option><option value="electronics">📱 Электроника</option><option value="appliances">🔌 Техника</option><option value="furniture">🪑 Мебель</option><option value="clothing">👕 Одежда</option><option value="realestate">🏠 Недвижимость</option><option value="auto">🚗 Авто</option><option value="other">📦 Другое</option></select></div>
                    <div class="form-group" id="subGroup" style="display:none"><label>Подкатегория</label><select id="subcategory"></select></div>
                    <div class="form-group"><label class="required">Название</label><input type="text" id="title" required></div>
                    <div class="row"><div class="form-group"><label class="required">Цена</label><input type="number" id="price" required></div><div class="form-group"><label class="required">Телефон</label><input type="text" id="phone" required></div></div>
                    <div class="row"><div class="form-group"><label>Город</label><input type="text" id="city"></div><div class="form-group"><label>Состояние</label><select id="condition"><option value="new">🆕 Новое</option><option value="used">🔄 Б/у</option></select></div></div>
                    <div class="form-group"><label>Описание</label><textarea id="description" rows="3"></textarea></div>
                    <div class="form-group"><label>Фото</label><input type="file" id="imageFile" accept="image/*"></div>
                    <button type="submit" class="btn btn-primary" style="width:100%">📢 Опубликовать</button>
                </form>
            </div>
            
            <div class="card">
                <div class="tabs">
                    <button class="tab active" data-tab="all">📋 Все</button>
                    <button class="tab" data-tab="my">👤 Мои</button>
                    <button class="tab" data-tab="settings">⚙️ Настройки</button>
                </div>
                <div id="allTab" class="tab-content active">
                    <div class="search-filters">
                        <input type="text" id="searchInput" placeholder="🔍 Поиск...">
                        <select id="searchCat"><option value="">Все</option><option value="electronics">Электроника</option><option value="appliances">Техника</option><option value="furniture">Мебель</option><option value="clothing">Одежда</option><option value="realestate">Недвижимость</option><option value="auto">Авто</option></select>
                        <select id="searchSort"><option value="date">По дате</option><option value="price_asc">Цена ↑</option><option value="price_desc">Цена ↓</option></select>
                    </div>
                    <div class="search-filters">
                        <input type="text" class="price-input" id="minPrice" placeholder="Цена от">
                        <input type="text" class="price-input" id="maxPrice" placeholder="Цена до">
                        <input type="text" id="searchCity" placeholder="🏙️ Город">
                        <select id="searchCondition"><option value="">Любое</option><option value="new">Новое</option><option value="used">Б/у</option></select>
                    </div>
                </div>
                <div id="myTab" class="tab-content"><div id="myAdsList"></div></div>
                <div id="settingsTab" class="tab-content">
                    <form id="profileForm">
                        <div class="form-group"><label>Имя</label><input type="text" id="profileName" placeholder="Ваше имя"></div>
                        <div class="form-group"><label>Город</label><input type="text" id="profileCity" placeholder="Ваш город"></div>
                        <div class="form-group"><label>Телефон</label><input type="text" id="profilePhone" placeholder="+7 (999) 123-45-67"></div>
                        <button type="submit" class="btn btn-primary" style="width:100%">💾 Сохранить</button>
                    </form>
                </div>
            </div>
        </div>
        
        <div style="flex: 2; min-width: 300px;">
            <div class="ads-grid" id="adsList"><div class="empty">📭 Загрузка...</div></div>
            <div id="aboutSection" style="display:none; text-align:center; padding:30px;">
                <div class="stats"><div class="stat"><div class="stat-number" id="totalAds">0</div><div>Объявлений</div></div><div class="stat"><div class="stat-number" id="totalUsers">0</div><div>Пользователей</div></div></div>
                <p>📞 +7 (996) 630-05-60 | 📧 support@vmig.ru</p>
            </div>
        </div>
    </div>
</div>

<div class="modal" id="authModal"><div class="modal-content"><div class="modal-header"><h2>🔐 Вход</h2><span class="close" id="closeAuth">&times;</span></div><div style="display:flex; gap:12px; margin-bottom:20px"><button id="showLogin" class="btn btn-primary" style="flex:1">Вход</button><button id="showRegister" class="btn btn-secondary" style="flex:1">Регистрация</button></div><form id="loginForm"><div class="form-group"><label>Email</label><input type="email" id="loginEmail" required></div><div class="form-group"><label>Пароль</label><input type="password" id="loginPassword" required></div><button type="submit" class="btn btn-primary" style="width:100%">🚀 Войти</button></form><form id="registerForm" style="display:none"><div class="form-group"><label>Имя</label><input type="text" id="regName"></div><div class="form-group"><label>Email</label><input type="email" id="regEmail" required></div><div class="form-group"><label>Телефон</label><input type="text" id="regPhone"></div><div class="form-group"><label>Город</label><input type="text" id="regCity"></div><div class="form-group"><label>Пароль</label><input type="password" id="regPassword" required minlength="6"></div><button type="submit" class="btn btn-primary" style="width:100%">✨ Зарегистрироваться</button></form></div></div>

<div class="modal" id="chatModal"><div class="modal-content"><div class="modal-header"><h3>🤖 Поддержка</h3><span class="close" id="closeChat">&times;</span></div><div class="chat-messages" id="chatMessages"><div class="chat-message bot"><div class="message-bubble">👋 Привет! Я чат-помощник. Чем помочь?</div></div></div><div class="chat-input"><input type="text" id="chatInput" placeholder="Напишите вопрос..."><button id="sendChat" class="btn btn-primary">📤</button></div></div></div>

<script>
const subs = {
    electronics: ["Смартфоны", "Ноутбуки", "Телевизоры", "Аксессуары"],
    appliances: ["Холодильники", "Стиральные машины", "Микроволновки", "Пылесосы"],
    furniture: ["Диваны", "Кровати", "Столы", "Шкафы"],
    clothing: ["Мужская", "Женская", "Детская", "Обувь"],
    realestate: ["Квартиры", "Дома", "Участки", "Коммерческая"],
    auto: ["Легковые", "Грузовые", "Мотоциклы", "Запчасти"],
    other: ["Разное", "Услуги", "Билеты"]
};

let currentUser = null;
let allAds = [];

function escape(t){if(!t)return '';return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function catName(c){return{electronics:'📱 Электроника',appliances:'🔌 Техника',furniture:'🪑 Мебель',clothing:'👕 Одежда',realestate:'🏠 Недвижимость',auto:'🚗 Авто',other:'📦 Другое'}[c]||c;}
function renderAd(ad){
    return '<div class="ad-card" data-id="'+ad.id+'"><div class="ad-image">'+(ad.image?'<img src="'+ad.image+'">':'📷')+'</div><div class="ad-content"><span class="ad-category">'+catName(ad.category)+'</span>'+(ad.subcategory?'<span class="ad-subcategory">'+escape(ad.subcategory)+'</span>':'')+'<div class="ad-title">'+escape(ad.title)+'</div><div class="ad-price">'+Number(ad.price).toLocaleString()+' ₽</div><div class="ad-meta"><span>👁️ '+(ad.views||0)+'</span><span>📍 '+(ad.city||'Не указан')+'</span></div><div class="ad-phone">📞 '+escape(ad.phone)+'</div>'+(ad.description?'<div style="font-size:13px;color:#888;margin-top:8px">'+escape(ad.description.substring(0,80))+'</div>':'')+(currentUser&&ad.user_id===currentUser.id?'<button class="btn btn-danger" style="width:100%;margin-top:12px" onclick="event.stopPropagation();deleteAd('+ad.id+')">🗑️ Удалить</button>':'')+'</div></div>';
}
async function loadAds(){const r=await fetch('/api/ads');allAds=await r.json();const c=document.getElementById('adsList');if(!allAds.length){c.innerHTML='<div class="empty">📭 Пока нет объявлений</div>';return;}c.innerHTML=allAds.map(a=>renderAd(a)).join('');}
async function loadMyAds(){if(!currentUser)return;const r=await fetch('/api/my-ads');const a=await r.json();const c=document.getElementById('myAdsList');if(!a.length){c.innerHTML='<div class="empty">📭 У вас пока нет объявлений</div>';return;}c.innerHTML=a.map(ad=>renderAd(ad)).join('');}
function filterAds(){
    let s=document.getElementById('searchInput').value.toLowerCase();
    let cat=document.getElementById('searchCat').value;
    let sort=document.getElementById('searchSort').value;
    let min=parseFloat(document.getElementById('minPrice').value)||0;
    let max=parseFloat(document.getElementById('maxPrice').value)||Infinity;
    let city=document.getElementById('searchCity').value.toLowerCase();
    let cond=document.getElementById('searchCondition').value;
    let f=allAds.filter(ad=>{
        if(s&&!ad.title.toLowerCase().includes(s)&&!(ad.description||'').toLowerCase().includes(s))return false;
        if(cat&&ad.category!==cat)return false;
        if(min&&ad.price<min)return false;
        if(max!==Infinity&&ad.price>max)return false;
        if(city&&!(ad.city||'').toLowerCase().includes(city))return false;
        if(cond&&ad.condition!==cond)return false;
        return true;
    });
    if(sort==='price_asc')f.sort((a,b)=>a.price-b.price);
    else if(sort==='price_desc')f.sort((a,b)=>b.price-a.price);
    else f.sort((a,b)=>b.id-a.id);
    const c=document.getElementById('adsList');
    if(!f.length){c.innerHTML='<div class="empty">🔍 Ничего не найдено</div>';return;}
    c.innerHTML=f.map(ad=>renderAd(ad)).join('');
}
async function deleteAd(id){if(!confirm('🗑️ Удалить объявление?'))return;await fetch('/api/ads/'+id,{method:'DELETE'});await loadAds();if(currentUser)await loadMyAds();alert('✅ Объявление удалено');}
async function checkAuth(){try{const r=await fetch('/api/user');if(r.ok){currentUser=await r.json();document.getElementById('authBtn').style.display='none';document.getElementById('userBtn').style.display='inline-block';document.getElementById('userBtn').textContent='👤 '+(currentUser.name||currentUser.email);if(currentUser.theme==='dark')document.body.classList.add('dark');document.getElementById('profileName').value=currentUser.name||'';document.getElementById('profileCity').value=currentUser.city||'';document.getElementById('profilePhone').value=currentUser.phone||'';await loadMyAds();}}catch(e){}}
function updateSub(){const cat=document.getElementById('category').value;const g=document.getElementById('subGroup');const s=document.getElementById('subcategory');if(cat&&subs[cat]){let opts='<option value="">Выберите подкатегорию</option>';for(let i=0;i<subs[cat].length;i++)opts+='<option value="'+subs[cat][i]+'">'+subs[cat][i]+'</option>';s.innerHTML=opts;g.style.display='block';}else{g.style.display='none';}}

// ИНИЦИАЛИЗАЦИЯ ВСЕХ ОБРАБОТЧИКОВ
document.getElementById('category')?.addEventListener('change', updateSub);

document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(tab === 'all' ? 'allTab' : (tab === 'my' ? 'myTab' : 'settingsTab')).classList.add('active');
        if (tab === 'my' && currentUser) loadMyAds();
        if (tab === 'all') filterAds();
    });
});

document.getElementById('aboutBtn')?.addEventListener('click', async () => {
    const about = document.getElementById('aboutSection');
    about.style.display = about.style.display === 'none' ? 'block' : 'none';
    if (about.style.display === 'block') {
        const res = await fetch('/api/stats');
        const stats = await res.json();
        document.getElementById('totalAds').textContent = stats.ads;
        document.getElementById('totalUsers').textContent = stats.users;
    }
});

document.getElementById('themeBtn')?.addEventListener('click', async () => {
    if (!currentUser) { alert('Авторизуйтесь для смены темы'); return; }
    const isDark = document.body.classList.contains('dark');
    const newTheme = isDark ? 'light' : 'dark';
    if (newTheme === 'dark') document.body.classList.add('dark');
    else document.body.classList.remove('dark');
    await fetch('/api/user/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: newTheme }) });
});

document.getElementById('chatBtn')?.addEventListener('click', () => document.getElementById('chatModal').classList.add('active'));
document.getElementById('closeChat')?.addEventListener('click', () => document.getElementById('chatModal').classList.remove('active'));
document.getElementById('sendChat')?.addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    const container = document.getElementById('chatMessages');
    container.innerHTML += '<div class="chat-message user"><div class="message-bubble">' + escape(msg) + '</div></div>';
    input.value = '';
    setTimeout(() => {
        let reply = '';
        const m = msg.toLowerCase();
        if (m.includes('привет')) reply = '👋 Здравствуйте! Чем могу помочь?';
        else if (m.includes('объявление')) reply = '📝 Чтобы выложить объявление: 1) Авторизуйтесь 2) Заполните форму слева 3) Нажмите "Опубликовать"';
        else if (m.includes('регистр')) reply = '📝 Нажмите "Войти" → "Регистрация", заполните поля';
        else if (m.includes('удалить')) reply = '🗑️ Перейдите в "Мои объявления" и нажмите "Удалить"';
        else reply = '🤔 Я чат-помощник. Напишите "объявление", "регистрация" или "удалить"';
        container.innerHTML += '<div class="chat-message bot"><div class="message-bubble">' + reply + '</div></div>';
        container.scrollTop = container.scrollHeight;
    }, 500);
    container.scrollTop = container.scrollHeight;
});

document.getElementById('authBtn')?.addEventListener('click', () => document.getElementById('authModal').classList.add('active'));
document.getElementById('closeAuth')?.addEventListener('click', () => document.getElementById('authModal').classList.remove('active'));
document.getElementById('userBtn')?.addEventListener('click', () => document.querySelector('.tab[data-tab="settings"]').click());

document.getElementById('showLogin')?.addEventListener('click', () => {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
});
document.getElementById('showRegister')?.addEventListener('click', () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
});

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value })
    });
    if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        document.getElementById('authModal').classList.remove('active');
        document.getElementById('authBtn').style.display = 'none';
        document.getElementById('userBtn').style.display = 'inline-block';
        document.getElementById('userBtn').textContent = '👤 ' + (currentUser.name || currentUser.email);
        if (currentUser.theme === 'dark') document.body.classList.add('dark');
        document.getElementById('profileName').value = currentUser.name || '';
        document.getElementById('profileCity').value = currentUser.city || '';
        document.getElementById('profilePhone').value = currentUser.phone || '';
        await loadMyAds();
        alert('✅ Вход выполнен');
    } else alert('❌ Неверный email или пароль');
});

document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('regName').value,
            email: document.getElementById('regEmail').value,
            phone: document.getElementById('regPhone').value,
            city: document.getElementById('regCity').value,
            password: document.getElementById('regPassword').value
        })
    });
    if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        document.getElementById('authModal').classList.remove('active');
        document.getElementById('authBtn').style.display = 'none';
        document.getElementById('userBtn').style.display = 'inline-block';
        document.getElementById('userBtn').textContent = '👤 ' + (currentUser.name || currentUser.email);
        alert('✅ Регистрация успешна');
    } else alert('❌ Ошибка регистрации');
});

document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('profileName').value,
            city: document.getElementById('profileCity').value,
            phone: document.getElementById('profilePhone').value
        })
    });
    currentUser.name = document.getElementById('profileName').value;
    document.getElementById('userBtn').textContent = '👤 ' + (currentUser.name || currentUser.email);
    alert('✅ Настройки сохранены');
});

document.getElementById('adForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) { alert('Авторизуйтесь'); return; }
    let img = null;
    const file = document.getElementById('imageFile').files[0];
    if (file) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        await new Promise(resolve => reader.onload = () => { img = reader.result; resolve(); });
    }
    const data = {
        title: document.getElementById('title').value,
        category: document.getElementById('category').value,
        subcategory: document.getElementById('subcategory').value || '',
        price: document.getElementById('price').value,
        phone: document.getElementById('phone').value,
        city: document.getElementById('city').value,
        condition: document.getElementById('condition').value,
        description: document.getElementById('description').value,
        image: img
    };
    const res = await fetch('/api/ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (res.ok) {
        alert('✅ Объявление опубликовано');
        document.getElementById('adForm').reset();
        document.getElementById('subGroup').style.display = 'none';
        await loadAds();
        if (currentUser) await loadMyAds();
    } else alert('❌ Ошибка');
});

document.getElementById('searchInput')?.addEventListener('input', filterAds);
document.getElementById('searchCat')?.addEventListener('change', filterAds);
document.getElementById('searchSort')?.addEventListener('change', filterAds);
document.getElementById('minPrice')?.addEventListener('input', filterAds);
document.getElementById('maxPrice')?.addEventListener('input', filterAds);
document.getElementById('searchCity')?.addEventListener('input', filterAds);
document.getElementById('searchCondition')?.addEventListener('change', filterAds);

// Добавляем просмотры при клике на карточку
document.addEventListener('click', (e) => {
    const card = e.target.closest('.ad-card');
    if (card && !e.target.closest('button')) {
        const id = card.getAttribute('data-id');
        if (id) fetch('/api/ads/' + id + '/view', { method: 'POST' });
    }
});

loadAds();
checkAuth();
window.deleteAd = deleteAd;
</script>
</body>
</html>`);
});

app.listen(PORT, () => console.log('✅ Сервер запущен: http://localhost:' + PORT));