// 제출 페이지 로직
const slug = location.pathname.split('/').pop();
const attachments = []; // { id, filename, kind, size, previewUrl, qid }
const MAX_ATTACHMENTS = 10;
let FORM = null; // 캠페인 설문 양식 { questions, showApp }
let activeQid = null; // 지금 첨부 대상인 질문 id ('app'이면 앱 파일)

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
  $('c-title').textContent = campaign.title;
  $('c-desc').textContent = campaign.description || '';
  $('f-name').value = me.name;
  $('f-dept').value = me.department || '';
  renderQuestions();
  if (!FORM.showApp) $('app-box').classList.add('hidden');
  $('form-box').classList.remove('hidden');

  bindGlobalAttachHandlers();
  bindRecorder();
  $('form').addEventListener('submit', onSubmit);
  loadMine();
}

// ---------- 설문 질문 렌더링 ----------

function renderQuestions() {
  const box = $('questions');
  box.innerHTML = FORM.questions.map((q) => {
    const req = q.required ? ' <span style="color:var(--danger)">*</span>' : '';
    let inner;
    if (q.type === 'textarea') {
      inner = `<label>${esc(q.label)}${req}<textarea data-q="${q.id}" rows="7"></textarea></label>`;
    } else if (q.type === 'select') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req}</legend>${
        q.options.map((o) => `<label class="choice"><input type="radio" name="${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }</fieldset>`;
    } else if (q.type === 'checkbox') {
      inner = `<fieldset class="q-choice"><legend>${esc(q.label)}${req} <span class="muted">(복수 선택 가능)</span></legend>${
        q.options.map((o) => `<label class="choice"><input type="checkbox" name="${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')
      }</fieldset>`;
    } else {
      inner = `<label>${esc(q.label)}${req}<input data-q="${q.id}" maxlength="500"></label>`;
    }
    const attach = q.allowAttach ? `
      <div class="attach-block" data-attq="${q.id}">
        <div class="attach-buttons">
          <button type="button" class="small att-capture">🖥️ 화면 캡쳐</button>
          <button type="button" class="small att-record">🎥 동영상 촬영</button>
          <button type="button" class="small att-file">📎 파일 업로드</button>
        </div>
        <p class="hint">이미지 10MB · 동영상 1분/80MB · 기타 25MB · 스크린샷 붙여넣기(Ctrl+V) 가능</p>
        <ul class="attach-list" data-attlist="${q.id}"></ul>
      </div>` : '';
    return `<div class="q-item">${inner}${attach}</div>`;
  }).join('');

  // 질문별 첨부 버튼 연결
  box.querySelectorAll('.attach-block').forEach((blk) => {
    const qid = blk.dataset.attq;
    blk.querySelector('.att-capture').onclick = () => captureScreen(qid);
    blk.querySelector('.att-record').onclick = () => openRecorder(qid);
    blk.querySelector('.att-file').onclick = () => {
      activeQid = qid;
      $('file-input').click();
    };
  });
  renderAttachments();
}

function gatherAnswers() {
  const answers = {};
  for (const q of FORM.questions) {
    if (q.type === 'select') {
      const el = document.querySelector(`input[name="${q.id}"]:checked`);
      if (el) answers[q.id] = el.value;
    } else if (q.type === 'checkbox') {
      const els = [...document.querySelectorAll(`input[name="${q.id}"]:checked`)];
      if (els.length) answers[q.id] = els.map((e) => e.value);
    } else {
      const el = document.querySelector(`[data-q="${q.id}"]`);
      if (el && el.value.trim()) answers[q.id] = el.value.trim();
    }
  }
  return answers;
}

function validateAnswers(answers) {
  for (const q of FORM.questions) {
    if (!q.required) continue;
    const v = answers[q.id];
    if (v === undefined || (Array.isArray(v) && !v.length)) {
      toast(`"${q.label}" 항목을 ${q.type === 'select' || q.type === 'checkbox' ? '선택' : '입력'}해 주세요`, true);
      return false;
    }
  }
  return true;
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
  return document.querySelector(`[data-attlist="${qid}"]`);
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
          await api(`/api/uploads/${a.id}`, { method: 'DELETE' });
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
    const ul = listFor(qid) || listFor('app');
    const li = document.createElement('li');
    li.innerHTML = `<span>⬆️</span><span class="fname">${esc(filename)} <span class="muted">(${fmtSize(blob.size)})</span></span>
      <div class="progress"><div></div></div><span class="pct muted" style="min-width:38px; text-align:right;">0%</span>`;
    if (ul) ul.appendChild(li);
    const bar = li.querySelector('.progress > div');
    const pct = li.querySelector('.pct');

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
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    await uploadBlob(blob, `캡쳐_${ts()}.png`, 'image', qid);
    toast('화면 캡쳐가 첨부되었습니다');
  } catch {
    toast('캡쳐에 실패했습니다', true);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// ---------- 전역 첨부 핸들러 (파일 선택 / 붙여넣기 / 앱 파일) ----------

function bindGlobalAttachHandlers() {
  $('file-input').onchange = async (e) => {
    const files = [...e.target.files];
    const qid = activeQid;
    e.target.value = '';
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

  // 앱 파일 업로드
  $('btn-appfile').onclick = () => {
    activeQid = 'app';
    $('appfile-input').click();
  };
  $('appfile-input').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !canAddMore()) return;
    await uploadBlob(f, f.name, 'app', 'app').catch(() => {});
  };
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
    const ext = recBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const qid = recQid;
    recClose();
    toast('동영상 업로드 중… 첨부 목록에서 진행률을 확인하세요');
    await uploadBlob(recBlob, `녹화_${ts()}.${ext}`, 'video', qid).catch(() => {});
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
  const answers = gatherAnswers();
  if (!validateAnswers(answers)) return;
  const btn = $('btn-submit');
  btn.disabled = true;
  btn.textContent = '제출 중…';
  try {
    await api(`/api/campaigns/${encodeURIComponent(slug)}/submissions`, {
      method: 'POST',
      body: JSON.stringify({
        answers,
        app_url: FORM.showApp ? $('f-appurl').value : '',
        attachments: attachments.map((a) => ({ id: a.id, qid: a.qid })),
      }),
    });
    toast('제출이 완료되었습니다. 감사합니다! 🎉');
    attachments.length = 0;
    renderQuestions();
    $('f-appurl').value = '';
    loadMine();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '제출하기';
  }
}

async function loadMine() {
  try {
    const list = await api(`/api/campaigns/${encodeURIComponent(slug)}/my-submissions`);
    const box = $('mine');
    if (!list.length) {
      box.textContent = '아직 제출한 사례가 없습니다.';
      return;
    }
    box.classList.remove('muted');
    box.innerHTML = list.map((s) => `
      <div class="campaign-item">
        <div>
          <strong>${esc(s.title)}</strong>
          <div class="muted">${kst(s.created_at)} · 첨부 ${s.attachments.length}개</div>
        </div>
        <button class="small ghost" data-id="${s.id}">삭제</button>
      </div>`).join('');
    box.querySelectorAll('button[data-id]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('이 제출을 삭제할까요? 첨부파일도 함께 삭제됩니다.')) return;
        try {
          await api(`/api/submissions/${b.dataset.id}`, { method: 'DELETE' });
          toast('삭제되었습니다');
          loadMine();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  } catch { /* 무시 */ }
}
