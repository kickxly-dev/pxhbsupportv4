// P.X HB Admin Panel JavaScript
const socket = io();
let currentSection = 'dashboard';
let selectedChat = null;
let conversationsById = new Map();

let isAdminTyping = false;
let adminTypingTimer = null;

const CANNED_RESPONSES = {
    '1': 'Thanks for reaching out — what’s your username and what happened?',
    '2': 'Can you send a screenshot and your device/browser? I’ll take a look.',
    '3': 'We’re on it. Typical response time is a few minutes — thanks for your patience.'
};

// Initialize admin panel
document.addEventListener('DOMContentLoaded', function () {
    checkAuth();
    loadDashboardData();
    setupSocketEvents();
    socket.emit('adminInit');

    const input = document.getElementById('adminChatInput');
    if (input) {
        input.addEventListener('input', () => emitAdminTyping(true));
        input.addEventListener('blur', () => emitAdminTyping(false));
    }

    document.addEventListener('keydown', handleAdminHotkeys);
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

    socket.on('userTyping', (payload) => {
        const socketId = payload?.socketId;
        const typing = Boolean(payload?.isTyping);
        if (!socketId || !typing) return;
        if (selectedChat && socketId === selectedChat) {
            // Background signal only (no UI changes)
            console.log('User typing:', socketId);
        }
    });
}

function emitAdminTyping(next) {
    const wants = Boolean(next);
    if (!selectedChat) return;

    if (wants !== isAdminTyping) {
        isAdminTyping = wants;
        socket.emit('staffTyping', { socketId: selectedChat, isTyping: wants });
    }

    if (adminTypingTimer) clearTimeout(adminTypingTimer);
    adminTypingTimer = setTimeout(() => {
        if (isAdminTyping) {
            isAdminTyping = false;
            socket.emit('staffTyping', { socketId: selectedChat, isTyping: false });
        }
    }, 1200);
}

function handleAdminHotkeys(event) {
    if (event.defaultPrevented) return;

    const activeEl = document.activeElement;
    const isChatInputFocused = activeEl && activeEl.id === 'adminChatInput';
    if (!isChatInputFocused) return;

    const key = String(event.key || '');

    if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
        if (key.toLowerCase() === 't') {
            if (!selectedChat) return;
            event.preventDefault();
            exportTranscript(selectedChat, { mode: 'download' });
            return;
        }

        if (key.toLowerCase() === 'c') {
            if (!selectedChat) return;
            event.preventDefault();
            exportTranscript(selectedChat, { mode: 'copy' });
            return;
        }
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (CANNED_RESPONSES[key]) {
        event.preventDefault();
        const input = document.getElementById('adminChatInput');
        if (input) {
            const base = CANNED_RESPONSES[key];
            input.value = input.value ? `${input.value} ${base}` : base;
            input.focus();
            emitAdminTyping(true);
        }
        return;
    }
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

    isAdminTyping = false;
    socket.emit('staffTyping', { socketId, isTyping: false });
}

function sendAdminMessage() {
    const input = document.getElementById('adminChatInput');
    const message = (input?.value || '').trim();
    if (!message || !selectedChat) return;

    if (message.startsWith('/')) {
        const handled = handleSlashCommand(message);
        if (handled) {
            if (input) input.value = '';
            emitAdminTyping(false);
            return;
        }
    }

    socket.emit('adminSendMessage', { socketId: selectedChat, text: message });
    if (input) input.value = '';

    emitAdminTyping(false);
}

function handleSlashCommand(raw) {
    const line = String(raw || '').trim();
    if (!line.startsWith('/')) return false;
    if (!selectedChat) return false;

    const tokens = line.slice(1).split(/\s+/).filter(Boolean);
    const cmd = String(tokens.shift() || '').toLowerCase();
    const rest = tokens.join(' ');

    if (!cmd) return false;

    if (cmd === 'mute') {
        const minutes = Number(tokens[0] || 0);
        const ms = Math.max(0, Math.min(Number.isFinite(minutes) ? minutes : 0, 60 * 24 * 7)) * 60 * 1000;
        socket.emit('adminModerationAction', { socketId: selectedChat, action: 'mute', durationMs: ms });
        return true;
    }

    if (cmd === 'unmute') {
        socket.emit('adminModerationAction', { socketId: selectedChat, action: 'unmute' });
        return true;
    }

    if (cmd === 'ban') {
        socket.emit('adminModerationAction', { socketId: selectedChat, action: 'ban' });
        return true;
    }

    if (cmd === 'unban') {
        socket.emit('adminModerationAction', { socketId: selectedChat, action: 'unban' });
        return true;
    }

    if (cmd === 'close') {
        socket.emit('adminModerationAction', { socketId: selectedChat, action: 'disconnect' });
        return true;
    }

    if (cmd === 'tag') {
        const sub = String(tokens[0] || '').toLowerCase();
        const tag = String(tokens.slice(1).join(' ') || '').trim();
        const conv = conversationsById.get(selectedChat);
        const current = Array.isArray(conv?.tags) ? conv.tags.map((t) => String(t)) : [];
        let next = current.slice();

        if (sub === 'add' && tag) {
            if (!next.includes(tag)) next.push(tag);
        } else if ((sub === 'remove' || sub === 'rm' || sub === 'del') && tag) {
            next = next.filter((t) => t !== tag);
        } else {
            return false;
        }

        socket.emit('adminUpdateConversation', { socketId: selectedChat, tags: next, notes: conv?.notes || '' });
        return true;
    }

    if (cmd === 'note') {
        const conv = conversationsById.get(selectedChat);
        const existing = conv?.notes ? String(conv.notes) : '';
        const next = existing ? `${existing}\n${rest}` : rest;
        socket.emit('adminUpdateConversation', { socketId: selectedChat, tags: conv?.tags || [], notes: next });
        return true;
    }

    return false;
}

function buildTranscriptText(data) {
    const name = data?.name ? String(data.name) : String(data?.socketId || 'Chat');
    const list = Array.isArray(data?.messages) ? data.messages : [];

    const lines = [];
    lines.push(`P.X HB Transcript - ${name}`);
    lines.push(`Chat ID: ${data?.socketId || ''}`);
    lines.push(`Exported: ${new Date().toISOString()}`);
    lines.push('');

    list.forEach((m) => {
        const at = m?.timestamp ? new Date(m.timestamp).toISOString() : '';
        const who = m?.user ? String(m.user) : (m?.type === 'staff' ? 'Staff' : 'User');
        const text = m?.text != null ? String(m.text) : '';
        lines.push(`[${at}] ${who}: ${text}`);
    });
    lines.push('');
    return lines.join('\n');
}

function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function exportTranscript(socketId, { mode }) {
    try {
        const res = await fetch(`/api/admin/transcript/${encodeURIComponent(String(socketId))}`);
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        const text = buildTranscriptText(data);

        if (mode === 'copy') {
            await navigator.clipboard.writeText(text);
            return;
        }

        const safeName = String(data?.name || socketId).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
        downloadText(`pxhb_transcript_${safeName}.txt`, text);
    } catch (err) {
        console.warn('Transcript export failed', err);
    }
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