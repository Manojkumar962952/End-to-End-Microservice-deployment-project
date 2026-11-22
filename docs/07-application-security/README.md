# Enterprise Application Security Guide & OWASP Top 10 Hardening

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

## 1. What is Application Security?
Application security encompasses the practices, architectural controls, and code-level defenses designed to protect software applications from threats, data leakage, unauthorized manipulation, and service degradation across the software development lifecycle (SDLC).

---

## 2. Why Do Companies Prioritize It?
- **Financial & Regulatory Penalties**: Data breaches violate GDPR, HIPAA, and PCI-DSS, resulting in multi-million dollar regulatory fines.
- **Brand Reputation**: Customer loss following account credential breaches or credit card theft can destroy business valuation.
- **Supply Chain Threats**: Vulnerable third-party dependencies (`node_modules`) are actively targeted by malicious threat actors.

---

## 3. What Problems Does It Solve? (OWASP Top 10 Mitigations)

| OWASP Vulnerability | Real-World Attack Scenario | How We Mitigate It in This Codebase |
| :--- | :--- | :--- |
| **A01: Broken Access Control** | An authenticated user modifies URL `/orders/999` to view another customer's order. | In `services/order-service`, SQL queries enforce `WHERE id = $1 AND customer_id = $2`. Users can only access their own data. |
| **A02: Cryptographic Failures** | Storing plaintext passwords or using outdated MD5/SHA1 algorithms cracked by rainbow tables. | Passwords hashed using **memory-hard key derivation (`scrypt`/`Argon2id`)** with unique random salts and timing-safe equality comparison. |
| **A03: Injection (SQLi / XSS)** | Attacker submits `admin' OR 1=1; --` in email input to bypass login. | Strict **parameterized queries (`$1, $2`)** via `pg` library. Direct string concatenation in SQL queries is prohibited. |
| **A04: Insecure Design** | Flash sale bot drains inventory in 100 milliseconds or replays credit card charges. | **Redis Token-Bucket Rate Limiting** on Gateway + **Mandatory Idempotency Keys** on checkout endpoints. |
| **A05: Security Misconfiguration** | Running Docker containers as `root` or displaying verbose stack traces to users. | All containers run as **`USER node`**. Errors are sanitized into generic `ApiErrorResponse` envelopes. |
| **A07: Identification & Auth Failures** | Stolen long-lived JWTs give permanent access to an attacker. | **Short-lived JWT Access Tokens (15 min)** paired with **Refresh Token Rotation (RTR)**. Stolen token replay revokes the entire family. |

---

## 4. How Does It Work Internally?

### Refresh Token Rotation (RTR) & Replay Attack Defense
In our Authentication Service ([`services/auth-service/src/services/auth.service.ts`](file:///c:/Users/Admin/Desktop/coporate-project/services/auth-service/src/services/auth.service.ts)):
1. Customer logs in $\rightarrow$ receives a short-lived Access Token and a long-lived Refresh Token bound to a `family_id`.
2. When refreshing, the client sends the refresh token.
3. The database checks if the token has already been revoked:
   - **Happy Path**: Token is valid $\rightarrow$ mark current token as `is_revoked = true` $\rightarrow$ issue a brand new refresh token in the same family.
   - **Attack Detected**: If an attacker attempts to use an already revoked refresh token (token reuse), the system detects token theft and immediately **revokes all tokens in that `family_id`**, logging out the legitimate user and terminating the stolen session.

---

## 5. Where Does It Fit in Our Architecture?
- **API Gateway**: Edge rate limiting, CORS whitelisting, HTTP security headers (`Helmet`), JWT verification.
- **Auth Service**: Password hashing, refresh token rotation.
- **Microservices**: Parameterized SQL queries, role-based access checks (`x-user-role`).
- **Dockerfiles**: `USER node` non-root containers.

---

## 6. How We Implemented It in This Project

### Input Validation with Zod
```typescript
// shared/contracts/src/dtos.ts
export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  firstName: z.string().min(1),
  lastName: z.string().min(1)
});
```

### Parameterized SQL Query Prevention
```typescript
// Correct: Parameterized Query (Zero SQL Injection)
await pool.query('SELECT * FROM users_auth WHERE email = $1', [email.toLowerCase()]);

// Prohibited Vulnerable Pattern:
// await pool.query(`SELECT * FROM users_auth WHERE email = '${email}'`);
```

---

## 7. Developer Security Checklist

Share this checklist with software engineers before approving pull requests:

- [ ] **Input Validation**: Are all incoming request parameters validated against a strict Zod/Joi schema?
- [ ] **No SQL Concatenation**: Are all database interactions strictly using parameterized queries (`$1, $2`)?
- [ ] **Authentication Guard**: Is every non-public route protected by `requireAuth`?
- [ ] **Authorization (IDOR)**: Does the database query check that `record.customer_id === req.user.userId`?
- [ ] **Data Masking**: Are passwords, secret keys, and JWT secrets scrubbed from logs?
- [ ] **Non-Root Docker**: Does the Dockerfile specify an unprivileged runtime user (`USER node`)?
- [ ] **No Committed Secrets**: Are `.env` files and credentials excluded via `.gitignore`?

---

## 8. Verification & Security Testing Commands

### Verify Parameterized SQL Injection Immunity
Attempt submitting an SQL injection payload to login:
```powershell
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/auth/login" -Method Post `
  -Body '{"email":"admin@example.com'' OR ''1''=''1","password":"test"}' `
  -ContentType "application/json" -ErrorAction SilentlyContinue
```
*Expected Result*: Returns `HTTP 401 INVALID_CREDENTIALS` or `HTTP 400 VALIDATION_ERROR`. The database treats the injection string literally, preventing unauthorized access.

### Verify Container Non-Root User
```powershell
docker compose exec auth-service whoami
```
*Expected Result*: `node` (UID 1000, not `root`).

---

## 9. Senior Interview Questions & Answers

### Q1: What is Refresh Token Rotation and why is it superior to long-lived JWTs?
> **Answer**: JWTs are stateless and cannot be revoked before they expire without querying a database on every request. If an access token has a 30-day lifetime and is stolen, the attacker has a 30-day window. Refresh Token Rotation limits access token lifetime to 15 minutes. Refresh tokens are one-time-use: whenever a refresh token is used, it is invalidated and replaced. If a stolen token is reused, the server detects the collision and revokes the entire token family, neutralizing the attacker.

### Q2: What is an IDOR vulnerability, and how do you prevent it in microservices?
> **Answer**: Insecure Direct Object Reference (IDOR) occurs when an application exposes a reference to an internal object (e.g. `GET /orders/12345`) without verifying that the requesting user owns that object. To prevent it, the service must never fetch by object ID alone; it must enforce ownership in the query: `SELECT * FROM orders WHERE id = $1 AND customer_id = $2`.
