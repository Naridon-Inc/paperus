# Can't Find Your App in Partners Dashboard?

If you can't see your app on [Shopify Partners](https://partners.shopify.com), follow these steps:

---

## 🔍 Step-by-Step: Finding Your App

### Step 1: Verify You're Logged In

1. Go to **https://partners.shopify.com**
2. Make sure you're **logged in**
3. If not logged in, click **"Log in"** and sign in with your Partners account

### Step 2: Check the Right Section

1. Look at the **left sidebar** navigation
2. Click **"Apps"** (not "Stores" or other sections)
3. This should show your list of apps

### Step 3: Look for "Visit Dev Dashboard" Button

Some Partners accounts show a **"Visit Dev Dashboard"** button first:

1. If you see this button, **click it**
2. This will take you to your development dashboard
3. Then click **"Apps"** in the sidebar

### Step 4: Check All Organizations

If you're part of multiple organizations:

1. Click on your **profile/account** (top right)
2. Look for **"Organizations"** or **"Switch organization"**
3. Or go directly to: **https://partners.shopify.com/organizations**
4. Check each organization to see which one has your app

### Step 5: Search for Your App

1. Use the **search bar** at the top of the Partners dashboard
2. Search for your app name (e.g., "mono-app")
3. Or search by API key if you know it

---

## ❌ If You Still Can't Find It

### The App Doesn't Exist Yet

**If you've never created the app in Partners, it won't exist.** You need to create it:

1. Go to **https://partners.shopify.com** → **"Apps"**
2. Click **"Create app"** button
3. Choose **"Custom app"** (for development)
4. Fill in:
   - **App name**: Your app name
   - **App URL**: Your app's URL
   - **Allowed redirection URL(s)**: Your callback URLs
5. Click **"Create app"**

See [`INSTALL_APP_PARTNERS.md`](./INSTALL_APP_PARTNERS.md) for detailed creation steps.

---

## 🔑 What If You Have the API Key?

If you have the API key (Client ID) from your `.env` file:

1. The API key looks like: `75728b3b8f96c5a928be52d18c544f6c`
2. Go to Partners dashboard → **"Apps"**
3. Use the search bar to search for the first 8 characters: `75728b3b`
4. This might help you find the app

**If you find it:**
- The app exists, you just need to locate it
- Click on it to open the app dashboard

**If you don't find it:**
- The app might be in a different Partners account
- Or the app was never created in Partners
- You'll need to create it (see above)

---

## 🆘 Still Stuck?

### Check These Common Issues:

1. **Wrong Account**
   - Are you logged into the correct Partners account?
   - The app might be in a different account/email

2. **App Was Never Created**
   - If you only have a custom app (created in store admin), it won't be in Partners
   - You need to create it in Partners first

3. **App Was Deleted**
   - Check if there's a "Deleted apps" or "Archived" section
   - Apps might be archived but not deleted

4. **Different Organization**
   - If you're part of a team, the app might be in a different organization
   - Check all organizations you have access to

---

## ✅ Quick Checklist

- [ ] Logged into Partners dashboard
- [ ] Clicked "Apps" in left sidebar
- [ ] Clicked "Visit Dev Dashboard" if shown
- [ ] Checked all organizations
- [ ] Searched for app name or API key
- [ ] Checked if app needs to be created

---

## 🚀 Next Steps

Once you find (or create) your app:

1. **Get the API credentials** (Client ID and Secret)
2. **Update your `.env` file** with the credentials
3. **Install the app** in your dev store through Partners
4. **Verify installation** using the test script

See [`INSTALL_APP_PARTNERS.md`](./INSTALL_APP_PARTNERS.md) for complete installation guide.
