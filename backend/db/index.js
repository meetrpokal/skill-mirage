import pg from 'pg';
import Redis from 'ioredis';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://mirage:mirage123@localhost:5433/jobmarket';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const pool = new pg.Pool({ connectionString: DATABASE_URL });
export const redis = new Redis(REDIS_URL, { retryStrategy: (t) => Math.min(t * 500, 5000) });

pool.on('error', (err) => console.error('[db] pool error:', err.message));
redis.on('error', (err) => console.error('[redis] error:', err.message));
