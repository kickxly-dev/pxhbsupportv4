// P.X HB Admin Panel JavaScript
const socket = io({ auth: { admin: true } });
let currentSection = 'dashboard';
let selectedChat = null;
let conversationsById = new Map();

let ticketsById = new Map();
let selectedTicketId = null;
let ticketFilter = 'open';

let isAdminTyping = false;
let adminTypingTimer = null;

const CANNED_RESPONSES = {
    '1': 'Thanks for reaching out — what’s your username and what happened?',
    '2': 'Can you send a screenshot and your device/browser? I’ll take a look.',
    '3': 'We’re on it. Typical response time is a few minutes — thanks for your patience.'
};

let lastSmartReplies = [];

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

function claimSelectedTicket(force) {
    if (!selectedTicketId) return;
    socket.emit('adminTicketClaim', { ticketId: selectedTicketId, force: Boolean(force) });
}

function releaseSelectedTicket() {
    if (!selectedTicketId) return;
    socket.emit('adminTicketClaimClear', { ticketId: selectedTicketId });
}

function filterChatList() {
    const q = (document.getElementById('chatSearch')?.value || '').toLowerCase();
    const list = Array.from(conversationsById.values());
    const filtered = q
        ? list.filter((c) =>
              String(c?.name || '').toLowerCase().includes(q) || String(c?.socketId || '').toLowerCase().includes(q)
          )
        : list;
    renderChatList(filtered);
}

function saveConversationMeta() {
    if (!selectedChat) return;
    const conv = conversationsById.get(selectedChat);
    if (!conv) return;
    const tagsRaw = document.getElementById('chatTags')?.value || '';
    const notes = document.getElementById('chatNotes')?.value || '';
    const tags = String(tagsRaw)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20);
    socket.emit('adminUpdateConversation', { socketId: selectedChat, tags, notes });
}

function muteSelectedChat(minutes) {
    if (!selectedChat) return;
    const ms = Math.max(0, Math.min(Number(minutes || 0), 60 * 24 * 7)) * 60 * 1000;
    socket.emit('adminModerationAction', { socketId: selectedChat, action: 'mute', durationMs: ms });
}

function unmuteSelectedChat() {
    if (!selectedChat) return;
    socket.emit('adminModerationAction', { socketId: selectedChat, action: 'unmute' });
}

function banSelectedChat() {
    if (!selectedChat) return;
    socket.emit('adminModerationAction', { socketId: selectedChat, action: 'ban' });
}

function unbanSelectedChat() {
    if (!selectedChat) return;
    socket.emit('adminModerationAction', { socketId: selectedChat, action: 'unban' });
}

function insertCanned() {
    const select = document.getElementById('cannedSelect');
    const input = document.getElementById('adminChatInput');
    if (!select || !input) return;
    const val = String(select.value || '');
    if (!val) return;
    input.value = input.value ? `${input.value} ${val}` : val;
    input.focus();
    emitAdminTyping(true);
    select.value = '';
}

function filterTicketList() {
    const q = (document.getElementById('ticketSearch')?.value || '').toLowerCase();
    const list = Array.from(ticketsById.values());
    const filtered = q
        ? list.filter((t) =>
              String(t?.id || '').toLowerCase().includes(q) ||
              String(t?.name || '').toLowerCase().includes(q) ||
              String(t?.socketId || '').toLowerCase().includes(q)
          )
        : list;
    renderTicketList(filtered);
}

function setTicketFilter(next, btn) {
    ticketFilter = String(next || 'open');
    document.querySelectorAll('.ticket-filters .filter-btn').forEach((b) => b.classList.remove('active'));
    if (btn && btn.classList) btn.classList.add('active');
    renderTicketList(Array.from(ticketsById.values()));
}

function renderTicketList(list) {
    const el = document.getElementById('ticketItems');
    if (!el) return;
    const arr = Array.isArray(list) ? list : [];
    const filtered = arr.filter((t) => {
        if (ticketFilter === 'all') return true;
        return String(t?.status || 'open') === ticketFilter;
    });

    el.innerHTML = filtered
        .map((t) => {
            const name = escapeHtml(String(t?.name || t?.socketId || ''));
            const id = escapeHtml(String(t?.id || ''));
            const preview = escapeHtml(String(t?.lastText || ''));
            const status = escapeHtml(String(t?.status || 'open'));
            const priority = escapeHtml(String(t?.priority || 'normal'));
            const assignee = escapeHtml(String(t?.assignee || ''));
            const timeText = t?.updatedAt ? new Date(t.updatedAt).toLocaleTimeString() : '';
            const unread = Number(t?.unread || 0);
            const right = unread > 0 ? `${unread}` : escapeHtml(timeText);
            const selectedClass = selectedTicketId === t.id ? 'selected' : '';
            return `
        <div class="ticket-item ${selectedClass}" data-ticket-id="${id}" onclick="selectTicket('${id}', this)">
            <div class="ticket-item-header">
                <span>${id} - ${name}</span>
                <span class="chat-time">${right}</span>
            </div>
            <div class="ticket-meta">
                <span class="ticket-pill">${status}</span>
                <span class="ticket-pill">${priority}</span>
                ${assignee ? `<span class=\"ticket-pill\">@${assignee}</span>` : ''}
            </div>
            <div class="chat-preview">${preview}</div>
        </div>`;
        })
        .join('');
}

function selectTicket(ticketId, el) {
    const id = String(ticketId || '');
    if (!id) return;
    selectedTicketId = id;
    document.querySelectorAll('.ticket-item').forEach((item) => item.classList.remove('selected'));
    if (el) el.classList.add('selected');

    const t = ticketsById.get(id);
    if (!t) return;

    const body = document.getElementById('ticketDetailBody');
    if (body) body.style.display = 'block';

    const title = document.getElementById('ticketTitle');
    const sub = document.getElementById('ticketSubtitle');
    if (title) title.textContent = `${t.id} - ${t.name || t.socketId}`;
    if (sub) {
        const status = t.status || 'open';
        const pri = t.priority || 'normal';
        const asg = t.assignee ? `@${t.assignee}` : 'unassigned';
        const claim = t.claim && t.claim.user ? `claimed by ${t.claim.user}` : 'unclaimed';
        sub.textContent = `${status} • ${pri} • ${asg} • ${claim}`;
    }

    const agentViewEl = document.getElementById('ticketAgentView');
    if (agentViewEl) {
        const online = t.online ? 'online' : 'offline';
        const lastSeen = t.lastSeenAt ? new Date(t.lastSeenAt).toLocaleString() : '—';
        const path = t.agentView?.path || '—';
        const ua = t.agentView?.ua || '—';
        agentViewEl.textContent = `${online} • last seen ${lastSeen} • ${path} • ${ua}`;
    }

    const formEl = document.getElementById('ticketForm');
    if (formEl) {
        if (t.form && (t.form.issue || t.form.desc)) {
            const issue = t.form.issue || 'other';
            const desc = t.form.desc || '';
            const at = t.form.submittedAt ? new Date(t.form.submittedAt).toLocaleString() : '';
            formEl.textContent = `${issue}${at ? ` • ${at}` : ''} • ${desc}`;
        } else {
            formEl.textContent = '—';
        }
    }

    const statusSel = document.getElementById('ticketStatus');
    const priSel = document.getElementById('ticketPriority');
    const asgInput = document.getElementById('ticketAssignee');
    if (statusSel) statusSel.value = String(t.status || 'open');
    if (priSel) priSel.value = String(t.priority || 'normal');
    if (asgInput) asgInput.value = String(t.assignee || '');
}

function saveTicketEdits() {
    if (!selectedTicketId) return;
    const t = ticketsById.get(selectedTicketId);
    if (!t) return;
    const status = document.getElementById('ticketStatus')?.value;
    const priority = document.getElementById('ticketPriority')?.value;
    const assignee = document.getElementById('ticketAssignee')?.value;
    socket.emit('adminTicketUpdate', { ticketId: selectedTicketId, status, priority, assignee });
}

function ticketQuickSet(status) {
    const sel = document.getElementById('ticketStatus');
    if (sel) sel.value = String(status);
    saveTicketEdits();
}

function openLinkedChatFromTicket() {
    if (!selectedTicketId) return;
    const t = ticketsById.get(selectedTicketId);
    if (!t || !t.socketId) return;
    const btn = document.querySelector('.admin-nav .admin-btn:nth-child(2)');
    showChats(btn);
    const socketId = String(t.socketId);
    const item = document.querySelector(`.chat-item[data-socket-id="${CSS.escape(socketId)}"]`);
    selectChat(socketId, item);
}

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

    socket.on('adminTickets', (list) => {
        const arr = Array.isArray(list) ? list : [];
        ticketsById = new Map(arr.map((t) => [t.id, t]));
        renderTicketList(arr);
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
        if (key === '1' || key === '2' || key === '3') {
            const idx = Number(key) - 1;
            const suggestion = lastSmartReplies[idx];
            if (!suggestion) return;
            event.preventDefault();
            const input = document.getElementById('adminChatInput');
            if (input) {
                input.value = input.value ? `${input.value} ${suggestion}` : suggestion;
                input.focus();
                emitAdminTyping(true);
            }
            return;
        }

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

function showTickets(btn) {
    switchSection('tickets', btn);
    socket.emit('adminInit');
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

    if (cmd === 'smart') {
        smartRepliesForSelectedChat();
        return true;
    }

    if (cmd === 'verify') {
        socket.emit('adminModerationAction', { socketId: selectedChat, action: 'verify' });
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

    if (cmd === 'ticket') {
        return handleTicketCommand(tokens);
    }

    return false;
}

function handleTicketCommand(tokens) {
    const conv = conversationsById.get(selectedChat);
    const ticketId = conv?.ticket?.id;
    if (!ticketId) {
        console.warn('No ticket for this conversation yet.');
        return true;
    }

    const sub = String(tokens[0] || '').toLowerCase();
    const arg = tokens.slice(1).join(' ');

    if (!sub || sub === 'status') {
        console.log('Ticket:', conv.ticket);
        return true;
    }

    if (sub === 'close') {
        socket.emit('adminTicketUpdate', { ticketId, status: 'closed' });
        return true;
    }
    if (sub === 'reopen' || sub === 'open') {
        socket.emit('adminTicketUpdate', { ticketId, status: 'open' });
        return true;
    }
    if (sub === 'pending') {
        socket.emit('adminTicketUpdate', { ticketId, status: 'pending' });
        return true;
    }
    if (sub === 'priority') {
        const p = String(arg || '').toLowerCase();
        socket.emit('adminTicketUpdate', { ticketId, priority: p });
        return true;
    }
    if (sub === 'assign') {
        socket.emit('adminTicketUpdate', { ticketId, assignee: String(arg || '') });
        return true;
    }

    return false;
}

async function smartRepliesForSelectedChat() {
    if (!selectedChat) return;
    try {
        const res = await fetch(`/api/admin/transcript/${encodeURIComponent(String(selectedChat))}`);
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const suggestions = generateSmartReplies(messages);
        lastSmartReplies = suggestions;
        console.log('Smart replies:', suggestions);
        console.log('Use Ctrl+Shift+1/2/3 to insert a suggestion into the input.');
    } catch (err) {
        console.warn('Smart replies failed', err);
    }
}

function generateSmartReplies(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const lastUser = [...list].reverse().find((m) => (m?.type || '').toLowerCase() === 'user' && m?.text);
    const text = String(lastUser?.text || '').toLowerCase();

    const out = [];
    if (!text) {
        out.push('Thanks for reaching out — what can I help you with today?');
        out.push('Can you share your username and what happened?');
        out.push('What device/browser are you using?');
        return out;
    }

    if (/(ban|banned|mute|muted)/.test(text)) {
        out.push('I can help with that. What’s your username and what message did you receive?');
        out.push('When did this start happening, and were you doing anything right before it happened?');
        out.push('If you have a screenshot, please send it and I’ll review it.');
        return out;
    }

    if (/(payment|paid|charge|charged|refund|billing)/.test(text)) {
        out.push('Can you share your order/payment email (or last 4) and the date of the charge?');
        out.push('What platform did you pay on (card/PayPal/etc.) and do you have a receipt screenshot?');
        out.push('I’m checking this now — thanks for your patience.');
        return out;
    }

    if (/(login|sign in|cant log|can\x27t log|password|2fa|code)/.test(text)) {
        out.push('What’s your username, and are you seeing any specific error message?');
        out.push('Have you tried resetting your password and clearing cache/cookies?');
        out.push('Tell me your device/browser and I’ll walk you through the quickest fix.');
        return out;
    }

    if (/(bug|broken|error|crash|glitch)/.test(text)) {
        out.push('Thanks — can you send a screenshot and your device/browser?');
        out.push('What steps cause it to happen so I can reproduce it?');
        out.push('I’m taking a look now.');
        return out;
    }

    out.push('Thanks — what’s your username and what happened?');
    out.push('Can you send a screenshot and your device/browser?');
    out.push('We’re on it — typical response time is a few minutes.');
    return out;
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
    if (message.image && message.image.dataUrl) {
        addAdminImageMessage(message.image.dataUrl, message.type || 'user');
        return;
    }
    addAdminMessage(message.text || '', message.type || 'user');
}

function addAdminImageMessage(dataUrl, type) {
    const chatMessages = document.getElementById('adminChatMessages');
    if (!chatMessages) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `<div class="message-content"><img class="message-image" src="${escapeHtml(String(dataUrl))}" alt="upload" /></div>`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}