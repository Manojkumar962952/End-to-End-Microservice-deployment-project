# Chapter 13: Infrastructure as Code (IaC) with HashiCorp Terraform

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               ENTERPRISE TERRAFORM WORKFLOW & STATE                       |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [DevOps Engineer / CI Pipeline]                                                           |
|         │                                                                                 |
|         ├── 1. `terraform validate` & `tflint` (Syntax & Rule Check)                      |
|         ├── 2. `terraform plan` (Execution Graph & Resource Diff)                         |
|         ▼                                                                                 |
| [Remote State Management: AWS S3 + DynamoDB State Locking]                                |
| ┌───────────────────────────────────────────────────────────────────────────────────────┐ |
| │ Amazon S3 Bucket: `ecommerce-terraform-state-prod`                                    │ |
| │ - Versioning: ENABLED (Enables instant rollback on state corruption)                  │ |
| │ - Server-Side Encryption: AWS KMS CMK                                                 │ |
| │ - Public Access Block: STRICT                                                         │ |
| │                                                                                       │ |
| │ Amazon DynamoDB Table: `ecommerce-terraform-locks`                                    │ |
| │ - Primary Key: `LockID` (String)                                                      │ |
| │ - Prevents concurrent `terraform apply` race conditions across engineering teams     │ |
| └───────────────────────────────────────────────────────────────────────────────────────┘ |
|         │                                                                                 |
|         ▼ (Provider API Calls via STS Temporary Credentials)                              |
| [Target Cloud: AWS ap-south-1 Infrastructure (VPC, EKS, RDS, ElastiCache, ALB)]          |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
HashiCorp Terraform is an industry-standard open-source Infrastructure as Code (IaC) tool. It uses the declarative HashiCorp Configuration Language (HCL) to provision, modify, and version cloud and on-premise infrastructure safely and predictably across multiple cloud providers (AWS, Azure, GCP, Cloudflare).

---

## 2. Why Do Companies Use It?
- **Zero ClickOps & Reproducibility**: Prevents engineers from manually clicking buttons in the AWS Web Console. Environments (dev, staging, prod) can be spun up identically from code in minutes.
- **Auditability & Version Control**: Every infrastructure change (adding a subnet, resizing a database) is committed to Git, reviewed via pull requests, and logged.
- **Automated Dependency Graph**: Terraform automatically computes dependencies between resources (e.g., Subnets must exist before creating an EKS cluster), launching independent resources in parallel.

---

## 3. What Problem Does It Solve?
- **Configuration Drift**: Reconciles the desired state defined in `.tf` files with actual live cloud resources, identifying and repairing unauthorized manual out-of-band changes.
- **Catastrophic Human Errors**: `terraform plan` generates a deterministic execution diff before any change is applied to production, highlighting destructive actions (`destroy and recreate`) in red.
- **Concurrent Execution Clashing**: DynamoDB state locking prevents two engineers or CI jobs from executing `terraform apply` simultaneously, which would corrupt state files.

---

## 4. How Does It Work Internally?
1. **Parser & Graph Engine**: Reads all `.tf` files in the directory, parses HCL into an Abstract Syntax Tree, and builds a Directed Acyclic Graph (DAG) of all resources.
2. **State Engine (`terraform.tfstate`)**: Maintains a single source of truth mapping your declared HCL resources to real-world AWS resource IDs (e.g., `aws_vpc.main` $\rightarrow$ `vpc-0123456789`).
3. **Refresh & Diff**: Queries AWS APIs to fetch live status, compares it against the state file and desired code, and generates the plan diff (`+ create`, `~ update in-place`, `- destroy`).

---

## 5. Where Does It Fit in Our Architecture?
Terraform provisions all production AWS infrastructure in `ap-south-1`:
- `infra/terraform/modules/vpc`: VPC, 6 subnets, IGW, NAT Gateways, Route Tables.
- `infra/terraform/modules/eks`: EKS Control plane, Managed Node Groups, OIDC Provider.
- `infra/terraform/modules/rds`: Multi-AZ PostgreSQL 16 cluster, subnet groups, KMS encryption.
- `infra/terraform/modules/elasticache`: Redis replication group.
- `infra/terraform/modules/ecr`: Container repositories with tag immutability and lifecycle policies.

---

## 6. How We Implemented It in This Project
### Root Terraform Module Structure (`infra/terraform/environments/prod/main.tf`):

```hcl
terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }

  backend "s3" {
    bucket         = "ecommerce-terraform-state-prod"
    key            = "prod/ap-south-1/platform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "ecommerce-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Environment = "Production"
      Project     = "Enterprise-ECommerce"
      ManagedBy   = "Terraform"
    }
  }
}

module "vpc" {
  source       = "../../modules/vpc"
  cidr_block   = "10.0.0.0/16"
  environment  = "prod"
  aws_region   = "ap-south-1"
}

module "eks" {
  source          = "../../modules/eks"
  vpc_id          = module.vpc.vpc_id
  private_subnets = module.vpc.private_app_subnet_ids
  cluster_name    = "ecommerce-eks-prod"
  node_instance_types = ["t3.xlarge"]
}
```

---

## 7. Configuration Examples
### S3 State Backend & DynamoDB Lock Provisioning (`infra/terraform/bootstrap/main.tf`):
```hcl
resource "aws_s3_bucket" "tf_state" {
  bucket = "ecommerce-terraform-state-prod"
}

resource "aws_s3_bucket_versioning" "state_versioning" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_dynamodb_table" "tf_locks" {
  name         = "ecommerce-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

---

## 8. Commands
```powershell
# Initialize Terraform, download provider plugins, and configure S3 remote backend
terraform init

# Validate HCL syntax and internal consistency
terraform validate

# Format HCL code to canonical standard
terraform fmt -recursive

# Preview execution diff without making any cloud changes
terraform plan -out=tfplan.binary

# Apply the approved plan to live AWS infrastructure
terraform apply tfplan.binary

# Inspect current state of a specific resource
terraform state show module.vpc.aws_vpc.main

# Safely destroy infrastructure (Non-production environments only)
terraform destroy
```

---

## 9. Verification
1. Run `terraform plan`. Ensure output concludes with: `Plan: X to add, 0 to change, 0 to destroy.`
2. Check AWS DynamoDB during plan/apply execution to verify temporary acquisition of lock (`LockID`).
3. Check S3 bucket versioning history to confirm state snapshots are created after every modification.

---

## 10. Common Mistakes
1. **Committing `terraform.tfstate` or `.tfvars` containing secrets to Git**: State files contain plaintext outputs, passwords, and tokens. Always use `.gitignore` and remote backends (S3 with KMS).
2. **Hardcoding Variables**: Hardcoding CIDRs or instance types inside modules instead of exposing parameterized `variables.tf`.
3. **Not Using `prevent_destroy` on Stateful Databases**: Accidental `terraform destroy` or key changes deleting production databases. Add `lifecycle { prevent_destroy = true }` to RDS and S3 resources.
4. **Modifying Cloud Resources Manually via AWS Console**: Introduces configuration drift that will either be overwritten or fail future `terraform apply` operations.

---

## 11. Troubleshooting
- **Error: `Error acquiring the state lock`**: Occurs if a prior Terraform command crashed without releasing the lock. Verify no other teammate is running an apply, then release lock using `terraform force-unlock <LockID>`.
- **Resource Already Exists Error (`ResourceAlreadyExistsException`)**: A resource was created manually outside Terraform. Either delete the manual resource or import it into the state using `terraform import <resource_address> <id>`.

---

## 12. Security Best Practices
- **Remote State Encryption**: Encrypt state in S3 using AWS KMS Customer Managed Keys.
- **Automated IaC Security Scanning**: Integrate **Checkov** or **tfsec** into CI to detect insecure configurations (e.g., S3 bucket with public access, security group with `0.0.0.0/0` on port 22).
- **Least-Privilege Execution Roles**: Run Terraform using temporary STS assumed roles restricted to specific VPC and EKS resource boundaries.

---

## 13. Real-World Use Cases
- **Multi-Region Disaster Recovery Blueprints**: Global enterprises maintain parameterized Terraform modules that can provision an exact mirror of their entire production AWS environment in a secondary region (`eu-west-1`) within 30 minutes during a primary region outage.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What happens if `terraform apply` fails halfway through execution?
**Answer**: Terraform does not have an atomic transactional rollback mechanism like a relational database. If an apply fails at step 5 out of 10, the first 4 resources already created remain in AWS, and their IDs are recorded in the state file. When you fix the error in the `.tf` code and re-run `terraform apply`, Terraform consults the state file, recognizes that steps 1–4 are already satisfied, and resumes execution from step 5.

### Q2: What is the purpose of Terraform State, and why should it never be stored locally on developer laptops?
**Answer**: Terraform state maps the high-level declarative declarations in code to the unique resource identifiers generated by cloud provider APIs (ARNs, VPC IDs). If stored locally on a laptop:
1. Team members cannot collaborate without overwriting each other's changes.
2. Race conditions can occur if two people apply simultaneously.
3. If the laptop disk fails, the mapping is lost, leaving orphaned cloud resources running without code management.
4. Local state files expose plaintext secrets on developer disks.
Storing state in a remote encrypted S3 bucket with DynamoDB locking solves all these issues.

### Q3: What is the difference between `terraform plan` and `terraform apply`?
**Answer**: `terraform plan` is a dry-run, read-only operation. It refreshes state against the live cloud, evaluates the dependency graph, and calculates the exact delta (additions, modifications, destructions) between the desired state in code and real-world infrastructure, writing it to an execution plan file. `terraform apply` reads that execution plan and makes actual mutating API calls to the cloud provider to converge reality with the plan.
