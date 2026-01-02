const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs-extra'); // Use 'fs-extra' for better file handling

const app = express();
const PORT = process.env.PORT || 3000;

// Global variable to hold the active socket and its QR code
let activeSocket = null;
let currentQR = null;
let isQRReady = false;

// 1. Initialize ONE WhatsApp Socket on server start
async function initWhatsApp() {
    console.log('🔄 Initializing WhatsApp connection...');
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: require('pino')({ level: 'silent' }),
        browser: ["Windows", "Chrome", "114.0.5735.198"] // Crucial to avoid errors
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            console.log('✅ New QR Code Generated');
            currentQR = qr;
            isQRReady = true;
            // Also display in terminal for debugging
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'open') {
            console.log('🤖 WhatsApp Bot is ONLINE and ready.');
            isQRReady = false; // QR is no longer needed
        }
        
        if (connection === 'close') {
            console.log('❌ Connection closed. Reinitializing in 5s...');
            setTimeout(initWhatsApp, 5000);
        }
    });

    sock.ev.on('creds.update', saveCreds);
    
    activeSocket = sock;
    return sock;
}

// Start the bot client
initWhatsApp().catch(console.error);

// 2. Express Server Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 3. Routes
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>IAN TECH WhatsApp Pairing</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: Arial, sans-serif; max-width: 500px; margin: 50px auto; padding: 20px; text-align: center; }
            .container { padding: 30px; border-radius: 15px; background: #f5f5f5; }
            #qrImage { margin: 20px auto; max-width: 250px; }
            .status { padding: 10px; margin: 15px 0; border-radius: 5px; }
            .ready { background: #d4edda; } /* Green */
            .waiting { background: #fff3cd; } /* Yellow */
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🤖 IAN TECH WhatsApp Pairing</h2>
            <p>Scan the QR code below with your phone to link the bot.</p>
            
            <div id="statusDisplay" class="status waiting">
                <p>🔄 Waiting for QR code... Please refresh in a moment.</p>
            </div>
            
            <div id="qrContainer">
                <!-- QR code image will appear here via JavaScript -->
            </div>
            
            <p><strong>Instructions:</strong></p>
            <ol style="text-align: left; display: inline-block;">
                <li>Open WhatsApp on your phone</li>
                <li>Tap <strong>Settings</strong> (three dots) → <strong>Linked Devices</strong></li>
                <li>Tap <strong>Link a Device</strong> → <strong>Scan QR Code</strong></li>
                <li>Point your camera at the code above</li>
            </ol>
            <br>
            <p><small>Status refreshes automatically. The bot will stay online after linking.</small></p>
        </div>
        
        <script>
            async function updateQR() {
                try {
                    const response = await fetch('/getqr');
                    const data = await response.json();
                    
                    const statusDiv = document.getElementById('statusDisplay');
                    const qrContainer = document.getElementById('qrContainer');
                    
                    if (data.success && data.qrImage) {
                        statusDiv.className = 'status ready';
                        statusDiv.innerHTML = '<p>✅ QR Code Ready! Scan it with WhatsApp.</p>';
                        qrContainer.innerHTML = '<img id="qrImage" src="' + data.qrImage + '" alt="WhatsApp QR Code">';
                    } else {
                        statusDiv.className = 'status waiting';
                        statusDiv.innerHTML = '<p>🔄 ' + (data.message || 'Preparing connection...') + '</p>';
                        qrContainer.innerHTML = '';
                    }
                } catch (error) {
                    console.log('Polling error:', error);
                }
            }
            
            // Check for QR code every 2 seconds
            updateQR();
            setInterval(updateQR, 2000);
        </script>
    </body>
    </html>
    `);
});

// API Endpoint to get the current QR code as an image
app.get('/getqr', async (req, res) => {
    try {
        if (currentQR && isQRReady) {
            // Convert the QR code text to a data URL image
            const qrImageDataUrl = await QRCode.toDataURL(currentQR);
            res.json({ 
                success: true, 
                qrImage: qrImageDataUrl,
                message: 'Scan this QR with WhatsApp on your phone.'
            });
        } else if (activeSocket && activeSocket.user) {
            res.json({ 
                success: true, 
                qrImage: null,
                message: '✅ Bot is already online and linked! No QR needed.'
            });
        } else {
            res.json({ 
                success: false, 
                message: 'QR code not ready yet. Please wait a moment...' 
            });
        }
    } catch (error) {
        console.error('QR generation error:', error);
        res.json({ success: false, message: 'Error generating QR code.' });
    }
});

// Health endpoint
app.get('/health', (req, res) => {
    const botStatus = activeSocket && activeSocket.user ? 'online' : 'offline';
    res.json({ 
        status: 'running', 
        bot: botStatus,
        hasQR: isQRReady,
        timestamp: new Date().toISOString() 
    });
});

// 4. Start the Express Server
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n════════════════════════════════════════════');
    console.log('   🤖 IAN TECH WHATSAPP PAIRING SERVICE');
    console.log('   🔗 Server URL: http://0.0.0.0:' + PORT);
    console.log('   📱 Bot Status: Waiting for QR Scan...');
    console.log('════════════════════════════════════════════\n');
});
