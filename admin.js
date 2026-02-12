// P.X HB Admin Panel - Management System
class AdminPanel {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.stats = {
            activeUsers: 0,
            onlineStaff: 0,
            totalMessages: 0,
            avgResponseTime: 0
        };
        this.staffMembers = [];
        this.chatMessages = [];
        this.settings = {
            siteTitle: 'P.X HB Support',
            welcomeMessage: '👋 Welcome to P.X HB Support! Please wait for a staff member to join the chat.',
            autoResponse: 'Please wait for a staff member to join the chat. Staff will respond when available.'
        };
        
        this.init();
    }

    init() {
        this.checkAdminAuth();
        this.connectSocket();
        this.setupEventListeners();
        this.loadStaffData();
        this.loadSettings();
        this.updateStats();
    }

    checkAdminAuth() {
        // Check if user is authenticated as admin
        const adminUser = sessionStorage.getItem('adminUser');
        if (!adminUser) {
            // Redirect to login or show login modal
            this.showAdminLogin();
        } else {
            this.currentUser = adminUser;
            document.getElementById('adminUsername').textContent = adminUser;
        }
    }

    showAdminLogin() {
        // Simple admin login (in production, use secure authentication)
        const username = prompt('Admin Username:');
        const password = prompt('Admin Password:');
        
        // For demo, use same credentials as staff login
        const ADMIN_CREDENTIALS = {
            'admin': 'pxhb2024'
        };
        
        if (ADMIN_CREDENTIALS[username] && ADMIN_CREDENTIALS[username] === password) {
            this.currentUser = username;
            sessionStorage.setItem('adminUser', username);
            document.getElementById('adminUsername').textContent = username;
        } else {
            alert('Invalid admin credentials');
            location.reload();
        }
    }

    connectSocket() {
        try {
            this.socket = io(window.location.origin);
            
            this.socket.on('connect', () => {
                console.log('✅ Admin panel connected to server');
                this.showNotification('Connected to server', 'success');
            });
            
            this.socket.on('disconnect', () => {
                console.log('❌ Admin panel disconnected');
                this.showNotification('Connection lost', 'error');
            });
            
            // Listen for real-time updates
            this.socket.on('newMessage', (message) => {
                this.handleNewMessage(message);
            });
            
            this.socket.on('staffStatusUpdate', (status) => {
                this.updateStaffStatus(status);
            });
            
            this.socket.on('userConnected', () => {
                this.stats.activeUsers++;
                this.updateStatsDisplay();
            });
            
            this.socket.on('userDisconnected', () => {
                this.stats.activeUsers = Math.max(0, this.stats.activeUsers - 1);
                this.updateStatsDisplay();
            });
            
        } catch (error) {
            console.error('❌ Failed to connect admin panel:', error);
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.target.getAttribute('href').substring(1);
                this.showSection(section);
                
                // Update active nav
                document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        // Add staff form
        document.getElementById('addStaffForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addStaffMember();
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
            case 'staff':
                this.loadStaffTable();
                break;
            case 'chats':
                this.loadChatLogs();
                break;
            case 'settings':
                this.loadSettingsForm();
                break;
        }
    }

    updateStats() {
        // Simulate real-time stats (in production, get from server)
        setInterval(() => {
            // Update active users (simulate)
            this.stats.activeUsers = Math.floor(Math.random() * 20) + 5;
            
            // Update online staff
            this.stats.onlineStaff = this.staffMembers.filter(s => s.online).length;
            
            // Update total messages
            this.stats.totalMessages = this.chatMessages.length;
            
            // Calculate average response time
            this.stats.avgResponseTime = Math.floor(Math.random() * 60) + 30;
            
            this.updateStatsDisplay();
        }, 5000);
    }

    updateStatsDisplay() {
        document.getElementById('activeUsers').textContent = this.stats.activeUsers;
        document.getElementById('onlineStaff').textContent = this.stats.onlineStaff;
        document.getElementById('totalMessages').textContent = this.stats.totalMessages;
        document.getElementById('avgResponse').textContent = this.stats.avgResponseTime + 's';
    }

    loadStaffData() {
        // Load staff members (in production, get from server)
        this.staffMembers = [
            { username: 'admin', role: 'Administrator', online: false, lastSeen: new Date() },
            { username: 'support', role: 'Support Agent', online: false, lastSeen: new Date() },
            { username: 'moderator', role: 'Moderator', online: false, lastSeen: new Date() }
        ];
    }

    loadStaffTable() {
        const tbody = document.getElementById('staffTableBody');
        tbody.innerHTML = '';
        
        this.staffMembers.forEach(staff => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${staff.username}</td>
                <td>${staff.role}</td>
                <td>
                    <span class="status-badge ${staff.online ? 'status-online' : 'status-offline'}">
                        ${staff.online ? 'Online' : 'Offline'}
                    </span>
                </td>
                <td>${this.formatTime(staff.lastSeen)}</td>
                <td>
                    <button class="btn-admin btn-secondary" onclick="adminPanel.editStaff('${staff.username}')">Edit</button>
                    <button class="btn-admin btn-secondary" onclick="adminPanel.removeStaff('${staff.username}')">Remove</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    addStaffMember() {
        const username = document.getElementById('newStaffUsername').value;
        const password = document.getElementById('newStaffPassword').value;
        const role = document.getElementById('newStaffRole').value;
        
        // Add to staff list
        this.staffMembers.push({
            username: username,
            role: role,
            online: false,
            lastSeen: new Date()
        });
        
        // In production, send to server to save
        this.showNotification(`Staff member ${username} added successfully`, 'success');
        
        // Close modal and reset form
        this.closeModal('addStaffModal');
        document.getElementById('addStaffForm').reset();
        
        // Refresh staff table
        this.loadStaffTable();
    }

    editStaff(username) {
        // Implement staff editing
        this.showNotification(`Edit ${username} - Feature coming soon`, 'info');
    }

    removeStaff(username) {
        if (confirm(`Are you sure you want to remove ${username}?`)) {
            this.staffMembers = this.staffMembers.filter(s => s.username !== username);
            this.showNotification(`Staff member ${username} removed`, 'success');
            this.loadStaffTable();
        }
    }

    loadChatLogs() {
        const chatPreview = document.getElementById('chatPreview');
        chatPreview.innerHTML = '';
        
        // Show recent messages
        const recentMessages = this.chatMessages.slice(-20).reverse();
        
        if (recentMessages.length === 0) {
            chatPreview.innerHTML = '<p style="text-align: center; color: var(--text-dim);">No recent chat activity</p>';
            return;
        }
        
        recentMessages.forEach(message => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message-preview ${message.senderType}`;
            messageDiv.innerHTML = `
                <strong>${message.sender}:</strong> ${message.text}
                <div class="message-time">${this.formatTime(new Date(message.timestamp))}</div>
            `;
            chatPreview.appendChild(messageDiv);
        });
    }

    handleNewMessage(message) {
        this.chatMessages.push(message);
        this.stats.totalMessages++;
        
        // Update chat logs if visible
        if (document.getElementById('chats').style.display !== 'none') {
            this.loadChatLogs();
        }
        
        this.updateStatsDisplay();
    }

    updateStaffStatus(status) {
        // Update staff online status
        const staff = this.staffMembers.find(s => s.username === status.staffName);
        if (staff) {
            staff.online = status.isOnline;
            staff.lastSeen = new Date(status.lastSeen);
            
            // Refresh staff table if visible
            if (document.getElementById('staff').style.display !== 'none') {
                this.loadStaffTable();
            }
        }
        
        this.stats.onlineStaff = this.staffMembers.filter(s => s.online).length;
        this.updateStatsDisplay();
    }

    loadSettings() {
        // Load settings from localStorage (in production, get from server)
        const saved = localStorage.getItem('adminSettings');
        if (saved) {
            this.settings = JSON.parse(saved);
        }
    }

    loadSettingsForm() {
        document.getElementById('siteTitle').value = this.settings.siteTitle;
        document.getElementById('welcomeMessage').value = this.settings.welcomeMessage;
        document.getElementById('autoResponse').value = this.settings.autoResponse;
    }

    saveSettings() {
        this.settings.siteTitle = document.getElementById('siteTitle').value;
        this.settings.welcomeMessage = document.getElementById('welcomeMessage').value;
        this.settings.autoResponse = document.getElementById('autoResponse').value;
        
        // Save to localStorage (in production, send to server)
        localStorage.setItem('adminSettings', JSON.stringify(this.settings));
        
        this.showNotification('Settings saved successfully', 'success');
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    formatTime(date) {
        return new Date(date).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    logoutAdmin() {
        sessionStorage.removeItem('adminUser');
        location.reload();
    }
}

// Modal functions
function showAddStaffModal() {
    document.getElementById('addStaffModal').style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Initialize admin panel
let adminPanel;

document.addEventListener('DOMContentLoaded', function() {
    adminPanel = new AdminPanel();
    window.adminPanel = adminPanel;
});

// Global functions for HTML onclick handlers
function logoutAdmin() {
    adminPanel.logoutAdmin();
}

function showAddStaffModal() {
    adminPanel.showAddStaffModal();
}

function saveSettings() {
    adminPanel.saveSettings();
}
