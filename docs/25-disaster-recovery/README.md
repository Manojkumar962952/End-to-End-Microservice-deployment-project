# Chapter 25: Disaster Recovery (DR), Business Continuity & Multi-Region Strategies

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               DISASTER RECOVERY ARCHITECTURAL TIERS                       |
+───────────────────────────────────────────────────────────────────────────────────────────+
| 1. BACKUP & RESTORE           RPO: 24 Hours | RTO: 24 Hours | Cost: $                     |
|    • Daily automated EBS/RDS snapshots copied to secondary S3 bucket.                     |
|                                                                                           |
| 2. PILOT LIGHT                RPO: Minutes  | RTO: 2-4 Hours| Cost: $$                    |
|    • Core database replicated synchronously to secondary region (ap-southeast-1).         |
|    • Zero compute nodes running; spun up via Terraform on disaster trigger.               |
|                                                                                           |
| 3. WARM STANDBY               RPO: Seconds  | RTO: Minutes  | Cost: $$$                   |
|    • Minimal EKS cluster and RDS replica running in secondary region (Mumbai + Singapore).|
|    • Scales up compute dynamically when Route 53 flips DNS.                               |
|                                                                                           |
| 4. MULTI-SITE ACTIVE-ACTIVE   RPO: 0 (Zero) | RTO: 0 (Zero) | Cost: $$$$                  |
|    • Full traffic split 50/50 across both regions simultaneously.                         |
|    • Aurora Global Database + Global Accelerator / Route 53 latency routing.              |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Disaster Recovery (DR) and Business Continuity Planning (BCP) is the comprehensive set of policies, tools, automation procedures, and architectural redundancy models that enable an enterprise to recover its technology infrastructure, data, and business operations following natural disasters, widespread cloud region failures, ransomware attacks, or human catastrophes.

---

## 2. Why Do Companies Prioritize It?
- **Catastrophic Cloud Outages**: Major cloud regions have experienced multi-hour fiber cuts, cooling failures, and routing blackouts. Businesses without a DR plan face total revenue loss.
- **RPO and RTO Guarantees**:
  - **RPO (Recovery Point Objective)**: The maximum acceptable age of data that can be lost when a disaster occurs (e.g. at most 5 minutes of orders).
  - **RTO (Recovery Time Objective)**: The maximum acceptable duration of time to restore service after a disaster (e.g. platform must be back online within 15 minutes).
- **Insurance & Regulatory Mandates**: Financial institutions and healthcare platforms face severe legal revocation of licenses if certified multi-region DR capabilities are absent.

---

## 3. What Problem Does It Solve?
- **Data Loss via Ransomware / Account Compromise**: Backups stored in the same AWS account can be deleted by a compromised root key. DR requires **AWS Backup Cross-Account, Cross-Region replication** with S3 Vault Lock.
- **DNS Propagation Delays**: Long TTLs prevent customers from reaching the new region during an outage. Route 53 Application Recovery Controller provides instant traffic redirection.
- **Brain-Split in Multi-Region Databases**: Prevents split-brain scenarios where two regions write conflicting data to the same database simultaneously during a network partition.

---

## 4. How Does It Work Internally?
1. **Asynchronous Cross-Region Replication**:
   - Primary Region: AWS `ap-south-1` (Mumbai).
   - DR Region: AWS `ap-southeast-1` (Singapore).
   - Amazon Aurora Global Database replicates storage blocks across regions in under 1 second using dedicated AWS private WAN infrastructure.
2. **Route 53 Application Recovery Controller (ARC)**:
   - Uses five redundant zonal routing control endpoints to guarantee traffic switching even if parts of Route 53 or an entire AWS region are completely down.
3. **Automated Terraform Infrastructure Hydration**:
   - Golden AMI images, Helm charts, and container images are pre-replicated across ECR registries in both regions.

---

## 5. Where Does It Fit in Our Architecture?
- **Primary Site**: `ap-south-1` (Mumbai) hosting production EKS, RDS, ElastiCache, and ALB.
- **Secondary DR Site**: `ap-southeast-1` (Singapore) configured in **Warm Standby** mode.
- **Route 53 DNS Failover**: Continuous health checking of Mumbai ALB. If 3 consecutive health checks fail, Route 53 automatically flips DNS alias to the Singapore ALB.

---

## 6. How We Implemented It in This Project
### Route 53 Active-Passive Health Check & Failover Routing:

```hcl
resource "aws_route53_health_check" "primary_mumbai" {
  fqdn              = "api-mumbai.ecommerce.com"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/v1/orders/health"
  failure_threshold = 3
  request_interval  = 10
}

resource "aws_route53_record" "api_primary" {
  zone_id         = aws_route53_zone.primary.zone_id
  name            = "api.ecommerce.com"
  type            = "A"
  set_identifier  = "primary-mumbai"

  failover_routing_policy {
    type = "PRIMARY"
  }

  alias {
    name                   = aws_lb.mumbai_alb.dns_name
    zone_id                = aws_lb.mumbai_alb.zone_id
    evaluate_target_health = true
  }

  health_check_id = aws_route53_health_check.primary_mumbai.id
}

resource "aws_route53_record" "api_secondary" {
  zone_id         = aws_route53_zone.primary.zone_id
  name            = "api.ecommerce.com"
  type            = "A"
  set_identifier  = "secondary-singapore"

  failover_routing_policy {
    type = "SECONDARY"
  }

  alias {
    name                   = aws_lb.singapore_alb.dns_name
    zone_id                = aws_lb.singapore_alb.zone_id
    evaluate_target_health = true
  }
}
```

---

## 7. Configuration Examples
### AWS Backup Cross-Region Vault Plan (`infra/terraform/modules/backup/main.tf`):
```hcl
resource "aws_backup_plan" "cross_region_plan" {
  name = "ecommerce-dr-backup-plan"

  rule {
    rule_name         = "daily-backup-replicate-singapore"
    target_vault_name = aws_backup_vault.mumbai_vault.name
    schedule          = "cron(0 12 * * ? *)"

    copy_action {
      destination_vault_arn = "arn:aws:backup:ap-southeast-1:123456789012:backup-vault:singapore-vault"
      lifecycle {
        delete_after = 30
      }
    }
  }
}
```

---

## 8. Commands
```powershell
# Promote RDS Aurora Global Database read replica in secondary region to primary standalone cluster
aws rds failover-global-cluster --global-cluster-identifier ecommerce-global-db --target-db-cluster-identifier arn:aws:rds:ap-southeast-1:123456789012:cluster:ecommerce-singapore-cluster

# Manually trigger Route 53 Application Recovery Controller routing control toggle
aws route53-recovery-control-config update-routing-control-states --routing-control-states-entries "[{\"RoutingControlArn\":\"arn:aws:route53-recovery-control::...\", \"RoutingControlState\":\"Off\"}]"

# Verify cross-region snapshot replication status
aws backup list-recovery-points-by-backup-vault --backup-vault-name singapore-vault --region ap-southeast-1
```

---

## 9. Verification
1. Run quarterly Disaster Recovery Drill:
   - Simulate a total regional failure by blocking egress to `ap-south-1`.
   - Verify Route 53 health check detects failure within 30 seconds.
   - Verify DNS automatically flips to `ap-southeast-1`.
   - Execute promotion script for Aurora Singapore replica.
   - Run checkout test; confirm order succeeds in Singapore cluster.
2. Calculate empirical RTO and RPO from drill logs.

---

## 10. Common Mistakes
1. **Never Testing Disaster Recovery Plans**: Having an extensive DR document that has never been tested in a live drill. When a real disaster occurs, scripts fail due to expired credentials or outdated Terraform code.
2. **Hardcoded Regional ARNs in Scripts**: Scripts failing because they contain hardcoded `ap-south-1` region strings or subnet IDs.
3. **Ignoring Asynchronous Replication Lag**: Promoting a replica without verifying replication lag. If the replica is 5 minutes behind, promoting it causes 5 minutes of data loss.

---

## 11. Troubleshooting
- **Split-Brain Disaster Scenario**: Both Mumbai and Singapore clusters believe they are primary and accept writes simultaneously. Resolve by designating the primary authoritative dataset, freezing writes on the other, running an offline data reconciliation script, and demoting the secondary back to read-only replica.

---

## 12. Security Best Practices
- **Cross-Account Backup Isolation**: Store secondary backups in a completely separate AWS account with an SCP preventing deletion even by AWS account administrators.
- **Enforce AWS S3 Vault Lock (WORM Compliance)**: Prevent ransomware from overwriting or encrypting backups.

---

## 13. Real-World Use Cases
- **GitLab 2017 Database Outage**: GitLab accidentally deleted primary database directories during maintenance and discovered that 4 out of 5 backup mechanisms had silently failed months earlier. They restored from an old staging snapshot, losing hours of user data. This landmark incident established the modern standard of automated daily DR verification.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the exact difference between RPO and RTO?
**Answer**:
- **RPO (Recovery Point Objective)**: Quantifies the maximum acceptable *data loss* measured in units of time. If your RPO is 15 minutes, your backup/replication strategy must ensure you never lose more than 15 minutes of transactional data when an outage strikes.
- **RTO (Recovery Time Objective)**: Quantifies the maximum acceptable *downtime* measured in units of time. If your RTO is 1 hour, your automation, deployment pipelines, and failover mechanisms must restore operational service to users within 60 minutes of disaster declaration.

### Q2: Compare the Pilot Light and Warm Standby Disaster Recovery strategies.
**Answer**:
- **Pilot Light**: The critical core data layer (database) is continuously replicated to the secondary region, but application compute resources (Kubernetes worker nodes, Pods) are NOT running. When disaster strikes, compute is provisioned from scratch via Terraform. RTO is typically 1–3 hours; cost is very low.
- **Warm Standby**: A minimal, scaled-down version of the entire platform (small EKS cluster, 1 replica of each microservice, and a warm database replica) is running 24/7 in the secondary region. When disaster strikes, Route 53 flips traffic, and Horizontal Pod Autoscalers scale the cluster to full production capacity within minutes. RTO is 5–15 minutes; cost is moderate.

### Q3: What is the Split-Brain problem in multi-region database replication and how do you prevent it?
**Answer**: Split-brain occurs when a network partition disconnects two database clusters, causing both to believe the other has died and promote themselves to read-write primaries. Clients write different data to both sides, corrupting data integrity. It is prevented by:
1. Quorum-based consensus algorithms (Raft or Paxos requiring $N/2 + 1$ majority before accepting writes).
2. Centralized distributed locking via external witnesses (such as a third independent AWS region).
3. Strict fencing tokens where the secondary cannot accept writes until it cryptographically confirms the primary has been fenced (shut down).
