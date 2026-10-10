// Browser proof against compiled DOM/CSS, not source/config string matching.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import puppeteer from 'puppeteer-core';

const [index, executablePath] = process.argv.slice(2);
const browser = await puppeteer.launch({executablePath, headless: true, timeout: 60000,
  args: ['--no-sandbox', '--disable-dev-shm-usage']});
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { window.__timelines = {}; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(index).href, {waitUntil: 'load'});
  const canvas = await page.$eval('#root', root => ({
    width: Number(root.dataset.width), height: Number(root.dataset.height),
  }));
  assert.equal(canvas.width / canvas.height, 9 / 16);
  await page.setViewport(canvas);
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(img => img.decode()));
    await document.fonts.ready;
  });
  const samples = await page.evaluate(() => {
    const timeline = window.__timelines['citaya-production'];
    return [...document.querySelectorAll('.website-visual')].flatMap(el => {
      const clip = el.matches('.clip') ? el : el.closest('.clip');
      const start = Number(clip.dataset.start), duration = Number(clip.dataset.duration);
      return [start, start + .14, start + duration - .01].map(time => {
        timeline.seek(time);
        const style = getComputedStyle(el), r = el.getBoundingClientRect();
        const width = el.naturalWidth || el.videoWidth, height = el.naturalHeight || el.videoHeight;
        // Geometry of contain's complete source image inside the actual CSS box.
        const ratio = Math.min(r.width / width, r.height / height);
        const content = {left: r.left + (r.width - width * ratio) / 2,
          right: r.right - (r.width - width * ratio) / 2,
          top: r.top + (r.height - height * ratio) / 2,
          bottom: r.bottom - (r.height - height * ratio) / 2};
        const ancestors = [];
        for (let parent = el; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
          if (['hidden','clip'].includes(css.overflowX) || ['hidden','clip'].includes(css.overflowY)) {
            ancestors.push({left: box.left, right: box.right, top: box.top, bottom: box.bottom});
          }
        }
        return {id: clip.id, time, tag: el.tagName, width, height, fit: style.objectFit,
          transform: style.transform, radius: style.borderRadius, content, ancestors,
          offset: el.dataset.mediaStart, duration: el.dataset.duration};
      });
    });
  });
  assert.deepEqual(errors, []);
  assert.ok(samples.some(s => s.tag === 'VIDEO'));
  assert.ok(samples.some(s => s.tag === 'IMG'));
  for (const sample of samples) {
    assert.ok(sample.width > sample.height, JSON.stringify(sample));
    assert.equal(sample.fit, 'contain');
    assert.equal(sample.transform, 'none');
    assert.equal(sample.radius, '0px');
    const r = sample.content;
    assert.ok(r.left >= 0 && r.right <= canvas.width && r.top >= 0 && r.bottom <= canvas.height, JSON.stringify(sample));
    for (const clip of sample.ancestors) {
      assert.ok(r.left >= clip.left - .01 && r.right <= clip.right + .01 &&
        r.top >= clip.top - .01 && r.bottom <= clip.bottom + .01, JSON.stringify(sample));
    }
    if (sample.tag === 'VIDEO') {
      assert.equal(Number(sample.offset), 0);
      assert.ok(Number(sample.duration) < 19.167);
    }
  }
  console.log(JSON.stringify({checked: samples.length, fullViewportVisible: true}));
} finally { await browser.close(); }
