import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
export default defineConfig({
  site: process.env.SITE_URL || 'https://drbkanca.github.io',
  integrations: [sitemap()],
  output: 'static',
  trailingSlash: 'always'
});
