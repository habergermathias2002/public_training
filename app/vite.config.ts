import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

function brainApiPlugin(repo: string, env: Record<string, string>): Plugin {
  const feedbackPath = path.join(repo, 'athlet', 'feedback.json');
  const outFeedbackPath = path.join(repo, 'auswertung', 'feedback.json');

  const readFeedback = () => {
    try {
      if (fs.existsSync(feedbackPath)) {
        const d = JSON.parse(fs.readFileSync(feedbackPath, 'utf-8'));
        return { tagesform: d.tagesform || {}, rpe: d.rpe || {} };
      }
    } catch (e) {
      console.error('readFeedback error:', e);
    }
    return { tagesform: {}, rpe: {} };
  };

  const toRows = (fb: { tagesform: Record<string, any>; rpe: Record<string, any> }) => {
    const rows: any[] = [];
    for (const [k, v] of Object.entries(fb.tagesform || {}).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({
        id: `tf_${k}`,
        typ: 'tagesform',
        datum: v.datum || k,
        activity_id: '',
        beine: v.beine ?? null,
        stress: v.stress ?? null,
        schlaf_qualitaet: v.schlaf_qualitaet ?? null,
        rpe: null,
        gefuehl: '',
        notiz: v.notiz || '',
        updated_at: v.updated_at || new Date().toISOString(),
      });
    }
    for (const [k, v] of Object.entries(fb.rpe || {}).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({
        id: `rpe_${k}`,
        typ: 'rpe',
        datum: v.datum || '',
        activity_id: String(v.activity_id || k),
        beine: null,
        stress: null,
        schlaf_qualitaet: null,
        rpe: v.rpe ?? null,
        gefuehl: v.gefuehl || '',
        notiz: v.notiz || '',
        updated_at: v.updated_at || new Date().toISOString(),
      });
    }
    return rows;
  };

  const pushToSupabase = async (rows: any[]) => {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('your-project-id')) return false;
    try {
      const resp = await fetch(`${url.replace(/\/$/, '')}/rest/v1/datasets`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          name: 'feedback',
          part: 0,
          rows,
          meta: [{ label: 'Stand', value: new Date().toISOString().slice(0, 16).replace('T', ' ') }],
        }),
      });
      return resp.ok;
    } catch (e) {
      console.error('Supabase feedback push failed:', e);
      return false;
    }
  };

  const appendJournal = (entryLine: string, isoDate: string) => {
    try {
      const ym = (isoDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
      const jDir = path.join(repo, 'journal');
      fs.mkdirSync(jDir, { recursive: true });
      const jFile = path.join(jDir, `${ym}.md`);
      const dayHeader = `## ${isoDate || new Date().toISOString().slice(0, 10)}`;
      let content = fs.existsSync(jFile)
        ? fs.readFileSync(jFile, 'utf-8')
        : `# Journal ${ym}\n\nSubjektives: Gefühl, Schlaf, Krankheit, Job-Stress, Beobachtungen, Notizen aus Gesprächen. Neueste oben.\n`;
      if (content.includes(dayHeader)) {
        content = content.replace(dayHeader, `${dayHeader}\n- ${entryLine}`);
      } else {
        const idx = content.indexOf('\n## ');
        if (idx >= 0) {
          content = content.slice(0, idx) + `\n${dayHeader}\n- ${entryLine}` + content.slice(idx);
        } else {
          content += `\n${dayHeader}\n- ${entryLine}\n`;
        }
      }
      fs.writeFileSync(jFile, content, 'utf-8');
    } catch (e) {
      console.error('appendJournal error:', e);
    }
  };

  const triggerBackgroundEval = () => {
    const py = fs.existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3';
    execFile(py, [path.join(repo, 'bin', 'auswertung.py')], { cwd: repo }, (err) => {
      if (err) console.error('auswertung.py error:', err);
      else {
        execFile(py, [path.join(repo, 'bin', 'sync_supabase.py')], { cwd: repo }, () => {});
      }
    });
  };

  return {
    name: 'brain-api-plugin',
    configureServer(server) {
      server.middlewares.use('/api/feedback', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          const fb = readFeedback();
          res.end(JSON.stringify({ ok: true, rows: toRows(fb), raw: fb }));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              const fb = readFeedback();
              const nowIso = new Date().toISOString();

              if (payload.typ === 'tagesform' && payload.datum) {
                fb.tagesform[payload.datum] = {
                  datum: payload.datum,
                  beine: Number(payload.beine),
                  stress: Number(payload.stress),
                  schlaf_qualitaet: Number(payload.schlaf_qualitaet ?? 4),
                  notiz: String(payload.notiz || '').trim(),
                  updated_at: nowIso,
                };
                appendJournal(
                  `**Cockpit Tagesform-Check (${nowIso.slice(11, 16)} Uhr):** Beine \`${payload.beine}/5\`, Job-Stress \`${payload.stress}/5\`, Schlafgefühl \`${payload.schlaf_qualitaet ?? 4}/5\`${payload.notiz ? ` — „${payload.notiz}“` : ''}.`,
                  payload.datum
                );
              } else if (payload.typ === 'rpe' && payload.activity_id) {
                const aid = String(payload.activity_id);
                fb.rpe[aid] = {
                  activity_id: aid,
                  datum: payload.datum || '',
                  rpe: Number(payload.rpe),
                  gefuehl: String(payload.gefuehl || '').trim(),
                  notiz: String(payload.notiz || '').trim(),
                  updated_at: nowIso,
                };
                appendJournal(
                  `**Cockpit Session-RPE (${payload.titel || aid}):** RPE \`${payload.rpe}/10\` (${payload.gefuehl || 'geloggt'})${payload.notiz ? ` — „${payload.notiz}“` : ''}.`,
                  payload.datum || nowIso.slice(0, 10)
                );
              }

              fs.writeFileSync(feedbackPath, JSON.stringify(fb, null, 2) + '\n', 'utf-8');
              const rows = toRows(fb);
              fs.writeFileSync(
                outFeedbackPath,
                JSON.stringify({
                  rows,
                  meta: [{ label: 'Stand', value: nowIso.slice(0, 16).replace('T', ' ') }],
                }),
                'utf-8'
              );
              const supaOk = await pushToSupabase(rows);
              triggerBackgroundEval();
              res.end(JSON.stringify({ ok: true, supaOk, rows }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      });

      server.middlewares.use('/api/recalc', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        const py = fs.existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3';
        execFile(py, [path.join(repo, 'bin', 'auswertung.py')], { cwd: repo }, (err, stdout) => {
          if (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          execFile(py, [path.join(repo, 'bin', 'sync_supabase.py')], { cwd: repo }, () => {
            res.end(JSON.stringify({ ok: true, output: stdout.trim() }));
          });
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const repo = path.resolve(__dirname, '..');
  const env = loadEnv(mode, repo, '');
  return {
    plugins: [react(), brainApiPlugin(repo, env)],
    server: {
      port: 5173,
      host: true,
      fs: { allow: [repo] },
    },
    define: {
      __SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL || ''),
      __SUPABASE_ANON_KEY__: JSON.stringify(env.SUPABASE_ANON_KEY || ''),
    },
  };
});
