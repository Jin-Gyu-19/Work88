import { chromium } from 'playwright-core';
const SS = '/tmp/claude-0/-home-user-Work88/331e3c33-023f-5065-a25e-9454dcd5a668/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1300 } })).newPage();
page.on('pageerror', (e) => console.log('!! JS 에러:', e.message));
await page.goto('http://localhost:8788/auth/dev?email=kimdlaek@gmail.com&name=관리자&dept=경영지원&redirect=/admin');
await page.waitForSelector('#admin-box:not(.hidden)');
await page.click('#btn-new');
await page.waitForSelector('#builder-modal:not(.hidden)');
const rows = page.locator('.q-row');

// 1, 2번은 공통 질문 / 3번부터 분기 시작
await rows.nth(0).locator('.q-label').fill('소속 부서를 알려주세요');
await page.click('#b-add');
await rows.nth(1).locator('.q-label').fill('담당 업무를 알려주세요');
await page.click('#b-add');
const r2 = rows.nth(2);
await r2.locator('.q-label').fill('AI를 사용해 보셨나요?');
await r2.locator('.q-type').selectOption('choice');
await r2.locator('.opt-input').nth(0).fill('사용해 봤다');
await r2.locator('.opt-input').nth(1).fill('아직 없다');

console.log('3번에 분기 패널 표시:', await r2.locator('.q-branch-src').isVisible());
console.log('답변 줄 수:', await r2.locator('.br-line').count());
console.log('＋ 새 질문 버튼 수:', await r2.locator('.chip.add').count());

// "사용해 봤다" 분기에 새 질문 2개 만들기
await r2.locator('.br-line').nth(0).locator('.chip.add').click();
await page.waitForTimeout(200);
await rows.nth(3).locator('.q-label').fill('어떤 도구를 쓰셨나요?');
await r2.locator('.br-line').nth(0).locator('.chip.add').click();
await page.waitForTimeout(200);
await rows.nth(4).locator('.q-label').fill('효과는 어땠나요?');
// "아직 없다" 분기에 1개
await r2.locator('.br-line').nth(1).locator('.chip.add').click();
await page.waitForTimeout(200);
await rows.nth(5).locator('.q-label').fill('사용해보고 싶은 이유는?');

console.log('총 질문 수(6 기대):', await rows.count());
console.log('4번 조건:', await rows.nth(3).locator('.q-cond-v').inputValue());
console.log('5번 조건:', await rows.nth(4).locator('.q-cond-v').inputValue());
console.log('6번 조건:', await rows.nth(5).locator('.q-cond-v').inputValue());
await page.screenshot({ path: SS + '/ux_branch_from3.png', fullPage: true });

// 미리보기로 실제 흐름 확인
await page.fill('#b-name', '3번부터 분기 테스트');
await page.click('#b-preview');
await page.waitForSelector('#preview-modal:not(.hidden)');
const vis = async (n) => !(await page.locator('#pv-body .q-item').nth(n).evaluate((el) => el.classList.contains('hidden')));
console.log('초기 - 1,2,3번:', await vis(0), await vis(1), await vis(2), '| 4,5,6번:', await vis(3), await vis(4), await vis(5));
await page.locator('#pv-body input[value="사용해 봤다"]').check();
console.log('"사용해 봤다" → 4,5번:', await vis(3), await vis(4), '| 6번:', await vis(5));
await page.locator('#pv-body input[value="아직 없다"]').check();
console.log('"아직 없다"  → 4,5번:', await vis(3), await vis(4), '| 6번:', await vis(5));
await page.screenshot({ path: SS + '/ux_branch_from3_preview.png', fullPage: true });
await browser.close();
console.log('완료 ✅');
