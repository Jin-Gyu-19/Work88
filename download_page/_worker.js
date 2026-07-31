// _worker.js — Cloudflare Pages 고급 모드 (대시보드 직접 업로드에서도 동작)
//   /dl     → 다운로드 +1 카운트 후 R2 설치파일로 리다이렉트
//   /stats  → 다운로드 통계 페이지(공개) / ?format=json → 집계 JSON
//   그 외   → 정적 파일(env.ASSETS) 그대로 서빙

const MANIFEST_URL = "https://pub-52f656e472a74341bc85f2dae0be8e3f.r2.dev/latest.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/dl") return handleDl(env, url);
    if (url.pathname === "/stats") return handleStats(env, url);
    return env.ASSETS.fetch(request);
  },
};

async function handleDl(env, url) {
  let dlUrl = null, ver = "unknown";
  try {
    const r = await fetch(MANIFEST_URL, { cf: { cacheTtl: 30 } });
    if (r.ok) {
      const m = await r.json();
      if (typeof m.url === "string" && /^https:\/\//i.test(m.url)) dlUrl = m.url;
      if (m.version) ver = String(m.version);
    }
  } catch (e) { /* 무시 */ }

  if (!dlUrl) return Response.redirect(url.origin + "/", 302);

  try {
    if (env.STATS) {
      const t = parseInt((await env.STATS.get("dl:total")) || "0", 10) + 1;
      await env.STATS.put("dl:total", String(t));
      const vk = "dl:v:" + ver;
      const v = parseInt((await env.STATS.get(vk)) || "0", 10) + 1;
      await env.STATS.put(vk, String(v));
      await env.STATS.put("dl:last", new Date().toISOString());
    }
  } catch (e) { /* 무시 */ }

  return Response.redirect(dlUrl, 302);
}

async function handleStats(env, url) {
  if (url.searchParams.get("format") === "json") {
    let total = 0, last = "", versions = [];
    try {
      if (env.STATS) {
        total = parseInt((await env.STATS.get("dl:total")) || "0", 10);
        last = (await env.STATS.get("dl:last")) || "";
        const list = await env.STATS.list({ prefix: "dl:v:" });
        for (const k of list.keys) {
          const c = parseInt((await env.STATS.get(k.name)) || "0", 10);
          versions.push({ version: k.name.replace("dl:v:", ""), count: c });
        }
        versions.sort((a, b) => b.count - a.count);
      }
    } catch (e) { /* 무시 */ }
    return new Response(JSON.stringify({ total, last, versions }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  return new Response(STATS_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const STATS_HTML = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>SupportDeck · 다운로드 통계</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:#0b0d12;color:#e8eaf0;
       font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       display:flex;flex-direction:column;align-items:center;padding:48px 20px}
  a.back{align-self:flex-start;color:#8b93a7;text-decoration:none;font-size:14px;margin-bottom:24px}
  a.back:hover{color:#cfd4e0}
  .total{font-size:56px;font-weight:800;letter-spacing:-1px;line-height:1;
         background:linear-gradient(180deg,#fff,#9aa3b8);-webkit-background-clip:text;background-clip:text;color:transparent}
  .total-label{color:#8b93a7;font-size:13px;margin-top:8px}
  .card{width:100%;max-width:480px;background:#12151c;border:1px solid #1e2330;
        border-radius:16px;padding:28px;text-align:center}
  table{width:100%;max-width:480px;margin-top:20px;border-collapse:collapse;font-size:14px}
  th,td{padding:11px 14px;text-align:left;border-bottom:1px solid #1a1e29}
  th{color:#8b93a7;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
  .muted{color:#6b7385;font-size:12px;margin-top:22px}
  .err{color:#ff6b6b}
</style></head><body>
<a class="back" href="/">← supportdeck.pages.dev</a>
<div class="card">
  <div class="total" id="total">—</div>
  <div class="total-label">총 다운로드</div>
</div>
<table id="vtable" style="display:none">
  <thead><tr><th>버전</th><th style="text-align:right">다운로드</th></tr></thead>
  <tbody id="vbody"></tbody>
</table>
<div class="muted" id="updated"></div>
<script>
(async function(){
  try{
    const r=await fetch('/stats?format=json',{cache:'no-store'});
    const d=await r.json();
    document.getElementById('total').textContent=(d.total||0).toLocaleString();
    const vs=d.versions||[];
    if(vs.length){
      const tb=document.getElementById('vbody');
      vs.forEach(function(v){
        const tr=document.createElement('tr');
        const a=document.createElement('td');a.textContent='v'+v.version;
        const b=document.createElement('td');b.className='n';b.textContent=(v.count||0).toLocaleString();
        tr.appendChild(a);tr.appendChild(b);tb.appendChild(tr);
      });
      document.getElementById('vtable').style.display='';
    }
    if(d.last){
      const dt=new Date(d.last);
      document.getElementById('updated').textContent='마지막 다운로드 '+(isNaN(dt)?d.last:dt.toLocaleString('ko-KR'));
    }
  }catch(e){
    document.getElementById('updated').innerHTML='<span class="err">통계를 불러오지 못했어요.</span>';
  }
})();
</script>
</body></html>`;
