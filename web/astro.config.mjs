import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

// Site URL. Defaults to the Cloudflare Pages production URL; the deploy
// workflow can override for preview environments or a custom domain.
const SITE = process.env.SITE_URL ?? 'https://gitwhy.pages.dev';
const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    starlight({
      title: 'GitWhy',
      description: 'Persistent memory for AI coding agents over your git history.',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      social: {
        github: 'https://github.com/kamsqe/gitwhy',
      },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'What is GitWhy?', link: '/' },
            { label: 'Try in browser →', link: '/playground/' },
            { label: 'Quick start', link: '/quickstart/' },
            { label: 'MCP setup', link: '/mcp-setup/' },
            { label: 'Open the app →', link: '/app/' },
          ],
        },
        {
          label: 'Capstone deliverables',
          items: [
            { label: 'Executive summary', link: '/docs/executive-summary/' },
            { label: 'Architecture blueprint', link: '/docs/architecture/' },
            { label: 'Self-review', link: '/docs/self-review/' },
          ],
        },
        {
          label: 'Demo',
          items: [
            { label: 'Live demo report', link: '/demo/' },
          ],
        },
      ],
      customCss: ['./src/assets/custom.css', './src/assets/app.css'],
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    }),
    react(),
  ],
});
