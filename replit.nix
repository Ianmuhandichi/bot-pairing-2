
# IAN TECH WhatsApp Pairing Service
# Simplified Replit configuration

run = "npm start"

[env]
COMPANY_NAME = "IAN TECH"
CONTACT_PHONE = "+254724278526"
COMPANY_EMAIL = "contact@iantech.co.ke"
COMPANY_WEBSITE = "https://iantech.co.ke"
NODE_ENV = "production"
PORT = "5000"

[nix]
channel = "stable-23_11"

[deployment]
deploymentTarget = "cloudrun"
run = "npm start"
