const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();

app.use(cors());
app.use(express.json());

const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Health check
app.get('/', (req, res) => res.json({ status: 'Cabin Poster API is live' }));

// Get images from Google Drive folder
app.get('/images', async (req, res) => {
  try {
    const { folderId } = req.query;
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType+contains+'image'&fields=files(id,name,thumbnailLink,webContentLink)&key=${GOOGLE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    const images = (data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      url: `https://drive.google.com/uc?export=view&id=${f.id}`,
      thumbnail: f.thumbnailLink
    }));
    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate caption using Claude
app.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: `You are a social media copywriter for a rustic cabin rental brand called Smoky Mountain Escapes. Your voice is poetic, atmospheric, nature-driven — never salesy or corporate.

Brand identity:
- Themes: escape, solitude, nature, seasonal beauty, cozy luxury
- Amenities to weave in naturally when relevant: hot tub, scenic views, fire pit, cozy interiors, all-season

Write a Facebook post caption (2-4 sentences, evocative and warm) then a blank line then hashtags. Under 150 words total. No quotation marks. No preamble. Start directly with the caption.

Format:
[Caption]

[hashtags starting with #]`,
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

// Parse natural language instruction using Claude
app.post('/parse-instruction', async (req, res) => {
  try {
    const { instruction, images } = req.body;
    const imageList = images.map((img, i) => `${i}: ${img.name}`).join('\n');
    const now = new Date();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: `You parse social media scheduling instructions. Current time: ${now.toISOString()}. Current timezone: America/Los_Angeles.

Given a list of images and a user instruction, return ONLY valid JSON with:
- imageIndex: number (index of best matching image, or 0 if unclear)
- scheduledTime: ISO 8601 string in UTC (convert user's local time to UTC, assume Los Angeles timezone if not specified)
- caption_prompt: string (what to write the post about, extracted from instruction)
- immediate: boolean (true if user wants to post now, false if scheduled)

No explanation, no markdown, just raw JSON.`,
        messages: [{
          role: 'user',
          content: `Images:\n${imageList}\n\nInstruction: "${instruction}"`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post or schedule to Facebook
app.post('/post', async (req, res) => {
  try {
    const { message, imageUrl, scheduledTime } = req.body;

    const body = { message, access_token: FB_PAGE_TOKEN };

    if (imageUrl) {
      // Post with photo
      const photoRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: imageUrl,
          caption: message,
          access_token: FB_PAGE_TOKEN,
          ...(scheduledTime && {
            scheduled_publish_time: Math.floor(new Date(scheduledTime).getTime() / 1000),
            published: false
          })
        })
      });
      const photoData = await photoRes.json();
      if (photoData.error) throw new Error(photoData.error.message);
      res.json({ success: true, id: photoData.id, scheduled: !!scheduledTime });
    } else {
      // Text only post
      if (scheduledTime) {
        body.scheduled_publish_time = Math.floor(new Date(scheduledTime).getTime() / 1000);
        body.published = false;
      }
      const fbRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const fbData = await fbRes.json();
      if (fbData.error) throw new Error(fbData.error.message);
      res.json({ success: true, id: fbData.id, scheduled: !!scheduledTime });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cabin Poster running on port ${PORT}`));
