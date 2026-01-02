
import express from 'express';
import QRCode from 'qrcode';

const app = express();
const PORT = process.env.PORT || 3000;
const codes = new Map(); // Simple in-memory storage

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Generate 8-digit code
function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

// Home page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp Pairing</title>
      <style>
        body { font-family: Arial; max-width: 400px; margin: 50px auto; padding: 20px; }
        input, button { width: 100%; padding: 10px; margin: 10px 0; }
        .code { font-size: 28px; letter-spacing: 5px; background: #f0f0f0; padding: 15px; text-align: center; margin: 20px 0; }
      </style>
    </head>
    <body>
      <h2>🔐 WhatsApp Pairing Code</h2>
      <form id="pairForm">
        <input type="text" id="phone" placeholder="Phone number (e.g., 723278526)" required>
        <button type="submit">Generate 8-Digit Code</button>
      </form>
      <div id="result"></div>
      <script>
        document.getElementById('pairForm').onsubmit = async (e) => {
          e.preventDefault();
          const phone = document.getElementById('phone').value;
          const btn = e.target.querySelector('button');
          
          btn.disabled = true;
          btn.textContent = 'Generating...';
          
          try {
            const res = await fetch('/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone })
            });
            const data = await res.json();
            
            if (data.success) {
              document.getElementById('result').innerHTML = \`
                <h3>✅ Your 8-Digit Code:</h3>
                <div class="code">\${data.code}</div>
                <div id="qrCode"></div>
                <p><strong>Instructions:</strong></p>
                <ol>
                  <li>Open WhatsApp on your phone</li>
                  <li>Go to Settings → Linked Devices</li>
                  <li>Tap "Link a Device"</li>
                  <li>Enter this code: <strong>\${data.code}</strong></li>
                </ol>
              \`;
              
              // Show QR code
              if (data.qr) {
                document.getElementById('qrCode').innerHTML = \`<img src="\${data.qr}" width="200"><br><small>Scan with WhatsApp</small>\`;
              }
            } else {
              alert('Error: ' + data.error);
            }
          } catch (err) {
            alert('Server error');
          }
          
          btn.disabled = false;
          btn.textContent = 'Generate 8-Digit Code';
        };
      </script>
    </body>
    </html>
  `);
});

// Generate code endpoint
app.post('/generate', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone || !/^\d{9,12}$/.test(phone)) {
      return res.json({ 
        success: false, 
        error: 'Enter 9-12 digit phone number' 
      });
    }
    
    const code = generate8DigitCode();
    const fullNumber = '+254' + phone;
    
    // Store in memory (expires in 10 minutes)
    codes.set(code, {
      phone: fullNumber,
      code: code,
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000)
    });
    
    // Generate QR code
    let qrCode = null;
    try {
      qrCode = await QRCode.toDataURL(`WHATSAPP:${code}`);
    } catch (qrErr) {
      console.log('QR generation skipped');
    }
    
    res.json({
      success: true,
      code: code,
      phone: fullNumber,
      qr: qrCode,
      expiresIn: '10 minutes',
      message: 'Open WhatsApp → Settings → Linked Devices → Link a Device'
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.json({ success: false, error: 'Server error' });
  }
});

// Check code endpoint
app.get('/check/:code', (req, res) => {
  const { code } = req.params;
  const data = codes.get(code);
  
  if (!data) {
    return res.json({ valid: false, reason: 'Code not found' });
  }
  
  if (Date.now() > data.expiresAt) {
    codes.delete(code);
    return res.json({ valid: false, reason: 'Code expired' });
  }
  
  res.json({ 
    valid: true, 
    phone: data.phone,
    expiresIn: Math.round((data.expiresAt - Date.now()) / 60000) + ' minutes'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'running',
    codesStored: codes.size,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n════════════════════════════════════════════');
  console.log('   ✅ WhatsApp Pairing Server Running');
  console.log('   🔢 8-Digit Codes | No Database Required');
  console.log('════════════════════════════════════════════');
  console.log(`🌐 Open: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
  console.log(`📡 Local: http://0.0.0.0:${PORT}`);
  console.log(`🩺 Health: /health`);
  console.log('════════════════════════════════════════════\n');
});
