const express = require('express');
const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const qrCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// WhatsApp session storage
const SESSION_FILE = './session.json';
const { state, saveState } = useSingleFileAuthState(SESSION_FILE);

// Store active WhatsApp connections
const connections = new Map();
const pairingCodes = new Map(); // 8-digit code storage

// ==================== EXPRESS SETUP ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

// ==================== 8-DIGIT CODE GENERATION ====================
function generate8DigitCode() {
    const code = Math.floor(10000000 + Math.random() * 90000000).toString();
    
    // Store with expiration (10 minutes)
    pairingCodes.set(code, {
        phone: null,
        sessionId: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + (10 * 60 * 1000),
        status: 'pending'
    });
    
    // Auto-cleanup expired codes
    setTimeout(() => {
        if (pairingCodes.has(code)) {
            pairingCodes.delete(code);
        }
    }, 10 * 60 * 1000);
    
    return code;
}

// ==================== WHATSAPP CONNECTION MANAGER ====================
async function createWhatsAppConnection(phoneNumber, pairingCode) {
    const sessionId = `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Update pairing code with session info
    if (pairingCodes.has(pairingCode)) {
        pairingCodes.set(pairingCode, {
            ...pairingCodes.get(pairingCode),
            phone: phoneNumber,
            sessionId: sessionId,
            status: 'waiting_qr'
        });
    }
    
    try {
        // Create WhatsApp socket
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: require('pino')({ level: 'silent' })
        });
        
        // Store connection
        connections.set(sessionId, {
            socket: sock,
            phone: phoneNumber,
            status: 'initializing',
            pairingCode: pairingCode
        });
        
        // Event handlers
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;
            
            if (qr) {
                console.log(`QR generated for ${phoneNumber}`);
                
                // Update pairing code with QR
                const qrImage = await qrCode.toDataURL(qr);
                if (pairingCodes.has(pairingCode)) {
                    pairingCodes.set(pairingCode, {
                        ...pairingCodes.get(pairingCode),
                        qr: qr,
                        qrImage: qrImage,
                        status: 'qr_ready'
                    });
                }
                
                // Also show in terminal
                qrcode.generate(qr, { small: true });
            }
            
            if (connection === 'open') {
                console.log(`✅ WhatsApp connected for ${phoneNumber}`);
                
                if (pairingCodes.has(pairingCode)) {
                    pairingCodes.set(pairingCode, {
                        ...pairingCodes.get(pairingCode),
                        status: 'connected',
                        connectedAt: Date.now()
                    });
                }
                
                const conn = connections.get(sessionId);
                if (conn) {
                    conn.status = 'connected';
                    connections.set(sessionId, conn);
                }
                
                // Send welcome message
                await sock.sendMessage(sock.user.id, {
                    text: `✅ IAN TECH Pairing Successful!\n\nYour device is now linked with pairing code: ${pairingCode}`
                });
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(`❌ Device logged out: ${phoneNumber}`);
                    fs.unlinkSync(SESSION_FILE);
                }
                
                // Cleanup
                connections.delete(sessionId);
                if (pairingCodes.has(pairingCode)) {
                    pairingCodes.set(pairingCode, {
                        ...pairingCodes.get(pairingCode),
                        status: 'disconnected'
                    });
                }
            }
        });
        
        sock.ev.on('creds.update', saveState);
        
        return {
            success: true,
            sessionId: sessionId,
            message: 'WhatsApp connection initialized'
        };
        
    } catch (error) {
        console.error('Connection error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// ==================== ROUTES ====================
// Home page
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>IAN TECH WhatsApp Pairing</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: Arial, sans-serif; max-width: 500px; margin: 50px auto; padding: 20px; }
            .container { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 15px; }
            input, button { width: 100%; padding: 15px; margin: 10px 0; border-radius: 8px; border: none; }
            button { background: #25D366; color: white; font-weight: bold; cursor: pointer; }
            .code { font-size: 32px; letter-spacing: 8px; background: white; color: #333; padding: 20px; text-align: center; margin: 20px 0; border-radius: 10px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🤖 IAN TECH WhatsApp Pairing</h2>
            <p>Enter your WhatsApp number to get an 8-digit pairing code</p>
            
            <form id="pairForm">
                <input type="tel" id="phone" placeholder="723278526 (without +254)" required pattern="[0-9]{9,12}">
                <button type="submit">Generate 8-Digit Code</button>
            </form>
            
            <div id="result"></div>
        </div>
        
        <script>
            document.getElementById('pairForm').onsubmit = async (e) => {
                e.preventDefault();
                const phone = document.getElementById('phone').value;
                const btn = e.target.querySelector('button');
                
                btn.disabled = true;
                btn.textContent = 'Generating Code...';
                
                try {
                    const res = await fetch('/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: phone })
                    });
                    
                    const data = await res.json();
                    
                    if (data.success) {
                        document.getElementById('result').innerHTML = \`
                            <h3>✅ Your 8-Digit Pairing Code:</h3>
                            <div class="code">\${data.code}</div>
                            <div id="qrContainer"></div>
                            <p><strong>Instructions:</strong></p>
                            <ol>
                                <li>Save this code: <strong>\${data.code}</strong></li>
                                <li>Wait for QR code to appear below</li>
                                <li>Open WhatsApp → Linked Devices</li>
                                <li>Tap "Link a Device" → Scan QR Code</li>
                            </ol>
                            <p>Status: <span id="status">Generating QR code...</span></p>
                        \`;
                        
                        // Poll for QR code
                        checkQRCode(data.code);
                    } else {
                        alert('Error: ' + data.error);
                    }
                } catch (err) {
                    alert('Server error: ' + err.message);
                }
                
                btn.disabled = false;
                btn.textContent = 'Generate 8-Digit Code';
            };
            
            async function checkQRCode(code) {
                const interval = setInterval(async () => {
                    try {
                        const res = await fetch(\`/status/\${code}\`);
                        const data = await res.json();
                        
                        document.getElementById('status').textContent = data.status;
                        
                        if (data.qrImage) {
                            document.getElementById('qrContainer').innerHTML = \`
                                <h4>📱 Scan This QR Code:</h4>
                                <img src="\${data.qrImage}" width="250" style="border: 5px solid white; border-radius: 10px;">
                                <p><small>Open WhatsApp → Linked Devices → Link a Device → Scan QR</small></p>
                            \`;
                        }
                        
                        if (data.status === 'connected') {
                            clearInterval(interval);
                            document.getElementById('result').innerHTML += \`
                                <div style="background: #25D366; padding: 15px; border-radius: 10px; margin-top: 20px;">
                                    <h3>✅ Device Paired Successfully!</h3>
                                    <p>Your WhatsApp is now linked with IAN TECH.</p>
                                </div>
                            \`;
                        }
                        
                        if (data.status === 'expired' || data.status === 'error') {
                            clearInterval(interval);
                            document.getElementById('result').innerHTML += \`
                                <div style="background: #ff4757; padding: 15px; border-radius: 10px; margin-top: 20px;">
                                    <h3>❌ \${data.status === 'expired' ? 'Code Expired' : 'Error'}</h3>
                                    <p>Please generate a new code.</p>
                                </div>
                            \`;
                        }
                    } catch (err) {
                        console.error('Polling error:', err);
                    }
                }, 2000);
            }
        </script>
    </body>
    </html>
    `);
});

// Generate pairing code
app.post('/generate', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone || !/^\d{9,12}$/.test(phone)) {
            return res.json({ 
                success: false, 
                error: 'Enter valid phone number (9-12 digits)' 
            });
        }
        
        const fullNumber = '+254' + phone;
        const pairingCode = generate8DigitCode();
        
        // Initialize WhatsApp connection
        const connectionResult = await createWhatsAppConnection(fullNumber, pairingCode);
        
        if (!connectionResult.success) {
            return res.json({
                success: false,
                error: 'Failed to initialize WhatsApp connection'
            });
        }
        
        // Update pairing code with connection info
        pairingCodes.set(pairingCode, {
            ...pairingCodes.get(pairingCode),
            phone: fullNumber,
            sessionId: connectionResult.sessionId,
            connection: connectionResult
        });
        
        res.json({
            success: true,
            code: pairingCode,
            phone: fullNumber,
            message: 'Code generated. QR will appear shortly.',
            sessionId: connectionResult.sessionId
        });
        
    } catch (error) {
        console.error('Generate error:', error);
        res.json({ 
            success: false, 
            error: 'Server error: ' + error.message 
        });
    }
});

// Check pairing status
app.get('/status/:code', (req, res) => {
    const { code } = req.params;
    
    if (!pairingCodes.has(code)) {
        return res.json({ 
            valid: false, 
            status: 'not_found',
            error: 'Code not found' 
        });
    }
    
    const codeData = pairingCodes.get(code);
    
    // Check expiration
    if (Date.now() > codeData.expiresAt) {
        pairingCodes.delete(code);
        return res.json({ 
            valid: false, 
            status: 'expired',
            error: 'Code expired' 
        });
    }
    
    res.json({
        valid: true,
        status: codeData.status || 'pending',
        phone: codeData.phone,
        qrImage: codeData.qrImage || null,
        sessionId: codeData.sessionId,
        expiresIn: Math.round((codeData.expiresAt - Date.now()) / 60000) + ' minutes'
    });
});

// List active connections
app.get('/connections', (req, res) => {
    const activeConnections = Array.from(connections.entries()).map(([id, conn]) => ({
        id: id,
        phone: conn.phone,
        status: conn.status,
        pairingCode: conn.pairingCode
    }));
    
    res.json({
        total: connections.size,
        connections: activeConnections
    });
});

// Health endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        version: '3.0.0',
        timestamp: new Date().toISOString(),
        pairingCodes: pairingCodes.size,
        connections: connections.size,
        platform: process.platform,
        memory: process.memoryUsage()
    });
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '═'.repeat(60));
    console.log('   🤖 IAN TECH WHATSAPP PAIRING SERVICE v3.0.0');
    console.log('   📱 Powered by gifted-baileys');
    console.log('   🔢 8-Digit Pairing Codes');
    console.log('═'.repeat(60));
    console.log(`✅ Server: http://0.0.0.0:${PORT}`);
    console.log(`🌐 Replit URL: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
    console.log(`📊 Health: http://0.0.0.0:${PORT}/health`);
    console.log(`🔗 Connections: http://0.0.0.0:${PORT}/connections`);
    console.log('═'.repeat(60));
    console.log('🚀 Ready to generate pairing codes!');
    console.log('═'.repeat(60));
    
    // Cleanup expired codes every minute
    setInterval(() => {
        const now = Date.now();
        for (const [code, data] of pairingCodes.entries()) {
            if (now > data.expiresAt) {
                pairingCodes.delete(code);
                console.log(`Cleaned expired code: ${code}`);
            }
        }
    }, 60 * 1000);
});
