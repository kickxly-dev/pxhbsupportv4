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

function broadcastLockdown() {
    io.emit('lockdownUpdate', lockdownState);
}

const MAX_MESSAGE_TEXT = 1000;
const MAX_NAME_LEN = 40;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_LEN = 8_500_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_DATA_URL_LEN = 17_000_000;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function discordPost(payload) {
    if (!DISCORD_WEBHOOK_URL) return;
    try {
        const url = new URL(DISCORD_WEBHOOK_URL);
        const body = Buffer.from(JSON.stringify(payload || {}));

        const req = https.request(
            {
                method: 'POST',
                hostname: url.hostname,
                path: `${url.pathname}${url.search || ''}`,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': body.length
                },
                timeout: 2500
            },
            (res) => {
                res.on('data', () => {});
                res.on('end', () => {});
            }
        );

        req.on('timeout', () => req.destroy());
        req.on('error', () => {});
        req.write(body);
        req.end();
    } catch {
        // ignore
    }
}

function discordNotify(title, lines) {
    if (!DISCORD_WEBHOOK_URL) return;
    const content = [title, ...(Array.isArray(lines) ? lines : [])].filter(Boolean).join('\n');
    discordPost({ content: String(content).slice(0, 1900) });
}

function openAiPostJson(bodyObj) {
    return new Promise((resolve, reject) => {
        if (!OPENAI_API_KEY) {
            reject(new Error('Missing OPENAI_API_KEY'));
            return;
        }

        const body = Buffer.from(JSON.stringify(bodyObj || {}));
        const req = https.request(
            {
                method: 'POST',
                hostname: 'api.openai.com',
                path: '/v1/chat/completions',
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Content-Length': body.length
                },
                timeout: 12_000
            },
            (res) => {
                let raw = '';
                res.on('data', (d) => {
                    raw += String(d);
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(raw || '{}');
                        resolve({ status: res.statusCode || 0, data: parsed });
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e) => reject(e));
        req.write(body);
        req.end();
    });
}

function extractJsonObject(text) {
    const s = String(text || '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const candidate = s.slice(start, end + 1);
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function safeText(input, maxLen) {
    const s = String(input == null ? '' : input);
    return s.trim().slice(0, maxLen);
}

function safeUserLabel(input) {
    const s = safeText(input, MAX_NAME_LEN);
    return s || 'User';
}

function safeEnum(input, allowed, fallback) {
    const s = String(input == null ? '' : input).toLowerCase();
    return allowed.includes(s) ? s : fallback;
}

function isStaffFromCookieHeader(cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    return cookies.pxhb_staff === '1';
}

function isAdminSocketHandshake(socket) {
    const ref = (socket && socket.handshake && socket.handshake.headers && socket.handshake.headers.referer) || '';
    const authAdmin = Boolean(socket && socket.handshake && socket.handshake.auth && socket.handshake.auth.admin);
    try {
        const isAdminRef = String(ref).includes('/admin');
        return authAdmin || isAdminRef;
    } catch {
        return false;
    }
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

let lockdownState = { enabled: false, by: null, at: null, reason: null };

let auditLog = [];

function pushAudit(entry) {
    try {
        const e = entry || {};
        const item = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            at: new Date().toISOString(),
            ...e
        };
        auditLog.push(item);
        if (auditLog.length > 250) auditLog = auditLog.slice(-250);
        io.to('admins').emit('adminAuditLogEntry', item);
    } catch {
        // ignore
    }
}

function nowIso() {
    return new Date().toISOString();
}

function antiAbuseState(socket) {
    if (!socket.data.antiAbuse) {
        socket.data.antiAbuse = {
            msgTimes: [],
            imgTimes: [],
            strikes: 0,
            slowUntil: 0,
            slowMs: 0,
            lastWarnAt: 0,
            lastActionAt: 0
        };
    }
    return socket.data.antiAbuse;
}

function recordAndCheckRate({ socket, kind }) {
    const s = antiAbuseState(socket);
    const now = Date.now();
    const windowMs = 10_000;
    const max = kind === 'image' ? 3 : 7;
    const arr = kind === 'image' ? s.imgTimes : s.msgTimes;
    arr.push(now);
    while (arr.length && now - arr[0] > windowMs) arr.shift();

    if (s.slowUntil && now < s.slowUntil) {
        if (s.lastActionAt && now - s.lastActionAt < s.slowMs) {
            return { ok: false, reason: 'slowmode' };
        }
    }
    s.lastActionAt = now;

    if (arr.length <= max) {
        return { ok: true };
    }

    s.strikes += 1;

    if (s.strikes === 1) {
        return { ok: false, reason: 'warn' };
    }

    if (s.strikes === 2) {
        s.slowMs = 1800;
        s.slowUntil = now + 45_000;
        return { ok: false, reason: 'slowmode_on' };
    }

    return { ok: false, reason: 'mute' };
}

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

let nextTicketNumber = 1000;
const tickets = new Map();

function ensureTicketForConversation(socketId) {
    const conv = conversations.get(socketId);
    if (!conv) return null;
    if (conv.ticketId && tickets.has(conv.ticketId)) return tickets.get(conv.ticketId);

    const id = `T-${nextTicketNumber++}`;
    const ticket = {
        id,
        socketId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'open',
        priority: 'normal',
        assignee: null,
        claim: null,
        form: null,
        evidence: []
    };
    tickets.set(id, ticket);
    conv.ticketId = id;

    discordNotify('🎫 New ticket created', [
        `**Ticket:** ${id}`,
        `**User:** ${conv.name || socketId}`,
        ticket.form?.issue ? `**Issue:** ${ticket.form.issue}` : null,
        ticket.priority ? `**Priority:** ${ticket.priority}` : null
    ]);

    return ticket;
}

function getTicketSummary(ticket) {
    if (!ticket) return null;
    const conv = conversations.get(ticket.socketId);
    return {
        id: ticket.id,
        socketId: ticket.socketId,
        status: ticket.status,
        priority: ticket.priority,
        assignee: ticket.assignee,
        claim: ticket.claim || null,
        form: ticket.form || null,
        ai: ticket.ai || null,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        agentView: conv?.clientMeta
            ? {
                  path: conv.clientMeta.path || null,
                  ua: conv.clientMeta.ua || null,
                  at: conv.clientMeta.at || null
              }
            : null,
        online: Boolean(conv?.connected),
        lastSeenAt: conv?.lastSeenAt || null,
        name: conv?.name || null,
        lastText: conv?.messages?.length ? conv.messages[conv.messages.length - 1].text : '',
        lastAt: conv?.messages?.length ? conv.messages[conv.messages.length - 1].timestamp : null,
        unread: conv?.unread || 0
        ,
        evidenceCount: Array.isArray(ticket.evidence) ? ticket.evidence.length : 0
    };
}

function broadcastAdminTickets() {
    const list = Array.from(tickets.values())
        .map(getTicketSummary)
        .filter(Boolean)
        .sort((a, b) => {
            const atA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const atB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return atB - atA;
        });
    io.to('admins').emit('adminTickets', list);
}

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
    const ticket = conv.ticketId ? tickets.get(conv.ticketId) : null;
    return {
        socketId,
        name: conv.name,
        connected: conv.connected,
        tags: Array.isArray(conv.tags) ? conv.tags : [],
        notes: conv.notes || '',
        mutedUntil: conv.mutedUntil || null,
        banned: Boolean(conv.banned),
        verified: Boolean(conv.verified),
        guidance: conv.guidance || { enabled: false },
        guardrails: conv.guardrails || { attachments: true, cooldownMs: 0, requireVerified: false },
        guidedFix: conv.guidedFix
            ? {
                  id: conv.guidedFix.id,
                  title: conv.guidedFix.title || null,
                  total: Array.isArray(conv.guidedFix.steps) ? conv.guidedFix.steps.length : 0,
                  done: Array.isArray(conv.guidedFix.steps) ? conv.guidedFix.steps.filter((s) => s && s.done).length : 0,
                  at: conv.guidedFix.at || null
              }
            : null,
        ticket: ticket
            ? {
                  id: ticket.id,
                  status: ticket.status,
                  priority: ticket.priority,
                  assignee: ticket.assignee,
                  claim: ticket.claim || null,
                  form: ticket.form || null,
                  createdAt: ticket.createdAt,
                  updatedAt: ticket.updatedAt
              }
            : null,
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
    broadcastAdminTickets();
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
    const isStaff = isStaffFromCookieHeader(cookieHeader) && isAdminSocketHandshake(socket);

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
            messages: [],
            tags: [],
            notes: '',
            mutedUntil: null,
            banned: false,
            verified: false,
            verifyChallenge: null,
            lastSeenAt: new Date().toISOString(),
            clientMeta: null,
            liveAssist: { enabled: false },
            guidance: { enabled: false },
            guardrails: { attachments: true, cooldownMs: 0, requireVerified: false },
            guidedFix: null,
            ticketId: null
        });
        broadcastAdminConversations();
    }
    
    // Send existing messages to the connected user only (privacy)
    if (!isStaff) {
        const conv = conversations.get(socket.id);
        if (conv) {
            conv.lastSeenAt = new Date().toISOString();
            ensureTicketForConversation(socket.id);
        }
        socket.emit('loadMessages', conv?.messages || []);

        if (conv?.guardrails) {
            socket.emit('guardrailsUpdate', conv.guardrails);
        }

        if (conv?.guidance?.enabled && conv?.guidedFix) {
            socket.emit('guidanceFixState', {
                enabled: true,
                id: conv.guidedFix.id,
                title: conv.guidedFix.title || null,
                steps: Array.isArray(conv.guidedFix.steps) ? conv.guidedFix.steps : []
            });
        }
    }

    // Send current staff status immediately so UI is correct on first paint
    socket.emit('staffStatusUpdate', staffStatus);

    socket.emit('lockdownUpdate', lockdownState);
    
    // Handle new messages
    socket.on('sendMessage', (data) => {
        if (isStaff) return;

        if (lockdownState.enabled) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'Chat is temporarily locked by staff. Please try again soon.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }

        const now = Date.now();
        if (socket.data.lastMsgAt && now - socket.data.lastMsgAt < 200) return;
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

        if (conv?.guardrails?.requireVerified && !conv.verified) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'Verification required before you can chat. Please complete verification.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }

        const cooldown = Number(conv?.guardrails?.cooldownMs || 0);
        if (Number.isFinite(cooldown) && cooldown > 0) {
            const lastAt = Number(socket.data.lastGuardMsgAt || 0);
            const now2 = Date.now();
            if (lastAt && now2 - lastAt < cooldown) {
                socket.emit('newMessage', {
                    id: Date.now(),
                    user: 'System',
                    text: `Slowmode is active. Please wait ${Math.ceil((cooldown - (now2 - lastAt)) / 1000)}s.`,
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                });
                return;
            }
            socket.data.lastGuardMsgAt = now2;
        }

        const limit = recordAndCheckRate({ socket, kind: 'message' });
        if (!limit.ok) {
            if (limit.reason === 'warn') {
                socket.emit('newMessage', {
                    id: Date.now(),
                    user: 'System',
                    text: 'Slow down — you are sending messages too fast. Next time will enable slowmode.',
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                });
                pushAudit({
                    type: 'antiabuse',
                    action: 'warn',
                    socketId: socket.id,
                    by: 'system',
                    details: { kind: 'message' }
                });
            } else if (limit.reason === 'slowmode' || limit.reason === 'slowmode_on') {
                socket.emit('newMessage', {
                    id: Date.now(),
                    user: 'System',
                    text: 'Slowmode is active. Please wait a moment between messages.',
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                });
                if (limit.reason === 'slowmode_on') {
                    pushAudit({
                        type: 'antiabuse',
                        action: 'slowmode_on',
                        socketId: socket.id,
                        by: 'system',
                        details: { kind: 'message', until: nowIso() }
                    });
                }
            } else if (limit.reason === 'mute') {
                const ms = 5 * 60 * 1000;
                conv.mutedUntil = new Date(Date.now() + ms);
                socket.emit('newMessage', {
                    id: Date.now(),
                    user: 'System',
                    text: 'You were temporarily muted for spamming. Please try again in a few minutes.',
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                });
                pushAudit({
                    type: 'antiabuse',
                    action: 'auto_mute',
                    socketId: socket.id,
                    by: 'system',
                    details: { minutes: 5, kind: 'message' }
                });
                broadcastAdminConversations();
            }
            return;
        }

        const text = safeText(data && data.text, MAX_MESSAGE_TEXT);
        if (!text) return;

        if (conv && conv.verifyChallenge && !conv.verified) {
            const expected = String(conv.verifyChallenge.code || '').toLowerCase();
            const got = String(text || '').trim().toLowerCase();
            if (expected && got === expected) {
                conv.verified = true;
                conv.verifyChallenge = null;

                const sys = {
                    id: Date.now(),
                    user: 'System',
                    text: 'Verification successful. Thank you!',
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                };
                messages.push(sys);
                conv.messages.push(sys);
                io.to(socket.id).emit('newMessage', sys);
                io.to('admins').emit('adminMessage', { socketId: socket.id, message: sys });
                broadcastAdminConversations();
            }
        }

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

        const t = conv?.ticketId ? tickets.get(conv.ticketId) : null;
        discordNotify('💬 User message', [
            t?.id ? `**Ticket:** ${t.id}` : `**Socket:** ${socket.id}`,
            `**User:** ${safeUserLabel(data && data.user)}`,
            `**Text:** ${text}`
        ]);
    });

    socket.on('sendImage', (payload) => {
        if (isStaff) return;

        if (lockdownState.enabled) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'Chat is temporarily locked by staff. Please try again soon.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }
        const conv = conversations.get(socket.id);
        if (!conv) return;
        if (conv.banned) return;
        if (conv.mutedUntil && Date.now() < Number(new Date(conv.mutedUntil))) return;

        if (conv?.guardrails?.requireVerified && !conv.verified) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'Verification required before you can upload.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }

        if (conv?.guardrails && conv.guardrails.attachments === false) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'Attachments are temporarily disabled for this chat.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }

        const cooldown = Number(conv?.guardrails?.cooldownMs || 0);
        if (Number.isFinite(cooldown) && cooldown > 0) {
            const lastAt = Number(socket.data.lastGuardUploadAt || 0);
            const now = Date.now();
            if (lastAt && now - lastAt < cooldown) {
                socket.emit('newMessage', {
                    id: Date.now(),
                    user: 'System',
                    text: `Slowmode is active. Please wait ${Math.ceil((cooldown - (now - lastAt)) / 1000)}s before uploading again.`,
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                });
                return;
            }
            socket.data.lastGuardUploadAt = now;
        }

        const limit = recordAndCheckRate({ socket, kind: 'image' });
        if (!limit.ok) {
            if (limit.reason === 'warn') {
                socket.emit('newMessage', {
                    id: Date.now(),
                    user: 'System',
                    text: 'Slow down — you are uploading too fast. Next time will enable slowmode.',
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                });
                pushAudit({
                    type: 'antiabuse',
                    action: 'warn',
                    socketId: socket.id,
                    by: 'system',
                    details: { kind: 'image' }
                });
            } else if (limit.reason === 'slowmode' || limit.reason === 'slowmode_on') {
                socket.emit('newMessage', {
                    id: Date.now(),
                    user: 'System',
                    text: 'Slowmode is active. Please wait before uploading again.',
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                });
                if (limit.reason === 'slowmode_on') {
                    pushAudit({
                        type: 'antiabuse',
                        action: 'slowmode_on',
                        socketId: socket.id,
                        by: 'system',
                        details: { kind: 'image', until: nowIso() }
                    });
                }
            } else if (limit.reason === 'mute') {
                const ms = 7 * 60 * 1000;
                conv.mutedUntil = new Date(Date.now() + ms);
                socket.emit('newMessage', {
                    id: Date.now(),
                    user: 'System',
                    text: 'You were temporarily muted for spamming uploads. Please try again later.',
                    timestamp: new Date(),
                    type: 'system',
                    socketId: socket.id
                });
                pushAudit({
                    type: 'antiabuse',
                    action: 'auto_mute',
                    socketId: socket.id,
                    by: 'system',
                    details: { minutes: 7, kind: 'image' }
                });
                broadcastAdminConversations();
            }
            return;
        }

        conv.lastSeenAt = new Date().toISOString();
        ensureTicketForConversation(socket.id);

        const dataUrl = String(payload && payload.dataUrl ? payload.dataUrl : '');
        const size = Number(payload && payload.size ? payload.size : 0);
        const mime = String(payload && payload.mime ? payload.mime : '').toLowerCase();

        if (!dataUrl || dataUrl.length > MAX_IMAGE_DATA_URL_LEN) return;
        if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) return;
        if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return;
        if (!dataUrl.startsWith('data:image/')) return;

        const message = {
            id: Date.now(),
            user: safeUserLabel(payload && payload.user),
            text: '[image]',
            timestamp: new Date(),
            type: 'user',
            socketId: socket.id,
            image: {
                dataUrl,
                mime,
                size,
                name: safeText(payload && payload.name, 80) || null
            }
        };

        const ticket = conv?.ticketId ? tickets.get(conv.ticketId) : null;
        if (ticket) {
            const ev = {
                id: `E-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                at: new Date().toISOString(),
                kind: 'image',
                name: safeText(payload && payload.name, 120) || 'image',
                mime,
                size,
                dataUrl
            };
            if (!Array.isArray(ticket.evidence)) ticket.evidence = [];
            ticket.evidence.push(ev);
            ticket.updatedAt = new Date().toISOString();
            broadcastAdminTickets();
        }

        messages.push(message);
        conv.messages.push(message);
        conv.unread += 1;

        io.to(socket.id).emit('newMessage', message);
        io.to('admins').emit('adminMessage', { socketId: socket.id, message });
        broadcastAdminConversations();

        const t = conv?.ticketId ? tickets.get(conv.ticketId) : null;
        discordNotify('🖼️ User image upload', [
            t?.id ? `**Ticket:** ${t.id}` : `**Socket:** ${socket.id}`,
            `**User:** ${safeUserLabel(payload && payload.user)}`,
            `**File:** ${(safeText(payload && payload.name, 80) || 'image')}`,
            `**Size:** ${Math.round(size / 1024)} KB`
        ]);
    });

    socket.on('sendFile', (payload) => {
        if (isStaff) return;

        if (lockdownState.enabled) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'Chat is temporarily locked by staff. Please try again soon.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }

        const conv = conversations.get(socket.id);
        if (!conv) return;
        if (conv.banned) return;
        if (conv.mutedUntil && Date.now() < Number(new Date(conv.mutedUntil))) return;

        const limit = recordAndCheckRate({ socket, kind: 'image' });
        if (!limit.ok) return;

        conv.lastSeenAt = new Date().toISOString();
        ensureTicketForConversation(socket.id);

        const dataUrl = String(payload && payload.dataUrl ? payload.dataUrl : '');
        const size = Number(payload && payload.size ? payload.size : 0);
        const mime = String(payload && payload.mime ? payload.mime : '').toLowerCase();
        const name = safeText(payload && payload.name, 120) || 'file';

        if (!dataUrl || dataUrl.length > MAX_PDF_DATA_URL_LEN) return;
        if (!Number.isFinite(size) || size <= 0 || size > MAX_PDF_BYTES) return;
        if (mime !== 'application/pdf') return;
        if (!dataUrl.startsWith('data:application/pdf')) return;

        const message = {
            id: Date.now(),
            user: safeUserLabel(payload && payload.user),
            text: '[file]',
            timestamp: new Date(),
            type: 'user',
            socketId: socket.id,
            file: {
                dataUrl,
                mime,
                size,
                name
            }
        };

        messages.push(message);
        conv.messages.push(message);
        conv.unread += 1;

        const ticket = conv?.ticketId ? tickets.get(conv.ticketId) : null;
        if (ticket) {
            const ev = {
                id: `E-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                at: new Date().toISOString(),
                kind: 'pdf',
                name,
                mime,
                size,
                dataUrl
            };
            if (!Array.isArray(ticket.evidence)) ticket.evidence = [];
            ticket.evidence.push(ev);
            ticket.updatedAt = new Date().toISOString();
            broadcastAdminTickets();
        }

        io.to(socket.id).emit('newMessage', message);
        io.to('admins').emit('adminMessage', { socketId: socket.id, message });
        broadcastAdminConversations();

        const t = conv?.ticketId ? tickets.get(conv.ticketId) : null;
        discordNotify('📄 User PDF upload', [
            t?.id ? `**Ticket:** ${t.id}` : `**Socket:** ${socket.id}`,
            `**User:** ${safeUserLabel(payload && payload.user)}`,
            `**File:** ${name}`,
            `**Size:** ${Math.round(size / 1024)} KB`
        ]);

        pushAudit({
            type: 'evidence',
            action: 'upload',
            by: safeUserLabel(payload && payload.user) || 'user',
            socketId: socket.id,
            details: { kind: 'pdf', name, size }
        });
    });

    socket.on('guidanceOptIn', (payload) => {
        if (isStaff) return;
        const conv = conversations.get(socket.id);
        if (!conv) return;
        const enabled = Boolean(payload && payload.enabled);
        conv.guidance = { enabled: enabled };
        conv.lastSeenAt = new Date().toISOString();
        broadcastAdminConversations();
        pushAudit({
            type: 'guidance',
            action: enabled ? 'opt_in' : 'opt_out',
            by: conv.name || 'user',
            socketId: socket.id,
            details: {}
        });

        if (!enabled) {
            if (conv.guidedFix) {
                conv.guidedFix = null;
                io.to(socket.id).emit('guidanceFixState', { enabled: false, id: null, title: null, steps: [] });
                io.to('admins').emit('adminGuidanceFixState', { socketId: socket.id, guidedFix: null });
                broadcastAdminConversations();
            }
        } else {
            if (conv.guidedFix) {
                io.to(socket.id).emit('guidanceFixState', {
                    enabled: true,
                    id: conv.guidedFix.id,
                    title: conv.guidedFix.title || null,
                    steps: Array.isArray(conv.guidedFix.steps) ? conv.guidedFix.steps : []
                });
            }
        }
    });

    socket.on('liveAssistOptIn', (payload) => {
        if (isStaff) return;
        const conv = conversations.get(socket.id);
        if (!conv) return;
        const enabled = Boolean(payload && payload.enabled);
        conv.liveAssist = { enabled: enabled };
        conv.lastSeenAt = new Date().toISOString();
        broadcastAdminConversations();
        pushAudit({
            type: 'liveassist',
            action: enabled ? 'opt_in' : 'opt_out',
            by: conv.name || 'user',
            socketId: socket.id,
            details: {}
        });
    });

    socket.on('liveAssistCursor', (payload) => {
        if (isStaff) return;
        const conv = conversations.get(socket.id);
        if (!conv?.liveAssist?.enabled) return;
        const x = Number(payload && payload.x);
        const y = Number(payload && payload.y);
        const w = Number(payload && payload.w);
        const h = Number(payload && payload.h);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
        if (w <= 0 || h <= 0) return;
        io.to('admins').emit('adminLiveAssistCursor', { socketId: socket.id, x, y, w, h, at: Date.now() });
    });

    socket.on('liveAssistClick', (payload) => {
        if (isStaff) return;
        const conv = conversations.get(socket.id);
        if (!conv?.liveAssist?.enabled) return;
        const x = Number(payload && payload.x);
        const y = Number(payload && payload.y);
        const w = Number(payload && payload.w);
        const h = Number(payload && payload.h);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
        if (w <= 0 || h <= 0) return;
        io.to('admins').emit('adminLiveAssistClick', { socketId: socket.id, x, y, w, h, at: Date.now() });
    });

    socket.on('setUserName', (payload) => {
        if (isStaff) return;
        const conv = conversations.get(socket.id);
        if (!conv) return;
        const next = safeText(payload && payload.name, MAX_NAME_LEN);
        if (!next) return;
        conv.name = next;
        conv.lastSeenAt = new Date().toISOString();
        broadcastAdminConversations();
    });

    socket.on('adminSpotlight', ({ socketId, enabled, x, y }) => {
        if (!isStaff) return;
        const sid = safeText(socketId, 64);
        if (!sid || !conversations.has(sid)) return;
        const conv = conversations.get(sid);
        if (!conv) return;
        if (!conv?.guidance?.enabled) {
            socket.emit('adminSpotlightDenied', { socketId: sid, reason: 'User has not opted in.' });
            return;
        }

        const en = Boolean(enabled);
        const nx = Number(x);
        const ny = Number(y);
        const payload = {
            enabled: en,
            x: Number.isFinite(nx) ? Math.max(0, Math.min(1, nx)) : 0.5,
            y: Number.isFinite(ny) ? Math.max(0, Math.min(1, ny)) : 0.5,
            at: Date.now()
        };
        io.to(sid).emit('guidanceSpotlight', payload);
        pushAudit({
            type: 'guidance',
            action: en ? 'spotlight_on' : 'spotlight_off',
            by: staffStatus.user || 'Staff',
            socketId: sid,
            details: { x: payload.x, y: payload.y }
        });
    });

    socket.on('adminGuidanceFixSet', ({ socketId, title, steps }) => {
        if (!isStaff) return;
        const sid = safeText(socketId, 64);
        if (!sid || !conversations.has(sid)) return;
        const conv = conversations.get(sid);
        if (!conv) return;
        if (!conv?.guidance?.enabled) {
            socket.emit('adminSpotlightDenied', { socketId: sid, reason: 'User has not opted in.' });
            return;
        }

        const t = safeText(title, 60) || 'Fix Steps';
        const raw = Array.isArray(steps) ? steps : [];
        const normalized = raw
            .map((s) => safeText(s, 120))
            .filter(Boolean)
            .slice(0, 12)
            .map((text) => ({ id: `GS-${Date.now()}-${Math.random().toString(16).slice(2)}`, text, done: false }));

        const gf = {
            id: `GF-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: t,
            steps: normalized,
            at: new Date().toISOString()
        };
        conv.guidedFix = gf;
        conv.lastSeenAt = new Date().toISOString();

        io.to(sid).emit('guidanceFixState', { enabled: true, id: gf.id, title: gf.title, steps: gf.steps });
        io.to('admins').emit('adminGuidanceFixState', { socketId: sid, guidedFix: gf });
        broadcastAdminConversations();

        pushAudit({
            type: 'guidance',
            action: 'guidedfix_set',
            by: staffStatus.user || 'Staff',
            socketId: sid,
            details: { title: gf.title, steps: gf.steps.length }
        });
    });

    socket.on('adminGuidanceFixClear', ({ socketId }) => {
        if (!isStaff) return;
        const sid = safeText(socketId, 64);
        if (!sid || !conversations.has(sid)) return;
        const conv = conversations.get(sid);
        if (!conv) return;

        conv.guidedFix = null;
        conv.lastSeenAt = new Date().toISOString();
        io.to(sid).emit('guidanceFixState', { enabled: false, id: null, title: null, steps: [] });
        io.to('admins').emit('adminGuidanceFixState', { socketId: sid, guidedFix: null });
        broadcastAdminConversations();

        pushAudit({
            type: 'guidance',
            action: 'guidedfix_clear',
            by: staffStatus.user || 'Staff',
            socketId: sid,
            details: {}
        });
    });

    socket.on('adminGuidanceFixPing', ({ socketId, stepId }) => {
        if (!isStaff) return;
        const sid = safeText(socketId, 64);
        if (!sid || !conversations.has(sid)) return;
        const conv = conversations.get(sid);
        if (!conv?.guidedFix || !Array.isArray(conv.guidedFix.steps)) return;
        if (!conv?.guidance?.enabled) {
            socket.emit('adminSpotlightDenied', { socketId: sid, reason: 'User has not opted in.' });
            return;
        }
        const st = safeText(stepId, 80);
        if (!st) return;
        const exists = conv.guidedFix.steps.some((s) => s && String(s.id) === String(st));
        if (!exists) return;
        io.to(sid).emit('guidanceFixPing', { id: conv.guidedFix.id, stepId: st, at: Date.now() });
        pushAudit({
            type: 'guidance',
            action: 'guidedfix_ping',
            by: staffStatus.user || 'Staff',
            socketId: sid,
            details: { stepId: st }
        });
    });

    socket.on('userGuidanceFixToggle', ({ id, stepId, done }) => {
        if (isStaff) return;
        const conv = conversations.get(socket.id);
        if (!conv?.guidedFix || !Array.isArray(conv.guidedFix.steps)) return;
        if (!conv?.guidance?.enabled) return;
        const gid = safeText(id, 80);
        if (!gid || String(gid) !== String(conv.guidedFix.id)) return;
        const st = safeText(stepId, 80);
        if (!st) return;
        const nextDone = Boolean(done);
        const step = conv.guidedFix.steps.find((s) => s && String(s.id) === String(st));
        if (!step) return;
        step.done = nextDone;
        conv.lastSeenAt = new Date().toISOString();
        io.to('admins').emit('adminGuidanceFixState', { socketId: socket.id, guidedFix: conv.guidedFix });
        broadcastAdminConversations();
    });

    socket.on('adminSpotlightPing', ({ socketId, x, y }) => {
        if (!isStaff) return;
        const sid = safeText(socketId, 64);
        if (!sid || !conversations.has(sid)) return;
        const conv = conversations.get(sid);
        if (!conv) return;
        if (!conv?.guidance?.enabled) {
            socket.emit('adminSpotlightDenied', { socketId: sid, reason: 'User has not opted in.' });
            return;
        }

        const nx = Number(x);
        const ny = Number(y);
        const payload = {
            x: Number.isFinite(nx) ? Math.max(0, Math.min(1, nx)) : 0.5,
            y: Number.isFinite(ny) ? Math.max(0, Math.min(1, ny)) : 0.5,
            at: Date.now()
        };
        io.to(sid).emit('guidancePing', payload);
        pushAudit({
            type: 'guidance',
            action: 'ping',
            by: staffStatus.user || 'Staff',
            socketId: sid,
            details: { x: payload.x, y: payload.y }
        });
    });

    socket.on('clientMeta', (payload) => {
        if (isStaff) return;
        const conv = conversations.get(socket.id);
        if (!conv) return;
        const pathVal = safeText(payload && payload.path, 200);
        const uaVal = safeText(payload && payload.ua, 300);
        conv.clientMeta = {
            path: pathVal || null,
            ua: uaVal || null,
            at: new Date().toISOString()
        };
        conv.lastSeenAt = new Date().toISOString();
        broadcastAdminConversations();
    });

    socket.on('preChatSubmit', (payload) => {
        if (isStaff) return;

        if (lockdownState.enabled) {
            socket.emit('newMessage', {
                id: Date.now(),
                user: 'System',
                text: 'Chat is temporarily locked by staff. Please try again soon.',
                timestamp: new Date(),
                type: 'system',
                socketId: socket.id
            });
            return;
        }
        const conv = conversations.get(socket.id);
        if (!conv) return;
        const ticket = ensureTicketForConversation(socket.id);
        if (!ticket) return;

        const issue = safeEnum(payload && payload.issue, ['billing', 'login', 'bug', 'ban', 'other'], 'other');
        const desc = safeText(payload && payload.desc, 300);
        ticket.form = {
            issue,
            desc,
            submittedAt: new Date().toISOString()
        };

        if (issue === 'billing') {
            ticket.priority = 'high';
        } else if (issue === 'login') {
            ticket.priority = 'normal';
        } else if (issue === 'bug') {
            ticket.priority = 'normal';
        } else if (issue === 'ban') {
            ticket.priority = 'low';
        } else {
            ticket.priority = 'normal';
        }

        ticket.updatedAt = new Date().toISOString();
        conv.lastSeenAt = new Date().toISOString();
        broadcastAdminConversations();

        discordNotify('📝 Pre-chat form submitted', [
            `**Ticket:** ${ticket.id}`,
            `**User:** ${conv.name || socket.id}`,
            `**Issue:** ${ticket.form?.issue || 'other'}`,
            `**Desc:** ${(ticket.form?.desc || '').slice(0, 250)}`
        ]);
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
        broadcastAdminTickets();
        socket.emit('lockdownUpdate', lockdownState);
        socket.emit('adminAuditLogInit', auditLog);
    });

    socket.on('adminGetTicketEvidence', ({ ticketId }) => {
        if (!isStaff) return;
        const id = String(ticketId || '');
        if (!id) return;
        const t = tickets.get(id);
        if (!t) return;
        const ev = Array.isArray(t.evidence) ? t.evidence.slice(-60) : [];
        socket.emit('adminTicketEvidence', { ticketId: id, evidence: ev });
    });

    socket.on('adminSetLockdown', ({ enabled, reason }) => {
        if (!isStaff) return;
        lockdownState = {
            enabled: Boolean(enabled),
            by: staffStatus.user || 'Staff',
            at: new Date().toISOString(),
            reason: safeText(reason, 200) || null
        };
        broadcastLockdown();

        pushAudit({
            type: 'staff',
            action: Boolean(enabled) ? 'lockdown_on' : 'lockdown_off',
            by: staffStatus.user || 'Staff',
            details: { reason: safeText(reason, 200) || null }
        });
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
            ticket: conv.ticketId ? tickets.get(conv.ticketId) : null,
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

        socket.emit('adminGuidanceFixState', { socketId, guidedFix: conv.guidedFix || null });
        socket.emit('adminGuardrailsState', { socketId, guardrails: conv.guardrails || { attachments: true, cooldownMs: 0, requireVerified: false } });
        broadcastAdminConversations();
    });

    socket.on('adminGuardrailsSet', ({ socketId, guardrails }) => {
        if (!isStaff) return;
        const sid = safeText(socketId, 64);
        if (!sid || !conversations.has(sid)) return;
        const conv = conversations.get(sid);
        if (!conv) return;

        const g = guardrails && typeof guardrails === 'object' ? guardrails : {};
        const attachments = g.attachments !== false;
        const cooldownMs = Math.max(0, Math.min(Number(g.cooldownMs || 0), 60_000));
        const requireVerified = Boolean(g.requireVerified);
        conv.guardrails = { attachments, cooldownMs: Number.isFinite(cooldownMs) ? cooldownMs : 0, requireVerified };
        conv.lastSeenAt = new Date().toISOString();

        io.to(sid).emit('guardrailsUpdate', conv.guardrails);
        io.to('admins').emit('adminGuardrailsState', { socketId: sid, guardrails: conv.guardrails });
        broadcastAdminConversations();

        pushAudit({
            type: 'staff',
            action: 'guardrails_set',
            by: staffStatus.user || 'Staff',
            socketId: sid,
            details: conv.guardrails
        });
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

        const ticket = conv.ticketId ? tickets.get(conv.ticketId) : null;
        if (ticket && ticket.claim && ticket.claim.user && ticket.claim.user !== (staffStatus.user || 'Staff')) {
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

        const t = conv?.ticketId ? tickets.get(conv.ticketId) : null;
        discordNotify('🧑‍💼 Staff reply', [
            t?.id ? `**Ticket:** ${t.id}` : `**Socket:** ${socketId}`,
            `**Staff:** ${staffStatus.user || 'Staff'}`,
            `**Text:** ${safeText(text, 250)}`
        ]);
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

    socket.on('adminTicketUpdate', ({ ticketId, status, priority, assignee }) => {
        if (!isStaff) return;
        const id = safeText(ticketId, 32);
        if (!id) return;
        const ticket = tickets.get(id);
        if (!ticket) return;

        if (status != null) {
            const s = String(status).toLowerCase();
            if (s === 'open' || s === 'closed' || s === 'pending') {
                ticket.status = s;
            }
        }

        if (priority != null) {
            const p = String(priority).toLowerCase();
            if (p === 'low' || p === 'normal' || p === 'high' || p === 'urgent') {
                ticket.priority = p;
            }
        }

        if (assignee !== undefined) {
            const a = safeText(assignee, 40);
            ticket.assignee = a || null;
        }

        ticket.updatedAt = new Date().toISOString();
        broadcastAdminConversations();

        discordNotify('🛠️ Ticket updated', [
            `**Ticket:** ${ticket.id}`,
            `**By:** ${staffStatus.user || 'Staff'}`,
            status !== undefined ? `**Status:** ${ticket.status}` : null,
            priority !== undefined ? `**Priority:** ${ticket.priority}` : null,
            assignee !== undefined ? `**Assignee:** ${ticket.assignee || 'unassigned'}` : null
        ]);
    });

    socket.on('adminTicketClaim', ({ ticketId, force }) => {
        if (!isStaff) return;
        const id = safeText(ticketId, 32);
        if (!id) return;
        const ticket = tickets.get(id);
        if (!ticket) return;

        const user = staffStatus.user || 'Staff';
        const wantsForce = Boolean(force);
        if (ticket.claim && ticket.claim.user && ticket.claim.user !== user && !wantsForce) {
            return;
        }

        ticket.claim = {
            user,
            at: new Date().toISOString()
        };
        ticket.updatedAt = new Date().toISOString();
        broadcastAdminConversations();

        discordNotify('🔒 Ticket claimed', [
            `**Ticket:** ${ticket.id}`,
            `**By:** ${staffStatus.user || 'Staff'}`,
            Boolean(force) ? '**Mode:** force take' : '**Mode:** claim'
        ]);
    });

    socket.on('adminTicketClaimClear', ({ ticketId }) => {
        if (!isStaff) return;
        const id = safeText(ticketId, 32);
        if (!id) return;
        const ticket = tickets.get(id);
        if (!ticket) return;
        ticket.claim = null;
        ticket.updatedAt = new Date().toISOString();
        broadcastAdminConversations();

        discordNotify('🔓 Ticket released', [
            `**Ticket:** ${ticket.id}`,
            `**By:** ${staffStatus.user || 'Staff'}`
        ]);
    });

    socket.on('adminAiAnalyzeTicket', async ({ ticketId }) => {
        if (!isStaff) return;
        const id = safeText(ticketId, 32);
        if (!id) return;
        const ticket = tickets.get(id);
        if (!ticket) return;
        const conv = conversations.get(ticket.socketId);
        if (!conv) return;

        const form = ticket.form || null;
        const last = (Array.isArray(conv.messages) ? conv.messages : []).slice(-20);
        const transcript = last
            .map((m) => {
                const role = (m?.type || '').toLowerCase() === 'staff' ? 'STAFF' : (m?.type || '').toLowerCase() === 'system' ? 'SYSTEM' : 'USER';
                if (m?.image?.mime) return `${role}: [image ${m.image.mime}, ${Math.round((m.image.size || 0) / 1024)}kb]`;
                return `${role}: ${(m?.text || '').toString().slice(0, 600)}`;
            })
            .join('\n');

        const prompt =
            `You are an expert support triage assistant.\n` +
            `Return ONLY valid JSON with keys: summary (string), suggested_priority (one of low/normal/high/urgent), suggested_tags (array of strings, max 6), next_question (string).\n` +
            `Keep summary <= 60 words. next_question should be 1 short question to ask the user next.\n\n` +
            `Pre-chat form (may be null): ${JSON.stringify(form)}\n` +
            `Ticket status: ${ticket.status}, priority: ${ticket.priority}\n\n` +
            `Recent transcript:\n${transcript}`;

        try {
            const { status, data } = await openAiPostJson({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: 'You format outputs strictly as JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2,
                response_format: { type: 'json_object' }
            });

            const content =
                data && data.choices && data.choices[0] && data.choices[0].message
                    ? data.choices[0].message.content
                    : '';
            const parsed = extractJsonObject(content);

            ticket.ai = {
                at: new Date().toISOString(),
                model: OPENAI_MODEL,
                ok: status >= 200 && status < 300,
                summary: parsed?.summary || null,
                suggestedPriority: parsed?.suggested_priority || null,
                suggestedTags: Array.isArray(parsed?.suggested_tags) ? parsed.suggested_tags.slice(0, 6) : null,
                nextQuestion: parsed?.next_question || null,
                raw: parsed ? null : String(content || '').slice(0, 2000)
            };
        } catch (e) {
            ticket.ai = {
                at: new Date().toISOString(),
                model: OPENAI_MODEL,
                ok: false,
                error: String(e && e.message ? e.message : e).slice(0, 200)
            };
        }

        ticket.updatedAt = new Date().toISOString();
        socket.emit('adminAiTicketResult', { ticketId: ticket.id, ai: ticket.ai });
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

            pushAudit({
                type: 'staff',
                action: 'mute',
                by: staffStatus.user || 'Staff',
                socketId,
                details: { ms }
            });
        } else if (act === 'unmute') {
            conv.mutedUntil = null;

            pushAudit({
                type: 'staff',
                action: 'unmute',
                by: staffStatus.user || 'Staff',
                socketId
            });
        } else if (act === 'ban') {
            conv.banned = true;
            // Disconnect the user immediately
            io.to(socketId).disconnectSockets(true);

            pushAudit({
                type: 'staff',
                action: 'ban',
                by: staffStatus.user || 'Staff',
                socketId
            });
        } else if (act === 'unban') {
            conv.banned = false;

            pushAudit({
                type: 'staff',
                action: 'unban',
                by: staffStatus.user || 'Staff',
                socketId
            });
        } else if (act === 'disconnect') {
            io.to(socketId).disconnectSockets(true);

            pushAudit({
                type: 'staff',
                action: 'disconnect',
                by: staffStatus.user || 'Staff',
                socketId
            });
        } else if (act === 'verify') {
            const code = Math.random().toString(16).slice(2, 8).toUpperCase();
            conv.verifyChallenge = { code, issuedAt: Date.now() };
            conv.verified = false;

            pushAudit({
                type: 'staff',
                action: 'verify_challenge',
                by: staffStatus.user || 'Staff',
                socketId
            });

            const sys = {
                id: Date.now(),
                user: 'System',
                text: `Verification code: ${code}. Please reply with this code to verify.`,
                timestamp: new Date(),
                type: 'system',
                socketId
            };
            messages.push(sys);
            conv.messages.push(sys);
            io.to(socketId).emit('newMessage', sys);
            io.to('admins').emit('adminMessage', { socketId, message: sys });
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
