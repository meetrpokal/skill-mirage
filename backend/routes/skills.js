import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

// GET /api/skills/trending
router.get('/trending', async (req, res) => {
  try {
    const { city, sector, limit = 20 } = req.query;
    let risingQ = `SELECT * FROM skill_mentions WHERE direction = 'rising'`;
    let decliningQ = `SELECT * FROM skill_mentions WHERE direction = 'declining'`;
    const params = [];
    if (city) { params.push(city); risingQ += ` AND city = $${params.length}`; decliningQ += ` AND city = $${params.length}`; }
    if (sector) { params.push(sector); risingQ += ` AND sector = $${params.length}`; decliningQ += ` AND sector = $${params.length}`; }
    const lim = parseInt(limit);
    params.push(lim);
    risingQ += ` ORDER BY week_over_week_change DESC LIMIT $${params.length}`;
    decliningQ += ` ORDER BY week_over_week_change ASC LIMIT $${params.length}`;

    const [rising, declining] = await Promise.all([
      pool.query(risingQ, params),
      pool.query(decliningQ, params),
    ]);
    res.json({ rising: rising.rows, declining: declining.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/skills/gap
router.get('/gap', async (req, res) => {
  try {
    const { city, page = '1', limit = '20' } = req.query;
    const lim = Math.min(parseInt(limit) || 20, 100);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

    let where = ` WHERE direction = 'rising' AND has_gov_course = FALSE`;
    const params = [];
    if (city) { params.push(city); where += ` AND city = $${params.length}`; }

    const countQ = pool.query(`SELECT COUNT(*)::int AS total FROM skill_mentions${where}`, params);
    const dataParams = [...params, lim, offset];
    const dataQ = pool.query(
      `SELECT * FROM skill_mentions${where} ORDER BY week_over_week_change DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    const [countRes, dataRes] = await Promise.all([countQ, dataQ]);
    const total = countRes.rows[0].total;
    res.json({ rows: dataRes.rows, total, page: Math.floor(offset / lim) + 1, hasMore: offset + lim < total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
