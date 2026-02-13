// P.X HB Support - Main JavaScript
const socket = io();
let isChatOpen = false;
let isSendingMessage = false;
let lastMessageTime = 0;

// Staff credentials
const STAFF_CREDENTIALS = {
    'admin': 'pxhb2024',
    'support': 'support123',
    'moderator': 'mod456'
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('P.X HB Support initialized');
    
    // Load existing messages
    socket.on('loadMessages', (messages) => {
        messages.forEach(msg => addMessage(msg.text, msg.type || 'user'));
    });
    
    // Handle new messages
    socket.on('newMessage', (message) => {
        addMessage(message.text, message.type || 'user');
    });
    
    // Handle staff status updates
    socket.on('staffStatusUpdate', (status) => {
        updateStaffStatus(status);
    });
    
    // Check for existing staff session
    checkStaffSession();
});

// Chat functions
function toggleChat() {
    const chatWidget = document.getElementById('chatWidget');
    isChatOpen = !isChatOpen;
    
    if (isChatOpen) {
        chatWidget.style.display = 'flex';
        chatWidget.classList.remove('minimized');
    } else {
        chatWidget.style.display = 'none';
    }
}

function minimizeChat() {
    const chatWidget = document.getElementById('chatWidget');
    chatWidget.classList.add('minimized');
}

function closeChat() {
    const chatWidget = document.getElementById('chatWidget');
    chatWidget.style.display = 'none';
    isChatOpen = false;
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    const currentTime = Date.now();
    
    // Prevent multiple sends and duplicate messages
    if (message && !isSendingMessage && (currentTime - lastMessageTime) > 1000) {
        isSendingMessage = true;
        lastMessageTime = currentTime;
        
        // Clear input immediately
        input.value = '';
        
        // Send message to server
        socket.emit('sendMessage', {
            text: message,
            user: 'User',
            type: 'user'
        });
        
        // Add message to UI
        addMessage(message, 'user');
        
        // Reset sending flag
        setTimeout(() => {
            isSendingMessage = false;
        }, 500);
    }
}

function sendQuickMessage(message) {
    const currentTime = Date.now();
    
    if (!isSendingMessage && (currentTime - lastMessageTime) > 1000) {
        isSendingMessage = true;
        lastMessageTime = currentTime;
        
        // Send message to server
        socket.emit('sendMessage', {
            text: message,
            user: 'User',
            type: 'user'
        });
        
        // Add message to UI
        addMessage(message, 'user');
        
        // Reset sending flag
        setTimeout(() => {
            isSendingMessage = false;
        }, 500);
    }
}

function addMessage(text, type) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <p>${text}</p>
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// Staff login functions
function showStaffLogin() {
    const modal = document.getElementById('staffLoginModal');
    modal.style.display = 'flex';
    
    // Handle form submission
    document.getElementById('staffLoginForm').addEventListener('submit', handleStaffLogin);
}

function closeStaffLogin() {
    const modal = document.getElementById('staffLoginModal');
    modal.style.display = 'none';
}

function showMobileStaffLogin() {
    const modal = document.getElementById('mobileStaffLoginModal');
    modal.style.display = 'flex';
    
    // Handle form submission
    document.getElementById('mobileStaffLoginForm').addEventListener('submit', handleStaffLogin);
}

function closeMobileStaffLogin() {
    const modal = document.getElementById('mobileStaffLoginModal');
    modal.style.display = 'none';
}

function handleStaffLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('mobileStaffUsername').value;
    const password = document.getElementById('mobileStaffPassword').value;
    
    // Send login request to server
    socket.emit('staffLogin', { username, password });
    
    // Handle response
    socket.on('loginSuccess', (data) => {
        sessionStorage.setItem('staffUser', data.user);
        sessionStorage.setItem('staffLoggedIn', 'true');
        closeMobileStaffLogin();
        showNotification('Staff login successful!', 'success');
        window.location.href = '/admin';
    });
    
    socket.on('loginError', (error) => {
        showNotification('Invalid credentials', 'error');
    });
}

function checkStaffSession() {
    const staffUser = sessionStorage.getItem('staffUser');
    const staffLoggedIn = sessionStorage.getItem('staffLoggedIn');
    
    if (staffUser && staffLoggedIn === 'true') {
        updateStaffUI();
    }
}

function updateStaffUI() {
    const staffUser = sessionStorage.getItem('staffUser');
    if (staffUser) {
        // Update UI to show staff is logged in
        console.log('Staff logged in:', staffUser);
    }
}

function updateStaffStatus(status) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.chat-status span');
    
    if (status.isOnline) {
        statusDot.style.background = 'var(--success)';
        statusText.textContent = `${status.user} - Online`;
    } else {
        statusDot.style.background = 'var(--warning)';
        statusText.textContent = 'Support Team - Offline';
    }
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
