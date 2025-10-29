import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import pool from './db.js';

const app = express();
const PORT = process.env.PORT || 5050;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* 🌐 Middleware */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* 🧠 Multer (image upload) */
const upload = multer({ storage: multer.memoryStorage() });

/* 🩺 Health Check */
app.get('/health', (_, res) => res.json({ ok: true, service: 'EyeMax Universal AI API' }));

/* 💬 Universal AI Route */
app.post('/api/ai', upload.single('image'), async (req, res) => {
  try {
    const { type = 'auto', input = '' } = req.body;
    const imageBuffer = req.file?.buffer;
    const base64 = imageBuffer ? imageBuffer.toString('base64') : null;

    console.log(`🧠 Incoming AI request: ${type} | image: ${!!imageBuffer}`);

    /* -------------------- System Prompt -------------------- */
    const systemPrompt = `
You are Eya, the intelligent assistant powering EyeMax — a beauty, aesthetics, and analysis AI.
You can handle any of the following tasks depending on context:
1. Analyze facial or eye region photos (return structured JSON with aesthetic insights).
2. Generate personalised beauty, grooming, or maxxing routines.
3. Chat conversationally as an elegant, supportive coach.
4. Return strictly JSON if analysis type requires it.
Never produce medical or surgical suggestions.
`;

    /* -------------------- Message Setup -------------------- */
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: input || 'Analyze this or respond accordingly.' },
          ...(base64
            ? [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${req.file.mimetype};base64,${base64}`,
                    detail: 'high',
                  },
                },
              ]
            : []),
        ],
      },
    ];

    /* -------------------- Call OpenAI -------------------- */
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: type === 'chat' ? 0.8 : 0.4,
      response_format: type.includes('analyze') ? { type: 'json_object' } : undefined,
    });

    const result = completion.choices?.[0]?.message?.content?.trim();
    if (!result) throw new Error('Empty response from AI');

    /* -------------------- Optional DB Save -------------------- */
    try {
      await pool.query(
        'INSERT INTO ai_logs (request_type, input_text, has_image, output_text) VALUES ($1, $2, $3, $4)',
        [type, input, !!imageBuffer, result]
      );
    } catch (err) {
      console.warn('⚠️ Failed to save AI log:', err.message);
    }

    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('❌ AI route error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Internal error' });
  }
});

/* -------------------- Server Start -------------------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EyeMax Universal AI API running on port ${PORT}`);
});