# How to Install App Through Shopify Partners

This guide shows you how to properly install your app through Shopify Partners (not as a custom app) so that billing subscriptions work correctly.

---

## 🎯 Goal

Install your app through **Shopify Partners** so it shows:

- ✅ "Manage in Partners" link in store admin
- ✅ No "not listed in the Shopify App Store" warning
- ✅ Billing API works correctly

---

## 📋 Prerequisites

1. **Shopify Partners Account** - You need a Partners account at https://partners.shopify.com
2. **App Created in Partners** - Your app must exist in the Partners dashboard
3. **Development Store** - A dev store to test the app

---

## 🔧 Step-by-Step Installation

### Step 1: Verify App Exists in Partners Dashboard

1. Go to **https://partners.shopify.com** ([Shopify Partners](https://partners.shopify.com))
2. **Log in** with your Partners account
   - If you don't have a Partners account, click **"Sign up"** to create one (it's free)
3. Once logged in, look for **"Apps"** in the left sidebar navigation
4. Click **"Apps"** to see your list of apps
5. Look for your app (e.g., "mono-app")

**✅ If you see your app here, proceed to Step 2**

**❌ If you don't see your app, check these:**

#### Troubleshooting: Can't Find App

**Check 1: Are you in the right account?**

- Make sure you're logged into the correct Partners account
- If you have multiple accounts, check the account switcher (top right)
- The app might be in a different organization/account

**Check 2: Are you looking in the right place?**

- Make sure you clicked **"Apps"** in the left sidebar (not "Stores" or other sections)
- Some accounts show "Visit Dev Dashboard" button first - click it to see your apps
- Try going directly to: https://partners.shopify.com/organizations (shows all your organizations)

**Check 3: Does the app exist?**

- If you've never created the app in Partners, it won't exist
- You need to **create it first** (see "Creating App in Partners" section below)

**Check 4: Filter/Search**

- Use the search bar at the top to search for your app name
- Check if there are any filters applied that might hide your app
- Look for archived or inactive apps

---

### Step 2: Get the Installation URL

There are several ways to get the installation URL:

#### Option A: Using "Test on development store" Button

1. In your app's Partners dashboard, go to the **"Overview"** tab
2. Look for a button that says **"Test on development store"** or **"Install"**
3. Click it
4. Select your development store from the dropdown
5. This will start the installation process

#### Option B: Using the App URL

1. In your app's Partners dashboard, go to **"Setup"** or **"App setup"** tab
2. Find the **"App URL"** or **"App proxy URL"**
3. It should look like: `https://your-app-url.com` or `https://your-app-url.com/api/auth/shopify/install`
4. Copy this URL

#### Option C: Using the Shareable Link

1. In your app's Partners dashboard, look for **"Get shareable link"** or **"Installation link"**
2. Copy the link
3. It should look like: `https://partners.shopify.com/.../apps/.../install`

---

### Step 3: Uninstall Existing App (If Already Installed)

**⚠️ Important:** If the app is already installed as a custom app, you must uninstall it first.

1. Go to your **development store admin**
2. Navigate to **Settings** → **Apps and sales channels**
3. Find your app (e.g., "mono-app")
4. Click on it to open app details
5. Scroll down and click the red **"Uninstall app"** button
6. Confirm the uninstallation

**Why?** Custom apps and Partner apps are different. You need to remove the custom app before installing the Partner app.

---

### Step 4: Install Through Partners URL

#### Method 1: Direct Installation via Partners Dashboard

1. In Partners dashboard → Your app → **"Overview"** tab
2. Click **"Test on development store"** button
3. Select your development store
4. You'll be redirected to the OAuth flow
5. Approve the installation

#### Method 2: Manual Installation via URL

1. Open a new browser tab
2. Navigate to your app's installation URL:

   ```
   https://your-app-url.com/api/auth/shopify/install?shop=YOUR-STORE.myshopify.com
   ```

   Replace:
   - `your-app-url.com` with your actual app URL
   - `YOUR-STORE.myshopify.com` with your dev store domain

3. You'll be redirected to Shopify's OAuth page
4. Click **"Install app"** or **"Allow"**
5. Complete the OAuth flow

---

### Step 5: Verify Installation

After installation, verify it's correctly installed:

#### ✅ Check 1: Store Admin - App Details

1. Go to your **development store admin**
2. Navigate to **Settings** → **Apps and sales channels**
3. Find your app and click on it
4. **Look for:**
   - ✅ **"Manage in Partners"** link (this confirms Partner-owned app)
   - ❌ **Should NOT see:** "This app is not listed in the Shopify App Store" warning

#### ✅ Check 2: Run Test Script

Run the automated test script:

```bash
cd backend
pnpm test:subscription <your-shop-domain>
```

**Expected output:**

```
✅ Verify App Installation: App is properly installed and Partner-owned
```

If you see this, the app is correctly installed!

#### ✅ Check 3: Check App Status API

Call the app status endpoint:

```bash
GET /api/v1/billing/app-status
Authorization: Bearer <your-token>
```

**Expected response:**

```json
{
  "canCreateBilling": true,
  "billingError": null
}
```

---

## 🆕 Creating App in Partners (If Not Exists)

**If you can't find your app in Partners, you need to create it first.**

### Step 1: Navigate to Apps Section

1. Go to **https://partners.shopify.com** ([Shopify Partners](https://partners.shopify.com))
2. Log in with your Partners account
3. Click **"Apps"** in the left sidebar
4. You should see a list of apps (or an empty state if you have no apps)

### Step 2: Create New App

1. Click the **"Create app"** button (usually a prominent button on the Apps page)
2. You'll see two options:
   - **"Custom app"** - For development/testing (recommended for now)
   - **"Public app"** - For production/App Store listing
3. Choose **"Custom app"** for development
4. Fill in the app details:
   - **App name**: e.g., "mono-app" or "Naridon App"
   - **App URL**: Your app's main URL
     - Example: `https://your-app-url.com`
     - Or: `https://your-app-url.com/app`
   - **Allowed redirection URL(s)**: Your OAuth callback URLs
     - Example: `https://your-app-url.com/api/auth/shopify/callback`
     - Or: `https://your-app-url.com/api/auth/shopify/auth/callback`
5. Click **"Create app"** or **"Save"**

**Note:** If you're not sure about the URLs, you can update them later in the app settings.

### Step 2: Configure App Settings

After creating the app, you'll be taken to the app's dashboard. Configure the settings:

1. Go to **"App setup"** or **"Setup"** tab (in the app's dashboard)
2. Configure the following:

   **App URL:**
   - This is where your app is hosted
   - Example: `https://your-app-url.com` or `https://your-app-url.com/app`
   - This is the main entry point for your app

   **Allowed redirection URL(s):**
   - These are your OAuth callback URLs
   - Add each callback URL on a new line or as separate entries
   - Common callback URLs:
     - `https://your-app-url.com/api/auth/shopify/callback`
     - `https://your-app-url.com/api/auth/shopify/auth/callback`
     - `https://your-app-url.com/auth/callback`
   - Check your backend code to find the exact callback path

3. **Save** or **Update** the settings

**💡 Tip:** If you're using Shopify CLI or have a local dev setup, you might also need to add localhost URLs for development:

- `http://localhost:3000/api/auth/shopify/callback`

### Step 3: Get API Credentials

1. In the app dashboard, go to **"Settings"** or **"Credentials"** tab
2. You'll see:
   - **Client ID** (this is your API Key)
   - **Client secret** (this is your API Secret)
3. **Copy both values** - you'll need them for your `.env` file
4. Update your `.env` file in the project root or backend directory:
   ```bash
   SHOPIFY_API_KEY=your-client-id-here
   SHOPIFY_API_SECRET=your-client-secret-here
   ```

**⚠️ Important:**

- Keep these credentials secure
- Never commit them to git
- The Client secret is only shown once - copy it immediately
- If you lose the secret, you can regenerate it (but you'll need to update your `.env`)

### Step 4: Install the App

Follow **Step 4** above to install the app in your dev store.

---

## 🔍 Troubleshooting

### Issue: "Manage in Partners" link not showing

**Possible causes:**

- App was installed as custom app (not through Partners)
- App installation didn't complete properly

**Solution:**

1. Uninstall the app completely
2. Reinstall using Partners dashboard (Step 4)
3. Verify installation (Step 5)

---

### Issue: Still seeing "not listed in the Shopify App Store" warning

**This means:** App is still installed as a custom app

**Solution:**

1. Uninstall the app (Step 3)
2. Make sure you're installing through Partners URL, not creating a custom app
3. Use the Partners dashboard "Test on development store" button
4. Verify after installation (Step 5)

---

### Issue: Can't find "Test on development store" button

**Possible reasons:**

- App might be in a different state
- You might need to publish the app version first

**Alternative:**

1. Go to **"Setup"** tab
2. Find the **App URL**
3. Manually construct the installation URL:
   ```
   https://your-app-url.com/api/auth/shopify/install?shop=YOUR-STORE.myshopify.com
   ```
4. Open this URL in your browser

---

### Issue: OAuth redirect errors

**Check:**

1. **Allowed redirection URL(s)** in Partners dashboard must include:
   - `https://your-app-url.com/api/auth/shopify/callback`
   - Or your actual callback URL
2. **App URL** must match your actual app URL
3. **API credentials** in `.env` must match Partners dashboard

---

## ✅ Success Checklist

After installation, verify all of these:

- [ ] App shows "Manage in Partners" link in store admin
- [ ] No "not listed in the Shopify App Store" warning
- [ ] Test script shows: "App is properly installed and Partner-owned"
- [ ] `/api/v1/billing/app-status` returns `canCreateBilling: true`
- [ ] Can create test subscriptions without errors

---

## 🚀 Next Steps

Once the app is properly installed:

1. **Test subscriptions** using the pricing page
2. **Run the test script** to verify everything works
3. **Set up webhooks** in Partners dashboard (for automatic DB updates)
4. **Test subscription flows** (upgrade, downgrade, cancel)

---

## 📝 Quick Reference

**Partners Dashboard:** https://partners.shopify.com
**Installation URL Format:** `https://your-app-url.com/api/auth/shopify/install?shop=STORE.myshopify.com`
**Test Script:** `pnpm test:subscription <shop-domain>`
**App Status API:** `GET /api/v1/billing/app-status`

---

## 🔄 Resetting App for Different Partner Account

If you need to install your app in a **different Shopify Partner account**, follow these steps:

### Step 1: Uninstall App from Current Store

1. Go to your **development store admin** (the store where the app is currently installed)
2. Navigate to **Settings** → **Apps and sales channels**
3. Find your app and click on it
4. Scroll down and click the red **"Uninstall app"** button
5. Confirm the uninstallation

**Note:**

- This removes the app from the store, but doesn't affect the app in Partners
- The shop data in your database will be marked as `SUSPENDED` (not deleted)
- When you reinstall with new credentials, the shop will be reactivated automatically

### Step 2: Get New Partner Account Credentials

1. **Log in to the NEW Partner account** at https://partners.shopify.com
2. Navigate to **Apps** → Select your app (or create a new one if needed)
3. Go to **"Settings"** or **"Credentials"** tab
4. Copy the **Client ID** (API Key) and **Client secret** (API Secret)

### Step 3: Update Environment Variables

Update your `.env` file with the new credentials from the new Partner account:

```bash
# Old credentials (from previous partner account)
# SHOPIFY_API_KEY=old-client-id-here
# SHOPIFY_API_SECRET=old-client-secret-here

# New credentials (from new partner account)
SHOPIFY_API_KEY=new-client-id-here
SHOPIFY_API_SECRET=new-client-secret-here
```

**⚠️ Important:**

- Make sure to update **both** `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`
- The credentials must match the app in the new Partner account
- **Restart your backend server** after updating `.env` (the server reads env vars on startup)
- If using Docker, restart the container: `docker-compose restart base`

### Step 4: Verify App Configuration in New Partner Account

In the new Partner account's app dashboard:

1. Go to **"Setup"** or **"App setup"** tab
2. Verify the **App URL** matches your actual app URL:
   - Example: `https://your-app-url.com` or `https://your-app-url.com/app`
3. Verify **Allowed redirection URL(s)** includes your callback URL:
   - Example: `https://your-app-url.com/api/auth/shopify/callback`
4. **Save** any changes if needed

### Step 5: Install App in New Partner Account

1. In the new Partner account dashboard → Your app → **"Overview"** tab
2. Click **"Test on development store"** button
3. Select your development store
4. Complete the OAuth flow

**OR** use the manual installation URL:

```
https://your-app-url.com/api/auth/shopify/install?shop=YOUR-STORE.myshopify.com
```

### Step 6: Verify Installation

After installation, verify it's correctly installed:

1. **Check store admin:**
   - Go to **Settings** → **Apps and sales channels**
   - Click on your app
   - Should see ✅ **"Manage in Partners"** link
   - Should NOT see ❌ "not listed in the Shopify App Store" warning

2. **Run test script:**

   ```bash
   cd backend
   pnpm test:subscription <your-shop-domain>
   ```

3. **Check app status API:**
   ```bash
   GET /api/v1/billing/app-status
   ```
   Should return: `{ "canCreateBilling": true, "billingError": null }`

---

## 💡 Key Differences

| Custom App                  | Partner App                     |
| --------------------------- | ------------------------------- |
| Created in store admin      | Created in Partners dashboard   |
| Shows "not listed" warning  | Shows "Manage in Partners" link |
| ❌ Billing API doesn't work | ✅ Billing API works            |
| Shop-owned                  | Partner-owned                   |

**Always use Partner App for billing functionality!**
