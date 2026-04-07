/**
 * apply-migrations.js
 *
 * Applies pending Supabase migrations (012 + 013) to the live database.
 *
 * Requirements:
 *   - SUPABASE_ACCESS_TOKEN env var (personal access token from
 *     https://supabase.com/dashboard/account/tokens)
 *   OR
 *   - Run the SQL manually in the Supabase Dashboard SQL editor:
 *     https://supabase.com/dashboard/project/iywpulmxiggcohdefgim/sql
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migrations.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PROJECT_REF = 'iywpulmxiggcohdefgim';
const PAT = process.env.SUPABASE_ACCESS_TOKEN;

if (!PAT) {
  console.error(
    'Error: SUPABASE_ACCESS_TOKEN is not set.\n' +
    'Get a personal access token from:\n' +
    '  https://supabase.com/dashboard/account/tokens\n' +
    'Then run:\n' +
    '  SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migrations.js\n\n' +
    'Alternatively, paste each migration file into the Supabase SQL editor:\n' +
    '  https://supabase.com/dashboard/project/iywpulmxiggcohdefgim/sql'
  );
  process.exit(1);
}

const MIGRATIONS = [
  '012_decouple_users_auth.sql',
  '013_fix_rls_teams_and_preset_users.sql',
];

async function runSQL(sql, name) {
  const body = JSON.stringify({ query: sql });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAT}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log(`✓  ${name} — applied successfully`);
          resolve(data);
        } else {
          console.error(`✗  ${name} — HTTP ${res.statusCode}: ${data.slice(0, 400)}`);
          reject(new Error(`Migration failed: ${name}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  for (const file of MIGRATIONS) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await runSQL(sql, file);
  }
  console.log('\nAll migrations applied. Remember to:\n' +
    '1. Deploy Edge Functions:  supabase functions deploy sync-colaboradores sync-books\n' +
    '2. Update auth/callback/route.ts — change .eq("id", user.id) → .eq("auth_id", user.id)\n' +
    '   in 2 places (lines ~78 and ~98), and update the fallback insert to use\n' +
    '   { auth_id: user.id } instead of { id: user.id }.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
