# Cabin Poster — Railway Deployment Guide

## What this does
A backend API that:
- Reads your cabin images from Google Drive
- Generates AI captions via Claude
- Posts or schedules directly to your Facebook Page
- Understands natural language like "post the sunset image tonight at 8pm"

---

## Step 1 — Push to GitHub

1. Create a new repo at github.com (name it `cabin-poster`)
2. Run these commands in your terminal:

```bash
git init
git add .
git commit -m "Initial cabin poster backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cabin-poster.git
git push -u origin main
```

---

## Step 2 — Deploy on Railway

1. Go to railway.app → Login with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `cabin-poster` repo
4. Railway auto-detects Node.js and deploys

---

## Step 3 — Set Environment Variables on Railway

In your Railway project → **Variables** tab, add these:

| Variable | Value |
|----------|-------|
| FB_PAGE_ID | 460835390453165 |
| FB_PAGE_TOKEN | your Facebook Page token |
| ANTHROPIC_API_KEY | your Anthropic API key |
| GOOGLE_API_KEY | your Google API key |
| GOOGLE_DRIVE_FOLDER_ID | your Drive folder ID |

---

## Step 4 — Get a Google API Key

1. Go to console.cloud.google.com
2. Create a new project → Enable **Google Drive API**
3. Go to Credentials → Create API Key
4. Paste it into Railway variables

---

## Step 5 — Get your Railway URL

After deployment, Railway gives you a URL like:
`https://cabin-poster-production.up.railway.app`

Copy this — you'll paste it into the frontend app.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | / | Health check |
| GET | /images?folderId=XXX | List Drive images |
| POST | /generate | Generate caption |
| POST | /parse-instruction | Parse natural language |
| POST | /post | Post or schedule to Facebook |

---

## Scheduling Rules (Facebook)
- Minimum: 10 minutes in the future
- Maximum: 30 days in the future
- Timezone: Defaults to America/Los_Angeles (Harry's local time)
