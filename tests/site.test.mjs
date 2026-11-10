import { test } from 'node:test';
// Let queued JSDOM lifecycle work finish after closing each window so full-archive
// checks do not retain hundreds of documents until a synchronous loop ends.
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { parse } from 'yaml';

const root = new URL('../dist/', import.meta.url);
const { default: config } = await import('../astro.config.mjs');
const SITE = new URL(config.site).origin;
const home = readFileSync(new URL('index.html', root), 'utf8');
const contentRoot = new URL('../src/content/ads/', import.meta.url);
const published = readdirSync(contentRoot).filter(file => file.endsWith('.md')).map(file => ({
  ...parse(readFileSync(new URL(file, contentRoot), 'utf8').split('---')[1]),
  slug: file.replace(/\.md$/, ''),
})).filter(entry => entry.published).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
const slugs = published.map(entry => entry.slug);
const urlsFor = list => list.map(entry => `/ads/${entry.slug}/`);
const PAGE_SIZE = 12;
const pageFor = (list, page = 1) => urlsFor(list.slice((Math.min(page, Math.max(1, Math.ceil(list.length / PAGE_SIZE))) - 1) * PAGE_SIZE, Math.min(page, Math.max(1, Math.ceil(list.length / PAGE_SIZE))) * PAGE_SIZE));
const matching = ({ tag, industry, decade } = {}) => published.filter(entry =>
  (!tag || entry.tags.some(t => t.toLowerCase() === tag)) &&
  (!industry || entry.industry === industry) &&
  (!decade || `${Math.floor(entry.year / 10) * 10}s` === decade));
function openHome(query = '', fixtureCount = 0) {
  const dom = new JSDOM(home, { url: `${SITE}/${query}`, runScripts: 'outside-only' });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  // Exercise growth without adding extra entries or pages to the starter.
  if (fixtureCount) {
    const grid = dom.window.document.querySelector('.collection-grid');
    const seed = grid.firstElementChild.cloneNode(true);
    grid.replaceChildren();
    for (let index = 0; index < fixtureCount; index++) {
      const card = seed.cloneNode(true);
      card.querySelector('a').setAttribute('href', `/ads/fixture-${index}/`);
      card.dataset.tags = '["durability"]';
      grid.append(card);
    }
  }
  for (const script of dom.window.document.querySelectorAll('script[type="module"]')) {
    assert.equal(script.src, '', 'Filter bundle should be inline');
    dom.window.eval(script.textContent);
  }
  return dom;
}
const visible = doc => [...doc.querySelectorAll('.collection-card:not([hidden])')];
const cardUrls = cards => cards.map(card => card.querySelector('a').getAttribute('href'));

test('build regenerates a discoverable sitemap with exactly the published canonical pages', async () => {
  const sitemap = readFileSync(new URL('sitemap.xml', root), 'utf8');
  const dom = new JSDOM(sitemap, { contentType: 'application/xml' });
  const document = dom.window.document;
  assert.equal(document.querySelector('parsererror'), null);
  assert.equal(document.documentElement.localName, 'urlset');
  const locations = [...document.querySelectorAll('url > loc')].map(loc => loc.textContent);
  const expected = ['/', ...urlsFor(published)].map(path => new URL(path, SITE).href);
  assert.equal(new Set(locations).size, locations.length, 'Sitemap URLs must be unique');
  assert.deepEqual([...locations].sort(), expected.sort());
  for (const location of locations) {
    const url = new URL(location);
    assert.equal(url.origin, SITE);
    assert.ok(existsSync(new URL(`.${url.pathname}index.html`, root)), `Missing sitemap page: ${location}`);
  }
  dom.window.close();
  await yieldToEventLoop();
  assert.equal(readFileSync(new URL('robots.txt', root), 'utf8'),
    `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
});

test('five-entry collection clamps shared pagination and restores browser navigation', async () => {
  for (const query of ['', '?page=2', '?page=999', '?page=-1', '?page=1.5', '?page=oops']) {
    const dom = openHome(query);
    const doc = dom.window.document;
    assert.deepEqual(cardUrls(visible(doc)), pageFor(published));
    assert.equal(doc.querySelector('#collection-pagination').hidden, published.length <= PAGE_SIZE);
    dom.window.history.replaceState(null, '', '/?tag=engineering');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    assert.deepEqual(cardUrls(visible(doc)), pageFor(matching({tag: 'engineering'})));
    dom.window.close();
    await yieldToEventLoop();
  }
});

test('all filter combinations, empty states and reset work across pagination', async () => {
  const dom = openHome('?page=2');
  const { document, Event } = dom.window;
  const decade = document.querySelector('#decade');
  const industry = document.querySelector('#industry');
  const all = [...document.querySelectorAll('.collection-card')];
  for (const decadeValue of [...decade.options].map(o => o.value)) {
    for (const industryValue of [...industry.options].map(o => o.value)) {
      decade.value = decadeValue;
      industry.value = industryValue;
      industry.dispatchEvent(new Event('change', { bubbles: true }));
      const matches = all.filter(card => (!decadeValue || card.dataset.decade === decadeValue) && (!industryValue || card.dataset.industry === industryValue));
      assert.deepEqual(cardUrls(visible(document)), cardUrls(matches.slice(0, PAGE_SIZE)));
      assert.equal(document.querySelector('#empty-state').hidden, matches.length !== 0);
      assert.equal(document.querySelector('#collection-pagination').hidden, matches.length <= PAGE_SIZE);
      assert.equal(new URL(dom.window.location.href).searchParams.get('page'), null);
      assert.equal(new URL(dom.window.location.href).searchParams.get('decade'), decadeValue || null);
      assert.equal(new URL(dom.window.location.href).searchParams.get('industry'), industryValue || null);
    }
  }
  document.querySelector('#clear-empty').click();
  assert.equal(visible(document).length, Math.min(PAGE_SIZE, published.length));
  assert.equal(dom.window.location.search, '');
  assert.equal(document.activeElement.id, 'decade');
  dom.window.close();
  await yieldToEventLoop();
});

test('shared filtered pages clamp to matching results and unknown filters are ignored', async () => {
  const dom = openHome('?decade=1980s&industry=Automotive&page=2');
  assert.equal(new URL(dom.window.location.href).searchParams.get('industry'), 'Automotive');
  assert.ok(matching({decade: '1980s', industry: 'Automotive'}).length > 0);
  assert.deepEqual(cardUrls(visible(dom.window.document)), pageFor(matching({decade: '1980s', industry: 'Automotive'}), 2));
  dom.window.close();
  await yieldToEventLoop();
  const invalid = openHome('?decade=unknown&industry=unknown');
  assert.equal(visible(invalid.window.document).length, Math.min(PAGE_SIZE, published.length));
  invalid.window.close();
  await yieldToEventLoop();
});

test('all published static pages have valid internal links and locally built images', async () => {
  for (const path of ['index.html', ...slugs.map(slug => `ads/${slug}/index.html`)]) {
    const dom = new JSDOM(readFileSync(new URL(path, root), 'utf8'));
    const document = dom.window.document;
    assert.equal(document.querySelectorAll('h1').length, 1);
    assert.ok(document.querySelector('meta[name="description"]').content);
    assert.equal(document.querySelector('script[src*="googletagmanager"]'), null);
    assert.equal(document.querySelector('meta[name="google-site-verification"]'), null);
    for (const image of document.querySelectorAll('img')) {
      assert.ok(image.alt);
      assert.ok(image.getAttribute('src').endsWith('.webp'));
      assert.ok(existsSync(new URL(`.${image.getAttribute('src')}`, root)));
      assert.ok(image.getAttribute('srcset'));
    }
    for (const link of document.querySelectorAll('a[href]')) {
      const url = new URL(link.getAttribute('href'), `${SITE}/${path.replace('index.html', '')}`);
      if (url.origin !== SITE) continue;
      const target = new URL(`.${url.pathname}${url.pathname.endsWith('/') ? 'index.html' : ''}`, root);
      assert.ok(existsSync(target), `Missing link target: ${url.pathname}`);
      if (url.hash) {
        const targetDom = new JSDOM(readFileSync(target, 'utf8'));
        assert.ok(targetDom.window.document.getElementById(url.hash.slice(1)), `Missing anchor: ${url.hash}`);
        targetDom.window.close();
        await yieldToEventLoop();
      }
    }
    dom.window.close();
    await yieldToEventLoop();
  }
});

test('without JavaScript all ads remain accessible; only optimized scans are deployed', async () => {
  const dom = new JSDOM(home);
  assert.equal(visible(dom.window.document).length, slugs.length);
  assert.equal(dom.window.document.querySelector('#filters').hidden, true);
  assert.equal(dom.window.document.querySelector('#collection-pagination').hidden, true);
  dom.window.close();
  await yieldToEventLoop();
  const files = readdirSync(root, { recursive: true });
  assert.equal(files.filter(file => /\.(png|jpe?g|md)$/i.test(file)).length, 0);
  assert.ok(files.filter(file => /\.webp$/.test(file)).length >= slugs.length);
  assert.equal(files.some(file => /Screenshot|cms|Collection_files/.test(file)), false);
});

test('tag links on every detail page open matching ads across the archive', async () => {
  const tagUrls = new Map();
  for (const slug of slugs) {
    const detail = new JSDOM(readFileSync(new URL(`ads/${slug}/index.html`, root), 'utf8'));
    const doc = detail.window.document;
    assert.equal(doc.querySelectorAll('.tags a').length, 3, slug);
    assert.equal([...doc.querySelectorAll('dt')].some(el => el.textContent === 'Format'), false);
    assert.equal(doc.querySelector('.themes'), null);
    assert.doesNotMatch(doc.querySelector('figcaption').textContent, /Portrait|Landscape/);
    for (const link of doc.querySelectorAll('.tags a')) {
      const url = new URL(link.getAttribute('href'), SITE);
      const matches = matching({tag: url.searchParams.get('tag')});
      assert.ok(urlsFor(matches).includes(`/ads/${slug}/`), `${slug}: ${link.textContent}`);
      assert.equal(url.pathname, '/');
      tagUrls.set(url.searchParams.get('tag'), url.search);
    }
    detail.window.close();
    await yieldToEventLoop();
  }
  for (const [tag, search] of tagUrls) {
    const filtered = openHome(search);
    const matches = matching({tag});
    const cards = visible(filtered.window.document);
    assert.deepEqual(cardUrls(cards), pageFor(matches));
    for (let page = 2; page <= Math.ceil(matches.length / PAGE_SIZE); page++) {
      filtered.window.document.querySelector(`a[aria-label="Page ${page}"]`).click();
      assert.deepEqual(cardUrls(visible(filtered.window.document)), pageFor(matches, page));
    }
    assert.ok([...filtered.window.document.querySelectorAll('.collection-card')].filter(card => JSON.parse(card.dataset.tags).includes(tag)).length === matches.length);
    filtered.window.close();
    await yieldToEventLoop();
  }
});

test('tags combine with industry and decade, normalize shared URLs, reset and restore', async () => {
  const dom = openHome('?tag=%20DURABILITY%20&page=2');
  const { document, Event } = dom.window;
  const urls = () => cardUrls(visible(document));
  assert.deepEqual(urls(), pageFor(matching({tag: 'durability'}), 2));
  const industry = document.querySelector('#industry');
  const decade = document.querySelector('#decade');
  industry.value = 'Automotive';
  industry.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(new URL(dom.window.location.href).searchParams.get('industry'), 'Automotive');
  assert.deepEqual(urls(), pageFor(matching({tag: 'durability', industry: 'Automotive'})));
  assert.equal(new URL(dom.window.location.href).searchParams.get('tag'), 'durability');
  assert.equal(new URL(dom.window.location.href).searchParams.has('page'), false);
  decade.value = '1980s';
  decade.dispatchEvent(new Event('change', { bubbles: true }));
  const combined = matching({tag: 'durability', industry: 'Automotive', decade: '1980s'});
  assert.deepEqual(urls(), pageFor(combined));
  assert.equal(document.querySelector('#empty-state').hidden, combined.length > 0);
  const emptyDecade = [...decade.options].map(option => option.value).find(value =>
    value && matching({tag: 'durability', industry: 'Automotive', decade: value}).length === 0);
  assert.ok(emptyDecade, 'An available decade must exercise the empty combined-filter state');
  decade.value = emptyDecade;
  decade.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(visible(document).length, 0);
  assert.equal(document.querySelector('#empty-state').hidden, false);
  document.querySelector('#clear-empty').click();
  assert.equal(document.querySelector('#tag').value, '');
  assert.equal(dom.window.location.search, '');
  assert.equal(visible(document).length, Math.min(PAGE_SIZE, published.length));
  dom.window.history.replaceState(null, '', '/?tag=engineering');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert.deepEqual(urls(), pageFor(matching({tag: 'engineering'})));
  dom.window.history.replaceState(null, '', '/?tag=unknown');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert.equal(visible(document).length, Math.min(PAGE_SIZE, published.length));
  dom.window.close();
  await yieldToEventLoop();
});

test('pagination and tag filtering cover a future collection across multiple pages', async () => {
  const fixtureCount = 101;
  const fixtureUrls = Array.from({length: fixtureCount}, (_, i) => `/ads/fixture-${i}/`);
  const total = Math.ceil(fixtureCount / PAGE_SIZE);
  const dom = openHome('?tag=durability', fixtureCount);
  const doc = dom.window.document;
  const seen = [];
  for (let page = 1; page <= total; page++) {
    if (page > 1) doc.querySelector('a[rel="next"]').click();
    const nav = doc.querySelector('#collection-pagination');
    assert.equal(nav.querySelector('.pagination-summary').textContent, `Page ${page} of ${total}`);
    assert.ok(nav.querySelectorAll('.pagination-number, .pagination-ellipsis').length <= 7);
    assert.equal(nav.querySelectorAll('[aria-current="page"]').length, 1);
    assert.equal(nav.querySelector('[aria-current="page"]').dataset.page, String(page));
    for (const value of new Set([1, total, page, Math.max(1, page - 1), Math.min(total, page + 1)])) {
      assert.ok(nav.querySelector(`a[aria-label="Page ${value}"]`));
    }
    assert.equal(Boolean(nav.querySelector('a[rel="prev"]')), page > 1);
    assert.equal(Boolean(nav.querySelector('a[rel="next"]')), page < total);
    assert.equal(nav.querySelectorAll('.pagination-ellipsis a, .pagination-ellipsis[tabindex]').length, 0);
    const current = cardUrls(visible(doc));
    assert.deepEqual(current, fixtureUrls.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
    seen.push(...current);
    assert.equal(new URL(dom.window.location.href).searchParams.get('tag'), 'durability');
  }
  assert.deepEqual(seen, fixtureUrls);
  doc.querySelector('a[aria-label="Page 1"]').click();
  doc.querySelector('a[aria-label="Page 2"]').click();
  assert.equal(doc.activeElement.id, 'collection-heading');
  assert.equal(dom.window.location.search, '?tag=durability&page=2');
  doc.querySelector('[type="reset"]').click();
  assert.equal(doc.querySelector('#tag').value, '');
  assert.equal(dom.window.location.search, '');
  assert.deepEqual(cardUrls(visible(doc)), fixtureUrls.slice(0, PAGE_SIZE));
  dom.window.close();
  await yieldToEventLoop();
  const shared = openHome('?tag=durability&page=2', fixtureCount);
  assert.deepEqual(cardUrls(visible(shared.window.document)), fixtureUrls.slice(PAGE_SIZE, 2 * PAGE_SIZE));
  shared.window.close();
  await yieldToEventLoop();
});

test('published detail pages preserve source transcription and archive navigation', async () => {
  for (const [index, entry] of published.entries()) {
    const dom = new JSDOM(readFileSync(new URL(`ads/${entry.slug}/index.html`, root), 'utf8'));
    const doc = dom.window.document;
    assert.equal(doc.querySelector('.transcription').textContent, entry.ocr, entry.slug);
    const neighbors = [published[index - 1], published[index + 1]].filter(Boolean);
    assert.deepEqual([...doc.querySelectorAll('.entry-pagination a')].map(a => a.getAttribute('href')), urlsFor(neighbors));
    assert.deepEqual([...doc.querySelectorAll('.tags a')].map(a => a.textContent), entry.tags);
    dom.window.close();
    await yieldToEventLoop();
  }
});

const graphFor = doc => {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  assert.equal(scripts.length, 1);
  const schema = JSON.parse(scripts[0].textContent);
  assert.equal(schema['@context'], 'https://schema.org');
  const ids = schema['@graph'].map(node => node['@id']);
  assert.equal(ids.length, new Set(ids).size);
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    if (Object.keys(value).length === 1 && value['@id']) assert.ok(ids.includes(value['@id']), `Unresolved reference ${value['@id']}`);
    Object.values(value).forEach(inspect);
  };
  inspect(schema);
  return schema['@graph'];
};

test('every generated page has connected JSON-LD and a consistent readable rights notice', async () => {
  const pages = readdirSync(root, { recursive: true }).filter(file => file.endsWith('.html'));
  for (const path of pages) {
    const dom = new JSDOM(readFileSync(new URL(path, root), 'utf8'));
    const doc = dom.window.document;
    const graph = graphFor(doc);
    const page = graph.find(node => ['WebPage', 'CollectionPage'].includes(node['@type']));
    assert.equal(page.url, doc.querySelector('link[rel="canonical"]').href, path);
    assert.equal(new URL(page.url).origin, SITE, path);
    assert.equal(doc.querySelector('meta[property="og:url"]').content, page.url, path);
    assert.equal(page.name, doc.title, path);
    assert.equal(page.description, doc.querySelector('meta[name="description"]').content);
    assert.equal(page.description, doc.querySelector('meta[property="og:description"]').content);
    assert.match(page.description, /a curated collection of vintage print advertisements/i);
    assert.equal(graph.find(node => node['@type'] === 'WebSite').name, 're:AD');
    const notice = doc.querySelector('footer .copyright-notice');
    assert.equal(notice.textContent, 're:AD does not claim copyright ownership of the advertisements reproduced here. They are presented for historical reference, commentary, and study. Any applicable copyrights remain with their respective owners.');
    assert.equal(notice.closest('[hidden]'), null);
    assert.doesNotMatch(notice.textContent, /\[email|contact us|upon verification/);
    dom.window.close();
    await yieldToEventLoop();
  }
});

test('homepage structured collection includes all and only published ads in server-rendered order', async () => {
  const dom = new JSDOM(home);
  const graph = graphFor(dom.window.document);
  const list = graph.find(node => node['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, published.length);
  assert.deepEqual(list.itemListElement.map(item => new URL(item.item.url).pathname), urlsFor(published));
  assert.deepEqual(list.itemListElement.map(item => item.position), published.map((_, i) => i + 1));
  assert.deepEqual(cardUrls([...dom.window.document.querySelectorAll('.collection-card')]), urlsFor(published));
  dom.window.close();
  await yieldToEventLoop();
});

test('every ad describes the original work, full copy, public scan, dates and visible breadcrumb accurately', async () => {
  for (const entry of published) {
    const dom = new JSDOM(readFileSync(new URL(`ads/${entry.slug}/index.html`, root), 'utf8'));
    const doc = dom.window.document;
    const graph = graphFor(doc);
    const page = graph.find(node => node['@type'] === 'WebPage');
    const work = graph.find(node => node['@type'] === 'CreativeWork');
    const image = graph.find(node => node['@type'] === 'ImageObject');
    const crumbs = graph.find(node => node['@type'] === 'BreadcrumbList');
    assert.equal(doc.title, `${entry.brand} ${entry.year} Ad | Vintage Old Magazine Ads Collection`);
    assert.equal(doc.querySelector('meta[property="og:title"]').content, doc.title);
    assert.ok(page.description.includes(entry.brand) && page.description.includes(String(entry.year)));
    assert.equal(work.headline, entry.title);
    assert.equal(work.text, entry.ocr || undefined);
    assert.equal(work.about.name, entry.brand);
    assert.deepEqual(work.keywords, [entry.industry, ...entry.tags]);
    assert.equal(work.datePublished, undefined, 'Archive date must not be assigned to the historical advertisement');
    assert.equal(page.temporalCoverage, String(entry.year));
    assert.equal(page.datePublished, entry.date);
    assert.equal(page.dateModified, entry.dateModified);
    assert.deepEqual([...doc.querySelectorAll('.publication-date time')].map(el => el.dateTime), [entry.date, entry.dateModified].filter(Boolean));
    assert.equal(new URL(image.contentUrl).origin, SITE);
    const imagePath = new URL(image.contentUrl).pathname;
    assert.ok(existsSync(new URL(`.${imagePath}`, root)), entry.slug);
    const scan = doc.querySelector('.scan-mount img');
    assert.equal(imagePath, scan.getAttribute('src'));
    assert.equal(image.width, Number(scan.width));
    assert.equal(image.height, Number(scan.height));
    assert.equal(image.description, scan.alt);
    assert.equal(doc.querySelector('meta[property="og:image"]').content, image.contentUrl);
    const nav = doc.querySelector('nav[aria-label="Breadcrumb"]');
    assert.equal(crumbs.itemListElement[0].name, nav.querySelector('a').textContent);
    assert.equal(new URL(crumbs.itemListElement[0].item).pathname, nav.querySelector('a').getAttribute('href'));
    assert.equal(crumbs.itemListElement[1].name, nav.querySelector('[aria-current="page"]').textContent);
    assert.equal(crumbs.itemListElement[1].item, page.url);
    dom.window.close();
    await yieldToEventLoop();
  }
});

test('JSON-LD safely preserves quotes, Unicode, multiline copy and closing script text', async () => {
  const { serializeJsonLd } = await import('../src/lib/json-ld.mjs');
  const value = { text: '“Ad” & copy\n</script><script>window.injected=true</script>' };
  const encoded = serializeJsonLd(value);
  assert.ok(!encoded.includes('<'));
  const dom = new JSDOM(`<script type="application/ld+json">${encoded}</script>`);
  assert.equal(dom.window.document.querySelectorAll('script').length, 1);
  assert.deepEqual(JSON.parse(dom.window.document.querySelector('script').textContent), value);
  dom.window.close();
  await yieldToEventLoop();
});

test('publication dates reject impossible, ambiguous and future dates', async () => {
  const { isPublicationDate, displayDate, archiveToday } = await import('../src/lib/publication-date.mjs');
  for (const value of ['1976', '2024-02-30', '2023-02-29', '2024-13-01', '10/09/2026', '2999-01-01', '', undefined]) assert.equal(isPublicationDate(value), false, String(value));
  assert.equal(isPublicationDate('2024-02-29'), true);
  assert.equal(isPublicationDate(archiveToday()), true);
  assert.equal(displayDate('2024-02-29'), '29 February 2024');
});


