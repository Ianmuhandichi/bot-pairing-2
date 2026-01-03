
const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys'); // This points to gifted-baileys
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== IAN TECH CONFIGURATION ====================
const CONFIG = {
  COMPANY_NAME: "IAN TECH",
  COMPANY_CONTACT: "+254724278526",
  COMPANY_EMAIL: "contact@iantech.co.ke",
  COMPANY_WEBSITE: "https://iantech.co.ke",
  SESSION_PREFIX: "IAN_TECH",
  LOGO_URL: "https://files.catbox.moe/f7f4r1.jpg", // Updated logo URL
  CODE_LENGTH: 8,
  CODE_EXPIRY_MINUTES: 10,
  DEFAULT_PHONE_EXAMPLE: "724278526", // Your contact without +254
  VERSION: "2.0.0",
  AUTHOR: "IAN TECH"
};

// ==================== GLOBAL STATE ====================
let activeSocket = null;
let currentQR = null;
let qrImageDataUrl = null;
let pairingCodes = new Map();
let botStatus = 'disconnected';
let lastGeneratedCode = null;

// ==================== UTILITY FUNCTIONS ====================
function generateAlphanumericCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  
  for (let i = 0; i < CONFIG.CODE_LENGTH; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  const hasLetters = /[A-Z]/.test(code);
  const hasNumbers = /[0-9]/.test(code);
  
  if (!hasLetters || !hasNumbers) {
    return generateAlphanumericCode();
  }
  
  return code;
}

function generateSessionId() {
  return `${CONFIG.SESSION_PREFIX}_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// ==================== WHATSAPP BOT INITIALIZATION ====================
async function initWhatsApp() {
  console.log(`${CONFIG.COMPANY_NAME} v${CONFIG.VERSION} - Initializing WhatsApp connection...`);
  console.log(`📞 Contact: ${CONFIG.COMPANY_CONTACT}`);
  botStatus = 'connecting';
  
  try {
    const authDir = path.join(__dirname, 'auth_info');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    
    let version;
    try {
      const versionInfo = await fetchLatestBaileysVersion();
      version = versionInfo.version;
      console.log(`📦 Using gifted-baileys version: ${version}`);
    } catch (versionError) {
      console.log('⚠️ Using default version for gifted-baileys');
      version = [4, 0, 0];
    }
    
    const sock = makeWASocket({
      version: version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      browser: [`${CONFIG.COMPANY_NAME} Pairing`, 'Chrome', '121.0.0.0'],
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      defaultQueryTimeoutMs: 0,
      emitOwnEvents: true,
      fireInitQueries: true,
      mobile: false,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      getMessage: async () => ({}),
      retryRequestDelayMs: 1000,
      maxRetries: 5,
      appStateMacVerification: {
        patch: false,
        snapshot: false
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;
      
      if (qr) {
        console.log(`\n✅ ${CONFIG.COMPANY_NAME} - QR Code Generated!`);
        console.log(`📱 Scan this QR code with WhatsApp`);
        currentQR = qr;
        botStatus = 'qr_ready';
        
        try {
          qrImageDataUrl = await QRCode.toDataURL(qr);
          console.log(`🌐 QR code ready for web display`);
          
          const { code } = generateNewPairingCode();
          lastGeneratedCode = code;
          console.log(`🔤 Sample pairing code: ${code}`);
          
        } catch (error) {
          console.error('QR generation error:', error.message);
        }
      }
      
      if (connection === 'open') {
        console.log(`\n✅ ${CONFIG.COMPANY_NAME} - WhatsApp Bot is ONLINE`);
        console.log(`📞 Successfully connected to WhatsApp`);
        botStatus = 'online';
        
        for (const [code, data] of pairingCodes.entries()) {
          if (data.status === 'pending') {
            data.status = 'linked';
            data.linkedAt = new Date();
            pairingCodes.set(code, data);
          }
        }
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
        
        console.log(`⚠️ Connection closed. Status: ${statusCode}`);
        
        if (shouldReconnect) {
          console.log(`🔄 Reconnecting in 5 seconds...`);
          setTimeout(initWhatsApp, 5000);
        } else {
          console.log('🔓 Logged out - cleaning session');
          if (fs.existsSync(authDir)) {
            const files = fs.readdirSync(authDir);
            files.forEach(file => {
              if (file.endsWith('.json')) {
                try {
                  fs.unlinkSync(path.join(authDir, file));
                } catch (err) {
                  console.log(`Failed to delete ${file}:`, err.message);
                }
              }
            });
          }
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', (m) => {
      if (m.type === 'notify') {
        console.log('📩 New message received');
      }
    });
    
    activeSocket = sock;
    console.log(`🤖 ${CONFIG.COMPANY_NAME} Bot client initialized`);
    return sock;
    
  } catch (error) {
    console.error(`❌ WhatsApp initialization failed:`, error.message);
    botStatus = 'error';
    console.log(`🔄 Retrying in 10 seconds...`);
    setTimeout(initWhatsApp, 10000);
  }
}

// ==================== PAIRING CODE MANAGEMENT ====================
function generateNewPairingCode(phoneNumber = null) {
  const code = generateAlphanumericCode();
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + CONFIG.CODE_EXPIRY_MINUTES * 60 * 1000);
  
  pairingCodes.set(code, {
    code: code,
    phoneNumber: phoneNumber,
    sessionId: sessionId,
    status: 'pending',
    createdAt: new Date(),
    expiresAt: expiresAt,
    linkedAt: null,
    linkedTo: null,
    qrData: currentQR,
    qrImage: qrImageDataUrl,
    attempts: 0
  });
  
  lastGeneratedCode = code;
  
  console.log(`🔤 Generated pairing code: ${code} for ${phoneNumber || 'demo'}`);
  
  setTimeout(() => {
    if (pairingCodes.has(code) && pairingCodes.get(code).status === 'pending') {
      pairingCodes.delete(code);
      console.log(`🗑️ Expired code removed: ${code}`);
    }
  }, CONFIG.CODE_EXPIRY_MINUTES * 60 * 1000);
  
  return { code, sessionId, expiresAt };
}

// ==================== EXPRESS SERVER SETUP ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ==================== ROUTES ====================
app.get('/', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>${CONFIG.COMPANY_NAME} WhatsApp Pairing</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
          :root {
              --primary-color: #25D366;
              --secondary-color: #128C7E;
              --dark-color: #075E54;
              --ian-tech-color: #1a73e8;
          }
          
          body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              margin: 0;
              padding: 20px;
              display: flex;
              align-items: center;
              justify-content: center;
          }
          
          .container {
              background: white;
              border-radius: 24px;
              padding: 40px;
              box-shadow: 0 25px 75px rgba(0,0,0,0.3);
              max-width: 550px;
              width: 100%;
              text-align: center;
          }
          
          .header {
              margin-bottom: 30px;
          }
          
          .logo-img {
              width: 100px;
              height: 100px;
              border-radius: 20px;
              object-fit: cover;
              border: 4px solid var(--ian-tech-color);
              margin-bottom: 20px;
          }
          
          h1 {
              color: var(--ian-tech-color);
              font-size: 32px;
              margin-bottom: 5px;
              font-weight: 700;
          }
          
          .company-tagline {
              color: #666;
              font-size: 16px;
              margin-bottom: 10px;
          }
          
          .contact-info {
              background: #f8f9fa;
              border-radius: 10px;
              padding: 10px;
              margin-bottom: 20px;
              font-size: 14px;
              color: #555;
          }
          
          .status-badge {
              display: inline-block;
              padding: 8px 20px;
              border-radius: 50px;
              font-weight: 600;
              margin-bottom: 20px;
          }
          
          .status-online { background: #d4edda; color: #155724; }
          .status-qr { background: #fff3cd; color: #856404; }
          .status-offline { background: #f8d7da; color: #721c24; }
          
          .pairing-code-display-area {
              background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
              color: white;
              padding: 30px;
              border-radius: 18px;
              margin: 25px 0;
              font-family: 'Courier New', monospace;
              text-align: center;
              min-height: 200px;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              border: 3px solid rgba(255,255,255,0.2);
          }
          
          .pairing-code-display {
              font-size: 56px;
              font-weight: 800;
              letter-spacing: 10px;
              margin: 20px 0;
              text-shadow: 2px 4px 8px rgba(0,0,0,0.3);
              padding: 20px;
              background: rgba(0,0,0,0.1);
              border-radius: 12px;
              min-width: 300px;
          }
          
          .code-label {
              font-size: 18px;
              font-weight: 600;
              margin-bottom: 15px;
              color: rgba(255,255,255,0.9);
          }
          
          .code-info {
              font-size: 14px;
              color: rgba(255,255,255,0.8);
              margin-top: 15px;
          }
          
          .phone-input-container {
              background: #f8f9fa;
              border-radius: 15px;
              padding: 25px;
              margin: 25px 0;
              text-align: left;
              border: 2px dashed var(--ian-tech-color);
          }
          
          .phone-input-group {
              display: flex;
              gap: 10px;
              margin-top: 15px;
          }
          
          .country-code {
              background: var(--ian-tech-color);
              color: white;
              padding: 12px 15px;
              border-radius: 10px;
              font-weight: 600;
              min-width: 80px;
              text-align: center;
          }
          
          input[type="tel"] {
              flex: 1;
              padding: 12px 20px;
              border: 2px solid #dee2e6;
              border-radius: 10px;
              font-size: 16px;
              transition: border-color 0.3s;
          }
          
          input[type="tel"]:focus {
              outline: none;
              border-color: var(--ian-tech-color);
          }
          
          .example-text {
              color: #6c757d;
              font-size: 14px;
              margin-top: 10px;
              font-style: italic;
          }
          
          .qr-container {
              margin: 30px auto;
              padding: 25px;
              background: white;
              border-radius: 18px;
              display: inline-block;
              box-shadow: 0 15px 35px rgba(0,0,0,0.1);
              border: 2px solid var(--ian-tech-color);
          }
          
          #qrImage {
              width: 280px;
              height: 280px;
              border-radius: 12px;
              border: 2px solid #eee;
          }
          
          .controls {
              display: flex;
              gap: 15px;
              justify-content: center;
              margin: 25px 0;
              flex-wrap: wrap;
          }
          
          .btn {
              padding: 16px 32px;
              border-radius: 50px;
              border: none;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.3s ease;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 10px;
              min-width: 200px;
          }
          
          .btn-primary {
              background: linear-gradient(135deg, var(--ian-tech-color) 0%, #0d47a1 100%);
              color: white;
          }
          
          .btn-secondary {
              background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
              color: white;
          }
          
          .btn:hover {
              transform: translateY(-3px);
              box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          }
          
          .instructions {
              background: #f8f9fa;
              border-radius: 15px;
              padding: 25px;
              margin-top: 30px;
              text-align: left;
              border-left: 4px solid var(--ian-tech-color);
          }
          
          .notification {
              position: fixed;
              top: 20px;
              right: 20px;
              background: var(--ian-tech-color);
              color: white;
              padding: 18px 28px;
              border-radius: 12px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.2);
              display: none;
              z-index: 1000;
          }
          
          .footer {
              margin-top: 30px;
              color: #888;
              font-size: 14px;
              border-top: 1px solid #eee;
              padding-top: 20px;
          }
          
          .footer a {
              color: var(--ian-tech-color);
              text-decoration: none;
          }
          
          @media (max-width: 600px) {
              .container { padding: 25px; }
              .pairing-code-display { font-size: 36px; letter-spacing: 5px; min-width: 250px; }
              .controls { flex-direction: column; }
              .btn { width: 100%; }
              .phone-input-group { flex-direction: column; }
          }
      </style>
  </head>
  <body>
      <div class="notification" id="notification"></div>
      
      <div class="container">
          <div class="header">
              <img src="${CONFIG.LOGO_URL}" alt="${CONFIG.COMPANY_NAME} Logo" class="logo-img">
              <h1>${CONFIG.COMPANY_NAME}</h1>
              <p class="company-tagline">WhatsApp Device Pairing Service v${CONFIG.VERSION}</p>
              
              <div class="contact-info">
                  📞 ${CONFIG.COMPANY_CONTACT} | 📧 ${CONFIG.COMPANY_EMAIL}
              </div>
              
              <div id="statusBadge" class="status-badge status-offline">
                  <span id="statusText">Connecting...</span>
              </div>
          </div>
          
          <div class="pairing-code-display-area">
              <div class="code-label">📱 Your WhatsApp Pairing Code</div>
              <div id="pairingCodeDisplay" class="pairing-code-display">A1B2C3D4</div>
              <div id="codeInfo" class="code-info">
                  <div>Enter phone number below and click "Generate Code"</div>
                  <div id="expiryTimer" style="margin-top: 10px;">Code will expire in 10:00</div>
              </div>
          </div>
          
          <div class="phone-input-container">
              <h3 style="color: var(--ian-tech-color); margin-bottom: 15px;">
                  <span>📱</span> Enter Your WhatsApp Number
              </h3>
              <p style="color: #6c757d; margin-bottom: 15px;">
                  Enter your Kenyan phone number to receive a pairing code
              </p>
              
              <div class="phone-input-group">
                  <div class="country-code">+254</div>
                  <input 
                      type="tel" 
                      id="phoneNumber" 
                      placeholder="${CONFIG.DEFAULT_PHONE_EXAMPLE}"
                      pattern="[0-9]{9}"
                      maxlength="9"
                      title="Enter 9-digit Kenyan phone number"
                      value="${CONFIG.DEFAULT_PHONE_EXAMPLE}"
                  >
              </div>
              
              <p class="example-text">Example: ${CONFIG.DEFAULT_PHONE_EXAMPLE} (IAN TECH contact)</p>
          </div>
          
          <div id="qrSection" style="display: none;">
              <div class="qr-container">
                  <h3 style="color: var(--ian-tech-color);">Scan QR Code</h3>
                  <img id="qrImage" alt="WhatsApp QR Code">
                  <p style="color: #666; margin-top: 15px;">
                      Open WhatsApp → Linked Devices → Scan QR Code
                  </p>
              </div>
          </div>
          
          <div class="controls">
              <button class="btn btn-primary" onclick="generatePairingCode()">
                  <span>🔢</span> Generate Pairing Code
              </button>
              <button class="btn btn-secondary" onclick="showQRCode()">
                  <span>📱</span> Show QR Code
              </button>
              <button class="btn" onclick="copyToClipboard()" style="background: #6c757d; color: white;">
                  <span>📋</span> Copy Code
              </button>
          </div>
          
          <div class="instructions">
              <h4 style="color: var(--ian-tech-color);">How to Use Your Pairing Code</h4>
              <p><strong>Step 1:</strong> Enter your phone number above</p>
              <p><strong>Step 2:</strong> Click "Generate Pairing Code"</p>
              <p><strong>Step 3:</strong> Your 8-digit code appears in the green box above</p>
              <p><strong>Step 4:</strong> Open WhatsApp on your phone</p>
              <p><strong>Step 5:</strong> Go to: <strong>Settings → Linked Devices → Link a Device</strong></p>
              <p><strong>Step 6:</strong> Tap <strong>"Use pairing code instead"</strong></p>
              <p><strong>Step 7:</strong> Enter the 8-digit code: <span id="exampleCode">A1B2C3D4</span></p>
          </div>
          
          <div class="footer">
              <p>🔒 Secure Connection | ⚡ Powered by <a href="${CONFIG.COMPANY_WEBSITE}" target="_blank">${CONFIG.COMPANY_NAME}</a></p>
              <p>📞 Need help? Contact: <a href="tel:${CONFIG.COMPANY_CONTACT}">${CONFIG.COMPANY_CONTACT}</a></p>
          </div>
      </div>
      
      <script>
          let currentCode = '';
          let currentPhone = '';
          let expiryInterval = null;
          
          document.getElementById('phoneNumber').addEventListener('input', function(e) {
              let value = e.target.value.replace(/\\D/g, '');
              if (value.length > 3 && value.length <= 6) {
                  value = value.replace(/(\\d{3})(\\d+)/, '$1 $2');
              } else if (value.length > 6) {
                  value = value.replace(/(\\d{3})(\\d{3})(\\d+)/, '$1 $2 $3');
              }
              e.target.value = value;
          });
          
          function validatePhoneNumber(phone) {
              const cleanPhone = phone.replace(/\\D/g, '');
              return cleanPhone.length === 9 && /^[0-9]+$/.test(cleanPhone);
          }
          
          async function generatePairingCode() {
              const phoneInput = document.getElementById('phoneNumber');
              const phone = phoneInput.value.replace(/\\D/g, '');
              
              if (!validatePhoneNumber(phone)) {
                  showNotification('❌ Please enter a valid 9-digit Kenyan phone number', 'error');
                  phoneInput.focus();
                  return;
              }
              
              try {
                  const response = await fetch('/generate-code', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phoneNumber: phone })
                  });
                  
                  const data = await response.json();
                  
                  if (data.success) {
                      currentCode = data.code;
                      currentPhone = data.phoneNumber;
                      
                      document.getElementById('pairingCodeDisplay').textContent = currentCode;
                      document.getElementById('exampleCode').textContent = currentCode;
                      
                      document.getElementById('codeInfo').innerHTML = \`
                          <div>Generated for: <strong>\${currentPhone}</strong></div>
                          <div id="expiryTimer" style="margin-top: 10px;">Expires in 10:00</div>
                      \`;
                      
                      document.getElementById('qrSection').style.display = 'none';
                      
                      startExpiryTimer(data.expiresAt);
                      
                      showNotification(\`✅ IAN TECH: Pairing code generated for \${currentPhone}\`, 'success');
                      
                      setTimeout(copyToClipboard, 1000);
                      
                  } else {
                      showNotification('❌ IAN TECH: ' + (data.message || 'Failed to generate code'), 'error');
                  }
              } catch (error) {
                  showNotification('❌ IAN TECH: Network error. Please try again.', 'error');
              }
          }
          
          async function showQRCode() {
              const phoneInput = document.getElementById('phoneNumber');
              const phone = phoneInput.value.replace(/\\D/g, '');
              
              if (!validatePhoneNumber(phone)) {
                  showNotification('❌ IAN TECH: Please enter your phone number first', 'error');
                  phoneInput.focus();
                  return;
              }
              
              try {
                  const response = await fetch('/getqr', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phoneNumber: phone })
                  });
                  
                  const data = await response.json();
                  
                  if (data.success) {
                      if (data.qrImage) {
                          document.getElementById('qrImage').src = data.qrImage;
                          document.getElementById('qrSection').style.display = 'block';
                      }
                      
                      if (data.pairingCode) {
                          currentCode = data.pairingCode;
                          currentPhone = data.phoneNumber;
                          document.getElementById('pairingCodeDisplay').textContent = currentCode;
                          document.getElementById('exampleCode').textContent = currentCode;
                          
                          document.getElementById('codeInfo').innerHTML = \`
                              <div>Generated for: <strong>\${currentPhone}</strong></div>
                              <div id="expiryTimer" style="margin-top: 10px;">Expires in 10:00</div>
                          \`;
                          
                          if (data.expiresAt) {
                              startExpiryTimer(data.expiresAt);
                          }
                      }
                      
                      showNotification(\`✅ IAN TECH: \${data.message || 'QR Code ready'}\`, 'success');
                  } else {
                      showNotification(\`⚠️ IAN TECH: \${data.message || 'QR code not available'}\`, 'warning');
                  }
              } catch (error) {
                  showNotification('❌ IAN TECH: Error loading QR code', 'error');
              }
          }
          
          function copyToClipboard() {
              if (!currentCode) {
                  showNotification('❌ IAN TECH: No code to copy', 'warning');
                  return;
              }
              
              navigator.clipboard.writeText(currentCode).then(() => {
                  showNotification(\`✅ IAN TECH: Copied to clipboard: \${currentCode}\`, 'success');
              }).catch(err => {
                  showNotification('❌ IAN TECH: Could not copy to clipboard', 'error');
              });
          }
          
          function startExpiryTimer(expiryTime) {
              if (expiryInterval) clearInterval(expiryInterval);
              
              const expiryDate = new Date(expiryTime);
              
              function updateTimer() {
                  const now = new Date();
                  const diff = expiryDate - now;
                  
                  if (diff <= 0) {
                      document.getElementById('expiryTimer').textContent = 'CODE EXPIRED';
                      clearInterval(expiryInterval);
                      showNotification('⚠️ IAN TECH: This pairing code has expired. Generate a new one.', 'warning');
                      return;
                  }
                  
                  const minutes = Math.floor(diff / 60000);
                  const seconds = Math.floor((diff % 60000) / 1000);
                  
                  document.getElementById('expiryTimer').textContent = 
                      \`Expires in \${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
              }
              
              updateTimer();
              expiryInterval = setInterval(updateTimer, 1000);
          }
          
          function showNotification(message, type) {
              const notification = document.getElementById('notification');
              notification.textContent = message;
              
              if (type === 'success') {
                  notification.style.background = 'linear-gradient(135deg, var(--ian-tech-color) 0%, #0d47a1 100%)';
              } else if (type === 'error') {
                  notification.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #c92a2a 100%)';
              } else if (type === 'warning') {
                  notification.style.background = 'linear-gradient(135deg, #ffa502 0%, #ff7f00 100%)';
              }
              
              notification.style.display = 'block';
              
              setTimeout(() => {
                  notification.style.display = 'none';
              }, 3000);
          }
          
          setInterval(async () => {
              try {
                  const response = await fetch('/status');
                  const data = await response.json();
                  
                  const statusBadge = document.getElementById('statusBadge');
                  const statusText = document.getElementById('statusText');
                  
                  if (data.bot === 'online') {
                      statusBadge.className = 'status-badge status-online';
                      statusText.textContent = '✅ IAN TECH - ONLINE';
                  } else if (data.bot === 'qr_ready') {
                      statusBadge.className = 'status-badge status-qr';
                      statusText.textContent = '📱 IAN TECH - QR READY';
                  } else if (data.bot === 'connecting') {
                      statusBadge.className = 'status-badge status-offline';
                      statusText.textContent = '🔄 IAN TECH - CONNECTING...';
                  } else {
                      statusBadge.className = 'status-badge status-offline';
                      statusText.textContent = '❌ IAN TECH - OFFLINE';
                  }
              } catch (error) {
                  console.log('Status check error:', error);
              }
          }, 5000);
          
          fetch('/status')
              .then(res => res.json())
              .then(data => {
                  if (data.lastCode) {
                      currentCode = data.lastCode;
                      document.getElementById('pairingCodeDisplay').textContent = currentCode;
                      document.getElementById('exampleCode').textContent = currentCode;
                      document.getElementById('codeInfo').innerHTML = \`
                          <div>Last generated code</div>
                          <div id="expiryTimer" style="margin-top: 10px;">Generate new code</div>
                      \`;
                  }
              })
              .catch(err => console.log('Initial status check failed:', err));
      </script>
  </body>
  </html>
  `);
});

// ==================== API ENDPOINTS ====================
app.post('/generate-code', (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber || !/^[0-9]{9}$/.test(phoneNumber)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please enter a valid 9-digit Kenyan phone number' 
      });
    }
    
    if (botStatus !== 'qr_ready' && botStatus !== 'online') {
      return res.status(503).json({ 
        success: false, 
        message: 'WhatsApp connection not ready. Please wait for QR code...' 
      });
    }
    
    const phoneWithCountryCode = '+254' + phoneNumber;
    const { code, sessionId, expiresAt } = generateNewPairingCode(phoneWithCountryCode);
    
    res.json({ 
      success: true, 
      code: code,
      phoneNumber: phoneWithCountryCode,
      sessionId: sessionId,
      expiresAt: expiresAt,
      message: 'IAN TECH: Pairing code generated successfully'
    });
  } catch (error) {
    console.error('Code generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'IAN TECH: Error generating pairing code',
      error: error.message 
    });
  }
});

app.post('/getqr', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber || !/^[0-9]{9}$/.test(phoneNumber)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please enter a valid 9-digit Kenyan phone number' 
      });
    }
    
    const phoneWithCountryCode = '+254' + phoneNumber;
    
    if (botStatus === 'qr_ready' && currentQR) {
      try {
        if (!qrImageDataUrl) {
          qrImageDataUrl = await QRCode.toDataURL(currentQR);
        }
        
        const { code, sessionId, expiresAt } = generateNewPairingCode(phoneWithCountryCode);
        
        res.json({ 
          success: true, 
          qrImage: qrImageDataUrl,
          pairingCode: code,
          phoneNumber: phoneWithCountryCode,
          sessionId: sessionId,
          expiresAt: expiresAt,
          message: 'IAN TECH: QR code ready for scanning'
        });
      } catch (qrError) {
        console.error('QR generation error:', qrError);
        res.status(500).json({ 
          success: false, 
          message: 'IAN TECH: Error generating QR image',
          error: qrError.message 
        });
      }
    } else if (botStatus === 'online') {
      const { code, sessionId, expiresAt } = generateNewPairingCode(phoneWithCountryCode);
      
      res.json({ 
        success: true, 
        qrImage: null,
        pairingCode: code,
        phoneNumber: phoneWithCountryCode,
        sessionId: sessionId,
        expiresAt: expiresAt,
        message: 'IAN TECH: Bot is online. Use the pairing code to link.'
      });
    } else {
      res.status(503).json({ 
        success: false, 
        message: 'IAN TECH: QR code not ready yet. Please wait...' 
      });
    }
  } catch (error) {
    console.error('QR endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'IAN TECH: Internal server error',
      error: error.message 
    });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    bot: botStatus,
    hasQR: botStatus === 'qr_ready',
    pairingCodes: pairingCodes.size,
    lastCode: lastGeneratedCode,
    company: CONFIG.COMPANY_NAME,
    contact: CONFIG.COMPANY_CONTACT,
    version: CONFIG.VERSION,
    usingGiftedBaileys: true,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    company: CONFIG.COMPANY_NAME,
    version: CONFIG.VERSION,
    bot: botStatus,
    qrReady: botStatus === 'qr_ready',
    codes: pairingCodes.size,
    lastGeneratedCode: lastGeneratedCode,
    contact: CONFIG.COMPANY_CONTACT,
    uptime: process.uptime()
  });
});

app.get('/ian-tech', (req, res) => {
  res.json({
    company: CONFIG.COMPANY_NAME,
    service: 'WhatsApp Pairing Service',
    version: CONFIG.VERSION,
    contact: CONFIG.COMPANY_CONTACT,
    email: CONFIG.COMPANY_EMAIL,
    website: CONFIG.COMPANY_WEBSITE,
    status: 'operational'
  });
});

// ==================== START SERVER ====================
initWhatsApp();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '═'.repeat(70));
  console.log(`   🤖 ${CONFIG.COMPANY_NAME} WHATSAPP PAIRING SERVICE v${CONFIG.VERSION}`);
  console.log('   ' + '─'.repeat(68));
  console.log(`   📞 Contact: ${CONFIG.COMPANY_CONTACT}`);
  console.log(`   🌐 Website: ${CONFIG.COMPANY_WEBSITE}`);
  console.log(`   📧 Email: ${CONFIG.COMPANY_EMAIL}`);
  console.log('   ' + '─'.repeat(68));
  console.log(`   🔗 Using: gifted-baileys (via @whiskeysockets/baileys alias)`);
  console.log(`   🌐 Server: http://0.0.0.0:${PORT}`);
  console.log(`   📍 Local: http://localhost:${PORT}`);
  console.log(`   📱 Status: http://localhost:${PORT}/status`);
  console.log(`   🏥 Health: http://localhost:${PORT}/health`);
  console.log(`   ℹ️  Info: http://localhost:${PORT}/ian-tech`);
  console.log('═'.repeat(70));
  console.log('🚀 IAN TECH Pairing Server started successfully!');
  console.log('📱 Check CONSOLE for QR code to scan with WhatsApp');
  console.log('═'.repeat(70));
});

process.on('SIGINT', () => {
  console.log(`\n🛑 ${CONFIG.COMPANY_NAME} - Shutting down gracefully...`);
  
  if (activeSocket) {
    activeSocket.end();
  }
  
  server.close(() => {
    console.log(`✅ ${CONFIG.COMPANY_NAME} Server closed`);
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  console.error(`❌ ${CONFIG.COMPANY_NAME} - Uncaught Exception:`, error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`❌ ${CONFIG.COMPANY_NAME} - Unhandled Rejection at:`, promise);
});
