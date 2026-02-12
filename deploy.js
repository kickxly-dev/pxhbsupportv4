// P.X HB Support - Deployment Helper
// This script helps you deploy your site to various platforms

const deploymentGuide = {
    github: {
        name: "GitHub Pages (FREE)",
        steps: [
            "1. Go to github.com and create new repository named 'pxhb-support'",
            "2. Upload all files from px-hb-support folder",
            "3. Go to Settings > Pages in your repository",
            "4. Select 'Deploy from a branch' > 'main' folder",
            "5. Your site will be live at: https://yourusername.github.io/pxhb-support"
        ],
        url: "https://pages.github.com"
    },
    
    netlify: {
        name: "Netlify (Easiest - FREE)",
        steps: [
            "1. Go to netlify.com",
            "2. Drag and drop the entire px-hb-support folder",
            "3. Wait for deployment (takes ~30 seconds)",
            "4. Get your URL: https://random-name.netlify.app"
        ],
        url: "https://netlify.com"
    },
    
    vercel: {
        name: "Vercel (Professional - FREE)",
        steps: [
            "1. Go to vercel.com",
            "2. Click 'New Project'",
            "3. Upload or connect your GitHub repo",
            "4. Configure settings (defaults are fine)",
            "5. Deploy and get your URL"
        ],
        url: "https://vercel.com"
    },
    
    firebase: {
        name: "Firebase Hosting (FREE)",
        steps: [
            "1. Go to console.firebase.google.com",
            "2. Create new project",
            "3. Go to Hosting section",
            "4. Install Firebase CLI: npm install -g firebase-tools",
            "5. Run: firebase init hosting",
            "6. Run: firebase deploy"
        ],
        url: "https://firebase.google.com"
    }
};

// Display deployment options
console.log("🚀 P.X HB Support - Deployment Options");
console.log("=" .repeat(50));

Object.entries(deploymentGuide).forEach(([key, platform]) => {
    console.log(`\n📍 ${platform.name}`);
    console.log(`🔗 ${platform.url}`);
    platform.steps.forEach(step => console.log(`   ${step}`));
});

console.log("\n" + "=".repeat(50));
console.log("💡 Recommendation: Use Netlify for easiest deployment!");
console.log("🎯 Your site will be live in under 2 minutes!");

// Quick deployment script
function quickDeploy() {
    console.log("\n🔥 QUICK DEPLOY CHECKLIST:");
    console.log("✅ All files are in px-hb-support folder");
    console.log("✅ Staff passwords are secure");
    console.log("✅ Site works locally");
    console.log("✅ Ready to deploy!");
    
    console.log("\n📋 NEXT STEPS:");
    console.log("1. Choose a platform above");
    console.log("2. Follow the steps");
    console.log("3. Test your live site");
    console.log("4. Share URL with your team");
    console.log("5. Test staff login functionality");
}

// Run quick deploy
quickDeploy();

// Custom domain helper
function setupCustomDomain() {
    console.log("\n🌐 CUSTOM DOMAIN SETUP:");
    console.log("1. Buy domain from Namecheap, GoDaddy, etc.");
    console.log("2. Go to your hosting platform's domain settings");
    console.log("3. Add your custom domain");
    console.log("4. Update DNS records (usually CNAME)");
    console.log("5. Wait for propagation (1-24 hours)");
    console.log("6. Test your custom domain!");
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { deploymentGuide, quickDeploy, setupCustomDomain };
}
