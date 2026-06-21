import { db, auth, databaseMode } from "./firebase-config.js";

// ==========================================================================
// Global Application State
// ==========================================================================
const state = {
  currentUser: null,
  products: [],
  sales: [],
  expenses: [],
  settings: {
    farmName: "Adea's Farm",
    currencySymbol: "P",
    printerWidth: "80mm",
    footerMessage: "Thank you for supporting Adea's Farm!"
  },
  cart: [],
  activeView: "dashboard",
  activeTxNo: "",
  activeDeleteId: "",
  activeDeleteCollection: "",
  listeners: [] // Store unsubscribe functions
};

// Global Chart Instances
let dashTrendChart = null;
let reportComparisonChart = null;
let reportExpensesChart = null;

// ==========================================================================
// Initialization & Authentication Listeners
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  initClock();
  setupAuthListener();
  setupUIEventListeners();
  
  // Attach closeModal to window so HTML inline click events can find it
  window.closeModal = closeModal;
});

// Real-Time Clock
function initClock() {
  const clockEl = document.getElementById("headerClock");
  const updateClock = () => {
    const now = new Date();
    const options = { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    };
    clockEl.innerText = now.toLocaleString('en-US', options);
  };
  updateClock();
  setInterval(updateClock, 1000);
}

// Check database mode and set badge
function updateDbBadge() {
  const badge = document.getElementById("dbStatusBadge");
  const text = document.getElementById("dbStatusText");
  const sysMode = document.getElementById("sysAuthMode");
  
  if (databaseMode === "firebase") {
    badge.className = "db-status-badge firebase";
    text.innerText = "Firebase Live";
    if (sysMode) sysMode.innerText = "Firebase Cloud Auth & Firestore";
  } else {
    badge.className = "db-status-badge mock";
    text.innerText = "Local Mock Data";
    if (sysMode) sysMode.innerText = "LocalStorage Database Mock Layer";
  }
}

// Setup Auth Listener
function setupAuthListener() {
  showLoader(true);
  auth.onAuthStateChange((user) => {
    showLoader(false);
    if (user) {
      state.currentUser = user;
      
      // Update UI Header user badge
      document.getElementById("userName").innerText = user.displayName;
      document.getElementById("userRole").innerText = user.role;
      
      // Generate avatar initials
      const initials = user.displayName.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
      document.getElementById("userInitials").innerText = initials;

      // Handle Page Visibility
      document.getElementById("authPage").style.display = "none";
      document.getElementById("appLayout").style.display = "flex";
      
      updateDbBadge();
      applyRolePermissions();
      startDatabaseSync();
      
      showToast(`Welcome back, ${user.displayName}!`, "success");
    } else {
      // User is logged out
      state.currentUser = null;
      stopDatabaseSync();
      
      document.getElementById("appLayout").style.display = "none";
      document.getElementById("authPage").style.display = "flex";
      
      // Reset forms
      document.getElementById("loginForm").reset();
    }
  });
}

// Setup Form Submission & Actions
function setupUIEventListeners() {
  // Login Form
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    
    showLoader(true);
    try {
      await auth.login(email, password);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      showLoader(false);
    }
  });

  // Logout Button
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    showLoader(true);
    try {
      await auth.logout();
      showToast("Logged out successfully.", "info");
    } catch (err) {
      showToast("Failed to logout.", "error");
    } finally {
      showLoader(false);
    }
  });

  // Sidebar Toggle for Mobile
  document.getElementById("sidebarToggle").addEventListener("click", () => {
    document.getElementById("appSidebar").classList.toggle("active");
  });

  // Navigation Links Click
  const navItems = document.querySelectorAll(".sidebar-menu .menu-item");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const view = item.getAttribute("data-view");
      switchView(view);
      // Close mobile sidebar on navigate
      document.getElementById("appSidebar").classList.remove("active");
    });
  });

  // POS Search Input
  document.getElementById("posSearch").addEventListener("input", () => {
    renderPOSCatalog();
  });

  // Checkout Proceed Button
  document.getElementById("posCheckoutBtn").addEventListener("click", () => {
    openCheckoutDrawer();
  });

  // Cash Received Input in Checkout Modal
  document.getElementById("checkoutCashInput").addEventListener("input", () => {
    calculateChange();
  });

  // Complete checkout action
  document.getElementById("checkoutConfirmBtn").addEventListener("click", () => {
    completeCheckout();
  });

  // Print receipt trigger
  document.getElementById("printReceiptTriggerBtn").addEventListener("click", () => {
    printReceipt();
  });

  // Inventory search
  document.getElementById("inventorySearch").addEventListener("input", () => {
    renderInventory();
  });

  // Add Product Button
  document.getElementById("addInventoryBtn").addEventListener("click", () => {
    if (!isAdmin()) {
      showToast("Access Denied: Only Admin can add products.", "error");
      return;
    }
    document.getElementById("productForm").reset();
    document.getElementById("productModalId").value = "";
    document.getElementById("productModalTitle").innerText = "Add New Product";
    openModal("productModal");
  });

  // Product Add/Edit Form submit
  document.getElementById("productForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("productModalId").value;
    const name = document.getElementById("productModalName").value.trim();
    const price = parseFloat(document.getElementById("productModalPrice").value);
    const stock = parseInt(document.getElementById("productModalStock").value);

    if (!name || isNaN(price) || isNaN(stock)) {
      showToast("Please fill all product fields correctly.", "warning");
      return;
    }

    showLoader(true);
    try {
      if (id) {
        // Edit Mode
        await db.update("products", id, { name, price, stock });
        showToast(`Product "${name}" updated successfully.`, "success");
      } else {
        // Add Mode
        await db.add("products", { name, price, stock });
        showToast(`Product "${name}" created successfully.`, "success");
      }
      closeModal("productModal");
    } catch (err) {
      showToast(`Error saving product: ${err.message}`, "error");
    } finally {
      showLoader(false);
    }
  });

  // Expense search & filters
  document.getElementById("expenseSearch").addEventListener("input", renderExpenses);
  document.getElementById("expenseFilterCategory").addEventListener("change", renderExpenses);
  document.getElementById("expenseFilterDate").addEventListener("change", renderExpenses);

  // Add Expense Button
  document.getElementById("addExpenseBtn").addEventListener("click", () => {
    document.getElementById("expenseForm").reset();
    document.getElementById("expenseModalId").value = "";
    // Pre-populate with current local date
    document.getElementById("expenseModalDate").value = getLocalDateString();
    document.getElementById("expenseModalTitle").innerText = "Log Business Expense";
    openModal("expenseModal");
  });

  // Expense Add/Edit Form Submit
  document.getElementById("expenseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("expenseModalId").value;
    const category = document.getElementById("expenseModalCategory").value;
    const description = document.getElementById("expenseModalDesc").value.trim();
    const amount = parseFloat(document.getElementById("expenseModalAmount").value);
    const date = document.getElementById("expenseModalDate").value;

    if (!description || isNaN(amount) || !date) {
      showToast("Please fill all expense fields correctly.", "warning");
      return;
    }

    showLoader(true);
    try {
      const logData = {
        category,
        description,
        amount,
        date,
        loggedBy: state.currentUser.displayName
      };

      if (id) {
        await db.update("expenses", id, logData);
        showToast("Expense log updated successfully.", "success");
      } else {
        await db.add("expenses", logData);
        showToast("Expense logged successfully.", "success");
      }
      closeModal("expenseModal");
    } catch (err) {
      showToast(`Error saving expense: ${err.message}`, "error");
    } finally {
      showLoader(false);
    }
  });

  // Confirm delete button yes action
  document.getElementById("confirmModalYesBtn").addEventListener("click", async () => {
    if (!state.activeDeleteId || !state.activeDeleteCollection) return;
    
    // Check permission for sales logs deletes
    if (state.activeDeleteCollection === "sales" && !isAdmin()) {
      showToast("Access Denied: Only Admin can delete sales transaction logs.", "error");
      closeModal("confirmModal");
      return;
    }
    
    showLoader(true);
    try {
      await db.delete(state.activeDeleteCollection, state.activeDeleteId);
      showToast("Item successfully deleted.", "success");
      
      // If deleted active cart items or products, it syncs automatically via snapshot
    } catch (err) {
      showToast(`Error deleting item: ${err.message}`, "error");
    } finally {
      showLoader(false);
      closeModal("confirmModal");
      state.activeDeleteId = "";
      state.activeDeleteCollection = "";
    }
  });

  // Sales History search & filter
  document.getElementById("salesSearch").addEventListener("input", renderSalesHistory);
  document.getElementById("salesFilterDate").addEventListener("change", renderSalesHistory);
  
  // CSV Export action
  document.getElementById("exportSalesCSVBtn").addEventListener("click", () => {
    exportSalesToCSV();
  });

  // Settings Farm Name Save Form
  document.getElementById("farmSettingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const farmName = document.getElementById("settingsFarmName").value.trim();
    const currencySymbol = document.getElementById("settingsCurrency").value;
    const printerWidth = document.getElementById("settingsPrinterWidth").value;
    const footerMessage = document.getElementById("settingsReceiptFooter").value.trim();

    if (!farmName) {
      showToast("Farm business name cannot be empty.", "warning");
      return;
    }

    showLoader(true);
    try {
      await db.set("settings", "global", {
        farmName,
        currencySymbol,
        printerWidth,
        footerMessage
      });
      showToast("System configurations saved successfully.", "success");
    } catch (err) {
      showToast(`Failed to save settings: ${err.message}`, "error");
    } finally {
      showLoader(false);
    }
  });

  // Reports filters
  document.getElementById("reportPeriodSelect").addEventListener("change", (e) => {
    const custom = document.getElementById("reportCustomRangeContainer");
    if (e.target.value === "custom") {
      custom.style.display = "inline-flex";
      // Pre-fill dates
      document.getElementById("reportStartDate").value = getLocalDateString();
      document.getElementById("reportEndDate").value = getLocalDateString();
    } else {
      custom.style.display = "none";
    }
  });

  // Generate Report Action
  document.getElementById("generateReportBtn").addEventListener("click", () => {
    generateReport();
  });

  // Print Report Action
  document.getElementById("printReportBtn").addEventListener("click", () => {
    printReport();
  });
}

// View switcher
function switchView(viewName) {
  const panels = document.querySelectorAll(".view-panel");
  const menuItems = document.querySelectorAll(".sidebar-menu .menu-item");
  
  panels.forEach(p => p.classList.remove("active"));
  menuItems.forEach(i => i.classList.remove("active"));
  
  const targetPanel = document.getElementById(`view-${viewName}`);
  if (targetPanel) {
    targetPanel.classList.add("active");
    state.activeView = viewName;
    
    // Capitalize view title
    const formattedTitle = viewName.charAt(0).toUpperCase() + viewName.slice(1);
    document.getElementById("currentViewTitle").innerText = formattedTitle === "Pos" ? "POS Checkout" : formattedTitle;

    // Highlight menu
    const targetMenu = Array.from(menuItems).find(i => i.getAttribute("data-view") === viewName);
    if (targetMenu) targetMenu.classList.add("active");

    // Perform specific page updates
    if (viewName === "dashboard") {
      renderDashboardCharts();
    } else if (viewName === "reports") {
      generateReport();
    }
  }
}

// Role Permissions Lock
function applyRolePermissions() {
  const adminElements = document.querySelectorAll(".admin-only");
  const isUserAdmin = isAdmin();
  
  adminElements.forEach(el => {
    if (isUserAdmin) {
      el.style.display = ""; // default
    } else {
      el.style.display = "none";
    }
  });
}

// Check admin role helper
function isAdmin() {
  return state.currentUser && state.currentUser.role === "admin";
}

// ==========================================================================
// Database Listeners (Sync)
// ==========================================================================
function startDatabaseSync() {
  stopDatabaseSync(); // clear existing listeners
  
  showLoader(true);
  
  // 1. Sync Settings
  const settingsUnsub = db.listen("settings", (data) => {
    const globalSettings = data.find(s => s.id === "global");
    if (globalSettings) {
      state.settings = { ...state.settings, ...globalSettings };
      
      // Update form values
      document.getElementById("settingsFarmName").value = state.settings.farmName;
      document.getElementById("settingsCurrency").value = state.settings.currencySymbol;
      document.getElementById("settingsPrinterWidth").value = state.settings.printerWidth;
      document.getElementById("settingsReceiptFooter").value = state.settings.footerMessage;

      // Update static display strings
      document.querySelectorAll(".sidebar-logo-text").forEach(el => el.innerText = state.settings.farmName);
      
      // Re-trigger layout renders depending on currency update
      renderPOSCatalog();
      renderCart();
      renderInventory();
      renderExpenses();
      renderSalesHistory();
      renderDashboardStats();
    }
  });
  state.listeners.push(settingsUnsub);

  // 2. Sync Products
  const productsUnsub = db.listen("products", (items) => {
    state.products = items;
    renderPOSCatalog();
    renderInventory();
    checkLowStockAlerts();
    // Verify items in cart still have valid quantities and prices
    verifyCartQuantities();
    showLoader(false);
  });
  state.listeners.push(productsUnsub);

  // 3. Sync Sales
  const salesUnsub = db.listen("sales", (items) => {
    state.sales = items;
    renderSalesHistory();
    renderDashboardStats();
    if (state.activeView === "dashboard") {
      renderDashboardCharts();
    }
  });
  state.listeners.push(salesUnsub);

  // 4. Sync Expenses
  const expensesUnsub = db.listen("expenses", (items) => {
    state.expenses = items;
    renderExpenses();
    renderDashboardStats();
    if (state.activeView === "dashboard") {
      renderDashboardCharts();
    }
  });
  state.listeners.push(expensesUnsub);
}

function stopDatabaseSync() {
  state.listeners.forEach(unsub => unsub());
  state.listeners = [];
}

// Helper: timezone friendly ISO to date comparison
function getLocalDateString(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
}

// Formatter for prices
function formatCurrency(amount) {
  const symbol = state.settings.currencySymbol || "P";
  return `${symbol}${parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ==========================================================================
// Dashboard Logic
// ==========================================================================
function renderDashboardStats() {
  const todayStr = getLocalDateString();
  
  // Calculate Today's Sales
  const salesToday = state.sales
    .filter(sale => getLocalDateString(sale.createdAt) === todayStr)
    .reduce((sum, sale) => sum + parseFloat(sale.total), 0);

  // Calculate Today's Expenses
  const expensesToday = state.expenses
    .filter(exp => exp.date === todayStr) // date is stored as YYYY-MM-DD
    .reduce((sum, exp) => sum + parseFloat(exp.amount), 0);

  // Calculate net profit
  const netProfit = salesToday - expensesToday;
  const transactionsToday = state.sales.filter(sale => getLocalDateString(sale.createdAt) === todayStr).length;

  // Render text values
  document.getElementById("dashSalesToday").innerText = formatCurrency(salesToday);
  
  const expTodayEl = document.getElementById("dashExpensesToday");
  expTodayEl.innerText = formatCurrency(expensesToday);
  
  const profitEl = document.getElementById("dashNetProfit");
  profitEl.innerText = formatCurrency(netProfit);
  if (netProfit < 0) {
    profitEl.style.color = "var(--danger)";
  } else {
    profitEl.style.color = "var(--primary-dark)";
  }

  document.getElementById("dashTransactionsCount").innerText = transactionsToday;
}

function checkLowStockAlerts() {
  const alertContainer = document.getElementById("dashLowStockAlerts");
  const lowStockProducts = state.products.filter(p => p.stock <= 15);
  
  if (lowStockProducts.length === 0) {
    alertContainer.innerHTML = `<p class="text-muted" style="text-align: center; padding: 20px;">All products are fully stocked.</p>`;
    return;
  }

  alertContainer.innerHTML = lowStockProducts.map(p => {
    const statusText = p.stock === 0 ? "Out of Stock" : `Low Stock: ${p.stock} left`;
    const styleClass = p.stock === 0 ? "style='background-color:#FFEBEE; border-color: rgba(211,47,47,0.2); color:#D32F2F;'" : "";
    const badgeClass = p.stock === 0 ? "background:#D32F2F;" : "background:#E65100;";
    
    return `
      <div class="low-stock-item" ${styleClass}>
        <span class="low-stock-name">
          <i class="fa-solid fa-triangle-exclamation"></i> ${p.name}
        </span>
        <span class="low-stock-badge" style="${badgeClass}">${statusText}</span>
      </div>
    `;
  }).join("");
}

// 7-day Sales vs Expenses Line Chart
function renderDashboardCharts() {
  const ctx = document.getElementById("dashTrendChart");
  if (!ctx) return;

  // Generate label dates for the past 7 days
  const labels = [];
  const salesData = [];
  const expensesData = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateString(d.toISOString());
    
    // Friendly label Format e.g., "Jun 21"
    const labelFriendly = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    labels.push(labelFriendly);

    // Sum sales for this day
    const salesSum = state.sales
      .filter(s => getLocalDateString(s.createdAt) === dateStr)
      .reduce((sum, s) => sum + parseFloat(s.total), 0);
    salesData.push(salesSum);

    // Sum expenses for this day
    const expSum = state.expenses
      .filter(e => e.date === dateStr)
      .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    expensesData.push(expSum);
  }

  if (dashTrendChart) {
    dashTrendChart.destroy();
  }

  dashTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Sales Revenue',
          data: salesData,
          borderColor: '#2E7D32',
          backgroundColor: 'rgba(46, 125, 50, 0.05)',
          fill: true,
          tension: 0.3,
          borderWidth: 3
        },
        {
          label: 'Operating Expenses',
          data: expensesData,
          borderColor: '#D32F2F',
          backgroundColor: 'rgba(211, 47, 47, 0.05)',
          fill: true,
          tension: 0.3,
          borderWidth: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { family: 'Outfit' } }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { font: { family: 'Outfit' } }
        },
        x: {
          ticks: { font: { family: 'Outfit' } }
        }
      }
    }
  });
}

// ==========================================================================
// POS Registry Logic
// ==========================================================================
function renderPOSCatalog() {
  const catalogContainer = document.getElementById("posCatalogGrid");
  if (!catalogContainer) return;

  const searchQuery = document.getElementById("posSearch").value.toLowerCase().trim();
  
  const filteredProducts = state.products.filter(p => p.name.toLowerCase().includes(searchQuery));
  
  if (filteredProducts.length === 0) {
    catalogContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">
        <i class="fa-solid fa-magnifying-glass" style="font-size: 2.5rem; margin-bottom: 12px;"></i>
        <p>No products match your search query.</p>
      </div>
    `;
    return;
  }

  catalogContainer.innerHTML = filteredProducts.map(p => {
    let statusClass = "in-stock";
    let statusText = "In Stock";
    let isBtnDisabled = false;

    if (p.stock <= 0) {
      statusClass = "out-of-stock";
      statusText = "Out of Stock";
      isBtnDisabled = true;
    } else if (p.stock <= 15) {
      statusClass = "low-stock";
      statusText = `Low Stock (${p.stock})`;
    }

    // Assign appropriate farm icons based on name
    let iconClass = "fa-solid fa-circle-question";
    const nameLower = p.name.toLowerCase();
    if (nameLower.includes("hito") || nameLower.includes("fish")) {
      iconClass = "fa-solid fa-fish";
    } else if (nameLower.includes("itik") || nameLower.includes("duck") || nameLower.includes("egg")) {
      iconClass = "fa-solid fa-egg";
    } else if (nameLower.includes("sili") || nameLower.includes("pepper") || nameLower.includes("chili")) {
      iconClass = "fa-solid fa-pepper-hot";
    } else {
      iconClass = "fa-solid fa-wheat-awn";
    }

    return `
      <div class="product-pos-card">
        <span class="product-pos-badge ${statusClass}">${statusText}</span>
        <div class="product-pos-icon">
          <i class="${iconClass}"></i>
        </div>
        <div class="product-pos-name">${p.name}</div>
        <div class="product-pos-price">${formatCurrency(p.price)}</div>
        <div class="product-pos-stock-count">${p.stock} units available</div>
        <button type="button" class="btn-add-cart" 
                onclick="window.addToCart('${p.id}')" 
                ${isBtnDisabled ? "disabled" : ""}>
          <i class="fa-solid fa-cart-plus"></i> Add to Cart
        </button>
      </div>
    `;
  }).join("");
}

// Cart Management Window bindings
window.addToCart = (productId) => {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  if (product.stock <= 0) {
    showToast("Product is out of stock.", "warning");
    return;
  }

  // Find if already in cart
  const cartItem = state.cart.find(item => item.productId === productId);
  if (cartItem) {
    if (cartItem.qty >= product.stock) {
      showToast(`Cannot add more. Only ${product.stock} units in inventory.`, "warning");
      return;
    }
    cartItem.qty += 1;
  } else {
    state.cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      qty: 1
    });
  }

  showToast(`${product.name} added to cart.`, "info");
  renderCart();
};

window.changeCartQty = (productId, delta) => {
  const item = state.cart.find(item => item.productId === productId);
  const product = state.products.find(p => p.id === productId);
  
  if (!item || !product) return;

  const newQty = item.qty + delta;
  
  if (newQty <= 0) {
    state.cart = state.cart.filter(i => i.productId !== productId);
    showToast(`${item.name} removed from cart.`, "info");
  } else {
    if (newQty > product.stock) {
      showToast(`Limit reached. Only ${product.stock} items available in stock.`, "warning");
      return;
    }
    item.qty = newQty;
  }
  renderCart();
};

window.removeFromCart = (productId) => {
  const item = state.cart.find(i => i.productId === productId);
  if (item) {
    state.cart = state.cart.filter(i => i.productId !== productId);
    showToast(`${item.name} removed from cart.`, "info");
    renderCart();
  }
};

function verifyCartQuantities() {
  let changed = false;
  state.cart = state.cart.filter(item => {
    const product = state.products.find(p => p.id === item.productId);
    if (!product) {
      changed = true;
      return false; // remove deleted products
    }
    
    // Sync price if edited in inventory
    if (item.price !== product.price) {
      item.price = product.price;
      changed = true;
    }

    // Clamp stock
    if (item.qty > product.stock) {
      item.qty = product.stock;
      changed = true;
      if (item.qty === 0) {
        return false;
      }
      showToast(`Cart quantity adjusted for ${product.name} due to stock change.`, "warning");
    }
    return true;
  });

  if (changed) {
    renderCart();
  }
}

function renderCart() {
  const listContainer = document.getElementById("posCartItemsList");
  const checkoutBtn = document.getElementById("posCheckoutBtn");
  
  if (!listContainer) return;

  if (state.cart.length === 0) {
    listContainer.innerHTML = `
      <div class="cart-empty-state">
        <i class="fa-solid fa-basket-shopping"></i>
        <p>Your cart is empty. Click items on the left to add.</p>
      </div>
    `;
    document.getElementById("posSubtotal").innerText = formatCurrency(0);
    document.getElementById("posTotal").innerText = formatCurrency(0);
    checkoutBtn.disabled = true;
    return;
  }

  listContainer.innerHTML = state.cart.map(item => {
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <span class="cart-item-name">${item.name}</span>
          <span class="cart-item-price">${formatCurrency(item.price)} each</span>
        </div>
        <div class="cart-item-qty-controls">
          <button type="button" class="btn-qty" onclick="window.changeCartQty('${item.productId}', -1)">-</button>
          <span class="cart-qty-val">${item.qty}</span>
          <button type="button" class="btn-qty" onclick="window.changeCartQty('${item.productId}', 1)">+</button>
        </div>
        <div class="cart-item-total">${formatCurrency(item.price * item.qty)}</div>
        <button type="button" class="btn-remove-cart" onclick="window.removeFromCart('${item.productId}')">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
  }).join("");

  const subtotal = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  
  document.getElementById("posSubtotal").innerText = formatCurrency(subtotal);
  document.getElementById("posTotal").innerText = formatCurrency(subtotal);
  
  checkoutBtn.disabled = false;

  // Generate automated Transaction ID if not set
  if (!state.activeTxNo) {
    state.activeTxNo = `TX-${Date.now().toString().slice(-8)}`;
  }
  document.getElementById("posTransactionNo").innerText = state.activeTxNo;
}

// Settlement Checkout modal
function openCheckoutDrawer() {
  const total = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  document.getElementById("checkoutTotalPayable").innerText = formatCurrency(total);
  
  // Reset cash input
  const cashInput = document.getElementById("checkoutCashInput");
  cashInput.value = "";
  
  calculateChange();
  openModal("checkoutModal");
  setTimeout(() => cashInput.focus(), 150);
}

function calculateChange() {
  const total = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const cash = parseFloat(document.getElementById("checkoutCashInput").value) || 0;
  
  const change = cash - total;
  const changeValEl = document.getElementById("checkoutChangeVal");
  const changeBox = document.getElementById("checkoutChangeBox");
  const confirmBtn = document.getElementById("checkoutConfirmBtn");

  changeValEl.innerText = formatCurrency(Math.max(0, change));

  if (cash >= total && total > 0) {
    changeBox.className = "change-display positive";
    confirmBtn.disabled = false;
  } else {
    changeBox.className = "change-display negative";
    confirmBtn.disabled = true;
  }
}

async function completeCheckout() {
  const total = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const cash = parseFloat(document.getElementById("checkoutCashInput").value) || 0;
  const change = cash - total;
  const transactionNo = state.activeTxNo;

  showLoader(true);
  try {
    // 1. Deduct Product stocks
    for (const item of state.cart) {
      const product = state.products.find(p => p.id === item.productId);
      if (product) {
        const remainingStock = Math.max(0, product.stock - item.qty);
        await db.update("products", product.id, { stock: remainingStock });
      }
    }

    // 2. Save Transaction Document
    const saleRecord = {
      transactionNo: transactionNo,
      items: state.cart.map(i => ({
        productId: i.productId,
        name: i.name,
        qty: i.qty,
        price: i.price
      })),
      total: total,
      cash: cash,
      change: change,
      cashier: state.currentUser.displayName
    };

    const docId = await db.add("sales", saleRecord);
    
    // 3. Clear cart and active TX No
    state.cart = [];
    state.activeTxNo = "";

    closeModal("checkoutModal");
    showToast("Checkout finalized successfully!", "success");

    // 4. Render Receipt Preview Modal immediately
    const fullSaleRecord = { id: docId, createdAt: new Date().toISOString(), ...saleRecord };
    renderReceiptPreview(fullSaleRecord);

  } catch (err) {
    showToast(`Transaction failed: ${err.message}`, "error");
  } finally {
    showLoader(false);
  }
}

// Render receipt preview using HTML Table layout

function renderReceiptPreview(sale) {
  const container = document.getElementById("thermalReceiptPreview");
  if (!container) return;

  const currency = state.settings.currencySymbol || "P";
  const formattedDate = new Date(sale.createdAt).toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  }).replace(',', '');

  const cw = 26; // Reduced to 26 so cw (26) + margin (2) = 28 (the safe printer limit)
  const margin = "  "; // 2 spaces global left margin to shift everything to the right
  
  function center(t) {
    if (t.length >= cw) return margin + t.substring(0, cw);
    // Use Math.ceil to add an extra space on the left, shifting the text 1 character right
    const p = Math.ceil((cw - t.length) / 2);
    return margin + " ".repeat(p) + t;
  }
  
  function lr(l, r) {
    const s = cw - l.length - r.length;
    if (s <= 0) return margin + l.substring(0, cw - r.length - 1) + " " + r;
    return margin + l + " ".repeat(s) + r;
  }
  
  function lcr(l, c, r) {
    // Exact column sizing for 26 chars: Left 10, Center 4, Right 12
    let L = l.length > 10 ? l.substring(0, 10) : l.padEnd(10, " ");
    let C = c.padStart(2, " ").padEnd(4, " ");
    let R = r.padStart(12, " ");
    return margin + L + C + R;
  }

  const dashes = margin + "-".repeat(cw);

  let out = "";
  out += margin + "\n";
  out += center("ADEA'S FARM") + "\n";
  out += center("POS RECEIPT") + "\n";
  out += margin + "\n";
  out += dashes + "\n";
  out += lr("Tx No:", sale.transactionNo) + "\n";
  out += lr("Date:", formattedDate) + "\n";
  out += lr("Cashier:", sale.cashier || "Staff") + "\n";
  out += dashes + "\n";
  
  sale.items.forEach(item => {
    const subtotal = item.price * item.qty;
    out += lcr(item.name, `x${item.qty}`, `${currency}${subtotal.toFixed(2)}`) + "\n";
  });
  
  out += dashes + "\n";
  out += lr("TOTAL:", `${currency}${sale.total.toFixed(2)}`) + "\n";
  out += lr("Cash:", `${currency}${sale.cash.toFixed(2)}`) + "\n";
  out += lr("Change:", `${currency}${sale.change.toFixed(2)}`) + "\n";
  out += dashes + "\n";
  out += margin + "\n";
  out += center("Adea's Farm thanks you.") + "\n";
  
  // 4 protected blank lines to force paper feed past the tear bar
  out += margin + " \n" + margin + " \n" + margin + " \n" + margin + " \n.";

  container.innerHTML = `<pre style="font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #000; margin: 0 auto; width: 58mm; padding: 10px 0; overflow: hidden; font-weight: bold; line-height: 1.2;">${out}</pre>`;
  
  openModal("receiptPreviewModal");
}

function printReceipt() {
  const receiptHtml = document.getElementById("thermalReceiptPreview").innerHTML;
  const printArea = document.createElement("div");
  printArea.id = "print-area";
  printArea.innerHTML = receiptHtml;
  document.body.appendChild(printArea);

  window.print();

  setTimeout(() => {
    document.body.removeChild(printArea);
  }, 100);
}

// ==========================================================================
// Inventory Management Logic
// ==========================================================================
function renderInventory() {
  const tableBody = document.getElementById("inventoryTableBody");
  if (!tableBody) return;

  const searchQuery = document.getElementById("inventorySearch").value.toLowerCase().trim();
  const filtered = state.products.filter(p => p.name.toLowerCase().includes(searchQuery));

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty-state">
          <i class="fa-solid fa-boxes-stacked"></i>
          <p>No products found in the database.</p>
        </td>
      </tr>
    `;
    return;
  }

  const isUserAdmin = isAdmin();

  tableBody.innerHTML = filtered.map(p => {
    let stockClass = "success";
    let stockStatus = "In Stock";

    if (p.stock === 0) {
      stockClass = "danger";
      stockStatus = "Out of Stock";
    } else if (p.stock <= 15) {
      stockClass = "warning";
      stockStatus = `Low Stock`;
    }

    return `
      <tr>
        <td style="font-family: monospace; font-weight:600;">${p.id.slice(-8).toUpperCase()}</td>
        <td style="font-weight: 700;">${p.name}</td>
        <td>${formatCurrency(p.price)}</td>
        <td style="font-weight: 700;">${p.stock} units</td>
        <td><span class="badge ${stockClass}">${stockStatus}</span></td>
        <td class="table-actions admin-only" style="${isUserAdmin ? '' : 'display:none;'}">
          <button type="button" class="btn-icon edit" onclick="window.editProduct('${p.id}')">
            <i class="fa-solid fa-pencil"></i>
          </button>
          <button type="button" class="btn-icon delete" onclick="window.confirmDelete('${p.id}', 'products')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// Global functions for inline table calls
window.editProduct = (productId) => {
  if (!isAdmin()) {
    showToast("Access Denied: Only Admin can update products.", "error");
    return;
  }

  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  document.getElementById("productModalId").value = product.id;
  document.getElementById("productModalName").value = product.name;
  document.getElementById("productModalPrice").value = product.price;
  document.getElementById("productModalStock").value = product.stock;
  document.getElementById("productModalTitle").innerText = "Edit Product Details";
  
  openModal("productModal");
};

// Generic delete verifier trigger
window.confirmDelete = (id, collectionName) => {
  if (collectionName === "products" && !isAdmin()) {
    showToast("Access Denied: Only Admin can delete products.", "error");
    return;
  }
  if (collectionName === "sales" && !isAdmin()) {
    showToast("Access Denied: Only Admin can delete sales records.", "error");
    return;
  }

  state.activeDeleteId = id;
  state.activeDeleteCollection = collectionName;
  
  let itemDescription = "this record";
  if (collectionName === "products") {
    const p = state.products.find(p => p.id === id);
    if (p) itemDescription = `product "${p.name}"`;
  } else if (collectionName === "expenses") {
    const e = state.expenses.find(e => e.id === id);
    if (e) itemDescription = `expense logs for "${e.description}"`;
  } else if (collectionName === "sales") {
    const s = state.sales.find(s => s.id === id);
    if (s) itemDescription = `sales transaction ${s.transactionNo}`;
  }

  document.getElementById("confirmModalText").innerHTML = `Are you sure you want to delete <strong>${itemDescription}</strong>?<br>This operation is permanent.`;
  openModal("confirmModal");
};

// ==========================================================================
// Expense Tracking Logic
// ==========================================================================
function renderExpenses() {
  const tableBody = document.getElementById("expensesTableBody");
  if (!tableBody) return;

  const searchQuery = document.getElementById("expenseSearch").value.toLowerCase().trim();
  const categoryFilter = document.getElementById("expenseFilterCategory").value;
  const dateFilter = document.getElementById("expenseFilterDate").value;

  const filtered = state.expenses.filter(e => {
    const matchesSearch = e.description.toLowerCase().includes(searchQuery);
    const matchesCategory = categoryFilter === "" || e.category === categoryFilter;
    const matchesDate = dateFilter === "" || e.date === dateFilter;
    return matchesSearch && matchesCategory && matchesDate;
  });

  // Calculate sum of filtered
  const sum = filtered.reduce((total, e) => total + parseFloat(e.amount), 0);
  document.getElementById("expensesSumVal").innerText = formatCurrency(sum);

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty-state">
          <i class="fa-solid fa-wallet"></i>
          <p>No logged expenses fit the filter settings.</p>
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(e => {
    // Format Expense date beautifully
    const formattedDate = new Date(e.date).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });

    return `
      <tr>
        <td style="font-weight: 500;">${formattedDate}</td>
        <td><span class="badge category-${e.category.toLowerCase()}">${e.category}</span></td>
        <td>${e.description}</td>
        <td style="font-weight: 700; color: var(--danger);">${formatCurrency(e.amount)}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${e.loggedBy || "Staff"}</td>
        <td class="table-actions">
          <button type="button" class="btn-icon edit" onclick="window.editExpense('${e.id}')">
            <i class="fa-solid fa-pencil"></i>
          </button>
          <button type="button" class="btn-icon delete" onclick="window.confirmDelete('${e.id}', 'expenses')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.editExpense = (expenseId) => {
  const expense = state.expenses.find(e => e.id === expenseId);
  if (!expense) return;

  document.getElementById("expenseModalId").value = expense.id;
  document.getElementById("expenseModalCategory").value = expense.category;
  document.getElementById("expenseModalDesc").value = expense.description;
  document.getElementById("expenseModalAmount").value = expense.amount;
  document.getElementById("expenseModalDate").value = expense.date;
  document.getElementById("expenseModalTitle").innerText = "Edit Expense Details";

  openModal("expenseModal");
};

// ==========================================================================
// Sales History Logic
// ==========================================================================
function renderSalesHistory() {
  const tableBody = document.getElementById("salesTableBody");
  if (!tableBody) return;

  const searchQuery = document.getElementById("salesSearch").value.toLowerCase().trim();
  const dateFilter = document.getElementById("salesFilterDate").value;

  const filtered = state.sales.filter(s => {
    const matchesSearch = s.transactionNo.toLowerCase().includes(searchQuery);
    const matchesDate = dateFilter === "" || getLocalDateString(s.createdAt) === dateFilter;
    return matchesSearch && matchesDate;
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty-state">
          <i class="fa-solid fa-receipt"></i>
          <p>No transaction history matching searches.</p>
        </td>
      </tr>
    `;
    return;
  }

  const isUserAdmin = isAdmin();

  tableBody.innerHTML = filtered.map(s => {
    const dateFormatted = new Date(s.createdAt).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });

    const itemsCount = s.items.reduce((sum, i) => sum + i.qty, 0);

    return `
      <tr>
        <td style="font-family: monospace; font-weight:700;">${s.transactionNo}</td>
        <td>${dateFormatted}</td>
        <td>${itemsCount} items</td>
        <td style="font-weight: 800; color: var(--primary-dark);">${formatCurrency(s.total)}</td>
        <td>${formatCurrency(s.cash)}</td>
        <td>${formatCurrency(s.change)}</td>
        <td class="table-actions">
          <button type="button" class="btn-icon view" title="View Receipt" onclick="window.viewPreviousReceipt('${s.id}')">
            <i class="fa-solid fa-file-invoice"></i>
          </button>
          <button type="button" class="btn-icon delete admin-only" title="Delete Sale (Admin)" 
                  style="${isUserAdmin ? '' : 'display:none;'}"
                  onclick="window.confirmDelete('${s.id}', 'sales')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.viewPreviousReceipt = (saleId) => {
  const sale = state.sales.find(s => s.id === saleId);
  if (sale) {
    renderReceiptPreview(sale);
  }
};

// Export Sales Transactions list to CSV format
function exportSalesToCSV() {
  if (state.sales.length === 0) {
    showToast("No sales records available to export.", "warning");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  
  // Headers
  csvContent += "Transaction No,Date & Time,Item Name,Quantity,Unit Price,Total Cost,Cash Received,Change,Cashier\r\n";

  state.sales.forEach(sale => {
    const formattedDate = new Date(sale.createdAt).toLocaleString().replace(/,/g, '');
    sale.items.forEach(item => {
      const line = [
        sale.transactionNo,
        formattedDate,
        `"${item.name}"`,
        item.qty,
        item.price.toFixed(2),
        (item.price * item.qty).toFixed(2),
        sale.total.toFixed(2),
        sale.cash.toFixed(2),
        sale.change.toFixed(2),
        `"${sale.cashier || 'Staff'}"`
      ].join(",");
      csvContent += line + "\r\n";
    });
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `adeas_farm_sales_${getLocalDateString()}.csv`);
  document.body.appendChild(link); // Required for FF
  link.click();
  document.body.removeChild(link);
  
  showToast("CSV Sales export downloaded successfully.", "success");
}

// ==========================================================================
// Reports Generation Logic
// ==========================================================================
function generateReport() {
  const period = document.getElementById("reportPeriodSelect").value;
  const repTitleEl = document.getElementById("reportTitle");
  const repSubdateEl = document.getElementById("reportSubdate");

  let startDate, endDate;
  const today = new Date();
  
  // Subheader labels
  let dateText = "";

  if (period === "daily") {
    const todayStr = getLocalDateString();
    startDate = new Date(todayStr + "T00:00:00");
    endDate = new Date(todayStr + "T23:59:59");
    repTitleEl.innerText = "Daily Business Report";
    dateText = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } else if (period === "weekly") {
    // 7 days ago
    const pastWeek = new Date();
    pastWeek.setDate(today.getDate() - 6);
    startDate = new Date(getLocalDateString(pastWeek.toISOString()) + "T00:00:00");
    endDate = new Date(getLocalDateString(today.toISOString()) + "T23:59:59");
    repTitleEl.innerText = "Weekly Performance Report";
    dateText = `${pastWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else if (period === "monthly") {
    // Start of month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    startDate = new Date(getLocalDateString(startOfMonth.toISOString()) + "T00:00:00");
    endDate = new Date(getLocalDateString(today.toISOString()) + "T23:59:59");
    repTitleEl.innerText = "Monthly Financial Report";
    dateText = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } else if (period === "custom") {
    const startInput = document.getElementById("reportStartDate").value;
    const endInput = document.getElementById("reportEndDate").value;
    
    if (!startInput || !endInput) {
      showToast("Please enter a valid start and end date.", "warning");
      return;
    }
    
    startDate = new Date(startInput + "T00:00:00");
    endDate = new Date(endInput + "T23:59:59");
    repTitleEl.innerText = "Custom Interval Summary Report";
    
    const sD = new Date(startInput);
    const eD = new Date(endInput);
    dateText = `${sD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} to ${eD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  repSubdateEl.innerText = `Reporting period: ${dateText}`;
  document.getElementById("reportFarmNameHeader").innerText = state.settings.farmName;

  // Filter lists based on exact Date stamps
  const reportSales = state.sales.filter(s => {
    const created = new Date(s.createdAt);
    return created >= startDate && created <= endDate;
  });

  const reportExpenses = state.expenses.filter(e => {
    const expDate = new Date(e.date + "T12:00:00"); // Midday buffer for timezone parsing
    return expDate >= startDate && expDate <= endDate;
  });

  // Calculate Metrics
  const totalRev = reportSales.reduce((sum, s) => sum + parseFloat(s.total), 0);
  const totalExp = reportExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const netProfit = totalRev - totalExp;

  document.getElementById("repTotalSales").innerText = formatCurrency(totalRev);
  document.getElementById("repTotalExpenses").innerText = formatCurrency(totalExp);
  
  const profitEl = document.getElementById("repNetProfit");
  profitEl.innerText = formatCurrency(netProfit);
  if (netProfit < 0) {
    profitEl.style.color = "var(--danger)";
  } else {
    profitEl.style.color = "var(--primary-dark)";
  }

  // Draw reports charts
  renderReportsCharts(totalRev, totalExp, reportExpenses);

  // Draw report items table breakdown
  renderReportsTable(reportSales);
}

function renderReportsCharts(salesSum, expensesSum, expensesList) {
  // Chart 1: Revenue vs Expenses comparison Bar
  const barCtx = document.getElementById("reportComparisonChart");
  if (barCtx) {
    if (reportComparisonChart) reportComparisonChart.destroy();
    
    reportComparisonChart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: ['Revenue Flow', 'Business Expenses'],
        datasets: [{
          data: [salesSum, expensesSum],
          backgroundColor: ['#2E7D32', '#D32F2F'],
          borderRadius: 8,
          maxBarThickness: 60
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { font: { family: 'Outfit' } }
          },
          x: {
            ticks: { font: { family: 'Outfit' } }
          }
        }
      }
    });
  }

  // Chart 2: Expenses category breakdown Pie
  const doughnutCtx = document.getElementById("reportExpensesChart");
  if (doughnutCtx) {
    if (reportExpensesChart) reportExpensesChart.destroy();

    // Group expenses by category
    const categories = ["Feeds", "Maintenance", "Utilities", "Transportation", "Supplies", "Other"];
    const catSums = categories.map(cat => {
      return expensesList
        .filter(e => e.category === cat)
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    });

    // Check if any expenses exist
    const hasExpenses = catSums.some(s => s > 0);

    reportExpensesChart = new Chart(doughnutCtx, {
      type: 'doughnut',
      data: {
        labels: categories,
        datasets: [{
          data: hasExpenses ? catSums : [0, 0, 0, 0, 0, 1], // fallback visuals
          backgroundColor: [
            '#EF6C00', // Feeds - Orange
            '#0288D1', // Maintenance - Blue
            '#5E35B1', // Utilities - Purple
            '#00897B', // Transportation - Teal
            '#8E24AA', // Supplies - Purple light
            '#90A4AE'  // Other - Grey
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { family: 'Outfit', size: 10 } }
          }
        }
      }
    });
  }
}

function renderReportsTable(reportSales) {
  const tableBody = document.getElementById("reportProductsTableBody");
  if (!tableBody) return;

  // Flatten and group items sold
  const soldSums = {};
  
  reportSales.forEach(sale => {
    sale.items.forEach(item => {
      if (!soldSums[item.name]) {
        soldSums[item.name] = { qty: 0, revenue: 0, prices: [] };
      }
      soldSums[item.name].qty += item.qty;
      soldSums[item.name].revenue += (item.price * item.qty);
      soldSums[item.name].prices.push(item.price);
    });
  });

  const productsList = Object.keys(soldSums);
  if (productsList.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-muted" style="text-align:center; padding: 20px;">No sales transactions during this period.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = productsList.map(name => {
    const data = soldSums[name];
    
    // Average price calculator
    const avgPrice = data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length;

    return `
      <tr>
        <td style="font-weight: 700;">${name}</td>
        <td>${data.qty} units</td>
        <td>${formatCurrency(avgPrice)}</td>
        <td style="font-weight: 700; color: var(--primary-dark);">${formatCurrency(data.revenue)}</td>
      </tr>
    `;
  }).join("");
}

// Print full reports page
function printReport() {
  const reportHTML = document.getElementById("printableReportCard").outerHTML;
  const printArea = document.getElementById("printArea");
  
  // Make a clone without print shadows
  printArea.innerHTML = reportHTML;
  
  // Copy Charts image rendering if needed, but modern browsers print canvas content perfectly!
  window.print();
  printArea.innerHTML = ""; // Clean
}

// ==========================================================================
// Toast Notification & Modal Core Utilities
// ==========================================================================
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  // Icon selector
  let icon = "fa-solid fa-circle-check";
  if (type === "error") icon = "fa-solid fa-circle-exclamation";
  if (type === "warning") icon = "fa-solid fa-triangle-exclamation";
  if (type === "info") icon = "fa-solid fa-circle-info";

  toast.innerHTML = `
    <i class="${icon} toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  // Auto trigger slide out and delete
  setTimeout(() => {
    toast.style.animation = "slideInLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse";
    setTimeout(() => {
      if (toast.parentNode === container) {
        container.removeChild(toast);
      }
    }, 280);
  }, 4000);
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("active");
  }
}

function showLoader(show = true) {
  const loader = document.getElementById("loaderOverlay");
  if (loader) {
    loader.style.display = show ? "flex" : "none";
  }
}
