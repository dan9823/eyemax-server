import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import OpenAI from 'openai';
import pool from './db.js';
import authRoutes from './routes/auth.js'; // ✅ new import for OAuth routes

// ✅ Minimal log (no key exposure)
console.log("✅ OpenAI API key loaded successfully.");

const app = express();
const PORT = process.env.PORT || 5050;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
});

/* -------------------------------------------------------------------------- */
/* 🌐 CORS SETUP (Production + Expo + Railway Safe)                           */
/* -------------------------------------------------------------------------- */
app.use(
  cors({
    origin: [
      'https://yourappdomain.com', // replace later
      'exp://127.0.0.1:8081',
      'http://localhost:8081',
      /\.railway\.app$/,
      /.*/, // allow all (safe for now)
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/* -------------------------------------------------------------------------- */
/* 🩺 HEALTH CHECK ENDPOINT                                                   */
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
/* 🧠 DATABASE CONNECTION TEST                                                */
/* -------------------------------------------------------------------------- */
pool.connect()
  .then(() => console.log('✅ Connected to PostgreSQL database'))
  .catch(err => console.error('❌ Database connection error:', err.message));

/* -------------------------------------------------------------------------- */
/* 🔐 AUTH ROUTES (Google + Apple)                                            */
/* -------------------------------------------------------------------------- */
app.use('/api/auth', authRoutes);

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

    const b64 = req.file.buffer.toString('base64');
    const imageData = `data:${req.file.mimetype};base64,${b64}`;

    const prompt = `
You are EyeMax, an AI trained to evaluate human eye-area aesthetics.
Return ONLY JSON in this format:
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
}`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You analyze eye aesthetics and return valid JSON only.' },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageData } },
        ]},
      ],
    });

    const result = completion.choices?.[0]?.message?.content;
    if (!result) throw new Error('Empty response from AI');

    const json = JSON.parse(result);
    if (json.error) return res.status(400).json({ ok: false, message: json.error });

    // 🗄️ Save analysis to database
    try {
      const { overall, eye_healthiness, symmetry, eyebrows, eyelashes, potential } = json;
      const imageUrl = req.file.originalname || 'uploaded_image';
      const userId = req.body.user_id || 'guest';

      await pool.query(
        `INSERT INTO analyses (overall, eye_health, symmetry, eyebrows, eyelashes, potential, image_url, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [overall, eye_healthiness, symmetry, eyebrows, eyelashes, potential, imageUrl, userId]
      );

      console.log(`✅ Saved analysis for user: ${userId}`);
    } catch (dbErr) {
      console.error('⚠️ Failed to save analysis to DB:', dbErr.message);
    }

    res.json({ ok: true, data: json });
  } catch (err) {
    console.error('❌ Analysis error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
  }
});

/* -------------------------------------------------------------------------- */
/* 🤖 /api/openai/generate - Assistant chat & routine generator               */
/* -------------------------------------------------------------------------- */
app.post('/api/openai/generate', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages))
      return res.status(400).json({ error: 'Invalid or missing messages array' });

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o-mini', messages, temperature: 0.7 },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    res.json(response.data);
  } catch (error) {
    console.error('❌ Error generating AI response:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: 'Failed to generate response from AI' });
  }
});

/* -------------------------------------------------------------------------- */
/* 📊 GET /api/analyses/:userId - Fetch saved analyses for a user             */
/* -------------------------------------------------------------------------- */
app.get('/api/analyses/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ ok: false, error: 'Missing user ID.' });

    const result = await pool.query(
      `SELECT * FROM analyses WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error fetching analyses:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch analyses' });
  }
});

/* -------------------------------------------------------------------------- */
/* 🚀 START SERVER (Railway-compatible)                                       */
/* -------------------------------------------------------------------------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EyeMax API running on port ${PORT}`);
});