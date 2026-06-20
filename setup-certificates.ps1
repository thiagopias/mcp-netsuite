# NetSuite MCP Server - Certificate Setup Script
# This script generates the certificate and private key needed for OAuth 2.0 authentication

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " NetSuite MCP Server - Certificate Setup" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Check if OpenSSL is available
$openssl = Get-Command openssl -ErrorAction SilentlyContinue

if (-not $openssl) {
    Write-Host "ERROR: OpenSSL is not installed or not in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install OpenSSL:" -ForegroundColor Yellow
    Write-Host "  - Install Git for Windows (includes OpenSSL)" -ForegroundColor Yellow
    Write-Host "  - Or download from: https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "✓ OpenSSL found: $($openssl.Source)" -ForegroundColor Green
Write-Host ""

# Check if files already exist
$filesExist = (Test-Path "private_key.pem") -or (Test-Path "certificate.pem")

if ($filesExist) {
    Write-Host "WARNING: Certificate files already exist!" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Do you want to overwrite them? (yes/no)"
    
    if ($response -ne "yes") {
        Write-Host "Cancelled. Existing files will be kept." -ForegroundColor Yellow
        exit 0
    }
    
    Write-Host ""
}

# Generate certificate and private key
Write-Host "Generating certificate and private key..." -ForegroundColor Cyan

try {
    & openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 `
        -keyout private_key.pem -out certificate.pem -days 365 -nodes `
        -subj "/CN=mcp-netsuite" 2>&1 | Out-Null
    
    if ($LASTEXITCODE -ne 0) {
        throw "OpenSSL command failed with exit code $LASTEXITCODE"
    }
    
    Write-Host "✓ Certificate and private key generated successfully!" -ForegroundColor Green
    Write-Host ""
    
} catch {
    Write-Host "ERROR: Failed to generate certificate" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Convert private key to single-line format
Write-Host "Converting private key to single-line format..." -ForegroundColor Cyan

try {
    $privateKeyContent = Get-Content "private_key.pem" -Raw
    $singleLineKey = $privateKeyContent.Replace("`r`n", "\n").Replace("`n", "\n").Trim()
    
    # Save to a temporary file for easy copying
    $singleLineKey | Out-File "private_key_oneline.txt" -NoNewline -Encoding ASCII
    
    Write-Host "✓ Single-line private key saved to: private_key_oneline.txt" -ForegroundColor Green
    Write-Host ""
    
} catch {
    Write-Host "ERROR: Failed to convert private key" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Display summary
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Files Created:" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ✓ private_key.pem           - Private key (keep secret!)" -ForegroundColor Green
Write-Host "  ✓ certificate.pem           - Public certificate (upload to NetSuite)" -ForegroundColor Green
Write-Host "  ✓ private_key_oneline.txt   - Private key in single-line format" -ForegroundColor Green
Write-Host ""

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Next Steps:" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Upload 'certificate.pem' to NetSuite:" -ForegroundColor Yellow
Write-Host "   Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup" -ForegroundColor White
Write-Host ""
Write-Host "2. Copy the Certificate ID from NetSuite" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Update your .env.sb1 file with:" -ForegroundColor Yellow
Write-Host "   - Client ID (from Integration Record)" -ForegroundColor White
Write-Host "   - Certificate ID (from OAuth 2.0 setup)" -ForegroundColor White
Write-Host "   - Private Key (from private_key_oneline.txt)" -ForegroundColor White
Write-Host ""
Write-Host "4. Run: npm install && npm run build" -ForegroundColor Yellow
Write-Host ""
Write-Host "5. Test with: ./mcp-query.sh environments" -ForegroundColor Yellow
Write-Host ""

Write-Host "For detailed instructions, see SETUP-GUIDE.md" -ForegroundColor Cyan
Write-Host ""

# Offer to display the private key
Write-Host "=============================================" -ForegroundColor Cyan
$showKey = Read-Host "Display the single-line private key now? (yes/no)"

if ($showKey -eq "yes") {
    Write-Host ""
    Write-Host "Single-line private key (copy this to your .env file):" -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------" -ForegroundColor DarkGray
    Write-Host $singleLineKey -ForegroundColor White
    Write-Host "-----------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "This key is also saved in: private_key_oneline.txt" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup complete! ✓" -ForegroundColor Green
Write-Host ""
