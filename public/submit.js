// 제출 페이지 로직
const slug = location.pathname.split('/').pop();
const attachments = []; // { id, filename, kind, size, previewUrl }
const MAX_ATTACHMENTS = 10;

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

  $('c-title').textContent = campaign.title;
  $('c-desc').textContent = campaign.description || '';
  $('f-name').value = me.name;
  $('f-dept').value = me.department || '';
  $('form-box').classList.remove('hidden');

  bindAttachHandlers();
  bindRecorder();
  $('form').addEventListener('submit', onSubmit);
  loadMine();
}

// ---------- 첨부 공통 ----------

function canAddMore(n = 1) {
  if (attachments.length + n > MAX_ATTACHMENTS) {
    toast(`첨부는 최대 ${MAX_ATTACHMENTS}개까지 가능합니다`, true);
    return false;
  }
  return true;
}

function renderAttachments() {
  const ul = $('attach-list');
  ul.innerHTML = '';
  for (const a of attachments) {
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
}

// XHR 업로드 (진행률 표시)
function uploadBlob(blob, filename, kind) {
  return new Promise((resolve, reject) => {
    const ul = $('attach-list');
    const li = document.createElement('li');
    li.innerHTML = `<span>⬆️</span><span class="fname">${esc(filename)}</span><div class="progress"><div></div></div>`;
    ul.appendChild(li);
    const bar = li.querySelector('.progress > div');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?kind=${kind}&filename=${encodeURIComponent(filename)}`);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) bar.style.width = Math.round((e.loaded / e.total) * 100) + '%';
    };
    xhr.onload = () => {
      li.remove();
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        const a = { ...data, previewUrl: kind === 'image' ? URL.createObjectURL(blob) : null };
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

// ---------- 첨부 버튼들 ----------

function bindAttachHandlers() {
  // 화면 캡쳐
  $('btn-capture').onclick = async () => {
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
      await uploadBlob(blob, `캡쳐_${ts()}.png`, 'image');
      toast('화면 캡쳐가 첨부되었습니다');
    } catch {
      toast('캡쳐에 실패했습니다', true);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  };

  // 클립보드 스크린샷 붙여넣기
  document.addEventListener('paste', async (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find((it) => it.type.startsWith('image/'));
    if (!img || !canAddMore()) return;
    const file = img.getAsFile();
    if (file) {
      await uploadBlob(file, `붙여넣기_${ts()}.png`, 'image');
      toast('클립보드 이미지가 첨부되었습니다');
    }
  });

  // 파일 업로드
  $('btn-file').onclick = () => $('file-input').click();
  $('file-input').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!canAddMore(files.length)) return;
    for (const f of files) {
      const kind = kindOf(f);
      if (kind === 'video') {
        const dur = await videoDuration(f);
        if (dur && dur > 61) {
          toast(`"${f.name}"은 1분을 초과하는 동영상이라 첨부할 수 없습니다`, true);
          continue;
        }
      }
      await uploadBlob(f, f.name, kind).catch(() => {});
    }
  };

  // 앱 파일 업로드
  $('btn-appfile').onclick = () => $('appfile-input').click();
  $('appfile-input').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !canAddMore()) return;
    await uploadBlob(f, f.name, 'app').catch(() => {});
  };
}

// ---------- 동영상 촬영 ----------

let recStream = null;
let recorder = null;
let recChunks = [];
let recTimer = null;
let recBlob = null;

function bindRecorder() {
  $('btn-record').onclick = () => {
    if (!canAddMore()) return;
    if (!window.MediaRecorder) {
      toast('이 브라우저는 동영상 녹화를 지원하지 않습니다. 파일 업로드를 이용해 주세요.', true);
      return;
    }
    recReset();
    $('rec-modal').classList.remove('hidden');
  };
  $('rec-cam').onclick = () => startRecording('camera');
  $('rec-screen').onclick = () => startRecording('screen');
  $('rec-stop').onclick = stopRecording;
  $('rec-retry').onclick = recReset;
  $('rec-close1').onclick = recClose;
  $('rec-close2').onclick = recClose;
  $('rec-attach').onclick = async () => {
    if (!recBlob) return;
    const ext = recBlob.type.includes('mp4') ? 'mp4' : 'webm';
    recClose();
    await uploadBlob(recBlob, `녹화_${ts()}.${ext}`, 'video').catch(() => {});
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
  recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
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
    $('rec-timer').textContent = '';
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
  const btn = $('btn-submit');
  btn.disabled = true;
  btn.textContent = '제출 중…';
  try {
    await api(`/api/campaigns/${encodeURIComponent(slug)}/submissions`, {
      method: 'POST',
      body: JSON.stringify({
        title: $('f-title').value,
        content: $('f-content').value,
        app_url: $('f-appurl').value,
        attachment_ids: attachments.map((a) => a.id),
      }),
    });
    toast('제출이 완료되었습니다. 감사합니다! 🎉');
    $('f-title').value = '';
    $('f-content').value = '';
    $('f-appurl').value = '';
    attachments.length = 0;
    renderAttachments();
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
