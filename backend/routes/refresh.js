import { Router } from 'express';
import { recomputeAll } from '../services/recompute.js';

const router = Router();

// POST /api/refresh
router.post('/', async (req, res) => {
  try {
    const startTime = Date.now();
    await recomputeAll();
    const elapsed = Date.now() - startTime;
    if (req.io) req.io.emit('dashboard:refresh', { source: 'recompute', ts: Date.now() });
    res.json({ status: 'refreshed', elapsed: `${elapsed}ms`, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
