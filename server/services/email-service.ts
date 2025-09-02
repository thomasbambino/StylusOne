import { IService } from './interfaces';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';
import { emailTemplates } from '@shared/schema';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import FormData from 'form-data';

/**
 * Interface for email attachment
 */
export interface EmailAttachment {
  filename: string;
  data: Buffer;
  contentType?: string;
}

/**
 * Interface for email parameters
 */
export interface EmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  templateId?: number;
  templateData?: Record<string, any>;
  attachments?: EmailAttachment[];
}

/**
 * Service for handling email sending
 */
export class EmailService implements IService {
  private mailgunDomain: string;
  private mailgunApiKey: string;
  private mailgunRegion: string;
  private sendgridApiKey: string;
  private emailProvider: 'mailgun' | 'sendgrid' | 'none' = 'none';
  private fromEmail: string;
  private fromName: string;
  private initialized: boolean = false;

  constructor() {
    this.mailgunDomain = process.env.MAILGUN_DOMAIN || '';
    this.mailgunApiKey = process.env.MAILGUN_API_KEY || '';
    this.mailgunRegion = process.env.MAILGUN_REGION || 'us';
    this.sendgridApiKey = process.env.SENDGRID_API_KEY || '';
    // Use KINDLE_SENDER_EMAIL if available, otherwise fall back to EMAIL_FROM
    this.fromEmail = process.env.KINDLE_SENDER_EMAIL || process.env.EMAIL_FROM || '';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Homelab Dashboard';
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    // Determine which email provider to use
    if (this.mailgunDomain && this.mailgunApiKey) {
      this.emailProvider = 'mailgun';
      console.log('Using Mailgun for email delivery');
    } else if (this.sendgridApiKey) {
      this.emailProvider = 'sendgrid';
      console.log('Using SendGrid for email delivery');
    } else {
      this.emailProvider = 'none';
      console.warn('No email provider configured');
    }

    // Create default email templates if they don't exist
    await this.setupDefaultTemplates();
    
    this.initialized = true;
    console.log('Email service initialized');
  }

  /**
   * Reinitialize the service with new configuration
   */
  async reinitialize(config?: {
    mailgunDomain?: string;
    mailgunApiKey?: string;
    mailgunRegion?: string;
    sendgridApiKey?: string;
    fromEmail?: string;
    fromName?: string;
  }): Promise<void> {
    if (config) {
      if (config.mailgunDomain) this.mailgunDomain = config.mailgunDomain;
      if (config.mailgunApiKey) this.mailgunApiKey = config.mailgunApiKey;
      if (config.mailgunRegion) this.mailgunRegion = config.mailgunRegion;
      if (config.sendgridApiKey) this.sendgridApiKey = config.sendgridApiKey;
      if (config.fromEmail) this.fromEmail = config.fromEmail;
      if (config.fromName) this.fromName = config.fromName;
    }
    
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    return this.emailProvider !== 'none';
  }

  /**
   * Get the absolute URL for a path
   */
  private getAbsoluteUrl(path: string): string {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /**
   * Send an email
   */
  async sendEmail(params: EmailParams): Promise<boolean> {
    // If using a template, compile it first
    if (params.templateId && params.templateData) {
      const compiled = await this.getCompiledTemplate(params.templateId, params.templateData);
      if (compiled) {
        params.subject = compiled.subject;
        params.html = compiled.html;
      }
    }

    // Validate required fields
    if (!params.to || !params.subject || (!params.text && !params.html)) {
      console.error('Missing required email fields');
      return false;
    }

    // Determine which email provider to use
    switch (this.emailProvider) {
      case 'mailgun':
        return this.sendWithMailgun(params);
      case 'sendgrid':
        return this.sendWithSendgrid(params);
      default:
        console.warn('No email provider configured, email not sent');
        return false;
    }
  }

  /**
   * Send an email using Mailgun
   */
  private async sendWithMailgun(params: EmailParams): Promise<boolean> {
    try {
      console.log('Sending email via Mailgun:');
      console.log('  From:', `${this.fromName} <${this.fromEmail}>`);
      console.log('  To:', params.to);
      console.log('  Subject:', params.subject);
      console.log('  Attachments:', params.attachments?.length || 0);
      
      const formData = new FormData();
      formData.append('from', `${this.fromName} <${this.fromEmail}>`);
      formData.append('to', params.to);
      formData.append('subject', params.subject);
      
      if (params.text) {
        formData.append('text', params.text);
      }
      
      if (params.html) {
        formData.append('html', params.html);
      }

      // Add attachments if provided
      if (params.attachments && params.attachments.length > 0) {
        for (const attachment of params.attachments) {
          formData.append('attachment', attachment.data, {
            filename: attachment.filename,
            contentType: attachment.contentType || 'application/octet-stream'
          });
        }
      }

      const endpoint = this.mailgunRegion === 'eu' 
        ? 'https://api.eu.mailgun.net/v3'
        : 'https://api.mailgun.net/v3';
      
      const url = `${endpoint}/${this.mailgunDomain}/messages`;
      const auth = {
        username: 'api',
        password: this.mailgunApiKey
      };

      const response = await axios.post(url, formData, {
        auth,
        headers: formData.getHeaders()
      });

      console.log('Mailgun API response:', response.data);
      return true;
    } catch (error: any) {
      console.error('Error sending email with Mailgun:', error);
      if (error.response) {
        console.error('Mailgun error response status:', error.response.status);
        console.error('Mailgun error response data:', error.response.data);
        console.error('Mailgun error response headers:', error.response.headers);
      }
      return false;
    }
  }

  /**
   * Send an email using SendGrid
   */
  private async sendWithSendgrid(params: EmailParams): Promise<boolean> {
    try {
      const data = {
        personalizations: [
          {
            to: [{ email: params.to }],
            subject: params.subject
          }
        ],
        from: {
          email: this.fromEmail,
          name: this.fromName
        },
        content: []
      };

      if (params.text) {
        data.content.push({
          type: 'text/plain',
          value: params.text
        });
      }

      if (params.html) {
        data.content.push({
          type: 'text/html',
          value: params.html
        });
      }

      const response = await axios.post('https://api.sendgrid.com/v3/mail/send', data, {
        headers: {
          'Authorization': `Bearer ${this.sendgridApiKey}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('SendGrid API response status:', response.status);
      return true;
    } catch (error) {
      console.error('Error sending email with SendGrid:', error);
      return false;
    }
  }

  /**
   * Compile a template with data
   */
  compileTemplate(template: string, data: Record<string, any>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const keys = key.trim().split('.');
      let value = data;
      
      for (const k of keys) {
        value = value && value[k];
        if (value === undefined) break;
      }
      
      return value !== undefined ? value : match;
    });
  }

  /**
   * Get a compiled template
   */
  async getCompiledTemplate(templateId: number, data: Record<string, any>): Promise<{ subject: string; html: string } | null> {
    try {
      const [template] = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.id, templateId));

      if (!template) {
        console.error(`Email template with id ${templateId} not found`);
        return null;
      }

      const subject = this.compileTemplate(template.subject, data);
      const html = this.compileTemplate(template.template, data);

      return { subject, html };
    } catch (error) {
      console.error('Error getting compiled template:', error);
      return null;
    }
  }

  /**
   * Setup default email templates
   */
  private async setupDefaultTemplates(): Promise<void> {
    try {
      const templates = await db.select().from(emailTemplates);
      
      // If we have no templates, create the default ones
      if (templates.length === 0) {
        console.log('Creating default email templates');
        
        const defaultTemplates = [
          {
            name: 'Welcome',
            subject: 'Welcome to {{appName}}',
            template: `
              <h1>Welcome to {{appName}}!</h1>
              <p>Hello {{username}},</p>
              <p>Your account has been created and you can now log in to your dashboard.</p>
              <p>If you have any questions, please don't hesitate to contact us.</p>
              <p>Best regards,<br>The {{appName}} Team</p>
            `
          },
          {
            name: 'Password Reset',
            subject: 'Password Reset Request',
            template: `
              <h1>Password Reset</h1>
              <p>Hello {{username}},</p>
              <p>You have requested to reset your password. Please click the link below to set a new password:</p>
              <p><a href="{{resetLink}}">Reset Password</a></p>
              <p>If you did not request this, please ignore this email or contact support if you have concerns.</p>
              <p>Best regards,<br>The {{appName}} Team</p>
            `
          },
          {
            name: 'Account Approved',
            subject: 'Your Account Has Been Approved',
            template: `
              <h1>Account Approved</h1>
              <p>Hello {{username}},</p>
              <p>Your account has been approved by an administrator. You can now log in and access all features.</p>
              <p><a href="{{loginLink}}">Login Now</a></p>
              <p>Best regards,<br>The {{appName}} Team</p>
            `
          },
          {
            name: 'New Game Server Request',
            subject: 'New Game Server Request',
            template: `
              <h1>New Game Server Request</h1>
              <p>Hello Admin,</p>
              <p>A user has requested a new game server:</p>
              <ul>
                <li><strong>User:</strong> {{username}}</li>
                <li><strong>Game:</strong> {{game}}</li>
                <li><strong>Requested At:</strong> {{requestDate}}</li>
              </ul>
              <p>Please log in to the dashboard to review this request.</p>
              <p><a href="{{adminLink}}">Go to Admin Dashboard</a></p>
            `
          }
        ];
        
        for (const template of defaultTemplates) {
          await db.insert(emailTemplates).values(template);
        }
        
        console.log('Default email templates created');
      }
    } catch (error) {
      console.error('Error setting up default email templates:', error);
    }
  }
}

// Export a singleton instance
export const emailService = new EmailService();