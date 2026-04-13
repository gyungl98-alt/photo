const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ============================================================
//  SMART API FALLBACK SYSTEM
//  Priority: remove.bg → PhotoRoom → Original (no removal)
//  Auto-switch jab remove.bg ka quota khatam ho
// ============================================================

const apiStatus = {
  removeBg: {
    enabled: !!process.env.REMOVE_BG_API_KEY,
    quotaExhausted: false,
    failCount: 0,
    lastError: null,
    totalUsed: 0,
  },
  photoRoom: {
    enabled: !!process.env.PHOTOROOM_API_KEY,
    quotaExhausted: false,
    failCount: 0,
    lastError: null,
    totalUsed: 0,
  }
};

// Startup log
setTimeout(() => {
  console.log('\n📊 Background Removal API Status:');
  console.log(`  remove.bg  : ${apiStatus.removeBg.enabled  ? '✅ Configured' : '❌ No key found'}`);
  console.log(`  PhotoRoom  : ${apiStatus.photoRoom.enabled ? '✅ Configured' : '❌ No key found'}`);
  if (apiStatus.removeBg.enabled && apiStatus.photoRoom.enabled) {
    console.log('  🔄 Smart fallback ACTIVE: remove.bg → PhotoRoom (auto-switch on quota exhaustion)\n');
  } else if (!apiStatus.removeBg.enabled && !apiStatus.photoRoom.enabled) {
    console.log('  ⚠️  No BG removal API configured. Add keys to .env file.\n');
  }
}, 100);

// ── Multer Setup ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  }
});

// ── Passport Sizes ──
const PASSPORT_SIZES = {
  'india':     { width: 35, height: 45, label: 'India (35×45mm)',       dpi: 600 },
  'usa':       { width: 50, height: 50, label: 'USA (50×50mm)',          dpi: 600 },
  'uk':        { width: 35, height: 45, label: 'UK (35×45mm)',           dpi: 600 },
  'eu':        { width: 35, height: 45, label: 'EU/Schengen (35×45mm)', dpi: 600 },
  'china':     { width: 33, height: 48, label: 'China (33×48mm)',        dpi: 600 },
  'australia': { width: 35, height: 45, label: 'Australia (35×45mm)',    dpi: 600 },
  'canada':    { width: 50, height: 70, label: 'Canada (50×70mm)',       dpi: 600 },
  'uae':       { width: 40, height: 60, label: 'UAE (40×60mm)',          dpi: 600 },
  'visa_2x2':  { width: 51, height: 51, label: 'Visa 2×2 inch',         dpi: 600 },
};

function mmToPx(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

// ── remove.bg API Call ──
async function callRemoveBg(imageBuffer) {
  const formData = new FormData();
  formData.append('image_file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  formData.append('size', 'auto');
  formData.append('type', 'person');
  formData.append('format', 'png');

  const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
    headers: { ...formData.getHeaders(), 'X-Api-Key': process.env.REMOVE_BG_API_KEY },
    responseType: 'arraybuffer',
    timeout: 30000,
    validateStatus: null
  });

  // 402 = credits exhausted on remove.bg
  if (response.status === 402) {
    throw { type: 'QUOTA_EXHAUSTED', message: 'remove.bg credits exhausted (402)' };
  }
  if (response.status === 403) {
    throw { type: 'AUTH_ERROR', message: 'remove.bg invalid API key (403)' };
  }
  if (response.status === 429) {
    throw { type: 'QUOTA_EXHAUSTED', message: 'remove.bg rate limit hit (429)' };
  }
  if (response.status !== 200) {
    try {
      const errText = Buffer.from(response.data).toString('utf8');
      const errJson = JSON.parse(errText);
      const errMsg  = errJson?.errors?.[0]?.title || `HTTP ${response.status}`;
      if (/insufficient|credit|quota|limit/i.test(errMsg)) {
        throw { type: 'QUOTA_EXHAUSTED', message: `remove.bg quota: ${errMsg}` };
      }
      throw { type: 'API_ERROR', message: errMsg };
    } catch (parseErr) {
      if (parseErr.type) throw parseErr;
      throw { type: 'API_ERROR', message: `remove.bg HTTP ${response.status}` };
    }
  }

  return Buffer.from(response.data);
}

// ── PhotoRoom API Call ──
async function callPhotoRoom(imageBuffer) {
  const formData = new FormData();
  formData.append('image_file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

  const response = await axios.post('https://sdk.photoroom.com/v1/segment', formData, {
    headers: { ...formData.getHeaders(), 'x-api-key': process.env.PHOTOROOM_API_KEY },
    responseType: 'arraybuffer',
    timeout: 30000,
    validateStatus: null
  });

  if (response.status === 402 || response.status === 429) {
    throw { type: 'QUOTA_EXHAUSTED', message: `PhotoRoom quota exhausted (${response.status})` };
  }
  if (response.status === 401 || response.status === 403) {
    throw { type: 'AUTH_ERROR', message: 'PhotoRoom invalid API key' };
  }
  if (response.status !== 200) {
    throw { type: 'API_ERROR', message: `PhotoRoom HTTP ${response.status}` };
  }

  return Buffer.from(response.data);
}

// ============================================================
//  MAIN SMART BG REMOVAL — AUTO FALLBACK
// ============================================================
async function removeBackground(imageBuffer) {
  let resultBuffer = null;
  let usedProvider = null;

  // ── Step 1: Try remove.bg ──
  if (apiStatus.removeBg.enabled && !apiStatus.removeBg.quotaExhausted) {
    try {
      console.log('🔄 [BG Removal] Trying remove.bg...');
      resultBuffer = await callRemoveBg(imageBuffer);
      apiStatus.removeBg.totalUsed++;
      apiStatus.removeBg.failCount = 0;
      usedProvider = 'remove.bg';
      console.log(`✅ [BG Removal] remove.bg success! (session total: ${apiStatus.removeBg.totalUsed})`);
    } catch (err) {
      apiStatus.removeBg.lastError = err.message;

      if (err.type === 'QUOTA_EXHAUSTED') {
        apiStatus.removeBg.quotaExhausted = true;
        console.warn('⚠️  [BG Removal] remove.bg QUOTA EXHAUSTED → switching to PhotoRoom...');
      } else {
        apiStatus.removeBg.failCount++;
        if (apiStatus.removeBg.failCount >= 3) {
          apiStatus.removeBg.quotaExhausted = true;
          console.warn('⚠️  [BG Removal] remove.bg failed 3 times → switching to PhotoRoom...');
        } else {
          console.warn(`⚠️  [BG Removal] remove.bg failed (${apiStatus.removeBg.failCount}/3): ${err.message}`);
        }
      }
    }
  } else if (apiStatus.removeBg.quotaExhausted && apiStatus.removeBg.enabled) {
    console.log('ℹ️  [BG Removal] remove.bg quota exhausted → using PhotoRoom directly');
  }

  // ── Step 2: Fallback to PhotoRoom ──
  if (!resultBuffer && apiStatus.photoRoom.enabled && !apiStatus.photoRoom.quotaExhausted) {
    try {
      console.log('🔄 [BG Removal] Trying PhotoRoom...');
      resultBuffer = await callPhotoRoom(imageBuffer);
      apiStatus.photoRoom.totalUsed++;
      apiStatus.photoRoom.failCount = 0;
      usedProvider = 'PhotoRoom';
      console.log(`✅ [BG Removal] PhotoRoom success! (session total: ${apiStatus.photoRoom.totalUsed})`);
    } catch (err) {
      apiStatus.photoRoom.lastError = err.message;

      if (err.type === 'QUOTA_EXHAUSTED') {
        apiStatus.photoRoom.quotaExhausted = true;
        console.warn('⚠️  [BG Removal] PhotoRoom QUOTA ALSO EXHAUSTED. Both APIs at limit!');
      } else {
        apiStatus.photoRoom.failCount++;
        if (apiStatus.photoRoom.failCount >= 3) {
          apiStatus.photoRoom.quotaExhausted = true;
          console.warn('⚠️  [BG Removal] PhotoRoom failed 3 times. Both APIs disabled this session.');
        } else {
          console.warn(`⚠️  [BG Removal] PhotoRoom failed (${apiStatus.photoRoom.failCount}/3): ${err.message}`);
        }
      }
    }
  }

  // ── Step 3: Both failed — use original ──
  if (!resultBuffer) {
    const reason =
      (!apiStatus.removeBg.enabled && !apiStatus.photoRoom.enabled)
        ? 'No API keys configured in .env'
        : (apiStatus.removeBg.quotaExhausted && apiStatus.photoRoom.quotaExhausted)
          ? 'Both remove.bg and PhotoRoom quotas exhausted'
          : 'All BG removal attempts failed';

    console.warn(`⚠️  [BG Removal] Skipped: ${reason}`);
    return { buffer: imageBuffer, provider: null, fallback: true, reason };
  }

  return { buffer: resultBuffer, provider: usedProvider, fallback: false };
}

// ── Process Photo ──
async function processPassportPhoto(inputBuffer, sizeKey, bgColor, removeBg) {
  const size = PASSPORT_SIZES[sizeKey] || PASSPORT_SIZES['india'];
  const targetW = mmToPx(size.width, size.dpi);
  const targetH = mmToPx(size.height, size.dpi);

  let workingBuffer = inputBuffer;
  let bgRemovalInfo = null;

  if (removeBg) {
    const result = await removeBackground(inputBuffer);
    workingBuffer  = result.buffer;
    bgRemovalInfo  = result;
  }

  // Parse background color
  let bgR = 255, bgG = 255, bgB = 255;
  if (bgColor && bgColor.startsWith('#')) {
    bgR = parseInt(bgColor.slice(1, 3), 16);
    bgG = parseInt(bgColor.slice(3, 5), 16);
    bgB = parseInt(bgColor.slice(5, 7), 16);
  } else if (bgColor === 'blue') { bgR = 67;  bgG = 114; bgB = 193; }
  else if (bgColor === 'gray')   { bgR = 200; bgG = 200; bgB = 200; }

  const bgBuffer = await sharp({
    create: { width: targetW, height: targetH, channels: 3, background: { r: bgR, g: bgG, b: bgB } }
  }).png().toBuffer();

  const metadata = await sharp(workingBuffer).metadata();
  const scale    = Math.max(targetW / metadata.width, targetH / metadata.height) * 1.05;
  const resizedW = Math.round(metadata.width  * scale);
  const resizedH = Math.round(metadata.height * scale);
  const left     = Math.round((resizedW - targetW) / 2);
  const top      = Math.round((resizedH - targetH) * 0.25);

  const processedImg = await sharp(workingBuffer)
    .resize(resizedW, resizedH, { fit: 'fill', kernel: 'lanczos3' })
    .extract({ left: Math.max(0, left), top: Math.max(0, top), width: targetW, height: targetH })
    .toBuffer();

  const finalImg = await sharp(bgBuffer)
    .composite([{ input: processedImg, blend: 'over' }])
    .sharpen({ sigma: 0.8, m1: 0.5, m2: 2 })
    .modulate({ brightness: 1.02, saturation: 1.05 })
    .jpeg({ quality: 97, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return { buffer: finalImg, width: targetW, height: targetH, size, bgRemovalInfo };
}

// ── Create A4 Print Sheet ──
async function createPrintSheet(photoBuffer, count, photoWidth, photoHeight) {
  const sheetW = 4961, sheetH = 7016;
  const margin = 118, gap = 59;
  const cols   = Math.floor((sheetW - margin * 2 + gap) / (photoWidth + gap));

  const sheet = await sharp({
    create: { width: sheetW, height: sheetH, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).png().toBuffer();

  const composites = [];
  for (let i = 0; i < count; i++) {
    composites.push({
      input: photoBuffer,
      left:  margin + (i % cols)          * (photoWidth  + gap),
      top:   margin + Math.floor(i / cols) * (photoHeight + gap)
    });
  }

  return await sharp(sheet).composite(composites).jpeg({ quality: 95 }).toBuffer();
}

// ============================================================
//  API ROUTES
// ============================================================

// Process photo
router.post('/process', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const { sizeKey = 'india', bgColor = 'white', removeBg = 'false', count = '4' } = req.body;
    const photoCount = Math.min(6, Math.max(2, parseInt(count)));

    const inputBuffer = fs.readFileSync(req.file.path);
    const { buffer: passportBuffer, size, bgRemovalInfo } = await processPassportPhoto(
      inputBuffer, sizeKey, bgColor, removeBg === 'true'
    );

    const singleId = uuidv4();
    fs.writeFileSync(path.join(__dirname, '../processed', `${singleId}_single.jpg`), passportBuffer);

    const sheetBuffer = await createPrintSheet(
      passportBuffer, photoCount,
      mmToPx(PASSPORT_SIZES[sizeKey]?.width  || 35, 600),
      mmToPx(PASSPORT_SIZES[sizeKey]?.height || 45, 600)
    );

    const sheetId = uuidv4();
    fs.writeFileSync(path.join(__dirname, '../processed', `${sheetId}_sheet.jpg`), sheetBuffer);

    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({
      success: true,
      singleUrl: `/processed/${singleId}_single.jpg`,
      sheetUrl:  `/processed/${sheetId}_sheet.jpg`,
      size: size.label,
      count: photoCount,
      bgRemoval: bgRemovalInfo ? {
        attempted: true,
        success:   !bgRemovalInfo.fallback,
        provider:  bgRemovalInfo.provider,
        fallback:  bgRemovalInfo.fallback,
        reason:    bgRemovalInfo.reason || null,
      } : null
    });

  } catch (err) {
    console.error('Processing error:', err);
    try { if (req.file) fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ error: err.message || 'Processing failed' });
  }
});

// Get sizes
router.get('/sizes', (req, res) => res.json(PASSPORT_SIZES));

// Live API status
router.get('/api-status', (req, res) => {
  res.json({
    removeBg: {
      configured:           apiStatus.removeBg.enabled,
      active:               apiStatus.removeBg.enabled && !apiStatus.removeBg.quotaExhausted,
      quotaExhausted:       apiStatus.removeBg.quotaExhausted,
      totalUsedThisSession: apiStatus.removeBg.totalUsed,
      lastError:            apiStatus.removeBg.lastError,
    },
    photoRoom: {
      configured:           apiStatus.photoRoom.enabled,
      active:               apiStatus.photoRoom.enabled && !apiStatus.photoRoom.quotaExhausted,
      quotaExhausted:       apiStatus.photoRoom.quotaExhausted,
      totalUsedThisSession: apiStatus.photoRoom.totalUsed,
      lastError:            apiStatus.photoRoom.lastError,
    },
    currentProvider:
      (apiStatus.removeBg.enabled  && !apiStatus.removeBg.quotaExhausted)  ? 'remove.bg' :
      (apiStatus.photoRoom.enabled && !apiStatus.photoRoom.quotaExhausted) ? 'PhotoRoom' : 'none',
    bgRemovalAvailable:
      (apiStatus.removeBg.enabled  && !apiStatus.removeBg.quotaExhausted) ||
      (apiStatus.photoRoom.enabled && !apiStatus.photoRoom.quotaExhausted),
  });
});

// Features (used by frontend)
router.get('/features', (req, res) => {
  const removeBgActive  = apiStatus.removeBg.enabled  && !apiStatus.removeBg.quotaExhausted;
  const photoRoomActive = apiStatus.photoRoom.enabled && !apiStatus.photoRoom.quotaExhausted;
  res.json({
    bgRemoval:         removeBgActive || photoRoomActive,
    bgProvider:        removeBgActive ? 'remove.bg' : photoRoomActive ? 'PhotoRoom' : null,
    fallbackAvailable: apiStatus.removeBg.enabled && apiStatus.photoRoom.enabled,
    status: {
      removeBg:  removeBgActive  ? 'active' : apiStatus.removeBg.enabled  ? 'quota_exhausted' : 'not_configured',
      photoRoom: photoRoomActive ? 'active' : apiStatus.photoRoom.enabled ? 'quota_exhausted' : 'not_configured',
    }
  });
});

// Manual quota reset (call this at month start)
// POST /api/photo/reset-quota  { "provider": "all" | "removebg" | "photoroom" }
router.post('/reset-quota', (req, res) => {
  const { provider = 'all' } = req.body;
  if (provider === 'removebg' || provider === 'all') {
    apiStatus.removeBg.quotaExhausted = false;
    apiStatus.removeBg.failCount = 0;
    apiStatus.removeBg.lastError = null;
  }
  if (provider === 'photoroom' || provider === 'all') {
    apiStatus.photoRoom.quotaExhausted = false;
    apiStatus.photoRoom.failCount = 0;
    apiStatus.photoRoom.lastError = null;
  }
  console.log(`🔄 Quota manually reset for: ${provider}`);
  res.json({ success: true, message: `Quota reset for: ${provider}` });
});

module.exports = router;


