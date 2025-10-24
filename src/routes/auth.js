import express from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import appleSigninAuth from 'apple-signin-auth';
import pool from '../db.js';

const router = express.Router();

// ✅ Load from environment
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretbackup';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/* -------------------------------------------------------------------------- */
/* 🧩 Helper — Create or find user in DB                                       */
/* -------------------------------------------------------------------------- */
async function upsertUser(email, provider) {
  const query = `
    INSERT INTO users (email, password_hash)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id, email;
  `;
  const result = await pool.query(query, [email, provider]);
  return result.rows[0];
}

/* -------------------------------------------------------------------------- */
/* 🔐 Helper — Generate JWT                                                   */
/* -------------------------------------------------------------------------- */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

/* -------------------------------------------------------------------------- */
/* 🟢 Google Sign-In                                                          */
/* -------------------------------------------------------------------------- */
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;

    const user = await upsertUser(email, 'google');
    const token = generateToken(user);

    res.json({ ok: true, token, user });
  } catch (err) {
    console.error('❌ Google Sign-In error:', err.message);
    res.status(401).json({ ok: false, error: 'Invalid Google token' });
  }
});

/* -------------------------------------------------------------------------- */
/* 🍎 Apple Sign-In                                                          */
/* -------------------------------------------------------------------------- */
router.post('/apple', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    const decoded = await appleSigninAuth.verifyIdToken(idToken, {
      audience: APPLE_CLIENT_ID,
      ignoreExpiration: false,
    });

    const email = decoded.email || decoded.email_verified;
    const user = await upsertUser(email, 'apple');
    const token = generateToken(user);

    res.json({ ok: true, token, user });
  } catch (err) {
    console.error('❌ Apple Sign-In error:', err.message);
    res.status(401).json({ ok: false, error: 'Invalid Apple token' });
  }
});

export default router;