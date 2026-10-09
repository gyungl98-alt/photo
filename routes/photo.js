const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ── Multer Setup ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'), false);
    }
  }
});

// ── Passport Sizes ──
const PASSPORT_SIZES = {
  'india':     { width: 35, height: 45, label: 'India (35×45mm)',       dpi: 600 },
  'usa':       { width: 50, height: 50, label: 'USA (50×50mm)',         dpi: 600 },
  'uk':        { width: 35, height: 45, label: 'UK (35×45mm)',          dpi: 600 },
  'eu':        { width: 35, height: 45, label: 'EU/Schengen (35×45mm)', dpi: 600 },
  'china':     { width: 33, height: 48, label: 'China (33×48mm)',       dpi: 600 },
  'australia': { width: 35, height: 45, label: 'Australia (35×45mm)',   dpi: 600 },
  'canada':    { width: 50, height: 70, label: 'Canada (50×70mm)',      dpi: 600 },
  'uae':       { width: 40, height: 60, label: 'UAE (40×60mm)',         dpi: 600 },
  'visa_2x2':  { width: 51, height: 51, label: 'Visa 2×2 inch',         dpi: 600 },
};

// Helper: Convert mm to pixels
function mmToPx(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

// ── Process Photo ──
async function processPassportPhoto(inputBuffer, sizeKey, bgColor) {
  try {
    const size = PASSPORT_SIZES[sizeKey] || PASSPORT_SIZES['india'];
    const targetW = mmToPx(size.width, size.dpi);
    const targetH = mmToPx(size.height, size.dpi);

    // Parse background color
    let bgR = 255, bgG = 255, bgB = 255;
    if (bgColor && bgColor.startsWith('#')) {
      bgR = parseInt(bgColor.slice(1, 3), 16);
      bgG = parseInt(bgColor.slice(3, 5), 16);
      bgB = parseInt(bgColor.slice(5, 7), 16);
    } else if (bgColor === 'blue') {
      bgR = 67; bgG = 114; bgB = 193;
    } else if (bgColor === 'gray') {
      bgR = 200; bgG = 200; bgB = 200;
    }

    // Create background
    const bgBuffer = await sharp({
      create: { 
        width: targetW, 
        height: targetH, 
        channels: 3, 
        background: { r: bgR, g: bgG, b: bgB } 
      }
    }).jpeg({ quality: 95 }).toBuffer();

    // Get image metadata
    const metadata = await sharp(inputBuffer).metadata();
    const scale = Math.max(targetW / metadata.width, targetH / metadata.height) * 1.05;
    const resizedW = Math.round(metadata.width * scale);
    const resizedH = Math.round(metadata.height * scale);
    const left = Math.round((resizedW - targetW) / 2);
    const top = Math.round((resizedH - targetH) * 0.25);

    // Resize and extract
    const processedImg = await sharp(inputBuffer)
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
      .composite([{ input: processedImg, blend: 'over' }])
      .sharpen({ sigma: 0.8, m1: 0.5, m2: 2 })
      .modulate({ brightness: 1.02, saturation: 1.05 })
      .jpeg({ quality: 97, chromaSubsampling: '4:4:4' })
      .toBuffer();

    return { 
      buffer: finalImg, 
      width: targetW, 
      height: targetH, 
      size 
    };
  } catch (err) {
    console.error('Photo processing error:', err);
    throw new Error('Failed to process photo: ' + err.message);
  }
}

// ── Create A4 Print Sheet ──
async function createPrintSheet(photoBuffer, count, photoWidth, photoHeight) {
  try {
    const sheetW = 4961, sheetH = 7016;
    const margin = 118, gap = 59;
    const cols = Math.floor((sheetW - margin * 2 + gap) / (photoWidth + gap));

    // Create white background
    const sheet = await sharp({
      create: { 
        width: sheetW, 
        height: sheetH, 
        channels: 3, 
        background: { r: 255, g: 255, b: 255 } 
      }
    }).jpeg({ quality: 95 }).toBuffer();

    // Create composites array
    const composites = [];
    for (let i = 0; i < count; i++) {
      composites.push({
        input: photoBuffer,
        left: margin + (i % cols) * (photoWidth + gap),
        top: margin + Math.floor(i / cols) * (photoHeight + gap)
      });
    }

    return await sharp(sheet)
      .composite(composites)
      .jpeg({ quality: 95 })
      .toBuffer();
  } catch (err) {
    console.error('Print sheet error:', err);
    throw new Error('Failed to create print sheet: ' + err.message);
  }
}

// ============================================================
//  API ROUTES
// ============================================================

// Process photo route
router.post('/process', upload.single('photo'), async (req, res) => {
  const uploadedFile = req.file;
  
  try {
    if (!uploadedFile) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    const { sizeKey = 'india', bgColor = 'white', removeBg = 'false', count = '4' } = req.body;
    const photoCount = Math.min(6, Math.max(2, parseInt(count) || 4));

    console.log(`Processing: size=${sizeKey}, bg=${bgColor}, count=${photoCount}`);

    // Read uploaded file
    const inputBuffer = fs.readFileSync(uploadedFile.path);

    // Process photo
    const { buffer: passportBuffer, size } = await processPassportPhoto(
      inputBuffer,
      sizeKey,
      bgColor
    );

    // Save single photo
    const singleId = uuidv4();
    const processedDir = path.join(__dirname, '../processed');
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
    }

    const singlePath = path.join(processedDir, `${singleId}_single.jpg`);
    fs.writeFileSync(singlePath, passportBuffer);

    // Create print sheet
    const sheetBuffer = await createPrintSheet(
      passportBuffer,
      photoCount,
      mmToPx(size.width, 600),
      mmToPx(size.height, 600)
    );

    const sheetId = uuidv4();
    const sheetPath = path.join(processedDir, `${sheetId}_sheet.jpg`);
    fs.writeFileSync(sheetPath, sheetBuffer);

    // Clean up uploaded file
    try {
      fs.unlinkSync(uploadedFile.path);
    } catch (e) {
      console.warn('Could not delete uploaded file:', uploadedFile.path);
    }

    console.log(`✅ Processing complete: ${singleId} & ${sheetId}`);

    res.json({
      success: true,
      singleUrl: `/processed/${singleId}_single.jpg`,
      sheetUrl: `/processed/${sheetId}_sheet.jpg`,
      size: size.label,
      count: photoCount
    });

  } catch (err) {
    console.error('❌ Processing error:', err);
    
    // Clean up uploaded file on error
    try {
      if (uploadedFile && fs.existsSync(uploadedFile.path)) {
        fs.unlinkSync(uploadedFile.path);
      }
    } catch (e) {
      console.warn('Could not delete file on error');
    }

    res.status(500).json({ 
      error: err.message || 'Processing failed' 
    });
  }
});

// Get available sizes
router.get('/sizes', (req, res) => {
  res.json(PASSPORT_SIZES);
});

// Get API features/status
router.get('/features', (req, res) => {
  res.json({
    bgRemoval: false,
    bgProvider: null
  });
});

module.exports = router;
