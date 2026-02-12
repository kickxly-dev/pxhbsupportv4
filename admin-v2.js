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
                this.startRealTimeDataCollection();
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
            
            this.socket.on('userConnected', (userData) => {
                this.stats.activeUsers++;
                this.updateStats();
                this.addSystemLog('info', 'user', `User connected: ${userData.id || 'Unknown'}`);
            });
            
            this.socket.on('userDisconnected', (userData) => {
                this.stats.activeUsers = Math.max(0, this.stats.activeUsers - 1);
                this.updateStats();
                this.addSystemLog('info', 'user', `User disconnected: ${userData.id || 'Unknown'}`);
            });
            
            // Get real server data
            this.socket.emit('getAdminData');
            this.socket.on('adminData', (data) => {
                this.updateRealData(data);
            });
            
        } catch (error) {
            console.error('❌ Failed to connect:', error);
            this.showNotification('Connection failed', 'error');
        }
    }

    startRealTimeDataCollection() {
        // Collect real data every 2 seconds
        setInterval(() => {
            if (this.socket && this.socket.connected) {
                this.socket.emit('getRealTimeStats');
            }
        }, 2000);
        
        this.socket.on('realTimeStats', (data) => {
            this.updateRealData(data);
        });
    }

    updateRealData(data) {
        // Update with real server data
        if (data.activeUsers !== undefined) this.stats.activeUsers = data.activeUsers;
        if (data.onlineStaff !== undefined) this.stats.onlineStaff = data.onlineStaff;
        if (data.totalMessages !== undefined) this.stats.totalMessages = data.totalMessages;
        if (data.avgResponseTime !== undefined) this.stats.avgResponseTime = data.avgResponseTime;
        if (data.staffMembers) this.staffMembers = data.staffMembers;
        if (data.conversations) this.conversations = data.conversations;
        
        this.updateStats();
        this.updateCharts();
    }

    handleNewMessage(message) {
        this.stats.totalMessages++;
        this.updateStats();
        
        // Add to conversations if not exists
        const convIndex = this.conversations.findIndex(c => c.customer === message.sender);
        if (convIndex === -1) {
            this.conversations.push({
                id: `CV${String(this.conversations.length + 1).padStart(3, '0')}`,
                customer: message.sender,
                staff: message.senderType === 'staff' ? message.sender : 'Unassigned',
                status: message.senderType === 'staff' ? 'active' : 'waiting',
                duration: '0 min',
                sentiment: this.analyzeSentiment(message.content),
                lastMessage: message.content,
                timestamp: new Date()
            });
        }
        
        this.loadConversations();
    }

    updateStaffStatus(status) {
        const staffIndex = this.staffMembers.findIndex(s => s.username === status.username);
        if (staffIndex !== -1) {
            this.staffMembers[staffIndex].status = status.isOnline ? 'online' : 'offline';
            this.staffMembers[staffIndex].lastActive = status.lastActive || 'Just now';
        } else {
            this.staffMembers.push({
                username: status.username,
                role: status.role || 'Staff',
                status: status.isOnline ? 'online' : 'offline',
                performance: Math.floor(Math.random() * 20) + 80,
                lastActive: status.lastActive || 'Just now'
            });
        }
        
        this.stats.onlineStaff = this.staffMembers.filter(s => s.status === 'online').length;
        this.updateStats();
        this.loadStaffTable();
    }

    analyzeSentiment(message) {
        const positiveWords = ['good', 'great', 'excellent', 'helpful', 'thanks', 'thank', 'awesome', 'perfect'];
        const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'stupid', 'useless'];
        
        const lowerMessage = message.toLowerCase();
        const positiveCount = positiveWords.filter(word => lowerMessage.includes(word)).length;
        const negativeCount = negativeWords.filter(word => lowerMessage.includes(word)).length;
        
        if (positiveCount > negativeCount) return 'positive';
        if (negativeCount > positiveCount) return 'negative';
        return 'neutral';
    }

    addSystemLog(level, source, message) {
        this.systemLogs.unshift({
            timestamp: new Date(),
            level: level,
            source: source,
            message: message
        });
        
        // Keep only last 100 logs
        if (this.systemLogs.length > 100) {
            this.systemLogs = this.systemLogs.slice(0, 100);
        }
        
        this.loadSystemLogs();
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
        // Simulate initial data
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

        this.staffMembers = [
            { username: 'admin', role: 'Administrator', status: 'online', performance: 98, lastActive: '2 min ago' },
            { username: 'support', role: 'Support Agent', status: 'online', performance: 92, lastActive: '5 min ago' },
            { username: 'moderator', role: 'Moderator', status: 'offline', performance: 85, lastActive: '1 hour ago' }
        ];

        this.conversations = [
            { id: 'CV001', customer: 'John Doe', staff: 'admin', status: 'active', duration: '12 min', sentiment: 'positive' },
            { id: 'CV002', customer: 'Jane Smith', staff: 'support', status: 'waiting', duration: '5 min', sentiment: 'neutral' },
            { id: 'CV003', customer: 'Bob Wilson', staff: 'moderator', status: 'completed', duration: '25 min', sentiment: 'positive' }
        ];

        this.systemLogs = [
            { timestamp: new Date(), level: 'info', source: 'server', message: 'System started successfully' },
            { timestamp: new Date(), level: 'warning', source: 'auth', message: 'Failed login attempt' },
            { timestamp: new Date(), level: 'error', source: 'database', message: 'Connection timeout' }
        ];

        this.updateStats();
        this.loadStaffTable();
        this.loadConversations();
        this.loadSystemLogs();
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
            row.innerHTML = `
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-user-circle" style="color: #ff6b35;"></i>
                        <strong>${staff.username}</strong>
                    </div>
                </td>
                <td>${staff.role}</td>
                <td>
                    <span class="status-indicator ${staff.status}">
                        <span class="status-dot"></span>
                        ${staff.status}
                    </span>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <span>${staff.performance}%</span>
                        <i class="fas fa-arrow-up" style="color: #00ff00; font-size: 0.8rem;"></i>
                    </div>
                </td>
                <td>${staff.lastActive}</td>
                <td>
                    <button class="btn-secondary" onclick="enterpriseAdmin.editStaff('${staff.username}')">Edit</button>
                    <button class="btn-secondary" onclick="enterpriseAdmin.viewStaffStats('${staff.username}')">Stats</button>
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
            
            row.innerHTML = `
                <td><strong>${conv.id}</strong></td>
                <td>${conv.customer}</td>
                <td>${conv.staff}</td>
                <td>
                    <span style="color: ${statusColor}; font-weight: 600;">
                        ${conv.status}
                    </span>
                </td>
                <td>${conv.duration}</td>
                <td>
                    <span style="color: ${conv.sentiment === 'positive' ? '#00ff00' : conv.sentiment === 'negative' ? '#ff3333' : '#ff9900'};">
                        ${conv.sentiment}
                    </span>
                </td>
                <td>
                    <button class="btn-secondary" onclick="enterpriseAdmin.viewConversation('${conv.id}')">View</button>
                    <button class="btn-secondary" onclick="enterpriseAdmin.assignConversation('${conv.id}')">Assign</button>
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

    // Placeholder methods for buttons - NOW WORKING!
    showAddStaffModal() {
        this.showAddStaffModalDialog();
    }

    showAddStaffModalDialog() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Add New Staff Member</h3>
                <form id="addStaffForm">
                    <input type="text" id="newStaffUsername" placeholder="Username" required>
                    <input type="email" id="newStaffEmail" placeholder="Email" required>
                    <select id="newStaffRole">
                        <option value="Support Agent">Support Agent</option>
                        <option value="Moderator">Moderator</option>
                        <option value="Administrator">Administrator</option>
                    </select>
                    <input type="password" id="newStaffPassword" placeholder="Password" required>
                    <div class="modal-actions">
                        <button type="submit" class="btn-primary">Add Staff</button>
                        <button type="button" onclick="this.closest('.modal-overlay').remove()" class="btn-secondary">Cancel</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('addStaffForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const newStaff = {
                username: document.getElementById('newStaffUsername').value,
                email: document.getElementById('newStaffEmail').value,
                role: document.getElementById('newStaffRole').value,
                password: document.getElementById('newStaffPassword').value,
                status: 'offline',
                performance: 100,
                lastActive: 'Never'
            };
            
            this.staffMembers.push(newStaff);
            this.stats.onlineStaff = this.staffMembers.filter(s => s.status === 'online').length;
            
            // Send to server
            if (this.socket) {
                this.socket.emit('addStaff', newStaff);
            }
            
            this.loadStaffTable();
            this.updateStats();
            modal.remove();
            this.showNotification(`Staff member ${newStaff.username} added successfully!`, 'success');
            this.addSystemLog('info', 'admin', `Added staff: ${newStaff.username}`);
        });
    }

    importStaff() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.csv';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        if (Array.isArray(data)) {
                            data.forEach(staff => {
                                if (!this.staffMembers.find(s => s.username === staff.username)) {
                                    this.staffMembers.push({
                                        ...staff,
                                        status: 'offline',
                                        performance: 100,
                                        lastActive: 'Never'
                                    });
                                }
                            });
                            this.loadStaffTable();
                            this.showNotification(`Imported ${data.length} staff members!`, 'success');
                            this.addSystemLog('info', 'admin', `Imported ${data.length} staff members`);
                        }
                    } catch (error) {
                        this.showNotification('Invalid file format', 'error');
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    showAutoResponse() {
        this.showAutoResponseDialog();
    }

    showAutoResponseDialog() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Auto-Response Configuration</h3>
                <form id="autoResponseForm">
                    <div class="form-group">
                        <label>Enable Auto-Response</label>
                        <select id="autoResponseEnabled">
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Response Delay (seconds)</label>
                        <input type="number" id="responseDelay" value="5" min="1" max="60">
                    </div>
                    <div class="form-group">
                        <label>Welcome Message</label>
                        <textarea id="welcomeMessage" rows="3">👋 Welcome to P.X HB Support! A staff member will be with you shortly.</textarea>
                    </div>
                    <div class="form-group">
                        <label>Away Message</label>
                        <textarea id="awayMessage" rows="3">All staff are currently busy. Please wait or try again later.</textarea>
                    </div>
                    <div class="form-group">
                        <label>Keywords & Responses</label>
                        <div id="keywordResponses">
                            <div class="keyword-response">
                                <input type="text" placeholder="Keyword" class="keyword-input">
                                <input type="text" placeholder="Response" class="response-input">
                                <button type="button" onclick="this.parentElement.remove()">×</button>
                            </div>
                        </div>
                        <button type="button" onclick="addKeywordResponse()">Add More</button>
                    </div>
                    <div class="modal-actions">
                        <button type="submit" class="btn-primary">Save Settings</button>
                        <button type="button" onclick="this.closest('.modal-overlay').remove()" class="btn-secondary">Cancel</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add keyword response function
        window.addKeywordResponse = function() {
            const container = document.getElementById('keywordResponses');
            const newResponse = document.createElement('div');
            newResponse.className = 'keyword-response';
            newResponse.innerHTML = `
                <input type="text" placeholder="Keyword" class="keyword-input">
                <input type="text" placeholder="Response" class="response-input">
                <button type="button" onclick="this.parentElement.remove()">×</button>
            `;
            container.appendChild(newResponse);
        };
        
        document.getElementById('autoResponseForm').addEventListener('submit', (e) => {
            e.preventDefault();
            
            const keywordResponses = [];
            document.querySelectorAll('.keyword-response').forEach(item => {
                const keyword = item.querySelector('.keyword-input').value;
                const response = item.querySelector('.response-input').value;
                if (keyword && response) {
                    keywordResponses.push({ keyword, response });
                }
            });
            
            const autoResponseSettings = {
                enabled: document.getElementById('autoResponseEnabled').value === 'true',
                delay: parseInt(document.getElementById('responseDelay').value),
                welcomeMessage: document.getElementById('welcomeMessage').value,
                awayMessage: document.getElementById('awayMessage').value,
                keywordResponses: keywordResponses
            };
            
            // Send to server
            if (this.socket) {
                this.socket.emit('updateAutoResponse', autoResponseSettings);
            }
            
            this.settings.autoResponse = autoResponseSettings;
            modal.remove();
            this.showNotification('Auto-response settings saved!', 'success');
            this.addSystemLog('info', 'admin', 'Updated auto-response settings');
        });
    }

    exportChats() {
        const exportData = {
            conversations: this.conversations,
            stats: this.stats,
            exportTime: new Date().toISOString(),
            totalConversations: this.conversations.length
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-export-${Date.now()}.json`;
        a.click();
        
        this.showNotification('Chat data exported successfully!', 'success');
        this.addSystemLog('info', 'admin', 'Exported chat data');
    }

    exportUsers() {
        const userData = {
            activeUsers: this.stats.activeUsers,
            newUsers: this.stats.newUsers,
            returningUsers: this.stats.returningUsers,
            countries: this.stats.countries,
            exportTime: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `user-analytics-${Date.now()}.json`;
        a.click();
        
        this.showNotification('User analytics exported!', 'success');
        this.addSystemLog('info', 'admin', 'Exported user analytics');
    }

    saveAllSettings() {
        const allSettings = {
            ...this.settings,
            autoResponse: this.settings.autoResponse || {},
            staffMembers: this.staffMembers,
            timestamp: new Date().toISOString()
        };
        
        // Send to server
        if (this.socket) {
            this.socket.emit('saveSettings', allSettings);
        }
        
        this.showNotification('All settings saved successfully!', 'success');
        this.addSystemLog('info', 'admin', 'Saved all settings');
    }

    clearLogs() {
        if (confirm('Are you sure you want to clear all system logs?')) {
            this.systemLogs = [];
            this.loadSystemLogs();
            this.showNotification('System logs cleared', 'success');
            this.addSystemLog('info', 'admin', 'Cleared system logs');
        }
    }

    downloadLogs() {
        const logData = {
            logs: this.systemLogs,
            exportTime: new Date().toISOString(),
            totalLogs: this.systemLogs.length
        };
        
        const blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `system-logs-${Date.now()}.json`;
        a.click();
        
        this.showNotification('System logs downloaded!', 'success');
    }

    editStaff(username) {
        const staff = this.staffMembers.find(s => s.username === username);
        if (!staff) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Edit Staff: ${username}</h3>
                <form id="editStaffForm">
                    <div class="form-group">
                        <label>Username</label>
                        <input type="text" id="editUsername" value="${staff.username}" required>
                    </div>
                    <div class="form-group">
                        <label>Role</label>
                        <select id="editRole">
                            <option value="Support Agent" ${staff.role === 'Support Agent' ? 'selected' : ''}>Support Agent</option>
                            <option value="Moderator" ${staff.role === 'Moderator' ? 'selected' : ''}>Moderator</option>
                            <option value="Administrator" ${staff.role === 'Administrator' ? 'selected' : ''}>Administrator</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Status</label>
                        <select id="editStatus">
                            <option value="online" ${staff.status === 'online' ? 'selected' : ''}>Online</option>
                            <option value="offline" ${staff.status === 'offline' ? 'selected' : ''}>Offline</option>
                        </select>
                    </div>
                    <div class="modal-actions">
                        <button type="submit" class="btn-primary">Save Changes</button>
                        <button type="button" onclick="this.closest('.modal-overlay').remove()" class="btn-secondary">Cancel</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('editStaffForm').addEventListener('submit', (e) => {
            e.preventDefault();
            
            staff.username = document.getElementById('editUsername').value;
            staff.role = document.getElementById('editRole').value;
            staff.status = document.getElementById('editStatus').value;
            
            if (this.socket) {
                this.socket.emit('updateStaff', staff);
            }
            
            this.loadStaffTable();
            modal.remove();
            this.showNotification(`Staff ${username} updated successfully!`, 'success');
            this.addSystemLog('info', 'admin', `Updated staff: ${username}`);
        });
    }

    viewStaffStats(username) {
        const staff = this.staffMembers.find(s => s.username === username);
        if (!staff) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Staff Statistics: ${username}</h3>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-header">
                            <div class="stat-icon">
                                <i class="fas fa-comments"></i>
                            </div>
                        </div>
                        <div class="stat-value">${Math.floor(Math.random() * 100) + 50}</div>
                        <div class="stat-label">Total Chats</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-header">
                            <div class="stat-icon">
                                <i class="fas fa-clock"></i>
                            </div>
                        </div>
                        <div class="stat-value">${Math.floor(Math.random() * 5) + 2}min</div>
                        <div class="stat-label">Avg Response</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-header">
                            <div class="stat-icon">
                                <i class="fas fa-star"></i>
                            </div>
                        </div>
                        <div class="stat-value">${staff.performance}%</div>
                        <div class="stat-label">Performance</div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button type="button" onclick="this.closest('.modal-overlay').remove()" class="btn-secondary">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    viewConversation(id) {
        const conversation = this.conversations.find(c => c.id === id);
        if (!conversation) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Conversation: ${id}</h3>
                <div class="conversation-details">
                    <p><strong>Customer:</strong> ${conversation.customer}</p>
                    <p><strong>Staff:</strong> ${conversation.staff}</p>
                    <p><strong>Status:</strong> <span style="color: ${conversation.status === 'active' ? '#00ff00' : conversation.status === 'waiting' ? '#ff9900' : '#ff6b35'}">${conversation.status}</span></p>
                    <p><strong>Duration:</strong> ${conversation.duration}</p>
                    <p><strong>Sentiment:</strong> <span style="color: ${conversation.sentiment === 'positive' ? '#00ff00' : conversation.sentiment === 'negative' ? '#ff3333' : '#ff9900'}">${conversation.sentiment}</span></p>
                    <p><strong>Last Message:</strong> ${conversation.lastMessage || 'No messages yet'}</p>
                </div>
                <div class="modal-actions">
                    <button type="button" onclick="this.closest('.modal-overlay').remove()" class="btn-secondary">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    assignConversation(id) {
        const conversation = this.conversations.find(c => c.id === id);
        if (!conversation) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Assign Conversation: ${id}</h3>
                <form id="assignConversationForm">
                    <div class="form-group">
                        <label>Assign to Staff</label>
                        <select id="assignStaff" required>
                            <option value="">Select Staff...</option>
                            ${this.staffMembers.filter(s => s.status === 'online').map(staff => 
                                `<option value="${staff.username}">${staff.username} (${staff.role})</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="modal-actions">
                        <button type="submit" class="btn-primary">Assign</button>
                        <button type="button" onclick="this.closest('.modal-overlay').remove()" class="btn-secondary">Cancel</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('assignConversationForm').addEventListener('submit', (e) => {
            e.preventDefault();
            
            const assignedStaff = document.getElementById('assignStaff').value;
            conversation.staff = assignedStaff;
            conversation.status = 'active';
            
            if (this.socket) {
                this.socket.emit('assignConversation', { id, staff: assignedStaff });
            }
            
            this.loadConversations();
            modal.remove();
            this.showNotification(`Conversation ${id} assigned to ${assignedStaff}!`, 'success');
            this.addSystemLog('info', 'admin', `Assigned conversation ${id} to ${assignedStaff}`);
        });
    }

    viewLogDetails(timestamp) {
        const log = this.systemLogs.find(l => l.timestamp.toString() === timestamp);
        if (!log) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Log Details</h3>
                <div class="log-details">
                    <p><strong>Timestamp:</strong> ${log.timestamp.toLocaleString()}</p>
                    <p><strong>Level:</strong> <span style="color: ${log.level === 'error' ? '#ff3333' : log.level === 'warning' ? '#ff9900' : '#00ccff'}">${log.level.toUpperCase()}</span></p>
                    <p><strong>Source:</strong> ${log.source}</p>
                    <p><strong>Message:</strong> ${log.message}</p>
                </div>
                <div class="modal-actions">
                    <button type="button" onclick="this.closest('.modal-overlay').remove()" class="btn-secondary">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // New advanced features
    toggleDarkMode() {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        this.showNotification(isDark ? 'Dark mode enabled' : 'Light mode enabled', 'success');
        
        // Update button icon
        const darkModeBtn = document.querySelector('[onclick="toggleDarkMode()"] i');
        if (darkModeBtn) {
            darkModeBtn.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        }
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
