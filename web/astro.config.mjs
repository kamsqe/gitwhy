import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Site URL for GitHub Pages. The deploy CI job sets BASE_URL if/when
// the site moves to a custom domain.
const SITE = process.env.SITE_URL ?? 'https://kamsqe.github.io';
const BASE = process.env.BASE_PATH ?? '/gitwhy';

export default defineConfig({
  site: SITE,
  base: BASE,
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
            { label: 'Quick start', link: '/quickstart/' },
            { label: 'MCP setup', link: '/mcp-setup/' },
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
      customCss: ['./src/assets/custom.css'],
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    }),
  ],
});
