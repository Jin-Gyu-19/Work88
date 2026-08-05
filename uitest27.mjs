import { chromium } from 'playwright-core';
const SS = '/tmp/claude-0/-home-user-Work88/331e3c33-023f-5065-a25e-9454dcd5a668/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1200 } })).newPage();
page.on('pageerror', (e) => console.log('!! JS 에러:', e.message));
await page.goto('http://localhost:8788/auth/dev?email=kimdlaek@gmail.com&name=관리자&dept=경영지원&redirect=/admin');
await page.waitForSelector('#admin-box:not(.hidden)');
await page.click('#btn-new');
await page.waitForSelector('#builder-modal:not(.hidden)');
console.log('플로팅 X 표시:', await page.locator('#b-close-x').isVisible());

const rows = page.locator('.q-row');
const r0 = rows.nth(0);
await r0.locator('.q-type').selectOption('choice');
await r0.locator('.q-label').fill('앱 개발 경험');
await r0.locator('.opt-input').nth(0).fill('YES');
await r0.locator('.opt-input').nth(1).fill('NO');
await page.click('#b-add'); await rows.nth(1).locator('.q-label').fill('두 번째');
await page.click('#b-add'); await rows.nth(2).locator('.q-label').fill('세 번째');

// 모든 질문 카드에 표시 조건 컨트롤이 있는지
console.log('표시 조건 컨트롤 수 (3 기대):', await page.locator('.q-cond-q').count());
console.log('1번(앞 질문 없음) 안내:', (await rows.nth(0).locator('.q-cond-note').textContent()).trim());

// 2번 질문에서 직접 조건 설정
await rows.nth(1).locator('.q-cond-q').selectOption({ index: 1 });
console.log('2번 조건 값 셀렉트 표시:', await rows.nth(1).locator('.q-cond-v').isVisible(),
  '| 값:', await rows.nth(1).locator('.q-cond-v').inputValue());
await rows.nth(1).locator('.q-cond-v').selectOption('NO');
console.log('2번 조건 = NO 설정됨');

// 1번의 칩 패널과 동기화되는지
const chip2 = rows.nth(0).locator('.br-line').nth(1).locator('.chip').nth(0);
console.log('1번 NO줄 2번칩 활성(동기화):', await chip2.evaluate((e) => e.classList.contains('on')));

// 칩으로 3번 지정 → 3번 카드의 셀렉트에 반영되는지
await rows.nth(0).locator('.br-line').nth(0).locator('.chip').nth(1).click();
console.log('3번 카드 조건 셀렉트 값:', await rows.nth(2).locator('.q-cond-v').inputValue());
await page.screenshot({ path: SS + '/ux_branch_percard.png', fullPage: true });

// Esc로 닫기
await page.keyboard.press('Escape');
console.log('Esc로 닫힘:', await page.locator('#builder-modal').isHidden());
await browser.close();
console.log('완료 ✅');
