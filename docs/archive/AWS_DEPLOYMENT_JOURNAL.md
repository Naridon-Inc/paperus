# Naridon AWS Deployment Journal

This document provides a chronological record of the steps taken to deploy the Naridon monorepo to production on AWS and resolve the various technical hurdles encountered.

---

## Phase 1: DNS & Custom Domain Setup
*Goal: Point app.naridon.com to AWS and naridon.com to Vercel.*

1.  **AWS Route 53 Migration**: 
    *   Created a Public Hosted Zone for `naridon.com` in AWS Route 53.
    *   Updated **Namecheap** Nameservers to point to the 4 AWS Nameservers provided by Route 53.
2.  **Custom Subdomain for Backend**:
    *   Linked `app.naridon.com` to the AWS App Runner default domain (`ezysqh3j5p.eu-central-1.awsapprunner.com`) via a CNAME record.
    *   Added **SSL Validation Records** (CNAMEs) in Route 53 provided by App Runner to enable HTTPS.
3.  **Root Domain for Frontend**:
    *   Pointed the root domain `naridon.com` to Vercel using an **A Record** (`76.76.21.21`).
    *   Added `www` CNAME pointing to `cname.vercel-dns.com`.

---

## Phase 2: Resolving Deployment Blockers
*Goal: Fix container crashes and frontend configuration errors.*

1.  **Architecture Fix (Exit 255)**:
    *   **Issue**: Containers failed to start with `exec format error`.
    *   **Reason**: Images were built on Apple Silicon (ARM64) but App Runner required Standard Linux (AMD64).
    *   **Fix**: Updated the build command to use `--platform linux/amd64`.
2.  **CSP Header Fix**:
    *   **Issue**: Shopify Admin refused to connect (Iframe blocking).
    *   **Fix**: Updated `backend/libs/restapi/src/plugins.ts` to include `frameAncestors` in the Content Security Policy, allowing `*.myshopify.com` and `admin.shopify.com`.
3.  **Frontend Config Injection Fix**:
    *   **Issue**: App showed "Missing Shopify configuration" because the API Key was `undefined`.
    *   **Fix**: 
        *   Updated `vite.config.ts` to correctly resolve `VITE_SHOPIFY_API_KEY`.
        *   Updated `Dockerfile.prod` to prepend the environment variable directly to the build command to ensure Vite bakes it into the JS bundle.
4.  **Prisma Engine Fix (Exit 1)**:
    *   **Issue**: Backend crashed because Prisma couldn't find the query engine for `debian-openssl-3.0.x`.
    *   **Fix**: Added `debian-openssl-3.0.x` to `binaryTargets` in `backend/libs/db/prisma/schema/base.prisma`.

---

## Phase 3: Database & Production Sync
*Goal: Ensure the live RDS database is ready for traffic.*

1.  **RDS Table Creation**: 
    *   Executed `prisma db push` against the production RDS instance (`naridon-db-prod`) to create the required tables for Shopify sessions and app data.
2.  **Migration History Sync**: 
    *   Used `prisma migrate resolve` to mark existing baseline migrations as "applied" in the production database, preventing conflicts with future updates.

---

## Phase 4: Security & Secret Hardening (REFINED)
*Goal: Move all sensitive keys from plaintext to encrypted AWS storage.*

1.  **SSM Parameter Store Setup**:
    *   Created 14 secrets (DB URL, Shopify Secrets, AI API Keys, integration tokens) as `SecureString` in AWS SSM.
    *   Identified and fixed an ARN mismatch where App Runner required specific path formats for secrets.
2.  **KMS Encryption**:
    *   Created a **Customer Managed KMS Key** to provide granular control over secret decryption.
    *   Re-encrypted all SSM parameters using this new key to bypass default AWS key policy limitations.
3.  **Cross-Role IAM Configuration**:
    *   **Access Role**: Updated `AppRunnerECRAccessRole` with permissions to pull secrets during the "Provisioning" phase. This was the missing link that caused previous rollbacks.
    *   **Instance Role**: Configured `NaridonAppRunnerInstanceRole` for runtime decryption.
4.  **JWT Secret Security**:
    *   Generated a cryptographically secure 48-byte random string using OpenSSL.
    *   Updated the live app to use this secure key instead of placeholders.

## Phase 5: Repository & Workflow Security
*Goal: Protect the codebase and improve developer experience.*

1.  **Git Cleanup**:
    *   Purged `backend/.env` and `shopify.app.toml` from Git history tracking.
    *   Updated `.gitignore` to prevent any future accidental leaks of production or local environment files.
2.  **Developer Experience**:
    *   Created `.env.example` as a template for new contributors.
    *   Stabilized local development (`pnpm dev:m`) to use local DB/test keys while production runs independently.

---

## Phase 6: Pricing & Billing Update Deployment
*Goal: Deploy the fixes requested by Shopify App Review team.*

1.  **Code Updates**: 
    *   Fixed missing free trial in billing modal (7-day trial now defaults).
    *   Synced yearly pricing display to match Shopify billing modal ($468/yr, $2388/yr).
    *   Enabled standard Shopify billing flow for Enterprise plan to satisfy review requirements.
2.  **Image Build & Push**:
    *   Built Docker image using `--platform linux/amd64` to ensure compatibility with App Runner.
    *   Tagged as `latest` and pushed to ECR: `432013884601.dkr.ecr.eu-central-1.amazonaws.com/naridon-prod:latest`.
3.  **App Runner Update**:
    *   Manually triggered deployment for `naridon-app` service.
    *   Status: **OPERATION_IN_PROGRESS**.

---

## Current Status (January 28, 2026)
*   **Backend**: DEPLOYING (v1.0.5).
*   **Frontend**: LIVE at `naridon.com`.
*   **Security State**: **HARDENED**.
*   **App Status**: Pending re-review from Shopify.

**Version: 1.0.5** 🛡️🚀🦾

