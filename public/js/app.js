/* PassportSnap — App Logic */

const state = {
  file: null,
  selectedSize: 'india',
  bgColor: 'white',
  removeBg: false,
  count: 4,
  results: null
};

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  setupDropZone();
  setupFileInput();
  setupBgOptions();
  setupToggle();
  await loadSizes();
  await checkFeatures();
  updateCountBtns();
});

// ── Fetch sizes from API ──
async function loadSizes() {
  try {
    const res = await fetch('/api/photo/sizes');
    const sizes = await res.json();
    renderSizeGrid(sizes);
  } catch (e) {
    renderSizeGrid({
      'india': { label: 'India (35×45mm)' },
      'usa': { label: 'USA (50×50mm)' },
      'uk': { label: 'UK (35×45mm)' }
    });
  }
}

function renderSizeGrid(sizes) {
  const grid = document.getElementById('sizeGrid');
  grid.innerHTML = '';
  Object.entries(sizes).forEach(([key, val]) => {
    const btn = document.createElement('button');
    btn.className = 'size-btn' + (key === state.selectedSize ? ' active' : '');
    btn.dataset.key = key;
    const parts = val.label.split('(');
    btn.innerHTML = `<strong>${parts[0].trim()}</strong>${parts[1] ? '(' + parts[1] : ''}`;
    btn.onclick = () => {
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedSize = key;
    };
    grid.appendChild(btn);
  });
}

// ── Check API features ──
async function checkFeatures() {
  try {
    const res = await fetch('/api/photo/features');
    const data = await res.json();
    const desc = document.getElementById('toggleDesc');
    if (data.bgRemoval) {
      desc.textContent = `Powered by ${data.bgProvider}`;
      desc.style.color = 'var(--green)';
    } else {
      desc.textContent = 'Add API key in .env to enable';
    }
  } catch (e) {}
}

// ── Drop Zone ──
function setupDropZone() {
  const zone = document.getElementById('dropZone');

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length && files[0].type.startsWith('image/')) {
      handleFile(files[0]);
    }
  });
  zone.addEventListener('click', (e) => {
    if (e.target === zone || e.target.closest('.upload-content') && !e.target.classList.contains('link-btn')) {
      document.getElementById('fileInput').click();
    }
  });
}

function setupFileInput() {
  const input = document.getElementById('fileInput');
  input.addEventListener('change', () => {
    if (input.files.length) handleFile(input.files[0]);
  });
  document.getElementById('removePhoto').addEventListener('click', () => {
    state.file = null;
    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('dropZone').style.display = 'block';
    document.getElementById('fileInput').value = '';
  });
  document.getElementById('nextToConfig').addEventListener('click', () => {
    if (state.file) showPanel('config');
  });
}

function handleFile(file) {
  state.file = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('previewImg').src = e.target.result;
    document.getElementById('previewName').textContent = file.name;
    document.getElementById('previewSize').textContent = formatFileSize(file.size);
    document.getElementById('dropZone').style.display = 'none';
    document.getElementById('photoPreview').style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

// ── BG Options ──
function setupBgOptions() {
  document.querySelectorAll('.bg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const bg = btn.dataset.bg;
      if (bg === 'custom') {
        state.bgColor = document.getElementById('customBgColor').value;
        document.getElementById('customBgColor').click();
      } else {
        state.bgColor = bg;
      }
    });
  });
  document.getElementById('customBgColor').addEventListener('input', (e) => {
    state.bgColor = e.target.value;
    const swatch = e.target.parentElement;
    swatch.style.background = e.target.value;
  });
  document.getElementById('customBgColor').addEventListener('change', (e) => {
    state.bgColor = e.target.value;
  });
}

// ── Toggle ──
function setupToggle() {
  const toggle = document.getElementById('removeBgToggle');
  toggle.addEventListener('change', () => {
    state.removeBg = toggle.checked;
    document.getElementById('toggleLabel').textContent = toggle.checked ? 'On' : 'Off';
  });
}

// ── Count Controls ──
function adjustCount(delta) {
  state.count = Math.min(6, Math.max(2, state.count + delta));
  document.getElementById('countValue').textContent = state.count;
  updateCountBtns();
}

function updateCountBtns() {
  document.getElementById('countMinus').disabled = state.count <= 2;
  document.getElementById('countPlus').disabled = state.count >= 6;
}

// ── Navigation ──
function showPanel(name) {
  ['upload', 'config', 'result'].forEach(p => {
    document.getElementById(`panel-${p}`).style.display = 'none';
  });
  document.getElementById(`panel-${name}`).style.display = 'block';

  // Update steps
  const stepMap = { upload: 1, config: 2, result: 3 };
  const current = stepMap[name];
  [1, 2, 3].forEach(n => {
    const el = document.getElementById(`step-${n}`);
    el.classList.remove('active', 'done');
    if (n === current) el.classList.add('active');
    else if (n < current) el.classList.add('done');
  });
}

function goBack() {
  showPanel('upload');
}

function startOver() {
  state.file = null;
  state.results = null;
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('dropZone').style.display = 'block';
  document.getElementById('fileInput').value = '';
  showPanel('upload');
}

// ── Process Photo ──
async function processPhoto() {
  if (!state.file) return;

  const btn = document.getElementById('processBtn');
  const btnText = document.getElementById('processBtnText');
  const spinner = document.getElementById('btnSpinner');

  btn.disabled = true;
  btnText.style.display = 'none';
  spinner.style.display = 'flex';

  showProcessingOverlay();

  try {
    const formData = new FormData();
    formData.append('photo', state.file);
    formData.append('sizeKey', state.selectedSize);
    formData.append('bgColor', state.bgColor);
    formData.append('removeBg', state.removeBg.toString());
    formData.append('count', state.count.toString());

    const res = await fetch('/api/photo/process', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Processing failed');
    }

    const data = await res.json();
    state.results = data;

    // Update result panel
    document.getElementById('singleResult').src = data.singleUrl + '?t=' + Date.now();
    document.getElementById('sheetResult').src = data.sheetUrl + '?t=' + Date.now();
    document.getElementById('downloadSingle').href = data.singleUrl;
    document.getElementById('downloadSheet').href = data.sheetUrl;
    document.getElementById('singleSizeLabel').textContent = data.size + ' · 600 DPI';
    document.getElementById('sheetCountLabel').textContent = `${data.count} photos · A4 · 600 DPI`;

    hideProcessingOverlay();
    showPanel('result');

    // Scroll to results
    document.getElementById('tool').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    hideProcessingOverlay();
    showError(err.message);
  } finally {
    btn.disabled = false;
    btnText.style.display = 'inline';
    spinner.style.display = 'none';
  }
}

// ── Processing Overlay ──
let procInterval;
function showProcessingOverlay() {
  const overlay = document.getElementById('processingOverlay');
  overlay.style.display = 'flex';

  const steps = ['ps1', 'ps2', 'ps3'];
  let current = 0;

  // Reset
  steps.forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('active', 'done');
  });
  document.getElementById(steps[0]).classList.add('active');

  procInterval = setInterval(() => {
    document.getElementById(steps[current]).classList.remove('active');
    document.getElementById(steps[current]).classList.add('done');
    current++;
    if (current < steps.length) {
      document.getElementById(steps[current]).classList.add('active');
    } else {
      clearInterval(procInterval);
    }
  }, 2500);
}

function hideProcessingOverlay() {
  clearInterval(procInterval);
  document.getElementById('processingOverlay').style.display = 'none';
}

// ── Print ──
function printSheet() {
  if (!state.results?.sheetUrl) return;
  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Passport Photos — PassportSnap</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: white; }
        @page { size: A4; margin: 5mm; }
        img {
          width: 100%; height: auto;
          display: block;
          max-width: 100%;
        }
        @media print {
          body { -webkit-print-color-adjust: exact; color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <img src="${window.location.origin}${state.results.sheetUrl}" onload="window.print()">
    </body>
    </html>
  `);
  win.document.close();
}

// ── Error Toast ──
function showError(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 2rem; right: 2rem; z-index: 9999;
    background: #ef4444; color: white;
    padding: 12px 20px; border-radius: 10px;
    font-size: 0.88rem; font-weight: 600;
    box-shadow: 0 8px 30px rgba(239,68,68,0.4);
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = '⚠ ' + msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ── Utils ──
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
