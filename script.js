// P.X HB Support - Real Staff Chat System
let chatOpen = false;
let widgetOpen = false;
let messages = [];
let widgetMessages = [];
let staffLoggedIn = false;
let currentUser = null;

// Staff credentials (in production, use secure backend)
const STAFF_CREDENTIALS = {
    'admin': 'pxhb2024',
    'support': 'support123',
    'moderator': 'mod456'
};

// Konami Code for staff login
let konamiCode = [];
const konamiPattern = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Hide loading screen
    setTimeout(() => {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.opacity = '0';
            loadingScreen.style.visibility = 'hidden';
        }
    }, 2000);
    
    // Initialize chat widget
    initializeChatWidget();
    
    // Smooth scrolling
    initializeSmoothScroll();
    
    // Navbar scroll effect
    initializeNavbar();
    
    // Initialize Konami code listener
    initializeKonamiCode();
    
    // Initialize staff login form
    initializeStaffLogin();
    
    // Check for existing staff session
    checkStaffSession();
});

// Konami Code Detection
function initializeKonamiCode() {
    document.addEventListener('keydown', function(e) {
        konamiCode.push(e.key);
        konamiCode = konamiCode.slice(-10); // Keep only last 10 keys
        
        if (konamiCode.join(',') === konamiPattern.join(',')) {
            showStaffLogin();
            konamiCode = []; // Reset
        }
    });
}

// Staff Login Functions
function showStaffLogin() {
    const loginPanel = document.getElementById('staffLogin');
    if (loginPanel) {
        loginPanel.style.display = 'flex';
    }
}

function closeStaffLogin() {
    const loginPanel = document.getElementById('staffLogin');
    if (loginPanel) {
        loginPanel.style.display = 'none';
    }
}

function initializeStaffLogin() {
    const loginForm = document.getElementById('staffLoginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleStaffLogin();
        });
    }
}

function handleStaffLogin() {
    const username = document.getElementById('staffUsername').value;
    const password = document.getElementById('staffPassword').value;
    
    if (STAFF_CREDENTIALS[username] && STAFF_CREDENTIALS[username] === password) {
        // Successful login
        staffLoggedIn = true;
        currentUser = username;
        
        // Store session (in production, use secure HTTP-only cookies)
        sessionStorage.setItem('staffUser', username);
        sessionStorage.setItem('staffLoggedIn', 'true');
        
        // Update Firebase staff status
        if (window.firebaseChat) {
            window.firebaseChat.updateStaffStatus(true, username);
        }
        
        // Update UI
        updateStaffUI();
        
        // Close login panel
        closeStaffLogin();
        
        // Show success message
        showNotification('Staff login successful!', 'success');
        
        // Add staff join message to chat
        if (window.firebaseChat) {
            window.firebaseChat.sendMessage(`📝 ${username} has joined the chat`, 'System', 'system');
        } else {
            addSystemMessage('📝 Staff member has joined the chat');
        }
        
        // Clear form
        document.getElementById('staffLoginForm').reset();
        
        // Add admin access for admin users
        if (username === 'admin') {
            addAdminAccess();
        }
        
    } else {
        showNotification('Invalid credentials', 'error');
        document.getElementById('staffPassword').value = '';
    }
}

function addAdminAccess() {
    // Add admin button to staff status
    const staffStatus = document.getElementById('staffStatus');
    if (staffStatus) {
        const existingAdminBtn = staffStatus.querySelector('.admin-btn');
        if (!existingAdminBtn) {
            const adminBtn = document.createElement('button');
            adminBtn.className = 'admin-btn';
            adminBtn.innerHTML = '<i class="fas fa-cog"></i> Admin';
            adminBtn.onclick = openAdminPanel;
            staffStatus.appendChild(adminBtn);
        }
    }
}

function logoutStaff() {
    const staffName = currentUser;
    
    staffLoggedIn = false;
    currentUser = null;
    
    // Clear session
    sessionStorage.removeItem('staffUser');
    sessionStorage.removeItem('staffLoggedIn');
    
    // Update Firebase staff status
    if (window.firebaseChat) {
        window.firebaseChat.updateStaffStatus(false);
        window.firebaseChat.sendMessage(`📝 ${staffName} has left the chat`, 'System', 'system');
    }
    
    // Update UI
    updateStaffUI();
    
    // Show logout message
    showNotification('Staff logged out', 'info');
    
    // Add staff leave message
    if (!window.firebaseChat) {
        addSystemMessage('📝 Staff member has left the chat');
    }
}

function checkStaffSession() {
    const savedUser = sessionStorage.getItem('staffUser');
    const savedLogin = sessionStorage.getItem('staffLoggedIn');
    
    if (savedUser && savedLogin === 'true') {
        staffLoggedIn = true;
        currentUser = savedUser;
        updateStaffUI();
        addSystemMessage('📝 Staff member is online');
    }
}

function updateStaffUI() {
    const staffStatus = document.getElementById('staffStatus');
    if (staffStatus) {
        staffStatus.style.display = staffLoggedIn ? 'flex' : 'none';
    }
}

// Chat Functions
function toggleChat() {
    const chatSection = document.getElementById('chat');
    const chatWidget = document.getElementById('chatWidget');
    
    if (chatSection) {
        chatSection.scrollIntoView({ behavior: 'smooth' });
        
        // Focus input after scrolling
        setTimeout(() => {
            const chatInput = document.getElementById('chatInput');
            if (chatInput) {
                chatInput.focus();
            }
        }, 500);
    }
}

function initializeChatWidget() {
    const chatWidget = document.getElementById('chatWidget');
    if (chatWidget) {
        chatWidget.classList.add('minimized');
    }
}

function toggleChatWidget() {
    const chatWidget = document.getElementById('chatWidget');
    if (chatWidget) {
        widgetOpen = !widgetOpen;
        
        if (widgetOpen) {
            chatWidget.classList.remove('minimized');
            chatWidget.classList.add('expanded');
        } else {
            chatWidget.classList.remove('expanded');
            chatWidget.classList.add('minimized');
        }
    }
}

// 🚀 SIMPLE CHAT - WORKING VERSION

// Initialize socket
let socket = null;

// Connect to server
function connectSocket() {
    try {
        socket = io();
        
        socket.on('connect', () => {
            console.log('✅ Connected to server');
            window.socket = socket;
        });
        
        socket.on('disconnect', () => {
            console.log('❌ Disconnected');
        });
        
        socket.on('newMessage', (message) => {
            console.log('📨 Message received:', message);
            
            if (message.senderType === 'user') {
                addMessage(message.content, 'user');
            } else if (message.senderType === 'staff') {
                addMessage(message.content, 'staff');
            } else if (message.senderType === 'system') {
                addMessage(message.content, 'system');
            }
        });
        
    } catch (error) {
        console.error('❌ Socket error:', error);
    }
}

// Send message function
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    console.log('📤 Sending:', message);
    
    // Clear input
    input.value = '';
    
    // Add to UI
    addMessage(message, 'user');
    
    // Send to server
    if (socket && socket.connected) {
        socket.emit('chatMessage', {
            content: message,
            sender: 'User',
            senderType: 'user',
            timestamp: new Date()
        });
    }
    
    // Auto response
    if (!staffLoggedIn) {
        setTimeout(() => {
            addMessage('👋 Staff will respond when available.', 'system');
        }, 1000);
    }
}

// Staff message
function sendStaffMessage() {
    if (!staffLoggedIn) return;
    
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    console.log('📤 Staff sending:', message);
    
    input.value = '';
    addMessage(message, 'staff');
    
    if (socket && socket.connected) {
        socket.emit('chatMessage', {
            content: message,
            sender: currentUser || 'Staff',
            senderType: 'staff',
            timestamp: new Date()
        });
    }
}

// Widget message
function sendWidgetMessage() {
    const input = document.getElementById('widgetInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    console.log('📤 Widget sending:', message);
    
    input.value = '';
    addWidgetMessage(message, 'user');
    
    if (socket && socket.connected) {
        socket.emit('chatMessage', {
            content: message,
            sender: 'User',
            senderType: 'user',
            timestamp: new Date()
        });
    }
    
    if (!staffLoggedIn) {
        setTimeout(() => {
            addWidgetMessage('Staff will respond when available.', 'system');
        }, 1000);
    }
}

// Quick message
function sendQuickMessage(message) {
    console.log('📤 Quick sending:', message);
    
    addMessage(message, 'user');
    
    if (socket && socket.connected) {
        socket.emit('chatMessage', {
            content: message,
            sender: 'User',
            senderType: 'user',
            timestamp: new Date()
        });
    }
    
    if (!staffLoggedIn) {
        setTimeout(() => {
            addMessage('Message queued. Staff will respond.', 'system');
        }, 1000);
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', connectSocket);

// Mobile Staff Login
function showMobileStaffLogin() {
    // Create mobile-friendly login modal
    const existingModal = document.getElementById('mobileStaffLoginModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'mobileStaffLoginModal';
    modal.className = 'mobile-staff-modal';
    modal.innerHTML = `
        <div class="mobile-modal-content">
            <h3>Staff Login</h3>
            <form id="mobileStaffLoginForm">
                <input type="text" id="mobileStaffUsername" placeholder="Username" required>
                <input type="password" id="mobileStaffPassword" placeholder="Password" required>
                <button type="submit">Login</button>
                <button type="button" onclick="closeMobileStaffLogin()">Cancel</button>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle form submission
    document.getElementById('mobileStaffLoginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('mobileStaffUsername').value;
        const password = document.getElementById('mobileStaffPassword').value;
        
        if (STAFF_CREDENTIALS[username] && STAFF_CREDENTIALS[username] === password) {
            staffLoggedIn = true;
            currentUser = username;
            sessionStorage.setItem('staffUser', username);
            sessionStorage.setItem('staffLoggedIn', 'true');
            
            // Update Firebase staff status
            if (window.firebaseChat) {
                window.firebaseChat.updateStaffStatus(true, username);
            }
            
            updateStaffUI();
            closeMobileStaffLogin();
            showNotification('Staff login successful!', 'success');
            
            // Add staff join message to chat
            if (window.firebaseChat) {
                window.firebaseChat.sendMessage(`📝 ${username} has joined the chat`, 'System', 'system');
            } else {
                addSystemMessage('📝 Staff member has joined the chat');
            }
            
            // Add admin access for admin users
            if (username === 'admin') {
                addAdminAccess();
            }
            
        } else {
            showNotification('Invalid credentials', 'error');
        }
    });
}

function closeMobileStaffLogin() {
    const modal = document.getElementById('mobileStaffLoginModal');
    if (modal) {
        modal.remove();
    }
}

// Admin Panel Access
function openAdminPanel() {
    // Open enterprise admin panel in new window
    window.open('/admin-v2.html', '_blank', 'width=1400,height=900');
}

// Input Handlers
function handleChatInput(event) {
    if (event.key === 'Enter') {
        if (staffLoggedIn) {
            sendStaffMessage();
        } else {
            sendMessage();
        }
    }
}

function handleWidgetInput(event) {
    if (event.key === 'Enter') {
        sendWidgetMessage();
    }
}

// FAQ Functions
function toggleFAQ(element) {
    const faqItem = element.parentElement;
    const allItems = document.querySelectorAll('.faq-item');
    
    // Close other items
    allItems.forEach(item => {
        if (item !== faqItem && item.classList.contains('active')) {
            item.classList.remove('active');
        }
    });
    
    // Toggle current item
    faqItem.classList.toggle('active');
}

// Navigation Functions
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
    }
}

function initializeSmoothScroll() {
    // Smooth scroll for all anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}

function initializeNavbar() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });
    }
}

// Contact Functions
function createTicket() {
    const ticketNumber = 'TKT-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    
    const message = `Support ticket created! Your ticket number is ${ticketNumber}. Our team will respond within 24 hours.`;
    
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        addMessage(message, 'system');
    } else {
        alert(message);
    }
}

// Utility Functions
function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function showNotification(message, type = 'info') {
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
    }, 5000);
}

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + K to open chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleChat();
    }
    
    // Escape to close widgets
    if (e.key === 'Escape') {
        const chatWidget = document.getElementById('chatWidget');
        if (chatWidget && widgetOpen) {
            toggleChatWidget();
        }
        
        const loginPanel = document.getElementById('staffLogin');
        if (loginPanel && loginPanel.style.display === 'flex') {
            closeStaffLogin();
        }
    }
    
    // Staff shortcuts (when logged in)
    if (staffLoggedIn) {
        // Ctrl+Shift+L to logout
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
            e.preventDefault();
            logoutStaff();
        }
    }
});

// Performance Optimization
let scrollTimeout;
window.addEventListener('scroll', function() {
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }
    scrollTimeout = setTimeout(function() {
        // Cleanup any performance-heavy operations
    }, 100);
});

// Error Handling
window.addEventListener('error', function(e) {
    console.error('JavaScript error:', e.error);
});

// Auto-logout after inactivity (30 minutes)
let inactivityTimer;
function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        if (staffLoggedIn) {
            logoutStaff();
            showNotification('Auto-logged out due to inactivity', 'info');
        }
    }, 30 * 60 * 1000); // 30 minutes
}

// Reset timer on user activity
document.addEventListener('mousemove', resetInactivityTimer);
document.addEventListener('keypress', resetInactivityTimer);
document.addEventListener('click', resetInactivityTimer);
document.addEventListener('scroll', resetInactivityTimer);

// Initialize inactivity timer
resetInactivityTimer();
