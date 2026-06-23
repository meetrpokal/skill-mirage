import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/index.js';

const router = Router();

/* ── Helpers ──────────────────────────────────────────────────────── */
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: `${salt}:${hash}` };
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = stored.split(':');
  const { hash } = hashPassword(password, salt);
  return hash === stored;
}

/* ── POST /api/auth/signup ────────────────────────────────────────── */
router.post('/signup', async (req, res) => {
  try {
    const { fullName, email, password, jobTitle, city, writeup, selectedSkills, yearsOfExperience } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Check existing
    const exists = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Email already taken.' });
    }

    const { hash } = hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, job_title, city, writeup, selected_skills, years_of_experience)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, full_name, email, job_title, city, writeup, selected_skills, years_of_experience, created_at`,
      [fullName.trim(), email.trim().toLowerCase(), hash, jobTitle || null, city || null, writeup || null, selectedSkills || [], parseInt(yearsOfExperience) || 0]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error('[auth] signup error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/* ── POST /api/auth/login ─────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/* ── GET /api/auth/me/:id ─────────────────────────────────────────── */
router.get('/me/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, job_title, city, writeup, selected_skills, years_of_experience, created_at
       FROM users WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[auth] me error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/* ── GET /api/auth/dropdown/job-titles ────────────────────────────── */
router.get('/dropdown/job-titles', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT canonical_role FROM jobs
       WHERE canonical_role IS NOT NULL AND canonical_role != ''
       ORDER BY canonical_role`
    );
    res.json(result.rows.map(r => r.canonical_role));
  } catch (err) {
    console.error('[auth] job-titles error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/* ── GET /api/auth/dropdown/cities ────────────────────────────────── */
router.get('/dropdown/cities', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT city FROM jobs
       WHERE city IS NOT NULL AND city != ''
       ORDER BY city`
    );
    res.json(result.rows.map(r => r.city));
  } catch (err) {
    console.error('[auth] cities error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/* ── GET /api/auth/dropdown/skills ────────────────────────────────── */
router.get('/dropdown/skills', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT LOWER(s) AS skill, COUNT(*) AS cnt
       FROM jobs, LATERAL unnest(skills_list) AS s
       WHERE s IS NOT NULL AND s != ''
       GROUP BY LOWER(s)
       ORDER BY cnt DESC
       LIMIT 200`
    );
    res.json(result.rows.map(r => r.skill));
  } catch (err) {
    console.error('[auth] skills error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
