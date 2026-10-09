# 📸 PassportSnap — Professional Passport Photo Tool

A complete, monetization-ready passport photo web app built with Node.js, Express, and Sharp.

Website: https://tookit.in

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd passport-photo-tool
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Start the Server
```bash
npm start
# or for development:
npm run dev
```

Visit: **http://localhost:3000**

---

## 🔑 API Keys (for Background Removal)

### Option A: remove.bg (50 free calls/month)
1. Sign up at https://www.remove.bg/api
2. Copy your API key to `.env`:
   ```
   REMOVE_BG_API_KEY=your_key_here
   ```

### Option B: PhotoRoom (100 free calls/month)
1. Sign up at https://www.photoroom.com/api
2. Copy your API key to `.env`:
   ```
   PHOTOROOM_API_KEY=your_key_here
   ```

> **Note:** Without an API key, the tool still works perfectly — it processes, resizes, and enhances photos without background removal.

---

## 💰 Monetization (How to Make Money)

### 1. Google AdSense (Easiest)
- Sign up at https://adsense.google.com
- Replace the ad placeholder divs in `public/index.html` with your AdSense code:
  ```html
  <!-- Replace this block -->
  <div class="ad-placeholder">...</div>
  
  <!-- With your AdSense script -->
  <ins class="adsbygoogle" style="display:block" 
       data-ad-client="ca-pub-XXXXX" 
       data-ad-slot="XXXXX" 
       data-ad-format="auto"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  ```

### 2. Premium Features (Freemium Model)
Add a paywall for:
- HD/4K export (currently free at 600 DPI)
- Unlimited background removal (limit free users to 3/day)
- Bulk processing (multiple photos at once)
- Express delivery / priority processing

### 3. Pay Per Use
Charge $0.99–$2.99 per print sheet download using Stripe:
```bash
npm install stripe
```

### 4. Subscription
- Basic: Free (5 photos/day, watermarked)  
- Pro: $4.99/month (unlimited, no watermark)

---

## 🌍 Supported Passport Sizes

| Country | Size | DPI |
|---------|------|-----|
| India | 35×45mm | 600 |
| USA | 50×50mm (2×2") | 600 |
| UK | 35×45mm | 600 |
| EU/Schengen | 35×45mm | 600 |
| China | 33×48mm | 600 |
| Australia | 35×45mm | 600 |
| Canada | 50×70mm | 600 |
| UAE | 40×60mm | 600 |
| Visa 2×2 | 51×51mm | 600 |

---

## 🛠 Features

- ✅ Upload photos (JPG, PNG, WEBP up to 10MB)
- ✅ 9+ passport size presets for different countries
- ✅ AI background removal (via remove.bg or PhotoRoom API)
- ✅ Custom background colors (white, blue, gray, custom)
- ✅ Auto face positioning and smart cropping
- ✅ Image enhancement (sharpening, saturation boost)
- ✅ 600 DPI output (government-grade quality)
- ✅ Print-ready A4 sheet with 2–6 photos
- ✅ One-click print functionality
- ✅ Auto file cleanup (photos deleted after 1 hour)
- ✅ Mobile-responsive design
- ✅ Ad placement zones for monetization

---

## 📁 Project Structure

```
passport-photo-tool/
├── server.js              # Express server
├── routes/
│   └── photo.js           # Photo processing API
├── public/
│   ├── index.html         # Frontend UI
│   ├── css/style.css      # Styles
│   └── js/app.js          # Frontend logic
├── uploads/               # Temporary uploads (auto-cleaned)
├── processed/             # Processed photos (auto-cleaned)
├── .env.example           # Environment template
└── package.json
```

---

## ⚙️ Tech Stack

- **Backend**: Node.js, Express
- **Image Processing**: Sharp (high-performance, libvips-based)
- **Background Removal**: remove.bg API / PhotoRoom API
- **Frontend**: Vanilla HTML/CSS/JS (no framework needed)
- **Upload Handling**: Multer

---

## 🔧 Deployment

### Heroku
```bash
heroku create your-passport-snap
heroku config:set REMOVE_BG_API_KEY=your_key
git push heroku main
```

### Railway / Render
Just connect your GitHub repo and set environment variables.

### VPS (DigitalOcean, Linode)
```bash
npm install pm2 -g
pm2 start server.js --name passport-snap
pm2 startup && pm2 save
```

---

## 📈 SEO Tips for Traffic

Add these pages for free organic traffic:
- `/passport-photo-requirements/[country]` — country-specific guides
- `/blog/how-to-take-passport-photo-at-home`
- `/blog/passport-photo-size-guide-2024`
- Target keywords: "free passport photo online", "passport photo maker", "passport photo requirements [country]"

---

## License

MIT — Free to use and monetize.
