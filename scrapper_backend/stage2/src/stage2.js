import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import runLinkedInScraper from './lib/scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readUrlsArgOrDefault() {
  const argPath = process.argv[2];
  const filePath = argPath
    ? path.resolve(process.cwd(), argPath)
    : path.join(__dirname, 'urls.sample.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const urls = JSON.parse(raw);
    if (!Array.isArray(urls)) throw new Error('URLs file must contain an array');
    return urls;
  } catch (e) {
    console.error('Failed to read URLs file', e.message);
    process.exit(1);
  }
}

async function cli() {
  const urls = readUrlsArgOrDefault();
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  try {
    const { successes, failures, jsonPath } = await runLinkedInScraper({
      email,
      password,
      urls,
      headless: String(process.env.HEADLESS || 'true') === 'true'
    });
    console.log(`Done. Successes=${successes.length} Failures=${failures.length} JSON=${jsonPath || 'n/a'}`);
  } catch (e) {
    console.error('Fatal:', e.message);
    process.exit(1);
  }
}

// if (import.meta.url === `file://${process.argv[1]}`) {
//   cli();
// }

cli();

