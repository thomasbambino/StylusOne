import { IService } from './interfaces';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { Book } from '@shared/schema';
import AdmZip from 'adm-zip';
import * as xml2js from 'xml2js';
import { sanitizeFilename, safeJoin, getUploadsPath, validateBookPath } from '../utils/path-security';

interface EpubMetadata {
  title: string;
  author?: string;
  description?: string;
  publisher?: string;
  publication_date?: string;
  isbn?: string;
  language?: string;
  cover?: Buffer;
  pageCount?: number;
}

/**
 * Service for handling EPUB file parsing and metadata extraction
 */
export class EpubService implements IService {
  private booksDir: string;
  private coversDir: string;
  private initialized: boolean = false;

  constructor() {
    this.booksDir = path.join(process.cwd(), 'uploads', 'books');
    this.coversDir = path.join(process.cwd(), 'uploads', 'covers');
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    // Create directories if they don't exist
    if (!fs.existsSync(this.booksDir)) {
      fs.mkdirSync(this.booksDir, { recursive: true });
    }
    if (!fs.existsSync(this.coversDir)) {
      fs.mkdirSync(this.coversDir, { recursive: true });
    }
    
    this.initialized = true;
    console.log('EPUB service initialized');
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    return this.initialized && fs.existsSync(this.booksDir) && fs.existsSync(this.coversDir);
  }

  /**
   * Reinitialize the service with new configuration
   */
  async reinitialize(): Promise<void> {
    // Reset state
    this.initialized = false;
    
    // Re-initialize
    await this.initialize();
  }

  /**
   * Parse EPUB file and extract metadata
   */
  async parseEpub(filePath: string): Promise<EpubMetadata> {
    try {
      // Open EPUB as ZIP file
      const zip = new AdmZip(filePath);
      
      // Find container.xml to get the root file location
      const containerEntry = zip.getEntry('META-INF/container.xml');
      if (!containerEntry) {
        throw new Error('Invalid EPUB: Missing container.xml');
      }

      const containerXml = containerEntry.getData().toString('utf8');
      const containerData = await xml2js.parseStringPromise(containerXml);
      const rootfilePath = containerData.container.rootfiles[0].rootfile[0]['$']['full-path'];

      // Parse the OPF (Open Packaging Format) file
      const opfEntry = zip.getEntry(rootfilePath);
      if (!opfEntry) {
        throw new Error('Invalid EPUB: Missing OPF file');
      }

      const opfXml = opfEntry.getData().toString('utf8');
      const opfData = await xml2js.parseStringPromise(opfXml);

      // Extract metadata
      const metadata = opfData.package.metadata[0];
      
      const result: EpubMetadata = {
        title: this.extractMetadataValue(metadata['dc:title']) || path.basename(filePath, '.epub'),
        author: this.extractMetadataValue(metadata['dc:creator']),
        description: this.extractMetadataValue(metadata['dc:description']),
        publisher: this.extractMetadataValue(metadata['dc:publisher']),
        publication_date: this.extractMetadataValue(metadata['dc:date']),
        isbn: this.extractMetadataValue(metadata['dc:identifier']),
        language: this.extractMetadataValue(metadata['dc:language']) || 'en',
      };

      // Extract cover image
      try {
        console.log('Attempting to extract cover image...');
        const coverBuffer = await this.extractCoverFromZip(zip, opfData);
        if (coverBuffer) {
          console.log('Cover image extracted successfully, size:', coverBuffer.length);
          result.cover = coverBuffer;
        } else {
          console.log('No cover image found');
        }
      } catch (error) {
        console.warn('Failed to extract cover image:', error);
      }

      // Get approximate page count from spine
      if (opfData.package.spine && opfData.package.spine[0].itemref) {
        result.pageCount = opfData.package.spine[0].itemref.length;
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to parse EPUB: ${error.message}`);
    }
  }

  /**
   * Save EPUB file to storage
   */
  async saveEpubFile(originalFilename: string, buffer: Buffer): Promise<{ filePath: string; fileSize: number }> {
    const sanitizedFilename = this.sanitizeFilename(originalFilename);
    const uniqueFilename = `${Date.now()}-${sanitizedFilename}`;
    const filePath = path.join(this.booksDir, uniqueFilename);
    
    await fs.promises.writeFile(filePath, buffer);
    
    return {
      filePath: path.relative(process.cwd(), filePath),
      fileSize: buffer.length
    };
  }

  /**
   * Save cover image to storage
   */
  async saveCoverImage(bookId: number, coverBuffer: Buffer): Promise<string> {
    const coverFilename = `cover-${bookId}.jpg`;
    const coverPath = path.join(this.coversDir, coverFilename);
    
    // Process image with Sharp - convert to JPEG and resize
    await sharp(coverBuffer)
      .resize(400, 600, { 
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 85 })
      .toFile(coverPath);
    
    return path.relative(process.cwd(), coverPath);
  }

  /**
   * Delete book files (EPUB and cover)
   */
  async deleteBookFiles(book: Book): Promise<void> {
    try {
      // Delete EPUB file
      if (book.file_path) {
        const safePath = validateBookPath(book.file_path);
        if (safePath && fs.existsSync(safePath)) {
          await fs.promises.unlink(safePath);
        }
      }
      
      // Delete cover image
      if (book.cover_path) {
        const safePath = validateBookPath(book.cover_path);
        if (safePath && fs.existsSync(safePath)) {
          await fs.promises.unlink(safePath);
        }
      }
    } catch (error) {
      console.error('Error deleting book files:', error);
      throw new Error('Failed to delete book files');
    }
  }

  /**
   * Extract metadata value from EPUB metadata
   */
  private extractMetadataValue(metadataField: any): string | undefined {
    if (!metadataField) return undefined;
    
    if (Array.isArray(metadataField)) {
      const firstItem = metadataField[0];
      if (typeof firstItem === 'string') {
        return firstItem;
      }
      if (firstItem && typeof firstItem === 'object' && firstItem['_']) {
        return firstItem['_'];
      }
      if (firstItem && typeof firstItem === 'object' && firstItem['$text']) {
        return firstItem['$text'];
      }
    }
    
    if (typeof metadataField === 'string') {
      return metadataField;
    }
    
    return undefined;
  }

  /**
   * Extract cover image from EPUB ZIP
   */
  private async extractCoverFromZip(zip: AdmZip, opfData: any): Promise<Buffer | null> {
    try {
      console.log('Starting cover extraction...');
      
      // Look for cover in metadata
      const metadata = opfData.package.metadata[0];
      const manifest = opfData.package.manifest[0].item;
      
      console.log('Available entries in ZIP:', zip.getEntries().map(e => e.entryName));
      console.log('Manifest items:', manifest.length);
      
      // Try to find cover-image meta tag
      let coverImageId: string | undefined;
      
      if (metadata.meta) {
        console.log('Checking meta tags for cover...');
        for (const meta of metadata.meta) {
          if (meta['$'] && meta['$'].name === 'cover') {
            coverImageId = meta['$'].content;
            console.log('Found cover meta tag with ID:', coverImageId);
            break;
          }
        }
      }
      
      // If no cover meta found, look for items with cover in properties
      if (!coverImageId) {
        for (const item of manifest) {
          if (item['$'] && item['$'].properties && item['$'].properties.includes('cover-image')) {
            coverImageId = item['$'].id;
            break;
          }
        }
      }
      
      // Find the cover file path
      let coverPath: string | undefined;
      if (coverImageId) {
        for (const item of manifest) {
          if (item['$'] && item['$'].id === coverImageId) {
            coverPath = item['$'].href;
            break;
          }
        }
      }
      
      // If still no cover found, look for common cover file names
      if (!coverPath) {
        const entries = zip.getEntries();
        for (const entry of entries) {
          const fileName = entry.entryName.toLowerCase();
          if (fileName.includes('cover') && (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.png'))) {
            coverPath = entry.entryName;
            break;
          }
        }
      }
      
      // Extract cover image
      if (coverPath) {
        const coverEntry = zip.getEntry(coverPath);
        if (coverEntry) {
          return coverEntry.getData();
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Error extracting cover image:', error);
      return null;
    }
  }

  /**
   * Sanitize filename for safe storage
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();
  }

  /**
   * Validate EPUB file
   */
  async validateEpubFile(buffer: Buffer): Promise<boolean> {
    try {
      // Check if the file is a valid ZIP (EPUB is a ZIP file)
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      
      let hasContainer = false;
      let hasMimetype = false;
      
      for (const entry of entries) {
        if (entry.entryName === 'META-INF/container.xml') {
          hasContainer = true;
        }
        if (entry.entryName === 'mimetype') {
          hasMimetype = true;
        }
      }
      
      return hasContainer && hasMimetype;
    } catch (error) {
      return false;
    }
  }
}

// Export a singleton instance
export const epubService = new EpubService();