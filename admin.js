// P.X HB Admin Panel JavaScript
const socket = io();
let currentSection = 'dashboard';
let selectedChat = null;

// Initialize admin panel
document.addEventListener('DOMContentLoaded', function() {
    console.log('P.X HB Admin Panel initialized');
    
    // Check authentication
    checkAuth();
    
    // Load dashboard data
    loadDashboardData();
    
    // Handle socket events
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
    // Listen for new messages
    socket.on('newMessage', (message) => {
        if (currentSection === 'chats') {
            updateChatList();
        }
        updateStats();
    });
    
    // Listen for staff status updates
    socket.on('staffStatusUpdate', (status) => {
        updateStaffStatus(status);
    });
}

// Navigation functions
function showDashboard() {
    switchSection('dashboard');
    loadDashboardData();
}

function showChats() {
    switchSection('chats');
    loadChatList();
}

function showSettings() {
    switchSection('settings');
}

function switchSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.admin-section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(sectionId).classList.add('active');
    currentSection = sectionId;
    
    // Update active button
    document.querySelectorAll('.admin-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
}

// Dashboard functions
function loadDashboardData() {
    // Fetch stats from API
    fetch('/api/stats')
        .then(response => response.json())
        .then(data => {
            updateStatsDisplay(data);
        })
        .catch(error => {
            console.error('Error loading stats:', error);
            // Use mock data for demo
            updateStatsDisplay({
                activeUsers: Math.floor(Math.random() * 50) + 10,
                totalMessages: Math.floor(Math.random() * 200) + 50,
                staffOnline: 1,
                avgResponse: Math.floor(Math.random() * 30) + 15
            });
        });
}

function updateStatsDisplay(stats) {
    document.getElementById('activeUsers').textContent = stats.activeUsers;
    document.getElementById('totalMessages').textContent = stats.totalMessages;
    document.getElementById('staffOnline').textContent = stats.staffOnline;
    document.getElementById('avgResponse').textContent = stats.avgResponse + 's';
}

function updateStats() {
    loadDashboardData();
}

function updateStaffStatus(status) {
    // Update staff status display
    console.log('Staff status updated:', status);
}

// Chat functions
function loadChatList() {
    // Simulate loading chat list
    const chatList = document.querySelector('.chat-list');
    chatList.innerHTML = `
        <div class="chat-item" onclick="selectChat('user1')">
            <div class="chat-item-header">
                <span class="chat-user">User 1</span>
                <span class="chat-time">2 min ago</span>
            </div>
            <div class="chat-preview">I need help with my account...</div>
        </div>
        <div class="chat-item" onclick="selectChat('user2')">
            <div class="chat-item-header">
                <span class="chat-user">User 2</span>
                <span class="chat-time">5 min ago</span>
            </div>
            <div class="chat-preview">Technical issue with login...</div>
        </div>
        <div class="chat-item" onclick="selectChat('user3')">
            <div class="chat-item-header">
                <span class="chat-user">User 3</span>
                <span class="chat-time">10 min ago</span>
            </div>
            <div class="chat-preview">Billing question...</div>
        </div>
    `;
}

function selectChat(userId) {
    selectedChat = userId;
    
    // Update chat window
    const chatMessages = document.getElementById('adminChatMessages');
    chatMessages.innerHTML = `
        <div class="message user">
            <div class="message-content">
                <p>Hello, I need help with my account</p>
            </div>
        </div>
        <div class="message staff">
            <div class="message-content">
                <p>Hello! I'm here to help. What seems to be the issue?</p>
            </div>
        </div>
    `;
    
    // Highlight selected chat
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('selected');
    });
    event.target.closest('.chat-item').classList.add('selected');
}

function sendAdminMessage() {
    const input = document.getElementById('adminChatInput');
    const message = input.value.trim();
    
    if (message && selectedChat) {
        // Send message to user
        socket.emit('sendMessage', {
            text: message,
            user: sessionStorage.getItem('staffUser'),
            type: 'staff'
        });
        
        // Add message to chat window
        addAdminMessage(message, 'staff');
        
        // Clear input
        input.value = '';
    }
}

function addAdminMessage(text, type) {
    const chatMessages = document.getElementById('adminChatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <p>${text}</p>
        </div>
    `;
    
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

// Settings functions
function saveSettings() {
    showNotification('Settings saved successfully!', 'success');
}

// Utility functions
function logout() {
    sessionStorage.removeItem('staffUser');
    sessionStorage.removeItem('staffLoggedIn');
    window.location.href = '/';
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${getNotificationIcon(type)}"></i>
        <span>${message}</span>
    `;
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--warning)'};
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function getNotificationIcon(type) {
    switch(type) {
        case 'success': return 'check-circle';
        case 'error': return 'exclamation-circle';
        case 'warning': return 'exclamation-triangle';
        default: return 'info-circle';
    }
}
