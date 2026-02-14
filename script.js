// P.X HB Support - Main JavaScript
const socket = io();
let isSendingMessage = false;
let lastMessageTime = 0;

const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const seenMessageIds = new Set();

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function () {
    // Load existing messages
    socket.on('loadMessages', (messages) => {
        const list = Array.isArray(messages) ? messages : [];
        list.forEach((msg) => {
            if (msg && msg.id != null) seenMessageIds.add(String(msg.id));
            addMessage(msg?.text || '', msg?.type || 'user');
        });
    });

    // Handle new messages
    socket.on('newMessage', (message) => {
        const msgId = message && message.id != null ? String(message.id) : null;
        if (msgId && seenMessageIds.has(msgId)) return;
        if (msgId) seenMessageIds.add(msgId);
        addMessage(message?.text || '', message?.type || 'user');
    });

    // Handle staff status updates
    socket.on('staffStatusUpdate', (status) => {
        updateStaffStatus(status);
    });

    socket.on('staffTyping', (payload) => {
        updateStaffTyping(Boolean(payload && payload.isTyping), payload?.user || null);
    });

    socket.on('messageReceipt', (payload) => {
        handleMessageReceipt(payload);
    });

    // Check for existing staff session
    checkStaffSession();

    const input = document.getElementById('chatInput');
    if (input) {
        input.addEventListener('input', () => {
            emitTypingState(true);
        });

        input.addEventListener('blur', () => {
            emitTypingState(false);
        });
    }
});

// Chat functions
function openChat() {
    const panel = document.getElementById('chatPanel');
    const input = document.getElementById('chatInput');

    if (panel && panel.scrollIntoView) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (input) {
        setTimeout(() => input.focus(), 200);
    }
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = (input?.value || '').trim();
    const currentTime = Date.now();

    if (message && !isSendingMessage && (currentTime - lastMessageTime) > 600) {
        isSendingMessage = true;
        lastMessageTime = currentTime;

        if (input) input.value = '';

        const clientMsgId = `${clientId}-${currentTime}`;
        socket.emit('sendMessage', {
            id: clientMsgId,
            clientId,
            text: message,
            user: 'User',
            type: 'user'
        });

        setTimeout(() => {
            isSendingMessage = false;
        }, 300);
    }
}

function sendQuickMessage(message) {
    const msg = (message || '').trim();
    const currentTime = Date.now();

    if (msg && !isSendingMessage && (currentTime - lastMessageTime) > 600) {
        isSendingMessage = true;
        lastMessageTime = currentTime;

        const clientMsgId = `${clientId}-${currentTime}`;
        socket.emit('sendMessage', {
            id: clientMsgId,
            clientId,
            text: msg,
            user: 'User',
            type: 'user'
        });

        setTimeout(() => {
            isSendingMessage = false;
        }, 300);
    }
}

function addMessage(text, type) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    messageDiv.innerHTML = `
        <div class="message-content">
            <p>${escapeHtml(String(text))}</p>
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

function emitTypingState(next) {
    const wantsTyping = Boolean(next);

    if (wantsTyping !== isTyping) {
        isTyping = wantsTyping;
        socket.emit('userTyping', { clientId, isTyping: wantsTyping });
    }

    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        if (isTyping) {
            isTyping = false;
            socket.emit('userTyping', { clientId, isTyping: false });
        }
    }, 1200);
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Staff login functions
function showStaffLogin() {
    const modal = document.getElementById('staffLoginModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const form = document.getElementById('staffLoginForm');
    if (form) {
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        newForm.addEventListener('submit', handleStaffLogin);
    }
}

function closeStaffLogin() {
    const modal = document.getElementById('staffLoginModal');
    if (modal) modal.style.display = 'none';
}

function showMobileStaffLogin() {
    const modal = document.getElementById('mobileStaffLoginModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const form = document.getElementById('mobileStaffLoginForm');
    if (form) {
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        newForm.addEventListener('submit', handleStaffLogin);
    }
}

function closeMobileStaffLogin() {
    const modal = document.getElementById('mobileStaffLoginModal');
    if (modal) modal.style.display = 'none';
}

function handleStaffLogin(event) {
    event.preventDefault();

    const username = event.target.querySelector('input[type="text"]')?.value || '';
    const password = event.target.querySelector('input[type="password"]')?.value || '';

    fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => {
            sessionStorage.setItem('staffUser', data.user);
            sessionStorage.setItem('staffLoggedIn', 'true');
            closeStaffLogin();
            closeMobileStaffLogin();
            showNotification('Staff login successful!', 'success');

            // Socket is used for staff status broadcast only
            socket.emit('staffLogin', { username, password });

            setTimeout(() => {
                window.location.href = '/admin';
            }, 250);
        })
        .catch(() => {
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
    // no-op for now
}

function updateStaffStatus(status) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.chat-status span:last-child');

    if (!statusDot || !statusText) return;

    if (status?.isOnline) {
        statusDot.style.background = 'var(--success)';
        defaultStatusLabel = `${status.user} - Online`;
        statusText.textContent = defaultStatusLabel;
    } else {
        statusDot.style.background = 'var(--warning)';
        defaultStatusLabel = 'Support Team - Offline';
        statusText.textContent = defaultStatusLabel;
    }
}

function updateStaffTyping(isStaffTypingNow, staffUser) {
    const statusText = document.querySelector('.chat-status span:last-child');
    if (!statusText) return;

    if (staffTypingTimer) clearTimeout(staffTypingTimer);

    if (isStaffTypingNow) {
        const who = staffUser ? String(staffUser) : 'Support';
        statusText.textContent = `${who} is typing...`;
        staffTypingTimer = setTimeout(() => {
            statusText.textContent = defaultStatusLabel;
        }, 1600);
    } else {
        statusText.textContent = defaultStatusLabel;
    }
}

function handleMessageReceipt(payload) {
    const status = String(payload?.status || '').toLowerCase();
    if (!status) return;
    // No UI changes: background signal only
    console.log('Message receipt:', status, payload);
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${getNotificationIcon(type)}"></i>
        <span>${escapeHtml(String(message))}</span>
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
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 2500);
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success':
            return 'check-circle';
        case 'error':
            return 'exclamation-circle';
        case 'warning':
            return 'exclamation-triangle';
        default:
            return 'info-circle';
    }
}