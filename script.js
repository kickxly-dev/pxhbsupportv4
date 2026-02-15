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

let lockdownAlarm = { osc: null, gain: null };

let displayName = 'User';

let liveAssistOptIn = false;
let liveAssistCursorTimer = null;
let lastLiveAssistSentAt = 0;

let guidanceOptIn = false;
let spotlightState = { enabled: false, x: 0.5, y: 0.5, at: 0 };

let guidedFixState = { enabled: false, id: null, title: null, steps: [], pingStepId: null, pingAt: 0 };

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
            } else if (msg && msg.file && msg.file.dataUrl) {
                addFileMessage(msg.file, msg?.type || 'user');
            } else {
                addMessage(msg?.text || '', msg?.type || 'user');
            }
        });
    });

    socket.on('guidanceFixState', (payload) => {
        guidedFixState = {
            enabled: Boolean(payload && payload.enabled),
            id: payload?.id ? String(payload.id) : null,
            title: payload?.title ? String(payload.title) : null,
            steps: Array.isArray(payload?.steps) ? payload.steps : [],
            pingStepId: guidedFixState.pingStepId,
            pingAt: guidedFixState.pingAt
        };
        renderGuidedFixOverlay();
    });

    socket.on('guidanceFixPing', (payload) => {
        const stepId = payload?.stepId ? String(payload.stepId) : null;
        if (!stepId) return;
        guidedFixState.pingStepId = stepId;
        guidedFixState.pingAt = Date.now();
        renderGuidedFixOverlay();
        setTimeout(() => {
            if (guidedFixState.pingStepId === stepId && Date.now() - guidedFixState.pingAt >= 1500) {
                guidedFixState.pingStepId = null;
                renderGuidedFixOverlay();
            }
        }, 1600);
    });

    // Handle new messages
    socket.on('newMessage', (message) => {
        const msgId = message && message.id != null ? String(message.id) : null;
        if (msgId && seenMessageIds.has(msgId)) return;
        if (msgId) seenMessageIds.add(msgId);
        if (message && message.image && message.image.dataUrl) {
            addImageMessage(message.image.dataUrl, message?.type || 'user');
        } else if (message && message.file && message.file.dataUrl) {
            addFileMessage(message.file, message?.type || 'user');
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

    try {
        const t = document.getElementById('liveAssistToggle');
        if (t) t.checked = false;
    } catch {
        // ignore
    }

    try {
        const g = document.getElementById('guidanceToggle');
        if (g) g.checked = false;
    } catch {
        // ignore
    }

    socket.on('guidanceSpotlight', (payload) => {
        const enabled = Boolean(payload && payload.enabled);
        const x = Number(payload && payload.x);
        const y = Number(payload && payload.y);
        spotlightState = {
            enabled,
            x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : spotlightState.x,
            y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : spotlightState.y,
            at: Date.now()
        };
        renderSpotlightOverlay();
    });

    socket.on('guidancePing', (payload) => {
        const x = Number(payload && payload.x);
        const y = Number(payload && payload.y);
        spawnSpotlightPing({
            x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : spotlightState.x,
            y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : spotlightState.y
        });
    });

    setupLiveAssistCapture();
});

function ensureGuidedFixOverlay() {
    let el = document.getElementById('guidedFixOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'guidedFixOverlay';
    el.className = 'guidedfix-overlay';
    document.body.appendChild(el);
    return el;
}

function renderGuidedFixOverlay() {
    const overlay = ensureGuidedFixOverlay();
    if (!overlay) return;

    if (!guidanceOptIn || !guidedFixState?.enabled || !guidedFixState?.id) {
        overlay.style.display = 'none';
        overlay.innerHTML = '';
        return;
    }

    overlay.style.display = 'block';

    const title = guidedFixState.title ? guidedFixState.title : 'Fix Steps';
    const steps = Array.isArray(guidedFixState.steps) ? guidedFixState.steps : [];

    const items = steps
        .map((s) => {
            const sid = s?.id ? String(s.id) : '';
            const text = s?.text ? String(s.text) : '';
            const done = Boolean(s?.done);
            const pinged = guidedFixState.pingStepId && String(guidedFixState.pingStepId) === sid;
            if (!sid || !text) return '';
            return `
                <label class="guidedfix-item ${done ? 'done' : ''} ${pinged ? 'ping' : ''}" data-step-id="${escapeHtml(sid)}">
                    <input type="checkbox" ${done ? 'checked' : ''} onchange="toggleGuidedFixStep('${escapeHtml(sid)}', this.checked)">
                    <span>${escapeHtml(text)}</span>
                </label>
            `;
        })
        .join('');

    overlay.innerHTML = `
        <div class="guidedfix-card">
            <div class="guidedfix-header">
                <div class="guidedfix-title">${escapeHtml(title)}</div>
                <button class="guidedfix-hide" onclick="hideGuidedFixOverlay()">Hide</button>
            </div>
            <div class="guidedfix-body">${items || '<div class="guidedfix-empty">No steps.</div>'}</div>
        </div>
    `;
}

function hideGuidedFixOverlay() {
    const overlay = document.getElementById('guidedFixOverlay');
    if (overlay) overlay.style.display = 'none';
}

function toggleGuidedFixStep(stepId, done) {
    if (!guidanceOptIn) return;
    const sid = String(stepId || '');
    if (!sid || !guidedFixState?.id) return;
    socket.emit('userGuidanceFixToggle', { id: guidedFixState.id, stepId: sid, done: Boolean(done) });
}

function setGuidanceOptInFromUi() {
    const enabled = Boolean(document.getElementById('guidanceToggle')?.checked);
    guidanceOptIn = enabled;
    socket.emit('guidanceOptIn', { enabled });
    if (!enabled) {
        spotlightState = { enabled: false, x: spotlightState.x, y: spotlightState.y, at: Date.now() };
        renderSpotlightOverlay();
    }
}

function ensureSpotlightOverlay() {
    let el = document.getElementById('spotlightOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'spotlightOverlay';
    el.className = 'spotlight-overlay';
    el.innerHTML = `
        <div class="spotlight-dim"></div>
        <div class="spotlight-hole" id="spotlightHole"></div>
        <div class="spotlight-pointer" id="spotlightPointer"></div>
    `;
    document.body.appendChild(el);
    return el;
}

function renderSpotlightOverlay() {
    const enabled = Boolean(spotlightState && spotlightState.enabled);
    const overlay = ensureSpotlightOverlay();
    if (!overlay) return;
    overlay.style.display = enabled ? 'block' : 'none';
    if (!enabled) return;
    const hole = document.getElementById('spotlightHole');
    const ptr = document.getElementById('spotlightPointer');
    const x = `${Math.round(spotlightState.x * 1000) / 10}%`;
    const y = `${Math.round(spotlightState.y * 1000) / 10}%`;
    if (hole) {
        hole.style.left = x;
        hole.style.top = y;
    }
    if (ptr) {
        ptr.style.left = x;
        ptr.style.top = y;
    }
}

function spawnSpotlightPing({ x, y } = {}) {
    const overlay = ensureSpotlightOverlay();
    if (!overlay) return;
    const px = `${Math.round((Number(x) || 0.5) * 1000) / 10}%`;
    const py = `${Math.round((Number(y) || 0.5) * 1000) / 10}%`;
    const ping = document.createElement('div');
    ping.className = 'spotlight-ping';
    ping.style.left = px;
    ping.style.top = py;
    overlay.appendChild(ping);
    setTimeout(() => ping.remove(), 900);
}

function setLiveAssistOptInFromUi() {
    const enabled = Boolean(document.getElementById('liveAssistToggle')?.checked);
    liveAssistOptIn = enabled;
    socket.emit('liveAssistOptIn', { enabled });
}

function setupLiveAssistCapture() {
    if (liveAssistCursorTimer) return;
    const onMove = (ev) => {
        if (!liveAssistOptIn) return;
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - lastLiveAssistSentAt < 50) return;
        lastLiveAssistSentAt = now;

        const x = Math.max(0, Math.min(window.innerWidth, Number(ev.clientX || 0)));
        const y = Math.max(0, Math.min(window.innerHeight, Number(ev.clientY || 0)));
        socket.emit('liveAssistCursor', { x, y, w: window.innerWidth, h: window.innerHeight, at: now });
    };

    const onClick = (ev) => {
        if (!liveAssistOptIn) return;
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        const x = Math.max(0, Math.min(window.innerWidth, Number(ev.clientX || 0)));
        const y = Math.max(0, Math.min(window.innerHeight, Number(ev.clientY || 0)));
        socket.emit('liveAssistClick', { x, y, w: window.innerWidth, h: window.innerHeight, at: now });
    };

    const onVis = () => {
        // Visibility gate happens in onMove/onClick
    };

    try {
        window.addEventListener('mousemove', onMove, { passive: true });
        window.addEventListener('click', onClick, { passive: true });
        document.addEventListener('visibilitychange', onVis);
        liveAssistCursorTimer = { onMove, onClick, onVis };
    } catch {
        // ignore
    }
}

function handleLockdownUpdate(state) {
    const enabled = Boolean(state && state.enabled);
    const input = document.getElementById('chatInput');
    const sendBtn = document.querySelector('.chat-send-btn');
    const attachBtn = document.querySelector('.chat-attach-btn');
    const reason = state && state.reason ? String(state.reason) : '';
    const banner = document.getElementById('globalBanner');

    try {
        if (enabled) {
            document.body.classList.add('lockdown-active');
        } else {
            document.body.classList.remove('lockdown-active');
        }
    } catch {
        // ignore
    }

    if (enabled) {
        if (input) input.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (attachBtn) attachBtn.disabled = true;
        addMessage(reason ? `Chat locked: ${reason}` : 'Chat is temporarily locked by staff.', 'system');
        const statusText = document.querySelector('.chat-status span:last-child');
        if (statusText) statusText.textContent = 'Support Team - Locked';

        if (banner) {
            banner.style.display = 'block';
            banner.innerHTML = `
                <div class="banner-inner">
                    <div class="banner-left">
                        <div class="banner-icon"><i class="fas fa-triangle-exclamation"></i></div>
                        <div class="banner-text">${escapeHtml(reason ? `Lockdown active: ${reason}` : 'Lockdown active: Chat is temporarily locked by staff.')}</div>
                    </div>
                    <div class="banner-right">
                        <button class="banner-btn" onclick="this.closest('#globalBanner').style.display='none'">Dismiss</button>
                    </div>
                </div>
            `;
        }

        startLockdownAlarm();
    } else {
        if (preChatReady) {
            if (input) input.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            if (attachBtn) attachBtn.disabled = false;
        }
        const statusText = document.querySelector('.chat-status span:last-child');
        if (statusText) statusText.textContent = defaultStatusLabel;

        if (banner) {
            banner.style.display = 'none';
            banner.innerHTML = '';
        }

        stopLockdownAlarm();
    }
}

function startLockdownAlarm() {
    try {
        if (!audioUnlocked) return;
        if (!audioCtx) return;
        if (lockdownAlarm.osc) return;

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.05);

        osc.frequency.setValueAtTime(520, now);
        osc.frequency.linearRampToValueAtTime(880, now + 0.35);
        osc.frequency.linearRampToValueAtTime(520, now + 0.7);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(now);

        const lfo = () => {
            if (!lockdownAlarm.osc) return;
            const t = audioCtx.currentTime;
            lockdownAlarm.osc.frequency.cancelScheduledValues(t);
            lockdownAlarm.osc.frequency.setValueAtTime(520, t);
            lockdownAlarm.osc.frequency.linearRampToValueAtTime(880, t + 0.35);
            lockdownAlarm.osc.frequency.linearRampToValueAtTime(520, t + 0.7);
        };
        const timer = setInterval(lfo, 700);

        lockdownAlarm = { osc, gain, timer };
    } catch {
        // ignore
    }
}

function stopLockdownAlarm() {
    try {
        if (lockdownAlarm.timer) clearInterval(lockdownAlarm.timer);
        if (lockdownAlarm.gain && audioCtx) {
            const now = audioCtx.currentTime;
            lockdownAlarm.gain.gain.cancelScheduledValues(now);
            lockdownAlarm.gain.gain.setValueAtTime(lockdownAlarm.gain.gain.value || 0.0001, now);
            lockdownAlarm.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        }
        if (lockdownAlarm.osc && audioCtx) {
            lockdownAlarm.osc.stop(audioCtx.currentTime + 0.13);
        }
    } catch {
        // ignore
    }
    lockdownAlarm = { osc: null, gain: null, timer: null };
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

function addFileMessage(file, type) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;

    const dataUrl = String(file?.dataUrl || '');
    const mime = String(file?.mime || '').toLowerCase();
    const name = escapeHtml(String(file?.name || 'file'));
    const size = Number(file?.size || 0);
    const sizeText = size ? `${Math.round(size / 1024)} KB` : '';

    const icon = mime === 'application/pdf' ? 'file-pdf' : 'file';
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `<div class="message-content"><a class="file-card" href="${escapeHtml(dataUrl)}" download="${name}"><i class="fas fa-${icon}"></i><span>${name}</span><em>${escapeHtml(sizeText)}</em></a></div>`;
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
    const isImage = mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp';
    const isPdf = mime === 'application/pdf';
    if (!isImage && !isPdf) return;
    if (isImage && file.size > 5 * 1024 * 1024) return;
    if (isPdf && file.size > 10 * 1024 * 1024) return;

    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (isImage) {
            if (!dataUrl.startsWith('data:image/')) return;
            socket.emit('sendImage', {
                dataUrl,
                size: file.size,
                mime,
                name: file.name,
                user: displayName
            });
        } else if (isPdf) {
            if (!dataUrl.startsWith('data:application/pdf')) return;
            socket.emit('sendFile', {
                dataUrl,
                size: file.size,
                mime,
                name: file.name,
                user: displayName
            });
        }
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
    showToast({
        title: type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Notice',
        message: String(message),
        type: type || 'warning'
    });
}

function showToast({ title, message, type, durationMs } = {}) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const t = String(type || 'warning').toLowerCase();
    const toast = document.createElement('div');
    toast.className = `toast toast-${t}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas fa-${getNotificationIcon(t)}"></i></div>
        <div class="toast-body">
            <p class="toast-title">${escapeHtml(String(title || 'Notice'))}</p>
            <p class="toast-message">${escapeHtml(String(message || ''))}</p>
        </div>
    `;

    container.appendChild(toast);
    const ms = Number.isFinite(durationMs) ? durationMs : 2600;
    setTimeout(() => {
        toast.classList.add('closing');
        setTimeout(() => toast.remove(), 220);
    }, ms);
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