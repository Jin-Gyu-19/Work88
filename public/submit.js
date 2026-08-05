// 제출 페이지 로직
const slug = location.pathname.split('/').pop();
const attachments = []; // { id, filename, kind, size, previewUrl, qid }
const MAX_ATTACHMENTS = 10;
let FORM = null; // 캠페인 설문 양식 { questions, oneSubmission }
let activeQid = null; // 지금 첨부 대상인 질문 id ('app'이면 앱 파일)
let editingId = null; // 수정 중인 제출 id
let myList = []; // 내 제출 내역
let uploading = 0; // 진행 중인 업로드 수

const $ = (id) => document.getElementById(id);

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

  let campaign;
  try {
    campaign = await api(`/api/campaigns/${encodeURIComponent(slug)}`);
  } catch {
    $('notfound-box').classList.remove('hidden');
    return;
  }
  if (!campaign.is_open) {
    $('closed-title').textContent = campaign.title;
    $('closed-box').classList.remove('hidden');
    return;
  }

  FORM = campaign.form;
  if (FORM.bg) {
    document.body.classList.add('has-bg');
    document.body.style.setProperty('--bg-image', `url(/files/${FORM.bg.id})`);
  }
  $('c-title').textContent = campaign.title;
  $('c-desc').textContent = campaign.description || '';
  if (campaign.closes_at) $('c-deadline').textContent = `⏰ 마감일: ${campaign.closes_at} (당일까지 제출 가능)`;
  $('f-name').value = me.name;
  $('f-dept').value = me.department || '';
  $('f-name-text').textContent = me.name;
  $('f-dept-text').textContent = me.department || '부서 미지정';
  $('f-initial').textContent = (me.name || '?').trim().slice(0, 1);
  renderQuestions();
  $('form-box').classList.remove('hidden');

  bindGlobalAttachHandlers();
  bindRecorder();
  bindCropper();
  $('form').addEventListener('submit', onSubmit);
  $('btn-cancel-edit').onclick = cancelEdit;
  $('btn-draft').onclick = saveDraft;
  const closeView = () => $('view-modal').classList.add('hidden');
  $('v-close').onclick = closeView;
  $('v-close-x').onclick = closeView;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('view-modal').classList.contains('hidden')) closeView();
  });
  await loadMine();
  applyOneSubmissionState();
  await loadDraft();
}

// 1인 1회 설문에서 이미 제출했으면 폼 대신 안내를 보여줌
function applyOneSubmissionState() {
  const already = FORM.oneSubmission && myList.length > 0 && !editingId;
  $('form').classList.toggle('hidden', already);
  $('already-box').classList.toggle('hidden', !already);
  if (already) {
    $('already-desc').textContent = FORM.noEdit
      ? '1인 1회만 제출할 수 있으며, 이 설문은 제출 후 수정할 수 없습니다. 아래에서 제출 내용을 확인하세요.'
      : '1인 1회만 제출할 수 있습니다. 아래에서 수정·삭제하세요.';
  }
}

// ---------- 설문 질문 렌더링 ----------

function renderQuestions() {
  const box = $('questions');
  box.innerHTML = FORM.questions.map((q) => {
    const req = q.required ? ' <span class="req-chip">필수</span>' : '';
    const num = '<span class="q-num"></span>';
    const help = q.help ? `<span class="q-help-text">${esc(q.help)}</span>` : '';
    const helpP = q.help ? `<p class="hint" style="margin-top:0;">${esc(q.help)}</p>` : '';
    // 관리자가 질문에 첨부한 자료 (이미지는 지정 너비로 표시)
    const media = (q.media || []).length ? `<div class="q-media">${
      q.media.map((m) => {
        if (m.kind !== 'image') return `<a class="q-media-file" href="/files/${m.id}?download=1">📎 ${esc(m.filename)} 내려받기</a>`;
        const al = m.align === 'right' ? 'margin-left:auto;' : m.align === 'left' ? '' : 'margin-left:auto;margin-right:auto;';
        return `<img src="/files/${m.id}" style="width:${m.w || 60}%;${al}" alt="${esc(m.filename)}">`;
      }).join('')
    }</div>` : '';
    let inner;
    if (q.type === 'textarea') {
      inner = `<label>${num}${esc(q.label)}${req}${help}${media}<textarea data-q="${q.id}" rows="7"></textarea></label>`;
    } else if (q.type === 'select') {
      inner = `<fieldset class="q-choice"><legend>${num}${esc(q.label)}${req}</legend>${helpP}${media}${
        q.options.map((o) => `<label class="choice"><input type="radio" name="${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }</fieldset>`;
    } else if (q.type === 'checkbox') {
      inner = `<fieldset class="q-choice"><legend>${num}${esc(q.label)}${req} <span class="muted">(복수 선택)</span></legend>${helpP}${media}${
        q.options.map((o) => `<label class="choice"><input type="checkbox" name="${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }</fieldset>`;
    } else if (q.type === 'rating') {
      inner = `<fieldset class="q-choice"><legend>${num}${esc(q.label)}${req}</legend>${helpP}${media}
        <div class="stars" data-q="${q.id}" data-v="">${
          [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-v="${n}">★</button>`).join('')
        }<span class="stars-value muted"></span></div>
      </fieldset>`;
    } else {
      inner = `<label>${num}${esc(q.label)}${req}${help}${media}<input data-q="${q.id}" maxlength="500"></label>`;
    }
    const attach = q.allowAttach ? `
      <div class="attach-block" data-attq="${q.id}">
        <div class="attach-buttons">
          <button type="button" class="small att-file">📎 파일</button>
          <button type="button" class="small att-capture">🖥️ 캡쳐</button>
          <button type="button" class="small att-record">🎥 촬영</button>
        </div>
        <p class="hint">여기로 끌어다 놓기 · Ctrl+V 붙여넣기 · 동영상 1분/80MB</p>
        <ul class="attach-list" data-attlist="${q.id}"></ul>
      </div>` : '';
    return `<div class="q-item" data-qid="${q.id}">${inner}${attach}</div>`;
  }).join('');

  // 질문별 첨부 버튼 연결 + 드래그앤드롭
  box.querySelectorAll('.attach-block').forEach((blk) => {
    const qid = blk.dataset.attq;
    blk.querySelector('.att-capture').onclick = () => captureScreen(qid);
    blk.querySelector('.att-record').onclick = () => openRecorder(qid);
    blk.querySelector('.att-file').onclick = () => {
      activeQid = qid;
      $('file-input').click();
    };
    ['dragenter', 'dragover'].forEach((ev) => blk.addEventListener(ev, (e) => {
      e.preventDefault();
      blk.classList.add('drag-over');
    }));
    blk.addEventListener('dragleave', (e) => {
      if (!blk.contains(e.relatedTarget)) blk.classList.remove('drag-over');
    });
    blk.addEventListener('drop', async (e) => {
      e.preventDefault();
      blk.classList.remove('drag-over');
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) await handleFiles(files, qid);
    });
  });

  // 별점 클릭
  box.querySelectorAll('.stars').forEach((st) => {
    st.querySelectorAll('.star').forEach((btn) => {
      btn.onclick = () => setStars(st, btn.dataset.v);
    });
  });
  // 답변 변경 시 분기 표시/현재 문항 강조 갱신
  box.oninput = onFormChanged;
  box.onchange = onFormChanged;
  renderAttachments();
  onFormChanged();
}

function setStars(container, value) {
  container.dataset.v = String(value);
  container.querySelectorAll('.star').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.v) <= Number(value));
  });
  const label = container.querySelector('.stars-value');
  if (label) label.textContent = value ? `${value}점` : '';
  onFormChanged();
}

// 모든 질문의 현재 입력값 읽기 (분기 판단용, 표시 여부 무관)
function gatherAnswersRaw() {
  const answers = {};
  for (const q of FORM.questions) {
    if (q.type === 'select') {
      const el = document.querySelector(`input[name="${q.id}"]:checked`);
      if (el) answers[q.id] = el.value;
    } else if (q.type === 'checkbox') {
      const els = [...document.querySelectorAll(`input[name="${q.id}"]:checked`)];
      if (els.length) answers[q.id] = els.map((e) => e.value);
    } else if (q.type === 'rating') {
      const st = document.querySelector(`.stars[data-q="${q.id}"]`);
      if (st && st.dataset.v) answers[q.id] = st.dataset.v;
    } else {
      const el = document.querySelector(`[data-q="${q.id}"]`);
      if (el && el.value.trim()) answers[q.id] = el.value.trim();
    }
  }
  return answers;
}

// 분기(표시 조건) 계산
function computeVis(raw) {
  const vis = {};
  for (const q of FORM.questions) {
    if (!q.showIf) {
      vis[q.id] = true;
    } else {
      const pv = raw[q.showIf.qid];
      const match = Array.isArray(pv) ? pv.includes(q.showIf.value) : pv === q.showIf.value;
      vis[q.id] = !!(vis[q.showIf.qid] && match);
    }
  }
  return vis;
}

// 화면에 보이는 질문의 답변만 수집
function gatherAnswers() {
  const raw = gatherAnswersRaw();
  const vis = computeVis(raw);
  const out = {};
  for (const q of FORM.questions) {
    if (vis[q.id] && raw[q.id] !== undefined) out[q.id] = raw[q.id];
  }
  return out;
}

function validateAnswers(answers) {
  const vis = computeVis(gatherAnswersRaw());
  for (const q of FORM.questions) {
    if (!vis[q.id] || !q.required) continue;
    const v = answers[q.id];
    if (v === undefined || (Array.isArray(v) && !v.length)) {
      toast(`"${q.label}" 항목을 ${['select', 'checkbox', 'rating'].includes(q.type) ? '선택' : '입력'}해 주세요`, true);
      return false;
    }
  }
  return true;
}

// 분기 표시/숨김 + 현재 작성할 문항 강조
function onFormChanged() {
  if (!FORM) return;
  const raw = gatherAnswersRaw();
  const vis = computeVis(raw);
  let currentId = null;
  for (const q of FORM.questions) {
    const el = document.querySelector(`.q-item[data-qid="${q.id}"]`);
    if (el) el.classList.toggle('hidden', !vis[q.id]);
    if (!currentId && vis[q.id]) {
      const v = raw[q.id];
      if (v === undefined || (Array.isArray(v) && !v.length)) currentId = q.id;
    }
  }
  document.querySelectorAll('.q-item').forEach((el) => {
    el.classList.toggle('q-current', el.dataset.qid === currentId);
  });

  // 진행률
  const shown = FORM.questions.filter((q) => vis[q.id]);
  const done = shown.filter((q) => {
    const v = raw[q.id];
    return v !== undefined && !(Array.isArray(v) && !v.length);
  }).length;
  const pct = shown.length ? Math.round((done / shown.length) * 100) : 0;
  const fill = $('prog-fill');
  const text = $('prog-text');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('done', done === shown.length && shown.length > 0);
    text.textContent = done === shown.length && shown.length
      ? `모든 문항 작성 완료 (${shown.length}/${shown.length})`
      : `${done} / ${shown.length} 문항 작성`;
  }
}

// ---------- 첨부 공통 ----------

function canAddMore(n = 1) {
  if (attachments.length + n > MAX_ATTACHMENTS) {
    toast(`첨부는 전체 합쳐 최대 ${MAX_ATTACHMENTS}개까지 가능합니다`, true);
    return false;
  }
  return true;
}

function listFor(qid) {
  return document.querySelector(`[data-attlist="${qid}"]`)
    || document.querySelector('[data-attlist]'); // 대상 질문이 없으면 첫 첨부 목록에 표시
}

function renderAttachments() {
  document.querySelectorAll('[data-attlist]').forEach((ul) => {
    const qid = ul.dataset.attlist;
    ul.innerHTML = '';
    for (const a of attachments.filter((x) => x.qid === qid)) {
      const li = document.createElement('li');
      let thumb = '📄';
      if (a.kind === 'image' && a.previewUrl) thumb = `<img class="thumb" src="${a.previewUrl}" alt="">`;
      else if (a.kind === 'video') thumb = '🎬';
      else if (a.kind === 'app') thumb = '📦';
      li.innerHTML = `
        <span>${thumb}</span>
        <span class="fname">${esc(a.filename)} <span class="muted">(${fmtSize(a.size)})</span></span>
        <button type="button" class="small ghost">✕ 삭제</button>`;
      li.querySelector('button').onclick = async () => {
        try {
          await api(`/api/attachments/${a.id}`, { method: 'DELETE' });
        } catch { /* 이미 지워졌으면 무시 */ }
        attachments.splice(attachments.indexOf(a), 1);
        renderAttachments();
      };
      ul.appendChild(li);
    }
  });
}

// XHR 업로드 (진행률 % 표시)
function uploadBlob(blob, filename, kind, qid) {
  return new Promise((resolve, reject) => {
    const ul = listFor(qid);
    const li = document.createElement('li');
    li.innerHTML = `<span>⬆️</span><span class="fname">${esc(filename)} <span class="muted">(${fmtSize(blob.size)})</span></span>
      <div class="progress"><div></div></div><span class="pct muted" style="min-width:38px; text-align:right;">0%</span>`;
    if (ul) ul.appendChild(li);
    const bar = li.querySelector('.progress > div');
    const pct = li.querySelector('.pct');

    uploading++;
    const done = () => { uploading = Math.max(0, uploading - 1); };
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?kind=${kind}&filename=${encodeURIComponent(filename)}`);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const p = Math.round((e.loaded / e.total) * 100);
        bar.style.width = p + '%';
        pct.textContent = p + '%';
      }
    };
    xhr.onload = () => {
      done();
      li.remove();
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        const a = { ...data, qid, previewUrl: kind === 'image' ? URL.createObjectURL(blob) : null };
        attachments.push(a);
        renderAttachments();
        resolve(a);
      } else {
        toast(data.error || '업로드에 실패했습니다', true);
        reject(new Error(data.error || 'upload failed'));
      }
    };
    xhr.onerror = () => {
      done();
      li.remove();
      toast('업로드 중 오류가 발생했습니다', true);
      reject(new Error('network error'));
    };
    xhr.send(blob);
  });
}

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function videoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(v.src); resolve(d); };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}

function kindOf(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

// ---------- 화면 캡쳐 ----------

let cropCanvas = null; // 캡쳐된 전체 화면
let cropQid = null;
let cropRect = null;   // 선택 영역 (원본 픽셀 기준)

async function captureScreen(qid) {
  if (!canAddMore()) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast('이 브라우저는 화면 캡쳐를 지원하지 않습니다. 스크린샷을 찍어 붙여넣기(Ctrl+V) 해주세요.', true);
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch {
    return; // 사용자가 취소
  }
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 400));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    cropCanvas = canvas;
    cropQid = qid;
    openCropper();
  } catch {
    toast('캡쳐에 실패했습니다', true);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// ---------- 캡쳐 영역 선택 ----------

function openCropper() {
  cropRect = null;
  $('crop-img').src = cropCanvas.toDataURL('image/png');
  $('crop-sel').classList.add('hidden');
  $('crop-ok').disabled = true;
  $('crop-info').textContent = `원본 ${cropCanvas.width} × ${cropCanvas.height}`;
  $('crop-modal').classList.remove('hidden');
}

function closeCropper() {
  $('crop-modal').classList.add('hidden');
  $('crop-img').src = '';
  cropCanvas = null;
  cropRect = null;
}

function bindCropper() {
  const stage = $('crop-stage');
  const img = $('crop-img');
  const sel = $('crop-sel');
  let startX = 0;
  let startY = 0;
  let dragging = false;

  const pos = (e) => {
    const r = img.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - r.left, 0), r.width),
      y: Math.min(Math.max(e.clientY - r.top, 0), r.height),
      r,
    };
  };

  stage.addEventListener('mousedown', (e) => {
    if (e.target !== img && e.target !== sel) return;
    e.preventDefault();
    const p = pos(e);
    dragging = true;
    startX = p.x;
    startY = p.y;
    sel.classList.remove('hidden');
    sel.style.cssText = `left:${startX}px; top:${startY}px; width:0; height:0;`;
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const p = pos(e);
    const x = Math.min(startX, p.x);
    const y = Math.min(startY, p.y);
    const w = Math.abs(p.x - startX);
    const h = Math.abs(p.y - startY);
    sel.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px;`;
    // 화면 좌표 → 원본 픽셀 좌표
    const scale = cropCanvas.width / p.r.width;
    cropRect = { x: x * scale, y: y * scale, w: w * scale, h: h * scale };
    $('crop-ok').disabled = w < 5 || h < 5;
    $('crop-info').textContent = `선택 ${Math.round(cropRect.w)} × ${Math.round(cropRect.h)} (원본 ${cropCanvas.width} × ${cropCanvas.height})`;
  });

  document.addEventListener('mouseup', () => { dragging = false; });

  $('crop-cancel').onclick = closeCropper;
  $('crop-all').onclick = () => attachCapture(false);
  $('crop-ok').onclick = () => attachCapture(true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('crop-modal').classList.contains('hidden')) closeCropper();
  });
}

async function attachCapture(useSelection) {
  if (!cropCanvas) return;
  let canvas = cropCanvas;
  if (useSelection && cropRect && cropRect.w > 4 && cropRect.h > 4) {
    const c = document.createElement('canvas');
    c.width = Math.round(cropRect.w);
    c.height = Math.round(cropRect.h);
    c.getContext('2d').drawImage(
      cropCanvas,
      Math.round(cropRect.x), Math.round(cropRect.y), c.width, c.height,
      0, 0, c.width, c.height,
    );
    canvas = c;
  }
  const qid = cropQid;
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  closeCropper();
  await uploadBlob(blob, `캡쳐_${ts()}.png`, 'image', qid).catch(() => {});
  toast('화면 캡쳐가 첨부되었습니다');
}

// ---------- 전역 첨부 핸들러 (파일 선택 / 붙여넣기 / 앱 파일) ----------

// 파일 목록 업로드 (파일 선택·드래그앤드롭 공용)
async function handleFiles(files, qid) {
  if (!qid || !canAddMore(files.length)) return;
  for (const f of files) {
    const kind = kindOf(f);
    if (kind === 'video') {
      const dur = await videoDuration(f);
      if (dur && dur > 61) {
        toast(`"${f.name}"은 1분을 초과하는 동영상이라 첨부할 수 없습니다`, true);
        continue;
      }
    }
    await uploadBlob(f, f.name, kind, qid).catch(() => {});
  }
}

function bindGlobalAttachHandlers() {
  $('file-input').onchange = async (e) => {
    const files = [...e.target.files];
    const qid = activeQid;
    e.target.value = '';
    await handleFiles(files, qid);
  };

  // 클립보드 스크린샷 붙여넣기 → 첫 번째 첨부 허용 질문에 추가
  document.addEventListener('paste', async (e) => {
    if (!FORM) return;
    const firstQ = FORM.questions.find((q) => q.allowAttach);
    if (!firstQ) return;
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find((it) => it.type.startsWith('image/'));
    if (!img || !canAddMore()) return;
    const file = img.getAsFile();
    if (file) {
      await uploadBlob(file, `붙여넣기_${ts()}.png`, 'image', firstQ.id);
      toast(`"${firstQ.label}" 질문에 클립보드 이미지가 첨부되었습니다`);
    }
  });
}

// ---------- 동영상 촬영 ----------

let recStream = null;
let recorder = null;
let recChunks = [];
let recTimer = null;
let recBlob = null;
let recQid = null;

function openRecorder(qid) {
  if (!canAddMore()) return;
  if (!window.MediaRecorder) {
    toast('이 브라우저는 동영상 녹화를 지원하지 않습니다. 파일 업로드를 이용해 주세요.', true);
    return;
  }
  recQid = qid;
  recReset();
  $('rec-modal').classList.remove('hidden');
}

function bindRecorder() {
  $('rec-cam').onclick = () => startRecording('camera');
  $('rec-screen').onclick = () => startRecording('screen');
  $('rec-stop').onclick = stopRecording;
  $('rec-retry').onclick = recReset;
  $('rec-close1').onclick = recClose;
  $('rec-close2').onclick = recClose;
  $('rec-attach').onclick = async () => {
    if (!recBlob) return;
    // recClose()가 recBlob을 초기화하므로 반드시 먼저 복사해 둔다
    const blob = recBlob;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const qid = recQid;
    recClose();
    toast(`동영상 업로드 중… (${fmtSize(blob.size)}) 첨부 목록에서 진행률을 확인하세요`);
    const target = document.querySelector(`[data-attlist="${qid}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await uploadBlob(blob, `녹화_${ts()}.${ext}`, 'video', qid)
      .then(() => toast('동영상 첨부가 완료되었습니다 🎬'))
      .catch(() => {});
  };
}

function pickMime() {
  const candidates = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

async function startRecording(source) {
  try {
    recStream = source === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      : await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
  } catch {
    toast(source === 'screen' ? '화면 녹화 권한이 거부되었습니다' : '카메라 권한이 거부되었습니다', true);
    return;
  }
  $('rec-preview').classList.remove('hidden');
  $('rec-playback').classList.add('hidden');
  $('rec-preview').srcObject = recStream;
  $('rec-actions-start').classList.add('hidden');
  $('rec-actions-recording').classList.remove('hidden');

  recChunks = [];
  const mime = pickMime();
  // 비트레이트를 제한해 1분 녹화가 20MB 안팎이 되도록 (업로드 속도 개선)
  recorder = new MediaRecorder(recStream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });
  recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    recBlob = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' });
    recStream?.getTracks().forEach((t) => t.stop());
    recStream = null;
    $('rec-preview').classList.add('hidden');
    const pb = $('rec-playback');
    pb.src = URL.createObjectURL(recBlob);
    pb.classList.remove('hidden');
    $('rec-actions-recording').classList.add('hidden');
    $('rec-actions-done').classList.remove('hidden');
    $('rec-timer').textContent = `녹화 완료 (${fmtSize(recBlob.size)})`;
  };
  recorder.start();

  // 공유 중지 버튼으로 화면공유를 끊은 경우도 처리
  recStream.getVideoTracks()[0].onended = () => {
    if (recorder?.state === 'recording') stopRecording();
  };

  let seconds = 0;
  $('rec-timer').innerHTML = '<span class="rec-dot"></span>60초 남음';
  recTimer = setInterval(() => {
    seconds++;
    $('rec-timer').innerHTML = `<span class="rec-dot"></span>${60 - seconds}초 남음`;
    if (seconds >= 60) stopRecording();
  }, 1000);
}

function stopRecording() {
  clearInterval(recTimer);
  if (recorder?.state === 'recording') recorder.stop();
}

function recReset() {
  clearInterval(recTimer);
  if (recorder?.state === 'recording') recorder.stop();
  recStream?.getTracks().forEach((t) => t.stop());
  recStream = null;
  recorder = null;
  recBlob = null;
  $('rec-timer').textContent = '';
  $('rec-preview').classList.remove('hidden');
  $('rec-preview').srcObject = null;
  $('rec-playback').classList.add('hidden');
  $('rec-actions-start').classList.remove('hidden');
  $('rec-actions-recording').classList.add('hidden');
  $('rec-actions-done').classList.add('hidden');
}

function recClose() {
  recReset();
  $('rec-modal').classList.add('hidden');
}

// ---------- 제출 ----------

async function onSubmit(e) {
  e.preventDefault();
  if (uploading > 0) {
    toast('파일 업로드가 진행 중입니다. 완료된 뒤 제출해 주세요', true);
    return;
  }
  const answers = gatherAnswers();
  if (!validateAnswers(answers)) return;
  const btn = $('btn-submit');
  btn.disabled = true;
  btn.textContent = editingId ? '수정 중…' : '제출 중…';
  try {
    const body = JSON.stringify({
      answers,
      attachments: attachments.map((a) => ({ id: a.id, qid: a.qid })),
    });
    if (editingId) {
      await api(`/api/submissions/${editingId}`, { method: 'PUT', body });
      toast('수정이 완료되었습니다 ✏️');
    } else {
      await api(`/api/campaigns/${encodeURIComponent(slug)}/submissions`, { method: 'POST', body });
      toast('제출이 완료되었습니다. 감사합니다! 🎉');
    }
    editingId = null;
    attachments.length = 0;
    renderQuestions();
    setEditUi(false);
    await loadMine();
    applyOneSubmissionState();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? '수정 완료' : '제출하기';
  }
}

function setEditUi(on) {
  $('btn-submit').textContent = on ? '수정 완료' : '제출하기';
  $('btn-cancel-edit').classList.toggle('hidden', !on);
  $('btn-draft').classList.toggle('hidden', on); // 수정 모드에서는 임시저장 숨김
}

// 저장된 답변을 폼에 복원 (수정 모드/임시저장 공용)
function restoreAnswers(answers) {
  for (const q of FORM.questions) {
    const v = answers[q.id];
    if (v === undefined) continue;
    if (q.type === 'select') {
      const el = document.querySelector(`input[name="${q.id}"][value="${CSS.escape(String(v))}"]`);
      if (el) el.checked = true;
    } else if (q.type === 'checkbox') {
      (Array.isArray(v) ? v : [v]).forEach((o) => {
        const el = document.querySelector(`input[name="${q.id}"][value="${CSS.escape(String(o))}"]`);
        if (el) el.checked = true;
      });
    } else if (q.type === 'rating') {
      const st = document.querySelector(`.stars[data-q="${q.id}"]`);
      if (st) setStars(st, String(v));
    } else {
      const el = document.querySelector(`[data-q="${q.id}"]`);
      if (el) el.value = Array.isArray(v) ? v.join(', ') : v;
    }
  }
  onFormChanged();
}

function restoreAttachmentList(list) {
  attachments.length = 0;
  const fallbackQid = FORM.questions.find((q) => q.allowAttach)?.id || null;
  for (const a of list || []) {
    const rawQid = a.qid !== undefined ? a.qid : a.question_id;
    const validQid = FORM.questions.some((q) => q.id === rawQid && q.allowAttach) ? rawQid : fallbackQid;
    attachments.push({
      id: a.id,
      filename: a.filename,
      kind: a.kind,
      size: a.size,
      qid: validQid,
      previewUrl: a.kind === 'image' ? `/files/${a.id}` : null,
    });
  }
  renderAttachments();
}

function startEdit(s) {
  editingId = s.id;
  applyOneSubmissionState();
  setEditUi(true);

  let answers = {};
  try { answers = s.answers ? JSON.parse(s.answers) : {}; } catch {}
  renderQuestions();
  restoreAnswers(answers);
  restoreAttachmentList(s.attachments);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('수정 모드입니다. 내용을 고치고 "수정 완료"를 눌러 주세요');
}

// ---------- 임시저장 ----------

async function saveDraft() {
  if (uploading > 0) {
    toast('파일 업로드가 진행 중입니다. 완료된 뒤 저장해 주세요', true);
    return;
  }
  const btn = $('btn-draft');
  btn.disabled = true;
  try {
    await api(`/api/campaigns/${encodeURIComponent(slug)}/draft`, {
      method: 'PUT',
      body: JSON.stringify({
        answers: gatherAnswers(),
        attachments: attachments.map((a) => ({ id: a.id, qid: a.qid })),
      }),
    });
    toast('임시저장 되었습니다 💾 다음에 접속하면 이어서 작성할 수 있어요');
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function loadDraft() {
  if (editingId) return;
  if (FORM.oneSubmission && myList.length > 0) return; // 이미 제출한 1인1회 설문은 복원 불필요
  try {
    const d = await api(`/api/campaigns/${encodeURIComponent(slug)}/draft`);
    if (!d.exists) return;
    restoreAnswers(d.answers || {});
    restoreAttachmentList(d.attachments);
    toast(`임시저장본을 불러왔습니다 (${kst(d.updated_at)} 저장)`);
  } catch { /* 무시 */ }
}

function cancelEdit() {
  editingId = null;
  attachments.length = 0;
  renderQuestions();
  setEditUi(false);
  applyOneSubmissionState();
}

async function loadMine() {
  try {
    myList = await api(`/api/campaigns/${encodeURIComponent(slug)}/my-submissions`);
  } catch {
    return;
  }
  const box = $('mine');
  if (!myList.length) {
    box.classList.add('muted');
    box.innerHTML = '<div class="empty"><span class="icon">✍️</span>아직 제출한 내역이 없습니다.</div>';
    return;
  }
  box.classList.remove('muted');
  box.innerHTML = myList.map((s) => `
    <div class="campaign-item">
      <div>
        <strong>${esc(s.title)}</strong>
        <div class="muted">${kst(s.created_at)} · 첨부 ${s.attachments.length}개</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="small" data-view="${s.id}">👁 보기</button>
        ${FORM.noEdit ? '' : `
        <button class="small" data-edit="${s.id}">✏️ 수정</button>
        <button class="small ghost" data-id="${s.id}">삭제</button>`}
      </div>
    </div>`).join('');
  if (FORM.noEdit) {
    box.insertAdjacentHTML('beforeend', '<p class="hint">이 설문은 제출 후 수정·삭제가 제한되어 있습니다. 제출한 내용은 언제든 볼 수 있어요.</p>');
  }
  box.querySelectorAll('button[data-view]').forEach((b) => {
    b.onclick = () => {
      const s = myList.find((x) => String(x.id) === b.dataset.view);
      if (s) openView(s);
    };
  });
  box.querySelectorAll('button[data-edit]').forEach((b) => {
    b.onclick = () => {
      const s = myList.find((x) => String(x.id) === b.dataset.edit);
      if (s) startEdit(s);
    };
  });
  box.querySelectorAll('button[data-id]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 제출을 삭제할까요? 첨부파일도 함께 삭제됩니다.')) return;
      try {
        await api(`/api/submissions/${b.dataset.id}`, { method: 'DELETE' });
        toast('삭제되었습니다');
        if (String(editingId) === b.dataset.id) cancelEdit();
        await loadMine();
        applyOneSubmissionState();
      } catch (err) {
        toast(err.message, true);
      }
    };
  });
}

// ---------- 내 제출 보기 (읽기 전용) ----------

function openView(s) {
  $('v-meta').textContent = `${kst(s.created_at)} 제출 · ${s.user_name}${s.user_department ? ` (${s.user_department})` : ''}`;
  let answers = {};
  try { answers = s.answers ? JSON.parse(s.answers) : {}; } catch {}
  const atts = s.attachments || [];
  const qIds = new Set(FORM.questions.map((q) => q.id));
  const attHtml = (list) => (list.length ? `<div class="att-preview">${
    list.map((a) => (a.kind === 'image'
      ? `<a href="/files/${a.id}" target="_blank" title="${esc(a.filename)}"><img src="/files/${a.id}" alt="${esc(a.filename)}"></a>`
      : `<a href="/files/${a.id}" target="_blank">📎 ${esc(a.filename)}</a>`)).join('')
  }</div>` : '');

  const parts = FORM.questions.map((q) => {
    const v = answers[q.id];
    const qa = atts.filter((a) => a.question_id === q.id);
    const empty = v === undefined || v === '' || (Array.isArray(v) && !v.length);
    if (empty && !qa.length) return '';
    let val;
    if (q.type === 'rating' && !empty) val = `${'★'.repeat(Number(v) || 0)} (${v}점)`;
    else val = Array.isArray(v) ? v.join(', ') : (v ?? '');
    return `<div style="margin-bottom:15px;">
      <div style="font-weight:700; font-size:13.5px; margin-bottom:5px;">${esc(q.label)}</div>
      ${empty ? '' : `<div class="detail-content">${esc(String(val))}</div>`}
      ${attHtml(qa)}
    </div>`;
  });
  const etc = atts.filter((a) => !qIds.has(a.question_id));
  if (etc.length) {
    parts.push(`<div><div style="font-weight:700; font-size:13.5px; margin-bottom:5px;">기타 첨부</div>${attHtml(etc)}</div>`);
  }
  $('v-body').innerHTML = parts.join('') || '<p class="muted">표시할 내용이 없습니다.</p>';
  $('view-modal').classList.remove('hidden');
}
