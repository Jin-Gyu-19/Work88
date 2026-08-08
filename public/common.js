// 공용 유틸리티
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fmtSize(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
  if (n >= 1024) return Math.round(n / 1024) + 'KB';
  return n + 'B';
}

function kst(utc) {
  if (!utc) return '';
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function loginUrl() {
  return '/auth/login?redirect=' + encodeURIComponent(location.pathname + location.search);
}

async function fetchMe() {
  const r = await fetch('/api/me');
  if (!r.ok) return null;
  return r.json();
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/';
}

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    const e = new Error('로그인이 필요합니다');
    e.unauth = true;
    throw e;
  }
  if (!r.ok) throw new Error(data.error || '요청에 실패했습니다');
  return data;
}

let toastTimer;
function toast(msg, isError, atTop) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.toggle('top', !!atTop);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function renderWho(me) {
  const el = document.getElementById('who');
  if (!el) return;
  if (!me) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <span>${esc(me.name)}${me.department ? ' · ' + esc(me.department) : ''}</span>
    ${me.isAdmin ? `<a href="/admin" title="관리자 페이지로 이동"><span class="badge admin">${me.isMaster ? '마스터' : '관리자'}</span></a>` : ''}
    <button class="small ghost" onclick="logout()">로그아웃</button>`;
}
