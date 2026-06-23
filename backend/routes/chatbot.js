import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL || 'http://localhost:8000';

/* ── Helper: build UserProfile from DB user row ───────────────────── */
function buildUserProfile(user, language) {
  const skills = Array.isArray(user.selected_skills) ? user.selected_skills : [];
  const writeup = user.writeup || '';
  const shortWriteup = skills.length
    ? `${writeup}\n\nSkills: ${skills.join(', ')}`
    : writeup;

  return {
    username: user.full_name || 'User',
    user_id: String(user.id),
    current_job: user.job_title || '',
    city: user.city || '',
    yoe: user.years_of_experience || 0,
    language: language || 'english',
    ai_vulnerability_index: 0,
    short_writeup: shortWriteup,
  };
}

/* ── Helper: fetch user from DB by id ─────────────────────────────── */
async function fetchUser(userId) {
  if (!userId) return null;
  const result = await pool.query(
    `SELECT id, full_name, email, job_title, city, writeup, selected_skills, years_of_experience
     FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

/* ── POST /api/chatbot/chat — proxy to chatbot-service /api/chat/ ── */
router.post('/chat', async (req, res) => {
  try {
    const { query, userId, language } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    let userProfile = undefined;
    if (userId) {
      const dbUser = await fetchUser(userId);
      if (dbUser) userProfile = buildUserProfile(dbUser, language);
    }

    const payload = { query, user: userProfile || {} };

    const upstream = await fetch(`${CHATBOT_SERVICE_URL}/api/chat/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[chatbot] chat proxy error:', err.message);
    res.status(502).json({ error: 'Chatbot service unavailable. Please try again later.' });
  }
});

/* ── POST /api/chatbot/plan — proxy to chatbot-service /api/chat/plan */
router.post('/plan', async (req, res) => {
  try {
    const { userId, preferences, language } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const dbUser = await fetchUser(userId);
    if (!dbUser) return res.status(404).json({ error: 'User not found' });

    const userProfile = buildUserProfile(dbUser, language);
    const payload = { user: userProfile, preferences: preferences || '' };

    const upstream = await fetch(`${CHATBOT_SERVICE_URL}/api/chat/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('[chatbot] plan proxy error:', err.message);
    res.status(502).json({ error: 'Chatbot service unavailable. Please try again later.' });
  }
});

/* ── Legacy: POST /api/chatbot/message (kept for backward compat) ── */
router.post('/message', async (req, res) => {
  try {
    const { message, userId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Try proxying through the AI chatbot-service
    let userProfile = undefined;
    if (userId) {
      const dbUser = await fetchUser(userId);
      if (dbUser) userProfile = buildUserProfile(dbUser);
    }

    const payload = { query: message, user: userProfile || {} };
    const upstream = await fetch(`${CHATBOT_SERVICE_URL}/api/chat/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (upstream.ok) {
      const data = await upstream.json();
      return res.json({ reply: data.answer, sources: data.sources || [], tools_used: data.tools_used || [], timestamp: new Date().toISOString() });
    }

    // Fallback: basic response if chatbot-service is unavailable
    res.json({ reply: 'The AI service is currently starting up. Please try again in a moment.', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[chatbot] message error:', err.message);
    res.json({ reply: 'The AI service is currently unavailable. Please try again later.', timestamp: new Date().toISOString() });
  }
});

export default router;
