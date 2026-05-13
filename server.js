const express = require('express');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── ENV VARS ────────────────────────────────────────────────────────────────
const FB_PAGE_ID                 = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN              = process.env.FB_PAGE_TOKEN;
const GOOGLE_API_KEY             = process.env.GOOGLE_API_KEY;
const GOOGLE_DRIVE_FOLDER_ID     = process.env.GOOGLE_DRIVE_FOLDER_ID;      // FB images
const INSTAGRAM_ACCOUNT_ID       = process.env.INSTAGRAM_ACCOUNT_ID;
const INSTAGRAM_DRIVE_FOLDER_ID  = process.env.INSTAGRAM_DRIVE_FOLDER_ID;   // IG images
const ANTHROPIC_API_KEY          = process.env.ANTHROPIC_API_KEY;

// ─── QUEUE FILE PATHS ────────────────────────────────────────────────────────
const FB_QUEUE_FILE      = '/tmp/image_queue.json';
const IG_QUEUE_FILE      = '/tmp/ig_queue.json';
const FB_COUNTER_FILE    = '/tmp/fb_caption_counter.json';
const IG_COUNTER_FILE    = '/tmp/ig_caption_counter.json';

// ─── HASHTAG POOL ────────────────────────────────────────────────────────────
const HASHTAG_POOL = [
  '#vacationrental', '#vacationmode', '#SunsetCabin', '#CabinGetaway',
  '#WeekendGetaway', '#WeekendEscape', '#familygetaway', '#bookdirect',
  '#sunsetviews', '#cabinlife', '#staycation', '#cabinvacation'
];

// ─── POLL FOOTER — 705 / CHASING SUNSET CABIN ───────────────────────────────
const POLL_FOOTER = `\n\n𝗖𝗛𝗔𝗦𝗜𝗡𝗚 𝗦𝗨𝗡𝗦𝗘𝗧 𝗖𝗔𝗕𝗜𝗡 — 𝗦𝗘𝗩𝗜𝗘𝗥𝗩𝗜𝗟𝗟𝗘, 𝗧𝗡\nhttps://chasingsunsetcabin.com/`;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getRandomHashtags(count = 5) {
  const shuffled = [...HASHTAG_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).join(' ');
}

function loadCounter(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data.count || 0;
    }
  } catch (e) {}
  return 0;
}

function saveCounter(filePath, count) {
  try {
    fs.writeFileSync(filePath, JSON.stringify({ count }), 'utf8');
  } catch (e) {}
}

function loadQueue(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data;
    }
  } catch (e) {}
  return { queue: [], lastPosted: null };
}

function saveQueue(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
  } catch (e) {}
}

// ─── GOOGLE DRIVE ────────────────────────────────────────────────────────────

async function getDriveImages(folderId) {
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType+contains+'image/'&key=${GOOGLE_API_KEY}&fields=files(id,name)`;
  const res = await fetch(url);
  const data = await res.json();
  return data.files || [];
}

// ─── SHUFFLE QUEUE ───────────────────────────────────────────────────────────

async function getNextImage(queueFilePath, folderId) {
  let { queue, lastPosted } = loadQueue(queueFilePath);

  if (!queue || queue.length === 0) {
    const images = await getDriveImages(folderId);
    if (!images.length) throw new Error('No images found in Drive folder: ' + folderId);

    let shuffled = [...images].sort(() => Math.random() - 0.5);

    // Never start with the last posted image
    if (lastPosted && shuffled[0].id === lastPosted) {
      shuffled = [...shuffled.slice(1), shuffled[0]];
    }

    queue = shuffled;
    console.log(`[QUEUE] New shuffle cycle: ${queue.length} images`);
  }

  const next = queue.shift();
  saveQueue(queueFilePath, { queue, lastPosted: next.id });
  return next;
}

// ─── ANTHROPIC CAPTION ───────────────────────────────────────────────────────

async function generateCaption(isPollDay) {
  try {
    let prompt;

    if (isPollDay) {
      prompt = `You write social media captions for a luxury mountain cabin called Chasing Sunset Cabin located at 705 Shell Mountain Road, Sevierville, TN near the Smoky Mountains.

Write a short, casual, conversational poll question for a Facebook/Instagram post.
Format:
- One question (max 10 words)
- Three short answer options separated by " / "
- Tone: warm, fun, like asking a friend
- Lean into golden hour, sunset views, and mountain magic

Only output the question and options. Nothing else. No hashtags. No extra text.

Example format:
What's your perfect sunset evening?
Wine on the deck / Hot tub at dusk / Bonfire under the stars`;
    } else {
      prompt = `You write social media captions for a luxury mountain cabin called Chasing Sunset Cabin located at 705 Shell Mountain Road, Sevierville, TN near the Smoky Mountains.

Write exactly 2 short, casual, punchy lines for a Facebook/Instagram post.
- Tone: warm, conversational, like talking to a friend
- Short and punchy, not poetic or flowery
- Lean into golden hour, sunset views, and that magical mountain evening feeling
- Do NOT use hashtags
- Do NOT mention the cabin name or address
- Just evoke the feeling of being there
- Vary your angle every time — sometimes the view, sometimes the silence, sometimes arriving, sometimes who you'd bring
- Never repeat the same theme, feeling, or imagery two days in a row

Only output the 2 lines. Nothing else.

Examples of the right tone:
"Some trips are nice. This one stays with you."
"The kind of place you keep thinking about long after you leave."
"You deserve a view like this. Just saying."`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (e) {
    console.error('[CAPTION] Anthropic API error:', e.message);
    return null;
  }
}

// ─── BUILD FULL CAPTION ──────────────────────────────────────────────────────

async function buildCaption(counterFilePath) {
  let count = loadCounter(counterFilePath);
  count = (count % 3) + 1;
  saveCounter(counterFilePath, count);

  const isPollDay = (count === 3);
  const aiText = await generateCaption(isPollDay);
  const hashtags = getRandomHashtags(5);

  let caption = '';

  if (aiText) {
    caption = aiText;
  }

  if (isPollDay) {
    caption += POLL_FOOTER;
  }

  caption += '\n\n' + hashtags;

  return caption.trim();
}

// ─── POST TO FACEBOOK ────────────────────────────────────────────────────────

async function postToFacebook(imageFile) {
  const imageUrl = `https://drive.google.com/uc?export=download&id=${imageFile.id}`;
  const caption = await buildCaption(FB_COUNTER_FILE);

  console.log(`[CRON] FB Posting: ${imageFile.name} (shuffle queue)`);
  console.log(`[CRON] FB Caption: ${caption.substring(0, 80)}...`);

  const res = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imageUrl,
      caption: caption,
      access_token: FB_PAGE_TOKEN
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(`FB API Error: ${JSON.stringify(data.error)}`);

  console.log(`[CRON] FB Success. Post ID: ${data.id}`);
  return data;
}

// ─── POST TO INSTAGRAM ───────────────────────────────────────────────────────

async function postToInstagram(imageFile) {
  const imageUrl = `https://drive.google.com/uc?export=download&id=${imageFile.id}`;
  const caption = await buildCaption(IG_COUNTER_FILE);

  console.log(`[CRON] IG Posting: ${imageFile.name} (shuffle queue)`);
  console.log(`[CRON] IG Caption: ${caption.substring(0, 80)}...`);

  // Step 1: Create media container
  const uploadRes = await fetch(`https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: caption,
      access_token: FB_PAGE_TOKEN
    })
  });

  const uploadData = await uploadRes.json();
  if (uploadData.error) throw new Error(`IG Upload Error: ${JSON.stringify(uploadData.error)}`);

  const creationId = uploadData.id;

  // Step 2: Wait 5 seconds then publish
  await new Promise(resolve => setTimeout(resolve, 5000));

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: creationId,
      access_token: FB_PAGE_TOKEN
    })
  });

  const publishData = await publishRes.json();
  if (publishData.error) throw new Error(`IG Publish Error: ${JSON.stringify(publishData.error)}`);

  console.log(`[CRON] IG Success. Post ID: ${publishData.id}`);
  return publishData;
}

// ─── DAILY AUTO-POST ─────────────────────────────────────────────────────────

async function runDailyPost() {
  console.log('[CRON] Daily auto-post triggered at 8:00 AM EST');

  try {
    const fbImage = await getNextImage(FB_QUEUE_FILE, GOOGLE_DRIVE_FOLDER_ID);
    await postToFacebook(fbImage);
  } catch (err) {
    console.error('[CRON] FB post failed:', err.message);
  }

  try {
    const igImage = await getNextImage(IG_QUEUE_FILE, INSTAGRAM_DRIVE_FOLDER_ID);
    await postToInstagram(igImage);
  } catch (err) {
    console.error('[CRON] IG post failed:', err.message);
  }
}

// ─── CRON SCHEDULE — 8:00 AM EST (13:00 UTC) ────────────────────────────────

cron.schedule('0 8 * * *', () => {
  runDailyPost();
}, {
  timezone: 'America/New_York'
});

console.log('[CRON] Scheduled: daily auto-post at 8:00 AM EST');

// ─── TEST ROUTES ─────────────────────────────────────────────────────────────

// Test Google Drive connection for FB folder
app.get('/images', async (req, res) => {
  const folderId = req.query.folderId || GOOGLE_DRIVE_FOLDER_ID;
  try {
    const images = await getDriveImages(folderId);
    res.json({ count: images.length, images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger — posts to both FB and IG immediately
app.get('/test-post', async (req, res) => {
  res.json({ status: 'triggered', message: 'Check Railway logs for results' });
  await runDailyPost();
});

// Test FB only
app.get('/test-fb', async (req, res) => {
  try {
    const image = await getNextImage(FB_QUEUE_FILE, GOOGLE_DRIVE_FOLDER_ID);
    const result = await postToFacebook(image);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test IG only
app.get('/test-ig', async (req, res) => {
  try {
    const image = await getNextImage(IG_QUEUE_FILE, INSTAGRAM_DRIVE_FOLDER_ID);
    const result = await postToInstagram(image);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('705 Chasing Sunset Cabin Auto-Poster — Live ✅');
});

// ─── START ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[SERVER] 705 Chasing Sunset Cabin Auto-Poster running on port ${PORT}`);
});
