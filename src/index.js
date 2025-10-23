import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import OpenAI from 'openai';

// ✅ Cleaner log (no key prefix exposure)
console.log("✅ OpenAI API key loaded successfully.");

const app = express();
const PORT = process.env.PORT || 5050;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------------------------------------------------------------- */
/* 🌐 CORS SETUP (Production + Expo + Railway Safe)                           */
/* -------------------------------------------------------------------------- */
app.use(
  cors({
    origin: [
      'https://yourappdomain.com',   // <-- Replace with your real web/app domain later if you have one
      'exp://127.0.0.1:8081',        // for local Expo testing
      'http://localhost:8081',       // local fallback
      /\.railway\.app$/,              // allow all Railway-hosted environments
      /.*/                            // allow all (safe for now — no browser frontend)
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/* -------------------------------------------------------------------------- */
/* 🩺 HEALTH CHECK ENDPOINT (for monitoring / uptime)                         */
/* -------------------------------------------------------------------------- */
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'EyeMax API',
  });
});

/* -------------------------------------------------------------------------- */
/* 🏠 ROOT ROUTE                                                              */
/* -------------------------------------------------------------------------- */
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'EyeMax API', version: '0.3.1' });
});

/* -------------------------------------------------------------------------- */
/* 📸 MULTER SETUP FOR IMAGE UPLOADS                                          */
/* -------------------------------------------------------------------------- */
const upload = multer({ storage: multer.memoryStorage() });

/* -------------------------------------------------------------------------- */
/* 🧠 /api/analyze - Eye Analysis via GPT-4o-mini Vision                      */
/* -------------------------------------------------------------------------- */
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No image uploaded.' });
    }

    // Convert to base64 data URI
    const b64 = req.file.buffer.toString('base64');
    const imageData = `data:${req.file.mimetype};base64,${b64}`;

    // 🧩 Vision prompt
    const prompt = `
You are EyeMax, an AI trained to evaluate human eye-area aesthetics with precision and empathy.
Your tone should be direct but motivating — no excessive kindness or flattery.

You must return ONLY valid JSON in this format:

{
  "eyebrows": number,
  "eyelashes": number,
  "symmetry": number,
  "canthal_tilt": number,
  "eye_healthiness": number,
  "overall": number,
  "potential": number,
  "eye_color": string,
  "notes": string[],
  "improvements": string[]
}

Evaluation guidelines:
- Score 100 = world-class, 80–90 = excellent, 70–79 = above average, 60–69 = below average, <60 = poor.
- "Potential" should always exceed "overall".
- If eyes aren’t visible, respond: {"error": "Eyes not clearly visible. Please retake photo."}
- Keep “improvements” natural: sleep, hydration, cold compress, posture, massage, lighting, etc.
- Focus on symmetry, brightness, and proportion — ignore filters or makeup.
`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You analyze eye-area aesthetics precisely and return JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageData } },
          ],
        },
      ],
    });

    const result = completion.choices?.[0]?.message?.content;
    if (!result) throw new Error('Empty response from AI');
    const json = JSON.parse(result);

    if (json.error) {
      return res.status(400).json({ ok: false, message: json.error });
    }

    res.json({ ok: true, data: json });
  } catch (err) {
    console.error('❌ Analysis error:', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Internal server error during analysis',
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 🤖 /api/openai/generate - Assistant chat & routine generator               */
/* -------------------------------------------------------------------------- */
app.post('/api/openai/generate', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid or missing messages array' });
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('❌ Error generating AI response:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to generate response from AI',
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 🚀 START SERVER (Railway-compatible)                                       */
/* -------------------------------------------------------------------------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EyeMax API running on port ${PORT}`);
});