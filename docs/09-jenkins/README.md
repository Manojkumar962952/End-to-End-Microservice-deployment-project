# Chapter 09: Jenkins Enterprise Declarative CI/CD Pipelines

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                           JENKINS MASTER-AGENT DISTRIBUTED ARCHITECTURE                   |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Jenkins Controller / Master]                                                             |
| - Web UI & Dashboard                                                                      |
| - Pipeline Scheduling & Orchestration                                                     |
| - Plugin Management & Credentials Store                                                   |
|         │                                                                                 |
|         ├── JNLP / SSH (Zero Job Execution on Controller)                                 |
|         ▼                                                                                 |
| [Dynamic Ephemeral Kubernetes Agents / Docker Pods]                                       |
| ┌──────────────────────────┐  ┌──────────────────────────┐  ┌───────────────────────────┐ |
| │ pod: nodejs-runner       │  │ pod: security-scanner    │  │ pod: kaniko-builder       │ |
| │ - npm ci                 │  │ - trivy image scan       │  │ - rootless daemonless     │ |
| │ - npm test               │  │ - sonarqube / semgrep    │  │   Docker build in EKS     │ |
| └──────────────────────────┘  └──────────────────────────┘  └───────────────────────────┘ |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Jenkins is an open-source automation server widely adopted in enterprise environments. It provides hundreds of plugins supporting building, deploying, and automating software projects. In modern enterprises, Jenkins is operated via **Declarative Pipelines** defined as code in a version-controlled `Jenkinsfile`, utilizing distributed Master-Agent architectures where ephemeral worker pods execute jobs in isolated Kubernetes namespaces.

---

## 2. Why Do Companies Use It?
- **Self-Hosted Data Sovereignty**: Financial institutions and regulated enterprises use Jenkins on private VPCs to ensure source code and intellectual property never touch external third-party SaaS clouds.
- **Extreme Extensibility**: Over 1,800 community and enterprise plugins integrate with on-premise LDAP/Active Directory, legacy hardware, mainframe systems, and multi-cloud infrastructure.
- **Complex Orchestration Pipelines**: Supports advanced multi-stage branching, parallel execution matrixes, and manual approval gates with role-based access.

---

## 3. What Problem Does It Solve?
- **Controller Resource Contention**: Prevents build tasks from crashing the Jenkins web server by offloading heavy compilation and Docker builds to dynamic agent pods.
- **Configuration Drift ("Snowflake" CI Servers)**: Replaces manually configured Jenkins GUI jobs with version-controlled `Jenkinsfile` definitions stored alongside application code.
- **Vulnerable Docker-in-Docker (DinD)**: Eliminates privileged Docker daemon mounting on CI nodes using modern rootless container builders like **Kaniko**.

---

## 4. How Does It Work Internally?
1. **Controller (Master)**: Handles job scheduling, credentials management, user authentication, and plugin execution. The controller should never execute build payloads directly (`# of executors: 0`).
2. **Kubernetes Agent Plugin**: When a build triggers, the controller calls the Kubernetes API server to launch an ephemeral Pod containing containers specified in the `Jenkinsfile` pod template.
3. **JNLP Inbound Connection**: The Jenkins agent container establishes an outbound TCP connection back to the controller on port `50000`.
4. **Execution & Teardown**: Stages execute sequentially or in parallel inside agent containers. Once the pipeline completes, the agent Pod is automatically terminated, freeing cluster resources.

---

## 5. Where Does It Fit in Our Architecture?
Jenkins provides an enterprise alternative to GitHub Actions for self-hosted VPC deployments:
1. Pulls the monorepo from Git upon commit webhook trigger.
2. Runs unit and integration test suites inside Node.js 20 agent pods.
3. Performs SAST and container security scanning.
4. Builds multi-stage Docker images using Kaniko without requiring root privileges.
5. Deploys updated Helm charts to staging and production Kubernetes namespaces following manual approval.

---

## 6. How We Implemented It in This Project
Our production `jenkins/Jenkinsfile` pipeline:

```groovy
pipeline {
    agent {
        kubernetes {
            yaml '''
apiVersion: v1
kind: Pod
metadata:
  labels:
    component: ci-agent
spec:
  containers:
  - name: nodejs
    image: node:20-alpine
    command: ['cat']
    tty: true
  - name: kaniko
    image: gcr.io/kaniko-project/executor:debug
    command: ['cat']
    tty: true
    volumeMounts:
    - name: kaniko-secret
      mountPath: /kaniko/.docker
  volumes:
  - name: kaniko-secret
    secret:
      secretName: ecr-docker-config
'''
        }
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
        disableConcurrentBuilds()
    }

    environment {
        AWS_REGION = 'ap-south-1'
        ECR_REGISTRY = credentials('aws-ecr-registry-url')
        APP_NAME = 'ecommerce-platform'
    }

    stages {
        stage('Checkout & Lint') {
            steps {
                container('nodejs') {
                    sh 'npm ci'
                    sh 'npm run build'
                }
            }
        }

        stage('Parallel Test Suite') {
            parallel {
                stage('Unit & Contract Tests') {
                    steps {
                        container('nodejs') {
                            sh 'npm test'
                        }
                    }
                }
                stage('Security Audit') {
                    steps {
                        container('nodejs') {
                            sh 'npm audit --audit-level=high'
                        }
                    }
                }
            }
        }

        stage('Container Build via Kaniko') {
            steps {
                container('kaniko') {
                    sh """
                    /kaniko/executor \
                      --context=dir://. \
                      --dockerfile=services/api-gateway/Dockerfile \
                      --destination=${ECR_REGISTRY}/ecommerce-api-gateway:${GIT_COMMIT} \
                      --cache=true
                    """
                }
            }
        }

        stage('Manual Approval for Production') {
            steps {
                input message: "Approve deployment to production cluster?", ok: "Deploy"
            }
        }

        stage('Helm Deploy') {
            steps {
                sh """
                helm upgrade --install ecommerce-platform ./helm/ecommerce-platform \
                  --namespace production \
                  --set apiGateway.image.tag=${GIT_COMMIT}
                """
            }
        }
    }
}
```

---

## 7. Configuration Examples
### Jenkins Configuration as Code (JCasC) snippet
```yaml
jenkins:
  systemMessage: "Production E-Commerce CI/CD Platform - Managed via JCasC"
  numExecutors: 0
  mode: EXCLUSIVE
  clouds:
    - kubernetes:
        name: "kubernetes"
        serverUrl: "https://kubernetes.default.svc"
        jenkinsUrl: "http://jenkins-service.jenkins.svc.cluster.local:8080"
```

---

## 8. Commands
```bash
# Validate Jenkinsfile syntax via Jenkins CLI
java -jar jenkins-cli.jar -s http://jenkins.local:8080/ -auth admin:token declarative-linter < Jenkinsfile

# Tail build logs of a running job via CLI
java -jar jenkins-cli.jar -s http://jenkins.local:8080/ console ecommerce-pipeline -f
```

---

## 9. Verification
1. Trigger pipeline via Git webhook push.
2. Confirm the Kubernetes cluster spawns a dynamic pod (`kubectl get pods -n jenkins -l component=ci-agent`).
3. Verify all stages execute, test results are published, and the pod is cleanly terminated upon job completion.

---

## 10. Common Mistakes
1. **Running jobs on the Jenkins Master/Controller**: Never execute builds on the controller; it causes CPU exhaustion, memory crashes, and gives build scripts access to Jenkins credentials stored on master disk.
2. **Hardcoding credentials in Jenkinsfile**: Always reference credentials using the `credentials('id')` helper function.
3. **Mounting Docker socket (`/var/run/docker.sock`) into containers**: Exposing the host Docker socket grants root host takeover to any compromised build step. Use daemonless builders like **Kaniko**.

---

## 11. Troubleshooting
- **Error: Agent Failed to Connect / JNLP Handshake Timeout**: Check that port `50000` is open and routable from the Kubernetes agent namespace to the Jenkins controller service.
- **Out of Disk Space on Controller**: Older builds and workspace artifacts consume storage. Configure `buildDiscarder(logRotator(numToKeepStr: '15'))` and disable archiving large video/binary artifacts.
- **Pipeline Hanging on Approval Step**: Jenkins pauses pipeline execution and consumes an executor if not configured properly. Declarative `input` steps inside agent-less stages release agent pods while waiting.

---

## 12. Security Best Practices
- **Role-Based Access Control (RBAC)**: Implement the Matrix Authorization Strategy plugin, granting developers read/build permissions on specific jobs while restricting administrative privileges.
- **Ephemeral Build Agents**: Run all agents inside single-use, unprivileged Kubernetes Pods that are destroyed after every run.
- **Store Secrets in HashiCorp Vault or AWS Secrets Manager**: Integrate Jenkins with external enterprise secret managers rather than keeping secrets in local XML files.

---

## 13. Real-World Use Cases
- **Regulated Banking Infrastructure**: Financial institutions deploy Jenkins within isolated AWS VPCs or private on-premise OpenShift clusters to comply with PCI-DSS and banking security regulations where public cloud SaaS CI solutions are restricted.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: Why should you never execute build jobs directly on the Jenkins Controller?
**Answer**:
1. **Security**: Any developer or pull request executing a shell command on the controller has access to the Jenkins home directory (`$JENKINS_HOME`), allowing them to read encrypted master secrets, API tokens, and private SSH keys.
2. **Reliability & Availability**: Heavy builds (like Java Maven packaging or Docker image builds) consume CPU and memory. An Out-Of-Memory (OOM) error crashes the entire Jenkins server, halting all automated builds across the entire company.
3. **Scalability**: Controllers cannot scale horizontally. Offloading builds to ephemeral agent pods across a Kubernetes cluster allows infinite elastic scalability.

### Q2: How does Kaniko build Docker container images inside Kubernetes without Docker-in-Docker (DinD)?
**Answer**: Traditional Docker builds require the Docker daemon (`dockerd`), which needs root permissions or mounting `/var/run/docker.sock` from the host node (a severe security vulnerability). Kaniko runs entirely in user-space inside an unprivileged container. It unpacks the base image filesystem in memory, executes Dockerfile commands, snapshots filesystem changes by calculating layer diffs, and pushes the generated image layers directly to an ECR or Docker registry using standard HTTP registry APIs, without requiring host daemon access.

### Q3: What is the difference between Scripted and Declarative Jenkins Pipelines?
**Answer**: Scripted Pipelines are based on Groovy DSL with imperative programming logic, offering maximum flexibility but making error handling complex and difficult to standardize. Declarative Pipelines provide a structured, opinionated, syntax-checked framework with predefined blocks (`pipeline`, `agent`, `stages`, `post`). Declarative syntax is easier to read, supports automatic syntax linting, integrates out-of-the-box with Blue Ocean UI, and enforces enterprise best practices.
