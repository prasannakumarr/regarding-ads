import type { CollectionEntry } from 'astro:content';
import { adUrl } from './ads';

export const archiveDescription = 'A curated collection of vintage print advertisements. Explore the ideas, words, and design that made advertising an art form.';
export const homeTitle = 're:AD — A collection of advertising worth remembering';
export const adTitle = (ad: CollectionEntry<'ads'>) => `${ad.data.brand} ${ad.data.year} Ad | Vintage Old Magazine Ads Collection`;
export const adDescription = (ad: CollectionEntry<'ads'>) => `Explore ${ad.data.brand}’s ${ad.data.year} ad, “${ad.data.title}”${ad.data.ocr ? ', with original copy' : ''}${ad.body?.trim() ? ' and commentary' : ''}, from re:AD—a curated collection of vintage print advertisements.`;
const ref = (id: string) => ({ '@id': id });
const website = (site: URL) => ({ '@type': 'WebSite', '@id': new URL('/#website', site).href, url: new URL('/', site).href, name: 're:AD', alternateName: 'RegardingAds', description: archiveDescription, inLanguage: 'en' });

export function homeSchema(site: URL, ads: CollectionEntry<'ads'>[]) {
  const url = new URL('/', site).href;
  return { '@context': 'https://schema.org', '@graph': [website(site), {
    '@type': 'CollectionPage', '@id': `${url}#webpage`, url, name: homeTitle, description: archiveDescription,
    inLanguage: 'en', isPartOf: ref(`${url}#website`), mainEntity: ref(`${url}#ad-list`),
  }, {
    '@type': 'ItemList', '@id': `${url}#ad-list`, name: 'The collection', numberOfItems: ads.length,
    itemListElement: ads.map((ad, index) => ({ '@type': 'ListItem', position: index + 1, item: {
      '@type': 'WebPage', '@id': `${new URL(adUrl(ad.id), site).href}#webpage`, url: new URL(adUrl(ad.id), site).href, name: adTitle(ad),
    } })),
  }] };
}

export function adSchema(site: URL, ad: CollectionEntry<'ads'>, image: { src: string; width: number; height: number }) {
  const url = new URL(adUrl(ad.id), site).href;
  const home = new URL('/', site).href;
  return { '@context': 'https://schema.org', '@graph': [website(site), {
    '@type': 'WebPage', '@id': `${url}#webpage`, url, name: adTitle(ad), description: adDescription(ad), inLanguage: 'en',
    temporalCoverage: String(ad.data.year), isPartOf: ref(`${home}#website`), mainEntity: ref(`${url}#advertisement`),
    primaryImageOfPage: ref(`${url}#image`), breadcrumb: ref(`${url}#breadcrumb`),
    ...(ad.data.date ? { datePublished: ad.data.date } : {}),
    ...(ad.data.dateModified ? { dateModified: ad.data.dateModified } : {}),
  }, {
    '@type': 'CreativeWork', '@id': `${url}#advertisement`, name: `${ad.data.brand} print advertisement, ${ad.data.year}`,
    headline: ad.data.title, genre: 'Print advertisement', inLanguage: 'en', keywords: [ad.data.industry, ...ad.data.tags],
    about: { '@type': 'Brand', name: ad.data.brand }, archivedAt: url, mainEntityOfPage: ref(`${url}#webpage`), image: ref(`${url}#image`),
    ...(ad.data.ocr ? { text: ad.data.ocr } : {}),
  }, {
    '@type': 'ImageObject', '@id': `${url}#image`, contentUrl: new URL(image.src, site).href,
    name: `${ad.data.brand} print advertisement, ${ad.data.year}`, caption: `${ad.data.brand} · ${ad.data.year}`,
    description: ad.data.imageAlt, encodingFormat: 'image/webp', width: image.width, height: image.height,
  }, {
    '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: home },
      { '@type': 'ListItem', position: 2, name: `${ad.data.brand}, ${ad.data.year}`, item: url },
    ],
  }] };
}
