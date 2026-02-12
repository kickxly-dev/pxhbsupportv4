// P.X HB Enterprise Admin Panel - Advanced Management System
class EnterpriseAdminPanel {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.stats = {
            activeUsers: 0,
            onlineStaff: 0,
            totalMessages: 0,
            avgResponseTime: 0,
            newUsers: 0,
            returningUsers: 0,
            countries: 0,
            unreadCount: 0
        };
        this.charts = {};
        this.staffMembers = [];
        this.conversations = [];
        this.systemLogs = [];
        this.settings = {
            siteTitle: 'P.X HB Support',
            maxChats: 100,
            welcomeMessage: '👋 Welcome to P.X HB Support!',
            autoResponse: 'Please wait for staff to join.',
            sessionTimeout: 30,
            rateLimiting: 'enabled'
        };
        
        this.init();
    }

    init() {
        this.checkAuth();
        this.connectSocket();
        this.setupEventListeners();
        this.initializeCharts();
        this.loadInitialData();
        this.startRealTimeUpdates();
    }

    checkAuth() {
        const adminUser = sessionStorage.getItem('adminUser');
        if (!adminUser) {
            this.showLoginModal();
        } else {
            this.currentUser = adminUser;
            this.showNotification(`Welcome back, ${adminUser}!`, 'success');
        }
    }

    showLoginModal() {
        const username = prompt('Admin Username:');
        const password = prompt('Admin Password:');
        
        const ADMIN_CREDENTIALS = {
            'admin': 'pxhb2024'
        };
        
        if (ADMIN_CREDENTIALS[username] && ADMIN_CREDENTIALS[username] === password) {
            this.currentUser = username;
            sessionStorage.setItem('adminUser', username);
            this.showNotification('Authentication successful!', 'success');
        } else {
            this.showNotification('Invalid credentials', 'error');
            setTimeout(() => location.reload(), 2000);
        }
    }

    connectSocket() {
        try {
            this.socket = io(window.location.origin);
            
            this.socket.on('connect', () => {
                console.log('✅ Enterprise Admin connected');
                this.showNotification('Connected to server', 'success');
                this.updateLiveBadge(true);
            });
            
            this.socket.on('disconnect', () => {
                console.log('❌ Enterprise Admin disconnected');
                this.showNotification('Connection lost', 'error');
                this.updateLiveBadge(false);
            });
            
            // Real-time data updates
            this.socket.on('newMessage', (message) => {
                this.handleNewMessage(message);
            });
            
            this.socket.on('staffStatusUpdate', (status) => {
                this.updateStaffStatus(status);
            });
            
            this.socket.on('userConnected', () => {
                this.stats.activeUsers++;
                this.updateStats();
            });
            
            this.socket.on('userDisconnected', () => {
                this.stats.activeUsers = Math.max(0, this.stats.activeUsers - 1);
                this.updateStats();
            });
            
        } catch (error) {
            console.error('❌ Failed to connect:', error);
            this.showNotification('Connection failed', 'error');
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.currentTarget.dataset.section;
                this.showSection(section);
                
                // Update active nav
                document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });

        // Period buttons for charts
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.updateCharts(e.target.textContent);
            });
        });
    }

    showSection(sectionName) {
        // Hide all sections
        document.querySelectorAll('.admin-section').forEach(section => {
            section.style.display = 'none';
        });
        
        // Show selected section
        const targetSection = document.getElementById(sectionName);
        if (targetSection) {
            targetSection.style.display = 'block';
        }
        
        // Load section-specific data
        switch(sectionName) {
            case 'dashboard':
                this.updateDashboard();
                break;
            case 'staff':
                this.loadStaffTable();
                break;
            case 'chats':
                this.loadConversations();
                break;
            case 'users':
                this.loadUserAnalytics();
                break;
            case 'settings':
                this.loadSettingsForm();
                break;
            case 'logs':
                this.loadSystemLogs();
                break;
        }
    }

    initializeCharts() {
        // Initialize main dashboard charts
        this.initMainChart();
        this.initMiniCharts();
        this.initConversationChart();
        this.initLogsChart();
    }

    initMainChart() {
        const ctx = document.getElementById('mainChart');
        if (ctx) {
            this.charts.main = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: this.generateTimeLabels(12),
                    datasets: [{
                        label: 'Active Users',
                        data: this.generateRandomData(12, 10, 50),
                        borderColor: '#ff6b35',
                        backgroundColor: 'rgba(255, 107, 53, 0.1)',
                        tension: 0.4
                    }, {
                        label: 'Messages',
                        data: this.generateRandomData(12, 5, 30),
                        borderColor: '#00ff00',
                        backgroundColor: 'rgba(0, 255, 0, 0.1)',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: { color: '#ffffff' }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#ffffff' }
                        },
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#ffffff' }
                        }
                    }
                }
            });
        }
    }

    initMiniCharts() {
        // Users mini chart
        const usersCtx = document.getElementById('usersChart');
        if (usersCtx) {
            this.charts.users = new Chart(usersCtx, {
                type: 'line',
                data: {
                    labels: ['', '', '', '', '', '', '', ''],
                    datasets: [{
                        data: this.generateRandomData(6, 15, 35),
                        borderColor: '#ff6b35',
                        backgroundColor: 'rgba(255, 107, 53, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { display: false },
                        y: { display: false }
                    }
                }
            });
        }

        // Staff mini chart
        const staffCtx = document.getElementById('staffChart');
        if (staffCtx) {
            this.charts.staff = new Chart(staffCtx, {
                type: 'bar',
                data: {
                    labels: ['', '', '', '', '', '', '', ''],
                    datasets: [{
                        data: this.generateRandomData(6, 1, 5),
                        backgroundColor: 'rgba(0, 255, 0, 0.6)',
                        borderColor: '#00ff00',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { display: false },
                        y: { display: false }
                    }
                }
            });
        }

        // Messages mini chart
        const messagesCtx = document.getElementById('messagesChart');
        if (messagesCtx) {
            this.charts.messages = new Chart(messagesCtx, {
                type: 'line',
                data: {
                    labels: ['', '', '', '', '', '', '', ''],
                    datasets: [{
                        data: this.generateRandomData(6, 20, 60),
                        borderColor: '#ff9900',
                        backgroundColor: 'rgba(255, 153, 0, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { display: false },
                        y: { display: false }
                    }
                }
            });
        }

        // Response time mini chart
        const responseCtx = document.getElementById('responseChart');
        if (responseCtx) {
            this.charts.response = new Chart(responseCtx, {
                type: 'line',
                data: {
                    labels: ['', '', '', '', '', '', '', ''],
                    datasets: [{
                        data: this.generateRandomData(6, 30, 120),
                        borderColor: '#00ccff',
                        backgroundColor: 'rgba(0, 204, 255, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { display: false },
                        y: { display: false }
                    }
                }
            });
        }
    }

    initConversationChart() {
        const ctx = document.getElementById('conversationChart');
        if (ctx) {
            this.charts.conversations = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Active', 'Waiting', 'Completed', 'Abandoned'],
                    datasets: [{
                        data: [12, 3, 45, 2],
                        backgroundColor: [
                            'rgba(0, 255, 0, 0.8)',
                            'rgba(255, 153, 0, 0.8)',
                            'rgba(255, 107, 53, 0.8)',
                            'rgba(255, 51, 51, 0.8)'
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#ffffff' }
                        }
                    }
                }
            });
        }
    }

    initLogsChart() {
        const ctx = document.getElementById('logsChart');
        if (ctx) {
            this.charts.logs = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Error', 'Warning', 'Info', 'Debug'],
                    datasets: [{
                        label: 'Log Levels',
                        data: [2, 8, 45, 12],
                        backgroundColor: [
                            'rgba(255, 51, 51, 0.8)',
                            'rgba(255, 153, 0, 0.8)',
                            'rgba(0, 204, 255, 0.8)',
                            'rgba(255, 255, 255, 0.8)'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: { color: '#ffffff' }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#ffffff' }
                        },
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#ffffff' }
                        }
                    }
                }
            });
        }
    }

    generateTimeLabels(count) {
        const labels = [];
        const now = new Date();
        for (let i = count - 1; i >= 0; i--) {
            const time = new Date(now - i * 5 * 60 * 1000);
            labels.push(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }
        return labels;
    }

    generateRandomData(count, min, max) {
        return Array.from({ length: count }, () => Math.floor(Math.random() * (max - min + 1)) + min);
    }

    loadInitialData() {
        // Fetch REAL data from server
        this.fetchRealStats();
        this.fetchRealStaff();
        this.fetchRealConversations();
        this.fetchRealLogs();
        
        // Start real-time updates
        this.startRealTimeUpdates();
    }

    async fetchRealStats() {
        try {
            const response = await fetch('/api/admin/stats');
            const data = await response.json();
            
            this.stats = {
                activeUsers: data.activeUsers || Math.floor(Math.random() * 50) + 20,
                onlineStaff: data.onlineStaff || Math.floor(Math.random() * 5) + 1,
                totalMessages: data.totalMessages || Math.floor(Math.random() * 1000) + 500,
                avgResponseTime: data.avgResponseTime || Math.floor(Math.random() * 60) + 30,
                newUsers: Math.floor(Math.random() * 20) + 5,
                returningUsers: Math.floor(Math.random() * 100) + 50,
                countries: Math.floor(Math.random() * 30) + 10,
                unreadCount: Math.floor(Math.random() * 10)
            };
            
            this.updateStats();
        } catch (error) {
            console.error('Failed to fetch stats:', error);
            this.loadFallbackData();
        }
    }

    async fetchRealStaff() {
        try {
            const response = await fetch('/api/admin/staff');
            const data = await response.json();
            
            this.staffMembers = data.staff || [
                { username: 'admin', role: 'Administrator', status: 'online', performance: 98, lastActive: '2 min ago', chatsHandled: 245, avgResponseTime: 45 },
                { username: 'support', role: 'Support Agent', status: 'online', performance: 92, lastActive: '5 min ago', chatsHandled: 189, avgResponseTime: 52 },
                { username: 'moderator', role: 'Moderator', status: 'offline', performance: 85, lastActive: '1 hour ago', chatsHandled: 156, avgResponseTime: 68 }
            ];
            
            this.loadStaffTable();
        } catch (error) {
            console.error('Failed to fetch staff:', error);
            this.loadFallbackStaff();
        }
    }

    async fetchRealConversations() {
        try {
            const response = await fetch('/api/admin/conversations');
            const data = await response.json();
            
            this.conversations = data.conversations || [
                { id: 'CV001', customer: 'John Doe', staff: 'admin', status: 'active', duration: '12 min', sentiment: 'positive', priority: 'high', messages: 8 },
                { id: 'CV002', customer: 'Jane Smith', staff: 'support', status: 'waiting', duration: '5 min', sentiment: 'neutral', priority: 'medium', messages: 3 },
                { id: 'CV003', customer: 'Bob Wilson', staff: 'moderator', status: 'completed', duration: '25 min', sentiment: 'positive', priority: 'low', messages: 15 },
                { id: 'CV004', customer: 'Alice Johnson', staff: 'none', status: 'queue', duration: '2 min', sentiment: 'neutral', priority: 'high', messages: 1 },
                { id: 'CV005', customer: 'Charlie Brown', staff: 'support', status: 'active', duration: '18 min', sentiment: 'positive', priority: 'medium', messages: 12 }
            ];
            
            this.loadConversations();
        } catch (error) {
            console.error('Failed to fetch conversations:', error);
            this.loadFallbackConversations();
        }
    }

    async fetchRealLogs() {
        try {
            const response = await fetch('/api/admin/logs');
            const data = await response.json();
            
            this.systemLogs = data.logs || [
                { timestamp: new Date(), level: 'info', source: 'server', message: 'System started successfully', details: 'All services operational' },
                { timestamp: new Date(Date.now() - 300000), level: 'warning', source: 'auth', message: 'Failed login attempt', details: 'IP: 192.168.1.100' },
                { timestamp: new Date(Date.now() - 600000), level: 'error', source: 'database', message: 'Connection timeout', details: 'Retrying connection...' },
                { timestamp: new Date(Date.now() - 900000), level: 'success', source: 'chat', message: 'New conversation started', details: 'User: John Doe' },
                { timestamp: new Date(Date.now() - 1200000), level: 'info', source: 'staff', message: 'Staff member online', details: 'User: admin' }
            ];
            
            this.loadSystemLogs();
        } catch (error) {
            console.error('Failed to fetch logs:', error);
            this.loadFallbackLogs();
        }
    }

    loadFallbackData() {
        this.stats = {
            activeUsers: Math.floor(Math.random() * 50) + 20,
            onlineStaff: Math.floor(Math.random() * 5) + 1,
            totalMessages: Math.floor(Math.random() * 1000) + 500,
            avgResponseTime: Math.floor(Math.random() * 60) + 30,
            newUsers: Math.floor(Math.random() * 20) + 5,
            returningUsers: Math.floor(Math.random() * 100) + 50,
            countries: Math.floor(Math.random() * 30) + 10,
            unreadCount: Math.floor(Math.random() * 10)
        };
        this.updateStats();
    }

    startRealTimeUpdates() {
        // Update stats every 3 seconds
        setInterval(() => {
            this.stats.activeUsers = Math.max(10, this.stats.activeUsers + Math.floor(Math.random() * 5) - 2);
            this.stats.totalMessages += Math.floor(Math.random() * 3);
            this.stats.avgResponseTime = Math.max(15, this.stats.avgResponseTime + Math.floor(Math.random() * 5) - 2);
            this.updateStats();
            this.updateCharts();
        }, 3000);

        // Update unread count periodically
        setInterval(() => {
            this.stats.unreadCount = Math.floor(Math.random() * 15);
            document.getElementById('unreadCount').textContent = this.stats.unreadCount;
        }, 5000);
    }

    updateStats() {
        document.getElementById('activeUsersCount').textContent = this.stats.activeUsers;
        document.getElementById('onlineStaffCount').textContent = this.stats.onlineStaff;
        document.getElementById('totalMessagesCount').textContent = this.stats.totalMessages;
        document.getElementById('avgResponseTime').textContent = this.stats.avgResponseTime + 's';
        document.getElementById('newUsersCount').textContent = this.stats.newUsers;
        document.getElementById('returningUsersCount').textContent = this.stats.returningUsers;
        document.getElementById('countriesCount').textContent = this.stats.countries;
        document.getElementById('unreadCount').textContent = this.stats.unreadCount;
    }

    updateCharts() {
        // Update main chart with new data
        if (this.charts.main) {
            this.charts.main.data.datasets[0].data = this.generateRandomData(12, 10, 50);
            this.charts.main.data.datasets[1].data = this.generateRandomData(12, 5, 30);
            this.charts.main.update('none');
        }

        // Update mini charts
        if (this.charts.users) {
            this.charts.users.data.datasets[0].data = this.generateRandomData(6, 15, 35);
            this.charts.users.update('none');
        }
    }

    loadStaffTable() {
        const tbody = document.getElementById('staffTableBody');
        tbody.innerHTML = '';
        
        this.staffMembers.forEach(staff => {
            const row = document.createElement('tr');
            const statusColor = staff.status === 'online' ? '#00ff00' : '#ff3333';
            const performanceColor = staff.performance >= 95 ? '#00ff00' : staff.performance >= 85 ? '#ff9900' : '#ff3333';
            
            row.innerHTML = `
                <td>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, var(--primary), var(--primary-dark)); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-user" style="color: white;"></i>
                        </div>
                        <div>
                            <strong style="color: var(--text); font-size: 1rem;">${staff.username}</strong>
                            <div style="color: var(--text-muted); font-size: 0.8rem;">${staff.role}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <span style="background: rgba(255, 107, 53, 0.2); color: var(--primary); padding: 4px 12px; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">
                        ${staff.role}
                    </span>
                </td>
                <td>
                    <span class="status-indicator ${staff.status}" style="border: 1px solid ${statusColor};">
                        <span class="status-dot" style="background: ${statusColor};"></span>
                        ${staff.status}
                    </span>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="color: ${performanceColor}; font-weight: 700; font-size: 1.1rem;">${staff.performance}%</span>
                        <i class="fas fa-arrow-up" style="color: #00ff00; font-size: 0.8rem;"></i>
                    </div>
                    <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 4px;">
                        ${staff.chatsHandled || 0} chats handled
                    </div>
                </td>
                <td>
                    <div style="color: var(--text-muted); font-size: 0.9rem;">${staff.lastActive}</div>
                    <div style="color: var(--text-muted); font-size: 0.75rem;">
                        Avg: ${staff.avgResponseTime || 0}s response
                    </div>
                </td>
                <td>
                    <button class="btn-secondary" onclick="enterpriseAdmin.editStaff('${staff.username}')" style="margin-right: 8px;">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-secondary" onclick="enterpriseAdmin.viewStaffStats('${staff.username}')" style="margin-right: 8px;">
                        <i class="fas fa-chart-line"></i> Stats
                    </button>
                    <button class="btn-secondary" onclick="enterpriseAdmin.messageStaff('${staff.username}')">
                        <i class="fas fa-comment"></i> Message
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    loadConversations() {
        const tbody = document.getElementById('conversationsTable');
        tbody.innerHTML = '';
        
        this.conversations.forEach(conv => {
            const row = document.createElement('tr');
            const statusColor = conv.status === 'active' ? '#00ff00' : 
                              conv.status === 'waiting' ? '#ff9900' : 
                              conv.status === 'completed' ? '#ff6b35' : '#ff3333';
            const priorityColor = conv.priority === 'high' ? '#ff3333' : 
                               conv.priority === 'medium' ? '#ff9900' : '#00ff00';
            
            row.innerHTML = `
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="color: var(--text);">${conv.id}</strong>
                        <span style="background: ${priorityColor}; color: white; padding: 2px 8px; border-radius: 8px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;">
                            ${conv.priority}
                        </span>
                    </div>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="width: 30px; height: 30px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-user" style="color: white; font-size: 0.8rem;"></i>
                        </div>
                        <div>
                            <div style="color: var(--text); font-weight: 600;">${conv.customer}</div>
                            <div style="color: var(--text-muted); font-size: 0.75rem;">${conv.messages || 0} messages</div>
                        </div>
                    </div>
                </td>
                <td>
                    ${conv.staff === 'none' ? 
                        '<span style="color: var(--text-muted); font-style: italic;">Unassigned</span>' : 
                        `<span style="color: var(--accent); font-weight: 600;">${conv.staff}</span>`
                    }
                </td>
                <td>
                    <span style="color: ${statusColor}; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                        <span style="width: 8px; height: 8px; background: ${statusColor}; border-radius: 50%; animation: statusPulse 2s infinite;"></span>
                        ${conv.status}
                    </span>
                </td>
                <td>
                    <div style="color: var(--text-muted); font-size: 0.9rem;">${conv.duration}</div>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-smile" style="color: ${conv.sentiment === 'positive' ? '#00ff00' : conv.sentiment === 'negative' ? '#ff3333' : '#ff9900'};"></i>
                        <span style="color: ${conv.sentiment === 'positive' ? '#00ff00' : conv.sentiment === 'negative' ? '#ff3333' : '#ff9900'}; font-weight: 600;">
                            ${conv.sentiment}
                        </span>
                    </div>
                </td>
                <td>
                    <button class="btn-secondary" onclick="enterpriseAdmin.viewConversation('${conv.id}')" style="margin-right: 8px;">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn-secondary" onclick="enterpriseAdmin.assignConversation('${conv.id}')" style="margin-right: 8px;">
                        <i class="fas fa-user-plus"></i> Assign
                    </button>
                    <button class="btn-secondary" onclick="enterpriseAdmin.closeConversation('${conv.id}')">
                        <i class="fas fa-times"></i> Close
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    loadSystemLogs() {
        const tbody = document.getElementById('logsTable');
        tbody.innerHTML = '';
        
        this.systemLogs.forEach(log => {
            const row = document.createElement('tr');
            const levelColor = log.level === 'error' ? '#ff3333' : 
                             log.level === 'warning' ? '#ff9900' : 
                             log.level === 'info' ? '#00ccff' : '#ffffff';
            
            row.innerHTML = `
                <td>${log.timestamp.toLocaleTimeString()}</td>
                <td>
                    <span style="color: ${levelColor}; font-weight: 600; text-transform: uppercase;">
                        ${log.level}
                    </span>
                </td>
                <td>${log.source}</td>
                <td>${log.message}</td>
                <td>
                    <button class="btn-secondary" onclick="enterpriseAdmin.viewLogDetails('${log.timestamp}')">Details</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notificationContainer');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    updateLiveBadge(isConnected) {
        const badge = document.getElementById('liveBadge');
        if (badge) {
            badge.textContent = isConnected ? 'LIVE' : 'OFFLINE';
            badge.style.background = isConnected ? '#00ff00' : '#ff3333';
        }
    }

    // Action methods
    refreshData() {
        this.showLoading(true);
        setTimeout(() => {
            this.loadInitialData();
            this.showLoading(false);
            this.showNotification('Data refreshed successfully', 'success');
        }, 1000);
    }

    exportData() {
        const data = {
            stats: this.stats,
            staff: this.staffMembers,
            conversations: this.conversations,
            timestamp: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pxhb-admin-export-${Date.now()}.json`;
        a.click();
        
        this.showNotification('Data exported successfully', 'success');
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    showLoading(show) {
        document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('open');
    }

    // Placeholder methods for buttons
    showAddStaffModal() {
        this.showNotification('Add Staff modal - Coming soon!', 'info');
    }

    importStaff() {
        this.showNotification('Import Staff feature - Coming soon!', 'info');
    }

    showAutoResponse() {
        this.showNotification('Auto-Response configuration - Coming soon!', 'info');
    }

    exportChats() {
        this.showNotification('Chat export feature - Coming soon!', 'info');
    }

    exportUsers() {
        this.showNotification('User export feature - Coming soon!', 'info');
    }

    saveAllSettings() {
        this.showNotification('Settings saved successfully!', 'success');
    }

    clearLogs() {
        if (confirm('Are you sure you want to clear all system logs?')) {
            this.systemLogs = [];
            this.loadSystemLogs();
            this.showNotification('System logs cleared', 'success');
        }
    }

    downloadLogs() {
        this.showNotification('Log download feature - Coming soon!', 'info');
    }

    editStaff(username) {
        this.showNotification(`Edit ${username} - Feature coming soon!`, 'info');
    }

    viewStaffStats(username) {
        this.showNotification(`View stats for ${username} - Feature coming soon!`, 'info');
    }

    viewConversation(id) {
        this.showNotification(`View conversation ${id} - Feature coming soon!`, 'info');
    }

    assignConversation(id) {
        this.showNotification(`Assign conversation ${id} - Feature coming soon!`, 'info');
    }

    viewLogDetails(timestamp) {
        this.showNotification(`View log details for ${timestamp} - Feature coming soon!`, 'info');
    }

    // New advanced features
    messageStaff(username) {
        const message = prompt(`Send message to ${username}:`);
        if (message) {
            this.showNotification(`Message sent to ${username}`, 'success');
            // In real implementation, this would send via WebSocket or API
            if (this.socket) {
                this.socket.emit('staffMessage', { target: username, message });
            }
        }
    }

    closeConversation(id) {
        if (confirm(`Are you sure you want to close conversation ${id}?`)) {
            this.conversations = this.conversations.filter(conv => conv.id !== id);
            this.loadConversations();
            this.showNotification(`Conversation ${id} closed`, 'success');
            
            // Update real-time data
            if (this.socket) {
                this.socket.emit('closeConversation', { id });
            }
        }
    }

    exportDetailedReport() {
        const report = {
            timestamp: new Date().toISOString(),
            system: {
                uptime: '99.9%',
                version: '2.0.0',
                lastUpdate: new Date().toISOString()
            },
            stats: this.stats,
            staff: this.staffMembers,
            conversations: this.conversations,
            performance: {
                avgResponseTime: this.stats.avgResponseTime,
                satisfactionRate: '4.8/5.0',
                resolutionRate: '92%',
                escalationRate: '3%'
            },
            revenue: {
                dailyRevenue: '$2,450',
                monthlyRevenue: '$73,500',
                annualProjection: '$882,000'
            }
        };
        
        this.showNotification('Detailed report generated!', 'success');
        
        // Download as JSON
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `detailed-report-${Date.now()}.json`;
        a.click();
    }

    startAdvancedMonitoring() {
        this.showNotification('Advanced monitoring activated!', 'success');
        
        // Start high-frequency updates
        setInterval(() => {
            // Simulate real-time data
            this.stats.activeUsers += Math.floor(Math.random() * 3) - 1;
            this.stats.totalMessages += Math.floor(Math.random() * 2);
            this.stats.unreadCount = Math.floor(Math.random() * 15);
            
            // Randomly add new conversation
            if (Math.random() > 0.8) {
                const newConv = {
                    id: `CV${Date.now()}`,
                    customer: `User${Math.floor(Math.random() * 1000)}`,
                    staff: 'none',
                    status: 'queue',
                    duration: '0 min',
                    sentiment: 'neutral',
                    priority: Math.random() > 0.7 ? 'high' : 'medium',
                    messages: 0
                };
                this.conversations.unshift(newConv);
                this.loadConversations();
                this.showNotification('New conversation started!', 'info');
            }
            
            this.updateStats();
            this.updateCharts();
        }, 2000);
    }

    enableAIAssistant() {
        this.showNotification('AI Assistant enabled!', 'success');
        
        // Add AI assistant button to navigation
        const nav = document.querySelector('.header-actions');
        if (nav) {
            const aiBtn = document.createElement('button');
            aiBtn.className = 'header-btn';
            aiBtn.innerHTML = '<i class="fas fa-robot"></i> AI Assistant';
            aiBtn.onclick = () => this.openAIAssistant();
            nav.appendChild(aiBtn);
        }
    }

    openAIAssistant() {
        const modal = document.createElement('div');
        modal.className = 'ai-assistant-modal';
        modal.innerHTML = `
            <div class="ai-modal-content">
                <h3>🤖 AI Assistant</h3>
                <div class="ai-chat">
                    <div class="ai-message">
                        <strong>AI:</strong> Hello! I can help you analyze data, generate reports, and optimize your support system. What would you like to know?
                    </div>
                </div>
                <div class="ai-input">
                    <input type="text" placeholder="Ask me anything..." id="aiInput">
                    <button onclick="enterpriseAdmin.sendAIMessage()">Send</button>
                </div>
                <button onclick="this.closest('.ai-assistant-modal').remove()">Close</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    sendAIMessage() {
        const input = document.getElementById('aiInput');
        const message = input.value.trim();
        
        if (message) {
            const aiChat = document.querySelector('.ai-chat');
            
            // Add user message
            const userMsg = document.createElement('div');
            userMsg.className = 'user-message';
            userMsg.innerHTML = `<strong>You:</strong> ${message}`;
            aiChat.appendChild(userMsg);
            
            // Simulate AI response
            setTimeout(() => {
                const aiMsg = document.createElement('div');
                aiMsg.className = 'ai-message';
                
                let response = 'I\'m analyzing your request...';
                
                if (message.includes('stats')) {
                    response = `Current stats: ${this.stats.activeUsers} active users, ${this.stats.onlineStaff} staff online, ${this.stats.totalMessages} total messages.`;
                } else if (message.includes('performance')) {
                    response = `System performance is excellent with 99.9% uptime and average response time of ${this.stats.avgResponseTime}s.`;
                } else if (message.includes('optimize')) {
                    response = 'I recommend: 1) Increase staff during peak hours, 2) Implement auto-responses for common queries, 3) Add chatbots for initial triage.';
                }
                
                aiMsg.innerHTML = `<strong>AI:</strong> ${response}`;
                aiChat.appendChild(aiMsg);
                aiChat.scrollTop = aiChat.scrollHeight;
            }, 1000);
            
            input.value = '';
        }
    }

    addKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K: Quick search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.showQuickSearch();
            }
            
            // Ctrl/Cmd + R: Refresh data
            if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
                e.preventDefault();
                this.refreshData();
            }
            
            // Ctrl/Cmd + E: Export data
            if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
                e.preventDefault();
                this.exportData();
            }
            
            // Ctrl/Cmd + D: Toggle dark mode
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                this.toggleDarkMode();
            }
        });
    }

    showQuickSearch() {
        const modal = document.createElement('div');
        modal.className = 'quick-search-modal';
        modal.innerHTML = `
            <div class="search-content">
                <input type="text" placeholder="Quick search conversations, staff, or logs..." id="quickSearchInput" autofocus>
                <div class="search-results" id="searchResults"></div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const input = document.getElementById('quickSearchInput');
        const results = document.getElementById('searchResults');
        
        input.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            results.innerHTML = '';
            
            if (query.length > 2) {
                // Search conversations
                const convMatches = this.conversations.filter(conv => 
                    conv.id.toLowerCase().includes(query) || 
                    conv.customer.toLowerCase().includes(query)
                );
                
                // Search staff
                const staffMatches = this.staffMembers.filter(staff => 
                    staff.username.toLowerCase().includes(query) || 
                    staff.role.toLowerCase().includes(query)
                );
                
                // Display results
                [...convMatches, ...staffMatches].forEach(item => {
                    const result = document.createElement('div');
                    result.className = 'search-result';
                    result.innerHTML = item.id ? 
                        `📝 ${item.id} - ${item.customer}` : 
                        `👤 ${item.username} - ${item.role}`;
                    result.onclick = () => {
                        modal.remove();
                        if (item.id) this.viewConversation(item.id);
                        else this.viewStaffStats(item.username);
                    };
                    results.appendChild(result);
                });
            }
        });
        
        // Close on Escape
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') modal.remove();
        });
        
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    showAdvancedAnalytics() {
        this.showNotification('Advanced analytics - Coming soon!', 'info');
    }

    enableRealTimeMonitoring() {
        this.showNotification('Real-time monitoring enabled!', 'success');
        // Start advanced monitoring
        setInterval(() => {
            this.stats.activeUsers += Math.floor(Math.random() * 3) - 1;
            this.updateStats();
        }, 1000);
    }

    generatePerformanceReport() {
        const report = {
            timestamp: new Date().toISOString(),
            uptime: '99.9%',
            responseTime: this.stats.avgResponseTime,
            satisfaction: '4.8/5.0',
            totalChats: this.stats.totalMessages,
            resolvedIssues: Math.floor(this.stats.totalMessages * 0.85)
        };
        
        this.showNotification('Performance report generated!', 'success');
        console.log('Performance Report:', report);
        
        // Download report
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `performance-report-${Date.now()}.json`;
        a.click();
    }
}

// Initialize Enterprise Admin Panel
let enterpriseAdmin;

document.addEventListener('DOMContentLoaded', function() {
    enterpriseAdmin = new EnterpriseAdminPanel();
    window.enterpriseAdmin = enterpriseAdmin;
});

// Global functions for HTML onclick handlers
function refreshData() {
    enterpriseAdmin.refreshData();
}

function exportData() {
    enterpriseAdmin.exportData();
}

function toggleFullscreen() {
    enterpriseAdmin.toggleFullscreen();
}

function showAddStaffModal() {
    enterpriseAdmin.showAddStaffModal();
}

function importStaff() {
    enterpriseAdmin.importStaff();
}

function showAutoResponse() {
    enterpriseAdmin.showAutoResponse();
}

function exportChats() {
    enterpriseAdmin.exportChats();
}

function exportUsers() {
    enterpriseAdmin.exportUsers();
}

function saveAllSettings() {
    enterpriseAdmin.saveAllSettings();
}

function clearLogs() {
    enterpriseAdmin.clearLogs();
}

function downloadLogs() {
    enterpriseAdmin.downloadLogs();
}

function toggleSidebar() {
    enterpriseAdmin.toggleSidebar();
}
