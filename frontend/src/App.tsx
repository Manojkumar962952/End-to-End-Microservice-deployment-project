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
}

const API_URL = 'http://localhost:8000/api/v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<'catalog' | 'orders' | 'architecture'>('catalog');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('jwt_token'));
  const [currentUser, setCurrentUser] = useState<{ email: string; userId: string; role: string } | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authFirstName, setAuthFirstName] = useState('');
  const [authLastName, setAuthLastName] = useState('');

  // Orders state
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [latestOrder, setLatestOrder] = useState<OrderItem | null>(null);
  const [sagaStep, setSagaStep] = useState<number>(0);

  // Toast / Status state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<'connected' | 'offline' | 'checking'>('checking');

  useEffect(() => {
    checkGatewayHealth();
    fetchProducts();
    if (token) {
      decodeToken(token);
      fetchOrders(token);
    }
  }, []);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  const decodeToken = (jwtString: string) => {
    try {
      const payloadBase64 = jwtString.split('.')[1];
      const decodedJson = JSON.parse(atob(payloadBase64));
      setCurrentUser({
        email: decodedJson.email || 'customer@enterprise.example',
        userId: decodedJson.userId || '',
        role: decodedJson.role || 'CUSTOMER'
      });
    } catch {
      // Fallback
    }
  };

  const checkGatewayHealth = async () => {
    try {
      const res = await fetch('http://localhost:8000/health/live');
      if (res.ok) {
        setGatewayStatus('connected');
      } else {
        setGatewayStatus('offline');
      }
    } catch {
      setGatewayStatus('offline');
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_URL}/products`);
      const json = await res.json();
      if (json.success && json.data.length > 0) {
        setProducts(json.data);
      } else {
        // Fallback demo catalog if database table was not seeded yet
        setProducts([
          {
            id: 'a0000000-0000-0000-0000-000000000001',
            name: 'Enterprise Cloud Architecture Masterclass',
            slug: 'cloud-masterclass',
            priceCents: 4999,
            description: 'Hands-on production AWS, Kubernetes, Terraform & Microservices',
            categoryName: 'Cloud & DevOps',
            isActive: true
          },
          {
            id: 'a0000000-0000-0000-0000-000000000002',
            name: 'Kubernetes Security & Hardening Guide',
            slug: 'k8s-security',
            priceCents: 2999,
            description: 'Production pod security standards, RBAC, NetworkPolicies and CIS benchmarks',
            categoryName: 'Security',
            isActive: true
          },
          {
            id: 'a0000000-0000-0000-0000-000000000003',
            name: 'Site Reliability Engineering Handbook',
            slug: 'sre-handbook',
            priceCents: 3499,
            description: '4 Golden Signals, Prometheus metrics, distributed tracing and incident drills',
            categoryName: 'SRE & Monitoring',
            isActive: true
          }
        ]);
      }
    } catch {
      showToast('Could not reach API Gateway on port 8000', 'error');
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
          lastName: authLastName || 'Engineer'
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Account registered! Please sign in with your credentials.', 'success');
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
        setIsAuthModalOpen(false);
        showToast('Welcome back! Authenticated with JWT session.', 'success');
      } else {
        showToast(data.error?.message || 'Invalid email or password', 'error');
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
        setLatestOrder(json.data);
        setCart([]);
        showToast('Order received! Choreographed Saga triggered on RabbitMQ.', 'success');

        // Simulate real-time progress steps as RabbitMQ consumers process
        setTimeout(() => setSagaStep(2), 700);
        setTimeout(() => setSagaStep(3), 1500);
        setTimeout(() => {
          setSagaStep(4);
          fetchOrders(token);
        }, 2200);
      } else {
        setSagaStep(0);
        showToast(json.error?.message || 'Checkout failed', 'error');
      }
    } catch (err: any) {
      setSagaStep(0);
      showToast(`Network error during checkout: ${err.message}`, 'error');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Toast Notification */}
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
            fontWeight: 500,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2)',
            backgroundColor:
              toast.type === 'success' ? '#059669' : toast.type === 'error' ? '#dc2626' : '#2563eb',
            animation: 'slideIn 0.3s ease-out'
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

      {/* Enterprise Top Navbar */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
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
          {/* Logo & Branding */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 800,
                fontSize: '20px'
              }}
            >
              ☁️
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '18px', color: '#0f172a', letterSpacing: '-0.5px' }}>
                Enterprise Platform
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                Microservices • DevOps • Kubernetes • AWS
              </div>
            </div>
          </div>

          {/* Infrastructure Health Telemetry Pills */}
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
              Gateway :8000 {gatewayStatus === 'connected' ? 'LIVE' : 'DOWN'}
            </div>
            <div
              style={{
                background: '#f1f5f9',
                color: '#475569',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              🐘 Postgres 16
            </div>
            <div
              style={{
                background: '#f1f5f9',
                color: '#475569',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              ⚡ Redis 7
            </div>
            <div
              style={{
                background: '#f1f5f9',
                color: '#475569',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              🐇 RabbitMQ 3
            </div>
          </div>

          {/* User & Cart Controls */}
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

            {/* Shopping Cart Pill Button */}
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
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px', display: 'flex', gap: '24px' }}>
          <button
            onClick={() => setActiveTab('catalog')}
            style={{
              padding: '12px 4px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 700,
              color: activeTab === 'catalog' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'catalog' ? '3px solid #2563eb' : '3px solid transparent'
            }}
          >
            📦 Product Catalog
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            style={{
              padding: '12px 4px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 700,
              color: activeTab === 'orders' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'orders' ? '3px solid #2563eb' : '3px solid transparent'
            }}
          >
            🔄 Saga Checkout & Orders ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            style={{
              padding: '12px 4px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 700,
              color: activeTab === 'architecture' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'architecture' ? '3px solid #2563eb' : '3px solid transparent'
            }}
          >
            🌐 Microservices Architecture Map
          </button>
        </div>
      </header>

      {/* Main Body Content */}
      <main style={{ flex: 1, maxWidth: '1280px', margin: '0 auto', width: '100%', padding: '32px 24px' }}>
        {/* ================================================================= */}
        {/* TAB 1: PRODUCT CATALOG */}
        {/* ================================================================= */}
        {activeTab === 'catalog' && (
          <div>
            <div style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                Enterprise Product Catalog
              </h2>
              <p style={{ color: '#64748b', fontSize: '15px', marginTop: '4px' }}>
                High-volume, cache-accelerated catalog backed by PostgreSQL 16 & Redis read-through cache.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                gap: '24px'
              }}
            >
              {products.map((p) => (
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
                    justifyContent: 'space-between',
                    transition: 'transform 0.2s, box-shadow 0.2s'
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
                        <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Price</span>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
                          ${(p.priceCents / 100).toFixed(2)}
                        </div>
                      </div>

                      <button
                        onClick={() => addToCart(p)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 18px',
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
              <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                Distributed Saga Pipeline & Order History
              </h2>
              <p style={{ color: '#64748b', fontSize: '15px', marginTop: '4px' }}>
                Observe the asynchronous event-driven choreography across Order, Inventory, Payment, and Notification services.
              </p>
            </div>

            {/* Live Saga Visualizer Card */}
            {sagaStep > 0 && (
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '16px',
                  padding: '28px',
                  marginBottom: '36px',
                  boxShadow: '0 10px 25px -5px rgba(37, 99, 235, 0.08)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1e3a8a', margin: 0 }}>
                    ⚡ Real-Time Choreographed Saga Execution
                  </h3>
                  <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>
                    Correlation ID: {latestOrder?.idempotency_key}
                  </span>
                </div>

                {/* 4 Pipeline Stages */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', position: 'relative' }}>
                  {/* Step 1: Order Service */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '10px',
                      background: sagaStep >= 1 ? '#eff6ff' : '#f8fafc',
                      border: `2px solid ${sagaStep >= 1 ? '#3b82f6' : '#e2e8f0'}`,
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <div style={{ fontSize: '20px', marginBottom: '8px' }}>📝</div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: sagaStep >= 1 ? '#1e40af' : '#64748b' }}>
                      1. Order Created
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                      Order Service published `order.created` event
                    </div>
                  </div>

                  {/* Step 2: Inventory Service */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '10px',
                      background: sagaStep >= 2 ? '#eff6ff' : '#f8fafc',
                      border: `2px solid ${sagaStep >= 2 ? '#3b82f6' : '#e2e8f0'}`,
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <div style={{ fontSize: '20px', marginBottom: '8px' }}>📦</div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: sagaStep >= 2 ? '#1e40af' : '#64748b' }}>
                      2. Stock Reserved
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                      Inventory row-level locked via `SELECT FOR UPDATE`
                    </div>
                  </div>

                  {/* Step 3: Payment Service */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '10px',
                      background: sagaStep >= 3 ? '#eff6ff' : '#f8fafc',
                      border: `2px solid ${sagaStep >= 3 ? '#3b82f6' : '#e2e8f0'}`,
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <div style={{ fontSize: '20px', marginBottom: '8px' }}>💳</div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: sagaStep >= 3 ? '#1e40af' : '#64748b' }}>
                      3. Payment Settled
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                      Idempotent simulation emitted `payment.succeeded`
                    </div>
                  </div>

                  {/* Step 4: Notification Service */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '10px',
                      background: sagaStep >= 4 ? '#ecfdf5' : '#f8fafc',
                      border: `2px solid ${sagaStep >= 4 ? '#10b981' : '#e2e8f0'}`,
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <div style={{ fontSize: '20px', marginBottom: '8px' }}>📬</div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: sagaStep >= 4 ? '#065f46' : '#64748b' }}>
                      4. Order Confirmed
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                      Notification logged & order marked `CONFIRMED`
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Customer Orders Table */}
            <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', fontWeight: 800, fontSize: '16px' }}>
                Your Transaction History
              </div>

              {orders.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
                  <div style={{ fontSize: '36px', marginBottom: '12px' }}>🛍️</div>
                  <div style={{ fontWeight: 600, fontSize: '16px' }}>No orders placed yet</div>
                  <div style={{ fontSize: '14px', marginTop: '4px' }}>
                    Select an item from the catalog and checkout to test the Saga choreography.
                  </div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Order ID</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Date</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Amount</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Status</th>
                        <th style={{ padding: '14px 24px', fontWeight: 700 }}>Idempotency Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '14px 24px', fontFamily: 'monospace', color: '#2563eb', fontWeight: 600 }}>
                            {o.id.substring(0, 18)}...
                          </td>
                          <td style={{ padding: '14px 24px', color: '#64748b' }}>
                            {new Date(o.created_at).toLocaleString()}
                          </td>
                          <td style={{ padding: '14px 24px', fontWeight: 700, color: '#0f172a' }}>
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
                          <td style={{ padding: '14px 24px', fontFamily: 'monospace', color: '#94a3b8', fontSize: '12px' }}>
                            {o.idempotency_key.substring(0, 16)}...
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
        {/* TAB 3: MICROSERVICES ARCHITECTURE MAP */}
        {/* ================================================================= */}
        {activeTab === 'architecture' && (
          <div>
            <div style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                System Topology & Service Discovery
              </h2>
              <p style={{ color: '#64748b', fontSize: '15px', marginTop: '4px' }}>
                All 8 microservices run in isolated containers with private DNS resolution over internal Docker networks.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {[
                { name: 'API Gateway', port: '8000', network: 'Public & Internal', role: 'Reverse Proxy & Rate Limiter' },
                { name: 'Auth Service', port: '5001', network: 'Internal Net', role: 'Argon2/scrypt, JWT Rotation' },
                { name: 'User Service', port: '5002', network: 'Internal Net', role: 'Profile & Address Management' },
                { name: 'Product Service', port: '5003', network: 'Internal Net', role: 'Catalog & Redis Caching' },
                { name: 'Order Service', port: '5004', network: 'Internal Net', role: 'Saga Coordinator & State Machine' },
                { name: 'Payment Service', port: '5005', network: 'Internal Net', role: 'Idempotency & Settlement' },
                { name: 'Inventory Service', port: '5006', network: 'Internal Net', role: 'Atomic Stock Reservation' },
                { name: 'Notification Service', port: '5007', network: 'Internal Net', role: 'AMQP Domain Event Consumer' },
                { name: 'PostgreSQL 16', port: '5432', network: 'Internal Net', role: '7 Isolated Database Schemas' },
                { name: 'Redis 7', port: '6379', network: 'Internal Net', role: 'In-Memory Cache & Token Bucket' },
                { name: 'RabbitMQ 3', port: '5672/15672', network: 'Internal Net', role: 'Topic Message Broker' },
                { name: 'React SPA', port: '3000', network: 'Public Net', role: 'Frontend Single Page Application' }
              ].map((svc, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '20px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '16px', color: '#0f172a' }}>{svc.name}</span>
                    <span
                      style={{
                        background: '#ecfdf5',
                        color: '#065f46',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '10px'
                      }}
                    >
                      Port {svc.port}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#2563eb', fontWeight: 600, marginBottom: '6px' }}>
                    Network: {svc.network}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>{svc.role}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Cart Drawer */}
      {isCartOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'flex-end',
            animation: 'fadeIn 0.2s'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
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
                      placeholder="Jane"
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
                      placeholder="Doe"
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
                  placeholder="name@company.com"
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
