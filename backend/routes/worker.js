import { Router } from 'express';
import { pool } from '../db/index.js';
import { extractSkills, normaliseRole } from '../services/nlp.js';

const router = Router();

// POST /api/worker/profile
router.post('/profile', async (req, res) => {
  try {
    const { jobTitle, city, yearsOfExperience, writeUp } = req.body;
    if (!jobTitle || !city || yearsOfExperience == null || !writeUp) {
      return res.status(400).json({ error: 'All 4 fields are required: jobTitle, city, yearsOfExperience, writeUp' });
    }

    const canonicalRole = normaliseRole(jobTitle);
    const extractedSkillsObj = extractSkills(writeUp);

    // Get vulnerability score for this role-city pair
    const vulnRes = await pool.query(
      'SELECT * FROM vulnerability_scores WHERE canonical_role = $1 AND city = $2 ORDER BY snapshot_date DESC LIMIT 1',
      [canonicalRole, city]
    );
    const vulnScore = vulnRes.rows[0] || null;

    const baseVuln = vulnScore ? vulnScore.score : 50;
    const experienceFactor = Math.min(yearsOfExperience / 20, 1) * 15;
    const aiReadinessFactor = extractedSkillsObj.aiReadiness.length > 0 ? -10 : 5;
    const manualTaskFactor = extractedSkillsObj.implicit.length < 3 ? 8 : 0;

    let riskScore = Math.round(Math.min(100, Math.max(0, baseVuln + experienceFactor + aiReadinessFactor + manualTaskFactor)));

    let riskBand;
    if (riskScore <= 30) riskBand = 'Low';
    else if (riskScore <= 60) riskBand = 'Medium';
    else if (riskScore <= 80) riskBand = 'High';
    else riskBand = 'Critical';

    const topSignals = [];
    if (vulnScore) {
      if (vulnScore.hiring_decline < -10) topSignals.push(`${canonicalRole} hiring in ${city} declined ${Math.abs(vulnScore.hiring_decline)}% in 30 days`);
      if (vulnScore.ai_mention_rate > 20) topSignals.push(`AI tools mentioned in ${vulnScore.ai_mention_rate}% of JDs for this role`);
      if (vulnScore.trend_direction === 'rising') topSignals.push('Automation risk is accelerating');
    }
    if (yearsOfExperience > 10) topSignals.push(`${yearsOfExperience} years tenure increases transition difficulty`);
    if (extractedSkillsObj.aiReadiness.length === 0) topSignals.push('No AI tool familiarity detected in profile');

    const reskillingPath = await generateReskillingPath(canonicalRole, city, extractedSkillsObj);

    // Count peers
    const peersRes = await pool.query('SELECT COUNT(*)::int AS total FROM worker_profiles WHERE canonical_role = $1 AND city = $2', [canonicalRole, city]);
    const lowerRes = await pool.query('SELECT COUNT(*)::int AS total FROM worker_profiles WHERE canonical_role = $1 AND city = $2 AND risk_score < $3', [canonicalRole, city, riskScore]);
    const totalPeers = peersRes.rows[0].total;
    const peerPercentile = totalPeers > 0 ? Math.round((lowerRes.rows[0].total / totalPeers) * 100) : 50;

    const insertRes = await pool.query(`
      INSERT INTO worker_profiles (job_title, canonical_role, city, years_of_experience, write_up, extracted_skills, risk_score, risk_band, risk_delta_30d, top_signals, peer_percentile, reskilling_path)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [jobTitle, canonicalRole, city, yearsOfExperience, writeUp, JSON.stringify(extractedSkillsObj), riskScore, riskBand, vulnScore ? vulnScore.delta_30d : 0, topSignals, peerPercentile, JSON.stringify(reskillingPath)]);

    res.json(insertRes.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/worker/profile/:id
router.get('/profile/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM worker_profiles WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function generateReskillingPath(currentRole, city, skills) {
  const safeRes = await pool.query(
    'SELECT DISTINCT ON (canonical_role) canonical_role, score FROM vulnerability_scores WHERE city = $1 AND score < 40 ORDER BY canonical_role, score ASC LIMIT 3',
    [city]
  );
  if (safeRes.rows.length === 0) {
    return { targetRole: 'Data Analyst', targetRoleHiring: true, totalWeeks: 8, totalHours: 80, steps: [] };
  }
  const targetRole = safeRes.rows[0].canonical_role;

  const allSkills = [...(skills.explicit || []), ...(skills.implicit || [])];
  let courses = [];
  if (allSkills.length > 0) {
    const coursesRes = await pool.query(
      'SELECT * FROM courses WHERE skill_cluster && $1 LIMIT 3',
      [allSkills]
    );
    courses = coursesRes.rows;
  }

  const steps = courses.map((c, i) => ({
    weekRange: `Week ${i * 3 + 1}-${(i + 1) * 3}`,
    courseName: c.name,
    institution: c.institution,
    duration: c.duration,
    cost: c.cost,
    modality: c.modality,
    url: c.url,
  }));

  return {
    targetRole,
    targetRoleHiring: true,
    totalWeeks: steps.length * 3,
    totalHours: courses.reduce((sum, c) => sum + (c.total_hours || 30), 0),
    steps,
  };
}

export default router;
