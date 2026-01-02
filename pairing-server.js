import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import QRCode from 'qrcode';
import cors from 'cors';
import dotenv from 'dotenv';

// ==================== CONFIGURATION ====================
dotenv.config();
const app = express();

// Replit-friendly settings
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Required for Replit external access
const CODE_LENGTH = 8; // Changed from 6 to 8 digits

// ==================== SECURE MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers for Replit
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// ==================== DATABASE CONNECTION ====================
const MONGODB_URI = process.env.MONGODB_URI || 
                   'mongodb+srv://ian:heruku@cluster0.ra3cm29.mongodb.net/ian_pairing_db?retryWrites=true&w=majority&appName=Cluster0';

let isDBConnected = false;

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    isDBConnected = true;
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.log('⚠️  Using in-memory mode (MongoDB not available)');
    isDBConnected = false;
  }
};

connectDB();

// ==================== IN-MEMORY FALLBACK STORAGE ====================
// For when MongoDB isn't available (common in Replit testing)
const memoryStorage = {
  codes: new Map(),
  sessions: new Map(),
  
  generateCode() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  },
  
  saveCode(code, phone, sessionId) {
    const data = {
      phoneNumber: phone,
      pairingCode: code,
      sessionId: sessionId,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    };
    this.codes.set(code, data);
    this.sessions.set(sessionId, data);
    return data;
  },
  
  findCode(code) {
    return this.codes.get(code);
  }
};

// ==================== 8-DIGIT CODE GENERATOR ====================
const generate8DigitCode = async () => {
  // Generate 8-digit code: first ensure it's 8 digits, not starting with 0
  let code;
  let attempts = 0;
  const maxAttempts = 5;
  
  do {
    code = Math.floor(10000000 + Math.random() * 90000000).toString();
    attempts++;
    
    // Check if code exists in database (if connected)
    if (isDBConnected) {
      try {
        const PairingCode = mongoose.models.PairingCode || mongoose.model('PairingCode', pairingCodeSchema);
        const existing = await PairingCode.findOne({ 
          pairingCode: code, 
          status: 'pending',
          expiresAt: { $gt: new Date() }
        });
        if (!existing) break;
      } catch (err) {
        break; // If DB check fails, use the code
      }
    } else {
      // Check in-memory storage
      if (!memoryStorage.findCode(code)) break;
    }
  } while (attempts < maxAttempts);
  
  return code;
};

// ==================== DATABASE SCHEMAS ====================
const pairingCodeSchema = new mongoose.Schema({
  phoneNumber: String,
  pairingCode: { type: String, unique: true },
  sessionId: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 10 * 60 * 1000) }
});

let PairingCode;
try {
  PairingCode = mongoose.model('PairingCode');
} catch {
  PairingCode = mongoose.model('PairingCode', pairingCodeSchema);
}

// ==================== SIMPLIFIED HTML TEMPLATES ====================
const landingPage = `
<!DOCTYPE html>
<html>
<head>
  <title>IAN TECH - 8-Digit WhatsApp Pairing</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; }
    .container { background: #f5f5f5; padding: 30px; border-radius: 10px; }
    input, button { width: 100%; padding: 12px; margin: 10px 0; border-radius: 5px; }
    button { background: #25D366; color: white; border: none; cursor: pointer; }
    .code { font-size: 32px; letter-spacing: 10px; text-align: center; background: white; padding: 20px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h2>🔐 IAN TECH WhatsApp Pairing</h2>
    <p>Enter your phone number to get an 8-digit pairing code</p>
    <form id="pairForm">
      <input type="tel" id="phone" placeholder="723278526 (without +254)" required>
      <button type="submit">Generate 8-Digit Code</button>
    </form>
    <div id="result"></div>
  </div>
  <script>
    document.getElementById('pairForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('phone').value;
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Generating...';
      
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: phone })
        });
        const data = await response.json();
        
        if (data.success) {
          document.getElementById('result').innerHTML = \`
            <h3>✅ Your 8-Digit Code:</h3>
            <div class="code">\${data.pairingCode}</div>
            <p>Expires in 10 minutes</p>
            \${data.qrCode ? '<img src="' + data.qrCode + '" alt="QR Code" width="200">' : ''}
            <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
            <p>Enter this code: <strong>\${data.pairingCode}</strong></p>
          \`;
        } else {
          alert('Error: ' + data.error);
        }
      } catch (err) {
        alert('Network error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate 8-Digit Code';
      }
    });
  </script>
</body>
</html>
`;

// ==================== ROUTES ====================
app.get('/', (req, res) => {
  res.send(landingPage);
});

// Generate 8-digit code
app.post('/api/generate', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber || !/^\d{9,12}$/.test(phoneNumber)) {
      return res.json({ 
        success: false, 
        error: 'Enter 9-12 digit phone number' 
      });
    }
    
    const fullNumber = '+254' + phoneNumber;
    const pairingCode = await generate8DigitCode();
    const sessionId = 'SESS_' + crypto.randomBytes(4).toString('hex');
    
    let qrCodeUrl = null;
    try {
      qrCodeUrl = await QRCode.toDataURL(`WHATSAPP:${pairingCode}`);
    } catch (qrErr) {
      console.log('QR generation skipped');
    }
    
    // Save to database if connected
    if (isDBConnected) {
      try {
        const codeRecord = new PairingCode({
          phoneNumber: fullNumber,
          pairingCode,
          sessionId,
          status: 'pending'
        });
        await codeRecord.save();
      } catch (dbErr) {
        console.log('DB save failed, using memory:', dbErr.message);
        memoryStorage.saveCode(pairingCode, fullNumber, sessionId);
      }
    } else {
      memoryStorage.saveCode(pairingCode, fullNumber, sessionId);
    }
    
    res.json({
      success: true,
      pairingCode,
      fullNumber,
      sessionId,
      qrCode: qrCodeUrl,
      expiresIn: '10 minutes',
      database: isDBConnected ? 'MongoDB' : 'Memory Storage'
    });
    
  } catch (error) {
    console.error('Generate error:', error);
    res.json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Check code status
app.get('/api/check/:code', async (req, res) => {
  const { code } = req.params;
  
  if (!/^\d{8}$/.test(code)) {
    return res.json({ valid: false, reason: 'Invalid code format' });
  }
  
  if (isDBConnected) {
    try {
      const found = await PairingCode.findOne({ 
        pairingCode: code,
        status: 'pending',
        expiresAt: { $gt: new Date() }
      });
      
      if (found) {
        return res.json({ 
          valid: true, 
          phone: found.phoneNumber,
          status: found.status 
        });
      }
    } catch (err) {
      // Fall through to memory check
    }
  }
  
  // Check memory storage
  const memoryCode = memoryStorage.findCode(code);
  if (memoryCode && new Date(memoryCode.expiresAt) > new Date()) {
    return res.json({ 
      valid: true, 
      phone: memoryCode.phoneNumber,
      status: memoryCode.status 
    });
  }
  
  res.json({ valid: false, reason: 'Code not found or expired' });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    version: '3.0.0',
    codeLength: CODE_LENGTH,
    database: isDBConnected ? 'connected' : 'memory',
    timestamp: new Date().toISOString()
  });
});

// ==================== START SERVER ====================
const server = app.listen(PORT, HOST, () => {
  console.log('\n' + '═'.repeat(50));
  console.log('   🤖 IAN TECH 8-DIGIT PAIRING SERVICE');
  console.log('   🔐 8-Digit Codes | Replit Optimized');
  console.log('═'.repeat(50));
  console.log(`✅ Server: http://${HOST}:${PORT}`);
  console.log(`📱 Generate: http://localhost:${PORT}`);
  console.log(`🩺 Health: http://localhost:${PORT}/health`);
  console.log(`🗄️  Database: ${isDBConnected ? 'MongoDB ✅' : 'Memory ⚠️'}`);
  console.log(`🔢 Code Length: ${CODE_LENGTH} digits`);
  console.log('═'.repeat(50));
  console.log('🚀 Ready for Replit deployment!');
  console.log('👉 Open the Webview tab to see your pairing page');
});

// Replit-specific: Handle process termination
process.on('SIGINT', () => {
  console.log('\n🔻 Shutting down...');
  server.close(() => {
    if (mongoose.connection.readyState === 1) {
      mongoose.connection.close(false, () => {
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
});

export default app;
