const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

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
        theme TEXT DEFAULT 'light',
        avatar TEXT,
        rating REAL DEFAULT 0,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        images TEXT,
        views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS profile_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_user_id INTEGER,
        from_user_id INTEGER,
        rating INTEGER,
        text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(to_user_id) REFERENCES users(id),
        FOREIGN KEY(from_user_id) REFERENCES users(id)
    )`);
});

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(__dirname));

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

// ========== API ==========
app.post('/api/register', async (req, res) => {
    const { email, password, name, phone, city, avatar } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Заполните поля' });
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (email, password, name, phone, city, avatar) VALUES (?,?,?,?,?,?)`,
        [email, hash, name || '', phone || '', city || '', avatar || null],
        function(err) {
            if (err) return res.status(400).json({ error: 'Email уже есть' });
            const token = jwt.sign({ id: this.lastID }, 'secret123', { expiresIn: '7d' });
            res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
            res.json({ success: true, user: { id: this.lastID, email, name, phone, city, avatar } });
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
        res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, phone: user.phone, city: user.city, theme: user.theme, avatar: user.avatar, rating: user.rating } });
    });
});

app.get('/api/user', auth, (req, res) => {
    db.get(`SELECT id, email, name, phone, city, theme, avatar, rating FROM users WHERE id = ?`, [req.userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(user);
    });
});

app.put('/api/user/profile', auth, (req, res) => {
    const { name, phone, city, avatar } = req.body;
    db.run(`UPDATE users SET name=?, phone=?, city=?, avatar=? WHERE id=?`, [name || '', phone || '', city || '', avatar || null, req.userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.put('/api/user/theme', auth, (req, res) => {
    db.run(`UPDATE users SET theme=? WHERE id=?`, [req.body.theme, req.userId]);
    res.json({ success: true });
});

app.get('/api/profile/:id', (req, res) => {
    const userId = req.params.id;
    db.get(`SELECT id, name, phone, city, avatar, rating, registered_at FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });
        db.all(`SELECT * FROM ads WHERE user_id = ? ORDER BY id DESC`, [userId], (err2, ads) => {
            if (err2) ads = [];
            res.json({ user, ads });
        });
    });
});

app.get('/api/profile/:id/comments', (req, res) => {
    const userId = req.params.id;
    db.all(`SELECT c.*, u.name as author_name, u.avatar as author_avatar 
            FROM profile_comments c 
            JOIN users u ON c.from_user_id = u.id 
            WHERE c.to_user_id = ? 
            ORDER BY c.created_at DESC`, [userId], (err, comments) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(comments || []);
    });
});

app.post('/api/profile/:id/comment', auth, (req, res) => {
    const toUserId = req.params.id;
    const fromUserId = req.userId;
    const { rating, text } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Оценка от 1 до 5' });
    if (!text || text.trim() === '') return res.status(400).json({ error: 'Текст комментария не может быть пустым' });
    if (parseInt(toUserId) === fromUserId) return res.status(400).json({ error: 'Нельзя оставлять комментарий самому себе' });
    
    db.run(`INSERT INTO profile_comments (to_user_id, from_user_id, rating, text) VALUES (?,?,?,?)`,
        [toUserId, fromUserId, rating, text.trim()],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            // Пересчитываем средний рейтинг
            db.get(`SELECT AVG(rating) as avg_rating FROM profile_comments WHERE to_user_id = ?`, [toUserId], (err, row) => {
                const newRating = row?.avg_rating || 0;
                db.run(`UPDATE users SET rating = ? WHERE id = ?`, [newRating, toUserId], (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    // Возвращаем обновлённого пользователя и комментарий
                    db.get(`SELECT id, name, phone, city, avatar, rating, registered_at FROM users WHERE id = ?`, [toUserId], (err3, updatedUser) => {
                        res.json({ success: true, commentId: this.lastID, user: updatedUser });
                    });
                });
            });
        });
});

app.get('/api/ads', (req, res) => {
    db.all(`SELECT * FROM ads ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(row => {
            if (row.images) {
                try { row.images = JSON.parse(row.images); } catch(e) { row.images = []; }
            } else { row.images = []; }
        });
        res.json(rows);
    });
});

app.get('/api/my-ads', auth, (req, res) => {
    db.all(`SELECT * FROM ads WHERE user_id = ? ORDER BY id DESC`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(row => {
            if (row.images) {
                try { row.images = JSON.parse(row.images); } catch(e) { row.images = []; }
            } else { row.images = []; }
        });
        res.json(rows);
    });
});

app.post('/api/ads', auth, (req, res) => {
    const { title, category, subcategory, price, phone, city, condition, description, images } = req.body;
    if (!title || !category || !price || !phone) {
        return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    const imagesJson = images && Array.isArray(images) ? JSON.stringify(images) : null;
    db.run(`INSERT INTO ads (user_id, title, category, subcategory, price, phone, city, condition, description, images) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [req.userId, title, category, subcategory, price, phone, city, condition, description, imagesJson],
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
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log('✅ Сервер запущен: http://localhost:' + PORT));