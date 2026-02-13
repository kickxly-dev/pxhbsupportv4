const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

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

function isStaffFromCookieHeader(cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    return cookies.pxhb_staff === '1';
}

function setStaffCookie(res) {
    res.setHeader('Set-Cookie', 'pxhb_staff=1; Path=/; HttpOnly; SameSite=Lax');
}

function clearStaffCookie(res) {
    res.setHeader('Set-Cookie', 'pxhb_staff=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
}

// Middleware
app.use((req, res, next) => {
    if (
        req.path === '/' ||
        req.path.endsWith('.html') ||
        req.path.endsWith('.js') ||
        req.path.endsWith('.css')
    ) {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Staff credentials
const STAFF_CREDENTIALS = {
    'admin': 'pxhb2024',
    'support': 'support123', 
    'moderator': 'mod456'
};

// Store chat messages and staff status
let messages = [];
let staffStatus = { isOnline: false, user: null };

// Real conversations (keyed by user socket id)
const conversations = new Map();

function getConversationSummary(socketId) {
    const conv = conversations.get(socketId);
    if (!conv) return null;
    return {
        socketId,
        name: conv.name,
        connected: conv.connected,
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

// API endpoints
app.get('/api/stats', (req, res) => {
    res.json({
        activeUsers: Math.floor(Math.random() * 20) + 5,
        totalMessages: messages.length,
        staffOnline: staffStatus.isOnline ? 1 : 0
    });
});

app.post('/api/staff/login', (req, res) => {
    const { username, password } = req.body || {};
    if (STAFF_CREDENTIALS[username] && STAFF_CREDENTIALS[username] === password) {
        setStaffCookie(res);
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
        conversations.set(socket.id, {
            name: `User ${socket.id.slice(0, 6)}`,
            connected: true,
            unread: 0,
            messages: []
        });
        broadcastAdminConversations();
    }
    
    // Send existing messages to new user
    socket.emit('loadMessages', messages);
    
    // Handle new messages
    socket.on('sendMessage', (data) => {
        if (isStaff) return;
        const message = {
            id: data.id || Date.now(),
            user: data.user,
            text: data.text,
            timestamp: new Date(),
            type: data.type || 'user',
            socketId: socket.id
        };
        
        messages.push(message);
        const conv = conversations.get(socket.id);
        if (conv) {
            conv.messages.push(message);
            conv.unread += 1;
        }
        io.emit('newMessage', message);
        broadcastAdminConversations();
    });

    // Admin: request conversation list
    socket.on('adminInit', () => {
        if (!isStaff) return;
        broadcastAdminConversations();
    });

    // Admin: select conversation
    socket.on('adminSelectConversation', ({ socketId }) => {
        if (!isStaff) return;
        const conv = conversations.get(socketId);
        if (!conv) return;
        conv.unread = 0;
        socket.emit('adminConversationMessages', {
            socketId,
            name: conv.name,
            connected: conv.connected,
            messages: conv.messages
        });
        broadcastAdminConversations();
    });

    // Admin: send message to a user
    socket.on('adminSendMessage', ({ socketId, text }) => {
        if (!isStaff) return;
        const msgText = String(text || '').trim();
        if (!socketId || !msgText) return;
        const conv = conversations.get(socketId);
        if (!conv) return;

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
    
    // Handle staff login
    socket.on('staffLogin', (data) => {
        if (STAFF_CREDENTIALS[data.username] === data.password) {
            staffStatus = { isOnline: true, user: data.username };
            socket.emit('loginSuccess', { user: data.username });
            io.emit('staffStatusUpdate', staffStatus);
        } else {
            socket.emit('loginError', 'Invalid credentials');
        }
    });
    
    socket.on('disconnect', () => {
        if (!isStaff) {
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
