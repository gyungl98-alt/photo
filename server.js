require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
['uploads', 'processed'].forEach(dir => {
  if (!fs.existsSync(path.join(__dirname, dir))) {
    fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/processed', express.static(path.join(__dirname, 'processed')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
const photoRoutes = require('./routes/photo');
app.use('/api/photo', photoRoutes);

// Serve index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cleanup old files every hour
setInterval(() => {
  const dirs = ['uploads', 'processed'];
  const oneHour = 60 * 60 * 1000;
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach(file => {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        if (Date.now() - stats.mtime.getTime() > oneHour) {
          fs.unlinkSync(filePath);
        }
      });
    }
  });
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 Passport Photo Tool running on http://localhost:${PORT}`);
});
