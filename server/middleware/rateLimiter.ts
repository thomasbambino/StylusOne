import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// Create rate limiting middleware
export const createRateLimiter = (options: {
  windowMs: number;
  max: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
}) => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      error: options.message || 'Too many requests from this IP, please try again later.'
    },
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: options.message || 'Too many requests from this IP, please try again later.',
        retryAfter: Math.round(options.windowMs / 1000)
      });
    },
  });
};

// General API rate limiter
export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per 15 minutes
  message: 'Too many API requests from this IP'
});

// Strict rate limiter for auth endpoints
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per 15 minutes
  message: 'Too many authentication attempts from this IP',
  skipSuccessfulRequests: true // Don't count successful logins
});

// More permissive rate limiter for game server actions
export const gameServerRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 game server actions per minute
  message: 'Too many game server requests from this IP'
});

// Very strict rate limiter for admin actions
export const adminRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit admin actions
  message: 'Too many admin requests from this IP'
});