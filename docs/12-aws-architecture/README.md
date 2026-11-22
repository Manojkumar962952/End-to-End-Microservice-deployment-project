# Chapter 12: Production AWS Cloud Architecture (ap-south-1 Mumbai)

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                           AWS ENTERPRISE MULTI-AZ ARCHITECTURE (ap-south-1)               |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Internet Users] ────> [AWS CloudFront CDN + AWS WAF Layer 7 Protection]                  |
|                                        │                                                  |
|                                        ▼ Route 53 (api.ecommerce.com)                     |
| [VPC: 10.0.0.0/16] ─────────────────────────────────────────────────────────────────────  |
|                                                                                           |
|  PUBLIC SUBNETS (10.0.1.0/24, 10.0.2.0/24 across AZ-1a & AZ-1b)                          |
|  ├── Internet Gateway (IGW)                                                               |
|  ├── NAT Gateway AZ-1a (Elastic IP)    ├── NAT Gateway AZ-1b (Elastic IP)                 |
|  └── AWS Application Load Balancer (ALB) - Public HTTPS 443 with ACM TLS 1.3              |
|                                        │                                                  |
|  PRIVATE APPLICATION SUBNETS (10.0.10.0/24, 10.0.20.0/24 - Zero Public IPs)              |
|  ├── AWS EKS Managed Node Group (Worker Nodes across AZ-1a & AZ-1b)                       |
|  │   ├── Ingress-NGINX / AWS ALB Ingress Controller Target Group                          |
|  │   ├── Pods: API Gateway, Auth, User, Product, Order, Payment, Inventory, Notification  |
|  │   └── IRSA (IAM Roles for Service Accounts)                                            |
|                                        │                                                  |
|  PRIVATE DATA SUBNETS (10.0.50.0/24, 10.0.60.0/24 - Completely Isolated)                  |
|  ├── Amazon RDS Multi-AZ PostgreSQL (Primary 1a, Sync Standby 1b)                         |
|  ├── Amazon ElastiCache Redis Cluster (Multi-AZ with Auto-Failover)                        |
|  └── Amazon MQ (RabbitMQ High-Availability Cluster across 2 AZs)                          |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
AWS Cloud Architecture defines the structural design, network zoning, managed cloud services, resilience boundaries, and high-availability patterns implemented on Amazon Web Services (AWS) in the **ap-south-1 (Mumbai)** region. It adheres to the **AWS Well-Architected Framework** spanning 6 pillars: Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization, and Sustainability.

---

## 2. Why Do Companies Use It?
- **Global High Availability (99.99%)**: Distributes workloads across multiple physically isolated Availability Zones (AZs) with independent power, cooling, and low-latency optical networking (<1ms).
- **Elastic Auto-Scaling**: Automatically provisions compute during flash sales and scales down during off-peak hours, converting fixed capital expenditure (CapEx) into variable operational expenditure (OpEx).
- **Enterprise Managed Services**: Offloads patching, replication, automated backups, and hardware maintenance to AWS via managed services like Amazon EKS, RDS, ElastiCache, and KMS.

---

## 3. What Problem Does It Solve?
- **Data Center Outages**: If an entire data center suffers a flood or power failure in `ap-south-1a`, traffic automatically fails over to `ap-south-1b` without data loss or prolonged downtime.
- **Direct Internet Exposure of Data**: Databases and microservices have **zero public IP addresses** and reside in strictly isolated private subnets.
- **DDoS Attacks**: AWS Shield Standard and CloudFront absorb volumetric layer 3/4 attacks, while AWS WAF filters layer 7 application attacks (SQLi, HTTP flood, bot scrapers).

---

## 4. How Does It Work Internally?
1. **Network Layer (Amazon VPC)**:
   - Divided into 6 subnets across 2 Availability Zones (`ap-south-1a`, `ap-south-1b`).
   - Public Subnets route outbound traffic directly to the Internet Gateway (IGW).
   - Private App Subnets route outbound internet traffic through High-Availability NAT Gateways.
   - Private Data Subnets have no route to the internet whatsoever.
2. **Compute Layer (Amazon EKS)**:
   - AWS manages the Kubernetes Control Plane across 3 AZs.
   - Self-healing EC2 Managed Node Groups run in private app subnets, scaling via Karpenter or Cluster Autoscaler.
3. **Data Layer (Multi-AZ RDS & ElastiCache)**:
   - Amazon RDS runs synchronous block-level replication to an active standby in the secondary AZ. If the primary fails, DNS automatically flips to the replica within 60 seconds.

---

## 5. Where Does It Fit in Our Architecture?
AWS is the production target environment for the Enterprise Platform:
- **CloudFront + WAF**: CDN caching for static frontend assets + Layer 7 security.
- **Application Load Balancer (ALB)**: Ingress SSL termination and path routing.
- **EKS Cluster**: Hosts all 8 microservices and frontend NGINX pods.
- **RDS PostgreSQL 16 (Multi-AZ)**: Replaces local PostgreSQL container.
- **ElastiCache Redis (Cluster Mode)**: Replaces local Redis container.
- **Amazon MQ (RabbitMQ)**: Replaces local RabbitMQ container with HA mirrored quorum queues.

---

## 6. How We Implemented It in This Project
Detailed subnet layout and CIDR allocations:

| Subnet Purpose | Availability Zone | CIDR Block | Route Table Target |
| :--- | :--- | :--- | :--- |
| **Public Subnet 1** | `ap-south-1a` | `10.0.1.0/24` | Internet Gateway (`igw-xxxx`) |
| **Public Subnet 2** | `ap-south-1b` | `10.0.2.0/24` | Internet Gateway (`igw-xxxx`) |
| **Private App Subnet 1** | `ap-south-1a` | `10.0.10.0/24` | NAT Gateway 1a (`nat-xxxx`) |
| **Private App Subnet 2** | `ap-south-1b` | `10.0.20.0/24` | NAT Gateway 1b (`nat-xxxx`) |
| **Private DB Subnet 1** | `ap-south-1a` | `10.0.50.0/24` | Local VPC Only (No Internet) |
| **Private DB Subnet 2** | `ap-south-1b` | `10.0.60.0/24` | Local VPC Only (No Internet) |

---

## 7. Configuration Examples
### Route 53 DNS Record with ALB Alias Target
```hcl
resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = "api.ecommerce.com"
  type    = "A"

  alias {
    name                   = aws_lb.public_alb.dns_name
    zone_id                = aws_lb.public_alb.zone_id
    evaluate_target_health = true
  }
}
```

---

## 8. Commands
```powershell
# Query VPC subnets in ap-south-1 via AWS CLI
aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-0123456789abcdef0" --region ap-south-1 --query "Subnets[*].[SubnetId,CidrBlock,AvailabilityZone]" --output table

# Verify EKS Cluster Status
aws eks describe-cluster --name ecommerce-cluster-prod --region ap-south-1 --query "cluster.status"

# Check RDS Multi-AZ Replication State
aws rds describe-db-instances --db-instance-identifier ecommerce-postgres-prod --region ap-south-1 --query "DBInstances[0].[DBInstanceStatus,MultiAZ,SecondaryAvailabilityZone]"
```

---

## 9. Verification
1. Run DNS lookup: `nslookup api.ecommerce.com` resolves to dual ALB public IPs.
2. Probe security: Try to connect to RDS directly from outside AWS (`telnet <rds-endpoint> 5432`) $\rightarrow$ Connection times out completely (verifying zero public accessibility).
3. Test AZ failover: Trigger `aws rds reboot-db-instance --db-instance-identifier ... --force-failover`. Verify application resumes read/write within 45 seconds.

---

## 10. Common Mistakes
1. **Single-AZ Deployments**: Deploying databases or Kubernetes node groups in only one Availability Zone. If that AZ has a transient AWS hardware incident, the application experiences full outage.
2. **Placing Databases in Public Subnets**: Assigning public IPs to RDS databases and relying only on security groups. Always place databases in dedicated private subnets with no internet route.
3. **Single NAT Gateway for Multi-AZ App**: Routing multiple AZs through a single NAT Gateway in `ap-south-1a`. If AZ-1a goes down, all outbound internet traffic from AZ-1b dies as well.

---

## 11. Troubleshooting
- **Pods Cannot Reach RDS (`Connection Timeout`)**: Security Group misconfiguration. Verify RDS Security Group contains an inbound rule allowing TCP 5432 with Source set to the **EKS Node Security Group ID** (not an IP address).
- **ALB Returning `502 Bad Gateway`**: The target Kubernetes pods are failing health check probes on port 8000, or the ALB cannot route to worker nodes. Check Target Group health in EC2 Console.

---

## 12. Security Best Practices
- **IAM Roles for Service Accounts (IRSA)**: Never attach AWS IAM policies to EC2 worker nodes directly. Use OIDC federated IRSA so individual Kubernetes pods get fine-grained IAM roles.
- **KMS Envelope Encryption**: Encrypt EBS volumes, S3 buckets, RDS storage, and ECR repositories with Customer Managed KMS Keys.
- **AWS GuardDuty & Security Hub**: Enable intelligent continuous threat detection and compliance benchmarking.

---

## 13. Real-World Use Cases
- **Amazon Prime Day / Flipkart Big Billion Days**: Platforms handle 100x traffic surges by scaling EC2 worker nodes automatically across 3 AZs while RDS Aurora handles read scaling via Read Replicas.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: Explain the difference between Security Groups and Network ACLs (NACLs) in AWS VPC.
**Answer**:
- **Security Groups**: Stateful firewalls operating at the EC2 instance / ENI level. Return traffic is automatically allowed regardless of inbound rules. Support only `ALLOW` rules.
- **Network ACLs**: Stateless firewalls operating at the Subnet boundary level. Inbound and outbound traffic must be explicitly permitted. Support both `ALLOW` and `DENY` rules, processed in numerical rule number order. They provide defense-in-depth before traffic ever reaches an instance ENI.

### Q2: What is AWS IAM Roles for Service Accounts (IRSA) and how does it work?
**Answer**: IRSA allows individual Kubernetes Pods to assume AWS IAM roles without giving permissions to the underlying EC2 node. EKS acts as an OpenID Connect (OIDC) identity provider. An IAM Role is created with a trust policy referencing the OIDC provider and the specific Kubernetes ServiceAccount name and namespace. When the pod starts, the AWS EKS mutating webhook injects a projection of the OIDC token into the pod (`AWS_WEB_IDENTITY_TOKEN_FILE`), allowing the AWS SDK inside the container to call `sts:AssumeRoleWithWebIdentity` and obtain temporary credentials.

### Q3: Why do we need both an Application Load Balancer and an Ingress Controller in Kubernetes?
**Answer**: The AWS ALB provides external high-availability, public TLS termination, DDoS integration with AWS WAF, and static IP allocation via Elastic IPs or Route 53. The in-cluster Ingress Controller (like Ingress-NGINX) runs inside Kubernetes, providing microservice-level path routing, rewrite rules, circuit breaking, and sub-millisecond internal routing directly to Pod IPs without creating a costly separate AWS ALB for every microservice.
