import React, { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  description: string;
  categoryName?: string;
  isActive: boolean;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface OrderItem {
  id: string;
  customer_id: string;
  status: 'PENDING' | 'RESERVED' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';
  total_cents: number;
  currency: string;
  idempotency_key: string;
  created_at: string;
  items?: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
  }>;
}

interface NotificationLog {
  id: string;
  recipient_email: string;
  notification_type: string;
  correlation_id: string;
  payload: any;
  status: string;
  sent_at: string;
}

interface UserProfile {
  firstName: string;
  lastName: string;
  phone: string;
  shippingAddress: {
    street: string;
    city: string;
    country: string;
    zip: string;
  };
}

const API_URL = 'http://localhost:8000/api/v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<'catalog' | 'orders' | 'profile' | 'notifications' | 'techmap'>('catalog');
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [shippingAddress, setShippingAddress] = useState({ street: '100 Innovation Way', city: 'Mumbai', country: 'India', zip: '400001' });

  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('jwt_token'));
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authFirstName, setAuthFirstName] = useState('');
  const [authLastName, setAuthLastName] = useState('');
  const [currentUser, setCurrentUser] = useState<{ email: string; userId: string; role: string } | null>(null);

  // Profile state
  const [profile, setProfile] = useState<UserProfile>({
    firstName: 'DevOps',
    lastName: 'Engineer',
    phone: '+91 9876543210',
    shippingAddress: { street: '100 Innovation Way', city: 'Mumbai', country: 'India', zip: '400001' }
  });

  // Orders state
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
  const [sagaStep, setSagaStep] = useState<number>(0);
  const [latestSagaOrder, setLatestSagaOrder] = useState<any>(null);

  // Notifications state
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);

  // Health & Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<'connected' | 'offline'>('connected');

  useEffect(() => {
    fetchProducts();
    fetchNotifications();
    if (token) {
      decodeToken(token);
      fetchOrders(token);
      fetchProfile(token);
    }
  }, []);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const decodeToken = (jwtString: string) => {
    try {
      const payloadBase64 = jwtString.split('.')[1];
      const decodedJson = JSON.parse(atob(payloadBase64));
      setCurrentUser({
        email: decodedJson.email || 'engineer@enterprise.example',
        userId: decodedJson.userId || '',
        role: decodedJson.role || 'CUSTOMER'
      });
    } catch {
      // Ignore
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_URL}/products`);
      const json = await res.json();
      if (json.success && json.data.length > 0) {
        setProducts(json.data);
      } else {
        // Fallback default enterprise catalog items
        setProducts([
          {
            id: 'a0000000-0000-0000-0000-000000000001',
            name: 'Enterprise Cloud Architecture Masterclass',
            slug: 'cloud-masterclass',
            priceCents: 4999,
            description: 'Hands-on production AWS Mumbai, EKS, Terraform, and Multi-Service design.',
            categoryName: 'Cloud & DevOps',
            isActive: true
          },
          {
            id: 'a0000000-0000-0000-0000-000000000002',
            name: 'Kubernetes Security & Hardening Guide',
            slug: 'k8s-security',
            priceCents: 2999,
            description: 'Production Pod Security Standards, RBAC, NetworkPolicies, and CIS benchmarks.',
            categoryName: 'Security',
            isActive: true
          },
          {
            id: 'a0000000-0000-0000-0000-000000000003',
            name: 'Site Reliability Engineering Handbook',
            slug: 'sre-handbook',
            priceCents: 3499,
            description: 'The 4 Golden Signals, Prometheus metrics, distributed tracing, and real incident drills.',
            categoryName: 'SRE & Monitoring',
            isActive: true
          }
        ]);
      }
    } catch {
      setGatewayStatus('offline');
      showToast('API Gateway (port 8000) is unreachable.', 'error');
    }
  };

  const fetchOrders = async (authToken: string) => {
    try {
      const res = await fetch(`${API_URL}/orders`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const json = await res.json();
      if (json.success) {
        setOrders(json.data);
      }
    } catch {
      // Ignore
    }
  };

  const fetchProfile = async (authToken: string) => {
    try {
      const res = await fetch(`${API_URL}/users/profile`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const json = await res.json();
      if (json.success && json.data) {
        setProfile({
          firstName: json.data.first_name || 'DevOps',
          lastName: json.data.last_name || 'Engineer',
          phone: json.data.phone || '+91 9876543210',
          shippingAddress: json.data.shipping_address || shippingAddress
        });
      }
    } catch {
      // Ignore
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/users/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          firstName: profile.firstName,
          lastName: profile.lastName,
          phone: profile.phone,
          shippingAddress: profile.shippingAddress
        })
      });
      const json = await res.json();
      if (json.success) {
        showToast('Profile updated successfully in User Service!', 'success');
      } else {
        showToast(json.error?.message || 'Update failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch(`${API_URL}/notifications`);
      const json = await res.json();
      if (json.success) {
        setNotifications(json.data);
      }
    } catch {
      // Ignore
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          firstName: authFirstName || 'DevOps',
          lastName: authLastName || 'Learner'
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Registered! Please sign in with your password.', 'success');
        setAuthMode('login');
      } else {
        showToast(data.error?.message || 'Registration failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });
      const data = await res.json();
      if (data.success) {
        const accessToken = data.data.accessToken;
        setToken(accessToken);
        localStorage.setItem('jwt_token', accessToken);
        decodeToken(accessToken);
        fetchOrders(accessToken);
        fetchProfile(accessToken);
        setIsAuthModalOpen(false);
        showToast('Welcome back! JWT session established.', 'success');
      } else {
        showToast(data.error?.message || 'Login failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    localStorage.removeItem('jwt_token');
    showToast('Logged out successfully.', 'info');
  };

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    showToast(`Added "${product.name}" to cart.`, 'success');
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQ = item.quantity + delta;
            return newQ > 0 ? { ...item, quantity: newQ } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const cartTotalCents = cart.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);

  const handleCheckout = async () => {
    if (!token) {
      setIsAuthModalOpen(true);
      showToast('Please sign in or register before checking out.', 'info');
      return;
    }

    if (cart.length === 0) return;

    try {
      const idempotencyKey = crypto.randomUUID();
      const itemsPayload = cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity
      }));

      // Start Saga Animation
      setSagaStep(1);
      setActiveTab('orders');
      setIsCartOpen(false);

      const res = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify({ items: itemsPayload })
      });

      const json = await res.json();
      if (json.success) {
        setLatestSagaOrder(json.data);
        setCart([]);
        showToast('Order submitted! Choreographed Saga executing on RabbitMQ.', 'success');

        // Progressively simulate Saga pipeline states
        setTimeout(() => setSagaStep(2), 700);
        setTimeout(() => setSagaStep(3), 1500);
        setTimeout(() => {
          setSagaStep(4);
          fetchOrders(token);
          fetchNotifications();
        }, 2200);
      } else {
        setSagaStep(0);
        showToast(json.error?.message || 'Checkout failed', 'error');
      }
    } catch (err: any) {
      setSagaStep(0);
      showToast(`Network error: ${err.message}`, 'error');
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === 'ALL' || p.categoryName === selectedCategory;
    const matchesQuery = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Toast Alert */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 20px',
            borderRadius: '10px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 600,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2)',
            backgroundColor: toast.type === 'success' ? '#059669' : toast.type === 'error' ? '#dc2626' : '#2563eb'
          }}
        >
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '16px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Enterprise Header */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}
        >
          {/* Logo & Platform Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #2563eb, #1e40af)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '22px'
              }}
            >
              ☁️
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '19px', color: '#0f172a', letterSpacing: '-0.5px' }}>
                CloudStore Enterprise
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                Production-Grade Microservices & DevOps Platform
              </div>
            </div>
          </div>

          {/* Infrastructure Health Telemetry Indicators */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: gatewayStatus === 'connected' ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${gatewayStatus === 'connected' ? '#a7f3d0' : '#fecaca'}`,
                color: gatewayStatus === 'connected' ? '#065f46' : '#991b1b',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: gatewayStatus === 'connected' ? '#10b981' : '#ef4444'
                }}
              />
              Gateway :8000 LIVE
            </div>
            <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', fontWeight: 600, color: '#475569' }}>
              🐘 Postgres 16 (7 DBs)
            </span>
            <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', fontWeight: 600, color: '#475569' }}>
              ⚡ Redis 7 Cache
            </span>
            <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', fontWeight: 600, color: '#475569' }}>
              🐇 RabbitMQ 3 Broker
            </span>
          </div>

          {/* User Profile & Cart Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {currentUser ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>{currentUser.email}</div>
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>Role: {currentUser.role}</div>
                </div>
                <button
                  onClick={handleLogout}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#fff',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAuthMode('login');
                  setIsAuthModalOpen(true);
                }}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                Sign In / Register
              </button>
            )}

            {/* Cart Trigger */}
            <button
              onClick={() => setIsCartOpen(true)}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                color: '#0f172a',
                fontSize: '13px',
                fontWeight: 700
              }}
            >
              <span>🛒 Cart</span>
              <span
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  borderRadius: '12px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 800
                }}
              >
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px', display: 'flex', gap: '20px', overflowX: 'auto' }}>
          {[
            { id: 'catalog', label: '📦 Product Catalog' },
            { id: 'orders', label: `🔄 Orders & Saga (${orders.length})` },
            { id: 'profile', label: '👤 Customer Profile' },
            { id: 'notifications', label: `📬 Notification Audit (${notifications.length})` },
            { id: 'techmap', label: '🛠️ Architecture & Tech Stack Map' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '12px 4px',
                border: 'none',
                background: 'none',
                fontSize: '14px',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                color: activeTab === tab.id ? '#2563eb' : '#64748b',
                borderBottom: activeTab === tab.id ? '3px solid #2563eb' : '3px solid transparent'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Body */}
      <main style={{ flex: 1, maxWidth: '1280px', margin: '0 auto', width: '100%', padding: '32px 24px' }}>
        {/* ================================================================= */}
        {/* TAB 1: PRODUCT CATALOG */}
        {/* ================================================================= */}
        {activeTab === 'catalog' && (
          <div>
            {/* Search and Filters */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '28px'
              }}
            >
              <div>
                <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                  Enterprise Catalog
                </h2>
                <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
                  Read-heavy catalog cached in Redis with sub-millisecond retrieval.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    minWidth: '220px'
                  }}
                />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    background: '#fff'
                  }}
                >
                  <option value="ALL">All Categories</option>
                  <option value="Cloud & DevOps">Cloud & DevOps</option>
                  <option value="Security">Security</option>
                  <option value="SRE & Monitoring">SRE & Monitoring</option>
                </select>
              </div>
            </div>

            {/* Product Cards Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                gap: '24px'
              }}
            >
              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '14px',
                    padding: '24px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.03)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span
                        style={{
                          background: '#eff6ff',
                          color: '#2563eb',
                          fontSize: '12px',
                          fontWeight: 700,
                          padding: '4px 10px',
                          borderRadius: '6px'
                        }}
                      >
                        {p.categoryName || 'Curriculum'}
                      </span>
                      <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 700 }}>● In Stock</span>
                    </div>

                    <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                      {p.name}
                    </h3>
                    <p style={{ color: '#64748b', fontSize: '14px', lineHeight: 1.5, marginBottom: '20px' }}>
                      {p.description}
                    </p>
                  </div>

                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        paddingTop: '16px',
                        borderTop: '1px solid #f1f5f9'
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Price</span>
                        <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
                          ${(p.priceCents / 100).toFixed(2)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setSelectedProduct(p)}
                          style={{
                            padding: '9px 14px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            color: '#334155',
                            fontSize: '13px',
                            fontWeight: 600
                          }}
                        >
                          Details
                        </button>
                        <button
                          onClick={() => addToCart(p)}
                          style={{
                            padding: '9px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            background: '#2563eb',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: '13px'
                          }}
                        >
                          Add to Cart 🛒
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: SAGA CHECKOUT & ORDERS */}
        {/* ================================================================= */}
        {activeTab === 'orders' && (
          <div>
            <div style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                Distributed Order Management & Saga Visualizer
              </h2>
              <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
                Observe state machine transitions across Order, Inventory, Payment, and Notification microservices.
              </p>
            </div>

            {/* Saga Pipeline Card */}
            {sagaStep > 0 && (
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '16px',
                  padding: '24px',
                  marginBottom: '32px',
                  boxShadow: '0 8px 20px -4px rgba(37, 99, 235, 0.08)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#1e3a8a', margin: 0 }}>
                    ⚡ Real-Time Choreographed Saga Pipeline
                  </h3>
                  <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>
                    Order ID: {latestSagaOrder?.id}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      background: sagaStep >= 1 ? '#eff6ff' : '#f8fafc',
                      border: `2px solid ${sagaStep >= 1 ? '#3b82f6' : '#e2e8f0'}`
                    }}
                  >
                    <div style={{ fontSize: '18px' }}>📝</div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: sagaStep >= 1 ? '#1e40af' : '#64748b', marginTop: '4px' }}>
                      1. Order Created
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      Order Service: PENDING
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      background: sagaStep >= 2 ? '#eff6ff' : '#f8fafc',
                      border: `2px solid ${sagaStep >= 2 ? '#3b82f6' : '#e2e8f0'}`
                    }}
                  >
                    <div style={{ fontSize: '18px' }}>📦</div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: sagaStep >= 2 ? '#1e40af' : '#64748b', marginTop: '4px' }}>
                      2. Stock Reserved
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      Inventory Service: ROW LOCKED
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      background: sagaStep >= 3 ? '#eff6ff' : '#f8fafc',
                      border: `2px solid ${sagaStep >= 3 ? '#3b82f6' : '#e2e8f0'}`
                    }}
                  >
                    <div style={{ fontSize: '18px' }}>💳</div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: sagaStep >= 3 ? '#1e40af' : '#64748b', marginTop: '4px' }}>
                      3. Payment Settled
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      Payment Service: IDEMPOTENT
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      background: sagaStep >= 4 ? '#ecfdf5' : '#f8fafc',
                      border: `2px solid ${sagaStep >= 4 ? '#10b981' : '#e2e8f0'}`
                    }}
                  >
                    <div style={{ fontSize: '18px' }}>📬</div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: sagaStep >= 4 ? '#065f46' : '#64748b', marginTop: '4px' }}>
                      4. Confirmed & Logged
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      Notification Service: AUDITED
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Orders Table */}
            <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '18px 24px', borderBottom: '1px solid #f1f5f9', fontWeight: 800, fontSize: '16px' }}>
                Customer Orders ({orders.length})
              </div>

              {orders.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>🛍️</div>
                  <div style={{ fontWeight: 700 }}>No orders recorded for this account</div>
                  <div style={{ fontSize: '13px', marginTop: '4px' }}>Add items to your cart and checkout to test the Saga.</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Order ID</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Date</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Total</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Status</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '14px 24px', fontFamily: 'monospace', color: '#2563eb', fontWeight: 700 }}>
                            {o.id.substring(0, 18)}...
                          </td>
                          <td style={{ padding: '14px 24px', color: '#64748b' }}>
                            {new Date(o.created_at).toLocaleString()}
                          </td>
                          <td style={{ padding: '14px 24px', fontWeight: 800, color: '#0f172a' }}>
                            ${(o.total_cents / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '14px 24px' }}>
                            <span
                              style={{
                                padding: '4px 10px',
                                borderRadius: '12px',
                                fontSize: '12px',
                                fontWeight: 700,
                                background:
                                  o.status === 'CONFIRMED' ? '#ecfdf5' : o.status === 'PENDING' ? '#fffbeb' : '#fef2f2',
                                color:
                                  o.status === 'CONFIRMED' ? '#065f46' : o.status === 'PENDING' ? '#92400e' : '#991b1b'
                              }}
                            >
                              {o.status}
                            </span>
                          </td>
                          <td style={{ padding: '14px 24px' }}>
                            <button
                              onClick={() => setSelectedOrder(o)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                background: '#fff',
                                fontSize: '12px',
                                fontWeight: 600
                              }}
                            >
                              View Invoice
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: CUSTOMER PROFILE (User Service) */}
        {/* ================================================================= */}
        {activeTab === 'profile' && (
          <div style={{ maxWidth: '680px' }}>
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                Customer Profile & Addresses
              </h2>
              <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
                Decoupled profile management backed by the dedicated User Service (`ecommerce_user`).
              </p>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '28px' }}>
              <form onSubmit={handleUpdateProfile}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                      First Name
                    </label>
                    <input
                      type="text"
                      value={profile.firstName}
                      onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={profile.lastName}
                      onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={profile.shippingAddress.street}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        shippingAddress: { ...profile.shippingAddress, street: e.target.value }
                      })
                    }
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>City</label>
                    <input
                      type="text"
                      value={profile.shippingAddress.city}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          shippingAddress: { ...profile.shippingAddress, city: e.target.value }
                        })
                      }
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Country</label>
                    <input
                      type="text"
                      value={profile.shippingAddress.country}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          shippingAddress: { ...profile.shippingAddress, country: e.target.value }
                        })
                      }
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Zip</label>
                    <input
                      type="text"
                      value={profile.shippingAddress.zip}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          shippingAddress: { ...profile.shippingAddress, zip: e.target.value }
                        })
                      }
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  style={{
                    padding: '12px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#2563eb',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '14px'
                  }}
                >
                  Save Profile Changes
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 4: NOTIFICATION AUDIT LOG (Notification Service) */}
        {/* ================================================================= */}
        {activeTab === 'notifications' && (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                Simulated Email Inbox & Domain Event Logs
              </h2>
              <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
                Captured asynchronously by the Notification Service (`ecommerce_notification`) from RabbitMQ topic exchanges.
              </p>
            </div>

            <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '18px 24px', borderBottom: '1px solid #f1f5f9', fontWeight: 800, fontSize: '16px' }}>
                Transactional Notifications ({notifications.length})
              </div>

              {notifications.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>📬</div>
                  <div style={{ fontWeight: 700 }}>No event notifications logged yet</div>
                  <div style={{ fontSize: '13px', marginTop: '4px' }}>Events arrive here when orders or payments execute.</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Event Type</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Recipient</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Timestamp</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Correlation ID</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notifications.map((n) => (
                        <tr key={n.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '14px 24px', fontWeight: 700, color: '#2563eb' }}>
                            {n.notification_type}
                          </td>
                          <td style={{ padding: '14px 24px', color: '#334155' }}>
                            {n.recipient_email}
                          </td>
                          <td style={{ padding: '14px 24px', color: '#64748b' }}>
                            {new Date(n.sent_at).toLocaleTimeString()}
                          </td>
                          <td style={{ padding: '14px 24px', fontFamily: 'monospace', color: '#94a3b8', fontSize: '12px' }}>
                            {n.correlation_id ? n.correlation_id.substring(0, 16) + '...' : 'system'}
                          </td>
                          <td style={{ padding: '14px 24px' }}>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 700,
                                background: '#ecfdf5',
                                color: '#065f46'
                              }}
                            >
                              DELIVERED
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 5: ARCHITECTURE & TECH STACK MAP */}
        {/* ================================================================= */}
        {activeTab === 'techmap' && (
          <div>
            <div style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                Complete Technology Stack & Codebase Map
              </h2>
              <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
                Here is exactly where every single enterprise technology lives and operates in this repository.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
              {[
                {
                  tech: 'React 18 + TypeScript + Vite',
                  layer: 'Frontend Single Page Application',
                  location: 'frontend/',
                  purpose: 'Modern responsive client UI, shopping cart, customer auth, and Saga visualization.',
                  icon: '⚛️'
                },
                {
                  tech: 'NGINX Alpine',
                  layer: 'Static Web Server',
                  location: 'frontend/Dockerfile',
                  purpose: 'Serves production compiled React assets on port 3000 with gzip compression.',
                  icon: '🌐'
                },
                {
                  tech: 'Node.js 20 & TypeScript',
                  layer: 'Backend Microservices Runtime',
                  location: 'services/*/',
                  purpose: 'Executes all 8 microservices with strict TypeScript contracts and fast async I/O.',
                  icon: '🟢'
                },
                {
                  tech: 'Express & http-proxy-middleware',
                  layer: 'API Gateway & Ingress Proxy',
                  location: 'services/api-gateway/',
                  purpose: 'Central port 8000 entry point, route forwarding, correlation IDs, and circuit breaking.',
                  icon: '🚪'
                },
                {
                  tech: 'Redis 7 (In-Memory RESP)',
                  layer: 'Distributed Caching & Rate Limiting',
                  location: 'docker-compose.yml (Port 6379)',
                  purpose: 'Token-bucket rate limiting at API Gateway & catalog caching in Product Service.',
                  icon: '⚡'
                },
                {
                  tech: 'PostgreSQL 16 (Logical Isolation)',
                  layer: 'ACID Relational Storage',
                  location: 'docker/init-scripts/01-init-databases.sql',
                  purpose: 'Owns 7 isolated databases (auth, user, product, inventory, order, payment, notification).',
                  icon: '🐘'
                },
                {
                  tech: 'RabbitMQ 3 (AMQP Topic Broker)',
                  layer: 'Asynchronous Event Bus',
                  location: 'docker-compose.yml (Ports 5672, 15672)',
                  purpose: 'Choreographed Saga: order.created, inventory.reserved, payment.succeeded, payment.failed.',
                  icon: '🐇'
                },
                {
                  tech: 'Argon2 / scrypt + JWT Rotation',
                  layer: 'Application Security & RBAC',
                  location: 'services/auth-service/',
                  purpose: 'Cryptographic password hashing and Refresh Token Rotation (RTR) against token theft.',
                  icon: '🔐'
                },
                {
                  tech: 'Multi-Stage Docker Builds',
                  layer: 'Containerization',
                  location: 'services/*/Dockerfile',
                  purpose: 'Builder vs Runner stages, lean Alpine base images (<120MB), and non-root USER node.',
                  icon: '🐳'
                },
                {
                  tech: 'Docker Compose Networking',
                  layer: 'Local Orchestration',
                  location: 'docker-compose.yml',
                  purpose: 'Isolates internal services on ecommerce-internal-net, exposing only Gateway & Frontend.',
                  icon: '🐙'
                },
                {
                  tech: 'Structured JSON Logging',
                  layer: 'Observability & SRE',
                  location: 'shared/logger/',
                  purpose: 'Attaches x-correlation-id across HTTP requests, RabbitMQ messages, and log streams.',
                  icon: '📊'
                },
                {
                  tech: 'Terraform & Helm (Upcoming)',
                  layer: 'Cloud & Infrastructure as Code',
                  location: 'terraform/ & helm/',
                  purpose: 'Provisions AWS Mumbai (ap-south-1) VPC, EKS, RDS, and packages charts for Kubernetes.',
                  icon: '☁️'
                }
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '22px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '24px' }}>{item.icon}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>{item.tech}</div>
                      <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: 600 }}>{item.layer}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace', marginBottom: '8px' }}>
                    📁 {item.location}
                  </div>
                  <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.4 }}>{item.purpose}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '500px',
              width: '100%',
              padding: '28px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span
                style={{
                  background: '#eff6ff',
                  color: '#2563eb',
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: '6px'
                }}
              >
                {selectedProduct.categoryName || 'Curriculum'}
              </span>
              <button
                onClick={() => setSelectedProduct(null)}
                style={{ background: 'none', border: 'none', fontSize: '18px', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginBottom: '10px' }}>
              {selectedProduct.name}
            </h3>
            <p style={{ color: '#64748b', fontSize: '14px', lineHeight: 1.5, marginBottom: '20px' }}>
              {selectedProduct.description}
            </p>

            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Product UUID:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedProduct.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Inventory Stock:</span>
                <span style={{ color: '#10b981', fontWeight: 700 }}>500 units available</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: '#64748b' }}>Price:</span>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>
                  ${(selectedProduct.priceCents / 100).toFixed(2)} USD
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => {
                  addToCart(selectedProduct);
                  setSelectedProduct(null);
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '14px'
                }}
              >
                Add to Cart 🛒
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {isCartOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'flex-end'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '440px',
              background: '#ffffff',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-4px 0 25px rgba(0,0,0,0.15)'
            }}
          >
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Your Cart ({cart.length})</h3>
              <button
                onClick={() => setIsCartOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '60px' }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>🛒</div>
                  <div style={{ fontWeight: 600 }}>Your cart is empty</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {cart.map((item) => (
                    <div
                      key={item.product.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px',
                        background: '#f8fafc',
                        borderRadius: '8px'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{item.product.name}</div>
                        <div style={{ fontSize: '13px', color: '#64748b' }}>
                          ${(item.product.priceCents / 100).toFixed(2)} each
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          onClick={() => updateQuantity(item.product.id, -1)}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            fontWeight: 700
                          }}
                        >
                          -
                        </button>
                        <span style={{ fontWeight: 700, fontSize: '14px', minWidth: '20px', textAlign: 'center' }}>
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.product.id, 1)}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            fontWeight: 700
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Shipping address recap */}
                  <div style={{ marginTop: '16px', padding: '14px', background: '#eff6ff', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e40af', marginBottom: '4px' }}>
                      📍 Delivery Destination
                    </div>
                    <div style={{ fontSize: '13px', color: '#334155' }}>
                      {shippingAddress.street}, {shippingAddress.city}, {shippingAddress.country}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div style={{ padding: '24px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 600, color: '#64748b' }}>Total (USD)</span>
                  <span style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
                    ${(cartTotalCents / 100).toFixed(2)}
                  </span>
                </div>
                <button
                  onClick={handleCheckout}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#2563eb',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '15px'
                  }}
                >
                  Confirm & Checkout Order 💳
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '540px',
              width: '100%',
              padding: '28px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Order Invoice Breakdown
              </h3>
              <button
                onClick={() => setSelectedOrder(null)}
                style={{ background: 'none', border: 'none', fontSize: '18px', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '10px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Order UUID:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedOrder.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Status:</span>
                <span style={{ fontWeight: 800, color: selectedOrder.status === 'CONFIRMED' ? '#059669' : '#d97706' }}>
                  {selectedOrder.status}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Idempotency Key:</span>
                <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{selectedOrder.idempotency_key}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: '#64748b' }}>Total Billed:</span>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>
                  ${(selectedOrder.total_cents / 100).toFixed(2)} USD
                </span>
              </div>
            </div>

            <button
              onClick={() => setSelectedOrder(null)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 700
              }}
            >
              Close Invoice
            </button>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '440px',
              padding: '32px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
                {authMode === 'login' ? 'Sign in to Account' : 'Create Customer Account'}
              </div>
              <button
                onClick={() => setIsAuthModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={authMode === 'login' ? handleLogin : handleRegister}>
              {authMode === 'register' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                      First Name
                    </label>
                    <input
                      type="text"
                      value={authFirstName}
                      onChange={(e) => setAuthFirstName(e.target.value)}
                      required
                      placeholder="DevOps"
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={authLastName}
                      onChange={(e) => setAuthLastName(e.target.value)}
                      required
                      placeholder="Engineer"
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                  placeholder="engineer@enterprise.example"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Password
                </label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '15px'
                }}
              >
                {authMode === 'login' ? 'Sign In' : 'Complete Registration'}
              </button>
            </form>

            <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13px', color: '#64748b' }}>
              {authMode === 'login' ? (
                <>
                  Don't have an account?{' '}
                  <button
                    onClick={() => setAuthMode('register')}
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 700 }}
                  >
                    Register here
                  </button>
                </>
              ) : (
                <>
                  Already registered?{' '}
                  <button
                    onClick={() => setAuthMode('login')}
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 700 }}
                  >
                    Sign in here
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
