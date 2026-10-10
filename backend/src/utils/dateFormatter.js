const { db } = require('../database/db');
const logger = require('./logger');

// Default date format settings
const DEFAULT_FORMAT = {
  format: 'DD/MM/YYYY'
};

// Format date based on system settings
async function formatDate(date, language = 'en') {
  try {
    // Get date format setting from database
    const setting = await db('app_settings').where('setting_key', 'general_date_format').first();
    let dateConfig = DEFAULT_FORMAT;
    
    if (setting && setting.setting_value) {
      // Handle both string and object values
      if (typeof setting.setting_value === 'string') {
        try {
          dateConfig = JSON.parse(setting.setting_value);
        } catch (e) {
          logger.warn('Failed to parse date format setting:', e.message);
          dateConfig = DEFAULT_FORMAT;
        }
      } else {
        dateConfig = setting.setting_value;
      }
    }
    
    // Ensure proper date parsing
    let dateObj;
    if (date instanceof Date) {
      dateObj = date;
    } else if (typeof date === 'string') {
      // For date strings like "2025-07-16", parse as local date to avoid timezone issues
      if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Parse YYYY-MM-DD format as local date
        const [year, month, day] = date.split('-').map(num => parseInt(num, 10));
        dateObj = new Date(year, month - 1, day);
      } else {
        dateObj = new Date(date);
      }
    } else {
      dateObj = new Date(date);
    }
    
    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      logger.error('Invalid date provided to formatDate:', date);
      throw new Error('Invalid date');
    }
    
    // UI languages are Simplified Chinese and English. Keep locale tags out of
    // this formatter; numeric date order comes from the configured format.
    const locale = /^zh(?:-|$)/i.test(String(language || '')) ? 'zh-CN' : 'en';
    
    // Format based on the configured format
    switch (dateConfig.format) {
    case 'MM/DD/YYYY':
      return `${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getDate()).padStart(2, '0')}/${dateObj.getFullYear()}`;
    case 'DD/MM/YYYY':
      return `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
    case 'YYYY-MM-DD':
      return dateObj.toISOString().split('T')[0];
    case 'DD.MM.YYYY':
      return `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${dateObj.getFullYear()}`;
    default:
      // Use long format as fallback
      return dateObj.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  } catch (error) {
    logger.error('Error formatting date:', error);
    // Fallback to basic formatting
    return date instanceof Date ? date.toLocaleDateString() : new Date(date).toLocaleDateString();
  }
}

module.exports = {
  formatDate,
};
