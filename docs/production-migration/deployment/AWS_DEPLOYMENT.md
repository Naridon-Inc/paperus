# AWS App Runner Deployment Guide

This guide explains how to deploy the `Naridon` monorepo to **AWS App Runner**, a fully managed service that makes it easy to run containers.

## 1. Prerequisites

1.  **AWS Account**: You must have access to the AWS Console.
2.  **AWS CLI** (Optional but recommended): `brew install awscli`.
3.  **Docker Image**: You have already built `naridon-prod`.

## 2. Push Image to Amazon ECR

Amazon ECR (Elastic Container Registry) is where your Docker images live.

### Step 2.1: Create Repository
1.  Go to **AWS Console** -> **Elastic Container Registry**.
2.  Click **Create repository**.
3.  Name: `naridon-prod`.
4.  Keep other settings default and click **Create**.

### Step 2.2: Push Image
Run these commands in your terminal (requires AWS CLI):

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Tag your local image
docker tag naridon-prod:latest <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/naridon-prod:latest

# Push
docker push <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/naridon-prod:latest
```

## 3. Deploy to AWS App Runner

App Runner will take the image from ECR and run it.

1.  Go to **AWS Console** -> **App Runner**.
2.  Click **Create service**.
3.  **Source**: "Container image".
4.  **URI**: Browse and select `naridon-prod:latest` from ECR.
5.  **Deployment settings**: Automatic (deploys when you push a new image).
6.  **Configuration**:
    *   **Port**: `3000`
    *   **CPU/Memory**: 1 vCPU / 2 GB (start small, scale up).
    *   **Environment Variables**: Add all your production secrets here.

### Required Environment Variables
*   `NODE_ENV`: `production`
*   `HOST`: `0.0.0.0`
*   `PORT`: `3000`
*   `DATABASE_URL`: `postgresql://...` (Your Production DB)
*   `SHOPIFY_API_KEY`: `...`
*   `SHOPIFY_API_SECRET`: `...`
*   `SHOPIFY_APP_URL`: The App Runner URL (e.g., `https://xyz.awsapprunner.com`). *Note: You'll get this URL after creation, so you might need to update it.*
*   `SCOPES`: `read_products,write_products,...`

## 4. Finalize Configuration

1.  **Wait for Deployment**: It takes 5-10 minutes.
2.  **Get URL**: Copy the "Default domain" (e.g., `https://x83jsd.us-east-1.awsapprunner.com`).
3.  **Update Configs**:
    *   Update `SHOPIFY_APP_URL` env var in App Runner configuration with this new domain.
    *   Update **Shopify Partner Dashboard** -> **App Setup** with this domain.

## 5. Multi-Platform Strategy (Future)

To enable Shopware/BigCommerce on the same instance:
1.  Update `Dockerfile.prod` to build those frontend apps too.
2.  Update `backend/src/index.ts` to serve them at specific prefixes (e.g., `/static/shopware`).
3.  Redeploy.
