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

// ===== 디자인 테마 전환 =====
// 상단바의 선택이 <html data-design>을 바꾸고 localStorage 'bdoDesign'에 저장된다.
// '' = 기본(글래스 세레니티) · swiss = 1번 화이트 미니멀 · aurora = 5번 오로라 글래스
const DESIGNS = [
  ['', '기본 디자인'],
  ['swiss', '화이트 미니멀'],
  ['aurora', '오로라 베일'],
  ['legalpad', '리갈패드'],
  ['noir', '누아르 골드'],
  ['porcelain', '포슬린'],
];

function applyDesign(v) {
  if (v) document.documentElement.dataset.design = v;
  else delete document.documentElement.dataset.design;
}

(function initDesign() {
  let saved = '';
  try { saved = localStorage.getItem('bdoDesign') || ''; } catch (e) {}
  applyDesign(saved);
  const mount = () => {
    const bar = document.querySelector('.topbar');
    if (!bar || bar.querySelector('.design-select')) return;
    const sel = document.createElement('select');
    sel.className = 'design-select';
    sel.title = '디자인 선택';
    sel.innerHTML = DESIGNS.map(([v, name]) => `<option value="${v}"${v === saved ? ' selected' : ''}>${name}</option>`).join('');
    sel.onchange = () => {
      applyDesign(sel.value);
      try { localStorage.setItem('bdoDesign', sel.value); } catch (e) {}
    };
    bar.insertBefore(sel, bar.querySelector('.who'));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

function renderWho(me) {
  const el = document.getElementById('who');
  if (!el) return;
  if (!me) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <span>${esc(me.name)}${me.department ? ' · ' + esc(me.department) : ''}</span>
    ${me.isAdmin ? `<a href="/admin" title="관리자 페이지로 이동"><span class="badge admin">${me.isMaster ? '마스터' : '관리자'}</span></a>` : ''}
    <button class="small ghost" onclick="logout()">로그아웃</button>`;
}
