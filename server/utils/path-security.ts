import path from 'path';
import fs from 'fs';

/**
 * Security utility for safe file path handling
 * Prevents path traversal attacks by validating and sanitizing file paths
 */

/**
 * Sanitizes a filename to prevent path traversal
 * Removes any directory traversal sequences and special characters
 */
export function sanitizeFilename(filename: string): string {
  // Remove any path separators and traversal sequences
  return filename
    .replace(/\.\./g, '') // Remove ..
    .replace(/[\/\\]/g, '') // Remove / and \
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/[^\w\s\-\.]/g, '') // Keep only word chars, spaces, hyphens, and dots
    .trim();
}

/**
 * Safely joins paths and ensures the result is within the base directory
 * Prevents directory traversal attacks
 */
export function safeJoin(basePath: string, ...paths: string[]): string {
  // Sanitize each path component
  const sanitizedPaths = paths.map(p => sanitizeFilename(p));
  
  // Join the paths
  const joined = path.join(basePath, ...sanitizedPaths);
  
  // Resolve to absolute path
  const resolved = path.resolve(joined);
  const baseResolved = path.resolve(basePath);
  
  // Ensure the resolved path is within the base directory
  if (!resolved.startsWith(baseResolved)) {
    throw new Error('Path traversal attempt detected');
  }
  
  return resolved;
}

/**
 * Validates that a path is within the allowed directory
 * Returns the safe absolute path or null if invalid
 */
export function validatePath(requestedPath: string, allowedBase: string): string | null {
  try {
    // Resolve both paths to absolute
    const resolvedPath = path.resolve(requestedPath);
    const resolvedBase = path.resolve(allowedBase);
    
    // Check if the requested path is within the allowed base
    if (!resolvedPath.startsWith(resolvedBase)) {
      console.error(`Path validation failed: ${resolvedPath} is not within ${resolvedBase}`);
      return null;
    }
    
    return resolvedPath;
  } catch (error) {
    console.error('Path validation error:', error);
    return null;
  }
}

/**
 * Safely checks if a file exists within the allowed directory
 */
export function safeFileExists(basePath: string, filePath: string): boolean {
  try {
    const safePath = safeJoin(basePath, filePath);
    return fs.existsSync(safePath);
  } catch (error) {
    console.error('Safe file exists check failed:', error);
    return false;
  }
}

/**
 * Gets the safe path for uploads directory
 */
export function getUploadsPath(...paths: string[]): string {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (paths.length === 0) {
    return uploadsDir;
  }
  return safeJoin(uploadsDir, ...paths);
}

/**
 * Gets the safe path for data directory
 */
export function getDataPath(...paths: string[]): string {
  const dataDir = path.join(process.cwd(), 'data');
  if (paths.length === 0) {
    return dataDir;
  }
  return safeJoin(dataDir, ...paths);
}

/**
 * Validates and sanitizes a book file path from the database
 */
export function validateBookPath(bookPath: string | null | undefined): string | null {
  if (!bookPath) return null;
  
  // Book paths should be relative paths like 'books/filename.epub'
  // Remove any absolute path prefixes or traversal attempts
  const sanitized = bookPath
    .replace(/^[\/\\]+/, '') // Remove leading slashes
    .replace(/\.\.[\/\\]/g, '') // Remove directory traversal
    .replace(/[\/\\]+/g, '/'); // Normalize separators
  
  // Validate it's within the uploads directory
  const fullPath = path.join(process.cwd(), sanitized);
  return validatePath(fullPath, process.cwd());
}