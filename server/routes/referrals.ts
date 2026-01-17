import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { loggers } from '../lib/logger';

const router = Router();

/**
 * Middleware to ensure user is authenticated
 */
function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Validation schemas
const validateReferralCodeSchema = z.object({
  code: z.string().min(1).max(20),
});

/**
 * GET /api/referrals/code
 * Get user's referral code (creates one if it doesn't exist)
 */
router.get('/code', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;

    // Try to get existing code, or generate new one
    let referralCode = await storage.getReferralCodeByUserId(userId);

    if (!referralCode) {
      referralCode = await storage.generateReferralCode(userId);
    }

    res.json(referralCode);
  } catch (error) {
    loggers.referral.error('Error getting referral code', { error });
    res.status(500).json({ error: 'Failed to get referral code' });
  }
});

/**
 * POST /api/referrals/validate
 * Validate a referral code (public endpoint for signup form)
 */
router.post('/validate', async (req, res) => {
  try {
    const { code } = validateReferralCodeSchema.parse(req.body);

    const referralCode = await storage.validateReferralCode(code);

    if (!referralCode) {
      return res.status(404).json({
        valid: false,
        error: 'Invalid or inactive referral code'
      });
    }

    res.json({
      valid: true,
      code: referralCode.code
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    loggers.referral.error('Error validating referral code', { error });
    res.status(500).json({ error: 'Failed to validate referral code' });
  }
});

/**
 * GET /api/referrals/stats
 * Get user's referral statistics
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;

    const stats = await storage.getReferralStats(userId);

    res.json(stats);
  } catch (error) {
    loggers.referral.error('Error getting referral stats', { error });
    res.status(500).json({ error: 'Failed to get referral statistics' });
  }
});

/**
 * GET /api/referrals/list
 * Get list of users referred by this user
 */
router.get('/list', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;

    const referrals = await storage.getReferralsByUserId(userId);

    res.json(referrals);
  } catch (error) {
    loggers.referral.error('Error getting referrals list', { error });
    res.status(500).json({ error: 'Failed to get referrals list' });
  }
});

/**
 * GET /api/referrals/credits
 * Get user's pending free month credits
 */
router.get('/credits', requireAuth, async (req, res) => {
  try {
    const userId = (req.user as any).id;

    const credits = await storage.getPendingFreeMonths(userId);

    res.json(credits);
  } catch (error) {
    loggers.referral.error('Error getting referral credits', { error });
    res.status(500).json({ error: 'Failed to get referral credits' });
  }
});

export default router;
