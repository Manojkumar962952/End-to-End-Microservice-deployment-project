# Chapter 08: GitHub Actions CI/CD Pipeline Architecture

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               ENTERPRISE GITHUB ACTIONS PIPELINE                          |
+───────────────────────────────────────────────────────────────────────────────────────────+
|  [Developer Git Push / PR Created]                                                        |
|         │                                                                                 |
|         ▼                                                                                 |
|  [Stage 1: Code Quality & Lint] ────> ESLint, Prettier, TypeScript Strict Compiler Check  |
|         │                                                                                 |
|         ▼                                                                                 |
|  [Stage 2: Security & SAST]     ────> Semgrep Code Scan, Trivy Dependency Audit, Gitleaks |
|         │                                                                                 |
|         ▼                                                                                 |
|  [Stage 3: Automated Unit & E2E] ───> Jest Workspace Unit Tests + Docker Compose E2E Test |
|         │                                                                                 |
|         ▼                                                                                 |
|  [Stage 4: Container Build & Scan] ─> Multi-Stage Docker Build + Trivy Image Vulnerability |
|         │                                                                                 |
|         ▼                                                                                 |
|  [Stage 5: Secure AWS ECR Push] ───> AWS OIDC Role Assumption (Zero Static Access Keys)   |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
GitHub Actions is a cloud-native Continuous Integration and Continuous Delivery (CI/CD) automation platform deeply integrated into GitHub. It allows engineering teams to define automated workflows triggered by GitHub repository events (such as pull requests, branch pushes, release tag creation, or schedule crons) using YAML workflow files stored in `.github/workflows/`.

---

## 2. Why Do Companies Use It?
- **Zero Dedicated CI Infrastructure**: Eliminates the operational overhead of patching, scaling, and managing master/worker Jenkins server instances.
- **Tight Developer Feedback Loop**: Pull request status checks, inline code review annotations, and security scan alerts appear directly on GitHub PRs.
- **Enterprise Ecosystem**: Thousands of pre-built, verified Actions available in the GitHub Marketplace for AWS deployment, container scanning, and notification management.

---

## 3. What Problem Does It Solve?
- **Broken Builds in Trunk**: Enforces PR verification gates where code cannot be merged into `main` unless automated tests, linting, and security audits pass.
- **Credential Leakage in CI**: Eliminates long-lived AWS Access Keys (`AKIA...`) in CI secrets by leveraging OpenID Connect (OIDC) federated role assumption.
- **Slow Feedback Loops**: Runs matrix builds and parallel jobs across different microservices simultaneously.

---

## 4. How Does It Work Internally?
1. **GitHub Runner**: An ephemeral virtual machine (Ubuntu, Windows, or macOS) or self-hosted container agent that receives job instructions from GitHub.
2. **Event Webhook Engine**: Event triggers (e.g., `pull_request`, `push: branches: [main]`) dispatch JSON payloads to runner dispatch queues.
3. **Action Execution Steps**: Executes isolated shell steps or containerized Docker actions.
4. **Contexts & Secret Masking**: Injects secrets into runtime environments while automatically masking secret strings from build logs (`***`).

---

## 5. Where Does It Fit in Our Architecture?
GitHub Actions serves as the primary automated quality and delivery gatekeeper for our monorepo:
1. Validates pull requests across all 8 microservices and frontend.
2. Runs static security analysis (Semgrep) and dependency auditing.
3. Builds container images and runs Trivy container vulnerability scans.
4. Generates immutable versioned container images tagged with the commit SHA (`${{ github.sha }}`) and pushes them to Amazon ECR via AWS OIDC.

---

## 6. How We Implemented It in This Project
Our production PR validation workflow (`.github/workflows/pr-validation.yml`):

```yaml
name: Production PR Validation & Security Audit

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write
  pull-requests: write
  security-events: write

jobs:
  lint-and-typecheck:
    name: Code Quality & Type Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Monorepo Dependencies
        run: npm ci

      - name: Run TypeScript Monorepo Compile
        run: npm run build

  security-sast:
    name: Static Application Security Testing (SAST)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Run Semgrep SAST
        uses: returntocorp/semgrep-action@v1
        with:
          config: >-
            p/security-audit
            p/owasp-top-ten
            p/nodejs

  docker-build-and-scan:
    name: Container Build & Vulnerability Scan
    needs: [lint-and-typecheck, security-sast]
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [api-gateway, auth-service, order-service, product-service, inventory-service, payment-service, notification-service, user-service]
    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build Service Container Image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: services/${{{ matrix.service }}}/Dockerfile
          load: true
          tags: ecommerce-${{{ matrix.service }}}:${{{ github.sha }}}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Scan Image with Trivy for High/Critical CVEs
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ecommerce-${{{ matrix.service }}}:${{{ github.sha }}}
          format: 'table'
          exit-code: '1'
          ignore-unfixed: true
          severity: 'CRITICAL,HIGH'
```

---

## 7. Configuration Examples
### Passwordless AWS Authentication with GitHub OIDC
```yaml
- name: Configure AWS Credentials via OIDC
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789012:role/github-actions-ecommerce-ecr-role
    aws-region: ap-south-1
    audience: sts.amazonaws.com
```

---

## 8. Commands
```powershell
# Test GitHub Actions workflows locally using 'act'
act pull_request

# Trigger a workflow dispatch manually via GitHub CLI
gh workflow run pr-validation.yml --ref main

# View recent workflow run logs and statuses
gh run list --limit 5
gh run view <run-id> --log
```

---

## 9. Verification
1. Open a Pull Request on GitHub.
2. Confirm the GitHub status checks execute:
   - `Code Quality & Type Check` passes.
   - `Semgrep SAST` finishes with zero critical findings.
   - `Container Build & Vulnerability Scan` matrix completes successfully.
3. Verify that branch protection rules block merging if any step fails.

---

## 10. Common Mistakes
1. **Storing Long-Lived AWS Access Keys in GitHub Secrets**: Keys can be leaked or rotated improperly. Always use **AWS IAM OIDC Trust Relationship** with short-lived session tokens.
2. **Missing `npm ci` vs `npm install`**: `npm install` can update `package-lock.json` dynamically on the runner, leading to non-reproducible builds. Always use `npm ci`.
3. **No Docker Layer Caching**: Rebuilding Docker images from scratch on every run takes 10+ minutes. Use `cache-from: type=gha` and `cache-to: type=gha,mode=max`.
4. **Unpinned Third-Party Actions**: Using `@master` or `@v1` allows upstream attackers to push malicious updates. Pin actions to immutable commit hashes (e.g., `actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11`).

---

## 11. Troubleshooting
- **GitHub Runner Out of Disk Space**: Multi-stage Docker builds and matrix jobs can fill the 14 GB runner disk. Add a step to prune unused Docker tool caches (`docker system prune -af`).
- **OIDC Token Minting Failed (`403 Not Authorized`)**: Verify that the workflow has explicit permission `id-token: write` and the AWS IAM Role Trust Policy matches the repository name (`repo:organization/repo:ref:refs/heads/main`).
- **Matrix Job Failure on Single Microservice**: Check monorepo file changes using `dorny/paths-filter` so jobs only run for modified microservices.

---

## 12. Security Best Practices
- **Strict Least Privilege Permissions**: Set top-level `permissions: {}` and explicitly grant only required scopes (`contents: read`, `id-token: write`).
- **Dependabot Security Updates**: Automate npm dependency vulnerability patching.
- **Branch Protection Rules**: Enforce required approvals (minimum 1 Senior Engineer), require status checks to pass before merging, and prohibit force pushes.

---

## 13. Real-World Use Cases
- **Trunk-Based Monorepo Delivery**: Stripe and Shopify run thousands of automated GitHub Actions checks per hour across massive monorepos before automatically deploying to staging and production.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is AWS OIDC in GitHub Actions and why is it superior to AWS Access Keys?
**Answer**: AWS OpenID Connect (OIDC) allows GitHub Actions runners to obtain short-lived (15–60 min) temporary STS security credentials without storing long-lived AWS Access Key IDs and Secret Access Keys in GitHub Secrets. The runner presents a cryptographic JWT token signed by GitHub's OIDC identity provider (`token.actions.githubusercontent.com`). AWS STS validates the token's signature, evaluates IAM trust policies against claims (`aud`, `sub: repo:owner/repo:ref`), and issues temporary credentials. If an attacker gains read access to GitHub secrets, there are zero AWS credentials to steal.

### Q2: What is the difference between `npm install` and `npm ci` in continuous integration?
**Answer**: `npm install` may overwrite `package-lock.json` and install minor/patch updates based on semver ranges (`^`, `~`) in `package.json`, causing non-deterministic builds across developer laptops and CI runners. `npm ci` (Clean Install) strictly requires an existing `package-lock.json`, deletes existing `node_modules`, and installs the exact cryptographic hash matches, failing immediately if lockfile discrepancies exist. It is significantly faster and completely deterministic.

### Q3: How do you optimize GitHub Actions execution time in a microservices monorepo?
**Answer**:
1. Path Filtering: Use `paths-filter` to trigger builds only for services whose code changed.
2. Buildx GitHub Actions Cache (`type=gha`): Persist Docker build layers across CI runs.
3. Matrix Parallelization: Fan out testing and container builds across concurrent runner VMs.
4. Dependency Caching: Cache `~/.npm` via `actions/setup-node`.
