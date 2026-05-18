const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer — simpan di memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Helper: parse response aman ──────────────────────────
async function safeJSON(response) {
  const text = await response.text();
  console.log(`[HTTP ${response.status}]`, text.substring(0, 600));
  try { return { ok: response.ok, status: response.status, data: JSON.parse(text) }; }
  catch (e) { return { ok: false, status: response.status, data: null, raw: text }; }
}

// ── Helper: upload file ke tmpfiles.org → dapat URL publik ──
async function uploadToTempHost(buffer, filename, mimetype) {
  const fd = new FormData();
  fd.append('file', buffer, { filename, contentType: mimetype });
  const res = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST', body: fd, headers: fd.getHeaders()
  });
  const json = await res.json();
  // tmpfiles.org mengembalikan: { status:'success', data:{ url:'https://tmpfiles.org/XXXX/file.jpg' } }
  // URL harus diubah ke direct link: tmpfiles.org/dl/XXXX/file.jpg
  if (json.status === 'success' && json.data && json.data.url) {
    const directUrl = json.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    console.log('Uploaded to:', directUrl);
    return directUrl;
  }
  throw new Error('Gagal upload file ke temp host: ' + JSON.stringify(json));
}

// ── Mapping model → endpoint Magnific yang benar ─────────
function getEndpoints(model) {
  const map = {
    'kling-v2-standard': {
      generate: '/v1/ai/video/kling-v2-6',          // Kling 2.6 standard
      statusBase: '/v1/ai/video/kling-v2-6/'
    },
    'kling-v2-pro': {
      generate: '/v1/ai/video/kling-v2-6-pro',
      statusBase: '/v1/ai/video/kling-v2-6-pro/'
    },
    'kling-v3-standard': {
      generate: '/v1/ai/video/kling-v3-omni',
      statusBase: '/v1/ai/video/kling-v3-omni/'
    },
    'kling-v3-pro': {
      generate: '/v1/ai/video/kling-v3-omni-pro',
      statusBase: '/v1/ai/video/kling-v3-omni-pro/'
    },
  };
  return map[model] || map['kling-v2-standard'];
}

// ── POST /api/generate-motion ─────────────────────────────
app.post('/api/generate-motion',
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]),
  async (req, res) => {
    try {
      const apiKey = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
      if (!apiKey) return res.status(401).json({ success: false, error: 'API Key tidak ditemukan.', statusCode: 401 });

      const { prompt = '', model = 'kling-v2-standard', cfg_scale = '0.5' } = req.body;
      const imageFile = req.files?.['image']?.[0];
      const videoFile = req.files?.['video']?.[0];

      if (!imageFile) return res.status(400).json({ success: false, error: 'Image reference wajib diupload.' });

      console.log('=== GENERATE ===', model);

      // Upload image ke temp host → dapat URL
      const imageUrl = await uploadToTempHost(imageFile.buffer, imageFile.originalname, imageFile.mimetype);

      // Upload video jika ada
      let videoUrl = null;
      if (videoFile) {
        videoUrl = await uploadToTempHost(videoFile.buffer, videoFile.originalname, videoFile.mimetype);
      }

      // Body JSON untuk Magnific
      const body = {
        image_url: imageUrl,
        cfg_scale: parseFloat(cfg_scale),
      };
      if (prompt) body.prompt = prompt;
      if (videoUrl) body.video_url = videoUrl;

      const { generate } = getEndpoints(model);
      const magnificUrl = `https://api.magnific.com${generate}`;
      console.log('Calling:', magnificUrl);
      console.log('Body:', JSON.stringify(body));

      const response = await fetch(magnificUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-magnific-api-key': apiKey,        // ← Header yang benar!
        },
        body: JSON.stringify(body)
      });

      const { ok, status, data, raw } = await safeJSON(response);

      if (!data) return res.status(502).json({ success: false, error: `Magnific error (${status}): ${raw?.substring(0,200)}`, statusCode: status });
      if (status === 401 || status === 403) return res.status(401).json({ success: false, error: data.detail || data.error || data.message || 'API Key tidak valid.', statusCode: 401 });
      if (status === 429) return res.status(429).json({ success: false, error: data.detail || data.error || 'Rate limit tercapai.', statusCode: 429 });
      if (!ok) return res.status(status).json({ success: false, error: data.detail || data.error || data.message || `Error ${status}`, statusCode: status });

      res.json({ success: true, data });

    } catch (err) {
      console.error('Generate error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── GET /api/task-status/:taskId ──────────────────────────
app.get('/api/task-status/:taskId', async (req, res) => {
  try {
    const apiKey = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!apiKey) return res.status(401).json({ success: false, error: 'API Key tidak ditemukan.', statusCode: 401 });

    const { taskId } = req.params;
    const model = req.query.model || 'kling-v2-standard';
    const { statusBase } = getEndpoints(model);

    const magnificUrl = `https://api.magnific.com${statusBase}${taskId}`;
    console.log('Status check:', magnificUrl);

    const response = await fetch(magnificUrl, {
      method: 'GET',
      headers: { 'x-magnific-api-key': apiKey }   // ← Header yang benar!
    });

    const { ok, status, data, raw } = await safeJSON(response);

    if (!data) return res.status(502).json({ success: false, error: `Status error (${status}): ${raw?.substring(0,200)}`, statusCode: status });
    if (!ok) return res.status(status).json({ success: false, error: data.detail || data.error || data.message || `Error ${status}`, statusCode: status });

    res.json({ success: true, data });

  } catch (err) {
    console.error('Status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`VILLAINS AI running on port ${PORT}`));
