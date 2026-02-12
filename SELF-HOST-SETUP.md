# 🌐 Self-Host Your P.X HB Support Site

**Make your support site accessible to everyone!**

## 🚀 Option 1: Render.com (FREE - Recommended)

### Step 1: Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub/Google
3. Click "New" → "Web Service"

### Step 2: Connect Your Code
1. **Connect GitHub** (fork your repo or create new one)
2. **Repository:** Your pxhb-support repo
3. **Branch:** main
4. **Runtime:** Node
5. **Build Command:** `npm install`
6. **Start Command:** `node server.js`

### Step 3: Configure
1. **Instance Type:** Free (always on)
2. **Add Environment Variable:** `PORT=3000`
3. Click "Create Web Service"

### Step 4: Wait 2-3 Minutes
- Your site will be live at: `https://your-app-name.onrender.com`
- **Real-time chat works for everyone!**

## ⚡ Option 2: Glitch.com (FREE - Instant)

### Step 1: Go to [glitch.com](https://glitch.com)
### Step 2: Click "New Project" → "Express App"
### Step 3: Replace with your files
### Step 4: Your site is live instantly at: `https://your-app.glitch.me`

## 🔥 Option 3: Your Own VPS (Professional)

### DigitalOcean Setup:
```bash
# 1. Create Droplet ($6/month)
# 2. SSH into your server
ssh root@your-server-ip

# 3. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Upload your files (using scp or git clone)
# 5. Install dependencies
npm install

# 6. Start server
npm start

# 7. Access at: http://your-server-ip:3000
```

## 🎯 Option 4: Cloudflare Tunnel (FREE - Use Your Domain)

### If you have your own domain:
```bash
# 1. Install cloudflared
npm install -g cloudflared

# 2. Run tunnel
cloudflared tunnel --url http://localhost:3000

# 3. Get public URL like: https://random-words.trycloudflare.com
# 4. Share this URL with anyone!
```

## ✅ What You Get

**🌐 Public Access:**
- ✅ **Anyone can visit** your support site
- ✅ **Real-time chat** works globally
- ✅ **No Firebase needed** (self-hosted)
- ✅ **Full control** over your data
- ✅ **Custom domain** support

**🔧 Features:**
- ✅ **Live chat** between users and staff
- ✅ **Staff login** with Konami code
- ✅ **Message history** (stored on your server)
- ✅ **Real-time updates** (Socket.IO)
- ✅ **Mobile responsive**

## 🚀 Quick Start (Render.com - 5 minutes)

1. **Push code to GitHub**
2. **Create Render account**
3. **Connect repository**
4. **Deploy** (automatic)
5. **Share your URL** with everyone!

## 🎮 Test Your Public Site

1. **Deploy to Render**
2. **Get your public URL**
3. **Open in 2 browsers** (or share with friend)
4. **Test real-time chat** across different computers!
5. **Staff login** with Konami code

## 🔒 Security Notes

**For Production:**
- Use HTTPS (Render provides this)
- Change staff passwords
- Add rate limiting
- Monitor server logs
- Backup your data

## 💰 Costs

**FREE Options:**
- **Render.com:** Free tier (always on)
- **Glitch.com:** Free (limited hours)
- **Cloudflare Tunnel:** Free (requires running locally)

**Paid Options:**
- **DigitalOcean:** $6/month
- **Vultr:** $3.50/month
- **Linode:** $5/month

## 🎯 Your Support Site Will Be:

**🌍 Globally Accessible**
- Anyone with internet can visit
- Real-time chat works worldwide
- Professional appearance

**🔧 Fully Controlled**
- You own the data
- No third-party dependencies
- Custom branding maintained

**💼 Business Ready**
- Professional support system
- Staff management
- Customer service platform

**🚀 Choose Render.com for the easiest setup!**

Your P.X HB Support site will be live and accessible to everyone in minutes! ✨
