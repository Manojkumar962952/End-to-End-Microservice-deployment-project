# Chapter 11: Enterprise Artifact Management, OCI Registries & Amazon ECR

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               ENTERPRISE ARTIFACT LIFECYCLE & PROMOTION                   |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [CI Builder (GitHub / Jenkins)]                                                           |
|         │                                                                                 |
|         ├── 1. Build Multi-Stage Docker Image & Sign with Cosign                          |
|         ├── 2. Package Helm Chart (.tgz) & NPM Shared Libraries                           |
|         ▼                                                                                 |
| [Private OCI Registry: Amazon ECR / JFrog Artifactory]                                    |
| ┌───────────────────────────────────────────────────────────────────────────────────────┐ |
| │ Repository: 123456789012.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-order-service      │ |
| │                                                                                       │ |
| │ • Tag: :sha-f1d3770 (Immutable Commit Tag)                                            │ |
| │ • Tag: :v1.2.0      (Semantic Release Tag)                                            │ |
| │ • Tag: :staging     (Environment Pointer)                                             │ |
| │                                                                                       │ |
| │ [ECR Security Policies]                                                               │ |
| │ - Image Tag Immutability: ENABLED                                                     |
| │ - Enhanced Scanning on Push (Amazon Inspector / Clair): ENABLED                       |
| │ - ECR Lifecycle Policy (Expire untagged images after 14 days): ENABLED                |
| └───────────────────────────────────────────────────────────────────────────────────────┘ |
|         │                                                                                 |
|         ▼ (Kubelet Authenticates via IAM Node Role / IRSA)                                |
| [Amazon EKS Kubernetes Worker Nodes in ap-south-1]                                        |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Artifact Management is the systematic discipline of storing, versioning, securing, and promoting compiled binary packages, OCI (Open Container Initiative) container images, Helm charts, and private npm modules across the software lifecycle. In AWS enterprise environments, **Amazon Elastic Container Registry (ECR)** acts as the central private OCI-compliant registry, while private npm registries (AWS CodeArtifact, JFrog Artifactory, or GitHub Packages) host shared library contracts.

---

## 2. Why Do Companies Use It?
- **Docker Hub Rate Limits & Outages**: Docker Hub imposes anonymous pull rate limits (100 pulls per 6 hours). Relying on public registries in production causes Kubernetes Pod start failures (`ImagePullBackOff`).
- **Intellectual Property Protection**: Proprietary enterprise code and compiled business logic must reside within private VPC-accessible repositories protected by IAM policies.
- **Image Tag Immutability**: Prohibits overwriting existing tags (such as `:v1.0.0`), preventing malicious or accidental tampering with production builds.

---

## 3. What Problem Does It Solve?
- **Configuration Drift**: Ensures the identical binary artifact verified in QA and staging is deployed to production without re-compilation.
- **Uncontrolled Registry Storage Costs**: ECR repositories without lifecycle rules accumulate terabytes of stale untagged images, leading to thousands of dollars in wasted monthly cloud spend.
- **Supply Chain Poisoning**: Blocks unsigned or tampered container images from running in production through cryptographic signatures (Cosign) and automated vulnerability gates.

---

## 4. How Does It Work Internally?
1. **OCI Image Specification**: Images consist of an Image Manifest (JSON), a Configuration blob (JSON), and compressed tarball filesystem layers (`application/vnd.oci.image.layer.v1.tar+gzip`).
2. **Content Addressable Storage (CAS)**: Every layer is identified by its SHA-256 cryptographic digest (e.g., `sha256:e3b0c44298fc...`). If two different microservices share the same Alpine base layer, ECR stores it only once, saving network bandwidth and storage.
3. **Kubelet Pull Authentication**: The Kubernetes Kubelet uses an AWS IAM instance profile or ServiceAccount to invoke `ecr:GetAuthorizationToken`, receiving a temporary Docker auth token to pull private images across the AWS internal backbone (AWS PrivateLink).

---

## 5. Where Does It Fit in Our Architecture?
- **ECR Repositories**: 8 dedicated private ECR repositories in `ap-south-1` for our microservices (`ecommerce-api-gateway`, `ecommerce-order-service`, etc.).
- **CodeArtifact / Private NPM**: Hosts our versioned shared packages (`@ecommerce/contracts`, `@ecommerce/logger`, `@ecommerce/middleware`).
- **Helm OCI Registry**: Stores our packaged Helm umbrella chart (`ecommerce-platform-1.0.0.tgz`).

---

## 6. How We Implemented It in This Project
### Terraform Amazon ECR Provisioning with Security Rules:
```hcl
resource "aws_ecr_repository" "microservice" {
  for_each             = toset(["api-gateway", "auth-service", "order-service", "product-service", "payment-service", "inventory-service", "notification-service", "user-service", "frontend"])
  name                 = "ecommerce-${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.ecr_key.arn
  }
}

resource "aws_ecr_lifecycle_policy" "cleanup_policy" {
  for_each   = aws_ecr_repository.microservice
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images older than 14 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Retain maximum of 30 tagged production images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "sha-"]
          countType     = "imageCountMoreThan"
          countNumber   = 30
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
```

---

## 7. Configuration Examples
### Kubernetes Pod Image Pull Specification
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    spec:
      containers:
      - name: order-service
        image: 123456789012.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-order-service:sha-f1d3770
        imagePullPolicy: IfNotPresent
```

---

## 8. Commands
```powershell
# Authenticate local Docker client to Amazon ECR in ap-south-1
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.ap-south-1.amazonaws.com

# Tag local build with Git commit SHA and Semantic Version
docker tag ecommerce-order-service:latest 123456789012.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-order-service:sha-f1d3770
docker tag ecommerce-order-service:latest 123456789012.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-order-service:v1.2.0

# Push tagged images to ECR
docker push 123456789012.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-order-service:sha-f1d3770
docker push 123456789012.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-order-service:v1.2.0

# Inspect image vulnerabilities via AWS CLI
aws ecr describe-image-scan-findings --repository-name ecommerce-order-service --image-id imageTag=sha-f1d3770 --region ap-south-1
```

---

## 9. Verification
1. Attempt to overwrite an existing immutable tag:
   ```powershell
   docker push 123456789012.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-order-service:sha-f1d3770
   ```
2. Verify that ECR rejects the push with: `The image tag 'sha-f1d3770' already exists in the repository and cannot be overwritten because image tag immutability is enabled.`
3. Inspect ECR Console to confirm automated Inspector scan completed with zero High/Critical findings.

---

## 10. Common Mistakes
1. **Using Mutable Tags (like `:latest`) in Production**: Leads to different nodes running different versions of code under the same tag, making rollbacks impossible.
2. **Missing Lifecycle Policies**: Accumulating thousands of development images over months, inflating monthly AWS S3/ECR storage bills.
3. **Public Network ECR Pulls**: Pulling images from ECR over public internet NAT gateways, incurring substantial AWS NAT data transfer charges. Always configure **VPC Endpoints (AWS PrivateLink)** for ECR (`com.amazonaws.ap-south-1.ecr.dkr`).

---

## 11. Troubleshooting
- **Error: `ImagePullBackOff` / `401 Unauthorized` in Kubernetes**: The EKS worker node IAM role is missing `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, or `ecr:GetAuthorizationToken`. Attach the managed policy `AmazonEC2ContainerRegistryReadOnly` to the node instance role.
- **Docker Push Fails with `Retrying in...` / Broken Pipe**: Network MTU mismatch or large layer upload timeout. Ensure Docker Desktop has sufficient RAM and stable internet connectivity.

---

## 12. Security Best Practices
- **Enable Image Tag Immutability**: Prohibit modifying existing tags.
- **Enable KMS Customer Managed Keys (CMK)**: Encrypt container layers at rest using dedicated AWS KMS keys.
- **VPC Endpoints (PrivateLink)**: Keep all container image traffic inside AWS private networks without traversing the public internet.

---

## 13. Real-World Use Cases
- **Multi-Region Disaster Recovery**: Large global applications configure ECR Cross-Region Replication (CRR) from `ap-south-1` (Mumbai) to `ap-southeast-1` (Singapore) so disaster recovery clusters have instant access to production images without cross-region network latency.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: Why must Image Tag Immutability be enforced in enterprise container registries?
**Answer**:
1. **Security & Tamper Proofing**: If tags are mutable, an attacker with compromised registry credentials could overwrite `:v1.0.0` with a malicious backdoored image. Production clusters restarting pods would silently pull the compromised image.
2. **Reproducibility & Incident Rollbacks**: If `:v1.0.0` points to code from yesterday and someone overwrites it today, rolling back to `:v1.0.0` does not restore the previous known good state. Immutable tags ensure a 1-to-1 cryptographic match between Git commits and deployed images.

### Q2: How does Kubernetes authenticate to Amazon ECR without storing static passwords in Secret manifests?
**Answer**: In AWS EKS, the Kubelet binary utilizes AWS IAM. Worker nodes run with an IAM Instance Profile containing the `AmazonEC2ContainerRegistryReadOnly` policy, or use IAM Roles for Service Accounts (IRSA). When Kubelet needs to pull an image from an ECR registry in the same AWS account, the AWS cloud provider integration automatically generates temporary 12-hour STS authorization tokens behind the scenes.

### Q3: How do VPC Endpoints for ECR optimize architecture and reduce AWS billing?
**Answer**: By default, traffic from private EKS worker nodes to ECR travels out through AWS NAT Gateways to the public internet ECR endpoints, incurring NAT Gateway processing charges ($0.045 per GB) and data transfer fees. Creating AWS PrivateLink VPC Interface Endpoints for `ecr.api` and `ecr.dkr`, plus an S3 Gateway Endpoint (where ECR stores underlying image layers), keeps traffic entirely within AWS's internal private fiber network, dramatically reducing latency, enhancing security, and slashing NAT data transfer costs.
