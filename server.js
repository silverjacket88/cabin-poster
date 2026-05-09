const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');
const app = express();

// ─── QUEUE FILES ─────────────────────────────────────────────────────────────
const QUEUE_FILE = '/tmp/image_queue.json';
const IG_QUEUE_FILE = '/tmp/ig_queue.json';
const FB_CAPTION_COUNTER_FILE = '/tmp/fb_caption_counter.json';
const IG_CAPTION_COUNTER_FILE = '/tmp/ig_caption_counter.json';

// ─── HASHTAGS ─────────────────────────────────────────────────────────────────
const ALL_HASHTAGS = [
  '#vacationrental', '#vacationmode', '#MountainCabin', '#CabinGetaway',
  '#WeekendGetaway', '#WeekendEscape', '#familygetaway', '#bookdirect',
  '#mountainretreat', '#cabinlife', '#staycation', '#cabinvacation'
];

const FOOTER = `\n𝗧𝗛𝗘 𝗦𝗠𝗢𝗞𝗬 𝗠𝗢𝗨𝗡𝗧𝗔𝗜𝗡'𝗦 𝗙𝗜𝗡𝗘𝗦𝗧 𝗧𝗛𝗥𝗘𝗘:\nhttps://www.takemetotheriver.us/\nhttps://www.chasingsunsetcabin.com/\nhttps://www.thewthcabin.com/`;

// ─── CAPTION COUNTER ──────────────────────────────────────────────────────────
function loadCaptionCounter(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {}
  return { postCount: 0 };
}

function saveCaptionCounter(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch (e) {}
}

function getRandomHashtags() {
  const shuffled = [...ALL_HASHTAGS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 5).join(' ');
}

async function generateCaption(counterFile) {
  const counter = loadCaptionCounter(counterFile);
  counter.postCount++;
  saveCaptionCounter(counterFile, counter);

  const hashtags = getRandomHashtags();
  const isPollDay = counter.postCount % 3 === 0;

  // Randomly pick topic theme for variety
  const themes = ['river', 'sunset', 'mountain', 'general smoky mountain cabin'];
  const theme = themes[Math.floor(Math.random() * themes.length)];

  let systemPrompt, userPrompt;

  if (isPollDay) {
   systemPrompt = `You are a fun, conversational social media writer for luxury cabin rentals in Gatlinburg, Pigeon Forge and Sevierville Tennessee. Write one engaging poll question with 3 answer options.

Output ONLY in this exact format with no extra text:
[Question]
[Option 1] / [Option 2] / [Option 3]

Rules:
- Sound like a real person talking to a friend, not a marketer
- Question should make people stop scrolling and want to answer
- Options should be short, specific and relatable
- Mix themes: river cabin, sunset views, mountain lodge, weekend trips, cabin experiences
- Examples of the RIGHT tone:
  "What would you rather hear when you wake up? Flowing water / Quiet mountain air / Nothing at all"
  "Which view would you never get tired of? Right above a river / Endless sunsets / Mountains from every window"
  "You're planning a trip for people you love—what are you choosing? Cozy river vibes / Sunset dinners / Big mountain getaway"
- No hashtags, no emojis unless they feel completely natural`;

    userPrompt = 'Write one poll question with 3 options.';
  } else {
    systemPrompt = `You are a fun, conversational social media writer for luxury cabin rentals in Gatlinburg, Pigeon Forge and Sevierville Tennessee. Write exactly 2 short lines that make people stop scrolling and want to book a cabin.

Rules:
- Sound like a real person, not a marketer
- Casual, warm and relatable tone
- Short and punchy — no flowery poetry
- Make people feel something or picture themselves there
- Examples of the RIGHT tone:
  "Some trips are nice. This one stays with you."
  "The kind of place you keep thinking about long after you leave."
  "You deserve a view like this. Just saying."
- No hashtags
- No quotes around the lines
- Exactly 2 lines separated by a line break`;

    userPrompt = 'Write 2 lines for today\'s cabin post.';
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
      max_tokens: 150,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  const data = await response.json();
    const generated = data.content?.[0]?.text?.trim() || '';

  let caption = '';

  if (isPollDay) {
    caption = `${generated}\n${FOOTER}\n\n${hashtags}`;
  } else {
    caption = `${generated}\n\n${hashtags}`;
  }

  return caption;
}

// ─── QUEUE HELPERS ────────────────────────────────────────────────────────────
function loadQueue(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  queue.remaining = queue.remaining.filter(id => ids.includes(id));
  if (queue.remaining.length === 0) {
    let pool = ids.filter(id => id !== queue.lastUsed);
    if (pool.length === 0) pool = ids;
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
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const INSTAGRAM_DRIVE_FOLDER_ID = process.env.INSTAGRAM_DRIVE_FOLDER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
  const directUrl = imageUrl.replace('export=view', 'export=download');

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

  await new Promise(resolve => setTimeout(resolve, 5000));

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

// ─── CRON: Daily auto-post at 8:45 AM EST ────────────────────────────────────
cron.schedule('0 8 * * *', async () => {
  console.log('[CRON] Daily auto-post triggered at 8:00 AM EST');

  // ── Facebook ──
  try {
    const fbImages = await getDriveImages(GOOGLE_DRIVE_FOLDER_ID);
    if (!fbImages.length) {
      console.log('[CRON] FB: No images found.');
    } else {
      const fbCaption = await generateCaption(FB_CAPTION_COUNTER_FILE);
      const fbImage = await getNextImage(fbImages, QUEUE_FILE);
      console.log(`[CRON] FB Posting: ${fbImage.name} (shuffle queue)`);
      console.log(`[CRON] FB Caption: ${fbCaption.substring(0, 80)}...`);
      const fbResult = await postImageToFacebook(fbImage.url, fbCaption);
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
      const igCaption = await generateCaption(IG_CAPTION_COUNTER_FILE);
      const igImage = await getNextImage(igImages, IG_QUEUE_FILE);
      console.log(`[CRON] IG Posting: ${igImage.name} (shuffle queue)`);
      console.log(`[CRON] IG Caption: ${igCaption.substring(0, 80)}...`);
      const igResult = await postImageToInstagram(igImage.url, igCaption);
      console.log(`[CRON] IG Success. Post ID: ${igResult.id}`);
    }
  } catch (err) {
    console.error('[CRON] IG Failed:', err.message);
  }

}, { timezone: 'America/New_York' });

console.log('[CRON] Scheduled: daily auto-post at 8:45 AM EST');

const PORT = process.env.PORT || 3000;


app.listen(PORT, () => console.log(`Cabin Poster running on port ${PORT}`));
