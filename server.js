const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');
const app = express();

// ─── QUEUE FILES ─────────────────────────────────────────────────────────────
const QUEUE_FILE = '/tmp/image_queue.json';
const IG_QUEUE_FILE = '/tmp/ig_queue.json';

// ─── QUEUE HELPERS ────────────────────────────────────────────────────────────
function loadQueue(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {}
  return { remaining: [], used: [] };
}

function saveQueue(file, queue) {
  try { fs.writeFileSync(file, JSON.stringify(queue)); } catch (e) {}
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function getNextImage(images, queueFile) {
  const ids = images.map(img => img.id);
  let queue = loadQueue(queueFile);

  // Filter remaining to only valid current images
  queue.remaining = queue.remaining.filter(id => ids.includes(id));

  // If queue is empty, reshuffle all images (excluding last used if possible)
  if (queue.remaining.length === 0) {
    let pool = ids.filter(id => id !== queue.lastUsed);
    if (pool.length === 0) pool = ids; // only 1 image edge case
    queue.remaining = shuffleArray(pool);
    queue.used = [];
  }

  const nextId = queue.remaining.shift();
  queue.lastUsed = nextId;
  queue.used.push(nextId);
  saveQueue(queueFile, queue);

  return images.find(img => img.id === nextId);
}

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── ENV VARS ─────────────────────────────────────────────────────────────────
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const INSTAGRAM_DRIVE_FOLDER_ID = process.env.INSTAGRAM_DRIVE_FOLDER_ID;

app.get('/', (req, res) => res.json({ status: 'Cabin Poster API is live' }));

// ─── GOOGLE DRIVE ─────────────────────────────────────────────────────────────
async function getDriveImages(folderId) {
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType+contains+'image'&fields=files(id,name,thumbnailLink,webContentLink)&key=${GOOGLE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  return (data.files || []).map(f => ({
    id: f.id,
    name: f.name,
    url: `https://drive.google.com/uc?export=view&id=${f.id}`,
    thumbnail: f.thumbnailLink
  }));
}

app.get('/images', async (req, res) => {
  try {
    const images = await getDriveImages(req.query.folderId);
    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FACEBOOK POSTING ─────────────────────────────────────────────────────────
async function postImageToFacebook(imageUrl, caption) {
  const photoRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl, caption: caption || '', access_token: FB_PAGE_TOKEN })
  });
  const photoData = await photoRes.json();
  if (photoData.error) throw new Error(photoData.error.message);
  return photoData;
}

// ─── INSTAGRAM POSTING ────────────────────────────────────────────────────────
async function postImageToInstagram(imageUrl, caption) {
  // Convert to direct download URL
  const directUrl = imageUrl.replace('export=view', 'export=download');

  // Step 1: Create media container
  const uploadRes = await fetch(`https://graph.facebook.com/v25.0/${INSTAGRAM_ACCOUNT_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: directUrl,
      caption: caption || '',
      access_token: FB_PAGE_TOKEN
    })
  });
  const uploadData = await uploadRes.json();
  if (uploadData.error) throw new Error('IG upload failed: ' + uploadData.error.message);

  // Wait for Instagram to process the image
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Step 2: Publish the container
  const publishRes = await fetch(`https://graph.facebook.com/v25.0/${INSTAGRAM_ACCOUNT_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: uploadData.id,
      access_token: FB_PAGE_TOKEN
    })
  });
  const publishData = await publishRes.json();
  if (publishData.error) throw new Error('IG publish failed: ' + publishData.error.message);
  return publishData;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.post('/post', async (req, res) => {
  try {
    const { message, imageUrl, scheduledTime } = req.body;
    const body = { url: imageUrl, caption: message || '', access_token: FB_PAGE_TOKEN };
    if (scheduledTime) {
      body.scheduled_publish_time = Math.floor(new Date(scheduledTime).getTime() / 1000);
      body.published = false;
    }
    const photoRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const photoData = await photoRes.json();
    if (photoData.error) throw new Error(photoData.error.message);
    res.json({ success: true, id: photoData.id, scheduled: !!scheduledTime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: `You are a social media copywriter for Smoky Mountain Escapes cabin rentals. Write poetic, atmospheric captions. Format: [Caption]\n\n[hashtags]`,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const full = data.content?.[0]?.text || '';
    const parts = full.trim().split(/\n\n+/);
    res.json({ caption: parts[0] || full, hashtags: parts[1] || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CRON: Daily auto-post at 8:45 AM EST ────────────────────────────────────
cron.schedule('45 13 * * *', async () => {
  console.log('[CRON] Daily auto-post triggered at 8:45 AM EST');

  // ── Facebook ──
  try {
    const fbImages = await getDriveImages(GOOGLE_DRIVE_FOLDER_ID);
    if (!fbImages.length) {
      console.log('[CRON] FB: No images found.');
    } else {
      const fbImage = await getNextImage(fbImages, QUEUE_FILE);
      console.log(`[CRON] FB Posting: ${fbImage.name} (shuffle queue)`);
      const fbResult = await postImageToFacebook(fbImage.url, '');
      console.log(`[CRON] FB Success. Post ID: ${fbResult.id}`);
    }
  } catch (err) {
    console.error('[CRON] FB Failed:', err.message);
  }

  // ── Instagram ──
  try {
    const igImages = await getDriveImages(INSTAGRAM_DRIVE_FOLDER_ID);
    if (!igImages.length) {
      console.log('[CRON] IG: No images found.');
    } else {
      const igImage = await getNextImage(igImages, IG_QUEUE_FILE);
      console.log(`[CRON] IG Posting: ${igImage.name} (shuffle queue)`);
      const igResult = await postImageToInstagram(igImage.url, '');
      console.log(`[CRON] IG Success. Post ID: ${igResult.id}`);
    }
  } catch (err) {
    console.error('[CRON] IG Failed:', err.message);
  }

}, { timezone: 'America/New_York' });

console.log('[CRON] Scheduled: daily auto-post at 8:45 AM EST');

const PORT = process.env.PORT || 3000;

// TEMP TEST ROUTES - REMOVE AFTER TESTING
app.get('/test-fb', async (req, res) => {
  try {
    const fbImages = await getDriveImages(GOOGLE_DRIVE_FOLDER_ID);
    const fbImage = await getNextImage(fbImages, QUEUE_FILE);
    const fbResult = await postImageToFacebook(fbImage.url, '');
    res.json({ success: true, postId: fbResult.id, image: fbImage.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/test-ig', async (req, res) => {
  try {
    const igImages = await getDriveImages(INSTAGRAM_DRIVE_FOLDER_ID);
    const igImage = await getNextImage(igImages, IG_QUEUE_FILE);
    const igResult = await postImageToInstagram(igImage.url, '');
    res.json({ success: true, postId: igResult.id, image: igImage.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(PORT, () => console.log(`Cabin Poster running on port ${PORT}`));
