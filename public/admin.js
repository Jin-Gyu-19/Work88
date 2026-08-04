// 관리자 페이지 로직
const $ = (id) => document.getElementById(id);
let campaigns = [];
let currentSubs = [];

// 설문지 빌더 상태
let bQuestions = []; // { id, label, type, required, options[] }
let editingCampaign = null; // null이면 새 설문

const TYPE_LABELS = {
  text: '단답형',
  textarea: '장문형',
  choice: '객관식',
  rating: '별점 (1~5점)',
};
let templates = [];
let statsVisible = false;
let adminMe = null;

init();

async function init() {
  const me = await fetchMe();
  adminMe = me;
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
      if (b.dataset.tab === 'users') loadAdmins();
      if (b.dataset.tab === 'submissions') loadSubs();
    };
  });

  $('btn-new').onclick = () => openBuilder(null);
  $('b-add').onclick = () => { bQuestions.push(newQuestion()); renderBuilder(); };
  $('b-save').onclick = saveBuilder;
  $('b-cancel').onclick = () => $('builder-modal').classList.add('hidden');
  $('b-preview').onclick = showPreview;
  $('pv-close').onclick = () => $('preview-modal').classList.add('hidden');
  $('b-tpl-load').onclick = loadTemplateIntoBuilder;
  $('b-tpl-save').onclick = saveTemplate;
  $('b-tpl-del').onclick = deleteTemplate;
  $('btn-stats').onclick = () => {
    statsVisible = !statsVisible;
    $('btn-stats').textContent = statsVisible ? '📈 통계 닫기' : '📈 통계 보기';
    $('stats-box').classList.toggle('hidden', !statsVisible);
    if (statsVisible) renderStats();
  };
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
  $('btn-add-admin').onclick = addAdmin;
  $('lb-close').onclick = closeLightbox;
  $('lightbox').onclick = (e) => { if (e.target === $('lightbox')) closeLightbox(); };
  bindDeleteModal();
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) closeAllMenus();
  });

  await loadCampaigns();
}

// ---------- 설문 목록 ----------

async function loadCampaigns() {
  try {
    campaigns = await api('/api/admin/campaigns');
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const box = $('campaigns');
  if (!campaigns.length) {
    box.innerHTML = '<p class="muted">아직 설문이 없습니다. "새 설문 만들기"로 첫 설문지를 만들어 보세요.</p>';
  } else {
    box.innerHTML = campaigns.map((ca) => `
      <div class="campaign-item">
        <div>
          <strong>${esc(ca.title)}</strong>
          <span class="badge ${ca.open_now ? 'open' : 'closed'}">${ca.open_now ? '진행 중' : (ca.is_open && ca.closes_at ? '기한 마감' : '마감')}</span>
          ${ca.form.oneSubmission ? '<span class="badge admin">1인 1회</span>' : ''}
          <div class="muted">질문 ${ca.form.questions.length}개 · 제출 ${ca.submission_count}건${ca.closes_at ? ` · 마감일 ${esc(ca.closes_at)}` : ''} · ${kst(ca.created_at)} 생성</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <div class="dropdown">
            <button class="small primary" data-act="send" data-id="${ca.id}">📤 설문 보내기 ▾</button>
            <div class="dropdown-menu hidden" data-menu="${ca.id}">
              <button class="small" data-act="mail" data-id="${ca.id}">📧 메일로 보내기</button>
              <button class="small" data-act="copy" data-id="${ca.id}">🔗 링크 복사하기</button>
            </div>
          </div>
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

  // 제출 현황 탭의 설문 선택 목록도 갱신
  const sel = $('sel-campaign');
  const prev = sel.value;
  sel.innerHTML = campaigns.map((ca) => `<option value="${ca.id}">${esc(ca.title)} (${ca.submission_count}건)</option>`).join('');
  if (prev && campaigns.some((ca) => String(ca.id) === prev)) sel.value = prev;
}

function closeAllMenus() {
  document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.add('hidden'));
}

async function onCampaignAction(act, ca) {
  if (!ca) return;
  if (act === 'send') {
    const menu = document.querySelector(`[data-menu="${ca.id}"]`);
    const wasHidden = menu.classList.contains('hidden');
    closeAllMenus();
    if (wasHidden) menu.classList.remove('hidden');
    return;
  }
  if (act === 'mail') {
    closeAllMenus();
    const url = `${location.origin}/c/${ca.slug}`;
    const subject = ca.title;
    const sender = adminMe ? `${adminMe.name}${adminMe.department ? ` (${adminMe.department})` : ''}` : '';
    const body = [
      '안녕하세요.',
      ...(sender ? [`${sender}입니다.`] : []),
      '',
      `사내 설문 「${ca.title}」 참여를 안내드립니다.`,
      ...(ca.description ? ['', ca.description] : []),
      '',
      '▶ 참여 방법',
      '  아래 링크를 클릭한 뒤 회사 계정으로 로그인하면 바로 작성할 수 있습니다.',
      `  ${url}`,
      '',
      ...(ca.closes_at ? [`▶ 마감일: ${ca.closes_at} (당일까지 제출 가능)`] : []),
      '▶ 작성 중 임시저장이 가능하며, 화면 캡쳐·동영상·파일 첨부도 지원합니다.',
      '',
      '여러분의 응답 하나하나가 큰 도움이 됩니다.',
      '많은 참여 부탁드립니다. 감사합니다.',
    ].join('\n');
    location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return;
  }
  if (act === 'copy') {
    closeAllMenus();
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
      toast(ca.is_open ? '설문을 마감했습니다' : '설문을 다시 열었습니다');
      loadCampaigns();
    } catch (e) {
      toast(e.message, true);
    }
    return;
  }
  if (act === 'delete') {
    pendingDelete = ca;
    $('del-msg').innerHTML = `<strong>"${esc(ca.title)}"</strong> 설문을 삭제할까요? (제출 ${ca.submission_count}건)`;
    $('del-modal').classList.remove('hidden');
  }
}

// ---------- 설문 삭제 확인 모달 ----------

let pendingDelete = null;

function bindDeleteModal() {
  $('del-cancel').onclick = () => {
    pendingDelete = null;
    $('del-modal').classList.add('hidden');
  };
  // 삭제 전에 해당 설문의 제출 현황으로 이동해 전체 ZIP 다운로드 버튼을 강조
  $('del-download').onclick = () => {
    const ca = pendingDelete;
    $('del-modal').classList.add('hidden');
    if (!ca) return;
    $('sel-campaign').value = String(ca.id); // 삭제하려던 설문을 자동 선택
    document.querySelector('.tabs button[data-tab="submissions"]').click();
    setTimeout(() => {
      const zip = $('btn-zip');
      zip.scrollIntoView({ behavior: 'smooth', block: 'center' });
      zip.classList.remove('pulse-red');
      void zip.offsetWidth; // 애니메이션 재시작 트릭
      zip.classList.add('pulse-red');
      setTimeout(() => zip.classList.remove('pulse-red'), 7000);
      toast('이 버튼을 눌러 설문 내역과 첨부파일을 먼저 받아 두세요 👇', true, true);
    }, 250);
  };
  $('del-confirm').onclick = async () => {
    const ca = pendingDelete;
    pendingDelete = null;
    $('del-modal').classList.add('hidden');
    if (!ca) return;
    try {
      await api(`/api/admin/campaigns/${ca.id}`, { method: 'DELETE' });
      toast('삭제되었습니다');
      loadCampaigns();
    } catch (e) {
      toast(e.message, true);
    }
  };
}

// ---------- 설문지 빌더 ----------

function newQuestion() {
  return { id: 'q' + Math.random().toString(36).slice(2, 10), label: '', type: 'text', required: false, options: [], allowAttach: false, help: '', multiple: false, showIf: null };
}

// 서버 형식(select/checkbox) → 빌더 형식(choice + multiple)
function cloneQuestions(qs) {
  return qs.map((q) => ({
    ...q,
    type: (q.type === 'select' || q.type === 'checkbox') ? 'choice' : q.type,
    multiple: q.type === 'checkbox',
    options: q.options ? [...q.options] : [],
    allowAttach: !!q.allowAttach,
    help: q.help || '',
    showIf: q.showIf ? { ...q.showIf } : null,
  }));
}

// 빌더 형식 → 서버 형식
function toServerQuestions(qs) {
  return qs.map((q) => {
    const { multiple, ...rest } = q;
    return {
      ...rest,
      type: q.type === 'choice' ? (multiple ? 'checkbox' : 'select') : q.type,
      showIf: (q.showIf && q.showIf.qid && q.showIf.value) ? q.showIf : undefined,
    };
  });
}

function openBuilder(ca) {
  editingCampaign = ca;
  $('b-heading').textContent = ca ? '설문 편집' : '새 설문';
  $('b-name').value = ca ? ca.title : '';
  $('b-desc').value = ca ? (ca.description || '') : '';
  $('b-close').value = ca ? (ca.closes_at || '') : '';
  if (ca) {
    bQuestions = cloneQuestions(ca.form.questions);
    $('b-one').checked = !!ca.form.oneSubmission;
  } else {
    bQuestions = [
      { id: 'content', label: '내용', type: 'textarea', required: true, options: [], allowAttach: true, help: '' },
    ];
    $('b-one').checked = false;
  }
  loadTemplates();
  renderBuilder();
  $('builder-modal').classList.remove('hidden');
}

// ---------- 템플릿 ----------

async function loadTemplates() {
  try {
    templates = await api('/api/admin/templates');
  } catch {
    templates = [];
  }
  const sel = $('b-tpl');
  sel.innerHTML = templates.length
    ? templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')
    : '<option value="">저장된 템플릿 없음</option>';
}

function loadTemplateIntoBuilder() {
  const t = templates.find((x) => String(x.id) === $('b-tpl').value);
  if (!t) { toast('불러올 템플릿이 없습니다', true); return; }
  bQuestions = cloneQuestions(t.form.questions);
  $('b-one').checked = !!t.form.oneSubmission;
  renderBuilder();
  toast(`"${t.name}" 템플릿을 불러왔습니다`);
}

async function saveTemplate() {
  const name = prompt('템플릿 이름을 입력하세요:', $('b-name').value.trim() || '내 설문 템플릿');
  if (!name) return;
  const cleaned = toServerQuestions(
    bQuestions
      .map((q) => ({ ...q, options: (q.options || []).map((o) => o.trim()).filter(Boolean) }))
      .filter((q) => q.label.trim()),
  );
  if (!cleaned.length) { toast('저장할 질문이 없습니다', true); return; }
  try {
    await api('/api/admin/templates', {
      method: 'POST',
      body: JSON.stringify({
        name,
        fields: { questions: cleaned, oneSubmission: $('b-one').checked },
      }),
    });
    toast('템플릿이 저장되었습니다');
    loadTemplates();
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteTemplate() {
  const t = templates.find((x) => String(x.id) === $('b-tpl').value);
  if (!t) { toast('삭제할 템플릿이 없습니다', true); return; }
  if (!confirm(`"${t.name}" 템플릿을 삭제할까요?`)) return;
  try {
    await api(`/api/admin/templates/${t.id}`, { method: 'DELETE' });
    toast('템플릿이 삭제되었습니다');
    loadTemplates();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderBuilder() {
  const box = $('b-questions');
  box.innerHTML = '';
  bQuestions.forEach((q, i) => {
    const row = document.createElement('div');
    row.className = 'q-row';
    const isChoice = q.type === 'choice';
    // 이 질문보다 앞에 있는 객관식 질문들 (분기 조건으로 사용 가능)
    const priorChoices = bQuestions.slice(0, i).filter((p) => p.type === 'choice' && p.label.trim());
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
      <input class="q-help" placeholder="질문 설명문 (선택) — 질문 아래 작은 글씨로 표시됩니다" value="${esc(q.help || '')}">
      <div class="q-opts-box ${isChoice ? '' : 'hidden'}">
        <div class="opt-rows"></div>
        <button type="button" class="small opt-add">➕ 선택지 추가</button>
        <label class="choice" style="margin-top:8px;"><input type="checkbox" class="q-multi" ${q.multiple ? 'checked' : ''}> 복수 선택 허용 (여러 개를 고를 수 있게)</label>
      </div>
      <div class="q-branch">
        <span class="muted">🔀 표시 조건:</span>
        <select class="q-branch-q" ${priorChoices.length ? '' : 'disabled'} title="${priorChoices.length ? '' : '이 질문보다 앞에 객관식 질문이 있어야 분기를 만들 수 있습니다'}">
          <option value="">항상 표시</option>
          ${priorChoices.map((p) => `<option value="${p.id}" ${q.showIf?.qid === p.id ? 'selected' : ''}>"${esc(p.label)}" 질문에서</option>`).join('')}
        </select>
        <select class="q-branch-v ${q.showIf?.qid ? '' : 'hidden'}"></select>
        <span class="q-branch-tail muted ${q.showIf?.qid ? '' : 'hidden'}">답변을 고른 사람에게만 표시</span>
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

    // 분기 선택지 목록 채우기
    const renderBranchV = () => {
      const qid = row.querySelector('.q-branch-q').value;
      const vSel = row.querySelector('.q-branch-v');
      const tail = row.querySelector('.q-branch-tail');
      if (!qid) {
        q.showIf = null;
        vSel.classList.add('hidden');
        tail.classList.add('hidden');
        return;
      }
      const parent = bQuestions.find((p) => p.id === qid);
      const opts = (parent?.options || []).map((o) => o.trim()).filter(Boolean);
      vSel.innerHTML = opts.map((o) => `<option value="${esc(o)}" ${q.showIf?.value === o ? 'selected' : ''}>"${esc(o)}"</option>`).join('');
      vSel.classList.remove('hidden');
      tail.classList.remove('hidden');
      q.showIf = { qid, value: vSel.value };
    };
    if (q.showIf?.qid) renderBranchV();
    row.querySelector('.q-branch-q').onchange = renderBranchV;
    row.querySelector('.q-branch-v').onchange = (e) => { if (q.showIf) q.showIf.value = e.target.value; };

    row.querySelector('.opt-add').onclick = () => { q.options.push(''); renderOpts(true); };
    row.querySelector('.q-label').oninput = (e) => { q.label = e.target.value; };
    row.querySelector('.q-help').oninput = (e) => { q.help = e.target.value; };
    row.querySelector('.q-multi').onchange = (e) => { q.multiple = e.target.checked; };
    row.querySelector('.q-type').onchange = (e) => {
      q.type = e.target.value;
      const choice = q.type === 'choice';
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
  const qs = toServerQuestions(
    bQuestions
      .map((q) => ({ ...q, options: (q.options || []).map((o) => o.trim()).filter(Boolean) }))
      .filter((q) => q.label.trim()),
  );
  const title = $('b-name').value.trim() || '(설문 제목)';
  const desc = $('b-desc').value.trim();

  const qHtml = qs.length ? qs.map((q) => {
    const req = q.required ? ' <span style="color:var(--danger)">*</span>' : '';
    const help = q.help ? `<span class="q-help-text">${esc(q.help)}</span>` : '';
    let inner;
    if (q.type === 'textarea') {
      inner = `<label>${esc(q.label)}${req}${help}<textarea rows="5" placeholder="답변 입력"></textarea></label>`;
    } else if (q.type === 'rating') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req}</legend>${help ? `<p class="hint" style="margin-top:0;">${esc(q.help)}</p>` : ''}
        <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-v="${n}">★</button>`).join('')}</div>
      </fieldset>`;
    } else if (q.type === 'select') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req}</legend>${help ? `<p class="hint" style="margin-top:0;">${esc(q.help)}</p>` : ''}${
        q.options.map((o) => `<label class="choice"><input type="radio" name="pv_${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }</fieldset>`;
    } else if (q.type === 'checkbox') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req} <span class="muted">(복수 선택 가능)</span></legend>${help ? `<p class="hint" style="margin-top:0;">${esc(q.help)}</p>` : ''}${
        q.options.map((o) => `<label class="choice"><input type="checkbox" name="pv_${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }</fieldset>`;
    } else {
      inner = `<label>${esc(q.label)}${req}${help}<input placeholder="답변 입력"></label>`;
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
    return `<div class="q-item" data-qid="${q.id}">${inner}${attach}</div>`;
  }).join('') : '<p class="muted">질문이 없습니다.</p>';

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
      <button type="button" class="primary" style="width:100%; padding:12px;" disabled>제출하기</button>
    </div>`;
  applyPreviewBranching(qs);
  $('preview-modal').classList.remove('hidden');
}

// 미리보기에서도 분기가 실제처럼 동작하도록
function applyPreviewBranching(qs) {
  const body = $('pv-body');
  const update = () => {
    const raw = {};
    for (const q of qs) {
      if (q.type === 'select') {
        const el = body.querySelector(`input[name="pv_${q.id}"]:checked`);
        if (el) raw[q.id] = el.value;
      } else if (q.type === 'checkbox') {
        const els = [...body.querySelectorAll(`input[name="pv_${q.id}"]:checked`)];
        if (els.length) raw[q.id] = els.map((e) => e.value);
      }
    }
    const vis = {};
    for (const q of qs) {
      if (!q.showIf) {
        vis[q.id] = true;
      } else {
        const pv = raw[q.showIf.qid];
        const match = Array.isArray(pv) ? pv.includes(q.showIf.value) : pv === q.showIf.value;
        vis[q.id] = !!(vis[q.showIf.qid] && match);
      }
      const el = body.querySelector(`.q-item[data-qid="${q.id}"]`);
      if (el) el.classList.toggle('hidden', !vis[q.id]);
    }
  };
  body.onchange = update;
  update();
}

async function saveBuilder() {
  const title = $('b-name').value.trim();
  if (!title) { toast('설문 제목을 입력해 주세요', true); return; }
  const cleaned = toServerQuestions(
    bQuestions
      .map((q) => ({ ...q, options: (q.options || []).map((o) => o.trim()).filter(Boolean) }))
      .filter((q) => q.label.trim()),
  );
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
    closes_at: $('b-close').value || '',
    fields: {
      questions: cleaned,
      oneSubmission: $('b-one').checked,
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
        toast('설문이 생성되고 참여 링크가 복사되었습니다');
      } catch {
        prompt('설문이 생성되었습니다. 참여 링크:', url);
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
    $('sub-count').textContent = '설문이 없습니다.';
    return;
  }
  try {
    currentSubs = await api(`/api/admin/campaigns/${id}/submissions`);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  $('sub-count').textContent = `총 ${currentSubs.length}건`;
  if (statsVisible) renderStats();
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

// ---------- 통계 대시보드 ----------

function barRows(counts, total) {
  const max = Math.max(1, ...Object.values(counts));
  return Object.entries(counts).map(([label, n]) => {
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `
      <div class="bar-row">
        <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((n / max) * 100)}%"></div></div>
        <span class="bar-count">${n}건 (${pct}%)</span>
      </div>`;
  }).join('');
}

function renderStats() {
  const box = $('stats-box');
  const ca = campaigns.find((x) => String(x.id) === $('sel-campaign').value);
  if (!ca) { box.innerHTML = '<p class="muted">설문이 없습니다.</p>'; return; }
  const subs = currentSubs;
  const answersList = subs.map((s) => {
    try { return s.answers ? JSON.parse(s.answers) : {}; } catch { return {}; }
  });

  // 참여 요약
  const people = new Set(subs.map((s) => s.user_email)).size;
  const deptCounts = {};
  for (const s of subs) {
    const d = s.user_department || '(부서 미상)';
    deptCounts[d] = (deptCounts[d] || 0) + 1;
  }
  const attCount = subs.reduce((n, s) => n + (s.attachments?.length || 0), 0);

  let html = `
    <h2>📈 ${esc(ca.title)} — 통계</h2>
    <div class="stat-tiles">
      <div class="stat-tile"><b>${subs.length}</b><div class="muted">총 제출</div></div>
      <div class="stat-tile"><b>${people}</b><div class="muted">참여 인원</div></div>
      <div class="stat-tile"><b>${Object.keys(deptCounts).length}</b><div class="muted">참여 부서</div></div>
      <div class="stat-tile"><b>${attCount}</b><div class="muted">첨부파일</div></div>
    </div>
    <div class="stat-q"><h3>부서별 제출</h3>${barRows(deptCounts, subs.length) || '<p class="muted">데이터 없음</p>'}</div>`;

  // 질문별 통계 (객관식/체크박스/별점)
  for (const q of ca.form.questions) {
    if (q.type === 'select' || q.type === 'checkbox') {
      const counts = {};
      for (const o of q.options) counts[o] = 0;
      let answered = 0;
      answersList.forEach((ans) => {
        const v = ans[q.id];
        if (v === undefined) return;
        answered++;
        (Array.isArray(v) ? v : [v]).forEach((o) => { if (o in counts) counts[o]++; });
      });
      html += `<div class="stat-q"><h3>${esc(q.label)} <span class="muted" style="font-size:12.5px;">(응답 ${answered}건)</span></h3>${barRows(counts, answered)}</div>`;
    } else if (q.type === 'rating') {
      const counts = { '5점': 0, '4점': 0, '3점': 0, '2점': 0, '1점': 0 };
      let sum = 0;
      let answered = 0;
      answersList.forEach((ans) => {
        const n = parseInt(ans[q.id], 10);
        if (n >= 1 && n <= 5) { counts[`${n}점`]++; sum += n; answered++; }
      });
      const avg = answered ? (sum / answered).toFixed(1) : '-';
      html += `<div class="stat-q"><h3>${esc(q.label)} <span class="muted" style="font-size:12.5px;">(응답 ${answered}건 · 평균 ⭐${avg})</span></h3>${barRows(counts, answered)}</div>`;
    }
  }
  box.innerHTML = html;
}

function showDetail(s) {
  if (!s) return;
  $('d-title').textContent = s.title;
  $('d-meta').textContent = `${s.user_name} · ${s.user_department || '부서 미상'} · ${s.user_email} · ${kst(s.created_at)}`;
  $('d-content').textContent = s.content;
  $('d-appurl').innerHTML = s.app_url
    ? `📱 앱 URL: <a href="${esc(s.app_url)}" target="_blank" rel="noopener">${esc(s.app_url)}</a>`
    : '';
  const hasMedia = s.attachments.some((a) => a.kind === 'image' || a.kind === 'video');
  $('d-atts-hint').style.display = hasMedia ? '' : 'none';
  $('d-atts').innerHTML = s.attachments.map((a) => {
    const url = `/files/${a.id}`;
    let preview = '';
    if (a.kind === 'image') preview = `<img src="${url}" alt="" class="lb-zoom" data-lb="image" data-src="${url}" title="클릭하면 크게 보기">`;
    else if (a.kind === 'video') preview = `<div class="video-thumb lb-zoom" data-lb="video" data-src="${url}" title="클릭하면 크게 재생"><video src="${url}" preload="metadata" muted></video><span class="play-badge">▶</span></div>`;
    return `<div>${preview}<a href="${url}?download=1">${a.kind === 'app' ? '📦' : '📎'} ${esc(a.filename)} (${fmtSize(a.size)})</a></div>`;
  }).join('');
  $('d-atts').querySelectorAll('.lb-zoom').forEach((el) => {
    el.onclick = () => openLightbox(el.dataset.lb, el.dataset.src);
  });
  $('detail-modal').classList.remove('hidden');
}

// ---------- 이미지/영상 확대 보기 ----------

function openLightbox(type, src) {
  const body = $('lb-body');
  body.innerHTML = type === 'video'
    ? `<video src="${src}" controls autoplay playsinline></video>`
    : `<img src="${src}" alt="">`;
  $('lightbox').classList.remove('hidden');
}

function closeLightbox() {
  $('lb-body').innerHTML = ''; // 영상 재생 중지
  $('lightbox').classList.add('hidden');
}

// ---------- 관리자 관리 ----------

async function loadAdmins() {
  let admins;
  try {
    admins = await api('/api/admin/admins');
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const me = await fetchMe();
  const tbody = $('admin-rows');
  tbody.innerHTML = admins.map((u) => {
    const isSelf = me && u.email === me.email;
    const removable = !isSelf && !u.isFixedAdmin && u.id;
    return `
      <tr>
        <td>${u.name ? esc(u.name) : '<span class="muted">(아직 로그인 안 함)</span>'}${isSelf ? ' <span class="muted">(나)</span>' : ''}</td>
        <td>${esc(u.department || '')}</td>
        <td>${esc(u.email)}</td>
        <td style="white-space:nowrap;">${kst(u.last_login)}</td>
        <td>
          ${u.isFixedAdmin ? '<span class="hint">환경설정 지정</span>' : ''}
          ${removable ? `<button class="small ghost" data-remove="${u.id}">해제</button>` : ''}
        </td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('button[data-remove]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 사용자의 관리자 권한을 해제할까요?')) return;
      try {
        await api(`/api/admin/admins/${b.dataset.remove}`, { method: 'DELETE' });
        toast('관리자 권한이 해제되었습니다');
        loadAdmins();
      } catch (e) {
        toast(e.message, true);
      }
    };
  });
}

async function addAdmin() {
  const email = $('new-admin-email').value.trim();
  if (!email) { toast('이메일을 입력해 주세요', true); return; }
  try {
    await api('/api/admin/admins', { method: 'POST', body: JSON.stringify({ email }) });
    toast(`${email} 님이 관리자로 지정되었습니다`);
    $('new-admin-email').value = '';
    loadAdmins();
  } catch (e) {
    toast(e.message, true);
  }
}
