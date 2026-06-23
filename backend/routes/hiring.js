import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

/** Return a JS Date representing "now" in IST (UTC+5:30). */
function nowIST() {
  const utc = new Date();
  return new Date(utc.getTime() + 5.5 * 60 * 60 * 1000);
}

// GET /api/hiring/trends
router.get('/trends', async (req, res) => {
  try {
    const { city, sector, role, range = '30' } = req.query;
    const days = parseInt(range);
    const startDate = nowIST();
    startDate.setDate(startDate.getDate() - days);

    let query = `
      SELECT (posted_date AT TIME ZONE 'Asia/Kolkata')::date AS date,
             COUNT(*)::int AS count,
             AVG(salary_min)::int AS "avgSalaryMin",
             AVG(salary_max)::int AS "avgSalaryMax"
      FROM jobs WHERE posted_date >= $1
    `;
    const params = [startDate.toISOString()];
    if (city) { params.push(city); query += ` AND city = $${params.length}`; }
    if (sector) { params.push(sector); query += ` AND sector = $${params.length}`; }
    if (role) { params.push(role); query += ` AND canonical_role = $${params.length}`; }
    query += ` GROUP BY (posted_date AT TIME ZONE 'Asia/Kolkata')::date ORDER BY date`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/hiring/summary
router.get('/summary', async (req, res) => {
  try {
    const { city, role, sector, range = '30' } = req.query;
    const days = parseInt(range);
    const now = nowIST();

    // Current window = last `days` days
    const dCur = new Date(now);
    dCur.setDate(dCur.getDate() - days);

    // Previous window = [now - 2*days, now - days], clamped to earliest data
    const earliest = (await pool.query('SELECT MIN(posted_date)::date AS d FROM jobs')).rows[0].d;
    const earliestDate = earliest ? new Date(earliest) : now;
    const idealPrev = new Date(now);
    idealPrev.setDate(idealPrev.getDate() - days * 2);
    const dPrev = idealPrev < earliestDate ? earliestDate : idealPrev;

    // How much of the previous window actually has data coverage?
    const prevWindowMs = dCur - dPrev;
    const prevCoverage = days > 0 ? prevWindowMs / (days * 86400000) : 0;

    // Build params separately for each query to keep $indexes correct
    const params1 = [dCur.toISOString()];
    let where1 = '';
    if (city) { params1.push(city); where1 += ` AND city = $${params1.length}`; }
    if (role) { params1.push(role); where1 += ` AND canonical_role = $${params1.length}`; }
    if (sector) { params1.push(sector); where1 += ` AND sector = $${params1.length}`; }

    const params2 = [dPrev.toISOString(), dCur.toISOString()];
    let where2 = '';
    if (city) { params2.push(city); where2 += ` AND city = $${params2.length}`; }
    if (role) { params2.push(role); where2 += ` AND canonical_role = $${params2.length}`; }
    if (sector) { params2.push(sector); where2 += ` AND sector = $${params2.length}`; }

    const [cur, prev] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM jobs WHERE posted_date >= $1${where1}`, params1),
      pool.query(`SELECT COUNT(*)::int AS c FROM jobs WHERE posted_date >= $1 AND posted_date < $2${where2}`, params2),
    ]);
    const current = cur.rows[0].c;
    const previous = prev.rows[0].c;

    // Only compute change if previous window has >= 50% data coverage
    const change = (prevCoverage >= 0.5 && previous > 0)
      ? Math.round(((current - previous) / previous) * 100)
      : null;

    res.json({
      current,
      previous: prevCoverage >= 0.5 ? previous : null,
      change,
      direction: change == null ? 'n/a' : change >= 0 ? 'up' : 'down',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/hiring/cities
router.get('/cities', async (_req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT city FROM jobs WHERE city IS NOT NULL ORDER BY city');
    res.json(result.rows.map(r => r.city));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/hiring/roles (a.k.a. job categories)
router.get('/roles', async (_req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT canonical_role FROM jobs WHERE canonical_role IS NOT NULL ORDER BY canonical_role');
    res.json(result.rows.map(r => r.canonical_role));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/hiring/sectors
router.get('/sectors', async (_req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT sector FROM jobs WHERE sector IS NOT NULL ORDER BY sector');
    res.json(result.rows.map(r => r.sector));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/hiring/count
router.get('/count', async (req, res) => {
  try {
    const { city, role } = req.query;
    let query = 'SELECT COUNT(*)::int AS count FROM jobs WHERE 1=1';
    const params = [];
    if (city) { params.push(city); query += ` AND city = $${params.length}`; }
    if (role) { params.push(role); query += ` AND canonical_role = $${params.length}`; }
    const result = await pool.query(query, params);
    res.json({ count: result.rows[0].count, city: city || 'All', role: role || 'All' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* City → Indian State mapping (names match datamaps TopoJSON) — canonical 43 cities */
const CITY_STATE = {
  // Tier 1
  Bengaluru: 'Karnataka', Mumbai: 'Maharashtra', Delhi: 'Delhi',
  Pune: 'Maharashtra', Hyderabad: 'Andhra Pradesh', Chennai: 'Tamil Nadu',
  Kolkata: 'West Bengal', Ahmedabad: 'Gujarat',
  // Tier 2
  Noida: 'Uttar Pradesh', Gurugram: 'Haryana', Jaipur: 'Rajasthan',
  Lucknow: 'Uttar Pradesh', Chandigarh: 'Chandigarh', Indore: 'Madhya Pradesh',
  Coimbatore: 'Tamil Nadu', Kochi: 'Kerala', Thiruvananthapuram: 'Kerala',
  Nagpur: 'Maharashtra', Vadodara: 'Gujarat', Bhopal: 'Madhya Pradesh',
  Visakhapatnam: 'Andhra Pradesh', Mysuru: 'Karnataka', Surat: 'Gujarat',
  Patna: 'Bihar', Nashik: 'Maharashtra', Madurai: 'Tamil Nadu',
  // Tier 3
  Mangaluru: 'Karnataka', Hubli: 'Karnataka', Dehradun: 'Uttaranchal',
  Ranchi: 'Jharkhand', Raipur: 'Chhattisgarh', Guwahati: 'Assam',
  Agra: 'Uttar Pradesh', Varanasi: 'Uttar Pradesh', Jabalpur: 'Madhya Pradesh',
  Siliguri: 'West Bengal', Jodhpur: 'Rajasthan', Rajkot: 'Gujarat',
  Tiruchirappalli: 'Tamil Nadu', Kozhikode: 'Kerala', Ludhiana: 'Punjab',
  Bhubaneswar: 'Orissa', Udaipur: 'Rajasthan',
};

// GET /api/hiring/by-state  — job counts grouped by Indian state
router.get('/by-state', async (req, res) => {
  try {
    const { sector, role, range = '30' } = req.query;
    const days = parseInt(range);
    const startDate = nowIST();
    startDate.setDate(startDate.getDate() - days);

    let query = 'SELECT city, COUNT(*)::int AS count FROM jobs WHERE posted_date >= $1';
    const params = [startDate.toISOString()];
    if (sector) { params.push(sector); query += ` AND sector = $${params.length}`; }
    if (role)   { params.push(role);   query += ` AND canonical_role = $${params.length}`; }
    query += ' GROUP BY city';

    const result = await pool.query(query, params);

    // Aggregate by state
    const stateMap = {};
    for (const row of result.rows) {
      const state = CITY_STATE[row.city] || 'Other';
      stateMap[state] = (stateMap[state] || 0) + row.count;
    }
    res.json(Object.entries(stateMap).map(([state, count]) => ({ state, count })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/hiring/hierarchy  — sector→role→count for sunburst
router.get('/hierarchy', async (req, res) => {
  try {
    const { city, range = '30' } = req.query;
    const days = parseInt(range);
    const startDate = nowIST();
    startDate.setDate(startDate.getDate() - days);

    let query = `
      SELECT sector, canonical_role AS role, COUNT(*)::int AS count
      FROM jobs WHERE posted_date >= $1 AND sector IS NOT NULL AND canonical_role IS NOT NULL
    `;
    const params = [startDate.toISOString()];
    if (city) { params.push(city); query += ` AND city = $${params.length}`; }
    query += ' GROUP BY sector, canonical_role ORDER BY sector, count DESC';

    const result = await pool.query(query, params);

    // Build hierarchy: root → sectors → roles
    const sectorMap = {};
    for (const row of result.rows) {
      if (!sectorMap[row.sector]) sectorMap[row.sector] = [];
      sectorMap[row.sector].push({ name: row.role, value: row.count });
    }
    const hierarchy = {
      name: 'Jobs',
      children: Object.entries(sectorMap).map(([sector, children]) => ({
        name: sector,
        children,
      })),
    };
    res.json(hierarchy);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
