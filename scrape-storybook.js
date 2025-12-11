#!/usr/bin/env node

// scrape-storybook.js
// Usage: node scrape-storybook.js https://your-storybook-url [output.md]

import fs from 'fs/promises';
import { chromium } from 'playwright';

async function main() {
  const baseUrl = (process.argv[2] || '').replace(/\/$/, '');
  const outFile = process.argv[3] || 'storybook-export.md';

  if (!baseUrl) {
    console.error('Usage: node scrape-storybook.js <storybookBaseUrl> [output.md]');
    process.exit(1);
  }

  const storiesUrl = `${baseUrl}/stories.json`;
  console.error(`Fetching stories from: ${storiesUrl}`);

  const storiesRes = await fetch(storiesUrl);
  if (!storiesRes.ok) {
    console.error(`Failed to fetch stories.json: ${storiesRes.status} ${storiesRes.statusText}`);
    process.exit(1);
  }

  const storiesJson = await storiesRes.json();
  const stories = Object.values(storiesJson.stories || {});

  if (stories.length === 0) {
    console.error('No stories found in stories.json');
    process.exit(1);
  }

  console.error(`Found ${stories.length} stories. Launching headless browser...`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let markdown = `# Storybook export\n\nFrom: ${baseUrl}\n\n`;
  let lastTitleParts = [];
  const total = stories.length;

  for (let index = 0; index < stories.length; index++) {
    const story = stories[index];

    // progress bar
    const progress = (index + 1) / total;
    const barWidth = 30;
    const filled = Math.round(progress * barWidth);
    const bar = '█'.repeat(filled) + ' '.repeat(barWidth - filled);
    process.stderr.write(
      `\r[${bar}] ${(progress * 100).toFixed(1)}%  (${index + 1}/${total})  ${story.id}         `
    );

    const docsUrl = `${baseUrl}/iframe.html?id=${encodeURIComponent(
      story.id
    )}&viewMode=docs`;

    try {
      await page.goto(docsUrl, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (err) {
      console.error(`\nError loading docs for ${story.id}: ${err.message}`);
      continue;
    }

    // Give Storybook a moment to render docs
    await page.waitForTimeout(2000);

    // Click all "Show code" buttons
    try {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (text.includes('show code')) {
            btn.click();
          }
        }

        // Some Storybook versions use toggle switches
        const toggles = Array.from(
          document.querySelectorAll('.docblock-code-toggle, [data-testid="docblock-code-toggle"]')
        );
        for (const el of toggles) {
          const text = (el.textContent || '').trim().toLowerCase();
          if (text.includes('show code')) {
            el.click();
          }
        }
      });
      await page.waitForTimeout(500);
    } catch {
      // non-fatal
    }

    const content = await page.evaluate(() => {
      const normalize = (s) => (s || '').replace(/\u00A0/g, ' ').trim();

      const codeBlocks = Array.from(
        document.querySelectorAll('pre code, .docblock-source code')
      ).map((code) => {
        const langAttr = code.getAttribute('data-language') || '';
        const className = code.className || '';
        const match = /language-([\w-]+)/.exec(className);
        const language = langAttr || (match ? match[1] : '');
        return {
          language,
          code: normalize(code.textContent || '')
        };
      });

      const tables = Array.from(
        document.querySelectorAll('.docblock-argstable, table.docblock-argstable')
      ).map((table) => {
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
          normalize(th.textContent || '')
        );
        const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) => normalize(td.textContent || ''))
        );
        return { headers, rows };
      });

      return { codeBlocks, tables };
    });

    // Build Markdown section for this story
    markdown += buildMarkdownForStory(story, content, lastTitleParts);
    lastTitleParts = story.title.split('/');
  }

  await browser.close();
  process.stderr.write('\nDone. Writing markdown...\n');

  await fs.writeFile(outFile, markdown, 'utf8');
  console.error(`Markdown written to ${outFile}`);
}

function buildMarkdownForStory(story, content, lastTitleParts) {
  let md = '';

  const titleParts = (story.title || '').split('/').filter(Boolean);
  // Emit only the parts that changed vs previous story
  for (let i = 0; i < titleParts.length; i++) {
    if (titleParts[i] !== lastTitleParts[i]) {
      const level = i + 1; // #, ##, ###...
      md += `${'#'.repeat(level)} ${titleParts[i]}\n\n`;
    }
  }

  const storyHeadingLevel = titleParts.length + 1;
  const storyName = story.name || story.id;
  md += `${'#'.repeat(storyHeadingLevel)} ${storyName}\n\n`;

  const { codeBlocks, tables } = content;

  // Code examples
  if (codeBlocks.length > 0) {
    codeBlocks.forEach((block, idx) => {
      const exampleHeadingLevel = storyHeadingLevel + 1;
      md += `${'#'.repeat(exampleHeadingLevel)} Code example ${idx + 1}\n\n`;
      const lang = block.language || '';
      md += '```' + lang + '\n';
      md += block.code + '\n';
      md += '```\n\n';
    });
  }

  // Props tables
  if (tables.length > 0) {
    tables.forEach((table, idx) => {
      const tableHeadingLevel = storyHeadingLevel + 1;
      md += `${'#'.repeat(tableHeadingLevel)} Props table ${idx + 1}\n\n`;

      const headers = table.headers.length
        ? table.headers
        : table.rows[0]?.map((_, i) => `Column ${i + 1}`) || [];

      if (headers.length === 0) return;

      md += '| ' + headers.join(' | ') + ' |\n';
      md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

      for (const row of table.rows) {
        const paddedRow = [...row];
        while (paddedRow.length < headers.length) paddedRow.push('');
        md += '| ' + paddedRow.join(' | ') + ' |\n';
      }
      md += '\n';
    });
  }

  return md;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

