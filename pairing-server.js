import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

const app = express();

// ==================== SECURITY & MIDDLEWARE ====================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-koyeb-app.koyeb.app'] 
    : ['http://localhost:3001'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limiting with enhanced configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// ==================== DATABASE CONFIGURATION ====================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ian:heruku@cluster0.ra3cm29.mongodb.net/ian_pairing_db?retryWrites=true&w=majority&appName=Cluster0';

let isDBConnected = false;

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
})
.then(() => {
  console.log('✅ MongoDB connected successfully');
  console.log('📁 Database: ian_pairing_db');
  isDBConnected = true;
})
.catch((err) => {
  console.error('❌ MongoDB connection error:', err.message);
  console.log('⚠️  Server running in limited mode (database operations disabled)');
  isDBConnected = false;
});

// ==================== DATABASE MODELS ====================
const pairingCodeSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  countryCode: {
    type: String,
    default: '+254'
  },
  fullNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  pairingCode: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  sessionId: {
    type: String,
    default: () => `IAN_TECH_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'expired', 'used'],
    default: 'pending',
    index: true
  },
  ipAddress: String,
  userAgent: String,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10 * 60 * 1000),
    index: { expireAfterSeconds: 0 }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  linkedAt: Date,
  deviceInfo: {
    platform: String,
    browser: String,
    os: String
  }
});

const botSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  phoneNumber: String,
  status: {
    type: String,
    default: 'pending',
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  lastActive: Date
});

const PairingCode = mongoose.model('PairingCode', pairingCodeSchema);
const BotSession = mongoose.model('BotSession', botSessionSchema);

// ==================== HELPER FUNCTIONS ====================
const generateUniqueCode = async () => {
  let code;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    code = Math.floor(100000 + Math.random() * 900000).toString();
    
    if (!isDBConnected) {
      isUnique = true;
      break;
    }
    
    try {
      const existing = await PairingCode.findOne({ 
        pairingCode: code, 
        status: 'pending',
        expiresAt: { $gt: new Date() }
      });
      if (!existing) isUnique = true;
    } catch (error) {
      console.warn('Database check failed, using generated code:', code);
      isUnique = true;
    }
    
    attempts++;
  }
  
  return code || Math.floor(100000 + Math.random() * 900000).toString();
};

const validatePhoneNumber = (phoneNumber) => {
  const cleanNumber = phoneNumber.replace(/\D/g, '');
  return cleanNumber.length >= 9 && cleanNumber.length <= 12 && /^\d+$/.test(cleanNumber);
};

// ==================== HTML TEMPLATES ====================
const htmlTemplates = {
  landingPage: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IAN TECH - WhatsApp Pairing Service</title>
  <style>
    /* Your existing CSS styles here - keep them exactly as you had */
  </style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
  <!-- Your existing landing page HTML here - keep it exactly as you had -->
</body>
</html>`,

  successPage: (code, phoneNumber, qrCodeUrl, expiresAt) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pairing Code Ready - IAN TECH</title>
  <style>
    /* Your existing success page CSS here - keep it exactly as you had */
  </style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
  <!-- Your existing success page HTML here - keep it exactly as you had -->
</body>
</html>`
};

// ==================== ROUTES ====================

// Landing page
app.get('/', (req, res) => {
  res.send(htmlTemplates.landingPage);
});

// Generate pairing code API
app.post('/api/generate-code', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+254' } = req.body;
    
    // Validate input
    if (!phoneNumber || !validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Please enter 9-12 digits.'
      });
    }
    
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const fullNumber = countryCode + cleanPhone;
    
    // Check for existing active code if DB is connected
    if (isDBConnected) {
      try {
        const existingCode = await PairingCode.findOne({
          fullNumber,
          status: 'pending',
          expiresAt: { $gt: new Date() }
        });
        
        if (existingCode) {
          return res.json({
            success: true,
            pairingCode: existingCode.pairingCode,
            fullNumber: existingCode.fullNumber,
            expiresAt: existingCode.expiresAt,
            message: 'Using existing active code'
          });
        }
      } catch (dbError) {
        console.warn('Database check failed:', dbError.message);
      }
    }
    
    // Generate unique code
    const pairingCode = await generateUniqueCode();
    const sessionId = `IAN_TECH_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    // Save to database if connected
    if (isDBConnected) {
      try {
        const pairingRecord = new PairingCode({
          phoneNumber: cleanPhone,
          countryCode,
          fullNumber,
          pairingCode,
          sessionId,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
          userAgent: req.get('User-Agent') || 'Unknown',
          deviceInfo: {
            platform: req.headers['sec-ch-ua-platform'] || 'Unknown',
            browser: req.get('User-Agent') || 'Unknown',
            os: 'Unknown'
          },
          expiresAt
        });
        
        await pairingRecord.save();
        
        const botSession = new BotSession({
          sessionId,
          phoneNumber: fullNumber,
          status: 'pending',
          createdAt: new Date()
        });
        
        await botSession.save();
        
      } catch (saveError) {
        console.error('Failed to save to database:', saveError.message);
        // Continue without database save
      }
    }
    
    res.json({
      success: true,
      pairingCode,
      fullNumber,
      sessionId: isDBConnected ? sessionId : 'NO_DB',
      expiresAt,
      whatsappLink: `https://wa.me/${fullNumber.replace('+', '')}?text=Your%20IAN%20TECH%20Pairing%20Code:%20${pairingCode}`,
      databaseStatus: isDBConnected ? 'connected' : 'disconnected'
    });
    
  } catch (error) {
    console.error('Error generating pairing code:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Success page
app.get('/pairing-success', async (req, res) => {
  try {
    const { code, phone } = req.query;
    
    if (!code || !phone) {
      return res.redirect('/');
    }
    
    let pairingRecord = null;
    let qrCodeUrl = null;
    
    // Try to get from database
    if (isDBConnected) {
      try {
        pairingRecord = await PairingCode.findOne({
          pairingCode: code,
          fullNumber: decodeURIComponent(phone)
        });
      } catch (dbError) {
        console.warn('Database query failed:', dbError.message);
      }
    }
    
    // Generate QR code locally
    try {
      const qrData = `WHATSAPP-PAIR:${code}`;
      qrCodeUrl = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 250
      });
    } catch (qrError) {
      console.warn('QR code generation failed:', qrError.message);
    }
    
    // Format expiry time
    let formattedExpiry = '10 minutes';
    if (pairingRecord && pairingRecord.expiresAt) {
      const expiresAt = new Date(pairingRecord.expiresAt);
      formattedExpiry = expiresAt.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    }
    
    res.send(htmlTemplates.successPage(
      code,
      decodeURIComponent(phone),
      qrCodeUrl,
      formattedExpiry
    ));
    
  } catch (error) {
    console.error('Error loading success page:', error);
    res.redirect('/');
  }
});

// Check pairing status
app.get('/api/pairing-status/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    let pairingRecord = null;
    if (isDBConnected) {
      try {
        pairingRecord = await PairingCode.findOne({ pairingCode: code });
      } catch (dbError) {
        console.warn('Database query failed:', dbError.message);
      }
    }
    
    if (!pairingRecord) {
      return res.json({
        success: false,
        error: 'Code not found or database unavailable',
        databaseStatus: isDBConnected ? 'connected' : 'disconnected'
      });
    }
    
    res.json({
      success: true,
      status: pairingRecord.status,
      phoneNumber: pairingRecord.fullNumber,
      sessionId: pairingRecord.sessionId,
      createdAt: pairingRecord.createdAt,
      expiresAt: pairingRecord.expiresAt,
      linkedAt: pairingRecord.linkedAt,
      databaseStatus: 'connected'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      databaseStatus: isDBConnected ? 'connected' : 'disconnected'
    });
  }
});

// Update pairing status
app.post('/api/pairing-linked/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    if (!isDBConnected) {
      return res.status(503).json({
        success: false,
        error: 'Database unavailable'
      });
    }
    
    const pairingRecord = await PairingCode.findOneAndUpdate(
      { pairingCode: code },
      {
        status: 'active',
        linkedAt: new Date()
      },
      { new: true }
    );
    
    if (!pairingRecord) {
      return res.status(404).json({
        success: false,
        error: 'Code not found'
      });
    }
    
    await BotSession.findOneAndUpdate(
      { sessionId: pairingRecord.sessionId },
      {
        status: 'active',
        lastActive: new Date()
      }
    );
    
    res.json({
      success: true,
      message: 'Pairing marked as active',
      phoneNumber: pairingRecord.fullNumber
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'healthy',
    service: 'IAN TECH Pairing Service',
    version: '2.1.0',
    timestamp: new Date().toISOString(),
    database: isDBConnected ? 'connected' : 'disconnected',
    memory: process.memoryUsage(),
    uptime: process.uptime()
  };
  res.json(healthStatus);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('   🤖 IAN TECH WHATSAPP PAIRING SERVICE v2.1.0');
  console.log('   🔗 Secure Device Pairing System');
  console.log('═'.repeat(60));
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Database: ${isDBConnected ? '✅ Connected' : '❌ Disconnected'}`);
  console.log(`🔧 Health check: http://localhost:${PORT}/health`);
  console.log(`📱 Generate code: http://localhost:${PORT}`);
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 Ready for deployment!');
  console.log('═'.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🔻 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    if (mongoose.connection.readyState === 1) {
      mongoose.connection.close(false, () => {
        console.log('✅ MongoDB connection closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
});

export { app, PairingCode, BotSession, verifyPairingCodeInBot };