// Firebase Configuration for P.X HB Support
// Replace with your Firebase project config

const firebaseConfig = {
    apiKey: "AIzaSyDemoKey-ReplaceWithYourRealKey",
    authDomain: "pxhb-support.firebaseapp.com",
    databaseURL: "https://pxhb-support-default-rtdb.firebaseio.com",
    projectId: "pxhb-support",
    storageBucket: "pxhb-support.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Chat functionality
class FirebaseChat {
    constructor() {
        this.messagesRef = database.ref('chat/messages');
        this.staffStatusRef = database.ref('chat/staffStatus');
        this.connectedRef = database.ref('.info/connected');
        
        this.setupConnectionMonitoring();
        this.listenForMessages();
        this.listenForStaffStatus();
    }
    
    setupConnectionMonitoring() {
        this.connectedRef.on('value', (snap) => {
            if (snap.val() === true) {
                console.log('🔗 Connected to Firebase');
                this.showNotification('Connected to live chat', 'success');
            } else {
                console.log('❌ Disconnected from Firebase');
                this.showNotification('Connection lost', 'error');
            }
        });
    }
    
    sendMessage(text, sender, senderType = 'user') {
        const message = {
            text: text,
            sender: sender,
            senderType: senderType, // 'user', 'staff', 'system'
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            id: Date.now()
        };
        
        this.messagesRef.push(message);
        console.log('📤 Message sent to Firebase:', message);
    }
    
    listenForMessages() {
        this.messagesRef.limitToLast(50).on('child_added', (snapshot) => {
            const message = snapshot.val();
            this.displayMessage(message);
            console.log('📥 New message received:', message);
        });
    }
    
    displayMessage(message) {
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
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    updateStaffStatus(isOnline, staffName = null) {
        this.staffStatusRef.set({
            isOnline: isOnline,
            staffName: staffName,
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
        
        console.log('👮 Staff status updated:', { isOnline, staffName });
    }
    
    listenForStaffStatus() {
        this.staffStatusRef.on('value', (snapshot) => {
            const status = snapshot.val();
            this.handleStaffStatusChange(status);
        });
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
    
    // Clear old messages (keep last 50)
    cleanupOldMessages() {
        this.messagesRef.limitToLast(50).once('value', (snapshot) => {
            const messages = snapshot.val();
            if (messages) {
                const messageKeys = Object.keys(messages);
                if (messageKeys.length > 50) {
                    // Remove oldest messages beyond 50
                    for (let i = 0; i < messageKeys.length - 50; i++) {
                        this.messagesRef.child(messageKeys[i]).remove();
                    }
                }
            }
        });
    }
}

// Initialize Firebase Chat
let firebaseChat;

// Auto-initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Wait a bit for other scripts to load
    setTimeout(() => {
        if (typeof firebase !== 'undefined') {
            firebaseChat = new FirebaseChat();
            console.log('🚀 Firebase Chat initialized');
        } else {
            console.error('❌ Firebase not loaded');
        }
    }, 1000);
});

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.FirebaseChat = FirebaseChat;
    window.firebaseChat = firebaseChat;
}
