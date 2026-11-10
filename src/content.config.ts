import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { tagLabel } from './lib/tags';
import { isPublicationDate } from './lib/publication-date.mjs';
const publicationDate = z.string().refine(isPublicationDate, 'Use a real, non-future publication date in YYYY-MM-DD format');

const ads = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/ads' }),
  schema: ({ image }) => z.object({
    sourceUrl: z.url().optional(),
    brand: z.string(),
    title: z.string(),
    year: z.number().int(),
    date: publicationDate.optional(),
    dateModified: publicationDate.optional(),
    industry: z.string(),
    image: image(),
    imageAlt: z.string(),
    orientation: z.enum(['Portrait', 'Landscape']),
    tags: z.array(z.string()).default([]).transform(values => [...new Set(values.map(tagLabel).filter(Boolean))]),
    themes: z.array(z.string()).default([]),
    ocr: z.string().default(''),
    published: z.boolean().default(false),
    order: z.number().default(100),
  }).refine(data => !data.dateModified || Boolean(data.date && data.dateModified >= data.date), {
    message: 'dateModified requires date and must not precede it', path: ['dateModified'],
  }),
});

export const collections = { ads };
