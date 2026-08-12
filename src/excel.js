import * as XLSX from 'xlsx';

// D1의 UTC datetime 문자열을 한국시간 표기로 변환
export function kstString(utc) {
  if (!utc) return '';
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

// 제출의 첨부파일을 문항별로 그룹화: { <문항id>: [...], app: [...], etc: [...] }
export function groupAtts(form, sub) {
  const g = { app: [], etc: [] };
  for (const q of form.questions) if (q.allowAttach) g[q.id] = [];
  for (const a of (sub.attachments || [])) {
    if (a.question_id && g[a.question_id] && a.question_id !== 'app' && a.question_id !== 'etc') {
      g[a.question_id].push(a);
    } else if (a.question_id === 'app' || a.kind === 'app') {
      g.app.push(a);
    } else {
      g.etc.push(a);
    }
  }
  return g;
}

// 제출 내역을 엑셀 워크북(ArrayBuffer)으로 생성.
// 문항 구성대로 열을 만들고, 첨부 허용 문항 뒤에는 해당 문항의 첨부 열이 붙는다.
// linkFor(attachment) 가 반환하는 URL/상대경로가 첨부 셀의 하이퍼링크로 들어간다.
// 각 submission에는 _answers (문항 id → 답변) 가 채워져 있어야 한다.
export function buildWorkbook(campaign, form, submissions, { linkFor }) {
  const questions = form.questions.filter((q) => q.type !== 'section'); // 구역은 답변 열이 없다
  const groups = submissions.map((s) => groupAtts(form, s));

  // 그룹별 최대 첨부 수 계산
  const maxOf = (key) => groups.reduce((m, g) => Math.max(m, (g[key] || []).length), 0);
  const qMax = {};
  for (const q of questions) if (q.allowAttach) qMax[q.id] = maxOf(q.id);
  const appMax = maxOf('app');
  const etcMax = maxOf('etc');
  // 앱 섹션은 폐지됐지만 과거 제출에 앱 URL/앱 파일이 있으면 열을 유지
  const showAppUrl = submissions.some((s) => s.app_url);

  // 헤더 구성 (열 인덱스 기록: 하이퍼링크용)
  const header = ['번호', '제출일시', '이름', '부서', '이메일'];
  const colOf = { q: {}, qAtt: {}, app: -1, appAtt: -1, etc: -1 };
  for (const q of questions) {
    colOf.q[q.id] = header.push(q.label) - 1;
    if (q.allowAttach && qMax[q.id]) {
      colOf.qAtt[q.id] = header.length;
      for (let i = 1; i <= qMax[q.id]; i++) header.push(`${q.label} 첨부${i}`);
    }
  }
  if (showAppUrl) colOf.app = header.push('앱 URL') - 1;
  if (appMax) {
    colOf.appAtt = header.length;
    for (let i = 1; i <= appMax; i++) header.push(`앱 파일${i}`);
  }
  if (etcMax) {
    colOf.etc = header.length;
    for (let i = 1; i <= etcMax; i++) header.push(`기타 첨부${i}`);
  }

  const aoa = [header];
  submissions.forEach((s, i) => {
    const ans = s._answers || {};
    const g = groups[i];
    const row = new Array(header.length).fill('');
    row[0] = i + 1;
    row[1] = kstString(s.created_at);
    row[2] = s.user_name || '';
    row[3] = s.user_department || '';
    row[4] = s.user_email;
    for (const q of questions) {
      const v = ans[q.id];
      row[colOf.q[q.id]] = Array.isArray(v) ? v.join(', ') : (v || '');
      if (q.allowAttach && qMax[q.id]) {
        (g[q.id] || []).forEach((a, j) => { row[colOf.qAtt[q.id] + j] = a.filename; });
      }
    }
    if (showAppUrl) row[colOf.app] = s.app_url || '';
    if (appMax) g.app.forEach((a, j) => { row[colOf.appAtt + j] = a.filename; });
    if (etcMax) g.etc.forEach((a, j) => { row[colOf.etc + j] = a.filename; });
    aoa.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 하이퍼링크 걸기
  const link = (r, c, target, tip) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell && target) cell.l = { Target: target, Tooltip: tip };
  };
  submissions.forEach((s, i) => {
    const r = i + 1;
    const g = groups[i];
    for (const q of questions) {
      if (q.allowAttach && qMax[q.id]) {
        (g[q.id] || []).forEach((a, j) => link(r, colOf.qAtt[q.id] + j, linkFor(a), a.filename));
      }
    }
    if (showAppUrl && s.app_url) link(r, colOf.app, s.app_url);
    if (appMax) g.app.forEach((a, j) => link(r, colOf.appAtt + j, linkFor(a), a.filename));
    if (etcMax) g.etc.forEach((a, j) => link(r, colOf.etc + j, linkFor(a), a.filename));
  });

  ws['!cols'] = header.map((h, c) => {
    if (c === 0) return { wch: 6 };
    if (c === 1) return { wch: 18 };
    if (c <= 4) return { wch: 16 };
    const q = questions.find((x) => colOf.q[x.id] === c);
    if (q) return { wch: q.type === 'textarea' ? 70 : 28 };
    return { wch: 28 };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '제출 내역');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
