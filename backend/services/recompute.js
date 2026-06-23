import { pool } from '../db/index.js';

/** Return a JS Date representing "now" in IST (UTC+5:30). */
function nowIST() {
  const utc = new Date();
  return new Date(utc.getTime() + 5.5 * 60 * 60 * 1000);
}

export async function recomputeAll() {
  const now = nowIST();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
  const d120 = new Date(now); d120.setDate(d120.getDate() - 120);

  const rolesRes = await pool.query('SELECT DISTINCT canonical_role FROM jobs WHERE canonical_role IS NOT NULL');
  const citiesRes = await pool.query('SELECT DISTINCT city FROM jobs WHERE city IS NOT NULL');
  const roles = rolesRes.rows.map(r => r.canonical_role);
  const cities = citiesRes.rows.map(r => r.city);

  for (const role of roles) {
    for (const city of cities) {
      const [recentRes, priorRes] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS c FROM jobs WHERE canonical_role=$1 AND city=$2 AND posted_date >= $3', [role, city, d90.toISOString()]),
        pool.query('SELECT COUNT(*)::int AS c FROM jobs WHERE canonical_role=$1 AND city=$2 AND posted_date >= $3 AND posted_date < $4', [role, city, d120.toISOString(), d90.toISOString()]),
      ]);
      const recent = recentRes.rows[0].c;
      const prior = priorRes.rows[0].c;
      const hiringDecline = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : 0;

      const totalPosts = recent;
      const aiRes = await pool.query(
        "SELECT COUNT(*)::int AS c FROM jobs WHERE canonical_role=$1 AND city=$2 AND posted_date >= $3 AND array_length(ai_tool_mentions,1) > 0",
        [role, city, d90.toISOString()]
      );
      const aiPosts = aiRes.rows[0].c;
      const aiMentionRate = totalPosts > 0 ? Math.round((aiPosts / totalPosts) * 100) : 0;

      const aiNativeRes = await pool.query(
        "SELECT COUNT(*)::int AS c FROM jobs WHERE city=$1 AND posted_date >= $2 AND canonical_role ~* 'AI|Machine Learning|Automation'",
        [city, d90.toISOString()]
      );
      const aiNativeCount = aiNativeRes.rows[0].c;
      const traditionalCount = recent || 1;
      const displacementRatio = Math.min(Math.round((aiNativeCount / traditionalCount) * 100), 100);

      const declineSignal = Math.min(Math.max(Math.abs(hiringDecline), 0), 100);
      const score = Math.round(Math.min(100, Math.max(0,
        (declineSignal * 0.40) + (aiMentionRate * 0.35) + (displacementRatio * 0.25)
      )));

      const prevRes = await pool.query('SELECT score FROM vulnerability_scores WHERE canonical_role=$1 AND city=$2 ORDER BY snapshot_date DESC LIMIT 1', [role, city]);
      const prev = prevRes.rows[0];
      const delta30d = prev ? score - prev.score : 0;
      const trendDirection = delta30d > 2 ? 'rising' : delta30d < -2 ? 'falling' : 'stable';

      let riskBand;
      if (score <= 30) riskBand = 'Low';
      else if (score <= 60) riskBand = 'Medium';
      else if (score <= 80) riskBand = 'High';
      else riskBand = 'Critical';

      await pool.query(`
        INSERT INTO vulnerability_scores (canonical_role, city, score, risk_band, hiring_decline, ai_mention_rate, displacement_ratio, trend_direction, delta_30d, snapshot_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (canonical_role, city) DO UPDATE SET
          score = EXCLUDED.score,
          risk_band = EXCLUDED.risk_band,
          hiring_decline = EXCLUDED.hiring_decline,
          ai_mention_rate = EXCLUDED.ai_mention_rate,
          displacement_ratio = EXCLUDED.displacement_ratio,
          trend_direction = EXCLUDED.trend_direction,
          delta_30d = EXCLUDED.delta_30d,
          snapshot_date = EXCLUDED.snapshot_date
        WHERE vulnerability_scores.scoring_mode IS NULL
      `, [role, city, score, riskBand, hiringDecline, aiMentionRate, displacementRatio, trendDirection, delta30d, now.toISOString()]);
    }
  }

  // Recompute worker risk scores
  const workersRes = await pool.query('SELECT * FROM worker_profiles');
  for (const w of workersRes.rows) {
    const vulnRes = await pool.query('SELECT * FROM vulnerability_scores WHERE canonical_role=$1 AND city=$2 ORDER BY snapshot_date DESC LIMIT 1', [w.canonical_role, w.city]);
    const vuln = vulnRes.rows[0];
    if (vuln) {
      const baseVuln = vuln.score;
      const extractedSkills = typeof w.extracted_skills === 'string' ? JSON.parse(w.extracted_skills) : w.extracted_skills;
      const experienceFactor = Math.min(w.years_of_experience / 20, 1) * 15;
      const aiReadinessFactor = extractedSkills?.aiReadiness?.length > 0 ? -10 : 5;
      const newScore = Math.round(Math.min(100, Math.max(0, baseVuln + experienceFactor + aiReadinessFactor)));

      let riskBand;
      if (newScore <= 30) riskBand = 'Low';
      else if (newScore <= 60) riskBand = 'Medium';
      else if (newScore <= 80) riskBand = 'High';
      else riskBand = 'Critical';

      await pool.query(
        'UPDATE worker_profiles SET risk_score=$1, risk_band=$2, risk_delta_30d=$3, last_computed_at=$4 WHERE id=$5',
        [newScore, riskBand, vuln.delta_30d, now.toISOString(), w.id]
      );
    }
  }
}
