import { defineConfig } from 'astro/config';

export default defineConfig({
  // Replace this with your own public origin before deploying.
  site: 'https://example.com',
  output: 'static',
  trailingSlash: 'always',
});
