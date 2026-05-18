const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 120 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Generate Motion Endpoint
app.post('/api/generate-motion', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  try {
    const apiKey = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!apiKey) return res.status(401).json({ success: false, error: 'API Key tidak ditemukan.', statusCode: 401 });

    const { prompt = '', model = 'kling-v2-standard', cfg_scale = '0.5' } = req.body;
    const imageFile = req.files && req.files['image'] && req.files['image'][0];
    const videoFile = req.files && req.files['video'] && req.files['video'][0];

    if (!imageFile) return res.status(400).json({ success: false, error: 'Image reference wajib diupload.' });

    const formData = new FormData();
    formData.append('image', imageFile.buffer, { filename: imageFile.originalname, contentType: imageFile.mimetype });
    if (videoFile) formData.append('video', videoFile.buffer, { filename: videoFile.originalname, contentType: videoFile.mimetype });
    if (prompt) formData.append('prompt', prompt);
    formData.append('model', model);
    formData.append('cfg_scale', cfg_scale);

    const response = await fetch('https://api.magnific.com/v1/kling/motion', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
      body: formData
    });

    // ✅ CEK CONTENT TYPE SEBELUM PARSE JSON
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text(); // Ambil sebagai text dulu

    console.log('=== MAGNIFIC API RESPONSE ===');
    console.log('Status:', response.status);
    console.log('Content-Type:', contentType);
    console.log('Raw Body:', rawText.substring(0, 500)); // Log 500 char pertama
    console.log('=============================');

    // ✅ PARSE JSON DENGAN AMAN
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      // Response bukan JSON — kemungkinan HTML error page
      console.error('Response bukan JSON:', rawText.substring(0, 300));
      
      // Coba identifikasi masalah dari status code
      if (response.status === 404) {
        return res.status(404).json({ 
          success: false, 
          error: 'Endpoint API tidak ditemukan. URL mungkin salah.',
          statusCode: 404,
          debug: rawText.substring(0, 200)
        });
      }
      if (response.status === 401 || response.status === 403) {
        return res.status(401).json({ 
          success: false, 
          error: 'API Key tidak valid atau tidak memiliki akses.',
          statusCode: 401
        });
      }
      if (response.status === 502 || response.status === 503) {
        return res.status(503).json({ 
          success: false, 
          error: 'Server Magnific sedang down atau maintenance.',
          statusCode: 503
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        error: `Server mengembalikan response tidak valid (HTTP ${response.status}). Bukan JSON.`,
        statusCode: response.status,
        debug: rawText.substring(0, 300)
      });
    }

    // Handle error dari API
    if (response.status === 401 || response.status === 403)
      return res.status(401).json({ success: false, error: data.detail || data.error || 'API Key tidak valid.', statusCode: 401 });
    if (response.status === 429)
      return res.status(429).json({ success: false, error: data.detail || 'Rate limit tercapai.', statusCode: 429 });
    if (!response.ok)
      return res.status(response.status).json({ success: false, error: data.detail || data.error || `Server error: ${response.status}`, statusCode: response.status });

    res.json({ success: true, data });

  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

// Task Status Endpoint
app.get('/api/task-status/:taskId', async (req, res) => {
  try {
    const apiKey = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!apiKey) return res.status(401).json({ success: false, error: 'API Key tidak ditemukan.', statusCode: 401 });

    const { taskId } = req.params;
    const model = req.query.model || 'kling-v2-standard';

    const response = await fetch(`https://api.magnific.com/v1/kling/motion/${taskId}?model=${model}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    // ✅ CEK CONTENT TYPE SEBELUM PARSE JSON
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    console.log('=== TASK STATUS RESPONSE ===');
    console.log('Status:', response.status);
    console.log('Content-Type:', contentType);
    console.log('Raw Body:', rawText.substring(0, 500));
    console.log('============================');

    // ✅ PARSE JSON DENGAN AMAN
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('Status response bukan JSON:', rawText.substring(0, 300));
      return res.status(500).json({ 
        success: false, 
        error: `Response tidak valid dari API (HTTP ${response.status})`,
        statusCode: response.status,
        debug: rawText.substring(0, 300)
      });
    }

    if (!response.ok)
      return res.status(response.status).json({ success: false, error: data.detail || data.error || `Error ${response.status}`, statusCode: response.status });

    res.json({ success: true, data });

  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

app.listen(PORT, () => console.log(`VILLAINS AI Server running on port ${PORT}`));
