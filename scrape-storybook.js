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

    // Click all "Show code" toggles/buttons so .os-content / prism blocks appear
    try {
      await page.evaluate(() => {
        const normalizeInline = (s) =>
          (s || '').replace(/\u00A0/g, ' ').trim().toLowerCase();

        const clickIfShowCode = (el) => {
          const text = normalizeInline(el.textContent || '');
          if (text.includes('show code')) {
            if (typeof el.click === 'function') {
              el.click();
            }
          }
        };

        const buttons = Array.from(document.querySelectorAll('button'));
        buttons.forEach(clickIfShowCode);

        const toggles = Array.from(
          document.querySelectorAll(
            '.docblock-code-toggle, [data-testid="docblock-code-toggle"]'
          )
        );
        toggles.forEach(clickIfShowCode);
      });

      // small delay so DOM updates after toggles
      await page.waitForTimeout(800);
    } catch {
      // non-fatal, continue
    }

    const content = await page.evaluate(() => {
      const normalizeInline = (s) =>
        (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

      // preserve newlines for code blocks
      const normalizeCode = (s) => {
        if (!s) return '';
        let t = s.replace(/\u00A0/g, ' ');
        t = t.replace(/\r\n/g, '\n');
        // Trim trailing spaces before newlines and at the very end
        t = t.replace(/[ \t]+\n/g, '\n').replace(/[ \t]+$/g, '');
        return t;
      };

      // ---- CODE BLOCKS ----
      const codeBlocks = [];
      const seenCode = new Set();

      const addCodeBlockFromElement = (el) => {
        if (!el) return;
        const rawText = el.textContent || '';
        const text = normalizeCode(rawText);
        if (!text) return;
        if (seenCode.has(text)) return;
        seenCode.add(text);

        const langAttr = el.getAttribute && el.getAttribute('data-language');
        const className = el.className || '';
        const match = /language-([\w-]+)/.exec(className);
        const language = langAttr || (match ? match[1] : '');

        codeBlocks.push({ language, code: text });
      };

      // Common places Storybook puts rendered code:
      const candidates = Array.from(
        new Set([
          ...Array.from(document.querySelectorAll('pre code')),
          ...Array.from(document.querySelectorAll('.docblock-source code')),
          ...Array.from(document.querySelectorAll('.os-content pre')),
          ...Array.from(document.querySelectorAll('.os-content code')),
          ...Array.from(document.querySelectorAll('pre.prismjs')),
          ...Array.from(document.querySelectorAll('code.prismjs'))
        ])
      );

      candidates.forEach(addCodeBlockFromElement);

      // ---- TABLES ----
      const tables = Array.from(
        document.querySelectorAll('.docblock-argstable, table.docblock-argstable')
      ).map((table) => {
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
          normalizeInline(th.textContent || '')
        );

        const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) => {
          const cells = Array.from(tr.querySelectorAll('td')).map((td) => {
            const tokens = [];
            const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT, null);

            let node;
            while ((node = walker.nextNode())) {
              const txt = normalizeInline(node.textContent || '');
              if (txt) tokens.push(txt);
            }

            if (tokens.length > 0) {
              // Join all text segments with a space;
              // handles boolean + undefined, "sm""md""lg", etc.
              return tokens.join(' ');
            }

            // Fallback: just use flattened textContent
            return normalizeInline(td.textContent || '');
          });

          return cells;
        });

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

      const headers =
        table.headers.length > 0
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

