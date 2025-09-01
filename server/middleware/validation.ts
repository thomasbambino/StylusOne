import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

// Validation error handler
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
};

// Common validation rules
export const validateInstanceId = param('instanceId')
  .isString()
  .isLength({ min: 1, max: 100 })
  .matches(/^[a-zA-Z0-9_-]+$/)
  .withMessage('Instance ID must contain only alphanumeric characters, hyphens, and underscores');

export const validateEmail = body('email')
  .isEmail()
  .normalizeEmail()
  .withMessage('Must be a valid email address');

export const validatePassword = body('password')
  .isLength({ min: 8, max: 128 })
  .withMessage('Password must be between 8 and 128 characters');

export const validateUsername = body('username')
  .isString()
  .isLength({ min: 3, max: 50 })
  .matches(/^[a-zA-Z0-9_-]+$/)
  .withMessage('Username must be 3-50 characters and contain only letters, numbers, hyphens, and underscores');

// Game server validation
export const validateGameServerData = [
  body('name')
    .isString()
    .isLength({ min: 1, max: 100 })
    .trim()
    .escape()
    .withMessage('Server name is required and must be less than 100 characters'),
  
  body('type')
    .optional()
    .isString()
    .isIn(['minecraft', 'valheim', 'terraria', 'other'])
    .withMessage('Invalid server type'),
];

// Console command validation
export const validateConsoleCommand = [
  body('command')
    .isString()
    .isLength({ min: 1, max: 500 })
    .trim()
    .withMessage('Command is required and must be less than 500 characters')
    .custom((value) => {
      // Block potentially dangerous commands
      const dangerousCommands = ['rm', 'del', 'format', 'shutdown', 'reboot', 'halt'];
      const lowerCommand = value.toLowerCase();
      for (const dangerous of dangerousCommands) {
        if (lowerCommand.includes(dangerous)) {
          throw new Error('Command contains potentially dangerous operations');
        }
      }
      return true;
    }),
];

// User data validation
export const validateUserData = [
  validateUsername,
  validateEmail,
  body('role')
    .optional()
    .isIn(['user', 'admin', 'superadmin'])
    .withMessage('Invalid user role'),
];

// Settings validation
export const validateSettings = [
  body('site_title')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .trim()
    .escape()
    .withMessage('Site title must be less than 100 characters'),
  
  body('logo_url')
    .optional()
    .isURL({ protocols: ['http', 'https'] })
    .withMessage('Logo URL must be a valid HTTP/HTTPS URL'),
];

// Pagination validation
export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Page must be a number between 1 and 1000'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be a number between 1 and 100'),
];

// Sanitize HTML input
export const sanitizeHtml = (req: Request, res: Response, next: NextFunction) => {
  // Remove any HTML tags from string inputs to prevent XSS
  const sanitizeValue = (value: any): any => {
    if (typeof value === 'string') {
      return value.replace(/<[^>]*>/g, '');
    }
    if (typeof value === 'object' && value !== null) {
      const sanitized: any = {};
      for (const key in value) {
        sanitized[key] = sanitizeValue(value[key]);
      }
      return sanitized;
    }
    return value;
  };

  req.body = sanitizeValue(req.body);
  req.query = sanitizeValue(req.query);
  next();
};