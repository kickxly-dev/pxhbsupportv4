// P.X HB Admin Panel JavaScript
const socket = io();
let currentSection = 'dashboard';
let selectedChat = null;
let conversationsById = new Map();

// Initialize admin panel
document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    loadDashboardData();
    setupSocketEvents();
    socket.emit('adminInit');
});

function checkAuth() {
    const staffUser = sessionStorage.getItem('staffUser');
    const staffLoggedIn = sessionStorage.getItem('staffLoggedIn');

    if (!staffUser || staffLoggedIn !== 'true') {
        window.location.href = '/';
    }
}

function setupSocketEvents() {
    socket.on('adminConversations', (list) => {
        const arr = Array.isArray(list) ? list : [];
        conversationsById = new Map(arr.map((c) => [c.socketId, c]));
        renderChatList(arr);
        updateStats();
    });

    socket.on('adminConversationMessages', (payload) => {
        const socketId = payload?.socketId;
        if (!socketId) return;
        selectedChat = socketId;
        renderChatMessages(payload?.messages || []);
        highlightSelectedChat(socketId);
        updateStats();
    });

    socket.on('adminMessage', (payload) => {
        const socketId = payload?.socketId;
        const message = payload?.message;
        if (!socketId || !message) return;

        if (selectedChat && socketId === selectedChat) {
            appendChatMessage(message);
        }

        updateStats();
    });
}

// Navigation functions
function showDashboard(btn) {
    switchSection('dashboard', btn);
    loadDashboardData();
}

function showChats(btn) {
    switchSection('chats', btn);
    loadChatList();
}

function showSettings(btn) {
    switchSection('settings', btn);
}

function switchSection(sectionId, btn) {
    document.querySelectorAll('.admin-section').forEach((section) => {
        section.classList.remove('active');
    });

    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');
    currentSection = sectionId;

    document.querySelectorAll('.admin-btn').forEach((b) => {
        b.classList.remove('active');
    });

    if (btn && btn.classList) {
        btn.classList.add('active');
    }
}

// Dashboard functions
function loadDashboardData() {
    fetch('/api/stats')
        .then((response) => response.json())
        .then((data) => {
            updateStatsDisplay(data);
        })
        .catch(() => {
            updateStatsDisplay({
                activeUsers: Math.floor(Math.random() * 50) + 10,
                totalMessages: Math.floor(Math.random() * 200) + 50,
                staffOnline: 0,
                avgResponse: 0
            });
        });
}

function updateStatsDisplay(stats) {
    const au = document.getElementById('activeUsers');
    const tm = document.getElementById('totalMessages');
    const so = document.getElementById('staffOnline');
    const ar = document.getElementById('avgResponse');

    if (au) au.textContent = stats.activeUsers;
    if (tm) tm.textContent = stats.totalMessages;
    if (so) so.textContent = stats.staffOnline;
    if (ar) ar.textContent = `${stats.avgResponse || 0}s`;
}

function updateStats() {
    loadDashboardData();
}

// Chat functions
function loadChatList() {
    socket.emit('adminInit');
}

function selectChat(socketId, el) {
    selectedChat = socketId;

    document.querySelectorAll('.chat-item').forEach((item) => item.classList.remove('selected'));
    if (el) el.classList.add('selected');

    socket.emit('adminSelectConversation', { socketId });
}

function sendAdminMessage() {
    const input = document.getElementById('adminChatInput');
    const message = (input?.value || '').trim();
    if (!message || !selectedChat) return;

    socket.emit('adminSendMessage', { socketId: selectedChat, text: message });
    if (input) input.value = '';
}

function addAdminMessage(text, type) {
    const chatMessages = document.getElementById('adminChatMessages');
    if (!chatMessages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `<div class="message-content"><p>${escapeHtml(String(text))}</p></div>`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function handleAdminKeyPress(event) {
    if (event.key === 'Enter') {
        sendAdminMessage();
    }
}

function updateChatList() {
    if (currentSection === 'chats') {
        loadChatList();
    }
}

function logout() {
    sessionStorage.removeItem('staffUser');
    sessionStorage.removeItem('staffLoggedIn');
    fetch('/api/staff/logout', { method: 'POST' }).finally(() => {
        window.location.href = '/';
    });
}

function renderChatList(list) {
    const chatList = document.getElementById('adminChatList') || document.querySelector('.chat-list');
    if (!chatList) return;

    const arr = Array.isArray(list) ? list : [];
    chatList.innerHTML = arr
        .map((c) => {
            const timeText = c.lastAt ? new Date(c.lastAt).toLocaleTimeString() : '';
            const preview = escapeHtml(String(c.lastText || ''));
            const name = escapeHtml(String(c.name || c.socketId));
            const unread = Number(c.unread || 0);
            const right = unread > 0 ? `${unread}` : escapeHtml(timeText);

            return `
        <div class="chat-item" data-socket-id="${escapeHtml(String(c.socketId))}" onclick="selectChat('${escapeHtml(String(c.socketId))}', this)">
            <div class="chat-item-header">
                <span class="chat-user">${name}${c.connected ? '' : ' (disconnected)'}</span>
                <span class="chat-time">${right}</span>
            </div>
            <div class="chat-preview">${preview}</div>
        </div>`;
        })
        .join('');

    if (selectedChat) highlightSelectedChat(selectedChat);
}

function highlightSelectedChat(socketId) {
    document.querySelectorAll('.chat-item').forEach((item) => item.classList.remove('selected'));
    const el = document.querySelector(`.chat-item[data-socket-id="${CSS.escape(String(socketId))}"]`);
    if (el) el.classList.add('selected');
}

function renderChatMessages(messages) {
    const chatMessages = document.getElementById('adminChatMessages');
    if (!chatMessages) return;
    chatMessages.innerHTML = '';
    (Array.isArray(messages) ? messages : []).forEach((m) => appendChatMessage(m));
}

function appendChatMessage(message) {
    if (!message) return;
    addAdminMessage(message.text || '', message.type || 'user');
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}