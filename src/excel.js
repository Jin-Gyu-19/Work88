import * as XLSX from 'xlsx';

// D1의 UTC datetime 문자열을 한국시간 표기로 변환
export function kstString(utc) {
  if (!utc) return '';
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

// 제출 내역을 엑셀 워크북(ArrayBuffer)으로 생성.
// linkFor(attachment) 가 반환하는 URL/상대경로가 첨부 셀의 하이퍼링크로 들어간다.
export function buildWorkbook(campaign, submissions, { linkFor }) {
  const maxAtt = submissions.reduce((m, s) => Math.max(m, (s.attachments || []).length), 0);
  const header = ['번호', '제출일시', '이름', '부서', '이메일', '제목', '내용', '앱 URL'];
  for (let i = 1; i <= maxAtt; i++) header.push(`첨부${i}`);

  const aoa = [header];
  submissions.forEach((s, i) => {
    const row = [
      i + 1,
      kstString(s.created_at),
      s.user_name || '',
      s.user_department || '',
      s.user_email,
      s.title,
      s.content,
      s.app_url || '',
    ];
    (s.attachments || []).forEach((a) => row.push(a.filename));
    aoa.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  submissions.forEach((s, i) => {
    const r = i + 1;
    if (s.app_url) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 7 })];
      if (cell) cell.l = { Target: s.app_url };
    }
    (s.attachments || []).forEach((a, j) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 8 + j })];
      if (cell) cell.l = { Target: linkFor(a), Tooltip: a.filename };
    });
  });
  ws['!cols'] = [
    { wch: 6 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 28 },
    { wch: 32 }, { wch: 70 }, { wch: 30 },
    ...Array(maxAtt).fill({ wch: 28 }),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '제출 내역');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
