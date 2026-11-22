import React, { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  priceCents: number;
  description: string;
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [orderStatus, setOrderStatus] = useState<string | null>(null);

  const API_URL = 'http://localhost:8000/api/v1';

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_URL}/products`);
      const json = await res.json();
      if (json.success) {
        setProducts(json.data);
      }
    } catch {
      setStatusMessage('API Gateway is unreachable or initializing...');
    }
  };

  const handleRegister = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName: 'DevOps', lastName: 'Learner' })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage(`Registered successfully: ${data.data.email}. Now click Login.`);
      } else {
        setStatusMessage(`Registration error: ${data.error.message}`);
      }
    } catch (err: any) {
      setStatusMessage(`Network error: ${err.message}`);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success) {
        setToken(data.data.accessToken);
        setStatusMessage('Logged in successfully! JWT Access token saved.');
      } else {
        setStatusMessage(`Login failed: ${data.error.message}`);
      }
    } catch (err: any) {
      setStatusMessage(`Network error: ${err.message}`);
    }
  };

  const handlePlaceOrder = async (productId: string) => {
    if (!token) {
      setStatusMessage('Please login first to place an order.');
      return;
    }

    try {
      setStatusMessage('Submitting order through API Gateway...');
      const res = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'idempotency-key': crypto.randomUUID()
        },
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] })
      });
      const data = await res.json();
      if (data.success) {
        setOrderStatus(`Order Created: ${data.data.id} (Status: ${data.data.status})`);
        setStatusMessage('Order submitted! The Choreographed Saga is processing the checkout asynchronously.');
      } else {
        setStatusMessage(`Order error: ${data.error.message}`);
      }
    } catch (err: any) {
      setStatusMessage(`Order submission failed: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      <header style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '16px', marginBottom: '24px' }}>
        <h1 style={{ color: '#1e3a8a', margin: 0 }}>Enterprise E-Commerce Platform</h1>
        <p style={{ color: '#64748b', margin: '4px 0 0 0' }}>Microservices & Production-Grade DevOps Architecture</p>
      </header>

      {statusMessage && (
        <div style={{ padding: '12px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', marginBottom: '20px', color: '#1e40af' }}>
          {statusMessage}
        </div>
      )}

      {/* Authentication Card */}
      <section style={{ background: '#ffffff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', marginTop: 0 }}>Customer Authentication</h2>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <input
            type="email"
            placeholder="Email (e.g. devops@company.com)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', minWidth: '240px' }}
          />
          <input
            type="password"
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', minWidth: '200px' }}
          />
          <button onClick={handleRegister} style={{ padding: '8px 16px', background: '#475569', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Register
          </button>
          <button onClick={handleLogin} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Login
          </button>
        </div>
        {token && <p style={{ fontSize: '12px', color: '#16a34a', marginTop: '10px' }}>Active JWT Token: {token.substring(0, 40)}...</p>}
      </section>

      {/* Products & Order Flow */}
      <section style={{ background: '#ffffff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '18px', marginTop: 0 }}>Product Catalog (Redis Cached)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>Enterprise Cloud Architecture Course</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 12px 0' }}>Deep dive into AWS, Kubernetes, Terraform, and Microservices.</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', fontSize: '16px' }}>$49.99</span>
              <button
                onClick={() => handlePlaceOrder('a0000000-0000-0000-0000-000000000001')}
                style={{ padding: '6px 14px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Checkout Item
              </button>
            </div>
          </div>
        </div>
        {orderStatus && <p style={{ marginTop: '16px', fontWeight: 'bold', color: '#047857' }}>{orderStatus}</p>}
      </section>
    </div>
  );
}
