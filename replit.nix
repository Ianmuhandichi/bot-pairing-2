# IAN TECH WhatsApp Pairing Service
# Nix package configuration for Replit

{ pkgs }: {
  deps = [
    # Node.js runtime
    pkgs.nodejs_20
    
    # Python (optional, for some utilities)
    pkgs.python3
    
    # FFmpeg for media processing
    pkgs.ffmpeg
    
    # Git for version control
    pkgs.git
    
    # Build tools
    pkgs.gnumake
    pkgs.gcc
    
    # System utilities
    pkgs.coreutils
    pkgs.bash
    pkgs.curl
    pkgs.wget
    
    # Development tools
    pkgs.vim
    pkgs.tree
    
    # WhatsApp pairing dependencies
    pkgs.openssl
    pkgs.zlib
    
    # QR code tools
    pkgs.qrencode
    
    # PM2 process manager
    pkgs.nodePackages.pm2
    
    # Nodemon for development
    pkgs.nodePackages.nodemon
  ];
  
  # Environment variables
  env = {
    # IAN TECH Configuration
    COMPANY_NAME = "IAN TECH";
    CONTACT_PHONE = "+254724278526";
    COMPANY_EMAIL = "contact@iantech.co.ke";
    COMPANY_WEBSITE = "https://iantech.co.ke";
    
    # Server Configuration
    PORT = "5000";
    NODE_ENV = "production";
    
    # Node.js configuration
    NODE_OPTIONS = "--max-old-space-size=512";
    NODE_ENV = "production";
    
    # Path configuration
    PATH = "/home/runner/.npm-packages/bin:$PATH";
  };
  
  # Shell configuration
  shellHook = ''
    # Display IAN TECH banner
    echo "╔══════════════════════════════════════════════════╗"
    echo "║            IAN TECH WhatsApp Pairing             ║"
    echo "║               Deployment System                  ║"
    echo "╠══════════════════════════════════════════════════╣"
    echo "║ 📞 Contact: +254724278526                        ║"
    echo "║ 🌐 Website: https://iantech.co.ke                ║"
    echo "║ 🚀 Service: WhatsApp Pairing v2.0.0              ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
    echo "🔧 Setting up environment..."
    
    # Set up npm global packages directory
    export NPM_CONFIG_PREFIX=/home/runner/.npm-packages
    
    # Check Node.js version
    echo "📦 Node.js version: $(node --version)"
    echo "📦 npm version: $(npm --version)"
    
    # Clean previous installations
    echo "🧹 Cleaning previous installations..."
    rm -rf node_modules package-lock.json
    
    # Install dependencies
    echo "📥 Installing dependencies..."
    npm install --no-audit --no-fund
    
    # Display available commands
    echo ""
    echo "🚀 Available Commands:"
    echo "   npm start     - Start IAN TECH WhatsApp Pairing Service"
    echo "   npm run ian   - Quick start with IAN TECH branding"
    echo "   npm run tech  - Start with PM2 process manager"
    echo "   npm run dev   - Start with nodemon (development)"
    echo "   npm run stop  - Stop PM2 process"
    echo "   npm run restart - Restart PM2 process"
    echo ""
    echo "🌐 Service will be available at:"
    echo "   https://$(echo $REPL_SLUG | cut -d'-' -f1)-$(echo $REPL_OWNER).repl.co"
    echo ""
    echo "✅ Setup complete! Run 'npm start' to begin."
    echo ""
  '';
}
