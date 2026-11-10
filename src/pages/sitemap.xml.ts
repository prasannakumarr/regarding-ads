import type { APIRoute } from 'astro';
import { adUrl, publishedAds } from '../lib/ads';

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('Astro site URL is required to generate sitemap.xml');

  const urls = ['/', ...(await publishedAds()).map(ad => adUrl(ad.id))];
  const entries = urls.map(path => `  <url><loc>${escapeXml(new URL(path, site).href)}</loc></url>`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
