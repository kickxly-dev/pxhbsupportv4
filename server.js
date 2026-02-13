const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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

// Serve main site
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin panel
app.get('/admin', (req, res) => {
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

app.get('/version', (req, res) => {
    res.json({
        commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
        time: new Date().toISOString()
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Send existing messages to new user
    socket.emit('loadMessages', messages);
    
    // Handle new messages
    socket.on('sendMessage', (data) => {
        const message = {
            id: data.id || Date.now(),
            user: data.user,
            text: data.text,
            timestamp: new Date(),
            type: data.type || 'user'
        };
        
        messages.push(message);
        io.emit('newMessage', message);
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
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`P.X HB Support server running on port ${PORT}`);
});
