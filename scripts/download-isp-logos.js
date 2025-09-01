import axios from 'axios';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetDir = path.join(__dirname, '..', 'client', 'public', 'isp-logos');
const size = 32; // Consistent size for all logos

// Extract URLs from the text
const rawText = `https://static.ui.com/asn/21928_101x101.png
https://static.ui.com/isp/at_t_internet_101x101.png
https://static.ui.com/isp/verizon_fios_101x101.png
https://static.ui.com/isp/verizon_business_101x101.png
https://static.ui.com/isp/comcast_business_101x101.png
https://static.ui.com/isp/xfinity_101x101.png
https://static.ui.com/isp/spectrum_101x101.png
https://static.ui.com/isp/spectrum_business_101x101.png
https://static.ui.com/isp/cox_business_101x101.png
https://static.ui.com/isp/cox_communications_101x101.png
https://static.ui.com/isp/centurylink_101x101.png
https://static.ui.com/isp/lumen_101x101.png
https://static.ui.com/isp/frontier_101x101.png
https://static.ui.com/isp/frontier_communications_101x101.png
https://static.ui.com/isp/rcn_101x101.png
https://static.ui.com/isp/hughesnet_101x101.png
https://static.ui.com/isp/viasat_101x101.png
https://static.ui.com/isp/starlink_101x101.png
https://static.ui.com/isp/ziply_fiber_101x101.png
https://static.ui.com/isp/tds_telecom_101x101.png
https://static.ui.com/isp/consolidated_communications_101x101.png
https://static.ui.com/isp/earthlink_101x101.png
https://static.ui.com/isp/atlantic_broadband_101x101.png
https://static.ui.com/isp/cincinnati_bell_101x101.png
https://static.ui.com/isp/hawaiian_telcom_101x101.png
https://static.ui.com/isp/metronet_101x101.png
https://static.ui.com/isp/google_fiber_101x101.png
https://static.ui.com/isp/sparklight_101x101.png
https://static.ui.com/isp/sonic_101x101.png
https://static.ui.com/isp/rise_broadband_101x101.png
https://static.ui.com/isp/comporium_101x101.png
https://static.ui.com/isp/midco_101x101.png
https://static.ui.com/isp/shentel_101x101.png
https://static.ui.com/isp/armstrong_101x101.png
https://static.ui.com/isp/zayo_101x101.png
https://static.ui.com/isp/sprint_101x101.png
https://static.ui.com/isp/china_telecom_101x101.png
https://static.ui.com/isp/orange_101x101.png
https://static.ui.com/isp/vodafone_101x101.png
https://static.ui.com/isp/telus_101x101.png`;

const urls = rawText.split('\n').filter(Boolean);

async function downloadAndResizeLogos() {
  // Create the target directory if it doesn't exist
  await fs.mkdir(targetDir, { recursive: true });

  for (const url of urls) {
    try {
      // Special handling for T-Mobile logo
      let filename;
      if (url.includes('asn/21928')) {
        filename = 'tmobile_101x101.png';
      } else {
        filename = url.split('/').pop().toLowerCase();
      }

      const outputPath = path.join(targetDir, filename);

      console.log(`Downloading ${url}...`);
      const response = await axios.get(url, { responseType: 'arraybuffer' });

      console.log(`Resizing ${filename}...`);
      await sharp(response.data)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .toFile(outputPath);

      console.log(`Processed ${filename}`);
    } catch (error) {
      console.error(`Error processing ${url}:`, error.message);
    }
  }
}

downloadAndResizeLogos().catch(console.error);