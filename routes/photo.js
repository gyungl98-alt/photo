const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Multer setup
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

// Passport sizes in mm (width x height)
const PASSPORT_SIZES = {
  'india': { width: 35, height: 45, label: 'India (35×45mm)', dpi: 600 },
  'usa': { width: 50, height: 50, label: 'USA (50×50mm)', dpi: 600 },
  'uk': { width: 35, height: 45, label: 'UK (35×45mm)', dpi: 600 },
  'eu': { width: 35, height: 45, label: 'EU/Schengen (35×45mm)', dpi: 600 },
  'china': { width: 33, height: 48, label: 'China (33×48mm)', dpi: 600 },
  'australia': { width: 35, height: 45, label: 'Australia (35×45mm)', dpi: 600 },
  'canada': { width: 50, height: 70, label: 'Canada (50×70mm)', dpi: 600 },
  'uae': { width: 40, height: 60, label: 'UAE (40×60mm)', dpi: 600 },
  'visa_2x2': { width: 51, height: 51, label: 'Visa 2×2 inch', dpi: 600 },
};

// Convert mm to pixels at given DPI
function mmToPx(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

// Remove background using remove.bg API
async function removeBackgroundRemoveBg(imageBuffer) {
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) throw new Error('No API key');

  const formData = new FormData();
  formData.append('image_file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  formData.append('size', 'auto');
  formData.append('type', 'person');
  formData.append('format', 'png');

  const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
    headers: { ...formData.getHeaders(), 'X-Api-Key': apiKey },
    responseType: 'arraybuffer',
    timeout: 30000
  });
  return Buffer.from(response.data);
}

// Remove background using PhotoRoom API (free tier)
async function removeBackgroundPhotoRoom(imageBuffer) {
  const apiKey = process.env.PHOTOROOM_API_KEY;
  if (!apiKey) throw new Error('No PhotoRoom key');

  const formData = new FormData();
  formData.append('image_file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

  const response = await axios.post('https://sdk.photoroom.com/v1/segment', formData, {
    headers: { ...formData.getHeaders(), 'x-api-key': apiKey },
    responseType: 'arraybuffer',
    timeout: 30000
  });
  return Buffer.from(response.data);
}

// Client-side BG removal fallback notice (returns original with white bg added via sharp)
async function addWhiteBackground(imageBuffer) {
  return await sharp(imageBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}

// Process photo into passport size
async function processPassportPhoto(inputBuffer, sizeKey, bgColor, removeBg) {
  const size = PASSPORT_SIZES[sizeKey] || PASSPORT_SIZES['india'];
  const targetW = mmToPx(size.width, size.dpi);
  const targetH = mmToPx(size.height, size.dpi);

  let workingBuffer = inputBuffer;

  // Remove background if requested
  if (removeBg) {
    try {
      if (process.env.REMOVE_BG_API_KEY) {
        workingBuffer = await removeBackgroundRemoveBg(inputBuffer);
      } else if (process.env.PHOTOROOM_API_KEY) {
        workingBuffer = await removeBackgroundPhotoRoom(inputBuffer);
      } else {
        // Fallback: just use the original
        workingBuffer = inputBuffer;
      }
    } catch (err) {
      console.error('BG removal failed:', err.message);
      workingBuffer = inputBuffer;
    }
  }

  // Parse background color
  let bgR = 255, bgG = 255, bgB = 255;
  if (bgColor && bgColor.startsWith('#')) {
    bgR = parseInt(bgColor.slice(1, 3), 16);
    bgG = parseInt(bgColor.slice(3, 5), 16);
    bgB = parseInt(bgColor.slice(5, 7), 16);
  } else if (bgColor === 'blue') { bgR = 67; bgG = 114; bgB = 193; }
  else if (bgColor === 'gray') { bgR = 200; bgG = 200; bgB = 200; }

  // Process with sharp: resize to fill, composite on background
  const bgBuffer = await sharp({
    create: {
      width: targetW,
      height: targetH,
      channels: 3,
      background: { r: bgR, g: bgG, b: bgB }
    }
  }).png().toBuffer();

  // Get image metadata to calculate crop
  const metadata = await sharp(workingBuffer).metadata();
  const imgW = metadata.width;
  const imgH = metadata.height;

  // Calculate resize to cover target area (focus on top 2/3 of image for head)
  const scaleW = targetW / imgW;
  const scaleH = targetH / imgH;
  const scale = Math.max(scaleW, scaleH) * 1.05; // slight zoom

  const resizedW = Math.round(imgW * scale);
  const resizedH = Math.round(imgH * scale);

  // Position: center horizontally, position face in upper portion
  const left = Math.round((resizedW - targetW) / 2);
  const top = Math.round((resizedH - targetH) * 0.25); // face positioning

  let processedImg = await sharp(workingBuffer)
    .resize(resizedW, resizedH, { fit: 'fill', kernel: 'lanczos3' })
    .extract({
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: targetW,
      height: targetH
    })
    .toBuffer();

  // Composite on background
  const finalImg = await sharp(bgBuffer)
    .composite([{ input: processedImg, blend: removeBg ? 'over' : 'over' }])
    .sharpen({ sigma: 0.8, m1: 0.5, m2: 2 })
    .modulate({ brightness: 1.02, saturation: 1.05 })
    .jpeg({ quality: 97, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return { buffer: finalImg, width: targetW, height: targetH, size };
}

// Create print sheet with multiple photos
async function createPrintSheet(photoBuffer, count, photoWidth, photoHeight) {
  // A4 at 600 DPI: 4961 x 7016 px
  const sheetW = 4961;
  const sheetH = 7016;
  const margin = 118; // ~5mm
  const gap = 59; // ~2.5mm

  // Calculate grid
  const cols = Math.floor((sheetW - margin * 2 + gap) / (photoWidth + gap));
  const rows = Math.ceil(count / cols);

  // Create white sheet
  const sheet = await sharp({
    create: { width: sheetW, height: sheetH, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).png().toBuffer();

  const composites = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (photoWidth + gap);
    const y = margin + row * (photoHeight + gap);
    composites.push({ input: photoBuffer, left: x, top: y });

    // Add cut guides (small corner marks)
    // We'll skip SVG cut lines for simplicity and add them via the frontend
  }

  const result = await sharp(sheet)
    .composite(composites)
    .jpeg({ quality: 95 })
    .toBuffer();

  return result;
}

// Upload and process
router.post('/process', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const { sizeKey = 'india', bgColor = 'white', removeBg = 'false', count = '4' } = req.body;
    const photoCount = Math.min(6, Math.max(2, parseInt(count)));

    const inputBuffer = fs.readFileSync(req.file.path);

    // Process single passport photo
    const { buffer: passportBuffer, size } = await processPassportPhoto(
      inputBuffer, sizeKey, bgColor, removeBg === 'true'
    );

    // Save single photo
    const singleId = uuidv4();
    const singlePath = path.join(__dirname, '../processed', `${singleId}_single.jpg`);
    fs.writeFileSync(singlePath, passportBuffer);

    // Create print sheet
    const sheetBuffer = await createPrintSheet(
      passportBuffer, photoCount,
      mmToPx(PASSPORT_SIZES[sizeKey]?.width || 35, 600),
      mmToPx(PASSPORT_SIZES[sizeKey]?.height || 45, 600)
    );

    const sheetId = uuidv4();
    const sheetPath = path.join(__dirname, '../processed', `${sheetId}_sheet.jpg`);
    fs.writeFileSync(sheetPath, sheetBuffer);

    // Cleanup upload
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      singleUrl: `/processed/${singleId}_single.jpg`,
      sheetUrl: `/processed/${sheetId}_sheet.jpg`,
      size: size.label,
      count: photoCount
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Processing failed' });
  }
});

// Get available sizes
router.get('/sizes', (req, res) => {
  res.json(PASSPORT_SIZES);
});

// Check API keys availability
router.get('/features', (req, res) => {
  res.json({
    bgRemoval: !!(process.env.REMOVE_BG_API_KEY || process.env.PHOTOROOM_API_KEY),
    bgProvider: process.env.REMOVE_BG_API_KEY ? 'remove.bg' : process.env.PHOTOROOM_API_KEY ? 'PhotoRoom' : null
  });
});

module.exports = router;
