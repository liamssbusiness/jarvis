# JARVIS Dashboard — Vercel Deployment Guide

## Step 1: Install GitHub Desktop (if not installed)
Download from: https://desktop.github.com/

## Step 2: Create a GitHub Repository
1. Go to https://github.com/new
2. Repository name: `jarvis-dashboard`
3. Set to **Private**
4. Click **Create repository**

## Step 3: Push the code
In your terminal (from the `cyber-jarvis` folder):
```bash
git init
git add .
git commit -m "JARVIS v2.0 initial"
git branch -M main
git remote add origin https://github.com/liamssbusiness/jarvis-dashboard.git
git push -u origin main
```

## Step 4: Deploy to Vercel
1. Go to https://vercel.com
2. Click **Add New Project**
3. Import `liamssbusiness/jarvis-dashboard` from GitHub
4. **IMPORTANT**: Add Environment Variables before deploying:
   - `ANTHROPIC_API_KEY` = your Anthropic key
   - `NEWS_API_KEY` = your NewsAPI key
5. Click **Deploy**

## Step 5: Access from any device
Your dashboard will be live at: `https://jarvis-dashboard.vercel.app`

Bookmark this URL on your:
- PC: Chrome/Edge bookmark
- MacBook: Safari/Chrome bookmark  
- iPhone: Safari → Share → Add to Home Screen (makes it feel like an app)

## Updating the dashboard
Whenever you want to update something, tell JARVIS (me, Claude):
> "Update the dashboard to..."

I'll make the changes and you push them:
```bash
git add .
git commit -m "Update description"
git push
```
Vercel auto-deploys on every push. Updates go live in ~30 seconds.

## Running locally for development
```bash
npm install
npx vercel dev
```
Open http://localhost:3000
