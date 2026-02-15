// P.X HB Support - Main JavaScript
const socket = io();
let isSendingMessage = false;
let lastMessageTime = 0;

let isTyping = false;
let typingTimer = null;
let staffTypingTimer = null;
let defaultStatusLabel = 'Support Team';

let audioCtx = null;
let audioUnlocked = false;

let displayName = 'User';

let preChatReady = false;

const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const seenMessageIds = new Set();

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function () {
    // Load existing messages
    socket.on('loadMessages', (messages) => {
        const list = Array.isArray(messages) ? messages : [];
        list.forEach((msg) => {
            if (msg && msg.id != null) seenMessageIds.add(String(msg.id));
            if (msg && msg.image && msg.image.dataUrl) {
                addImageMessage(msg.image.dataUrl, msg?.type || 'user');
            } else {
                addMessage(msg?.text || '', msg?.type || 'user');
            }
        });
    });

    // Handle new messages
    socket.on('newMessage', (message) => {
        const msgId = message && message.id != null ? String(message.id) : null;
        if (msgId && seenMessageIds.has(msgId)) return;
        if (msgId) seenMessageIds.add(msgId);
        if (message && message.image && message.image.dataUrl) {
            addImageMessage(message.image.dataUrl, message?.type || 'user');
        } else {
            addMessage(message?.text || '', message?.type || 'user');
        }

        if ((message?.type || '').toLowerCase() === 'staff') {
            playNotificationSound();
        }
    });

    // Handle staff status updates
    socket.on('staffStatusUpdate', (status) => {
        updateStaffStatus(status);
    });

    socket.on('lockdownUpdate', (state) => {
        handleLockdownUpdate(state);
    });

    socket.on('staffTyping', (payload) => {
        updateStaffTyping(Boolean(payload && payload.isTyping), payload?.user || null);
    });

    socket.on('messageReceipt', (payload) => {
        handleMessageReceipt(payload);
    });

    // Check for existing staff session
    checkStaffSession();

    initDisplayName();
    socket.emit('setUserName', { name: displayName });

    socket.emit('clientMeta', { path: window.location.pathname, ua: navigator.userAgent });

    initPreChatGate();

    const input = document.getElementById('chatInput');
    if (input) {
        input.addEventListener('input', () => {
            emitTypingState(true);
        });

        input.addEventListener('blur', () => {
            emitTypingState(false);
        });
    }

    setupAudioUnlock();
});

function handleLockdownUpdate(state) {
    const enabled = Boolean(state && state.enabled);
    const input = document.getElementById('chatInput');
    const sendBtn = document.querySelector('.chat-send-btn');
    const attachBtn = document.querySelector('.chat-attach-btn');
    const reason = state && state.reason ? String(state.reason) : '';

    if (enabled) {
        if (input) input.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (attachBtn) attachBtn.disabled = true;
        addMessage(reason ? `Chat locked: ${reason}` : 'Chat is temporarily locked by staff.', 'system');
        const statusText = document.querySelector('.chat-status span:last-child');
        if (statusText) statusText.textContent = 'Support Team - Locked';
    } else {
        if (preChatReady) {
            if (input) input.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            if (attachBtn) attachBtn.disabled = false;
        }
        const statusText = document.querySelector('.chat-status span:last-child');
        if (statusText) statusText.textContent = defaultStatusLabel;
    }
}

function initPreChatGate() {
    const gate = document.getElementById('preChatGate');
    const input = document.getElementById('chatInput');
    const sendBtn = document.querySelector('.chat-send-btn');
    const attachBtn = document.querySelector('.chat-attach-btn');

    preChatReady = false;
    if (gate) gate.style.display = 'flex';
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    if (attachBtn) attachBtn.disabled = true;
}

function submitPreChatForm() {
    const issue = document.getElementById('preChatIssue')?.value || '';
    const desc = (document.getElementById('preChatDesc')?.value || '').trim();
    if (!issue || !desc) return;

    socket.emit('preChatSubmit', { issue, desc });

    const gate = document.getElementById('preChatGate');
    const input = document.getElementById('chatInput');
    const sendBtn = document.querySelector('.chat-send-btn');
    const attachBtn = document.querySelector('.chat-attach-btn');

    preChatReady = true;
    if (gate) gate.style.display = 'none';
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
    if (input) input.focus();
}

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

    if (!preChatReady) return;
    if (message && !isSendingMessage && (currentTime - lastMessageTime) > 600) {
        isSendingMessage = true;
        lastMessageTime = currentTime;

        if (input) input.value = '';

        const clientMsgId = `${clientId}-${currentTime}`;
        socket.emit('sendMessage', {
            id: clientMsgId,
            clientId,
            text: message,
            user: displayName,
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

    if (!preChatReady) return;
    if (msg && !isSendingMessage && (currentTime - lastMessageTime) > 600) {
        isSendingMessage = true;
        lastMessageTime = currentTime;

        const clientMsgId = `${clientId}-${currentTime}`;
        socket.emit('sendMessage', {
            id: clientMsgId,
            clientId,
            text: msg,
            user: displayName,
            type: 'user'
        });

        setTimeout(() => {
            isSendingMessage = false;
        }, 300);
    }
}

function initDisplayName() {
    const stored = sessionStorage.getItem('pxhb_displayName');
    if (stored && String(stored).trim()) {
        displayName = String(stored).trim().slice(0, 40);
        return;
    }

    try {
        const name = window.prompt('Choose a username for support chat:', '') || '';
        const cleaned = String(name).trim().slice(0, 40);
        if (cleaned) {
            displayName = cleaned;
            sessionStorage.setItem('pxhb_displayName', displayName);
        }
    } catch {
        // ignore
    }
}

function addMessage(text, type) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    messageDiv.innerHTML = `<div class="message-content"><p>${escapeHtml(String(text))}</p></div>`;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addImageMessage(dataUrl, type) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `<div class="message-content"><img class="message-image" src="${escapeHtml(String(dataUrl))}" alt="upload" /></div>`;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function openChatImagePicker() {
    if (!preChatReady) return;
    const input = document.getElementById('chatImageInput');
    if (input) input.click();
}

function handleChatImageSelected(event) {
    if (!preChatReady) return;
    const file = event?.target?.files?.[0];
    if (!file) return;
    const input = document.getElementById('chatImageInput');
    if (input) input.value = '';

    const mime = String(file.type || '').toLowerCase();
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return;
    if (file.size > 5 * 1024 * 1024) return;

    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl.startsWith('data:image/')) return;
        socket.emit('sendImage', {
            dataUrl,
            size: file.size,
            mime,
            name: file.name,
            user: displayName
        });
    };
    reader.readAsDataURL(file);
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

function setupAudioUnlock() {
    const unlock = () => {
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            audioUnlocked = true;
        } catch {
            // ignore
        }
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
    };

    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
}

function playNotificationSound() {
    try {
        if (!audioUnlocked) return;
        if (!audioCtx) return;

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.17);
    } catch {
        // ignore
    }
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