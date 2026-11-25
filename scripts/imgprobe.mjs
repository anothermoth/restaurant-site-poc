/* global window, document */
// Opens the live editor (desktop + mobile, fresh visitor each) and lists every image request that fails or renders broken.
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'https://restaurant-site-poc-editor.vercel.app';
const shotDir = process.argv[3];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
let total = 0;
for (const [name, vp] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
  const ctx = await b.newContext({ viewport: vp, isMobile: name==='mobile', hasTouch: name==='mobile' });
  const p = await ctx.newPage();
  const fails = [];
  let n = 0;
  p.on('response', r => { if (r.request().resourceType()==='image') { n++; if (r.status()>=400) fails.push(r.status()+' '+r.url()); } });
  p.on('requestfailed', r => { if (r.resourceType()==='image') fails.push('FAILED '+r.failure()?.errorText+' '+r.url()); });
  for (const path of ['/', '/published']) {
    await p.goto(base + path, { waitUntil: 'networkidle' });
    // Scroll every scroll container to the bottom so lazy images load.
    for (let i = 0; i < 12; i++) {
      await p.evaluate(() => { window.scrollBy(0, 600); document.querySelectorAll('*').forEach(e => { if (e.scrollHeight > e.clientHeight + 20) e.scrollTop += 600; }); });
      await p.waitForTimeout(250);
    }
    await p.waitForLoadState('networkidle');
    const imgs = await p.$$eval('img', els => els.map(e => ({ src: e.currentSrc || e.src, ok: e.complete && e.naturalWidth > 0 })));
    const broken = imgs.filter(x => !x.ok);
    console.log(`== ${name} ${path}: <img> ${imgs.length}, broken ${broken.length}`);
    broken.forEach(x => console.log('   broken', x.src));
    if (shotDir) { await p.evaluate(() => { window.scrollTo(0,0); document.querySelectorAll('*').forEach(e => e.scrollTop = 0); }); await p.screenshot({ path: `${shotDir}/images-${name}${path === '/' ? '' : '-published'}.png` }); }
  }
  console.log(`== ${name}: image responses ${n}, failed ${fails.length}`);
  fails.forEach(f => console.log('   ', f));
  total += fails.length;
  await ctx.close();
}
await b.close();
process.exit(total ? 1 : 0);
