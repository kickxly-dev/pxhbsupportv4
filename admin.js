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

let adminAudioCtx = null;
let adminAudioUnlocked = false;
let adminLockdownAlarm = { osc: null, gain: null, timer: null };

let adminAuditLog = [];

let ticketEvidenceById = new Map();

let liveAssistBySocket = new Map();

let spotlightState = { enabled: false, x: 0.5, y: 0.5, lastSentAt: 0 };

let replayState = {
    isOpen: false,
    isPlaying: false,
    speed: 1,
    socketId: null,
    title: null,
    messages: [],
    idx: 0,
    timer: null
};

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

    const unlock = () => {
        try {
            if (!adminAudioCtx) {
                adminAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (adminAudioCtx && adminAudioCtx.state === 'suspended') {
                adminAudioCtx.resume();
            }
            adminAudioUnlocked = true;
        } catch {
            // ignore
        }
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);

    document.addEventListener('keydown', handleAdminHotkeys);
});

function toggleSpotlightFromUi() {
    if (!selectedChat) {
        showToast({ title: 'Spotlight', message: 'Select a chat first.', type: 'warning' });
        return;
    }
    spotlightState.enabled = !spotlightState.enabled;
    const btn = document.getElementById('spotlightToggleBtn');
    if (btn) {
        if (spotlightState.enabled) btn.classList.add('active');
        else btn.classList.remove('active');
    }
    const row = document.getElementById('spotlightPadRow');
    if (row) row.style.display = spotlightState.enabled ? 'grid' : 'none';
    socket.emit('adminSpotlight', { socketId: selectedChat, enabled: spotlightState.enabled, x: spotlightState.x, y: spotlightState.y });
    if (spotlightState.enabled) setupSpotlightPad();
}

function spotlightPingFromUi() {
    if (!selectedChat) {
        showToast({ title: 'Spotlight', message: 'Select a chat first.', type: 'warning' });
        return;
    }
    socket.emit('adminSpotlightPing', { socketId: selectedChat, x: spotlightState.x, y: spotlightState.y });
}

function setupSpotlightPad() {
    const pad = document.getElementById('spotlightPad');
    if (!pad || pad.dataset.bound === '1') return;
    pad.dataset.bound = '1';

    const dot = document.createElement('div');
    dot.className = 'spotlight-pad-dot';
    pad.appendChild(dot);

    const updateDot = () => {
        dot.style.left = `${Math.round(spotlightState.x * 1000) / 10}%`;
        dot.style.top = `${Math.round(spotlightState.y * 1000) / 10}%`;
    };
    updateDot();

    const send = () => {
        const now = Date.now();
        if (now - spotlightState.lastSentAt < 35) return;
        spotlightState.lastSentAt = now;
        if (!spotlightState.enabled || !selectedChat) return;
        socket.emit('adminSpotlight', { socketId: selectedChat, enabled: true, x: spotlightState.x, y: spotlightState.y });
    };

    const onMove = (ev) => {
        if (!spotlightState.enabled) return;
        const r = pad.getBoundingClientRect();
        const x = (ev.clientX - r.left) / Math.max(1, r.width);
        const y = (ev.clientY - r.top) / Math.max(1, r.height);
        spotlightState.x = Math.max(0, Math.min(1, x));
        spotlightState.y = Math.max(0, Math.min(1, y));
        updateDot();
        send();
    };

    const onClick = (ev) => {
        onMove(ev);
        spotlightPingFromUi();
    };

    pad.addEventListener('mousemove', onMove, { passive: true });
    pad.addEventListener('click', onClick);
}

function claimSelectedTicket(force) {
    if (!selectedTicketId) return;
    socket.emit('adminTicketClaim', { ticketId: selectedTicketId, force: Boolean(force) });
}

function releaseSelectedTicket() {
    if (!selectedTicketId) return;
    socket.emit('adminTicketClaimClear', { ticketId: selectedTicketId });
}

function analyzeSelectedTicket() {
    if (!selectedTicketId) return;
    const btn = document.getElementById('ticketAiAnalyzeBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Analyzing…';
    }
    socket.emit('adminAiAnalyzeTicket', { ticketId: selectedTicketId });
    setTimeout(() => {
        const b = document.getElementById('ticketAiAnalyzeBtn');
        if (b) {
            b.disabled = false;
            b.textContent = 'Analyze';
        }
    }, 3500);
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

    const evidenceEl = document.getElementById('ticketEvidence');
    if (evidenceEl) {
        evidenceEl.textContent = 'Loading…';
    }
    socket.emit('adminGetTicketEvidence', { ticketId: id });

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

    const aiEl = document.getElementById('ticketAi');
    if (aiEl) {
        if (t.ai && (t.ai.summary || t.ai.nextQuestion || t.ai.suggestedPriority || (t.ai.suggestedTags && t.ai.suggestedTags.length) || t.ai.error)) {
            const parts = [];
            if (t.ai.summary) parts.push(`Summary: ${t.ai.summary}`);
            if (t.ai.suggestedPriority) parts.push(`Suggested priority: ${t.ai.suggestedPriority}`);
            if (Array.isArray(t.ai.suggestedTags) && t.ai.suggestedTags.length) parts.push(`Suggested tags: ${t.ai.suggestedTags.join(', ')}`);
            if (t.ai.nextQuestion) parts.push(`Next question: ${t.ai.nextQuestion}`);
            if (t.ai.error) parts.push(`Error: ${t.ai.error}`);
            aiEl.textContent = parts.join('\n');
        } else {
            aiEl.textContent = '—';
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

function openTicketReplay() {
    if (!selectedTicketId) return;
    const t = ticketsById.get(selectedTicketId);
    if (!t || !t.socketId) return;
    const socketId = String(t.socketId);

    replayState.socketId = socketId;
    replayState.title = `${t.id} - ${t.name || t.socketId}`;
    replayState.messages = [];
    replayState.idx = 0;
    replayState.isPlaying = false;
    clearReplayTimer();

    const modal = document.getElementById('replayModal');
    const stream = document.getElementById('replayStream');
    const titleEl = document.getElementById('replayTitle');
    const playBtn = document.getElementById('replayPlayBtn');
    if (stream) stream.innerHTML = '';
    if (titleEl) titleEl.textContent = `Replay • ${replayState.title}`;
    if (playBtn) playBtn.textContent = 'Play';
    if (modal) modal.style.display = 'flex';
    replayState.isOpen = true;

    fetch(`/api/admin/transcript/${encodeURIComponent(socketId)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
        .then((data) => {
            const msgs = Array.isArray(data?.messages) ? data.messages : [];
            replayState.messages = msgs;
            replayState.idx = 0;
            renderReplayStatus();
        })
        .catch(() => {
            const s = document.getElementById('replayStream');
            if (s) s.innerHTML = '<div class="audit-empty">Failed to load transcript.</div>';
        });
}

function closeTicketReplay() {
    const modal = document.getElementById('replayModal');
    if (modal) modal.style.display = 'none';
    replayState.isOpen = false;
    replayState.isPlaying = false;
    clearReplayTimer();
}

function setReplaySpeedFromUi() {
    const val = Number(document.getElementById('replaySpeed')?.value || 1);
    replayState.speed = val === 2 ? 2 : val === 5 ? 5 : 1;
}

function toggleReplayPlay() {
    if (!replayState.isOpen) return;
    if (!replayState.messages.length) return;
    replayState.isPlaying = !replayState.isPlaying;
    const btn = document.getElementById('replayPlayBtn');
    if (btn) btn.textContent = replayState.isPlaying ? 'Pause' : 'Play';
    if (replayState.isPlaying) scheduleReplayTick();
    else clearReplayTimer();
}

function stepReplayOnce() {
    if (!replayState.isOpen) return;
    replayState.isPlaying = false;
    const btn = document.getElementById('replayPlayBtn');
    if (btn) btn.textContent = 'Play';
    clearReplayTimer();
    replayAppendNext();
}

function resetReplay() {
    if (!replayState.isOpen) return;
    replayState.isPlaying = false;
    clearReplayTimer();
    replayState.idx = 0;
    const btn = document.getElementById('replayPlayBtn');
    if (btn) btn.textContent = 'Play';
    const stream = document.getElementById('replayStream');
    if (stream) stream.innerHTML = '';
    renderReplayStatus();
}

function clearReplayTimer() {
    if (replayState.timer) clearTimeout(replayState.timer);
    replayState.timer = null;
}

function scheduleReplayTick() {
    clearReplayTimer();
    if (!replayState.isPlaying) return;
    replayState.timer = setTimeout(() => {
        replayAppendNext();
        if (replayState.isPlaying) scheduleReplayTick();
    }, Math.max(120, Math.round(650 / (replayState.speed || 1))));
}

function renderReplayStatus() {
    const stream = document.getElementById('replayStream');
    if (!stream) return;
    if (!replayState.messages.length) {
        stream.innerHTML = '<div class="audit-empty">Loading…</div>';
    }
}

function replayAppendNext() {
    const stream = document.getElementById('replayStream');
    if (!stream) return;
    const m = replayState.messages[replayState.idx];
    if (!m) {
        replayState.isPlaying = false;
        const btn = document.getElementById('replayPlayBtn');
        if (btn) btn.textContent = 'Play';
        clearReplayTimer();
        return;
    }
    replayState.idx += 1;

    const type = String(m?.type || 'user').toLowerCase();
    const who = String(m?.user || (type === 'staff' ? 'Staff' : type === 'system' ? 'System' : 'User'));
    const at = m?.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';

    const item = document.createElement('div');
    item.className = 'replay-item';
    const bubble = document.createElement('div');
    bubble.className = `replay-bubble ${type}`;

    let content = '';
    if (m?.image?.dataUrl) {
        content = `<img class="message-image" src="${escapeHtml(String(m.image.dataUrl))}" alt="upload" />`;
    } else if (m?.file?.dataUrl) {
        const f = m.file;
        const dataUrl = escapeHtml(String(f.dataUrl || ''));
        const name = escapeHtml(String(f.name || 'file'));
        const mime = String(f.mime || '').toLowerCase();
        const icon = mime === 'application/pdf' ? 'file-pdf' : 'file';
        const size = Number(f.size || 0);
        const sizeText = size ? `${Math.round(size / 1024)} KB` : '';
        content = `<a class="file-card" href="${dataUrl}" download="${name}"><i class="fas fa-${icon}"></i><span>${name}</span><em>${escapeHtml(sizeText)}</em></a>`;
    } else {
        content = `<p>${escapeHtml(String(m?.text || ''))}</p>`;
    }

    item.innerHTML = `<div class="replay-time">${escapeHtml(at)}</div>`;
    bubble.innerHTML = `<div class="replay-who">${escapeHtml(who)}</div>${content}`;
    item.appendChild(bubble);
    stream.appendChild(item);
    stream.scrollTop = stream.scrollHeight;
}

function checkAuth() {
    const staffUser = sessionStorage.getItem('staffUser');
    const staffLoggedIn = sessionStorage.getItem('staffLoggedIn');

    if (!staffUser || staffLoggedIn !== 'true') {
        window.location.href = '/';
    }
}

function selectNextTicket(delta) {
    const container = document.getElementById('ticketItems');
    if (!container) return;
    const items = Array.from(container.querySelectorAll('.ticket-item[data-ticket-id]'));
    if (!items.length) return;

    const currentIdx = selectedTicketId ? items.findIndex((el) => String(el.dataset.ticketId) === String(selectedTicketId)) : -1;
    const nextIdx = currentIdx === -1 ? 0 : Math.max(0, Math.min(items.length - 1, currentIdx + Number(delta || 0)));
    const nextEl = items[nextIdx];
    if (!nextEl) return;
    const id = nextEl.dataset.ticketId;
    if (!id) return;
    selectTicket(String(id), nextEl);
    nextEl.scrollIntoView({ block: 'nearest' });
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

    socket.on('adminLiveAssistCursor', (payload) => {
        const socketId = payload?.socketId;
        if (!socketId) return;
        liveAssistBySocket.set(String(socketId), {
            kind: 'cursor',
            x: Number(payload?.x || 0),
            y: Number(payload?.y || 0),
            w: Number(payload?.w || 1),
            h: Number(payload?.h || 1),
            at: Number(payload?.at || Date.now())
        });
        renderLiveAssistOverlay(String(socketId));
    });

    socket.on('adminLiveAssistClick', (payload) => {
        const socketId = payload?.socketId;
        if (!socketId) return;
        const state = {
            kind: 'click',
            x: Number(payload?.x || 0),
            y: Number(payload?.y || 0),
            w: Number(payload?.w || 1),
            h: Number(payload?.h || 1),
            at: Number(payload?.at || Date.now())
        };
        liveAssistBySocket.set(String(socketId), state);
        renderLiveAssistOverlay(String(socketId));
        spawnLiveAssistClick(String(socketId), state);
    });

    socket.on('adminSpotlightDenied', (payload) => {
        const reason = payload?.reason ? String(payload.reason) : 'Spotlight denied.';
        showToast({ title: 'Spotlight', message: reason, type: 'warning' });
        const btn = document.getElementById('spotlightToggleBtn');
        if (btn) btn.classList.remove('active');
        const row = document.getElementById('spotlightPadRow');
        if (row) row.style.display = 'none';
        spotlightState.enabled = false;
    });

    socket.on('adminTickets', (list) => {
        const arr = Array.isArray(list) ? list : [];
        ticketsById = new Map(arr.map((t) => [t.id, t]));
        renderTicketList(arr);

        if (selectedTicketId && ticketsById.has(selectedTicketId)) {
            selectTicket(selectedTicketId, document.querySelector(`.ticket-item[data-ticket-id="${CSS.escape(selectedTicketId)}"]`));
        }
    });

    socket.on('adminTicketEvidence', (payload) => {
        const id = payload?.ticketId;
        if (!id) return;
        const ev = Array.isArray(payload?.evidence) ? payload.evidence : [];
        ticketEvidenceById.set(String(id), ev);
        if (selectedTicketId && String(selectedTicketId) === String(id)) {
            renderTicketEvidence(String(id));
        }
    });

    socket.on('adminAiTicketResult', (payload) => {
        const id = payload?.ticketId;
        const ai = payload?.ai;
        if (!id) return;
        const t = ticketsById.get(String(id));
        if (t) {
            t.ai = ai || null;
        }
        if (selectedTicketId && String(id) === String(selectedTicketId)) {
            const aiEl = document.getElementById('ticketAi');
            if (aiEl) {
                if (!ai) {
                    aiEl.textContent = '—';
                } else {
                    const parts = [];
                    if (ai.summary) parts.push(`Summary: ${ai.summary}`);
                    if (ai.suggestedPriority) parts.push(`Suggested priority: ${ai.suggestedPriority}`);
                    if (Array.isArray(ai.suggestedTags) && ai.suggestedTags.length) parts.push(`Suggested tags: ${ai.suggestedTags.join(', ')}`);
                    if (ai.nextQuestion) parts.push(`Next question: ${ai.nextQuestion}`);
                    if (ai.error) parts.push(`Error: ${ai.error}`);
                    if (ai.raw) parts.push(`Raw: ${String(ai.raw).slice(0, 500)}`);
                    aiEl.textContent = parts.length ? parts.join('\n') : '—';
                }
            }
        }
    });

    socket.on('lockdownUpdate', (state) => {
        const enabled = Boolean(state && state.enabled);
        const toggle = document.getElementById('lockdownToggle');
        if (toggle) toggle.checked = enabled;
        const reason = state && state.reason ? String(state.reason) : '';
        showToast({
            title: enabled ? 'Lockdown Enabled' : 'Lockdown Disabled',
            message: reason ? reason : enabled ? 'Chat is temporarily locked by staff.' : 'Chat is live again.',
            type: enabled ? 'warning' : 'success'
        });

        const banner = document.getElementById('globalBanner');
        if (banner) {
            if (enabled) {
                banner.style.display = 'block';
                banner.innerHTML = `
                    <div class="banner-inner">
                        <div class="banner-left">
                            <div class="banner-icon"><i class="fas fa-triangle-exclamation"></i></div>
                            <div class="banner-text">${escapeHtml(reason ? `Lockdown active: ${reason}` : 'Lockdown active: Users cannot chat right now.')}</div>
                        </div>
                        <div class="banner-right">
                            <button class="banner-btn" onclick="this.closest('#globalBanner').style.display='none'">Dismiss</button>
                        </div>
                    </div>
                `;
            } else {
                banner.style.display = 'none';
                banner.innerHTML = '';
            }
        }

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
            startAdminLockdownAlarm();
        } else {
            stopAdminLockdownAlarm();
        }
    });

    socket.on('adminAuditLogInit', (list) => {
        adminAuditLog = Array.isArray(list) ? list : [];
        renderAuditLog();
    });

    socket.on('adminAuditLogEntry', (entry) => {
        if (!entry) return;
        adminAuditLog = [...adminAuditLog, entry].slice(-250);
        renderAuditLog();
    });
}

function ensureLiveAssistLayer(container, id) {
    if (!container) return null;
    let layer = container.querySelector(`.liveassist-layer[data-la="${CSS.escape(id)}"]`);
    if (layer) return layer;
    layer = document.createElement('div');
    layer.className = 'liveassist-layer';
    layer.dataset.la = id;
    try {
        const pos = window.getComputedStyle(container).position;
        if (pos === 'static' || !pos) {
            container.style.position = 'relative';
        }
    } catch {
        container.style.position = 'relative';
    }
    container.appendChild(layer);
    return layer;
}

function renderLiveAssistOverlay(socketId) {
    const state = liveAssistBySocket.get(String(socketId));
    if (!state) return;

    const targets = [];
    const chatPane = document.getElementById('adminChatMessages');
    if (selectedChat && String(selectedChat) === String(socketId) && chatPane) targets.push(chatPane);
    const ticketPane = document.getElementById('ticketDetail');
    const t = selectedTicketId ? ticketsById.get(String(selectedTicketId)) : null;
    if (t && String(t.socketId) === String(socketId) && ticketPane) targets.push(ticketPane);

    targets.forEach((container) => {
        const layer = ensureLiveAssistLayer(container, String(socketId));
        if (!layer) return;
        layer.innerHTML = '';
        if (state.kind !== 'cursor') return;

        const xPct = Math.max(0, Math.min(1, state.w ? state.x / state.w : 0));
        const yPct = Math.max(0, Math.min(1, state.h ? state.y / state.h : 0));
        const dot = document.createElement('div');
        dot.className = 'liveassist-cursor';
        dot.style.left = `${Math.round(xPct * 1000) / 10}%`;
        dot.style.top = `${Math.round(yPct * 1000) / 10}%`;
        layer.appendChild(dot);
    });
}

function spawnLiveAssistClick(socketId, state) {
    const containers = [];
    const chatPane = document.getElementById('adminChatMessages');
    if (selectedChat && String(selectedChat) === String(socketId) && chatPane) containers.push(chatPane);
    const ticketPane = document.getElementById('ticketDetail');
    const t = selectedTicketId ? ticketsById.get(String(selectedTicketId)) : null;
    if (t && String(t.socketId) === String(socketId) && ticketPane) containers.push(ticketPane);

    containers.forEach((container) => {
        const layer = ensureLiveAssistLayer(container, String(socketId));
        if (!layer) return;
        const xPct = Math.max(0, Math.min(1, state.w ? state.x / state.w : 0));
        const yPct = Math.max(0, Math.min(1, state.h ? state.y / state.h : 0));
        const ripple = document.createElement('div');
        ripple.className = 'liveassist-click';
        ripple.style.left = `${Math.round(xPct * 1000) / 10}%`;
        ripple.style.top = `${Math.round(yPct * 1000) / 10}%`;
        layer.appendChild(ripple);
        setTimeout(() => ripple.remove(), 900);
    });
}

function renderAuditLog() {
    const el = document.getElementById('auditLog');
    if (!el) return;
    const items = Array.isArray(adminAuditLog) ? adminAuditLog.slice(-60).reverse() : [];
    if (!items.length) {
        el.innerHTML = '<div class="audit-empty">No recent events.</div>';
        return;
    }

    el.innerHTML = items
        .map((e) => {
            const at = e?.at ? new Date(e.at).toLocaleTimeString() : '';
            const type = escapeHtml(String(e?.type || 'event'));
            const action = escapeHtml(String(e?.action || ''));
            const by = escapeHtml(String(e?.by || 'system'));
            const sid = e?.socketId ? escapeHtml(String(e.socketId).slice(0, 10)) : '';
            const tail = sid ? ` • ${sid}` : '';
            return `<div class="audit-item"><span class="audit-time">${escapeHtml(at)}</span><span class="audit-pill">${type}</span><span class="audit-action">${action}</span><span class="audit-by">by ${by}${tail}</span></div>`;
        })
        .join('');
}

function renderTicketEvidence(ticketId) {
    const el = document.getElementById('ticketEvidence');
    if (!el) return;
    const list = ticketEvidenceById.get(String(ticketId)) || [];
    if (!Array.isArray(list) || !list.length) {
        el.textContent = '—';
        return;
    }

    const items = list
        .slice()
        .reverse()
        .slice(0, 12)
        .map((e) => {
            const kind = String(e?.kind || '').toLowerCase();
            const name = escapeHtml(String(e?.name || kind || 'file'));
            const size = Number(e?.size || 0);
            const sizeKb = size ? `${Math.round(size / 1024)} KB` : '';
            const at = e?.at ? new Date(e.at).toLocaleString() : '';
            const meta = [sizeKb, at].filter(Boolean).join(' • ');
            const dataUrl = e?.dataUrl ? String(e.dataUrl) : '';

            if (kind === 'image' && dataUrl) {
                return `<div class="evidence-card"><div class="evidence-top"><span class="evidence-kind">image</span><span class="evidence-meta">${escapeHtml(meta)}</span></div><img class="evidence-image" src="${escapeHtml(dataUrl)}" alt="evidence" /><div class="evidence-name">${name}</div></div>`;
            }

            if (kind === 'pdf' && dataUrl) {
                return `<a class="evidence-card evidence-file" href="${escapeHtml(dataUrl)}" download="${name}"><div class="evidence-top"><span class="evidence-kind">pdf</span><span class="evidence-meta">${escapeHtml(meta)}</span></div><div class="evidence-file-row"><i class="fas fa-file-pdf"></i><span class="evidence-name">${name}</span></div><div class="evidence-cta">Download</div></a>`;
            }

            return `<div class="evidence-card evidence-file"><div class="evidence-top"><span class="evidence-kind">file</span><span class="evidence-meta">${escapeHtml(meta)}</span></div><div class="evidence-file-row"><i class="fas fa-file"></i><span class="evidence-name">${name}</span></div></div>`;
        })
        .join('');

    el.innerHTML = `<div class="evidence-grid">${items}</div>`;
}

function toggleLockdownFromUi() {
    const enabled = Boolean(document.getElementById('lockdownToggle')?.checked);
    const reason = document.getElementById('lockdownReason')?.value || '';
    socket.emit('adminSetLockdown', { enabled, reason });
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
            return 'bell';
    }
}

function startAdminLockdownAlarm() {
    try {
        if (!adminAudioUnlocked) return;
        if (!adminAudioCtx) return;
        if (adminLockdownAlarm.osc) return;

        const now = adminAudioCtx.currentTime;
        const osc = adminAudioCtx.createOscillator();
        const gain = adminAudioCtx.createGain();

        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.05);

        osc.frequency.setValueAtTime(520, now);
        osc.frequency.linearRampToValueAtTime(880, now + 0.35);
        osc.frequency.linearRampToValueAtTime(520, now + 0.7);

        osc.connect(gain);
        gain.connect(adminAudioCtx.destination);
        osc.start(now);

        const lfo = () => {
            if (!adminLockdownAlarm.osc) return;
            const t = adminAudioCtx.currentTime;
            adminLockdownAlarm.osc.frequency.cancelScheduledValues(t);
            adminLockdownAlarm.osc.frequency.setValueAtTime(520, t);
            adminLockdownAlarm.osc.frequency.linearRampToValueAtTime(880, t + 0.35);
            adminLockdownAlarm.osc.frequency.linearRampToValueAtTime(520, t + 0.7);
        };
        const timer = setInterval(lfo, 700);

        adminLockdownAlarm = { osc, gain, timer };
    } catch {
        // ignore
    }
}

function stopAdminLockdownAlarm() {
    try {
        if (adminLockdownAlarm.timer) clearInterval(adminLockdownAlarm.timer);
        if (adminLockdownAlarm.gain && adminAudioCtx) {
            const now = adminAudioCtx.currentTime;
            adminLockdownAlarm.gain.gain.cancelScheduledValues(now);
            adminLockdownAlarm.gain.gain.setValueAtTime(adminLockdownAlarm.gain.gain.value || 0.0001, now);
            adminLockdownAlarm.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        }
        if (adminLockdownAlarm.osc && adminAudioCtx) {
            adminLockdownAlarm.osc.stop(adminAudioCtx.currentTime + 0.13);
        }
    } catch {
        // ignore
    }
    adminLockdownAlarm = { osc: null, gain: null, timer: null };
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

    if (event.ctrlKey || event.metaKey) {
        const key = String(event.key || '').toLowerCase();

        if (key === 'k') {
            event.preventDefault();
            const searchId = currentSection === 'tickets' ? 'ticketSearch' : currentSection === 'chats' ? 'chatSearch' : null;
            const el = searchId ? document.getElementById(searchId) : null;
            if (el) {
                el.focus();
                el.select();
            }
            return;
        }

        if (currentSection === 'tickets' && (key === 'arrowdown' || key === 'arrowup')) {
            event.preventDefault();
            selectNextTicket(key === 'arrowdown' ? 1 : -1);
            return;
        }
    }

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
    if (message.file && message.file.dataUrl) {
        addAdminFileMessage(message.file, message.type || 'user');
        return;
    }
    addAdminMessage(message.text || '', message.type || 'user');
}

function addAdminFileMessage(file, type) {
    const chatMessages = document.getElementById('adminChatMessages');
    if (!chatMessages) return;
    const dataUrl = String(file?.dataUrl || '');
    const mime = String(file?.mime || '').toLowerCase();
    const name = escapeHtml(String(file?.name || 'file'));
    const size = Number(file?.size || 0);
    const sizeText = size ? `${Math.round(size / 1024)} KB` : '';

    const icon = mime === 'application/pdf' ? 'file-pdf' : 'file';
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `<div class="message-content"><a class="file-card" href="${escapeHtml(dataUrl)}" download="${name}"><i class="fas fa-${icon}"></i><span>${name}</span><em>${escapeHtml(sizeText)}</em></a></div>`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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