import express from 'express';
import multer from 'multer';
import { db } from '../db';
import { books, users, type InsertBook } from '@shared/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { epubService } from '../services/epub-service';
import { emailService } from '../services/email-service';
import path from 'path';
import fs from 'fs';
import { User } from '@shared/schema';
import { sanitizeFilename, safeJoin, getUploadsPath, validateBookPath } from '../utils/path-security';

const router = express.Router();

// Configure multer for EPUB uploads
const uploadEpub = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Only accept EPUB files
    if (file.mimetype === 'application/epub+zip' || 
        file.originalname.toLowerCase().endsWith('.epub')) {
      cb(null, true);
    } else {
      cb(new Error('Only EPUB files are allowed'), false);
    }
  },
});

// Configure multer for image uploads
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size for images
  },
  fileFilter: (req, file, cb) => {
    // Only accept image files
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
    }
  },
});

/**
 * GET /api/books
 * Get all books in the library
 */
router.get('/', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  
  try {
    const allBooks = await db
      .select()
      .from(books)
      .orderBy(desc(books.uploaded_at));

    res.json(allBooks);
  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

/**
 * GET /api/books/:id
 * Get a specific book
 */
router.get('/:id', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const bookId = parseInt(req.params.id);
    
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId));

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    res.json(book);
  } catch (error) {
    console.error('Error fetching book:', error);
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

/**
 * POST /api/books/upload
 * Upload a new EPUB book
 */
router.post('/upload', uploadEpub.single('epub'), async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No EPUB file provided' });
    }

    const user = req.user!;

    // Validate EPUB file
    const isValidEpub = await epubService.validateEpubFile(req.file.buffer);
    if (!isValidEpub) {
      return res.status(400).json({ error: 'Invalid EPUB file' });
    }

    // Save EPUB file
    const { filePath, fileSize } = await epubService.saveEpubFile(
      req.file.originalname,
      req.file.buffer
    );

    // Parse EPUB metadata
    const fullPath = path.join(process.cwd(), filePath);
    const metadata = await epubService.parseEpub(fullPath);

    // Insert book record into database
    const bookData: InsertBook = {
      filename: req.file.originalname,
      file_path: filePath,
      title: metadata.title,
      author: metadata.author,
      description: metadata.description,
      publisher: metadata.publisher,
      publication_date: metadata.publication_date,
      isbn: metadata.isbn,
      language: metadata.language || 'en',
      file_size: fileSize,
      page_count: metadata.pageCount,
      uploaded_by: user.id,
      cover_path: null, // Will be set after cover processing
    };

    const [newBook] = await db.insert(books).values(bookData).returning();

    // Process and save cover image if available
    if (metadata.cover) {
      try {
        const coverPath = await epubService.saveCoverImage(newBook.id, metadata.cover);
        
        // Update book record with cover path
        await db
          .update(books)
          .set({ 
            cover_path: coverPath,
            updated_at: new Date()
          })
          .where(eq(books.id, newBook.id));

        newBook.cover_path = coverPath;
      } catch (coverError) {
        console.warn('Failed to save cover image:', coverError);
      }
    }

    res.status(201).json({
      message: 'Book uploaded successfully',
      book: newBook
    });

  } catch (error) {
    console.error('Error uploading book:', error);
    
    if (error.message.includes('EPUB parsing error')) {
      return res.status(400).json({ error: 'Failed to parse EPUB file' });
    }
    
    res.status(500).json({ error: 'Failed to upload book' });
  }
});

/**
 * PATCH /api/books/:id
 * Update book metadata
 */
router.patch('/:id', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const bookId = parseInt(req.params.id);
    const user = req.user!;
    const { title, author, description } = req.body;

    // Find the book
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId));

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Check if user owns the book or is admin
    if (book.uploaded_by !== user.id && user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized to edit this book' });
    }

    // Prepare update data
    const updateData: any = {
      updated_at: new Date()
    };

    if (title !== undefined) updateData.title = title;
    if (author !== undefined) updateData.author = author;
    if (description !== undefined) updateData.description = description;

    // Update the book
    const [updatedBook] = await db
      .update(books)
      .set(updateData)
      .where(eq(books.id, bookId))
      .returning();

    res.json({
      message: 'Book updated successfully',
      book: updatedBook
    });

  } catch (error) {
    console.error('Error updating book:', error);
    res.status(500).json({ error: 'Failed to update book' });
  }
});

/**
 * POST /api/books/:id/cover
 * Upload custom cover for a book
 */
router.post('/:id/cover', uploadImage.single('cover'), async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const bookId = parseInt(req.params.id);
    const user = req.user!;

    if (!req.file) {
      return res.status(400).json({ error: 'No cover image provided' });
    }

    // Find the book
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId));

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Check if user owns the book or is admin
    if (book.uploaded_by !== user.id && user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized to update this book' });
    }

    // File type validation is handled by multer

    // Delete old cover if it exists
    if (book.cover_path) {
      const safePath = validateBookPath(book.cover_path);
      if (safePath && fs.existsSync(safePath)) {
        await fs.promises.unlink(safePath);
      }
    }

    // Save new cover image
    const coverPath = await epubService.saveCoverImage(bookId, req.file.buffer);

    // Update book record
    const [updatedBook] = await db
      .update(books)
      .set({ 
        cover_path: coverPath,
        updated_at: new Date()
      })
      .where(eq(books.id, bookId))
      .returning();

    res.json({
      message: 'Cover uploaded successfully',
      book: updatedBook
    });

  } catch (error) {
    console.error('Error uploading cover:', error);
    res.status(500).json({ error: 'Failed to upload cover' });
  }
});

/**
 * POST /api/books/kindle-settings
 * Update user's Kindle email settings
 */
router.post('/kindle-settings', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const user = req.user!;
    const { kindleEmail } = req.body;

    // Validate email format if provided
    if (kindleEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kindleEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Update user's Kindle email
    const [updatedUser] = await db
      .update(users)
      .set({ 
        kindle_email: kindleEmail || null,
        updated_at: new Date()
      })
      .where(eq(users.id, user.id))
      .returning();

    res.json({
      message: 'Kindle settings updated successfully',
      kindleEmail: updatedUser.kindle_email
    });

  } catch (error) {
    console.error('Error updating Kindle settings:', error);
    res.status(500).json({ error: 'Failed to update Kindle settings' });
  }
});

/**
 * GET /api/books/kindle-settings
 * Get user's Kindle email settings
 */
router.get('/kindle-settings', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const user = req.user!;
    
    // Validate user ID
    if (!user.id || isNaN(user.id)) {
      console.error('Invalid user ID:', user.id);
      return res.status(400).json({ error: 'Invalid user session' });
    }

    // Get current user data
    const [userData] = await db
      .select({ kindle_email: users.kindle_email })
      .from(users)
      .where(eq(users.id, user.id));

    res.json({
      kindleEmail: userData?.kindle_email || null,
      senderEmail: 'kindle@stylus.services'
    });

  } catch (error) {
    console.error('Error fetching Kindle settings:', error);
    res.status(500).json({ error: 'Failed to fetch Kindle settings' });
  }
});

/**
 * DELETE /api/books/:id
 * Delete a book
 */
router.delete('/:id', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const bookId = parseInt(req.params.id);
    const user = req.user!;

    // Find the book
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId));

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Check if user owns the book or is admin
    if (book.uploaded_by !== user.id && user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized to delete this book' });
    }

    // Delete associated files
    await epubService.deleteBookFiles(book);

    // Delete from database
    await db.delete(books).where(eq(books.id, bookId));

    res.json({ message: 'Book deleted successfully' });

  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

/**
 * GET /api/books/:id/download
 * Download EPUB file
 */
router.get('/:id/download', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const bookId = parseInt(req.params.id);

    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId));

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const fullPath = path.join(process.cwd(), book.file_path);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Book file not found on disk' });
    }

    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${book.filename}"`);
    res.setHeader('Content-Type', 'application/epub+zip');

    // Stream the file
    const fileStream = fs.createReadStream(fullPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading book:', error);
    res.status(500).json({ error: 'Failed to download book' });
  }
});

/**
 * GET /api/books/:id/cover
 * Get book cover image
 */
router.get('/:id/cover', async (req, res) => {
  try {
    const bookId = parseInt(req.params.id);

    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId));

    if (!book || !book.cover_path) {
      return res.status(404).json({ error: 'Cover not found' });
    }

    // Validate the book cover path to prevent path traversal
    const safePath = validateBookPath(book.cover_path);
    if (!safePath) {
      console.error('Invalid book cover path:', book.cover_path);
      return res.status(404).json({ error: 'Invalid cover path' });
    }

    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'Cover file not found on disk' });
    }

    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
    res.setHeader('Content-Type', 'image/jpeg');

    // Stream the cover image
    const fileStream = fs.createReadStream(safePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error serving cover:', error);
    res.status(500).json({ error: 'Failed to serve cover' });
  }
});

/**
 * GET /api/books/search
 * Search books by title, author, etc.
 */
router.get('/search/:query', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const query = req.params.query.toLowerCase();

    const searchResults = await db
      .select()
      .from(books)
      .where(
        // Simple text search - in production you might want to use full-text search
        sql`LOWER(title) LIKE ${`%${query}%`} OR LOWER(author) LIKE ${`%${query}%`} OR LOWER(description) LIKE ${`%${query}%`}`
      )
      .orderBy(desc(books.uploaded_at));

    res.json(searchResults);

  } catch (error) {
    console.error('Error searching books:', error);
    res.status(500).json({ error: 'Failed to search books' });
  }
});

/**
 * POST /api/books/:id/send-to-kindle
 * Send book to user's Kindle email
 */
router.post('/:id/send-to-kindle', async (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  try {
    const bookId = parseInt(req.params.id);
    const user = req.user!;

    // Check if user has Kindle email configured
    const [userData] = await db
      .select({ kindle_email: users.kindle_email })
      .from(users)
      .where(eq(users.id, user.id));

    if (!userData?.kindle_email) {
      return res.status(400).json({ 
        error: 'Kindle email not configured. Please set your Kindle email in settings first.' 
      });
    }

    // Find the book
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId));

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Validate the book file path to prevent path traversal
    const safePath = validateBookPath(book.file_path);
    if (!safePath) {
      console.error('Invalid book file path:', book.file_path);
      return res.status(404).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'Book file not found on disk' });
    }

    // Read the EPUB file
    const fileBuffer = await fs.promises.readFile(safePath);

    // Prepare email with book attachment
    // Following Amazon's Send to Kindle requirements:
    // - No subject line needed (but our email service requires one)
    // - No body text needed
    // - Just the EPUB attachment
    const emailParams = {
      to: userData.kindle_email,
      subject: 'Document', // Amazon ignores this but our email service requires it
      text: 'Document attached', // Minimal text (email service requires non-empty body)
      attachments: [{
        filename: book.filename,
        data: fileBuffer,
        contentType: 'application/epub+zip'
      }]
    };

    // Send the email with attachment
    // Note: The email service will use the configured sender email
    const emailSent = await emailService.sendEmail(emailParams);

    if (!emailSent) {
      console.error('Failed to send book to Kindle:', userData.kindle_email);
      return res.status(500).json({ 
        error: 'Failed to send book to Kindle. Please check your email configuration.' 
      });
    }

    console.log(`Book "${book.title}" sent successfully to ${userData.kindle_email}`);
    
    res.json({
      message: `Book "${book.title}" sent to ${userData.kindle_email}`,
      book: {
        id: book.id,
        title: book.title,
        author: book.author
      },
      kindleEmail: userData.kindle_email
    });

  } catch (error) {
    console.error('Error sending book to Kindle:', error);
    res.status(500).json({ error: 'Failed to send book to Kindle' });
  }
});

export default router;