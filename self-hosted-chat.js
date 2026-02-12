// P.X HB Support - Self-Hosted Real-Time Chat
// Replaces Firebase with your own server

class SelfHostedChat {
    constructor() {
        this.socket = null;
        this.messages = [];
        this.staffStatus = { isOnline: false, staffName: null };
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        this.connect();
    }
    
    connect() {
        try {
            // Connect to your server (change URL to your deployed server)
            const serverUrl = window.location.origin;
            this.socket = io(serverUrl);
            
            this.setupEventListeners();
            console.log('🔗 Connecting to self-hosted server...');
            
        } catch (error) {
            console.error('❌ Failed to connect:', error);
            this.showNotification('Connection failed. Please refresh.', 'error');
        }
    }
    
    setupEventListeners() {
        // Connection events
        this.socket.on('connect', () => {
            console.log('✅ Connected to self-hosted server');
            this.showNotification('Connected to live chat', 'success');
            this.reconnectAttempts = 0;
        });
        
        this.socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            this.showNotification('Connection lost. Reconnecting...', 'error');
            this.attemptReconnect();
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('❌ Connection error:', error);
            this.showNotification('Connection error', 'error');
        });
        
        // Message events
        this.socket.on('messages', (messages) => {
            console.log('📥 Received message history:', messages.length);
            this.messages = messages;
            this.displayAllMessages();
        });
        
        this.socket.on('newMessage', (message) => {
            console.log('📨 New message received:', message);
            this.displayMessage(message);
            this.messages.push(message);
        });
        
        // Staff status events
        this.socket.on('staffStatusUpdate', (status) => {
            console.log('👮 Staff status updated:', status);
            this.staffStatus = status;
            this.handleStaffStatusChange(status);
        });
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            
            setTimeout(() => {
                this.connect();
            }, 2000 * this.reconnectAttempts); // Exponential backoff
        } else {
            this.showNotification('Unable to reconnect. Please refresh the page.', 'error');
        }
    }
    
    sendMessage(text, sender, senderType = 'user') {
        if (!this.socket || !this.socket.connected) {
            this.showNotification('Not connected to server', 'error');
            return;
        }
        
        const message = {
            text: text,
            sender: sender,
            senderType: senderType,
            timestamp: new Date().toISOString()
        };
        
        this.socket.emit('sendMessage', message);
        console.log('📤 Message sent to server:', message);
    }
    
    updateStaffStatus(isOnline, staffName = null) {
        if (!this.socket || !this.socket.connected) {
            console.warn('Cannot update staff status: not connected');
            return;
        }
        
        const status = {
            isOnline: isOnline,
            staffName: staffName
        };
        
        this.socket.emit('updateStaffStatus', status);
        console.log('👮 Staff status sent to server:', status);
    }
    
    displayAllMessages() {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        
        // Clear existing messages except welcome
        const welcomeMessage = messagesContainer.querySelector('.message.bot-message');
        messagesContainer.innerHTML = '';
        
        if (welcomeMessage) {
            messagesContainer.appendChild(welcomeMessage);
        }
        
        // Display all messages
        this.messages.forEach(message => {
            this.displayMessage(message, false);
        });
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    displayMessage(message, scroll = true) {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.senderType}-message`;
        
        const time = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        let avatarIcon = 'user';
        if (message.senderType === 'staff') {
            avatarIcon = 'user-shield';
        } else if (message.senderType === 'system') {
            avatarIcon = 'info-circle';
        } else if (message.senderType === 'bot') {
            avatarIcon = 'robot';
        }
        
        messageDiv.innerHTML = `
            <div class="message-avatar">
                <i class="fas fa-${avatarIcon}"></i>
            </div>
            <div class="message-content">
                <p>${message.text}</p>
                <div class="message-time">${time}</div>
            </div>
        `;
        
        messagesContainer.appendChild(messageDiv);
        
        if (scroll) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    
    handleStaffStatusChange(status) {
        const systemMessageDiv = document.getElementById('systemMessage');
        if (!systemMessageDiv) return;
        
        if (status && status.isOnline) {
            const message = status.staffName 
                ? `📝 ${status.staffName} is online and ready to help!`
                : '📝 Staff member is online and ready to help!';
            
            systemMessageDiv.style.display = 'block';
            systemMessageDiv.querySelector('p').textContent = message;
            systemMessageDiv.querySelector('.message-time').textContent = 'Just now';
            
            // Update staff status in UI
            const staffStatus = document.getElementById('staffStatus');
            if (staffStatus) {
                staffStatus.style.display = 'flex';
            }
            
            console.log('✅ Staff is online:', status);
        } else {
            systemMessageDiv.style.display = 'none';
            
            // Hide staff status in UI
            const staffStatus = document.getElementById('staffStatus');
            if (staffStatus) {
                staffStatus.style.display = 'none';
            }
            
            console.log('❌ Staff is offline');
        }
    }
    
    showNotification(message, type = 'info') {
        // Create notification element
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
    
    // Get connection status
    isConnected() {
        return this.socket && this.socket.connected;
    }
    
    // Get current staff status
    getStaffStatus() {
        return this.staffStatus;
    }
    
    // Get message history
    getMessages() {
        return this.messages;
    }
}

// Initialize Self-Hosted Chat
let selfHostedChat;

// Auto-initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Wait for Socket.IO to load
    setTimeout(() => {
        if (typeof io !== 'undefined') {
            selfHostedChat = new SelfHostedChat();
            console.log('🚀 Self-Hosted Chat initialized');
            
            // Make it globally available
            window.selfHostedChat = selfHostedChat;
            
            // Replace Firebase functions with self-hosted ones
            window.firebaseChat = selfHostedChat;
            
        } else {
            console.error('❌ Socket.IO not loaded');
            // Fallback to local mode
            initializeLocalMode();
        }
    }, 1000);
});

// Fallback mode if Socket.IO fails
function initializeLocalMode() {
    console.log('🔄 Initializing local mode (no real-time)');
    window.firebaseChat = null;
    
    // Show notification
    const notification = document.createElement('div');
    notification.className = 'notification warning';
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-exclamation-triangle"></i>
            <span>Running in local mode - Real-time features disabled</span>
        </div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.SelfHostedChat = SelfHostedChat;
    window.selfHostedChat = selfHostedChat;
}
