// 관리자 페이지 로직
const $ = (id) => document.getElementById(id);
let campaigns = [];
let currentSubs = [];

// 설문지 빌더 상태
let bQuestions = []; // { id, label, type, required, options[] }
let editingCampaign = null; // null이면 새 캠페인

const TYPE_LABELS = {
  text: '단답형',
  textarea: '장문형',
  select: '객관식 (하나 선택)',
  checkbox: '체크박스 (여러 개 선택)',
};

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

  $('btn-new').onclick = () => openBuilder(null);
  $('b-add').onclick = () => { bQuestions.push(newQuestion()); renderBuilder(); };
  $('b-save').onclick = saveBuilder;
  $('b-cancel').onclick = () => $('builder-modal').classList.add('hidden');
  $('b-preview').onclick = showPreview;
  $('pv-close').onclick = () => $('preview-modal').classList.add('hidden');
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

// ---------- 캠페인 목록 ----------

async function loadCampaigns() {
  try {
    campaigns = await api('/api/admin/campaigns');
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const box = $('campaigns');
  if (!campaigns.length) {
    box.innerHTML = '<p class="muted">아직 캠페인이 없습니다. "새 캠페인 만들기"로 첫 설문지를 만들어 보세요.</p>';
  } else {
    box.innerHTML = campaigns.map((ca) => `
      <div class="campaign-item">
        <div>
          <strong>${esc(ca.title)}</strong>
          <span class="badge ${ca.is_open ? 'open' : 'closed'}">${ca.is_open ? '진행 중' : '마감'}</span>
          <div class="muted">질문 ${ca.form.questions.length}개 · 제출 ${ca.submission_count}건 · ${kst(ca.created_at)} 생성</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="small" data-act="copy" data-id="${ca.id}">🔗 링크 복사</button>
          <button class="small" data-act="edit" data-id="${ca.id}">✏️ 설문 편집</button>
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
  if (act === 'edit') {
    openBuilder(ca);
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

// ---------- 설문지 빌더 ----------

function newQuestion() {
  return { id: 'q' + Math.random().toString(36).slice(2, 10), label: '', type: 'text', required: false, options: [], allowAttach: false };
}

function openBuilder(ca) {
  editingCampaign = ca;
  $('b-heading').textContent = ca ? '설문 편집' : '새 캠페인';
  $('b-name').value = ca ? ca.title : '';
  $('b-desc').value = ca ? (ca.description || '') : '';
  if (ca) {
    bQuestions = ca.form.questions.map((q) => ({ ...q, options: q.options ? [...q.options] : [], allowAttach: !!q.allowAttach }));
    $('b-app').checked = ca.form.showApp;
  } else {
    bQuestions = [
      { id: 'content', label: '내용', type: 'textarea', required: true, options: [], allowAttach: true },
    ];
    $('b-app').checked = true;
  }
  renderBuilder();
  $('builder-modal').classList.remove('hidden');
}

function renderBuilder() {
  const box = $('b-questions');
  box.innerHTML = '';
  bQuestions.forEach((q, i) => {
    const row = document.createElement('div');
    row.className = 'q-row';
    const isChoice = q.type === 'select' || q.type === 'checkbox';
    row.innerHTML = `
      <div class="q-head">
        <span class="muted" style="min-width:20px;">${i + 1}.</span>
        <input class="q-label" placeholder="질문을 입력하세요" value="${esc(q.label)}">
        <select class="q-type">
          ${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <label class="q-req-label"><input type="checkbox" class="q-req" ${q.required ? 'checked' : ''}> 필수</label>
        <label class="q-req-label" title="이 질문 아래에 화면 캡쳐·동영상 촬영·파일 업로드 버튼이 표시됩니다"><input type="checkbox" class="q-att" ${q.allowAttach ? 'checked' : ''}> 📎 첨부</label>
        <button type="button" class="small ghost q-up" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="small ghost q-down" ${i === bQuestions.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="small ghost q-del">✕</button>
      </div>
      <div class="q-opts-box ${isChoice ? '' : 'hidden'}">
        <div class="opt-rows"></div>
        <button type="button" class="small opt-add">➕ 선택지 추가</button>
      </div>`;

    const renderOpts = (focusLast = false) => {
      const optBox = row.querySelector('.opt-rows');
      optBox.innerHTML = '';
      if (!q.options.length) q.options.push('', '');
      q.options.forEach((o, j) => {
        const or = document.createElement('div');
        or.className = 'opt-row';
        or.innerHTML = `
          <span class="muted opt-num">${j + 1}</span>
          <input class="opt-input" value="${esc(o)}" placeholder="선택지 ${j + 1}">
          <button type="button" class="small ghost opt-del" ${q.options.length <= 1 ? 'disabled' : ''}>✕</button>`;
        or.querySelector('.opt-input').oninput = (e) => { q.options[j] = e.target.value; };
        or.querySelector('.opt-del').onclick = () => { q.options.splice(j, 1); renderOpts(); };
        optBox.appendChild(or);
      });
      if (focusLast) {
        const inputs = optBox.querySelectorAll('.opt-input');
        inputs[inputs.length - 1]?.focus();
      }
    };
    if (isChoice) renderOpts();

    row.querySelector('.opt-add').onclick = () => { q.options.push(''); renderOpts(true); };
    row.querySelector('.q-label').oninput = (e) => { q.label = e.target.value; };
    row.querySelector('.q-type').onchange = (e) => {
      q.type = e.target.value;
      const choice = q.type === 'select' || q.type === 'checkbox';
      row.querySelector('.q-opts-box').classList.toggle('hidden', !choice);
      if (choice) renderOpts();
    };
    row.querySelector('.q-req').onchange = (e) => { q.required = e.target.checked; };
    row.querySelector('.q-att').onchange = (e) => { q.allowAttach = e.target.checked; };
    row.querySelector('.q-up').onclick = () => {
      [bQuestions[i - 1], bQuestions[i]] = [bQuestions[i], bQuestions[i - 1]];
      renderBuilder();
    };
    row.querySelector('.q-down').onclick = () => {
      [bQuestions[i + 1], bQuestions[i]] = [bQuestions[i], bQuestions[i + 1]];
      renderBuilder();
    };
    row.querySelector('.q-del').onclick = () => {
      bQuestions.splice(i, 1);
      renderBuilder();
    };
    box.appendChild(row);
  });
  if (!bQuestions.length) {
    box.innerHTML = '<p class="muted">질문이 없습니다. "질문 추가"를 눌러 주세요.</p>';
  }
}

// ---------- 설문 미리보기 ----------

function showPreview() {
  const qs = bQuestions
    .map((q) => ({ ...q, options: (q.options || []).map((o) => o.trim()).filter(Boolean) }))
    .filter((q) => q.label.trim());
  const title = $('b-name').value.trim() || '(캠페인 제목)';
  const desc = $('b-desc').value.trim();

  const qHtml = qs.length ? qs.map((q) => {
    const req = q.required ? ' <span style="color:var(--danger)">*</span>' : '';
    let inner;
    if (q.type === 'textarea') {
      inner = `<label>${esc(q.label)}${req}<textarea rows="5" placeholder="답변 입력"></textarea></label>`;
    } else if (q.type === 'select') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req}</legend>${
        q.options.map((o) => `<label class="choice"><input type="radio" name="pv_${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }</fieldset>`;
    } else if (q.type === 'checkbox') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req} <span class="muted">(복수 선택 가능)</span></legend>${
        q.options.map((o) => `<label class="choice"><input type="checkbox" name="pv_${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }</fieldset>`;
    } else {
      inner = `<label>${esc(q.label)}${req}<input placeholder="답변 입력"></label>`;
    }
    const attach = q.allowAttach ? `
      <div class="attach-block">
        <div class="attach-buttons">
          <button type="button" class="small" disabled>📎 파일 업로드</button>
          <button type="button" class="small" disabled>🖥️ 화면 캡쳐</button>
          <button type="button" class="small" disabled>🎥 동영상 촬영</button>
        </div>
        <p class="hint">이미지 10MB · 동영상 1분/80MB · 기타 25MB</p>
      </div>` : '';
    return `<div class="q-item">${inner}${attach}</div>`;
  }).join('') : '<p class="muted">질문이 없습니다.</p>';

  const appHtml = $('b-app').checked ? `
    <fieldset>
      <legend>앱을 개발하셨나요? (선택)</legend>
      <label>앱 주소(URL) <input type="url" placeholder="https://..."></label>
      <button type="button" disabled>📦 앱 파일 첨부 (zip 등, 100MB 이내)</button>
    </fieldset>` : '';

  $('pv-body').innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <h1 style="font-size:19px;">${esc(title)}</h1>
      ${desc ? `<p class="muted" style="white-space:pre-wrap;">${esc(desc)}</p>` : ''}
    </div>
    <div class="card" style="margin-bottom:0;">
      <div class="grid2">
        <label>이름 <input value="홍길동 (자동 입력)" disabled></label>
        <label>부서 <input value="영업팀 (자동 입력)" disabled></label>
      </div>
      ${qHtml}
      ${appHtml}
      <button type="button" class="primary" style="width:100%; padding:12px;" disabled>제출하기</button>
    </div>`;
  $('preview-modal').classList.remove('hidden');
}

async function saveBuilder() {
  const title = $('b-name').value.trim();
  if (!title) { toast('캠페인 제목을 입력해 주세요', true); return; }
  const cleaned = bQuestions
    .map((q) => ({ ...q, options: (q.options || []).map((o) => o.trim()).filter(Boolean) }))
    .filter((q) => q.label.trim());
  if (!cleaned.length) { toast('질문을 1개 이상 만들어 주세요', true); return; }
  for (const q of cleaned) {
    if ((q.type === 'select' || q.type === 'checkbox') && !q.options.length) {
      toast(`"${q.label}" 질문의 선택지를 입력해 주세요`, true);
      return;
    }
  }
  const payload = {
    title,
    description: $('b-desc').value,
    fields: {
      questions: cleaned,
      showApp: $('b-app').checked,
    },
  };
  try {
    if (editingCampaign) {
      await api(`/api/admin/campaigns/${editingCampaign.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('설문이 수정되었습니다');
    } else {
      const res = await api('/api/admin/campaigns', { method: 'POST', body: JSON.stringify(payload) });
      const url = `${location.origin}/c/${res.slug}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('캠페인이 생성되고 참여 링크가 복사되었습니다');
      } catch {
        prompt('캠페인이 생성되었습니다. 참여 링크:', url);
      }
    }
    $('builder-modal').classList.add('hidden');
    loadCampaigns();
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
