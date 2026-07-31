// /dl — 다운로드 수를 +1 카운트한 뒤 R2의 설치파일로 리다이렉트
// (다운로드 버튼이 R2 직링크 대신 이 경로를 거치게 해서 정확히 집계)

const MANIFEST_URL = "https://pub-52f656e472a74341bc85f2dae0be8e3f.r2.dev/latest.json";

export async function onRequestGet({ env, request }) {
  const origin = new URL(request.url).origin;

  // 현재 버전/다운로드 URL을 매니페스트에서 읽기
  let url = null, ver = "unknown";
  try {
    const r = await fetch(MANIFEST_URL, { cf: { cacheTtl: 30 } });
    if (r.ok) {
      const m = await r.json();
      if (typeof m.url === "string" && /^https:\/\//i.test(m.url)) url = m.url;
      if (m.version) ver = String(m.version);
    }
  } catch (e) { /* 무시 */ }

  // 매니페스트를 못 읽으면 카운트 없이 홈으로
  if (!url) return Response.redirect(origin + "/", 302);

  // 카운트 (실패해도 다운로드는 진행 — best effort)
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

  return Response.redirect(url, 302);
}
