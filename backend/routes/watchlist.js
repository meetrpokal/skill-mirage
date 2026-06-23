import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

// GET /api/watchlist
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM watchlist_alerts WHERE is_active = TRUE ORDER BY consecutive_decline_months DESC, severity DESC'
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
