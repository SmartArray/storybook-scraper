# Storybook Markdown Scraper

This tool downloads a public Storybook and turns all of its Docs pages into one Markdown file.
It collects:

* Headings (matching the Storybook sidebar structure)
* Code examples (including hidden “Show code” blocks)
* Props tables
* Multiple examples per story

The result is a single, well-structured Markdown document you can use for documentation, offline reference, or as input for other tools.

***

## ⚠️ Important Note

Storybook installations can vary a lot.
Different versions and custom themes may structure code blocks or tables differently.
**This scraper may not work with every Storybook.**
If something breaks, feel free to open a pull request or an issue.

***

## Features

* Scrapes public Storybook URLs (no login needed)
* Uses `stories.json` to detect every story
* Opens each story’s Docs page in a headless browser
* Clicks “Show code” buttons automatically
* Extracts:
    * Code blocks (preserving newlines)
    * Argument tables
    * Story hierarchy as Markdown headings
* Creates a single Markdown file: `storybook-export.md`
* Shows a progress bar in the terminal

***

## Requirements

* **Node.js 18+**
* **Playwright** (installed automatically with the setup steps below)

***

## Setup

Clone the project and install dependencies:

```
npm install
npx playwright install chromium
```

This installs Playwright and a headless Chromium browser used for scraping.

***

## Usage

Run the scraper:

```
node scrape-storybook.js https://your-public-storybook-url storybook.md
```

Example:

```
node scrape-storybook.js https://storybook.example.com storybook.md
```

* The script will scan all stories.
* It will visit each Docs page.
* It will generate a Markdown file with all extracted content.

If you omit the second argument, the output file defaults to:

```
storybook-export.md
```

***

## Output Structure

The generated Markdown preserves the Storybook hierarchy:

```
# Components
## Button
### Primary
#### Code example 1
#### Code example 2
#### Props table 1
```

Code blocks keep their formatting, and tables are rendered in Markdown format.

***

## Contributing

Pull requests are welcome!
If you find a Storybook that does not scrape correctly, feel free to:

* Open an issue
* Submit a fix
* Share example HTML so the scraper can be improved

***

## License

**MIT**

