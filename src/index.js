import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import OpenAI from 'openai';
import pool from './db.js';

console.log("✅ OpenAI API key loaded successfully.");

const app = express();
const PORT = process.env.PORT || 5050;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

process.on('unhandledRejection', (err) => console.error('💥 Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('💥 Uncaught exception:', err));

/* 🌐 CORS ------------------------------------------------------------- */
app.use(
  cors({
    origin: [
      'https://yourappdomain.com',
      'exp://127.0.0.1:8081',
      'http://localhost:8081',
      /\.railway\.app$/,
      /.*/,
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/* 🩺 HEALTH ------------------------------------------------------------ */
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'EyeMax API',
  });
});

/* 🧠 DATABASE ---------------------------------------------------------- */
pool.connect()
  .then(() => console.log('✅ Connected to PostgreSQL database'))
  .catch(err => console.error('❌ Database connection error:', err.message));

/* 📸 MULTER ------------------------------------------------------------ */
const upload = multer({ storage: multer.memoryStorage() });

/* 🧠 /api/analyze ------------------------------------------------------ */
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No image uploaded.' });

    const b64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${b64}`;
    console.log(`🧠 Received image (${req.file.mimetype}, ${req.file.size} bytes)`);

    const prompt = `
You are EyeMax — a professional AI specializing in analyzing the *aesthetic quality and health* of the human eye region.
You are looking directly at the uploaded selfie photo.
Use the image to evaluate the following traits, and then provide detailed aesthetic insights and improvement suggestions.

Return ONLY valid JSON in this structure:
{
  "eyebrows": number (0–10),
  "eyelashes": number (0–10),
  "symmetry": number (0–10),
  "canthal_tilt": number (0–10),
  "eye_healthiness": number (0–10),
  "overall": number (0–10),
  "potential": number (0–10),
  "eye_color": string,
  "notes": string[],
  "improvements": string[]
}

Rules:
- Base all scores and notes on the actual uploaded photo.
- Never use generic text. Make each output unique and descriptive.
- "notes" should describe the specific features (shape, brightness, symmetry, etc.)
- "improvements" should contain short actionable suggestions.
`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o', // ✅ full vision model
      response_format: { type: 'json_object' },
      temperature: 0.6,
      messages: [
        { role: 'system', content: 'You analyze uploaded eye selfies and return only JSON based on the photo.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } }, // ✅ correct multimodal input
          ],
        },
      ],
    });

    const result = completion.choices?.[0]?.message?.content;
    if (!result) throw new Error('Empty response from OpenAI.');
    console.log('🧩 AI responded successfully with JSON.');

    const json = JSON.parse(result);

    // 🗄️ Save to DB
    try {
      const { overall, eye_healthiness, symmetry, eyebrows, eyelashes, potential } = json;
      const imageUrl = req.file.originalname || 'uploaded_image';
      const userId = req.body.user_id || null;

      await pool.query(
        `INSERT INTO analyses (overall, eye_health, symmetry, eyebrows, eyelashes, potential, image_url, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid)`,
        [overall, eye_healthiness, symmetry, eyebrows, eyelashes, potential, imageUrl, userId]
      );

      console.log(`✅ Saved analysis for user: ${userId || 'anonymous'}`);
    } catch (dbErr) {
      console.error('⚠️ Failed to save analysis to DB:', dbErr.message);
    }

    res.json({ ok: true, data: json });
  } catch (err) {
    console.error('❌ Analysis error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
  }
});

/* 🤖 /api/openai/generate ---------------------------------------------- */
app.post('/api/openai/generate', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages))
      return res.status(400).json({ error: 'Invalid or missing messages array' });

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o', messages, temperature: 0.7 },
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
    res.status(error.response?.status || 500).json({ error: 'Failed to generate response from AI' });
  }
});

/* 📊 GET /api/analyses/:userId ----------------------------------------- */
app.get('/api/analyses/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId)
      return res.status(400).json({ ok: false, error: 'Missing user ID.' });

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

/* 🚀 START SERVER ------------------------------------------------------ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EyeMax API running on port ${PORT}`);
});