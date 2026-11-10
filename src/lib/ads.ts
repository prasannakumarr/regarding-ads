import { getCollection } from 'astro:content';

export async function publishedAds() {
  return (await getCollection('ads', ({ data }) => data.published))
    .sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
}

export const decade = (year: number) => `${Math.floor(year / 10) * 10}s`;
export const adUrl = (id: string) => `/ads/${id}/`;
