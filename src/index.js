import { Hono } from 'hono';
import { Zip, ZipPassThrough } from 'fflate';
import { signSession, verifySession } from './auth.js';
import { buildWorkbook, groupAtts } from './excel.js';

const app = new Hono();

// 파일 종류별 업로드 용량 제한 (바이트)
// 주의: Cloudflare 요청 본문 한도가 100MB라 그 이상은 불가
const LIMITS = {
  image: 10 * 1024 * 1024,
  video: 80 * 1024 * 1024,
  app: 100 * 1024 * 1024,
  file: 25 * 1024 * 1024,
};
const MAX_ATTACHMENTS = 10;

// ---------- 설문 양식 ----------

const QUESTION_TYPES = ['text', 'textarea', 'select', 'checkbox', 'rating'];

function defaultForm() {
  // 빌더 도입 전에 만들어진 캠페인(fields 없음)을 위한 기본 양식
  return {
    questions: [
      { id: 'title', label: '제목', type: 'text', required: true, allowAttach: false },
      { id: 'content', label: '내용', type: 'textarea', required: true, allowAttach: true },
    ],
  };
}

// 관리자가 보낸 양식 정의를 검증/정리
function sanitizeForm(input) {
  const def = defaultForm();
  if (!input || typeof input !== 'object') return def;
  const out = {
    oneSubmission: input.oneSubmission === true,
    noEdit: input.noEdit === true,
    questions: [],
  };
  const qs = Array.isArray(input.questions) ? input.questions.slice(0, 20) : [];
  const priorChoice = {}; // 분기 조건에 쓸 수 있는 앞선 객관식 질문들
  for (const q of qs) {
    if (!q || typeof q.label !== 'string' || !q.label.trim()) continue;
    const type = QUESTION_TYPES.includes(q.type) ? q.type : 'text';
    const question = {
      id: typeof q.id === 'string' && /^[\w-]{1,40}$/.test(q.id) ? q.id : 'q' + crypto.randomUUID().slice(0, 8),
      label: q.label.trim().slice(0, 200),
      type,
      required: !!q.required,
      allowAttach: !!q.allowAttach,
      help: typeof q.help === 'string' ? q.help.trim().slice(0, 500) : '',
    };
    if (type === 'select' || type === 'checkbox') {
      question.options = (Array.isArray(q.options) ? q.options : [])
        .map((o) => String(o).trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 30);
      if (!question.options.length) continue;
    }
    // 분기(표시 조건): 앞선 객관식 질문의 특정 답변일 때만 표시
    const si = q.showIf;
    if (si && typeof si === 'object' && typeof si.qid === 'string' && priorChoice[si.qid]
      && priorChoice[si.qid].options.includes(String(si.value))) {
      question.showIf = { qid: si.qid, value: String(si.value) };
    }
    // 질문에 첨부된 자료(이미지는 표시 너비 w% 포함)
    question.media = (Array.isArray(q.media) ? q.media.slice(0, 5) : [])
      .filter((m) => m && typeof m.id === 'string' && /^[0-9a-f-]{36}$/.test(m.id))
      .map((m) => ({
        id: m.id,
        filename: String(m.filename || 'file').slice(0, 200),
        kind: m.kind === 'image' ? 'image' : 'file',
        size: Number(m.size) || 0,
        w: Math.min(100, Math.max(10, parseInt(m.w, 10) || 60)),
        align: ['left', 'center', 'right'].includes(m.align) ? m.align : 'center',
      }));
    out.questions.push(question);
    if (type === 'select' || type === 'checkbox') priorChoice[question.id] = question;
  }
  if (!out.questions.length) out.questions = def.questions;
  // 구버전 호환: 전체 첨부 섹션을 쓰던 양식이면 마지막 질문에 첨부를 붙인다
  if (input.showAttach === true && !out.questions.some((q) => q.allowAttach)) {
    out.questions[out.questions.length - 1].allowAttach = true;
  }
  // 설문 배경 이미지
  if (input.bg && typeof input.bg === 'object' && typeof input.bg.id === 'string' && /^[0-9a-f-]{36}$/.test(input.bg.id)) {
    out.bg = { id: input.bg.id };
  }
  return out;
}

function parseForm(fieldsJson) {
  if (!fieldsJson) return defaultForm();
  try {
    return sanitizeForm(JSON.parse(fieldsJson));
  } catch {
    return defaultForm();
  }
}

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

// 메인 관리자(환경설정 지정)는 모든 캠페인을 관리할 수 있다
function isFixedAdmin(env, email) {
  return adminEmails(env).includes((email || '').toLowerCase());
}

// 설문지에 첨부된 자료/배경 파일을 'media'로 표시 (참여자도 열람 가능해짐)
async function markMediaAttachments(env, form) {
  const ids = form.questions.flatMap((q) => (q.media || []).map((m) => m.id));
  if (form.bg) ids.push(form.bg.id);
  for (const id of ids) {
    await env.DB
      .prepare("UPDATE attachments SET question_id = 'media' WHERE id = ? AND submission_id IS NULL")
      .bind(id)
      .run();
  }
}

// 캠페인 조회 + 소유권 확인 (만든 관리자 본인 또는 메인 관리자만)
async function getManagedCampaign(c, id) {
  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!campaign) return { errorRes: c.json({ error: '존재하지 않는 캠페인입니다' }, 404) };
  const email = c.get('user').email;
  if (!isFixedAdmin(c.env, email) && campaign.created_by !== email) {
    return { errorRes: c.json({ error: '이 캠페인을 관리할 권한이 없습니다 (만든 관리자만 관리할 수 있습니다)' }, 403) };
  }
  return { campaign };
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
    ? 'id, submission_id, question_id, kind, filename, content_type, size, r2_key'
    : 'id, submission_id, question_id, kind, filename, content_type, size';
  const { results } = await db
    .prepare(`SELECT ${cols} FROM attachments WHERE submission_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`)
    .bind(...ids)
    .all();
  const map = {};
  for (const a of results) (map[a.submission_id] ||= []).push(a);
  for (const s of subs) s.attachments = map[s.id] || [];
  return subs;
}

// 한국시간 기준 오늘 날짜 (YYYY-MM-DD)
function kstToday() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
}

// 마감일까지 포함해서 열려 있는지 판단 (마감일 당일까지 제출 가능)
function isOpenNow(campaign) {
  if (!campaign.is_open) return false;
  if (campaign.closes_at && kstToday() > campaign.closes_at) return false;
  return true;
}

// 폼 답변으로 각 질문의 표시 여부(분기) 계산
function computeVisibility(questions, raw) {
  const visible = {};
  for (const q of questions) {
    if (!q.showIf) {
      visible[q.id] = true;
    } else {
      const pv = raw[q.showIf.qid];
      const match = Array.isArray(pv) ? pv.includes(q.showIf.value) : pv === q.showIf.value;
      visible[q.id] = !!(visible[q.showIf.qid] && match);
    }
  }
  return visible;
}

// 답변 검증 + 요약(title/content) 파생. 오류 시 { error }, 성공 시 { answers, title, content }
function buildSubmissionData(form, body) {
  const answersIn = body.answers && typeof body.answers === 'object' ? body.answers : {};

  // 1차: 값 정리 (분기 판단용)
  const raw = {};
  for (const q of form.questions) {
    let v = answersIn[q.id];
    if (q.type === 'checkbox') {
      v = Array.isArray(v) ? v.map((x) => String(x)).filter((x) => q.options.includes(x)) : [];
      if (v.length) raw[q.id] = v;
    } else if (q.type === 'rating') {
      const n = parseInt(v, 10);
      if (n >= 1 && n <= 5) raw[q.id] = String(n);
    } else {
      v = typeof v === 'string' ? v.trim().slice(0, 4000) : '';
      if (q.type === 'select' && v && !q.options.includes(v)) v = '';
      if (v) raw[q.id] = v;
    }
  }

  // 2차: 분기 반영 — 보이는 질문만 필수 검증·저장
  const visible = computeVisibility(form.questions, raw);
  const answers = {};
  for (const q of form.questions) {
    if (!visible[q.id]) continue;
    const v = raw[q.id];
    if (q.required && (v === undefined || (Array.isArray(v) && !v.length))) {
      const verb = ['select', 'checkbox', 'rating'].includes(q.type) ? '선택' : '입력';
      return { error: `"${q.label}" 항목을 ${verb}해 주세요` };
    }
    if (v !== undefined) answers[q.id] = v;
  }
  let title = '';
  for (const q of form.questions) {
    const v = answers[q.id];
    if (typeof v === 'string' && v && (q.type === 'text' || q.type === 'select')) { title = v.slice(0, 200); break; }
  }
  if (!title) {
    const v = answers[form.questions[0]?.id];
    const flat = Array.isArray(v) ? v.join(', ') : (v || '(내용 없음)');
    title = flat.split('\n')[0].slice(0, 100);
  }
  const content = form.questions
    .map((q) => {
      const v = answers[q.id];
      if (v === undefined) return null;
      return `${q.label}: ${Array.isArray(v) ? v.join(', ') : v}`;
    })
    .filter(Boolean)
    .join('\n');
  return { answers, title, content };
}

// 업로드된 첨부를 제출에 연결
async function claimAttachments(env, form, body, submissionId, email) {
  const validQids = new Set(form.questions.filter((q) => q.allowAttach).map((q) => q.id));
  let atts = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_ATTACHMENTS) : [];
  if (!atts.length && Array.isArray(body.attachment_ids)) {
    atts = body.attachment_ids.slice(0, MAX_ATTACHMENTS).map((id) => ({ id }));
  }
  for (const a of atts) {
    if (!a || typeof a.id !== 'string') continue;
    const qid = validQids.has(a.qid) ? a.qid : null;
    await env.DB
      .prepare('UPDATE attachments SET submission_id = ?, question_id = ? WHERE id = ? AND uploader_email = ? AND submission_id IS NULL')
      .bind(submissionId, qid, a.id, email)
      .run();
  }
}

async function deleteSubmissionDeep(env, id) {
  const { results } = await env.DB.prepare('SELECT id, r2_key FROM attachments WHERE submission_id = ?').bind(id).all();
  for (const a of results) await env.BUCKET.delete(a.r2_key);
  await env.DB.prepare('DELETE FROM attachments WHERE submission_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
}

// 기존 DB에 새 컬럼이 없으면 추가 (배포/업데이트 자동 반영)
let migrated = false;
app.use('*', async (c, next) => {
  if (!migrated) {
    migrated = true;
    try {
      const ca = await c.env.DB.prepare('PRAGMA table_info(campaigns)').all();
      if (ca.results?.length && !ca.results.some((r) => r.name === 'fields')) {
        await c.env.DB.prepare('ALTER TABLE campaigns ADD COLUMN fields TEXT').run();
      }
      const su = await c.env.DB.prepare('PRAGMA table_info(submissions)').all();
      if (su.results?.length && !su.results.some((r) => r.name === 'answers')) {
        await c.env.DB.prepare('ALTER TABLE submissions ADD COLUMN answers TEXT').run();
      }
      const at = await c.env.DB.prepare('PRAGMA table_info(attachments)').all();
      if (at.results?.length && !at.results.some((r) => r.name === 'question_id')) {
        await c.env.DB.prepare('ALTER TABLE attachments ADD COLUMN question_id TEXT').run();
      }
      const ca2 = await c.env.DB.prepare('PRAGMA table_info(campaigns)').all();
      if (ca2.results?.length && !ca2.results.some((r) => r.name === 'closes_at')) {
        await c.env.DB.prepare('ALTER TABLE campaigns ADD COLUMN closes_at TEXT').run();
      }
      await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        fields TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`).run();
      await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        user_email TEXT NOT NULL,
        answers TEXT,
        attachments TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(campaign_id, user_email)
      )`).run();
    } catch (e) {
      console.error('migration check failed', e);
    }
  }
  await next();
});

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
    .prepare('SELECT slug, title, description, is_open, closes_at FROM campaigns WHERE is_open = 1 ORDER BY id DESC')
    .all();
  return c.json(results.filter(isOpenNow));
}));

app.get('/api/campaigns/:slug', needAuth(async (c) => {
  const row = await c.env.DB
    .prepare('SELECT * FROM campaigns WHERE slug = ?')
    .bind(c.req.param('slug')).first();
  if (!row) return c.json({ error: '존재하지 않는 설문입니다' }, 404);
  return c.json({
    slug: row.slug,
    title: row.title,
    description: row.description,
    closes_at: row.closes_at,
    is_open: isOpenNow(row) ? 1 : 0,
    form: parseForm(row.fields),
  });
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
  if (!isOpenNow(campaign)) return c.json({ error: '마감된 설문입니다' }, 400);

  const form = parseForm(campaign.fields);
  const u = c.get('user');
  if (form.oneSubmission) {
    const dup = await c.env.DB
      .prepare('SELECT id FROM submissions WHERE campaign_id = ? AND user_email = ?')
      .bind(campaign.id, u.email).first();
    if (dup) return c.json({ error: '이미 제출하셨습니다. 기존 제출을 수정하거나 삭제 후 다시 제출해 주세요.' }, 400);
  }

  const body = await c.req.json();
  const data = buildSubmissionData(form, body);
  if (data.error) return c.json({ error: data.error }, 400);

  const res = await c.env.DB
    .prepare('INSERT INTO submissions (campaign_id, user_email, user_name, user_department, title, content, answers) VALUES (?,?,?,?,?,?,?)')
    .bind(campaign.id, u.email, u.name, u.department, data.title, data.content, JSON.stringify(data.answers))
    .run();
  const submissionId = res.meta.last_row_id;
  await claimAttachments(c.env, form, body, submissionId, u.email);
  await c.env.DB.prepare('DELETE FROM drafts WHERE campaign_id = ? AND user_email = ?').bind(campaign.id, u.email).run();
  return c.json({ ok: true, id: submissionId });
}));

// ---------- 임시저장 ----------

app.get('/api/campaigns/:slug/draft', needAuth(async (c) => {
  const campaign = await c.env.DB.prepare('SELECT id FROM campaigns WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!campaign) return c.json({ error: '존재하지 않는 설문입니다' }, 404);
  const u = c.get('user');
  const draft = await c.env.DB
    .prepare('SELECT * FROM drafts WHERE campaign_id = ? AND user_email = ?')
    .bind(campaign.id, u.email).first();
  if (!draft) return c.json({ exists: false });

  let answers = {};
  let refs = [];
  try { answers = JSON.parse(draft.answers || '{}'); } catch {}
  try { refs = JSON.parse(draft.attachments || '[]'); } catch {}

  // 아직 제출에 연결되지 않고 남아 있는 첨부만 되살린다
  let atts = [];
  const ids = refs.map((r) => r.id).filter((id) => typeof id === 'string');
  if (ids.length) {
    const { results } = await c.env.DB
      .prepare(`SELECT id, filename, kind, size FROM attachments WHERE uploader_email = ? AND submission_id IS NULL AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(u.email, ...ids).all();
    const qidOf = Object.fromEntries(refs.map((r) => [r.id, r.qid]));
    atts = results.map((a) => ({ ...a, qid: qidOf[a.id] || null }));
  }
  return c.json({ exists: true, answers, attachments: atts, updated_at: draft.updated_at });
}));

app.put('/api/campaigns/:slug/draft', needAuth(async (c) => {
  const campaign = await c.env.DB.prepare('SELECT id FROM campaigns WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!campaign) return c.json({ error: '존재하지 않는 설문입니다' }, 404);
  const body = await c.req.json();
  const answers = JSON.stringify(body.answers && typeof body.answers === 'object' ? body.answers : {}).slice(0, 100000);
  const atts = JSON.stringify(Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_ATTACHMENTS) : []);
  await c.env.DB.prepare(
    `INSERT INTO drafts (campaign_id, user_email, answers, attachments, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(campaign_id, user_email) DO UPDATE SET
       answers = excluded.answers, attachments = excluded.attachments, updated_at = excluded.updated_at`,
  ).bind(campaign.id, c.get('user').email, answers, atts).run();
  return c.json({ ok: true });
}));

app.delete('/api/campaigns/:slug/draft', needAuth(async (c) => {
  const campaign = await c.env.DB.prepare('SELECT id FROM campaigns WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!campaign) return c.json({ error: '존재하지 않는 설문입니다' }, 404);
  await c.env.DB.prepare('DELETE FROM drafts WHERE campaign_id = ? AND user_email = ?').bind(campaign.id, c.get('user').email).run();
  return c.json({ ok: true });
}));

// 제출 수정 (본인, 설문이 열려 있는 동안만)
app.put('/api/submissions/:id', needAuth(async (c) => {
  const sub = await c.env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(c.req.param('id')).first();
  if (!sub) return c.json({ error: '존재하지 않는 제출입니다' }, 404);
  const u = c.get('user');
  if (sub.user_email !== u.email) return c.json({ error: '본인 제출만 수정할 수 있습니다' }, 403);
  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(sub.campaign_id).first();
  if (!campaign || !isOpenNow(campaign)) return c.json({ error: '마감된 설문은 수정할 수 없습니다' }, 400);

  const form = parseForm(campaign.fields);
  if (form.noEdit) return c.json({ error: '이 설문은 제출 후 수정할 수 없습니다' }, 400);
  const body = await c.req.json();
  const data = buildSubmissionData(form, body);
  if (data.error) return c.json({ error: data.error }, 400);

  await c.env.DB
    .prepare('UPDATE submissions SET title = ?, content = ?, answers = ? WHERE id = ?')
    .bind(data.title, data.content, JSON.stringify(data.answers), sub.id)
    .run();
  await claimAttachments(c.env, form, body, sub.id, u.email);
  return c.json({ ok: true });
}));

// 첨부 개별 삭제 (본인 파일 또는 관리자, 제출 연결 여부 무관)
app.delete('/api/attachments/:id', needAuth(async (c) => {
  const a = await c.env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(c.req.param('id')).first();
  if (!a) return c.json({ error: '파일을 찾을 수 없습니다' }, 404);
  const u = c.get('user');
  if (a.uploader_email !== u.email && !(await isAdmin(c, u.email))) {
    return c.json({ error: '권한이 없습니다' }, 403);
  }
  await c.env.BUCKET.delete(a.r2_key);
  await c.env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(a.id).run();
  return c.json({ ok: true });
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
  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(sub.campaign_id).first();
  if (sub.user_email !== u.email) {
    // 관리자 삭제는 해당 캠페인을 관리하는 관리자만
    if (!(await isAdmin(c, u.email))) return c.json({ error: '권한이 없습니다' }, 403);
    if (campaign && !isFixedAdmin(c.env, u.email) && campaign.created_by !== u.email) {
      return c.json({ error: '이 캠페인을 관리할 권한이 없습니다' }, 403);
    }
  } else if (campaign && parseForm(campaign.fields).noEdit && !(await isAdmin(c, u.email))) {
    // 수정 금지 설문은 본인 제출도 삭제 불가 (삭제 후 재제출로 우회하는 것을 막음)
    return c.json({ error: '이 설문은 제출 후 수정·삭제할 수 없습니다' }, 400);
  }
  await deleteSubmissionDeep(c.env, sub.id);
  return c.json({ ok: true });
}));

// ---------- 관리자 API ----------

app.get('/api/admin/campaigns', needAdmin(async (c) => {
  const email = c.get('user').email;
  const fixed = isFixedAdmin(c.env, email);
  const { results } = fixed
    ? await c.env.DB.prepare(`
        SELECT ca.*, (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id = ca.id) AS submission_count
        FROM campaigns ca ORDER BY ca.id DESC`).all()
    : await c.env.DB.prepare(`
        SELECT ca.*, (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id = ca.id) AS submission_count
        FROM campaigns ca WHERE ca.created_by = ? ORDER BY ca.id DESC`).bind(email).all();
  return c.json(results.map((ca) => ({
    ...ca,
    form: parseForm(ca.fields),
    fields: undefined,
    open_now: isOpenNow(ca) ? 1 : 0,
  })));
}));

app.post('/api/admin/campaigns', needAdmin(async (c) => {
  const body = await c.req.json();
  const title = (body.title || '').trim();
  if (!title) return c.json({ error: '캠페인 제목을 입력해 주세요' }, 400);
  const form = sanitizeForm(body.fields);
  const closesAt = body.closes_at ? String(body.closes_at).slice(0, 10) : null;
  const slug = randomSlug();
  await c.env.DB
    .prepare('INSERT INTO campaigns (slug, title, description, fields, closes_at, created_by) VALUES (?,?,?,?,?,?)')
    .bind(slug, title, (body.description || '').trim(), JSON.stringify(form), closesAt, c.get('user').email)
    .run();
  await markMediaAttachments(c.env, form);
  return c.json({ ok: true, slug });
}));

app.patch('/api/admin/campaigns/:id', needAdmin(async (c) => {
  const { errorRes } = await getManagedCampaign(c, c.req.param('id'));
  if (errorRes) return errorRes;
  const body = await c.req.json();
  const fields = [];
  const vals = [];
  if (body.is_open !== undefined) { fields.push('is_open = ?'); vals.push(body.is_open ? 1 : 0); }
  if (typeof body.title === 'string' && body.title.trim()) { fields.push('title = ?'); vals.push(body.title.trim()); }
  if (typeof body.description === 'string') { fields.push('description = ?'); vals.push(body.description.trim()); }
  let newForm = null;
  if (body.fields !== undefined) {
    newForm = sanitizeForm(body.fields);
    fields.push('fields = ?');
    vals.push(JSON.stringify(newForm));
  }
  if (body.closes_at !== undefined) { fields.push('closes_at = ?'); vals.push(body.closes_at ? String(body.closes_at).slice(0, 10) : null); }
  if (!fields.length) return c.json({ error: '변경할 내용이 없습니다' }, 400);
  vals.push(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  if (newForm) await markMediaAttachments(c.env, newForm);
  return c.json({ ok: true });
}));

// ---------- 설문 템플릿 ----------

app.get('/api/admin/templates', needAdmin(async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, fields, created_at FROM templates ORDER BY id DESC').all();
  return c.json(results.map((t) => ({ id: t.id, name: t.name, form: parseForm(t.fields), created_at: t.created_at })));
}));

app.post('/api/admin/templates', needAdmin(async (c) => {
  const body = await c.req.json();
  const name = (body.name || '').trim().slice(0, 100);
  if (!name) return c.json({ error: '템플릿 이름을 입력해 주세요' }, 400);
  const form = sanitizeForm(body.fields);
  await c.env.DB
    .prepare('INSERT INTO templates (name, fields, created_by) VALUES (?,?,?)')
    .bind(name, JSON.stringify(form), c.get('user').email)
    .run();
  return c.json({ ok: true });
}));

app.delete('/api/admin/templates/:id', needAdmin(async (c) => {
  await c.env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
}));

app.delete('/api/admin/campaigns/:id', needAdmin(async (c) => {
  const id = c.req.param('id');
  const { campaign, errorRes } = await getManagedCampaign(c, id);
  if (errorRes) return errorRes;
  const { results } = await c.env.DB.prepare('SELECT id FROM submissions WHERE campaign_id = ?').bind(id).all();
  for (const s of results) await deleteSubmissionDeep(c.env, s.id);
  // 설문지에 첨부된 자료/배경 파일도 정리
  const form = parseForm(campaign.fields);
  const mediaIds = form.questions.flatMap((q) => (q.media || []).map((m) => m.id));
  if (form.bg) mediaIds.push(form.bg.id);
  for (const id of mediaIds) {
    const a = await c.env.DB.prepare('SELECT r2_key FROM attachments WHERE id = ?').bind(id).first();
    if (a) {
      await c.env.BUCKET.delete(a.r2_key);
      await c.env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
    }
  }
  await c.env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
}));

app.get('/api/admin/campaigns/:id/submissions', needAdmin(async (c) => {
  const { errorRes } = await getManagedCampaign(c, c.req.param('id'));
  if (errorRes) return errorRes;
  const { results } = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE campaign_id = ? ORDER BY id DESC')
    .bind(c.req.param('id'))
    .all();
  await attachSubAttachments(c.env.DB, results);
  return c.json(results);
}));

// 과거 제출(answers 없음)도 엑셀에 나오도록 기본 양식 답변으로 변환
function answersOf(sub) {
  if (sub.answers) {
    try { return JSON.parse(sub.answers); } catch { /* fall through */ }
  }
  return { title: sub.title, content: sub.content };
}

// 엑셀 다운로드: 첨부는 클릭 가능한 하이퍼링크로 연동
app.get('/api/admin/campaigns/:id/export.xlsx', needAdmin(async (c) => {
  const { campaign, errorRes } = await getManagedCampaign(c, c.req.param('id'));
  if (errorRes) return errorRes;
  const form = parseForm(campaign.fields);
  const { results } = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE campaign_id = ? ORDER BY id')
    .bind(campaign.id)
    .all();
  await attachSubAttachments(c.env.DB, results);
  for (const s of results) s._answers = answersOf(s);
  const origin = new URL(c.req.url).origin;
  const buf = buildWorkbook(campaign, form, results, { linkFor: (a) => `${origin}/files/${a.id}` });
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition('attachment', `${sanitizeName(campaign.title)}_제출내역.xlsx`),
    },
  });
}));

// ZIP 다운로드: 엑셀(상대경로 하이퍼링크) + 첨부파일 전체를 스트리밍으로 압축
app.get('/api/admin/campaigns/:id/export.zip', needAdmin(async (c) => {
  const { campaign, errorRes } = await getManagedCampaign(c, c.req.param('id'));
  if (errorRes) return errorRes;
  const form = parseForm(campaign.fields);
  const { results: subs } = await c.env.DB
    .prepare('SELECT * FROM submissions WHERE campaign_id = ? ORDER BY id')
    .bind(campaign.id)
    .all();
  await attachSubAttachments(c.env.DB, subs, true);
  for (const s of subs) s._answers = answersOf(s);

  const pathFor = {};
  const allAtts = [];
  const labelFor = (key) => {
    if (key === 'app') return '앱파일';
    if (key === 'etc') return '기타';
    return form.questions.find((q) => q.id === key)?.label || '기타';
  };
  subs.forEach((s, i) => {
    const folder = `첨부파일/${String(i + 1).padStart(3, '0')}_${sanitizeName(s.user_name || '')}_${sanitizeName(s.title).slice(0, 24)}`;
    const g = groupAtts(form, s);
    for (const key of Object.keys(g)) {
      g[key].forEach((a, j) => {
        pathFor[a.id] = `${folder}/${sanitizeName(labelFor(key)).slice(0, 30)}_${j + 1}_${a.filename}`;
        allAtts.push(a);
      });
    }
  });
  const excelBuf = buildWorkbook(campaign, form, subs, { linkFor: (a) => pathFor[a.id] });

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

// 관리자 지정/해제 (테넌트 구성원은 로그인 시 자동으로 일반 권한)
app.get('/api/admin/admins', needAdmin(async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT id, email, name, department, last_login FROM users WHERE role = 'admin' ORDER BY name, email")
    .all();
  const fixed = adminEmails(c.env);
  const list = results.map((u) => ({ ...u, isFixedAdmin: fixed.includes(u.email) }));
  // 환경설정 지정 관리자가 아직 로그인 전이라 users에 없으면 목록에 표시
  for (const email of fixed) {
    if (!list.some((u) => u.email === email)) {
      list.push({ id: null, email, name: null, department: null, last_login: null, isFixedAdmin: true });
    }
  }
  return c.json(list);
}));

app.post('/api/admin/admins', needAdmin(async (c) => {
  const body = await c.req.json();
  const email = (body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: '올바른 이메일 주소를 입력해 주세요' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO users (email, role) VALUES (?, 'admin')
     ON CONFLICT(email) DO UPDATE SET role = 'admin'`,
  ).bind(email).run();
  return c.json({ ok: true });
}));

app.delete('/api/admin/admins/:id', needAdmin(async (c) => {
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first();
  if (!target) return c.json({ error: '사용자를 찾을 수 없습니다' }, 404);
  if (target.email === c.get('user').email) return c.json({ error: '본인의 관리자 권한은 해제할 수 없습니다' }, 400);
  if (adminEmails(c.env).includes(target.email)) {
    return c.json({ error: '기본 관리자(환경설정에 지정된 계정)는 해제할 수 없습니다' }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(target.id).run();
  return c.json({ ok: true });
}));

// ---------- 첨부파일 열람 (엑셀 하이퍼링크가 여기로 연결됨) ----------

app.get('/files/:id', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect('/auth/login?redirect=' + encodeURIComponent(c.req.path));
  const a = await c.env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(c.req.param('id')).first();
  if (!a) return c.text('파일을 찾을 수 없습니다', 404);
  // 설문지 자료(media)는 로그인한 사용자 모두 열람 가능
  if (a.question_id !== 'media' && a.uploader_email !== user.email && !(await isAdmin(c, user.email))) {
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
