// P.X HB Admin Panel JavaScript
const socket = io();
let currentSection = 'dashboard';
let selectedChat = null;

// Initialize admin panel
document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    loadDashboardData();
    setupSocketEvents();
});

function checkAuth() {
    const staffUser = sessionStorage.getItem('staffUser');
    const staffLoggedIn = sessionStorage.getItem('staffLoggedIn');

    if (!staffUser || staffLoggedIn !== 'true') {
        window.location.href = '/';
    }
}

function setupSocketEvents() {
    socket.on('newMessage', () => {
        if (currentSection === 'chats') {
            updateChatList();
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
                staffOnline: 1,
                avgResponse: Math.floor(Math.random() * 30) + 15
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

// Chat functions (demo UI)
function loadChatList() {
    const chatList = document.querySelector('.chat-list');
    if (!chatList) return;

    chatList.innerHTML = `
        <div class="chat-item" onclick="selectChat('user1', this)">
            <div class="chat-item-header">
                <span class="chat-user">User 1</span>
                <span class="chat-time">2 min ago</span>
            </div>
            <div class="chat-preview">I need help with my account...</div>
        </div>
        <div class="chat-item" onclick="selectChat('user2', this)">
            <div class="chat-item-header">
                <span class="chat-user">User 2</span>
                <span class="chat-time">5 min ago</span>
            </div>
            <div class="chat-preview">Technical issue with login...</div>
        </div>
        <div class="chat-item" onclick="selectChat('user3', this)">
            <div class="chat-item-header">
                <span class="chat-user">User 3</span>
                <span class="chat-time">10 min ago</span>
            </div>
            <div class="chat-preview">Billing question...</div>
        </div>
    `;
}

function selectChat(userId, el) {
    selectedChat = userId;

    document.querySelectorAll('.chat-item').forEach((item) => item.classList.remove('selected'));
    if (el) el.classList.add('selected');

    const chatMessages = document.getElementById('adminChatMessages');
    if (!chatMessages) return;

    chatMessages.innerHTML = `
        <div class="message user">
            <div class="message-content"><p>Hello, I need help with my account</p></div>
        </div>
        <div class="message staff">
            <div class="message-content"><p>Hello! I'm here to help. What seems to be the issue?</p></div>
        </div>
    `;
}

function sendAdminMessage() {
    const input = document.getElementById('adminChatInput');
    const message = (input?.value || '').trim();
    if (!message || !selectedChat) return;

    socket.emit('sendMessage', {
        text: message,
        user: sessionStorage.getItem('staffUser') || 'Staff',
        type: 'staff'
    });

    addAdminMessage(message, 'staff');
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
    window.location.href = '/';
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
