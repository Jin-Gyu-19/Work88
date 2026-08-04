import { Hono } from 'hono';
import { Zip, ZipPassThrough } from 'fflate';
import { signSession, verifySession } from './auth.js';
import { buildWorkbook } from './excel.js';

const app = new Hono();

// 파일 종류별 업로드 용량 제한 (바이트)
const LIMITS = {
  image: 10 * 1024 * 1024,
  video: 80 * 1024 * 1024,
  app: 50 * 1024 * 1024,
  file: 25 * 1024 * 1024,
};
const MAX_ATTACHMENTS = 10;

// ---------- 공통 유틸 ----------

function getCookie(c, name) {
  const h = c.req.header('cookie') || '';
  const m = h.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

function setCookie(c, name, value, maxAge) {
  c.header('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`, { append: true });
}

async function currentUser(c) {
  const token = getCookie(c, 'sess');
  if (!token) return null;
  return verifySession(token, c.env.SESSION_SECRET);
}

function adminEmails(env) {
  return (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function isAdmin(c, email) {
  if (adminEmails(c.env).includes(email.toLowerCase())) return true;
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
  return row?.role === 'admin';
}

const needAuth = (handler) => async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: '로그인이 필요합니다' }, 401);
  c.set('user', user);
  return handler(c);
};

const needAdmin = (handler) => needAuth(async (c) => {
  if (!(await isAdmin(c, c.get('user').email))) return c.json({ error: '관리자 권한이 필요합니다' }, 403);
  return handler(c);
});

function sanitizeName(name) {
  const s = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return s.slice(-120) || 'file';
}

function randomSlug() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

function contentDisposition(type, filename) {
  return `${type}; filename="download"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function attachSubAttachments(db, subs, withKeys = false) {
  if (!subs.length) return subs;
  const ids = subs.map((s) => s.id);
  const cols = withKeys
    ? 'id, submission_id, kind, filename, content_type, size, r2_key'
    : 'id, submission_id, kind, filename, content_type, size';
  const { results } = await db
    .prepare(`SELECT ${cols} FROM attachments WHERE submission_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`)
    .bind(...ids)
    .all();
  const map = {};
  for (const a of results) (map[a.submission_id] ||= []).push(a);
  for (const s of subs) s.attachments = map[s.id] || [];
  return subs;
}

async function deleteSubmissionDeep(env, id) {
  const { results } = await env.DB.prepare('SELECT id, r2_key FROM attachments WHERE submission_id = ?').bind(id).all();
  for (const a of results) await env.BUCKET.delete(a.r2_key);
  await env.DB.prepare('DELETE FROM attachments WHERE submission_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
}

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: '서버 오류가 발생했습니다' }, 500);
});

// ---------- 인증 (Microsoft Entra ID SSO) ----------

app.get('/auth/login', async (c) => {
  const redirect = c.req.query('redirect') || '/';
  if (c.env.DEV_MODE === '1' && !c.env.MS_CLIENT_ID) {
    return c.redirect(`/auth/dev?redirect=${encodeURIComponent(redirect)}`);
  }
  const nonce = crypto.randomUUID();
  const state = await signSession(
    { n: nonce, r: redirect, exp: Math.floor(Date.now() / 1000) + 600 },
    c.env.SESSION_SECRET,
  );
  setCookie(c, 'oauth_state', nonce, 600);
  const origin = new URL(c.req.url).origin;
  const p = new URLSearchParams({
    client_id: c.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: origin + '/auth/callback',
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
  });
  return c.redirect(`https://login.microsoftonline.com/${c.env.MS_TENANT_ID || 'common'}/oauth2/v2.0/authorize?${p}`);
});

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  const st = await verifySession(c.req.query('state'), c.env.SESSION_SECRET);
  const nonce = getCookie(c, 'oauth_state');
  if (!code || !st || !nonce || st.n !== nonce) {
    return c.text('로그인 상태 확인에 실패했습니다. 처음부터 다시 시도해 주세요.', 400);
  }
  const origin = new URL(c.req.url).origin;
  const tokenRes = await fetch(`https://login.microsoftonline.com/${c.env.MS_TENANT_ID || 'common'}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.MS_CLIENT_ID,
      client_secret: c.env.MS_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: origin + '/auth/callback',
      scope: 'openid profile email User.Read',
    }),
  });
  if (!tokenRes.ok) return c.text('Microsoft 토큰 발급에 실패했습니다.', 502);
  const tok = await tokenRes.json();

  const meRes = await fetch(
    'https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,department',
    { headers: { Authorization: `Bearer ${tok.access_token}` } },
  );
  if (!meRes.ok) return c.text('Microsoft 프로필 조회에 실패했습니다.', 502);
  const me = await meRes.json();
  const email = (me.mail || me.userPrincipalName || '').toLowerCase();
  if (!email) return c.text('계정 이메일을 확인할 수 없습니다.', 400);

  await loginUser(c, { email, name: me.displayName || email, department: me.department || '' });
  return c.redirect(st.r || '/');
});

async function loginUser(c, { email, name, department }) {
  const initialRole = adminEmails(c.env).includes(email) ? 'admin' : 'user';
  await c.env.DB.prepare(
    `INSERT INTO users (email, name, department, role, last_login) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       department = excluded.department,
       last_login = excluded.last_login,
       role = CASE WHEN excluded.role = 'admin' THEN 'admin' ELSE users.role END`,
  ).bind(email, name, department, initialRole).run();
  const sess = await signSession(
    { email, name, department, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
    c.env.SESSION_SECRET,
  );
  setCookie(c, 'sess', sess, 7 * 24 * 3600);
}

// 로컬 개발용 로그인 (DEV_MODE=1 일 때만 동작)
// email 파라미터 없이 접속하면 테스트 계정 선택 화면을 보여준다
app.get('/auth/dev', async (c) => {
  if (c.env.DEV_MODE !== '1') return c.notFound();
  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!email) {
    const redirect = c.req.query('redirect') || '/';
    const adminEmail = adminEmails(c.env)[0] || 'admin@example.com';
    return c.html(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>테스트 로그인</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="container" style="max-width:460px;">
<form class="card" method="GET" action="/auth/dev">
  <h1>🧪 테스트 로그인</h1>
  <p class="muted">개발 모드(DEV_MODE=1)에서만 보이는 화면입니다. MS SSO 없이 원하는 계정으로 로그인해 테스트할 수 있습니다.</p>
  <input type="hidden" name="redirect" value="${redirect.replace(/"/g, '&quot;')}">
  <label>이름 <input name="name" id="dv-name" value="홍길동"></label>
  <label>부서 <input name="dept" id="dv-dept" value="영업팀"></label>
  <label>이메일 <input name="email" id="dv-email" value="hong@example.com"></label>
  <label style="display:flex; align-items:center; gap:8px; font-weight:400;">
    <input type="checkbox" id="dv-admin" style="width:auto; margin:0;"> 관리자로 로그인 (${adminEmail})
  </label>
  <button type="submit" class="primary" style="width:100%; padding:11px;">로그인</button>
</form>
<script>
document.getElementById('dv-admin').onchange = function () {
  var e = document.getElementById('dv-email');
  var n = document.getElementById('dv-name');
  if (this.checked) { e.dataset.prev = e.value; n.dataset.prev = n.value; e.value = '${adminEmail}'; n.value = '관리자'; }
  else { e.value = e.dataset.prev || 'hong@example.com'; n.value = n.dataset.prev || '홍길동'; }
};
</script>
</main></body></html>`);
  }
  await loginUser(c, {
    email,
    name: c.req.query('name') || '테스트사용자',
    department: c.req.query('dept') || '테스트팀',
  });
  return c.redirect(c.req.query('redirect') || '/');
});

app.post('/auth/logout', (c) => {
  setCookie(c, 'sess', '', 0);
  return c.json({ ok: true });
});

// ---------- 사용자 API ----------

app.get('/api/me', needAuth(async (c) => {
  const u = c.get('user');
  return c.json({
    email: u.email,
    name: u.name,
    department: u.department,
    isAdmin: await isAdmin(c, u.email),
  });
}));

app.get('/api/campaigns', needAuth(async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT slug, title, description, is_open FROM campaigns WHERE is_open = 1 ORDER BY id DESC')
    .all();
  return c.json(results);
}));

app.get('/api/campaigns/:slug', needAuth(async (c) => {
  const row = await c.env.DB
    .prepare('SELECT slug, title, description, is_open FROM campaigns WHERE slug = ?')
    .bind(c.req.param('slug')).first();
  if (!row) return c.json({ error: '존재하지 않는 설문입니다' }, 404);
  return c.json(row);
}));

// 파일 업로드: 요청 본문이 파일 그 자체 (스트리밍으로 R2에 저장)
app.post('/api/uploads', needAuth(async (c) => {
  const kind = ['image', 'video', 'app', 'file'].includes(c.req.query('kind')) ? c.req.query('kind') : 'file';
  const filename = sanitizeName(c.req.query('filename') || 'file');
  const size = Number(c.req.header('content-length') || 0);
  const limit = LIMITS[kind];
  if (!size) return c.json({ error: '파일 크기를 확인할 수 없습니다' }, 400);
  if (size > limit) {
    const label = kind === 'video' ? '동영상' : kind === 'image' ? '이미지' : kind === 'app' ? '앱 파일' : '파일';
    return c.json({ error: `${label}은 최대 ${Math.round(limit / 1048576)}MB까지 첨부할 수 있습니다.` }, 413);
  }
  const id = crypto.randomUUID();
  const key = `uploads/${id}/${filename}`;
  const contentType = c.req.header('content-type') || 'application/octet-stream';
  await c.env.BUCKET.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  await c.env.DB
    .prepare('INSERT INTO attachments (id, uploader_email, kind, filename, content_type, size, r2_key) VALUES (?,?,?,?,?,?,?)')
    .bind(id, c.get('user').email, kind, filename, contentType, size, key)
    .run();
  return c.json({ id, filename, kind, size });
}));

// 제출 전 첨부 취소 (아직 제출에 연결되지 않은 본인 파일만)
app.delete('/api/uploads/:id', needAuth(async (c) => {
  const row = await c.env.DB
    .prepare('SELECT id, r2_key FROM attachments WHERE id = ? AND uploader_email = ? AND submission_id IS NULL')
    .bind(c.req.param('id'), c.get('user').email).first();
  if (!row) return c.json({ error: '삭제할 수 없는 파일입니다' }, 404);
  await c.env.BUCKET.delete(row.r2_key);
  await c.env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
}));

app.post('/api/campaigns/:slug/submissions', needAuth(async (c) => {
  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!campaign) return c.json({ error: '존재하지 않는 설문입니다' }, 404);
  if (!campaign.is_open) return c.json({ error: '마감된 설문입니다' }, 400);

  const body = await c.req.json();
  const title = (body.title || '').trim();
  const content = (body.content || '').trim();
  const appUrl = (body.app_url || '').trim();
  if (!title || !content) return c.json({ error: '제목과 내용을 입력해 주세요' }, 400);
  if (appUrl && !/^https?:\/\//i.test(appUrl)) return c.json({ error: '앱 URL은 http:// 또는 https:// 로 시작해야 합니다' }, 400);

  const u = c.get('user');
  const res = await c.env.DB
    .prepare('INSERT INTO submissions (campaign_id, user_email, user_name, user_department, title, content, app_url) VALUES (?,?,?,?,?,?,?)')
    .bind(campaign.id, u.email, u.name, u.department, title, content, appUrl || null)
    .run();
  const submissionId = res.meta.last_row_id;

  const ids = Array.isArray(body.attachment_ids) ? body.attachment_ids.slice(0, MAX_ATTACHMENTS) : [];
  for (const id of ids) {
    await c.env.DB
      .prepare('UPDATE attachments SET submission_id = ? WHERE id = ? AND uploader_email = ? AND submission_id IS NULL')
      .bind(submissionId, String(id), u.email)
      .run();
  }
  return c.json({ ok: true, id: submissionId });
}));

app.get('/api/campaigns/:slug/my-submissions', needAuth(async (c) => {
  const campaign = await c.env.DB.prepare('SELECT id FROM campaigns WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!campaign) return c.json({ error: '존재하지 않는 설문입니다' }, 404);
  const { results } = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE campaign_id = ? AND user_email = ? ORDER BY id DESC')
    .bind(campaign.id, c.get('user').email)
    .all();
  await attachSubAttachments(c.env.DB, results);
  return c.json(results);
}));

app.delete('/api/submissions/:id', needAuth(async (c) => {
  const sub = await c.env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(c.req.param('id')).first();
  if (!sub) return c.json({ error: '존재하지 않는 제출입니다' }, 404);
  const u = c.get('user');
  if (sub.user_email !== u.email && !(await isAdmin(c, u.email))) {
    return c.json({ error: '권한이 없습니다' }, 403);
  }
  await deleteSubmissionDeep(c.env, sub.id);
  return c.json({ ok: true });
}));

// ---------- 관리자 API ----------

app.get('/api/admin/campaigns', needAdmin(async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT ca.*, (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id = ca.id) AS submission_count
    FROM campaigns ca ORDER BY ca.id DESC`).all();
  return c.json(results);
}));

app.post('/api/admin/campaigns', needAdmin(async (c) => {
  const body = await c.req.json();
  const title = (body.title || '').trim();
  if (!title) return c.json({ error: '캠페인 제목을 입력해 주세요' }, 400);
  const slug = randomSlug();
  await c.env.DB
    .prepare('INSERT INTO campaigns (slug, title, description, created_by) VALUES (?,?,?,?)')
    .bind(slug, title, (body.description || '').trim(), c.get('user').email)
    .run();
  return c.json({ ok: true, slug });
}));

app.patch('/api/admin/campaigns/:id', needAdmin(async (c) => {
  const body = await c.req.json();
  const fields = [];
  const vals = [];
  if (body.is_open !== undefined) { fields.push('is_open = ?'); vals.push(body.is_open ? 1 : 0); }
  if (typeof body.title === 'string' && body.title.trim()) { fields.push('title = ?'); vals.push(body.title.trim()); }
  if (typeof body.description === 'string') { fields.push('description = ?'); vals.push(body.description.trim()); }
  if (!fields.length) return c.json({ error: '변경할 내용이 없습니다' }, 400);
  vals.push(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
}));

app.delete('/api/admin/campaigns/:id', needAdmin(async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare('SELECT id FROM submissions WHERE campaign_id = ?').bind(id).all();
  for (const s of results) await deleteSubmissionDeep(c.env, s.id);
  await c.env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
}));

app.get('/api/admin/campaigns/:id/submissions', needAdmin(async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE campaign_id = ? ORDER BY id DESC')
    .bind(c.req.param('id'))
    .all();
  await attachSubAttachments(c.env.DB, results);
  return c.json(results);
}));

// 엑셀 다운로드: 첨부는 클릭 가능한 하이퍼링크로 연동
app.get('/api/admin/campaigns/:id/export.xlsx', needAdmin(async (c) => {
  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(c.req.param('id')).first();
  if (!campaign) return c.json({ error: '존재하지 않는 캠페인입니다' }, 404);
  const { results } = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE campaign_id = ? ORDER BY id')
    .bind(campaign.id)
    .all();
  await attachSubAttachments(c.env.DB, results);
  const origin = new URL(c.req.url).origin;
  const buf = buildWorkbook(campaign, results, { linkFor: (a) => `${origin}/files/${a.id}` });
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition('attachment', `${sanitizeName(campaign.title)}_제출내역.xlsx`),
    },
  });
}));

// ZIP 다운로드: 엑셀(상대경로 하이퍼링크) + 첨부파일 전체를 스트리밍으로 압축
app.get('/api/admin/campaigns/:id/export.zip', needAdmin(async (c) => {
  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(c.req.param('id')).first();
  if (!campaign) return c.json({ error: '존재하지 않는 캠페인입니다' }, 404);
  const { results: subs } = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE campaign_id = ? ORDER BY id')
    .bind(campaign.id)
    .all();
  await attachSubAttachments(c.env.DB, subs, true);

  const pathFor = {};
  const allAtts = [];
  subs.forEach((s, i) => {
    const folder = `첨부파일/${String(i + 1).padStart(3, '0')}_${sanitizeName(s.user_name || '')}_${sanitizeName(s.title).slice(0, 24)}`;
    (s.attachments || []).forEach((a, j) => {
      pathFor[a.id] = `${folder}/${j + 1}_${a.filename}`;
      allAtts.push(a);
    });
  });
  const excelBuf = buildWorkbook(campaign, subs, { linkFor: (a) => pathFor[a.id] });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const zip = new Zip((err, chunk, final) => {
    if (err) { writer.abort(err).catch(() => {}); return; }
    writer.write(chunk).catch(() => {});
    if (final) writer.close().catch(() => {});
  });

  const env = c.env;
  c.executionCtx.waitUntil((async () => {
    try {
      const xf = new ZipPassThrough(sanitizeName(`${campaign.title}_제출내역.xlsx`));
      zip.add(xf);
      xf.push(new Uint8Array(excelBuf), true);
      for (const a of allAtts) {
        const f = new ZipPassThrough(pathFor[a.id]);
        zip.add(f);
        const obj = await env.BUCKET.get(a.r2_key);
        if (obj) {
          const reader = obj.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.ready;
            f.push(value);
          }
        }
        f.push(new Uint8Array(0), true);
      }
      zip.end();
    } catch (e) {
      try { writer.abort(e); } catch {}
    }
  })());

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', `${sanitizeName(campaign.title)}_전체자료.zip`),
    },
  });
}));

app.get('/api/admin/users', needAdmin(async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT id, email, name, department, role, last_login FROM users ORDER BY name, email')
    .all();
  const fixed = adminEmails(c.env);
  return c.json(results.map((u) => ({ ...u, isFixedAdmin: fixed.includes(u.email) })));
}));

app.patch('/api/admin/users/:id', needAdmin(async (c) => {
  const body = await c.req.json();
  const role = body.role === 'admin' ? 'admin' : 'user';
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first();
  if (!target) return c.json({ error: '사용자를 찾을 수 없습니다' }, 404);
  if (target.email === c.get('user').email) return c.json({ error: '본인의 권한은 변경할 수 없습니다' }, 400);
  if (adminEmails(c.env).includes(target.email) && role !== 'admin') {
    return c.json({ error: '기본 관리자(환경설정에 지정된 계정)의 권한은 해제할 수 없습니다' }, 400);
  }
  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, target.id).run();
  return c.json({ ok: true });
}));

// ---------- 첨부파일 열람 (엑셀 하이퍼링크가 여기로 연결됨) ----------

app.get('/files/:id', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect('/auth/login?redirect=' + encodeURIComponent(c.req.path));
  const a = await c.env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(c.req.param('id')).first();
  if (!a) return c.text('파일을 찾을 수 없습니다', 404);
  if (a.uploader_email !== user.email && !(await isAdmin(c, user.email))) {
    return c.text('이 파일을 볼 권한이 없습니다', 403);
  }
  const obj = await c.env.BUCKET.get(a.r2_key);
  if (!obj) return c.text('파일을 찾을 수 없습니다', 404);
  const headers = new Headers();
  headers.set('Content-Type', a.content_type || 'application/octet-stream');
  headers.set('Content-Length', String(obj.size));
  headers.set('Content-Disposition', contentDisposition(c.req.query('download') ? 'attachment' : 'inline', a.filename));
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
});

// ---------- 페이지 라우팅 ----------

// 캠페인 제출 페이지 (/c/링크코드 → submit.html)
app.get('/c/:slug', (c) => c.env.ASSETS.fetch(new URL('/submit.html', c.req.url)));

export default app;
