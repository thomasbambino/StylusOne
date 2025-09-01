import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.join(__dirname, '..', 'attached_assets');
const targetDir = path.join(__dirname, '..', 'client', 'public');
const size = 32;

const logos = {
  'Google__G__logo.svg.png': 'google-g-logo.png',
};

async function resizeLogos() {
  // Create the target directory if it doesn't exist
  await fs.mkdir(targetDir, { recursive: true });

  for (const [source, target] of Object.entries(logos)) {
    try {
      await sharp(path.join(sourceDir, source))
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .toFile(path.join(targetDir, target));
      console.log(`Resized ${source} to ${target}`);
    } catch (error) {
      console.error(`Error processing ${source}:`, error);
    }
  }
}

resizeLogos().catch(console.error);