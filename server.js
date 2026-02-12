// P.X HB Support - Self-Hosted Server
// Run with: node server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

// Store messages and staff status
let messages = [];
let staffStatus = {
    isOnline: false,
    staffName: null,
    lastSeen: null
};

// Staff credentials (same as frontend)
const STAFF_CREDENTIALS = {
    'admin': 'pxhb2024',
    'support': 'support123',
    'moderator': 'mod456'
};

// API Routes
app.get('/api/messages', (req, res) => {
    res.json(messages.slice(-50)); // Last 50 messages
});

app.post('/api/messages', (req, res) => {
    const message = {
        id: Date.now(),
        text: req.body.text,
        sender: req.body.sender,
        senderType: req.body.senderType,
        timestamp: new Date().toISOString()
    };
    
    messages.push(message);
    
    // Keep only last 100 messages
    if (messages.length > 100) {
        messages = messages.slice(-100);
    }
    
    // Broadcast to all connected clients
    io.emit('newMessage', message);
    
    res.json({ success: true, message });
});

app.get('/api/staff-status', (req, res) => {
    res.json(staffStatus);
});

app.post('/api/staff-status', (req, res) => {
    staffStatus = {
        ...staffStatus,
        ...req.body,
        lastSeen: new Date().toISOString()
    };
    
    // Broadcast staff status change
    io.emit('staffStatusUpdate', staffStatus);
    
    res.json({ success: true, staffStatus });
});

app.post('/api/staff-login', (req, res) => {
    const { username, password } = req.body;
    
    if (STAFF_CREDENTIALS[username] && STAFF_CREDENTIALS[username] === password) {
        res.json({ 
            success: true, 
            username,
            message: 'Login successful'
        });
    } else {
        res.json({ 
            success: false, 
            message: 'Invalid credentials' 
        });
    }
});

// Socket.IO for real-time communication
io.on('connection', (socket) => {
    console.log('🔗 User connected:', socket.id);
    
    // Send current messages and staff status
    socket.emit('messages', messages.slice(-50));
    socket.emit('staffStatusUpdate', staffStatus);
    
    // Handle new messages
    socket.on('sendMessage', (messageData) => {
        const message = {
            id: Date.now(),
            text: messageData.text,
            sender: messageData.sender,
            senderType: messageData.senderType,
            timestamp: new Date().toISOString()
        };
        
        messages.push(message);
        
        // Keep only last 100 messages
        if (messages.length > 100) {
            messages = messages.slice(-100);
        }
        
        // Broadcast to all clients
        io.emit('newMessage', message);
    });
    
    // Handle staff status updates
    socket.on('updateStaffStatus', (status) => {
        staffStatus = {
            ...staffStatus,
            ...status,
            lastSeen: new Date().toISOString()
        };
        
        // Broadcast to all clients
        io.emit('staffStatusUpdate', staffStatus);
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id);
    });
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve enterprise admin panel
app.get('/admin-v2', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-v2.html'));
});

// API Routes for Admin Panel
app.get('/api/admin/stats', (req, res) => {
    res.json({
        activeUsers: Math.floor(Math.random() * 20) + 5,
        onlineStaff: staffStatus.isOnline ? 1 : 0,
        totalMessages: messages.length,
        avgResponseTime: Math.floor(Math.random() * 60) + 30,
        newUsers: Math.floor(Math.random() * 20) + 5,
        returningUsers: Math.floor(Math.random() * 100) + 50,
        countries: Math.floor(Math.random() * 30) + 10,
        unreadCount: Math.floor(Math.random() * 15)
    });
});

app.get('/api/admin/staff', (req, res) => {
    res.json({
        staff: [
            { username: 'admin', role: 'Administrator', status: 'online', performance: 98, lastActive: '2 min ago', chatsHandled: 245, avgResponseTime: 45 },
            { username: 'support', role: 'Support Agent', status: 'online', performance: 92, lastActive: '5 min ago', chatsHandled: 189, avgResponseTime: 52 },
            { username: 'moderator', role: 'Moderator', status: 'offline', performance: 85, lastActive: '1 hour ago', chatsHandled: 156, avgResponseTime: 68 }
        ]
    });
});

app.get('/api/admin/conversations', (req, res) => {
    res.json({
        conversations: [
            { id: 'CV001', customer: 'John Doe', staff: 'admin', status: 'active', duration: '12 min', sentiment: 'positive', priority: 'high', messages: 8 },
            { id: 'CV002', customer: 'Jane Smith', staff: 'support', status: 'waiting', duration: '5 min', sentiment: 'neutral', priority: 'medium', messages: 3 },
            { id: 'CV003', customer: 'Bob Wilson', staff: 'moderator', status: 'completed', duration: '25 min', sentiment: 'positive', priority: 'low', messages: 15 },
            { id: 'CV004', customer: 'Alice Johnson', staff: 'none', status: 'queue', duration: '2 min', sentiment: 'neutral', priority: 'high', messages: 1 },
            { id: 'CV005', customer: 'Charlie Brown', staff: 'support', status: 'active', duration: '18 min', sentiment: 'positive', priority: 'medium', messages: 12 }
        ]
    });
});

app.get('/api/admin/logs', (req, res) => {
    res.json({
        logs: [
            { timestamp: new Date(), level: 'info', source: 'server', message: 'System started successfully', details: 'All services operational' },
            { timestamp: new Date(Date.now() - 300000), level: 'warning', source: 'auth', message: 'Failed login attempt', details: 'IP: 192.168.1.100' },
            { timestamp: new Date(Date.now() - 600000), level: 'error', source: 'database', message: 'Connection timeout', details: 'Retrying connection...' },
            { timestamp: new Date(Date.now() - 900000), level: 'success', source: 'chat', message: 'New conversation started', details: 'User: John Doe' },
            { timestamp: new Date(Date.now() - 1200000), level: 'info', source: 'staff', message: 'Staff member online', details: 'User: admin' }
        ]
    });
});

// Advanced API endpoints
app.post('/api/admin/staff/message', (req, res) => {
    const { target, message } = req.body;
    console.log(`Message to ${target}: ${message}`);
    res.json({ success: true, message: 'Message sent successfully' });
});

app.post('/api/admin/conversation/close', (req, res) => {
    const { id } = req.body;
    console.log(`Closing conversation: ${id}`);
    res.json({ success: true, message: 'Conversation closed successfully' });
});

app.get('/api/admin/performance', (req, res) => {
    res.json({
        uptime: '99.9%',
        responseTime: Math.floor(Math.random() * 60) + 30,
        satisfactionRate: '4.8/5.0',
        resolutionRate: '92%',
        escalationRate: '3%',
        serverLoad: Math.floor(Math.random() * 30) + 20,
        memoryUsage: Math.floor(Math.random() * 40) + 30,
        activeConnections: Math.floor(Math.random() * 50) + 10
    });
});

app.get('/api/admin/analytics', (req, res) => {
    const period = req.query.period || '24h';
    res.json({
        period,
        data: {
            users: Array.from({ length: 24 }, (_, i) => ({
                hour: i,
                active: Math.floor(Math.random() * 100) + 20,
                new: Math.floor(Math.random() * 20) + 5
            })),
            messages: Array.from({ length: 24 }, (_, i) => ({
                hour: i,
                count: Math.floor(Math.random() * 50) + 10
            })),
            responseTime: Array.from({ length: 24 }, (_, i) => ({
                hour: i,
                avgTime: Math.floor(Math.random() * 60) + 30
            }))
        }
    });
});

app.get('/api/admin/staff', (req, res) => {
    res.json([
        { username: 'admin', role: 'Administrator', online: staffStatus.isOnline, lastSeen: staffStatus.lastSeen },
        { username: 'support', role: 'Support Agent', online: false, lastSeen: new Date() },
        { username: 'moderator', role: 'Moderator', online: false, lastSeen: new Date() }
    ]);
});

app.get('/api/admin/messages', (req, res) => {
    res.json(messages.slice(-50));
});

// Start server
server.listen(PORT, () => {
    console.log(`🚀 P.X HB Support Server running on http://localhost:${PORT}`);
    console.log(`📱 Open your browser and go to: http://localhost:${PORT}`);
    console.log(`🔧 Staff login: Type Konami Code (↑↑↓↓←→←→BA)`);
    console.log(`👮 Staff credentials: admin/pxhb2024, support/support123, moderator/mod456`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});
