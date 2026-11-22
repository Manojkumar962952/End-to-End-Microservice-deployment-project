# Chapter 10: SAST, DAST, Container Scanning & DevSecOps

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               DEVSECOPS CONTINUOUS SECURITY LIFECYCLE                     |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Pre-Commit / IDE] ────> Gitleaks (Secret Leak Prevention), ESLint Security Plugins       |
|                                                                                           |
| [CI Pipeline: SAST] ───> Semgrep & SonarQube (Static Source Code Analysis)                |
|                                                                                           |
| [CI Pipeline: SCA]  ───> npm audit & Snyk (Software Composition Analysis / Dependencies)  |
|                                                                                           |
| [CI Pipeline: Image] ──> Trivy & Clair (Operating System & Container Base Image Scanning) |
|                                                                                           |
| [CD Pipeline: DAST] ───> OWASP ZAP (Dynamic Application Security Testing on Live Staging) |
|                                                                                           |
| [Kubernetes Runtime] ──> Falco (Runtime Anomaly Detection & Kernel Syscall Monitoring)    |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
DevSecOps is the integration of automated security practices, vulnerability scanning, and compliance validation directly into every stage of the software development lifecycle (SDLC).
- **SAST (Static Application Security Testing)**: Analyzes application source code in an idle, non-running state to detect security flaws, injection vectors, and anti-patterns.
- **DAST (Dynamic Application Security Testing)**: Interacts with running applications from the outside, attacking live endpoints to identify exploitable runtime vulnerabilities (such as cross-site scripting, authentication flaws, and header misconfigurations).
- **SCA (Software Composition Analysis)**: Scans open-source third-party dependencies (`node_modules`) against National Vulnerability Database (NVD) CVE databases.
- **Container Scanning**: Scans OS packages, Alpine binaries, and layer dependencies inside Docker images.

---

## 2. Why Do Companies Use It?
- **Shift-Left Security Economics**: Remedying a security vulnerability in production costs 30x to 100x more than catching it in pull requests or development.
- **Regulatory Compliance**: SOC 2, ISO 27001, and PCI-DSS require automated dependency vulnerability tracking, audit trails, and cryptographic verification of deployments.
- **Supply Chain Security**: Recent high-profile attacks (e.g., SolarWinds, Log4j, malicious npm typosquatting) make continuous automated inspection essential.

---

## 3. What Problem Does It Solve?
- **Accidental Secret Commits**: Developers committing AWS access keys, private RSA keys, or database passwords to public or private Git repositories.
- **Vulnerable Transitive Dependencies**: Applications unknowingly inheriting critical remote code execution (RCE) flaws buried deep in nested open-source packages.
- **Zero-Day Container CVEs**: Detecting newly reported base image vulnerabilities before compromised containers are deployed into production Kubernetes pods.

---

## 4. How Does It Work Internally?
1. **SAST (Semgrep)**: Parses source code into an Abstract Syntax Tree (AST). It evaluates declarative pattern rules against code execution flows, tracking untrusted user input sources (e.g., `req.body`) into dangerous sinks (e.g., `eval()`, `db.query()`).
2. **DAST (OWASP ZAP)**: Spiders the running web application, generates synthetic HTTP payloads with malicious fuzzing vectors (SQL injection syntax, XSS scripts, path traversal strings), and evaluates HTTP responses for status codes, headers, and reflected inputs.
3. **Container Scanning (Trivy)**: Unpacks Docker image tarballs, extracts OS package manager manifests (`/lib/apk/db/installed`, `dpkg`), hashes installed package versions, and matches them against daily updated vulnerability vulnerability feeds.

---

## 5. Where Does It Fit in Our Architecture?
- **Local Developer Machine**: Pre-commit hooks check for uncommitted secrets via Gitleaks.
- **GitHub Actions PR Gate**: Semgrep scans code changes, Trivy scans container builds, failing the PR if any **HIGH** or **CRITICAL** CVE is detected.
- **Staging Verification**: OWASP ZAP executes automated DAST against `http://api-gateway:8000`.
- **EKS Runtime**: Kyverno admission controllers reject container images lacking cryptographic Cosign signatures.

---

## 6. How We Implemented It in This Project
### 1. Semgrep SAST Rule Configuration (`.semgrep.yml`):
```yaml
rules:
  - id: detect-unparameterized-sql
    languages: [typescript, javascript]
    message: "Potential SQL Injection detected! Never concatenate variables into SQL strings; use parameterized queries ($1, $2)."
    severity: ERROR
    patterns:
      - pattern-either:
          - pattern: $POOL.query(`... ${$VAR} ...`)
          - pattern: $POOL.query("..." + $VAR)
```

### 2. Automated Trivy Container Image Scan Step:
```yaml
- name: Run Trivy Image Vulnerability Scan
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'ecommerce-api-gateway:latest'
    format: 'table'
    exit-code: '1' # Fails CI if vulnerabilities exist
    ignore-unfixed: true
    severity: 'CRITICAL,HIGH'
```

---

## 7. Configuration Examples
### Gitleaks Configuration (`.gitleaks.toml`)
```toml
title = "Enterprise Secret Detection"

[[rules]]
id = "generic-api-key"
description = "Detected Generic API Key"
regex = '''(?i)(api_key|apikey|secret|token|password)[a-z0-9_ .\-,]{0,25}(=|:)[a-z0-9_ .\-,]{0,5}['\"]([0-9a-zA-Z]{16,64})['\"]'''
tags = ["key", "secret"]
```

---

## 8. Commands
```powershell
# Run Semgrep SAST locally across the monorepo
npx semgrep --config=auto .

# Run Trivy vulnerability scan against a local Docker image
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image ecommerce-order-service:1.0.0

# Audit npm dependencies for known CVEs
npm audit --workspaces --audit-level=high

# Run OWASP ZAP baseline scan against API Gateway in Docker
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://host.docker.internal:8000 -r zap-report.html
```

---

## 9. Verification
1. Introduce an intentional vulnerability in a test branch (e.g., an unparameterized SQL query `pool.query('SELECT * FROM users WHERE id = ' + id)`).
2. Run `npx semgrep scan`. Verify that Semgrep flags the line with `ERROR: Potential SQL Injection detected`.
3. Check Trivy report output to confirm all scanned container base images report 0 High/Critical unfixed vulnerabilities.

---

## 10. Common Mistakes
1. **Ignoring "Transitive" Dependencies**: Fixing direct dependencies in `package.json` while ignoring vulnerabilities introduced by secondary child packages. Always run `npm audit fix` or use package overrides.
2. **Running DAST in Production without Safeguards**: DAST scanners submit random payloads, forms, and delete requests. Running unconstrained DAST against production can corrupt customer databases or trigger spam notification loops. Run DAST in dedicated ephemeral staging environments.
3. **Failing to Break the Build on Critical CVEs**: Running security scans as advisory-only ("informational") without setting `exit-code: 1`. Vulnerable code inevitably gets merged.

---

## 11. Troubleshooting
- **False Positives Blocking CI**: When Semgrep or Trivy flags code that is verified safe by the security team, document the rationale and add an inline ignore annotation (`// nosemgrep: detect-unparameterized-sql`) or add CVE to `.trivyignore` with an expiration date.
- **DAST Scanner Blocked by Rate Limiting**: The API Gateway rate limiter blocks OWASP ZAP after 100 requests. Configure a bypass header or higher token-bucket allowance for security scanner test IP ranges.

---

## 12. Security Best Practices
- **Never Store Secrets in Git**: Enforce pre-commit hooks (`pre-commit install`) with Gitleaks to block commits before they leave the developer machine.
- **Enforce Automated Dependency Patching**: Configure Dependabot or Renovate bot to submit automated weekly security patch PRs.
- **Sign Container Images with Sigstore / Cosign**: Verify image signatures in Kubernetes Admission Controllers to ensure only CI-approved images can run in production.

---

## 13. Real-World Use Cases
- **Equifax Data Breach Prevention**: The 2017 Equifax breach occurred because an Apache Struts vulnerability (CVE-2017-5638) went unpatched for months. Automated SCA scanners like Trivy and Snyk notify teams and fail builds within minutes of a new CVE disclosure.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the fundamental architectural difference between SAST and DAST?
**Answer**:
- **SAST (White-Box Testing)**: Analyzes source code, ASTs, and dependencies at compile or build time without running the application. It provides exact file and line number locations of flaws (e.g., insecure cryptographic functions, SQL concatenation), but cannot identify runtime environment misconfigurations, server headers, or dynamic authentication issues.
- **DAST (Black-Box Testing)**: Interacts with a live, running application over the network without access to source code. It sends simulated attacks and inspects HTTP responses. It detects issues that only manifest at runtime (e.g., TLS misconfigurations, cookie security flags, CORS loopholes, server information disclosure). A comprehensive DevSecOps pipeline must utilize both.

### Q2: How do you handle a critical CVE discovered in a base Docker image when the upstream vendor hasn't released a patch yet?
**Answer**:
1. Evaluate Exploitability: Determine if the vulnerable package or binary is invoked by the application code.
2. Mitigation in Dockerfile: If the vulnerable binary is non-essential (e.g., `curl` or `openssl` in a Node runtime), remove it in the runner stage (`RUN apk del curl`).
3. Base Image Switching: Rebase the container on a distroless or minimal Alpine image that does not include the vulnerable library.
4. Compensating Controls: Deploy Web Application Firewall (WAF) virtual patching rules or Kubernetes NetworkPolicies to block attack vectors until the upstream maintainer releases a fixed version.

### Q3: What is Software Composition Analysis (SCA) and how does it prevent supply-chain attacks?
**Answer**: SCA automates the inspection of all open-source libraries, packages, and frameworks incorporated into a project. It scans manifest files (such as `package-lock.json`), generates a Software Bill of Materials (SBOM), and cross-references dependencies against vulnerability databases (NVD, GitHub Advisory Database). It prevents supply-chain attacks by alerting engineers to malicious packages, typosquatted libraries, packages with restrictive legal licenses (GPLv3), and dependencies with known zero-day vulnerabilities.
