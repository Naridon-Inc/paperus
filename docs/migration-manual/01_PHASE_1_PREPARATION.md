# Phase 1: Preparation (Workspaces & Libs)

**Goal:** Establish the foundational libraries (`libs/queue` and `libs/search`) in the production backend.

## Step 1: Create Library Directories

We need to create the destination folders for the new libraries.

```bash
mkdir -p backend/libs/queue
mkdir -p backend/libs/search
```

## Step 2: Copy Source Code

Copy the library implementations from the reference repository.

### Queue Library
```bash
cp -r temp_reference/backend/libs/queue/* backend/libs/queue/
```

### Search Library
```bash
cp -r temp_reference/backend/libs/search/* backend/libs/search/
```

## Step 3: Update Workspace Configuration

You must register the new libraries in the `pnpm-workspace.yaml` file so the package manager knows about them.

**File:** `backend/pnpm-workspace.yaml`

**Action:** Add the following lines to the `packages` list if they are not implicitly covered (e.g. by `libs/*`):

```yaml
packages:
  - 'application/*'
  - 'delivery/*'
  - 'domain'
  - 'infrastructure'
  - 'libs/*'       # <--- This likely covers it, but verify.
```

**Verification:**
Run `ls backend/libs` to confirm `queue` and `search` are present.

## Step 4: Install Dependencies

Run the installation command from the `backend` root to link the new packages and install their internal dependencies.

```bash
cd backend
pnpm install
```

## Step 5: Validation

Verify that the new libraries build correctly.

```bash
cd backend/libs/queue
pnpm build

cd ../search
pnpm build
```

If the build succeeds, Phase 1 is complete.
