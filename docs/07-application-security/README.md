# Chapter 07: Application Security & OWASP Top 10 Hardening

```
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                    DEFENSE-IN-DEPTH SECURITY MODEL                                      |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
| [Layer 1: Network Perimeter]  -> Host Port Filtering, Reverse Proxy Ingress, WAF (AWS Cloud)          |
| [Layer 2: Gateway Edge]       -> Helmet Headers, Rate Limiting, Payload Limits, CORS, Header Scrubbing |
| [Layer 3: Authentication]     -> Argon2/scrypt Memory-Hard Hashing, JWT Rotation, Replay Detection       |
| [Layer 4: Data Validation]    -> Zod Schema Validation, Strong Typing, SQL Injection Parameterization   |
| [Layer 5: Container Security] -> Non-Root Execution (`USER node`), Read-Only FS, Minimal Base Images  |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Application Security is the discipline of designing, implementing, and verifying security defenses across the entire application stack to protect user data, software logic, and computational resources from unauthorized access, modification, or denial-of-service threats throughout the Software Development Lifecycle (SDLC).

---

## 2. Why Do Companies Use It?
- **Financial & Regulatory Penalties**: Data breaches violate GDPR, HIPAA, and PCI-DSS, triggering fines reaching millions of dollars.
- **Customer Trust & Brand Value**: Account takeovers, leaked credentials, or fraudulent credit card charges destroy brand valuation.
- **Supply Chain Protection**: Protects against malicious open-source dependency injection and zero-day vulnerabilities in container base images.

---

## 3. What Problem Does It Solve? (OWASP Top 10 Mitigations)

| OWASP Vulnerability | Attack Vector | Project Implementation Defense |
| :--- | :--- | :--- |
| **A01: Broken Access Control** | Modifying URL `/orders/:id` to read another user's invoice. | Database queries strictly enforce `WHERE id = $1 AND customer_id = $2`. |
| **A02: Cryptographic Failures** | Storing plaintext passwords cracked via rainbow tables. | Passwords hashed using **memory-hard key derivation (`crypto.scrypt`)** with unique cryptographically random salts. |
| **A03: Injection (SQLi / XSS)** | Attacker inputs `admin' OR 1=1; --` in email field. | **Parameterized queries (`$1, $2`)** via `pg` library; direct string concatenation is forbidden. |
| **A04: Insecure Design** | Flash-sale bot drains inventory in 100 milliseconds. | **Redis Token-Bucket Rate Limiter** on Gateway + **Idempotency Keys** on checkout. |
| **A05: Security Misconfiguration** | Containers running as `root` or verbose stack traces leaked. | Non-root **`USER node`** runtime execution and standardized sanitized error envelopes. |
| **A07: Identification & Auth Failures** | Long-lived stolen JWT allows indefinite account takeover. | **Short-lived JWT Access Tokens (15 min)** with **Refresh Token Rotation (RTR)**. Token theft revokes the entire family. |

---

## 4. How Does It Work Internally?
1. **Refresh Token Rotation (RTR) & Replay Attack Defense**:
   - Customer logs in $\rightarrow$ receives a 15-minute Access Token and a 7-day Refresh Token bound to a `family_id`.
   - When renewing, client sends the Refresh Token.
   - If the token is valid $\rightarrow$ it is invalidated (`is_revoked = true`) and a brand new token is issued in that family.
   - **Collision Detection**: If an attacker attempts to use an already revoked token, the system detects a token replay attack and immediately **revokes all tokens in that `family_id`**, logging out the legitimate customer and terminating the stolen session.
2. **Parameterized Database Execution**:
   - PostgreSQL separates SQL query compilation from user data. `$1` is treated purely as a data literal, making it mathematically impossible for input strings to alter query syntax.

---

## 5. Where Does It Fit in Our Architecture?
- **API Gateway Edge**: Helmet security headers, CORS whitelisting, Redis token-bucket rate limiting.
- **Auth Service**: scrypt password derivation, Refresh Token Rotation.
- **Microservices**: Parameterized SQL, role checks (`x-user-role`), IDOR authorization.
- **Dockerfiles**: Minimal Alpine Linux bases and unprivileged `USER node` (UID 1000).

---

## 6. How We Implemented It in This Project
### Zod Schema Validation & Parameterized Queries:
```typescript
// shared/contracts/src/dtos.ts
export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  firstName: z.string().min(1),
  lastName: z.string().min(1)
});

// services/auth-service/src/services/auth.service.ts
const result = await pool.query(
  'SELECT id, password_hash, salt, role FROM users_auth WHERE email = $1',
  [email.toLowerCase()]
);
```

---

## 7. Configuration Examples
### Helmet HTTP Security Headers in Express:
```typescript
// services/api-gateway/src/index.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true
}));
```

---

## 8. Commands
```powershell
# Run automated security test suite covering SQLi, rate limits, and JWT tampering
powershell -ExecutionPolicy Bypass -File .\scripts\security-test.ps1

# Audit npm dependencies for known high/critical CVEs
npm audit --workspaces --audit-level=high

# Run Semgrep SAST across application codebase
npx semgrep --config=auto .
```

---

## 9. Verification
```powershell
# 1. Verify container non-root execution (Must output UID 1000 / node)
docker compose exec auth-service id

# 2. Verify SQL injection immunity
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/auth/login" -Method Post `
  -Body '{"email":"admin@example.com'' OR ''1''=''1","password":"test"}' `
  -ContentType "application/json" -ErrorAction SilentlyContinue

# 3. Verify security response headers
curl -I http://localhost:8000/health/live
```

---

## 10. Common Mistakes
1. **String Interpolation in SQL Queries**: Using string template literals (``SELECT * FROM users WHERE email = '${email}'``) instead of parameterized arrays (`$1, [email]`).
2. **Storing Plaintext or MD5 Passwords**: Using fast general-purpose hashing functions (MD5, SHA-256) instead of memory-hard key derivation functions (`scrypt`, `Argon2id`, `bcrypt`).
3. **Trusting Client Headers**: Believing user claims like `req.headers['x-user-id']` from incoming public internet requests without gateway verification and header scrubbing.

---

## 11. Troubleshooting
- **Legitimate Users Blocked by Rate Limiter**: Redis rate limit threshold set too low for high-activity pages. Increase bucket capacity or allow higher thresholds for authenticated session tokens.
- **CORS Errors in Browser**: Browser blocks API requests with `Access to XMLHttpRequest has been blocked by CORS policy`. Verify API Gateway CORS middleware allows the frontend origin (`http://localhost:3000`).

---

## 12. Security Best Practices
- **Never Commit Secrets to Git**: Enforce Gitleaks pre-commit hooks to block keys from entering version control.
- **Least Privilege Database Credentials**: Microservices must never share database accounts or connect with superuser privileges.
- **Automated Container Scanning in CI**: Block deployments with Trivy if high/critical container CVEs are detected.

---

## 13. Real-World Use Cases
- **Equifax Data Breach**: Unpatched Apache Struts vulnerability (CVE-2017-5638) allowed remote attackers to execute commands as root. Running containers as non-root and continuous SCA dependency scanning would have neutralized the vector.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is Refresh Token Rotation (RTR) and how does it prevent token replay attacks?
**Answer**: In stateless JWT architectures, an access token cannot be easily revoked before its expiration. Refresh Token Rotation pairs a short-lived access token (15m) with a single-use refresh token. Each time the refresh token is presented, the server revokes it and issues a new pair. If an attacker intercepts a refresh token and attempts to use it after the legitimate client already refreshed, the server detects that an already-revoked token is being reused, flags a security breach, and immediately revokes all tokens in that `family_id`, terminating the compromised session.

### Q2: Why is `crypto.scrypt` or `Argon2id` superior to SHA-256 for password hashing?
**Answer**: SHA-256 is designed to be computationally fast and parallelizable, allowing modern GPUs and ASIC miners to compute billions of hashes per second, making brute-force rainbow table attacks trivial. `scrypt` and `Argon2id` are **memory-hard key derivation functions**. They require significant RAM (e.g. 64MB per hash) and execution time, rendering parallel ASIC and GPU brute-force attacks economically and physically unfeasible.

### Q3: What is Insecure Direct Object Reference (IDOR) and how do you prevent it in microservices?
**Answer**: IDOR occurs when an application exposes a direct identifier to an internal database record (e.g., `GET /api/v1/orders/12345`) without validating that the authenticated user owns that record. An attacker simply increments the integer or UUID to view other customers' private data. It is prevented by enforcing ownership checks in database queries: `SELECT * FROM orders WHERE id = $1 AND customer_id = $2`, ensuring users can access only their own records.
