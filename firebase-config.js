/**
 * Adea's Farm POS & Expense Tracker - Firebase & Database Config
 * Handles Firebase Auth & Firestore connection with an automatic LocalStorage mock fallback
 * to support immediate testing and easy deployment before Firebase setup.
 */

// Replace these values with your actual Firebase Configuration details.
const firebaseConfig = {
  apiKey: "AIzaSyAFTu1-sOXzi1Zz2wM2N6AZe4-RV2aY8QU",
  authDomain: "adeas-farm.firebaseapp.com",
  projectId: "adeas-farm",
  storageBucket: "adeas-farm.firebasestorage.app",
  messagingSenderId: "780744869332",
  appId: "1:780744869332:web:2115b0ff17145fbbef0241"
};

// Check if firebase is configured with real credentials
const isFirebaseConfigured = () => {
  return firebaseConfig.apiKey && 
         firebaseConfig.apiKey !== "YOUR_API_KEY_HERE" && 
         firebaseConfig.apiKey.trim() !== "";
};

let dbService = null;
let authService = null;
let databaseMode = "mock"; // "firebase" or "mock"

if (isFirebaseConfigured() && typeof firebase !== "undefined") {
  try {
    const app = firebase.initializeApp(firebaseConfig);
    const firestore = firebase.firestore(app);
    const firebaseAuth = firebase.auth(app);
    
    databaseMode = "firebase";

    // Firestore CRUD Service (Compat SDK)
    dbService = {
      mode: "firebase",
      
      // Real-time snapshot listener
      listen: (collectionName, callback, orderField = 'createdAt') => {
        const colRef = firestore.collection(collectionName);
        return colRef.orderBy(orderField, 'desc').onSnapshot((snapshot) => {
          const items = [];
          snapshot.forEach((docSnap) => {
            items.push({ id: docSnap.id, ...docSnap.data() });
          });
          callback(items);
        }, (error) => {
          console.error(`Firestore listener error on ${collectionName}:`, error);
        });
      },

      // Add a document
      add: async (collectionName, data) => {
        const colRef = firestore.collection(collectionName);
        const docRef = await colRef.add({
          ...data,
          createdAt: new Date().toISOString()
        });
        return docRef.id;
      },

      // Update a document
      update: async (collectionName, id, updates) => {
        const docRef = firestore.collection(collectionName).doc(id);
        await docRef.update(updates);
        return id;
      },

      // Delete a document
      delete: async (collectionName, id) => {
        const docRef = firestore.collection(collectionName).doc(id);
        await docRef.delete();
        return id;
      },

      // Fetch all docs once
      get: async (collectionName, orderField = 'createdAt') => {
        const colRef = firestore.collection(collectionName);
        const snapshot = await colRef.orderBy(orderField, 'desc').get();
        const items = [];
        snapshot.forEach((docSnap) => {
          items.push({ id: docSnap.id, ...docSnap.data() });
        });
        return items;
      },

      // Set document with custom ID
      set: async (collectionName, id, data) => {
        const docRef = firestore.collection(collectionName).doc(id);
        await docRef.set(data);
        return id;
      }
    };

    // Firebase Auth Service (Compat SDK)
    authService = {
      mode: "firebase",
      
      login: async (email, password) => {
        const userCredential = await firebaseAuth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        let role = email === "admin@adeasfarm.com" ? "admin" : "staff";

        return {
          uid: user.uid,
          email: user.email,
          role: role,
          displayName: email === "admin@adeasfarm.com" ? "Farm Admin" : "Farm Staff"
        };
      },

      logout: async () => {
        await firebaseAuth.signOut();
      },

      onAuthStateChange: (callback) => {
        return firebaseAuth.onAuthStateChanged((user) => {
          if (user) {
            const role = user.email === "admin@adeasfarm.com" ? "admin" : "staff";
            callback({
              uid: user.uid,
              email: user.email,
              role: role,
              displayName: role === "admin" ? "Farm Admin" : "Farm Staff"
            });
          } else {
            callback(null);
          }
        });
      }
    };

    console.log("Firebase initialized successfully using compat SDK!");

  } catch (err) {
    console.warn("Failed to load Firebase scripts or credentials, falling back to LocalStorage mock database.", err);
    setupMockServices();
  }
} else {
  console.log("Using local mock storage (Firebase credentials not set or Firebase script tags missing)");
  setupMockServices();
}

function setupMockServices() {
  databaseMode = "mock";

  // Initial Seed Data
  const defaultProducts = [
    { id: "prod_hito", name: "Hito", price: 250, stock: 50, createdAt: new Date().toISOString() },
    { id: "prod_itik", name: "Itik", price: 300, stock: 30, createdAt: new Date().toISOString() },
    { id: "prod_sili", name: "Sili", price: 150, stock: 100, createdAt: new Date().toISOString() }
  ];

  const defaultSettings = {
    id: "global",
    farmName: "Adea's Farm",
    footerMessage: "Thank you for supporting Adea's Farm!",
    currencySymbol: "₱",
    printerWidth: "80mm",
    updatedAt: new Date().toISOString()
  };

  // Local storage helpers
  const getLocalData = (key, defaultVal) => {
    const data = localStorage.getItem(`adeas_farm_${key}`);
    if (!data) {
      localStorage.setItem(`adeas_farm_${key}`, JSON.stringify(defaultVal));
      return defaultVal;
    }
    return JSON.parse(data);
  };

  const setLocalData = (key, val) => {
    localStorage.setItem(`adeas_farm_${key}`, JSON.stringify(val));
    triggerListeners(key);
  };

  // Mock Event Listeners
  const mockListeners = {};
  const triggerListeners = (key) => {
    if (mockListeners[key]) {
      const data = getLocalData(key, []);
      mockListeners[key].forEach(callback => callback(data));
    }
  };

  // Initialize store if empty
  getLocalData("products", defaultProducts);
  getLocalData("sales", []);
  getLocalData("expenses", []);
  getLocalData("settings", defaultSettings);

  dbService = {
    mode: "mock",

    listen: (collectionName, callback) => {
      if (!mockListeners[collectionName]) {
        mockListeners[collectionName] = [];
      }
      mockListeners[collectionName].push(callback);
      // Trigger immediately
      const currentVal = getLocalData(collectionName, collectionName === "settings" ? defaultSettings : []);
      callback(Array.isArray(currentVal) ? currentVal : [currentVal]);
      
      // Return unsubscribe function
      return () => {
        mockListeners[collectionName] = mockListeners[collectionName].filter(cb => cb !== callback);
      };
    },

    add: async (collectionName, data) => {
      const items = getLocalData(collectionName, []);
      const newId = `${collectionName}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newItem = {
        id: newId,
        ...data,
        createdAt: new Date().toISOString()
      };
      items.unshift(newItem); // newest first
      setLocalData(collectionName, items);
      return newId;
    },

    update: async (collectionName, id, updates) => {
      const items = getLocalData(collectionName, []);
      const index = items.findIndex(item => item.id === id);
      if (index !== -1) {
        items[index] = { ...items[index], ...updates };
        setLocalData(collectionName, items);
        return id;
      }
      throw new Error(`Document with ID ${id} not found in ${collectionName}`);
    },

    delete: async (collectionName, id) => {
      let items = getLocalData(collectionName, []);
      items = items.filter(item => item.id !== id);
      setLocalData(collectionName, items);
      return id;
    },

    get: async (collectionName) => {
      return getLocalData(collectionName, []);
    },

    set: async (collectionName, id, data) => {
      if (collectionName === "settings") {
        setLocalData("settings", { id, ...data, updatedAt: new Date().toISOString() });
        return id;
      }
      const items = getLocalData(collectionName, []);
      const index = items.findIndex(item => item.id === id);
      if (index !== -1) {
        items[index] = { id, ...data };
      } else {
        items.push({ id, ...data });
      }
      setLocalData(collectionName, items);
      return id;
    }
  };

  // Auth local storage state
  let currentUser = JSON.parse(sessionStorage.getItem("adeas_farm_user") || "null");
  const authListeners = [];

  authService = {
    mode: "mock",

    login: async (email, password) => {
      // Validate credentials
      if (email === "admin@adeasfarm.com" && password === "admin123") {
        currentUser = {
          uid: "mock_admin_123",
          email: "admin@adeasfarm.com",
          role: "admin",
          displayName: "Farm Admin"
        };
      } else {
        throw new Error("Invalid username or password. Please try again.");
      }

      sessionStorage.setItem("adeas_farm_user", JSON.stringify(currentUser));
      authListeners.forEach(cb => cb(currentUser));
      return currentUser;
    },

    logout: async () => {
      currentUser = null;
      sessionStorage.removeItem("adeas_farm_user");
      authListeners.forEach(cb => cb(null));
    },

    onAuthStateChange: (callback) => {
      authListeners.push(callback);
      // Trigger immediately with current user status
      callback(currentUser);
      return () => {
        const idx = authListeners.indexOf(callback);
        if (idx !== -1) authListeners.splice(idx, 1);
      };
    },

    getCurrentUser: () => currentUser
  };
}

export { dbService as db, authService as auth, databaseMode };
