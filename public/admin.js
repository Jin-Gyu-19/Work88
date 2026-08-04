// 관리자 페이지 로직
const $ = (id) => document.getElementById(id);
let campaigns = [];
let currentSubs = [];

init();

async function init() {
  const me = await fetchMe();
  $('loading').classList.add('hidden');
  if (!me) {
    $('login-box').classList.remove('hidden');
    $('btn-login').onclick = () => (location.href = loginUrl());
    return;
  }
  renderWho(me);
  if (!me.isAdmin) {
    $('denied-box').classList.remove('hidden');
    return;
  }
  $('admin-box').classList.remove('hidden');

  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      ['campaigns', 'submissions', 'users'].forEach((t) => $(`tab-${t}`).classList.toggle('hidden', t !== b.dataset.tab));
      if (b.dataset.tab === 'users') loadUsers();
      if (b.dataset.tab === 'submissions') loadSubs();
    };
  });

  $('btn-create').onclick = createCampaign;
  $('sel-campaign').onchange = loadSubs;
  $('btn-excel').onclick = () => {
    const id = $('sel-campaign').value;
    if (id) location.href = `/api/admin/campaigns/${id}/export.xlsx`;
  };
  $('btn-zip').onclick = () => {
    const id = $('sel-campaign').value;
    if (id) location.href = `/api/admin/campaigns/${id}/export.zip`;
  };
  $('d-close').onclick = () => $('detail-modal').classList.add('hidden');

  await loadCampaigns();
}

// ---------- 캠페인 ----------

async function loadCampaigns() {
  try {
    campaigns = await api('/api/admin/campaigns');
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const box = $('campaigns');
  if (!campaigns.length) {
    box.innerHTML = '<p class="muted">아직 캠페인이 없습니다. 위에서 첫 캠페인을 만들어 보세요.</p>';
  } else {
    box.innerHTML = campaigns.map((ca) => `
      <div class="campaign-item">
        <div>
          <strong>${esc(ca.title)}</strong>
          <span class="badge ${ca.is_open ? 'open' : 'closed'}">${ca.is_open ? '진행 중' : '마감'}</span>
          <div class="muted">제출 ${ca.submission_count}건 · ${kst(ca.created_at)} 생성</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="small" data-act="copy" data-id="${ca.id}">🔗 링크 복사</button>
          <button class="small" data-act="toggle" data-id="${ca.id}">${ca.is_open ? '마감하기' : '다시 열기'}</button>
          <button class="small ghost" data-act="delete" data-id="${ca.id}">삭제</button>
        </div>
      </div>`).join('');
  }
  box.querySelectorAll('button[data-act]').forEach((b) => {
    const ca = campaigns.find((x) => String(x.id) === b.dataset.id);
    b.onclick = () => onCampaignAction(b.dataset.act, ca);
  });

  // 제출 현황 탭의 캠페인 선택 목록도 갱신
  const sel = $('sel-campaign');
  const prev = sel.value;
  sel.innerHTML = campaigns.map((ca) => `<option value="${ca.id}">${esc(ca.title)} (${ca.submission_count}건)</option>`).join('');
  if (prev && campaigns.some((ca) => String(ca.id) === prev)) sel.value = prev;
}

async function onCampaignAction(act, ca) {
  if (!ca) return;
  if (act === 'copy') {
    const url = `${location.origin}/c/${ca.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('참여 링크가 복사되었습니다. 공지에 붙여넣어 주세요.');
    } catch {
      prompt('아래 링크를 복사해 주세요:', url);
    }
    return;
  }
  if (act === 'toggle') {
    try {
      await api(`/api/admin/campaigns/${ca.id}`, { method: 'PATCH', body: JSON.stringify({ is_open: ca.is_open ? 0 : 1 }) });
      toast(ca.is_open ? '캠페인을 마감했습니다' : '캠페인을 다시 열었습니다');
      loadCampaigns();
    } catch (e) {
      toast(e.message, true);
    }
    return;
  }
  if (act === 'delete') {
    if (!confirm(`"${ca.title}" 캠페인을 삭제할까요?\n제출 ${ca.submission_count}건과 첨부파일이 모두 삭제되며 되돌릴 수 없습니다.`)) return;
    try {
      await api(`/api/admin/campaigns/${ca.id}`, { method: 'DELETE' });
      toast('삭제되었습니다');
      loadCampaigns();
    } catch (e) {
      toast(e.message, true);
    }
  }
}

async function createCampaign() {
  const title = $('new-title').value.trim();
  if (!title) {
    toast('캠페인 제목을 입력해 주세요', true);
    return;
  }
  try {
    const res = await api('/api/admin/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title, description: $('new-desc').value }),
    });
    $('new-title').value = '';
    $('new-desc').value = '';
    await loadCampaigns();
    const url = `${location.origin}/c/${res.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('캠페인이 생성되고 참여 링크가 복사되었습니다');
    } catch {
      prompt('캠페인이 생성되었습니다. 참여 링크:', url);
    }
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- 제출 현황 ----------

async function loadSubs() {
  const id = $('sel-campaign').value;
  const tbody = $('sub-rows');
  if (!id) {
    tbody.innerHTML = '';
    $('sub-count').textContent = '캠페인이 없습니다.';
    return;
  }
  try {
    currentSubs = await api(`/api/admin/campaigns/${id}/submissions`);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  $('sub-count').textContent = `총 ${currentSubs.length}건`;
  tbody.innerHTML = currentSubs.map((s) => `
    <tr class="clickable" data-id="${s.id}">
      <td style="white-space:nowrap;">${kst(s.created_at)}</td>
      <td>${esc(s.user_name)}</td>
      <td>${esc(s.user_department)}</td>
      <td>${esc(s.title)}</td>
      <td>${s.attachments.length ? `📎 ${s.attachments.length}` : '-'}</td>
      <td><button class="small ghost" data-del="${s.id}">삭제</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('button')) return;
      showDetail(currentSubs.find((s) => String(s.id) === tr.dataset.id));
    };
  });
  tbody.querySelectorAll('button[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 제출을 삭제할까요? 첨부파일도 함께 삭제됩니다.')) return;
      try {
        await api(`/api/submissions/${b.dataset.del}`, { method: 'DELETE' });
        toast('삭제되었습니다');
        loadSubs();
        loadCampaigns();
      } catch (e) {
        toast(e.message, true);
      }
    };
  });
}

function showDetail(s) {
  if (!s) return;
  $('d-title').textContent = s.title;
  $('d-meta').textContent = `${s.user_name} · ${s.user_department || '부서 미상'} · ${s.user_email} · ${kst(s.created_at)}`;
  $('d-content').textContent = s.content;
  $('d-appurl').innerHTML = s.app_url
    ? `📱 앱 URL: <a href="${esc(s.app_url)}" target="_blank" rel="noopener">${esc(s.app_url)}</a>`
    : '';
  $('d-atts').innerHTML = s.attachments.map((a) => {
    const url = `/files/${a.id}`;
    let preview = '';
    if (a.kind === 'image') preview = `<img src="${url}" alt="">`;
    else if (a.kind === 'video') preview = `<video src="${url}" controls preload="metadata"></video>`;
    return `<div>${preview}<a href="${url}?download=1">${a.kind === 'app' ? '📦' : '📎'} ${esc(a.filename)} (${fmtSize(a.size)})</a></div>`;
  }).join('');
  $('detail-modal').classList.remove('hidden');
}

// ---------- 사용자 관리 ----------

async function loadUsers() {
  let users;
  try {
    users = await api('/api/admin/users');
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const me = await fetchMe();
  const tbody = $('user-rows');
  tbody.innerHTML = users.map((u) => {
    const isSelf = me && u.email === me.email;
    const locked = isSelf || u.isFixedAdmin;
    return `
      <tr>
        <td>${esc(u.name)}${isSelf ? ' <span class="muted">(나)</span>' : ''}</td>
        <td>${esc(u.department)}</td>
        <td>${esc(u.email)}</td>
        <td>
          <select data-id="${u.id}" ${locked ? 'disabled' : ''} style="width:auto; margin:0;">
            <option value="user" ${u.role !== 'admin' ? 'selected' : ''}>일반</option>
            <option value="admin" ${u.role === 'admin' || u.isFixedAdmin ? 'selected' : ''}>관리자</option>
          </select>
          ${u.isFixedAdmin ? '<div class="hint">환경설정 지정 관리자</div>' : ''}
        </td>
        <td style="white-space:nowrap;">${kst(u.last_login)}</td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('select[data-id]').forEach((sel) => {
    sel.onchange = async () => {
      try {
        await api(`/api/admin/users/${sel.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ role: sel.value }) });
        toast('권한이 변경되었습니다');
      } catch (e) {
        toast(e.message, true);
        loadUsers();
      }
    };
  });
}
