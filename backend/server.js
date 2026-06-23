import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import pg from 'pg';
import { pool } from './db/index.js';
import { recomputeAll } from './services/recompute.js';
import hiringRoutes from './routes/hiring.js';
import skillsRoutes from './routes/skills.js';
import vulnerabilityRoutes from './routes/vulnerability.js';
import workerRoutes from './routes/worker.js';
import chatbotRoutes from './routes/chatbot.js';
import watchlistRoutes from './routes/watchlist.js';
import refreshRoutes from './routes/refresh.js';
import authRoutes from './routes/auth.js';

const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_KEY = 'layer1:aggregates';
const JOBS_CACHE = 'layer1:recent_jobs';
const AGG_CHANNEL = 'layer1.aggregates';
const SCORES_CHANNEL = 'layer1.scores';
const SCRAPER_CONFIG_CHANNEL = 'scraper.config';
const SCORING_SERVICE_URL = process.env.SCORING_SERVICE_URL || 'http://scoring:5000';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/hiring', hiringRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/vulnerability', vulnerabilityRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/refresh', (req, _res, next) => { req.io = io; next(); }, refreshRoutes);

// ── Real-time aggregate endpoints (from skills-mirage Layer 1) ── 
const redis = new Redis(REDIS_URL, { retryStrategy: (t) => Math.min(t * 500, 5000) });
const redisSub = new Redis(REDIS_URL, { retryStrategy: (t) => Math.min(t * 500, 5000) });

app.get('/api/aggregates', async (_req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));
    const skills = await pool.query("SELECT agg_key AS name, agg_value AS count FROM aggregates WHERE agg_type='skills' ORDER BY agg_value DESC");
    const cities = await pool.query("SELECT agg_key AS name, agg_value AS count FROM aggregates WHERE agg_type='cities' ORDER BY agg_value DESC");
    const companies = await pool.query("SELECT agg_key AS name, agg_value AS count FROM aggregates WHERE agg_type='companies' ORDER BY agg_value DESC");
    const total = await pool.query("SELECT COUNT(*) AS total FROM jobs");

    // Compute skill co-occurrence from jobs table (fallback when Redis empty)
    const topSkillNames = skills.rows.slice(0, 25).map(r => r.name);
    let skill_cooccurrence = [];
    if (topSkillNames.length > 1) {
      const lowered = topSkillNames.map(s => s.toLowerCase());
      const coRes = await pool.query(`
        SELECT s1.lskill AS skill_a, s2.lskill AS skill_b, COUNT(DISTINCT s1.job_id) AS cnt
        FROM (SELECT job_id, LOWER(unnest(skills_list)) AS lskill FROM jobs) s1
        JOIN (SELECT job_id, LOWER(unnest(skills_list)) AS lskill FROM jobs) s2
          ON s1.job_id = s2.job_id AND s1.lskill < s2.lskill
        WHERE s1.lskill = ANY($1) AND s2.lskill = ANY($1)
        GROUP BY s1.lskill, s2.lskill
        HAVING COUNT(DISTINCT s1.job_id) >= 2
        ORDER BY cnt DESC
        LIMIT 60
      `, [lowered]);
      const nameMap = Object.fromEntries(topSkillNames.map(n => [n.toLowerCase(), n]));
      skill_cooccurrence = coRes.rows.map(r => ({ source: nameMap[r.skill_a] || r.skill_a, target: nameMap[r.skill_b] || r.skill_b, weight: parseInt(r.cnt, 10) }));
    }

    res.json({
      total_jobs: parseInt(total.rows[0].total, 10),
      top_skills: skills.rows, top_cities: cities.rows, top_companies: companies.rows,
      skill_cooccurrence,
      updated_at: new Date().toISOString(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/jobs', async (_req, res) => {
  try {
    const raw = await redis.lrange(JOBS_CACHE, 0, 49);
    res.json(raw.map(r => JSON.parse(r)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/jobs/search', async (req, res) => {
  try {
    const { q, city } = req.query;
    let query = 'SELECT * FROM jobs WHERE 1=1';
    const params = [];
    if (q) { params.push(`%${q}%`); query += ` AND (title ILIKE $${params.length} OR array_to_string(skills_list,',') ILIKE $${params.length})`; }
    if (city) { params.push(`%${city}%`); query += ` AND city ILIKE $${params.length}`; }
    query += ' ORDER BY scrape_timestamp DESC LIMIT 50';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// POST /api/vulnerability/score — proxy to Python scoring service
app.post('/api/vulnerability/score', async (req, res) => {
  try {
    const response = await fetch(`${SCORING_SERVICE_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Socket.IO ──────────────────────────────────────────────────── 
io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[ws] client disconnected: ${socket.id}`));

  // Relay scraper config changes to Redis so scraper picks them up
  socket.on('scraper:config', (config) => {
    console.log(`[ws] scraper:config from ${socket.id}:`, config);
    redis.publish(SCRAPER_CONFIG_CHANNEL, JSON.stringify(config));
  });
});

redisSub.subscribe(AGG_CHANNEL);
redisSub.subscribe(SCORES_CHANNEL);
redisSub.on('message', (channel, message) => {
  try {
    const data = JSON.parse(message);
    if (channel === AGG_CHANNEL) {
      io.emit('aggregates', data);
      io.emit('dashboard:refresh', { source: 'processor', ts: Date.now() });
    } else if (channel === SCORES_CHANNEL) {
      io.emit('vulnerability:update', data);
      io.emit('dashboard:refresh', { source: 'ml_scoring', ts: Date.now() });
    }
  } catch (err) {
    console.error('[ws] broadcast error:', err.message);
  }
});

// ── Auto-recompute: PG LISTEN/NOTIFY + fallback interval ───────── 
const RECOMPUTE_DEBOUNCE_MS = 8_000;   // wait 8s after last notification
const RECOMPUTE_INTERVAL_MS = 300_000; // fallback: every 5 minutes
let recomputeTimer = null;
let isRecomputing = false;

async function debouncedRecompute(source) {
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(async () => {
    if (isRecomputing) return;
    isRecomputing = true;
    try {
      console.log(`[auto-refresh] recomputing (triggered by ${source})...`);
      await recomputeAll();
      io.emit('dashboard:refresh', { source, ts: Date.now() });
      console.log('[auto-refresh] done — dashboard notified');
    } catch (err) {
      console.error('[auto-refresh] recompute error:', err.message);
    } finally {
      isRecomputing = false;
    }
  }, RECOMPUTE_DEBOUNCE_MS);
}

async function startPgListener() {
  const DATABASE_URL = process.env.DATABASE_URL || 'postgres://mirage:mirage123@localhost:5433/jobmarket';
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query('LISTEN new_data');
    console.log('[auto-refresh] PG LISTEN active on channel "new_data"');
    client.on('notification', () => debouncedRecompute('pg_notify'));
    client.on('error', (err) => {
      console.error('[auto-refresh] PG listener error:', err.message);
      // reconnect after 5s
      setTimeout(startPgListener, 5000);
    });
  } catch (err) {
    console.error('[auto-refresh] PG LISTEN failed:', err.message, '— retrying in 5s');
    setTimeout(startPgListener, 5000);
  }
}

// Fallback: periodic recompute
setInterval(() => debouncedRecompute('scheduled'), RECOMPUTE_INTERVAL_MS);

// ── Start ──────────────────────────────────────────────────────── 
async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('[backend] PostgreSQL connected');
  } catch (err) {
    console.error('[backend] PostgreSQL connection failed:', err.message);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`[backend] listening on :${PORT}`);
    console.log(`[backend] REST: http://localhost:${PORT}/api/aggregates`);
    console.log(`[backend] WS:   http://localhost:${PORT} (Socket.IO)`);
  });

  // Start PG listener for auto-refresh
  startPgListener();
}

start();
