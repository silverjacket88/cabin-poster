const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

app.get('/', (req, res) => res.json({ status: 'Cabin Poster API is live' }));

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

// Daily auto-post at 8:45 AM EST every day
cron.schedule('45 13 * * *', async () => {
  console.log('[CRON] Daily auto-post triggered at 8:45 AM EST');
  try {
    const images = await getDriveImages(GOOGLE_DRIVE_FOLDER_ID);
    if (!images.length) { console.log('[CRON] No images found.'); return; }
    const randomImage = images[Math.floor(Math.random() * images.length)];
    console.log(`[CRON] Posting: ${randomImage.name}`);
    const result = await postImageToFacebook(randomImage.url, '');
    console.log(`[CRON] Success. Post ID: ${result.id}`);
  } catch (err) {
    console.error('[CRON] Failed:', err.message);
  }
}, { timezone: 'America/New_York' });

console.log('[CRON] Scheduled: daily auto-post at 8:45 AM EST');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cabin Poster running on port ${PORT}`));
