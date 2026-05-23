// ===================================
// 🔥 Firebase Configuration
// Project: awrad-motabah
// Single Firebase Project - Multi-Tenant
// ===================================

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyBROJxqElhqyGXgO1YDH90POL2uZG05IUs",
  authDomain: "awrad-motabah.firebaseapp.com",
  databaseURL: "https://awrad-motabah-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "awrad-motabah",
  storageBucket: "awrad-motabah.firebasestorage.app",
  messagingSenderId: "734510343175",
  appId: "1:734510343175:web:fc7561bb8d633efb9076a2",
  measurementId: "G-L9GKBJQZDD"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// Initialize Analytics (optional)
let analytics = null;
if (typeof firebase.analytics === 'function') {
  analytics = firebase.analytics();
}

// ===================================
// 🏢 Tenant Detection & Configuration
// ===================================

class TenantManager {
  constructor() {
    this.tenantId = this.detectTenant();
    this.config = null;
  }

  detectTenant() {
    // Method 1: Subdomain detection
    const hostname = window.location.hostname;
    const subdomain = hostname.split('.')[0];
    
    // Tenant mapping
    const tenantMap = {
      'quran-awrad': 'quran-awrad',
      'motabah': 'naqaa-e9482',
      'naqaa-e9482': 'naqaa-e9482',
      'awrad-motabah': 'naqaa-e9482',
      'localhost': 'naqaa-e9482' // Default for local dev
    };
    
    if (tenantMap[subdomain]) {
      return tenantMap[subdomain];
    }
    
    // Method 2: URL parameter (?tenant=xxx)
    const urlParams = new URLSearchParams(window.location.search);
    const tenantFromUrl = urlParams.get('tenant');
    if (tenantFromUrl) {
      return tenantFromUrl;
    }
    
    // Method 3: localStorage (persistent)
    const tenantFromStorage = localStorage.getItem('tenantId');
    if (tenantFromStorage) {
      return tenantFromStorage;
    }
    
    // Default fallback
    return 'naqaa-e9482';
  }

  async loadConfig() {
    try {
      const snapshot = await db.ref(`tenants/${this.tenantId}/config`).once('value');
      this.config = snapshot.val() || this.getDefaultConfig();
      this.applyTheme();
      return this.config;
    } catch (error) {
      console.error('Error loading tenant config:', error);
      this.config = this.getDefaultConfig();
      this.applyTheme();
      return this.config;
    }
  }

  getDefaultConfig() {
    const defaults = {
      'quran-awrad': {
        theme: 'pink',
        primaryColor: '#ec4899',
        defaultTemplate: 'DEF_MUFASSAL',
        name: 'قرآن أوراد',
        features: {
          watchSystem: {
            enabled: false,
            allowUserEnable: false,
            allowUserRequest: false,
            allowMandatory: false
          }
        }
      },
      'naqaa-e9482': {
        theme: 'teal',
        primaryColor: '#14b8a6',
        defaultTemplate: 'DEF_ADVANCED',
        name: 'متابعة',
        features: {
          watchSystem: {
            enabled: true,
            allowUserEnable: true,
            allowUserRequest: true,
            allowMandatory: true
          }
        }
      }
    };
    
    return defaults[this.tenantId] || defaults['naqaa-e9482'];
  }

  applyTheme() {
    if (!this.config) return;
    
    // Apply CSS variables
    document.documentElement.style.setProperty('--primary', this.config.primaryColor);
    
    // Apply theme class
    if (this.config.theme === 'pink') {
      document.body.classList.add('theme-pink');
      document.body.classList.remove('theme-teal');
    } else {
      document.body.classList.add('theme-teal');
      document.body.classList.remove('theme-pink');
    }
    
    // Update page title if exists
    const titleElements = document.querySelectorAll('.app-title, .header-title, h1.app-title');
    titleElements.forEach(el => {
      if (this.config.name && !el.textContent.includes('(')) {
        el.textContent = this.config.name;
      }
    });
  }

  saveTenantToStorage() {
    localStorage.setItem('tenantId', this.tenantId);
  }

  // Database reference helpers
  userRef(userId) {
    return db.ref(`tenants/${this.tenantId}/users/${userId}`);
  }

  templatesRef() {
    return db.ref(`tenants/${this.tenantId}/templates`);
  }

  adminsRef() {
    return db.ref(`tenants/${this.tenantId}/admins`);
  }

  configRef() {
    return db.ref(`tenants/${this.tenantId}/config`);
  }

  async isAdmin(userId) {
    const snapshot = await this.adminsRef().child(userId).once('value');
    return snapshot.val() === true;
  }

  async isSuperAdmin(userId) {
    const snapshot = await db.ref(`superadmin/${userId}`).once('value');
    return snapshot.val() === true;
  }
}

// Global tenant manager instance
const tenantManager = new TenantManager();

// ===================================
// 🔐 Authentication Helper
// ===================================

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.userRole = 'user';
  }

  async signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      this.currentUser = result.user;
      
      // Save user to tenant database
      await this.saveUserToDatabase(this.currentUser);
      
      // Check role
      await this.checkUserRole();
      
      return this.currentUser;
    } catch (error) {
      console.error('Sign-in error:', error);
      throw error;
    }
  }

  async saveUserToDatabase(user) {
    const userRef = tenantManager.userRef(user.uid);
    const snapshot = await userRef.once('value');
    
    if (!snapshot.exists()) {
      // New user - create profile
      await userRef.set({
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        tenant: tenantManager.tenantId,
        activeTemplate: tenantManager.config.defaultTemplate,
        watchStatus: {
          allowWatch: false,
          requestWatch: false,
          mandatoryWatch: {
            enabled: false
          }
        }
      });
    } else {
      // Existing user - update last login
      await userRef.update({
        lastLogin: firebase.database.ServerValue.TIMESTAMP
      });
    }
  }

  async checkUserRole() {
    if (!this.currentUser) return;
    
    const isSuperAdmin = await tenantManager.isSuperAdmin(this.currentUser.uid);
    if (isSuperAdmin) {
      this.userRole = 'superadmin';
      return;
    }
    
    const isAdmin = await tenantManager.isAdmin(this.currentUser.uid);
    if (isAdmin) {
      this.userRole = 'admin';
      return;
    }
    
    this.userRole = 'user';
  }

  async signOut() {
    await auth.signOut();
    this.currentUser = null;
    this.userRole = 'user';
  }

  onAuthStateChanged(callback) {
    return auth.onAuthStateChanged(async (user) => {
      this.currentUser = user;
      if (user) {
        await this.checkUserRole();
      }
      callback(user, this.userRole);
    });
  }
}

// Global auth manager instance
const authManager = new AuthManager();

// ===================================
// 🚀 Initialization
// ===================================

async function initializeApp() {
  try {
    // Load tenant configuration
    await tenantManager.loadConfig();
    tenantManager.saveTenantToStorage();
    
    console.log('✅ Tenant loaded:', tenantManager.tenantId);
    console.log('✅ Config:', tenantManager.config);
    
    // Setup auth state listener
    authManager.onAuthStateChanged((user, role) => {
      if (user) {
        console.log('✅ User signed in:', user.email);
        console.log('✅ Role:', role);
      } else {
        console.log('❌ User signed out');
        // Redirect to login if not on login page
        const currentPage = window.location.pathname;
        if (!currentPage.includes('login') && !currentPage.includes('1-login')) {
          window.location.href = 'login.html';
        }
      }
    });
    
    return true;
  } catch (error) {
    console.error('❌ Initialization error:', error);
    return false;
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// ===================================
// 📊 Progress Tracking Helper
// ===================================

class ProgressTracker {
  constructor(userId) {
    this.userId = userId;
  }

  async trackItem(itemId, itemName, cardName, completed) {
    const progressRef = tenantManager.userRef(this.userId).child(`progress/by_item/${itemId}`);
    
    const snapshot = await progressRef.once('value');
    const current = snapshot.val() || {
      name: itemName,
      card: cardName,
      days_completed: 0,
      days_total: 0
    };
    
    current.days_total += 1;
    if (completed) {
      current.days_completed += 1;
    }
    current.completion_rate = (current.days_completed / current.days_total) * 100;
    
    await progressRef.set(current);
  }

  async getProgress(period = 30) {
    const progressRef = tenantManager.userRef(this.userId).child('progress/by_item');
    const snapshot = await progressRef.once('value');
    return snapshot.val() || {};
  }
}

// ===================================
// 🔔 Notification Helper
// ===================================

class NotificationManager {
  async sendNotification(userId, notification) {
    const notifRef = tenantManager.userRef(userId).child('notifications').push();
    await notifRef.set({
      ...notification,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      read: false
    });
  }

  async getNotifications(userId, unreadOnly = false) {
    let query = tenantManager.userRef(userId).child('notifications')
      .orderByChild('timestamp')
      .limitToLast(50);
    
    if (unreadOnly) {
      query = query.orderByChild('read').equalTo(false);
    }
    
    const snapshot = await query.once('value');
    return snapshot.val() || {};
  }

  async markAsRead(userId, notificationId) {
    await tenantManager.userRef(userId)
      .child(`notifications/${notificationId}/read`)
      .set(true);
  }
}

const notificationManager = new NotificationManager();

// ===================================
// 📝 Export for use in HTML pages
// ===================================

window.tenantManager = tenantManager;
window.authManager = authManager;
window.ProgressTracker = ProgressTracker;
window.notificationManager = notificationManager;
window.firebase = firebase;
window.db = db;
window.auth = auth;
