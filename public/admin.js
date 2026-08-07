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
  dropdown: '드롭다운',
  scale: '배율 (1~N)',
  rating: '별점 (1~5점)',
  section: '구역 (페이지 나누기)',
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

  // 전체 설문·관리자 관리 탭은 마스터 관리자에게만 표시 + 상단 배지도 '마스터'로
  if (me.isMaster) {
    $('tab-btn-all').classList.remove('hidden');
    $('tab-btn-users').classList.remove('hidden');
    const badge = document.querySelector('.topbar .brand .badge.admin');
    if (badge) badge.textContent = '마스터';
  }

  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      ['campaigns', 'submissions', 'all', 'users'].forEach((t) => $(`tab-${t}`).classList.toggle('hidden', t !== b.dataset.tab));
      if (b.dataset.tab === 'users') loadAdmins();
      if (b.dataset.tab === 'submissions') loadSubs();
      if (b.dataset.tab === 'all') renderAllCampaignList();
    };
  });

  $('btn-new').onclick = () => openBuilder(null);
  $('b-opts-toggle').onclick = () => {
    const hidden = $('b-opts').classList.toggle('hidden');
    $('b-opts-toggle').setAttribute('aria-pressed', String(!hidden));
  };
  ['b-close', 'b-one', 'b-noedit'].forEach((id) => { $(id).onchange = updateOptsSum; });
  $('camp-search').oninput = renderCampaignList;
  $('camp-status').onchange = renderCampaignList;
  $('all-search').oninput = renderAllCampaignList;
  $('b-add').onclick = () => { bQuestions.push(newQuestion()); renderBuilder(); };
  $('bq-file').onchange = onBuilderFilesPicked;
  $('b-bg-add').onclick = () => $('b-bg-file').click();
  $('b-bg-file').onchange = onBgFilePicked;
  $('b-bg-del').onclick = () => { bBg = null; renderBgPreview(); };
  $('b-save').onclick = saveBuilder;
  $('b-add-sec').onclick = () => {
    const s = newQuestion();
    s.type = 'section';
    bQuestions.push(s);
    renderBuilder();
    const rows = document.querySelectorAll('#b-questions .q-row');
    rows[rows.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $('b-cancel').onclick = closeBuilder;
  $('b-close-x').onclick = closeBuilder;
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
  const closeDetail = () => $('detail-modal').classList.add('hidden');
  $('d-close').onclick = closeDetail;
  $('d-close-x').onclick = closeDetail;
  $('btn-add-admin').onclick = addAdmin;
  $('lb-close').onclick = closeLightbox;
  $('lightbox').onclick = (e) => { if (e.target === $('lightbox')) closeLightbox(); };
  bindDeleteModal();
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const id of ['lightbox', 'preview-modal', 'detail-modal', 'del-modal', 'builder-modal']) {
      const el = $(id);
      if (el && !el.classList.contains('hidden')) {
        if (id === 'lightbox') closeLightbox();
        else if (id === 'builder-modal') closeBuilder(); // 저장 안 된 변경 확인
        else el.classList.add('hidden');
        return;
      }
    }
  });
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
  renderCampaignList();
  if (adminMe?.isMaster) renderAllCampaignList();

  // 제출 현황 탭의 설문 선택 목록도 갱신 (마스터는 만든 관리자 표시)
  const sel = $('sel-campaign');
  const prev = sel.value;
  sel.innerHTML = campaigns.map((ca) => {
    const who = adminMe?.isMaster && ca.created_by !== adminMe.email
      ? ` — ${ca.creator_name || ca.created_by || '관리자 미상'}` : '';
    return `<option value="${ca.id}">${esc(ca.title)} (${ca.submission_count}건)${esc(who)}</option>`;
  }).join('');
  if (prev && campaigns.some((ca) => String(ca.id) === prev)) sel.value = prev;
}

// 마감일까지 남은 일수 (KST 기준, 마감일 지남/미설정이면 null)
function daysToClose(ca) {
  if (!ca.closes_at || !ca.open_now) return null;
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));
  const d = Math.round((new Date(ca.closes_at) - today) / 86400000);
  return d >= 0 ? d : null;
}

function renderCampaignList() {
  const box = $('campaigns');
  const text = $('camp-search').value.trim().toLowerCase();
  const status = $('camp-status').value;
  // 마스터는 서버에서 전체를 받으므로, 설문 관리 탭에는 본인 것만 보여준다
  const mine = adminMe?.isMaster ? campaigns.filter((ca) => ca.created_by === adminMe.email) : campaigns;
  const list = mine.filter((ca) => {
    if (text && !ca.title.toLowerCase().includes(text)) return false;
    if (status === 'open' && !ca.open_now) return false;
    if (status === 'closed' && ca.open_now) return false;
    return true;
  });
  if (!mine.length) {
    box.innerHTML = '<div class="empty"><span class="icon">📋</span>아직 설문이 없습니다.<br>오른쪽 위 <b>새 설문 만들기</b>로 시작하세요.</div>';
  } else if (!list.length) {
    box.innerHTML = '<div class="empty"><span class="icon">🔍</span>조건에 맞는 설문이 없습니다.</div>';
  } else {
    box.innerHTML = list.map((ca) => {
      const dLeft = daysToClose(ca);
      const qCount = ca.form.questions.filter((q) => q.type !== 'section').length;
      return `
      <div class="campaign-item">
        <div>
          <div class="ci-title-row"><span class="campaign-title">${esc(ca.title)}</span>
            <span class="stag ${ca.open_now ? 'on' : 'off'}">${ca.open_now ? '진행 중' : (ca.is_open && ca.closes_at ? '기한 마감' : '마감')}</span>
            ${dLeft !== null && dLeft <= 3 ? `<span class="stag warn">마감 ${dLeft === 0 ? 'D-DAY' : `D-${dLeft}`}</span>` : ''}
            ${ca.form.oneSubmission ? '<span class="stag">1인 1회</span>' : ''}
            ${ca.form.noEdit ? '<span class="stag">수정 금지</span>' : ''}</div>
          <div class="ci-meta">
            <button type="button" class="ci-count" data-act="subs" data-id="${ca.id}" title="클릭하면 이 설문의 제출 현황으로 이동합니다">제출 <b>${ca.submission_count}</b>건</button>
            <span class="sep">·</span><span>질문 <b>${qCount}</b>개</span>
            <span class="sep">·</span><span>${ca.closes_at ? `마감 <b>${esc(ca.closes_at)}</b>` : '기한 없음'}</span>
          </div>
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
          <button class="small" data-act="dup" data-id="${ca.id}" title="질문 구성을 그대로 복사한 새 설문을 만듭니다">⧉ 복제</button>
          <button class="small" data-act="toggle" data-id="${ca.id}">${ca.is_open ? '마감하기' : '다시 열기'}</button>
          <button class="small ghost" data-act="delete" data-id="${ca.id}">삭제</button>
        </div>
      </div>`;
    }).join('');
  }
  box.querySelectorAll('button[data-act]').forEach((b) => {
    const ca = campaigns.find((x) => String(x.id) === b.dataset.id);
    b.onclick = () => onCampaignAction(b.dataset.act, ca);
  });
}

// 전체 설문 (마스터 관리자): 모든 관리자의 설문을 만든이와 함께 표시
function renderAllCampaignList() {
  const box = $('all-campaigns');
  if (!box || !adminMe?.isMaster) return;
  const text = $('all-search').value.trim().toLowerCase();
  const list = campaigns.filter((ca) => {
    if (!text) return true;
    const who = `${ca.creator_name || ''} ${ca.created_by || ''}`.toLowerCase();
    return ca.title.toLowerCase().includes(text) || who.includes(text);
  });
  if (!list.length) {
    box.innerHTML = `<div class="empty"><span class="icon">🗂️</span>${campaigns.length ? '조건에 맞는 설문이 없습니다.' : '아직 등록된 설문이 없습니다.'}</div>`;
    return;
  }
  box.innerHTML = list.map((ca) => {
    const isMine = ca.created_by === adminMe.email;
    const who = isMine ? '나' : (ca.creator_name || ca.created_by || '관리자 미상');
    const qCount = ca.form.questions.filter((q) => q.type !== 'section').length;
    return `
      <div class="campaign-item">
        <div>
          <div class="ci-title-row"><span class="campaign-title">${esc(ca.title)}</span>
            <span class="stag ${ca.open_now ? 'on' : 'off'}">${ca.open_now ? '진행 중' : (ca.is_open && ca.closes_at ? '기한 마감' : '마감')}</span>
            <span class="stag ${isMine ? '' : 'who'}">👤 ${esc(who)}</span></div>
          <div class="ci-meta">
            <button type="button" class="ci-count" data-act="subs" data-id="${ca.id}" title="클릭하면 이 설문의 제출 현황으로 이동합니다">제출 <b>${ca.submission_count}</b>건</button>
            <span class="sep">·</span><span>질문 <b>${qCount}</b>개</span>
            <span class="sep">·</span><span>${ca.closes_at ? `마감 <b>${esc(ca.closes_at)}</b>` : '기한 없음'}</span>
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="small" data-act="edit" data-id="${ca.id}">✏️ 설문 편집</button>
          <button class="small" data-act="dup" data-id="${ca.id}">⧉ 복제</button>
          <button class="small" data-act="toggle" data-id="${ca.id}">${ca.is_open ? '마감하기' : '다시 열기'}</button>
          <button class="small ghost" data-act="delete" data-id="${ca.id}">삭제</button>
        </div>
      </div>`;
  }).join('');
  box.querySelectorAll('button[data-act]').forEach((b) => {
    const ca = campaigns.find((x) => String(x.id) === b.dataset.id);
    b.onclick = () => onCampaignAction(b.dataset.act, ca);
  });
}

function closeAllMenus() {
  document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.add('hidden'));
}

async function onCampaignAction(act, ca) {
  if (!ca) return;
  if (act === 'subs') {
    // 제출 건수 클릭 → 해당 설문이 선택된 제출 현황으로 이동
    $('sel-campaign').value = String(ca.id);
    document.querySelector('.tabs button[data-tab="submissions"]').click();
    return;
  }
  if (act === 'send') {
    const menu = document.querySelector(`[data-menu="${ca.id}"]`);
    const wasHidden = menu.classList.contains('hidden');
    closeAllMenus();
    if (wasHidden) menu.classList.remove('hidden');
    return;
  }
  if (act === 'mail') {
    closeAllMenus();
    // 받는 사람: 메일 그룹(배포 그룹) 주소나 개별 주소를 지정 (설문별로 기억)
    const toKey = `mailTo:${ca.id}`;
    const prev = localStorage.getItem(toKey) || '';
    const toRaw = prompt(
      '받는 사람을 입력하세요 (메일 그룹 주소 가능, 여러 명은 쉼표/세미콜론 구분)\n비워두고 확인하면 받는 사람 없이 초안만 열립니다.',
      prev,
    );
    if (toRaw === null) return; // 취소
    // 주소는 mailto에 원문으로 들어가야 아웃룩이 인식한다 (이메일에 쓰는 문자만 남김)
    const to = toRaw.split(/[,;\s]+/).map((s) => s.replace(/[^\w.@+-]/g, '')).filter(Boolean).join(';');
    localStorage.setItem(toKey, to);
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
    location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
  if (act === 'dup') {
    if (!confirm(`"${ca.title}" 설문을 복제할까요?\n질문 구성과 설정만 복사되고 제출 내역은 복사되지 않습니다.`)) return;
    try {
      const res = await api(`/api/admin/campaigns/${ca.id}/duplicate`, { method: 'POST' });
      toast(`"${res.title}" 사본이 만들어졌습니다`);
      loadCampaigns();
    } catch (e) {
      toast(e.message, true);
    }
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

// 질문 자료 첨부 (빌더에서 사용)
let activeMediaQ = null;
let activeMediaRender = null;
let bBg = null; // 설문 배경 이미지 { id }
const branchOpen = new Set(); // 분기 설정을 펼쳐 둔 질문 id

function renderBgPreview() {
  $('b-bg-preview').innerHTML = bBg ? `<img src="/files/${bBg.id}" alt="배경 이미지">` : '';
  $('b-bg-del').classList.toggle('hidden', !bBg);
  $('b-bg-add').textContent = bBg ? '🖼️ 배경 이미지 바꾸기' : '🖼️ 배경 이미지 설정';
}

async function onBgFilePicked(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const r = await fetch(`/api/uploads?kind=image&filename=${encodeURIComponent(f.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': f.type || 'application/octet-stream' },
      body: f,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '업로드에 실패했습니다');
    bBg = { id: data.id };
    renderBgPreview();
    toast('배경 이미지가 설정되었습니다. 저장하면 적용됩니다.');
  } catch (err) {
    toast(err.message, true);
  }
}

async function addMediaFiles(q, files, render) {
  if (!q || !files.length) return;
  if ((q.media || []).length + files.length > 5) {
    toast('질문당 자료는 최대 5개까지 첨부할 수 있습니다', true);
    return;
  }
  for (const f of files) {
    const kind = f.type.startsWith('image/') ? 'image' : 'file';
    try {
      const r = await fetch(`/api/uploads?kind=${kind}&filename=${encodeURIComponent(f.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': f.type || 'application/octet-stream' },
        body: f,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '업로드에 실패했습니다');
      q.media = q.media || [];
      q.media.push({ id: data.id, filename: data.filename, kind, size: data.size, w: 60, align: 'center' });
    } catch (err) {
      toast(err.message, true);
    }
  }
  if (render) render();
}

async function onBuilderFilesPicked(e) {
  const files = [...e.target.files];
  e.target.value = '';
  await addMediaFiles(activeMediaQ, files, activeMediaRender);
}

function newQuestion() {
  return { id: 'q' + Math.random().toString(36).slice(2, 10), label: '', type: 'text', required: false, options: [], allowAttach: false, help: '', multiple: false, showIf: null, media: [] };
}

// 서버 형식(select/checkbox) → 빌더 형식(choice + multiple)
function cloneQuestions(qs) {
  return qs.map((q) => ({
    ...q,
    type: (q.type === 'select' || q.type === 'checkbox') ? 'choice' : q.type,
    multiple: q.type === 'checkbox',
    options: q.options ? [...q.options] : [],
    allowAttach: !!q.allowAttach,
    allowOther: !!q.allowOther,
    scaleMax: q.scaleMax === 10 ? 10 : 5,
    minLabel: q.minLabel || '',
    maxLabel: q.maxLabel || '',
    help: q.help || '',
    showIf: q.showIf ? { ...q.showIf } : null,
    media: (q.media || []).map((m) => ({ ...m })),
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

// 빌더에서 분기 조건의 기준이 될 수 있는 유형 (선택지가 있는 질문)
function isBranchSource(q) {
  return q.type === 'choice' || q.type === 'dropdown';
}

// 빌더의 현재 편집 상태 (닫을 때 저장 안 된 변경 감지용)
let builderSnapshot = '';
function builderState() {
  return JSON.stringify({
    t: $('b-name').value, d: $('b-desc').value, c: $('b-close').value,
    o: $('b-one').checked, n: $('b-noedit').checked, q: bQuestions, bg: bBg,
  });
}

function closeBuilder() {
  if (builderState() !== builderSnapshot
    && !confirm('저장하지 않은 변경이 있습니다. 저장 없이 닫을까요?')) return;
  $('builder-modal').classList.add('hidden');
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
    $('b-noedit').checked = !!ca.form.noEdit;
    bBg = ca.form.bg ? { ...ca.form.bg } : null;
  } else {
    bQuestions = [
      { id: 'content', label: '내용', type: 'textarea', required: true, options: [], allowAttach: true, help: '' },
    ];
    $('b-one').checked = false;
    $('b-noedit').checked = false;
    bBg = null;
  }
  $('b-opts').classList.add('hidden');
  $('b-opts-toggle').setAttribute('aria-pressed', 'false');
  updateOptsSum();
  branchOpen.clear();
  // 이미 분기 설정이 있는 질문은 펼친 상태로 시작
  bQuestions.forEach((q, i) => {
    if (q.showIf || bQuestions.some((p, k) => k > i && p.showIf?.qid === q.id)) branchOpen.add(q.id);
  });
  renderBgPreview();
  loadTemplates();
  renderBuilder();
  builderSnapshot = builderState();
  $('builder-modal').classList.remove('hidden');
}

// 옵션 버튼 옆에 현재 설정 요약을 표시
function updateOptsSum() {
  const parts = [$('b-close').value ? `마감 ${$('b-close').value}` : '기한 없음'];
  if ($('b-one').checked) parts.push('1인 1회');
  if ($('b-noedit').checked) parts.push('수정 금지');
  $('b-opts-sum').textContent = parts.join(' · ');
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
  $('b-noedit').checked = !!t.form.noEdit;
  updateOptsSum();
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
        fields: { questions: cleaned, oneSubmission: $('b-one').checked, noEdit: $('b-noedit').checked },
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

// 질문 카드 아이콘 (굵은 선 SVG)
const SVG_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4M5 11l7-7 7 7"/></svg>';
const SVG_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M5 13l7 7 7-7"/></svg>';
const SVG_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg>';

function renderBuilder() {
  const box = $('b-questions');
  box.innerHTML = '';
  bQuestions.forEach((q, i) => {
    const row = document.createElement('div');
    const isSection = q.type === 'section';
    row.className = 'q-row' + (isSection ? ' q-row-sec' : '');
    const isChoice = q.type === 'choice';
    const hasOpts = isChoice || q.type === 'dropdown';
    const isScale = q.type === 'scale';
    row.innerHTML = `
      <div class="q-head">
        <span class="q-index">${isSection ? '§' : qNo(i)}</span>
        <input class="q-label" placeholder="${isSection ? '구역 제목 (예: 2부. 활용 현황)' : '질문을 입력하세요'}" value="${esc(q.label)}">
        <select class="q-type" aria-label="질문 유형">
          ${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="q-media-list"></div>
      <input class="q-help" placeholder="${isSection ? '구역 설명 (선택) — 참여 화면에서 이 위치부터 새 페이지가 시작됩니다' : '설명문 (선택)'}" value="${esc(q.help || '')}">
      <div class="q-opts-box ${hasOpts ? '' : 'hidden'}">
        <div class="opt-rows"></div>
        <div class="opt-foot">
          <button type="button" class="small opt-add">＋ 선택지 추가</button>
          <label class="opt-multi ${isChoice ? '' : 'hidden'}"><input type="checkbox" class="q-multi" ${q.multiple ? 'checked' : ''}> 복수 선택 허용</label>
          <label class="opt-multi q-other-wrap ${isChoice ? '' : 'hidden'}"><input type="checkbox" class="q-other" ${q.allowOther ? 'checked' : ''}> 기타(직접 입력) 허용</label>
        </div>
      </div>
      <div class="q-scale-box ${isScale ? '' : 'hidden'}">
        <select class="q-scale-max" aria-label="배율 범위" style="width:auto; margin:0;">
          <option value="5" ${q.scaleMax !== 10 ? 'selected' : ''}>1 ~ 5</option>
          <option value="10" ${q.scaleMax === 10 ? 'selected' : ''}>1 ~ 10</option>
        </select>
        <input class="q-scale-min" placeholder="왼쪽 라벨 (예: 전혀 아니다)" maxlength="40" value="${esc(q.minLabel || '')}" style="margin:0;">
        <input class="q-scale-maxl" placeholder="오른쪽 라벨 (예: 매우 그렇다)" maxlength="40" value="${esc(q.maxLabel || '')}" style="margin:0;">
      </div>
      <div class="q-toolbar">
        <div class="q-toggles" ${isSection ? 'style="visibility:hidden;"' : ''}>
          <button type="button" class="toggle q-req" aria-pressed="${q.required ? 'true' : 'false'}" title="답변을 반드시 하도록 합니다">필수</button>
          <button type="button" class="toggle q-att" aria-pressed="${q.allowAttach ? 'true' : 'false'}" title="참여자가 답변에 파일·캡쳐·동영상을 첨부할 수 있게 합니다">📎 파일 받기</button>
          <button type="button" class="small q-media-add" title="질문에 함께 보여줄 이미지·파일을 넣습니다 (끌어다 놓기 가능)">🖼 이미지 넣기</button>
          <button type="button" class="toggle q-branch-toggle" aria-pressed="false" title="이 질문의 표시 조건과 분기를 설정합니다">🔀 분기</button>
          <span class="q-branch-sum muted"></span>
        </div>
        <div class="q-icons">
          <button type="button" class="icon-btn q-up" ${i === 0 ? 'disabled' : ''} title="위로 이동" aria-label="위로 이동">${SVG_UP}</button>
          <button type="button" class="icon-btn q-down" ${i === bQuestions.length - 1 ? 'disabled' : ''} title="아래로 이동" aria-label="아래로 이동">${SVG_DOWN}</button>
          <button type="button" class="icon-btn q-dup" title="이 질문을 복사해 바로 아래에 추가" aria-label="질문 복사">${SVG_COPY}</button>
          <button type="button" class="icon-btn del q-del" title="질문 삭제" aria-label="질문 삭제">✕</button>
        </div>
      </div>
      <div class="q-branch-wrap hidden">
      <div class="q-cond">
        <span class="q-cond-label">표시 조건</span>
        <select class="q-cond-q" aria-label="이 질문을 언제 보여줄지"><option value="">항상 표시</option></select>
        <select class="q-cond-v hidden" aria-label="조건이 되는 답변"></select>
        <span class="q-cond-tail muted hidden">일 때만 표시</span>
        <span class="q-cond-note muted"></span>
      </div>
      <div class="q-branch-src hidden">
        <div class="q-branch-title">이 질문의 답변으로 다음 질문 나누기</div>
        <div class="q-branch-body"></div>
      </div>
      </div>`;

    const renderOpts = (focusLast = false) => {
      const optBox = row.querySelector('.opt-rows');
      optBox.innerHTML = '';
      if (!q.options.length) q.options.push('', '');
      q.options.forEach((o, j) => {
        const or = document.createElement('div');
        or.className = 'opt-row';
        or.innerHTML = `
          <span class="opt-dot"></span>
          <input class="opt-input" value="${esc(o)}" placeholder="선택지 ${j + 1}">
          <button type="button" class="icon-btn sm opt-del" ${q.options.length <= 1 ? 'disabled' : ''} title="선택지 삭제" aria-label="선택지 삭제">✕</button>`;
        or.querySelector('.opt-input').oninput = (e) => { q.options[j] = e.target.value; refreshBranches(); };
        or.querySelector('.opt-del').onclick = () => { q.options.splice(j, 1); renderOpts(); refreshBranches(); };
        optBox.appendChild(or);
      });
      if (focusLast) {
        const inputs = optBox.querySelectorAll('.opt-input');
        inputs[inputs.length - 1]?.focus();
      }
    };
    if (hasOpts) renderOpts();

    // 질문 자료(이미지/파일) 목록 — 이미지는 모서리 핸들로 크기 조절 + 정렬 선택
    const renderMedia = () => {
      const listBox = row.querySelector('.q-media-list');
      listBox.innerHTML = '';
      (q.media || []).forEach((m, j) => {
        const item = document.createElement('div');
        item.className = 'bq-media';
        if (m.kind === 'image') {
          if (!m.align) m.align = 'center';
          const wrapAl = m.align === 'right' ? 'margin-left:auto;' : m.align === 'left' ? '' : 'margin-left:auto;margin-right:auto;';
          item.innerHTML = `
            <div class="img-wrap" style="width:${m.w || 60}%;${wrapAl}">
              <img src="/files/${m.id}" alt="">
              <span class="resize-handle" title="드래그해서 크기 조절">◢</span>
            </div>
            <div class="bq-controls">
                            <button type="button" class="small al ${m.align === 'left' ? 'on' : ''}" data-al="left" title="왼쪽 정렬">⯇</button>
              <button type="button" class="small al ${m.align === 'center' ? 'on' : ''}" data-al="center" title="가운데 정렬">◫</button>
              <button type="button" class="small al ${m.align === 'right' ? 'on' : ''}" data-al="right" title="오른쪽 정렬">⯈</button>
              <span class="bq-pct muted">${m.w || 60}%</span>
              <button type="button" class="small ghost bq-del" title="삭제">✕</button>
            </div>`;

          // 모서리 핸들 드래그로 크기 조절
          const wrap = item.querySelector('.img-wrap');
          const pct = item.querySelector('.bq-pct');
          item.querySelector('.resize-handle').onmousedown = (e) => {
            e.preventDefault();
            const parentW = item.getBoundingClientRect().width;
            const startW = wrap.getBoundingClientRect().width;
            const startX = e.clientX;
            const move = (ev) => {
              const w = Math.min(100, Math.max(10, Math.round(((startW + (ev.clientX - startX)) / parentW) * 100)));
              m.w = w;
              wrap.style.width = w + '%';
              pct.textContent = w + '%';
            };
            const up = () => {
              document.removeEventListener('mousemove', move);
              document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
          };

          item.querySelectorAll('.al').forEach((b) => {
            b.onclick = () => { m.align = b.dataset.al; renderMedia(); };
          });
        } else {
          item.innerHTML = `
            <div class="bq-controls">
              <span>📎 ${esc(m.filename)} <span class="muted">(${fmtSize(m.size)})</span></span>
              <button type="button" class="small ghost bq-del" title="삭제">✕</button>
            </div>`;
        }
        item.querySelector('.bq-del').onclick = () => {
          q.media.splice(j, 1);
          renderMedia();
        };
        listBox.appendChild(item);
      });
    };
    renderMedia();
    row.querySelector('.q-media-add').onclick = () => {
      activeMediaQ = q;
      activeMediaRender = renderMedia;
      $('bq-file').click();
    };
    // 자료 첨부도 드래그앤드롭 지원
    const mediaBox = row;
    ['dragenter', 'dragover'].forEach((ev) => mediaBox.addEventListener(ev, (e) => {
      e.preventDefault();
      mediaBox.classList.add('drag-over');
    }));
    mediaBox.addEventListener('dragleave', (e) => {
      if (!mediaBox.contains(e.relatedTarget)) mediaBox.classList.remove('drag-over');
    });
    mediaBox.addEventListener('drop', async (e) => {
      e.preventDefault();
      mediaBox.classList.remove('drag-over');
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) await addMediaFiles(q, files, renderMedia);
    });

    row.querySelector('.opt-add').onclick = () => { q.options.push(''); renderOpts(true); };
    row.querySelector('.q-label').oninput = (e) => { q.label = e.target.value; refreshBranches(); };
    row.querySelector('.q-help').oninput = (e) => { q.help = e.target.value; };
    row.querySelector('.q-multi').onchange = (e) => { q.multiple = e.target.checked; };
    row.querySelector('.q-other').onchange = (e) => { q.allowOther = e.target.checked; };
    row.querySelector('.q-scale-max').onchange = (e) => { q.scaleMax = Number(e.target.value); };
    row.querySelector('.q-scale-min').oninput = (e) => { q.minLabel = e.target.value; };
    row.querySelector('.q-scale-maxl').oninput = (e) => { q.maxLabel = e.target.value; };
    row.querySelector('.q-type').onchange = (e) => {
      q.type = e.target.value;
      renderBuilder(); // 유형별로 보이는 편집 요소가 달라 전체 다시 그림
    };
    row.querySelector('.q-cond-q').onchange = (e) => {
      q.showIf = e.target.value ? { qid: e.target.value, value: '' } : null;
      refreshBranches();
    };
    row.querySelector('.q-cond-v').onchange = (e) => {
      if (q.showIf) q.showIf.value = e.target.value;
      refreshBranches();
    };

    const brBtn = row.querySelector('.q-branch-toggle');
    brBtn.onclick = () => {
      if (branchOpen.has(q.id)) branchOpen.delete(q.id); else branchOpen.add(q.id);
      refreshBranches();
    };

    const reqBtn = row.querySelector('.q-req');
    reqBtn.onclick = () => {
      q.required = !q.required;
      reqBtn.setAttribute('aria-pressed', q.required ? 'true' : 'false');
    };
    const attBtn = row.querySelector('.q-att');
    attBtn.onclick = () => {
      q.allowAttach = !q.allowAttach;
      attBtn.setAttribute('aria-pressed', q.allowAttach ? 'true' : 'false');
    };
    row.querySelector('.q-up').onclick = () => {
      [bQuestions[i - 1], bQuestions[i]] = [bQuestions[i], bQuestions[i - 1]];
      renderBuilder();
    };
    row.querySelector('.q-down').onclick = () => {
      [bQuestions[i + 1], bQuestions[i]] = [bQuestions[i], bQuestions[i + 1]];
      renderBuilder();
    };
    row.querySelector('.q-dup').onclick = () => {
      const copy = {
        ...q,
        id: 'q' + Math.random().toString(36).slice(2, 10),
        options: [...(q.options || [])],
        showIf: q.showIf ? { ...q.showIf } : null,
        media: (q.media || []).map((m) => ({ ...m })),
      };
      bQuestions.splice(i + 1, 0, copy);
      renderBuilder();
      toast('질문을 복제했습니다');
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
  refreshBranches();
}

// 참여 화면 기준 문항 번호 (구역 제외)
function qNo(i) {
  return bQuestions.slice(0, i + 1).filter((q) => q.type !== 'section').length;
}

// 분기(표시 조건) 드롭다운을 현재 질문 구성에 맞춰 실시간 갱신
function refreshBranches() {
  // 1) 더 이상 유효하지 않은 분기 조건은 자동 해제
  bQuestions.forEach((q, i) => {
    if (q.type === 'section') { q.showIf = null; return; }
    if (!q.showIf) return;
    const src = bQuestions.find((p) => p.id === q.showIf.qid);
    const srcIdx = src ? bQuestions.indexOf(src) : -1;
    const opts = (src?.options || []).map((o) => o.trim()).filter(Boolean);
    // 조건 질문 자체가 무효해진 경우만 해제하고, 답변만 비어 있으면 첫 선택지로 채운다
    if (!src || !isBranchSource(src) || srcIdx >= i || !opts.length) {
      q.showIf = null;
    } else if (!opts.includes(q.showIf.value)) {
      q.showIf.value = opts[0];
    }
  });

  const rows = [...document.querySelectorAll('#b-questions .q-row')];
  rows.forEach((row, i) => {
    const q = bQuestions[i];
    if (!q) return;
    const panel = row.querySelector('.q-branch-src');
    const body = row.querySelector('.q-branch-body');
    const wrap = row.querySelector('.q-branch-wrap');
    const brBtn = row.querySelector('.q-branch-toggle');
    const brSum = row.querySelector('.q-branch-sum');
    const condQ = row.querySelector('.q-cond-q');
    const condV = row.querySelector('.q-cond-v');
    const condTail = row.querySelector('.q-cond-tail');
    const condNote = row.querySelector('.q-cond-note');
    if (!panel || !body || !condQ) return;

    // ── 이 질문의 표시 조건 (질문마다 직접 설정) ──
    const prior = bQuestions.slice(0, i).filter(
      (p) => isBranchSource(p) && p.label.trim() && (p.options || []).some((o) => o.trim()),
    );
    const curQid = q.showIf?.qid && prior.some((p) => p.id === q.showIf.qid) ? q.showIf.qid : '';
    condQ.innerHTML = '<option value="">항상 표시</option>'
      + prior.map((p) => {
        const no = qNo(bQuestions.indexOf(p));
        return `<option value="${p.id}" ${curQid === p.id ? 'selected' : ''}>${no}번 "${esc(p.label.slice(0, 18))}"에서</option>`;
      }).join('');
    condQ.disabled = !prior.length;
    condNote.textContent = prior.length ? ''
      : (i === 0 ? '앞에 조건이 될 질문이 없습니다' : '앞쪽에 선택지가 있는 객관식 질문이 필요합니다');
    if (curQid) {
      const src = bQuestions.find((p) => p.id === curQid);
      const opts = (src.options || []).map((o) => o.trim()).filter(Boolean);
      const curV = opts.includes(q.showIf.value) ? q.showIf.value : opts[0];
      condV.innerHTML = opts.map((o) => `<option value="${esc(o)}" ${curV === o ? 'selected' : ''}>"${esc(o)}"</option>`).join('');
      q.showIf = { qid: curQid, value: curV };
      condV.classList.remove('hidden');
      condTail.classList.remove('hidden');
    } else {
      condV.innerHTML = '';
      condV.classList.add('hidden');
      condTail.classList.add('hidden');
    }

    // ── 접기/펼치기: 설정이 있으면 자동으로 펼침 ──
    const open = branchOpen.has(q.id);
    wrap.classList.toggle('hidden', !open);
    brBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (!open) {
      const parts = [];
      if (q.showIf) {
        const src = bQuestions.find((p) => p.id === q.showIf.qid);
        parts.push(`${qNo(bQuestions.indexOf(src))}번 "${q.showIf.value}"일 때만 표시`);
      }
      const n = bQuestions.filter((p, k) => k > i && p.showIf?.qid === q.id).length;
      if (n) parts.push(`${n}개 질문 분기`);
      brSum.textContent = parts.join(' · ');
    } else {
      brSum.textContent = '';
    }

    // 분기점 패널은 선택지가 있는 질문(객관식/드롭다운)에만 표시
    const srcOk = isBranchSource(q);
    panel.classList.toggle('hidden', !srcOk);
    if (!srcOk) return;

    const opts = (q.options || []).map((o) => o.trim()).filter(Boolean);
    const following = bQuestions.slice(i + 1).filter((fq) => fq.type !== 'section');
    if (!opts.length) {
      body.innerHTML = '<p class="hint" style="margin:0;">선택지를 입력하면 분기를 설정할 수 있어요</p>';
      return;
    }

    // 답변별 줄: 기존 질문은 칩 클릭으로 지정, '＋ 새 질문'으로 그 자리에서 분기 질문 생성
    const used = following.filter((fq) => fq.showIf?.qid === q.id).length;
    body.innerHTML = `<p class="hint" style="margin:0 0 8px;">답변별로 이어질 질문을 지정하세요${used ? ` · <b>${used}개 지정됨</b>` : ''}</p>`
      + opts.map((o) => `
        <div class="br-line">
          <span class="br-opt">"${esc(o)}" →</span>
          <span class="br-chips">${following.map((fq) => {
            const no = qNo(bQuestions.indexOf(fq));
            const on = fq.showIf?.qid === q.id && fq.showIf.value === o;
            const byOther = fq.showIf && fq.showIf.qid !== q.id;
            const label = fq.label.trim() || '(제목 없음)';
            return `<button type="button" class="chip ${on ? 'on' : ''}" data-t="${fq.id}" data-o="${esc(o)}"
              ${byOther ? 'disabled title="다른 질문의 분기로 제어 중입니다"' : ''}>${no}. ${esc(label.slice(0, 18))}</button>`;
          }).join('')}<button type="button" class="chip add" data-new="${esc(o)}" title="이 답변을 고른 사람에게만 보일 질문을 새로 만듭니다">＋ 새 질문</button></span>
        </div>`).join('');

    body.querySelectorAll('.chip[data-t]').forEach((chip) => {
      chip.onclick = () => {
        const fq = bQuestions.find((p) => p.id === chip.dataset.t);
        if (!fq) return;
        const already = fq.showIf?.qid === q.id && fq.showIf.value === chip.dataset.o;
        fq.showIf = already ? null : { qid: q.id, value: chip.dataset.o };
        refreshBranches();
      };
    });

    // 이 답변 전용 질문을 바로 추가 (같은 분기의 마지막 질문 뒤에 삽입)
    body.querySelectorAll('.chip.add').forEach((btn) => {
      btn.onclick = () => {
        const val = btn.dataset.new;
        // 같은 답변의 질문이 있으면 그 블록 끝에, 없으면 이 질문의 모든 분기 뒤에 붙인다
        let sameAt = -1;
        let anyAt = i + 1;
        bQuestions.forEach((p, k) => {
          if (k <= i || p.showIf?.qid !== q.id) return;
          anyAt = k + 1;
          if (p.showIf.value === val) sameAt = k + 1;
        });
        const insertAt = sameAt > 0 ? sameAt : anyAt;
        const nq = newQuestion();
        nq.showIf = { qid: q.id, value: val };
        bQuestions.splice(insertAt, 0, nq);
        renderBuilder();
        const el = document.querySelectorAll('#b-questions .q-row')[insertAt];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.querySelector('.q-label')?.focus();
        }
        toast(`"${val}" 분기에 새 질문을 추가했습니다`);
      };
    });
  });
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
    const helpP = q.help ? `<p class="hint" style="margin-top:0;">${esc(q.help)}</p>` : '';
    const media = (q.media || []).length ? `<div class="q-media">${
      q.media.map((m) => {
        if (m.kind !== 'image') return `<a class="q-media-file" href="/files/${m.id}?download=1">📎 ${esc(m.filename)} 내려받기</a>`;
        const al = m.align === 'right' ? 'margin-left:auto;' : m.align === 'left' ? '' : 'margin-left:auto;margin-right:auto;';
        return `<img src="/files/${m.id}" style="width:${m.w || 60}%;${al}" alt="">`;
      }).join('')
    }</div>` : '';
    let inner;
    if (q.type === 'section') {
      return `<div class="q-section">
        <h2>${esc(q.label)}</h2>
        ${q.help ? `<span class="q-help-text" style="margin-left:0;">${esc(q.help)}</span>` : ''}
        ${media}
        <span class="hint">📄 참여 화면에서는 여기부터 새 페이지가 시작됩니다</span>
      </div>`;
    }
    if (q.type === 'textarea') {
      inner = `<label>${esc(q.label)}${req}${help}${media}<textarea rows="5" placeholder="답변 입력"></textarea></label>`;
    } else if (q.type === 'rating') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req}</legend>${helpP}${media}
        <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-v="${n}">★</button>`).join('')}</div>
      </fieldset>`;
    } else if (q.type === 'scale') {
      const max = q.scaleMax === 10 ? 10 : 5;
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req}</legend>${helpP}${media}
        <div class="scale">
          ${q.minLabel ? `<span class="scale-lab">${esc(q.minLabel)}</span>` : ''}
          ${Array.from({ length: max }, (_, n) => `<button type="button" class="scale-btn">${n + 1}</button>`).join('')}
          ${q.maxLabel ? `<span class="scale-lab">${esc(q.maxLabel)}</span>` : ''}
        </div>
      </fieldset>`;
    } else if (q.type === 'dropdown') {
      inner = `<label>${esc(q.label)}${req}${help}${media}
        <select name="pv_${q.id}"><option value="">선택하세요</option>${q.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>
      </label>`;
    } else if (q.type === 'select') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req}</legend>${helpP}${media}${
        q.options.map((o) => `<label class="choice"><input type="radio" name="pv_${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }${q.allowOther ? `<label class="choice choice-other"><input type="radio" name="pv_${q.id}" value="기타"> 기타: <input type="text" class="other-input" placeholder="직접 입력"></label>` : ''}</fieldset>`;
    } else if (q.type === 'checkbox') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req} <span class="muted">(복수 선택 가능)</span></legend>${helpP}${media}${
        q.options.map((o) => `<label class="choice"><input type="checkbox" name="pv_${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }${q.allowOther ? `<label class="choice choice-other"><input type="checkbox" name="pv_${q.id}" value="기타"> 기타: <input type="text" class="other-input" placeholder="직접 입력"></label>` : ''}</fieldset>`;
    } else {
      inner = `<label>${esc(q.label)}${req}${help}${media}<input placeholder="답변 입력"></label>`;
    }
    const attach = q.allowAttach ? `
      <div class="attach-block">
        <div class="attach-buttons">
          <button type="button" class="small" disabled>📎 파일</button>
          <button type="button" class="small" disabled>🖥️ 캡쳐</button>
          <button type="button" class="small" disabled>🎥 촬영</button>
        </div>
        <p class="hint">파일 첨부 가능</p>
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
      } else if (q.type === 'dropdown') {
        const el = body.querySelector(`select[name="pv_${q.id}"]`);
        if (el && el.value) raw[q.id] = el.value;
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
  if (!cleaned.filter((q) => q.type !== 'section').length) { toast('질문을 1개 이상 만들어 주세요', true); return; }
  for (const q of cleaned) {
    if (['select', 'checkbox', 'dropdown'].includes(q.type) && !q.options.length) {
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
      noEdit: $('b-noedit').checked,
      bg: bBg,
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

let statsDept = ''; // 통계 부서 필터 ('' = 전체)
let statsCampaignId = null;

async function loadSubs() {
  const id = $('sel-campaign').value;
  if (id !== statsCampaignId) { statsDept = ''; statsCampaignId = id; }
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
  if (!currentSubs.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><span class="icon">📭</span>아직 제출된 응답이 없습니다.<br>설문 링크를 공유해 보세요.</div></td></tr>';
    return;
  }
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
// 폼: 요약=스탯타일(히어로 1개) / 분포=수평 막대(단일 시리즈=단색) / 별점=순서형 램프
// 램프는 dataviz 검증기 통과: 단일 색상(5°), 명도 단조, 밝은 끝 대비 2.05:1
const RATING_RAMP = ['#a8b1da', '#8b97cd', '#6c7ac0', '#4a5aac', '#2b3d91'];
let statsTable = false;

function barChart(rows, total, { ramp = null, unit = '건' } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (statsTable) {
    return `<table class="stat-table"><thead><tr><th>항목</th><th>응답</th><th>비율</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.n}${unit}</td><td>${total ? Math.round((r.n / total) * 100) : 0}%</td></tr>`).join('')
    }</tbody></table>`;
  }
  return `<div class="chart">${rows.map((r, i) => {
    const pct = total ? Math.round((r.n / total) * 100) : 0;
    const color = ramp ? ramp[Math.min(i, ramp.length - 1)] : 'var(--primary)';
    return `<div class="bar-row" title="${esc(r.label)} · ${r.n}${unit} (${pct}%)">
      <span class="bar-label">${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(r.n / max) * 100}%; background:${color}"></span></span>
      <span class="bar-value">${r.n}<span class="bar-pct">${pct}%</span></span>
    </div>`;
  }).join('')}</div>`;
}

function renderStats() {
  const box = $('stats-box');
  const ca = campaigns.find((x) => String(x.id) === $('sel-campaign').value);
  if (!ca) { box.innerHTML = '<div class="empty"><span class="icon">📈</span>설문을 선택해 주세요.</div>'; return; }

  // 부서 필터 (선택 목록은 전체 제출 기준으로 유지)
  const allDepts = [...new Set(currentSubs.map((s) => s.user_department || '(부서 미상)'))].sort();
  if (statsDept && !allDepts.includes(statsDept)) statsDept = '';
  const subs = statsDept ? currentSubs.filter((s) => (s.user_department || '(부서 미상)') === statsDept) : currentSubs;
  const answersList = subs.map((s) => {
    try { return s.answers ? JSON.parse(s.answers) : {}; } catch { return {}; }
  });

  const people = new Set(subs.map((s) => s.user_email)).size;
  const deptCounts = {};
  for (const s of subs) {
    const d = s.user_department || '(부서 미상)';
    deptCounts[d] = (deptCounts[d] || 0) + 1;
  }
  const attCount = subs.reduce((n, s) => n + (s.attachments?.length || 0), 0);
  const deptRows = Object.entries(deptCounts)
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n);

  let html = `
    <div class="stats-head">
      <h2 style="margin:0;">📈 ${esc(ca.title)}</h2>
      <div style="display:flex; gap:8px; align-items:center;">
        <select id="stats-dept" style="width:auto; margin:0; padding:6px 10px; font-size:12.5px;">
          <option value="">전체 부서</option>
          ${allDepts.map((d) => `<option value="${esc(d)}" ${statsDept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
        </select>
        <button class="small" id="stats-view">${statsTable ? '📊 그래프로 보기' : '📋 표로 보기'}</button>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-hero">
        <div class="kpi-label">총 제출</div>
        <div class="hero-figure">${subs.length}</div>
      </div>
      <div class="stat-tile"><div class="kpi-label">참여 인원</div><b>${people}</b></div>
      <div class="stat-tile"><div class="kpi-label">참여 부서</div><b>${deptRows.length}</b></div>
      <div class="stat-tile"><div class="kpi-label">첨부파일</div><b>${attCount}</b></div>
    </div>`;

  const bindStatsControls = () => {
    $('stats-view').onclick = toggleStatsView;
    $('stats-dept').onchange = (e) => { statsDept = e.target.value; renderStats(); };
  };

  if (!subs.length) {
    box.innerHTML = html + '<div class="empty"><span class="icon">📭</span>아직 응답이 없습니다.</div>';
    bindStatsControls();
    return;
  }

  if (!statsDept) html += `<section class="stat-q"><h3>부서별 제출</h3>${barChart(deptRows, subs.length)}</section>`;

  for (const q of ca.form.questions) {
    if (q.type === 'select' || q.type === 'checkbox' || q.type === 'dropdown') {
      const counts = Object.fromEntries(q.options.map((o) => [o, 0]));
      let other = 0;
      let answered = 0;
      answersList.forEach((ans) => {
        const v = ans[q.id];
        if (v === undefined) return;
        answered++;
        (Array.isArray(v) ? v : [v]).forEach((o) => {
          if (o in counts) counts[o]++;
          else other++; // "기타: ..." 직접 입력 값
        });
      });
      const rows = q.options.map((o) => ({ label: o, n: counts[o] }));
      if (q.allowOther && (other || answered)) rows.push({ label: '기타(직접 입력)', n: other });
      html += `<section class="stat-q"><h3>${esc(q.label)} <span class="stat-sub">응답 ${answered}건</span></h3>${barChart(rows, answered)}</section>`;
    } else if (q.type === 'rating' || q.type === 'scale') {
      const max = q.type === 'scale' ? (q.scaleMax === 10 ? 10 : 5) : 5;
      const counts = new Array(max).fill(0);
      let sum = 0;
      let answered = 0;
      answersList.forEach((ans) => {
        const n = parseInt(ans[q.id], 10);
        if (n >= 1 && n <= max) { counts[n - 1]++; sum += n; answered++; }
      });
      const avg = answered ? (sum / answered).toFixed(1) : '-';
      const rows = counts.map((n, i) => ({ label: `${i + 1}점`, n }));
      // 순서형 램프: 10단계는 5색 램프를 2칸씩 사용해 명도 단조 유지
      const ramp = rows.map((_, i) => RATING_RAMP[Math.min(4, Math.floor((i * 5) / max))]);
      html += `<section class="stat-q">
        <h3>${esc(q.label)} <span class="stat-sub">평균 ${avg} · 응답 ${answered}건</span></h3>
        ${barChart(rows, answered, { ramp })}
      </section>`;
    }
  }
  box.innerHTML = html;
  bindStatsControls();
}

function toggleStatsView() {
  statsTable = !statsTable;
  renderStats();
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
