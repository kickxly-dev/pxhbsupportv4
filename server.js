const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

function parseCookies(cookieHeader) {
    const out = {};
    if (!cookieHeader) return out;
    cookieHeader.split(';').forEach((part) => {
        const [k, ...rest] = part.trim().split('=');
        if (!k) return;
        out[k] = decodeURIComponent(rest.join('=') || '');
    });
    return out;
}

const MAX_MESSAGE_TEXT = 1000;
const MAX_NAME_LEN = 40;

function safeText(input, maxLen) {
    const s = String(input == null ? '' : input);
    return s.trim().slice(0, maxLen);
}

function safeUserLabel(input) {
    const s = safeText(input, MAX_NAME_LEN);
    return s || 'User';
}

function isStaffFromCookieHeader(cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    return cookies.pxhb_staff === '1';
}

function isSecureRequest(req) {
    const proto = (req.headers['x-forwarded-proto'] || '').toString().toLowerCase();
    return req.secure || proto === 'https';
}

function setStaffCookie(res, req) {
    const secure = req && isSecureRequest(req);
    res.setHeader(
        'Set-Cookie',
        `pxhb_staff=1; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
    );
}

function clearStaffCookie(res) {
    res.setHeader('Set-Cookie', 'pxhb_staff=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
}

// Middleware
app.set('trust proxy', 1);
app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
    })
);
app.use((req, res, next) => {
    if (
        req.path === '/' ||
        req.path === '/admin' ||
        req.path.endsWith('.html') ||
        req.path.endsWith('.js') ||
        req.path.endsWith('.css')
    ) {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});
app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '20kb' }));

// Staff credentials
function loadStaffCredentials() {
    const raw = process.env.STAFF_CREDENTIALS_JSON;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (_) {}
    }

    const admin = process.env.STAFF_ADMIN_PASSWORD;
    const support = process.env.STAFF_SUPPORT_PASSWORD;
    const moderator = process.env.STAFF_MODERATOR_PASSWORD;
    const anyEnv = admin || support || moderator;
    if (anyEnv) {
        return {
            ...(admin ? { admin } : {}),
            ...(support ? { support } : {}),
            ...(moderator ? { moderator } : {})
        };
    }

    return {
        admin: 'pxhb2024',
        support: 'support123',
        moderator: 'mod456'
    };
}

const STAFF_CREDENTIALS = loadStaffCredentials();

// Store chat messages and staff status
let messages = [];
let staffStatus = { isOnline: false, user: null };
const staffSockets = new Set();

// Very small in-memory security limits
const loginAttemptsByIp = new Map();
function allowLoginAttempt(ip) {
    const now = Date.now();
    const key = String(ip || 'unknown');
    const windowMs = 60_000;
    const max = 10;
    const rec = loginAttemptsByIp.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > rec.resetAt) {
        rec.count = 0;
        rec.resetAt = now + windowMs;
    }
    rec.count += 1;
    loginAttemptsByIp.set(key, rec);
    return rec.count <= max;
}

// Real conversations (keyed by user socket id)
const conversations = new Map();

function findLastUserMessageId(conv) {
    if (!conv || !Array.isArray(conv.messages)) return null;
    for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
        const m = conv.messages[i];
        if (m && m.type === 'user' && m.id != null) return String(m.id);
    }
    return null;
}

function getConversationSummary(socketId) {
    const conv = conversations.get(socketId);
    if (!conv) return null;
    return {
        socketId,
        name: conv.name,
        connected: conv.connected,
        claimedBy: conv.claimedBy || null,
        verified: Boolean(conv.verified),
        tags: Array.isArray(conv.tags) ? conv.tags : [],
        notes: conv.notes || '',
        mutedUntil: conv.mutedUntil || null,
        banned: Boolean(conv.banned),
        lastText: conv.messages.length ? conv.messages[conv.messages.length - 1].text : '',
        lastAt: conv.messages.length ? conv.messages[conv.messages.length - 1].timestamp : null,
        unread: conv.unread
    };
}

function broadcastAdminConversations() {
    const list = Array.from(conversations.keys())
        .map(getConversationSummary)
        .filter(Boolean)
        .sort((a, b) => {
            const atA = a.lastAt ? new Date(a.lastAt).getTime() : 0;
            const atB = b.lastAt ? new Date(b.lastAt).getTime() : 0;
            return atB - atA;
        });
    io.to('admins').emit('adminConversations', list);
}

// Serve main site
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin panel
app.get('/admin', (req, res) => {
    if (!isStaffFromCookieHeader(req.headers.cookie)) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/transcript/:socketId', (req, res) => {
    if (!isStaffFromCookieHeader(req.headers.cookie)) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    const socketId = String(req.params.socketId || '').trim();
    if (!socketId) return res.status(400).json({ error: 'missing socketId' });

    const conv = conversations.get(socketId);
    if (!conv) return res.status(404).json({ error: 'not_found' });
    return res.json({ socketId, name: conv.name, messages: conv.messages || [] });
});

function openAiChatCompletion({ apiKey, messages }) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages,
            temperature: 0.4
        });

        const req = https.request(
            {
                method: 'POST',
                hostname: 'api.openai.com',
                path: '/v1/chat/completions',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            },
            (resp) => {
                let raw = '';
                resp.setEncoding('utf8');
                resp.on('data', (chunk) => {
                    raw += chunk;
                });
                resp.on('end', () => {
                    try {
                        if (resp.statusCode && resp.statusCode >= 400) {
                            return reject(new Error(`openai_http_${resp.statusCode}`));
                        }
                        const json = JSON.parse(raw || '{}');
                        const text = json?.choices?.[0]?.message?.content;
                        resolve(String(text || ''));
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function buildSmartRepliesFallback(conv) {
    const lastUser = (conv?.messages || []).slice().reverse().find((m) => (m?.type || '').toLowerCase() === 'user');
    const snippet = lastUser?.text ? String(lastUser.text).slice(0, 120) : '';
    return [
        `Thanks for reaching out${conv?.name ? `, ${conv.name}` : ''}. Can you share a bit more detail?`,
        `Got it${snippet ? ` — "${snippet}"` : ''}. What device/browser are you using?`,
        `I’m looking into this now. If you have a screenshot, please send it.`
    ];
}

app.get('/api/admin/smart-replies/:socketId', async (req, res) => {
    if (!isStaffFromCookieHeader(req.headers.cookie)) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const socketId = String(req.params.socketId || '').trim();
    if (!socketId) return res.status(400).json({ error: 'missing socketId' });
    const conv = conversations.get(socketId);
    if (!conv) return res.status(404).json({ error: 'not_found' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.json({ replies: buildSmartRepliesFallback(conv), source: 'fallback' });
    }

    try {
        const history = (conv.messages || []).slice(-12).map((m) => {
            const role = (m?.type || '').toLowerCase() === 'staff' ? 'assistant' : 'user';
            return { role, content: safeText(m?.text, 500) };
        });
        const system = {
            role: 'system',
            content:
                'You are a concise support agent. Generate exactly 3 short reply options. Return them as a JSON array of strings only.'
        };
        const content = await openAiChatCompletion({ apiKey, messages: [system, ...history] });
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch {
            parsed = null;
        }
        const replies = Array.isArray(parsed) ? parsed : buildSmartRepliesFallback(conv);
        const cleaned = replies.map((r) => safeText(r, 220)).filter(Boolean).slice(0, 3);
        return res.json({ replies: cleaned, source: Array.isArray(parsed) ? 'openai' : 'fallback' });
    } catch (err) {
        console.warn('smart replies failed', err);
        return res.json({ replies: buildSmartRepliesFallback(conv), source: 'fallback' });
    }
});

// API endpoints
const staffLoginLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false
});

app.get('/api/stats', (req, res) => {
    res.json({
        activeUsers: Math.floor(Math.random() * 20) + 5,
        totalMessages: messages.length,
        staffOnline: staffStatus.isOnline ? 1 : 0
    });
});

app.post('/api/staff/login', staffLoginLimiter, (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    if (!allowLoginAttempt(ip)) {
        return res.status(429).json({ success: false });
    }
    const { username, password } = req.body || {};
    if (STAFF_CREDENTIALS[username] && STAFF_CREDENTIALS[username] === password) {
        setStaffCookie(res, req);
        return res.json({ success: true, user: username });
    }
    return res.status(401).json({ success: false });
});

app.post('/api/staff/logout', (req, res) => {
    clearStaffCookie(res);
    return res.json({ success: true });
});

app.get('/version', (req, res) => {
    res.json({
        commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
        time: new Date().toISOString()
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    const cookieHeader = socket.handshake?.headers?.cookie;
    const isStaff = isStaffFromCookieHeader(cookieHeader);

    console.log(`${isStaff ? 'Staff' : 'User'} connected:`, socket.id);

    if (isStaff) {
        socket.join('admins');
        broadcastAdminConversations();
    } else {
        socket.join(socket.id);
        conversations.set(socket.id, {
            name: `User ${socket.id.slice(0, 6)}`,
            connected: true,
            unread: 0,
            claimedBy: null,
            verified: false,
            messages: [],
            tags: [],
            notes: '',
            mutedUntil: null,
            banned: false
        });
        broadcastAdminConversations();
    }
    
    // Send existing messages to the connected user only (privacy)
    if (!isStaff) {
        const conv = conversations.get(socket.id);
        socket.emit('loadMessages', conv?.messages || []);
    }

    // Send current staff status immediately so UI is correct on first paint
    socket.emit('staffStatusUpdate', staffStatus);
    
    // Handle new messages
    socket.on('sendMessage', (data) => {
        if (isStaff) return;

        const now = Date.now();
        if (socket.data.lastMsgAt && now - socket.data.lastMsgAt < 400) return;
        socket.data.lastMsgAt = now;

        const conv = conversations.get(socket.id);
        if (conv?.banned) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'You have been banned from chat.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }
        if (conv?.mutedUntil && Date.now() < Number(new Date(conv.mutedUntil))) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'You are currently muted. Please try again later.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }

        const text = safeText(data && data.text, MAX_MESSAGE_TEXT);
        if (!text) return;

        const message = {
            id: (data && data.id) || Date.now(),
            user: safeUserLabel(data && data.user),
            text,
            timestamp: new Date(),
            type: data.type || 'user',
            socketId: socket.id
        };
        
        messages.push(message);
        if (conv) {
            conv.messages.push(message);
            conv.unread += 1;
        }
        // Deliver only to the sender + admins
        io.to(socket.id).emit('newMessage', message);
        io.to('admins').emit('adminMessage', { socketId: socket.id, message });

        if (staffSockets.size > 0) {
            io.to(socket.id).emit('messageReceipt', {
                socketId: socket.id,
                id: message.id,
                status: 'delivered',
                at: new Date().toISOString()
            });
        }
        broadcastAdminConversations();
    });

    socket.on('setUserName', (payload) => {
        if (isStaff) return;
        const conv = conversations.get(socket.id);
        if (!conv) return;
        const next = safeText(payload && payload.name, MAX_NAME_LEN);
        if (!next) return;
        conv.name = next;
        broadcastAdminConversations();
    });

    socket.on('userTyping', (payload) => {
        if (isStaff) return;
        const now = Date.now();
        if (socket.data.lastTypingAt && now - socket.data.lastTypingAt < 120) return;
        socket.data.lastTypingAt = now;
        const isTyping = Boolean(payload && payload.isTyping);
        io.to('admins').emit('userTyping', {
            socketId: socket.id,
            isTyping,
            at: Date.now()
        });
    });

    socket.on('staffTyping', (payload) => {
        if (!isStaff) return;
        const now = Date.now();
        if (socket.data.lastStaffTypingAt && now - socket.data.lastStaffTypingAt < 120) return;
        socket.data.lastStaffTypingAt = now;

        const socketId = payload && payload.socketId;
        if (!socketId) return;
        if (!conversations.has(socketId)) return;
        const isTyping = Boolean(payload && payload.isTyping);
        io.to(socketId).emit('staffTyping', {
            socketId,
            isTyping,
            user: staffStatus.user || null,
            at: Date.now()
        });
    });

    // Admin: request conversation list
    socket.on('adminInit', () => {
        if (!isStaff) return;
        broadcastAdminConversations();
    });

    // Admin: select conversation
    socket.on('adminSelectConversation', ({ socketId }) => {
        if (!isStaff) return;
        if (!socketId || !conversations.has(socketId)) return;
        const conv = conversations.get(socketId);
        if (!conv) return;
        conv.unread = 0;
        conv.lastSeenUserMessageId = findLastUserMessageId(conv);
        socket.emit('adminConversationMessages', {
            socketId,
            name: conv.name,
            connected: conv.connected,
            messages: conv.messages
        });

        if (conv.lastSeenUserMessageId) {
            io.to(socketId).emit('messageReceipt', {
                socketId,
                lastId: conv.lastSeenUserMessageId,
                status: 'seen',
                at: new Date().toISOString()
            });
        }
        broadcastAdminConversations();
    });

    // Admin: send message to a user
    socket.on('adminSendMessage', ({ socketId, text }) => {
        if (!isStaff) return;
        const now = Date.now();
        if (socket.data.lastAdminMsgAt && now - socket.data.lastAdminMsgAt < 250) return;
        socket.data.lastAdminMsgAt = now;

        const msgText = safeText(text, MAX_MESSAGE_TEXT);
        if (!socketId || !msgText) return;
        if (!conversations.has(socketId)) return;
        const conv = conversations.get(socketId);
        if (!conv) return;
        if (conv.banned) return;
        if (!conv.claimedBy || conv.claimedBy !== staffStatus.user) {
            return;
        }

        const message = {
            id: Date.now(),
            user: staffStatus.user || 'Staff',
            text: msgText,
            timestamp: new Date(),
            type: 'staff',
            socketId
        };

        messages.push(message);
        conv.messages.push(message);

        // Send to the user
        io.to(socketId).emit('newMessage', message);

        // Update other admins
        io.to('admins').emit('adminMessage', { socketId, message });
        broadcastAdminConversations();
    });

    socket.on('adminUpdateConversation', ({ socketId, tags, notes }) => {
        if (!isStaff) return;
        if (!socketId) return;
        if (!conversations.has(socketId)) return;
        const conv = conversations.get(socketId);
        if (!conv) return;

        if (Array.isArray(tags)) {
            conv.tags = tags
                .map((t) => String(t || '').trim())
                .filter(Boolean)
                .slice(0, 20);
        }
        if (notes != null) {
            conv.notes = String(notes).slice(0, 2000);
        }
        broadcastAdminConversations();
    });

    socket.on('adminModerationAction', ({ socketId, action, durationMs }) => {
        if (!isStaff) return;
        if (!socketId) return;
        if (!conversations.has(socketId)) return;
        const conv = conversations.get(socketId);
        if (!conv) return;

        const act = String(action || '').toLowerCase();
        if (act === 'mute') {
            const ms = Math.max(0, Math.min(Number(durationMs || 0), 1000 * 60 * 60 * 24 * 7));
            conv.mutedUntil = new Date(Date.now() + ms);
        } else if (act === 'unmute') {
            conv.mutedUntil = null;
        } else if (act === 'ban') {
            conv.banned = true;
            // Disconnect the user immediately
            io.to(socketId).disconnectSockets(true);
        } else if (act === 'unban') {
            conv.banned = false;
        } else if (act === 'disconnect') {
            io.to(socketId).disconnectSockets(true);
        } else if (act === 'claim') {
            if (!conv.claimedBy) {
                conv.claimedBy = staffStatus.user || 'Staff';
            }
        } else if (act === 'unclaim') {
            if (conv.claimedBy === (staffStatus.user || 'Staff')) {
                conv.claimedBy = null;
            }
        } else if (act === 'verify') {
            conv.verified = true;
            io.to(socketId).emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'Your chat has been verified by staff.',
                timestamp: new Date(),
                type: 'system',
                socketId
            });
        } else if (act === 'unverify') {
            conv.verified = false;
        } else {
            return;
        }

        broadcastAdminConversations();
    });
    
    // Handle staff login
    socket.on('staffLogin', (data) => {
        if (STAFF_CREDENTIALS[data.username] === data.password) {
            staffStatus = { isOnline: true, user: data.username };
            staffSockets.add(socket.id);
            socket.emit('loginSuccess', { user: data.username });
            io.emit('staffStatusUpdate', staffStatus);
        } else {
            socket.emit('loginError', 'Invalid credentials');
        }
    });
    
    socket.on('disconnect', () => {
        if (isStaff) {
            staffSockets.delete(socket.id);
            if (staffSockets.size === 0 && staffStatus.isOnline) {
                staffStatus = { isOnline: false, user: null };
                io.emit('staffStatusUpdate', staffStatus);
            }
        } else {
            const conv = conversations.get(socket.id);
            if (conv) {
                conv.connected = false;
            }
            broadcastAdminConversations();
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`P.X HB Support server running on port ${PORT}`);
});
