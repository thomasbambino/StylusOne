import * as cron from 'node-cron';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class EPGScheduler {
  private task: cron.ScheduledTask | null = null;
  
  start() {
    // Schedule EPG updates at 3 AM and 6 AM daily
    this.task = cron.schedule('0 3,6 * * *', async () => {
      console.log('Running scheduled EPG update...');
      await this.updateEPGData();
    });
    
    console.log('EPG Scheduler started - will update at 3 AM and 6 AM daily');
    
    // Check if data is stale on startup and update if needed
    this.checkAndUpdateIfStale();
  }
  
  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('EPG Scheduler stopped');
    }
  }
  
  private async checkAndUpdateIfStale() {
    const epgFilePath = path.join(process.cwd(), 'data', 'epgshare_guide.xmltv');
    
    try {
      if (fs.existsSync(epgFilePath)) {
        const stats = fs.statSync(epgFilePath);
        const hoursSinceUpdate = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
        
        // Update if file is older than 24 hours
        if (hoursSinceUpdate > 24) {
          console.log(`EPG data is ${hoursSinceUpdate.toFixed(1)} hours old, updating...`);
          await this.updateEPGData();
        } else {
          console.log(`EPG data is ${hoursSinceUpdate.toFixed(1)} hours old, still fresh`);
        }
      } else {
        console.log('EPG data file not found, fetching...');
        await this.updateEPGData();
      }
    } catch (error) {
      console.error('Error checking EPG data freshness:', error);
    }
  }
  
  async updateEPGData(): Promise<void> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(process.cwd(), 'scripts', 'epgshare_scraper.py');
      const outputPath = path.join(process.cwd(), 'data', 'epgshare_guide.xmltv');
      const logPath = path.join(process.cwd(), 'data', 'epg_scheduler.log');
      
      const child = spawn('python3', [scriptPath, '-o', outputPath], {
        cwd: process.cwd(),
        env: process.env
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] EPG Update - Exit code: ${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}\n---\n`;
        
        // Append to log file
        fs.appendFileSync(logPath, logEntry);
        
        if (code === 0) {
          console.log('EPG data updated successfully');
          resolve();
        } else {
          console.error('EPG update failed:', stderr);
          reject(new Error(`EPG update failed with code ${code}`));
        }
      });
      
      child.on('error', (error) => {
        console.error('Failed to start EPG update process:', error);
        reject(error);
      });
    });
  }
  
  // Manual update method that can be called from an API endpoint
  async manualUpdate(): Promise<void> {
    console.log('Manual EPG update triggered');
    return this.updateEPGData();
  }
}

// Export singleton instance
export const epgScheduler = new EPGScheduler();