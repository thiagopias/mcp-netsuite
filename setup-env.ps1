# NetSuite MCP Server - Environment Setup Script
# Interactive script to create .env.sb1 or .env.sb2 files

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " NetSuite MCP Server - Environment Setup" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Ask which environment to configure
Write-Host "Which environment do you want to configure?" -ForegroundColor Yellow
Write-Host "  1) sb1 (Sandbox 1 / Production)" -ForegroundColor White
Write-Host "  2) sb2 (Sandbox 2)" -ForegroundColor White
Write-Host ""
$envChoice = Read-Host "Enter your choice (1 or 2)"

if ($envChoice -eq "1") {
    $envName = "sb1"
    $envFile = ".env.sb1"
} elseif ($envChoice -eq "2") {
    $envName = "sb2"
    $envFile = ".env.sb2"
} else {
    Write-Host "Invalid choice. Exiting." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Configuring environment: $envName" -ForegroundColor Green
Write-Host "Output file: $envFile" -ForegroundColor Green
Write-Host ""

# Check if file exists
if (Test-Path $envFile) {
    Write-Host "WARNING: $envFile already exists!" -ForegroundColor Yellow
    $overwrite = Read-Host "Overwrite it? (yes/no)"
    
    if ($overwrite -ne "yes") {
        Write-Host "Cancelled." -ForegroundColor Yellow
        exit 0
    }
    Write-Host ""
}

# Collect credentials
Write-Host "Enter your NetSuite credentials:" -ForegroundColor Cyan
Write-Host ""

Write-Host "Account ID (e.g., 1234567_SB1 for sandbox, 1234567 for production):" -ForegroundColor Yellow
$accountId = Read-Host "Account ID"

Write-Host ""
Write-Host "Client ID (from Setup > Integration > Manage Integrations):" -ForegroundColor Yellow
$clientId = Read-Host "Client ID"

Write-Host ""
Write-Host "Certificate ID (from Setup > Integration > OAuth 2.0 Client Credentials):" -ForegroundColor Yellow
$certificateId = Read-Host "Certificate ID"

Write-Host ""
Write-Host "Private Key - Choose input method:" -ForegroundColor Yellow
Write-Host "  1) Load from private_key.pem file" -ForegroundColor White
Write-Host "  2) Load from private_key_oneline.txt file" -ForegroundColor White
Write-Host "  3) Paste manually" -ForegroundColor White
$keyChoice = Read-Host "Enter your choice (1, 2, or 3)"

$privateKey = ""

if ($keyChoice -eq "1") {
    if (Test-Path "private_key.pem") {
        $keyContent = Get-Content "private_key.pem" -Raw
        $privateKey = $keyContent.Replace("`r`n", "\n").Replace("`n", "\n").Trim()
        Write-Host "✓ Loaded from private_key.pem" -ForegroundColor Green
    } else {
        Write-Host "ERROR: private_key.pem not found!" -ForegroundColor Red
        Write-Host "Run ./setup-certificates.ps1 first to generate certificates." -ForegroundColor Yellow
        exit 1
    }
} elseif ($keyChoice -eq "2") {
    if (Test-Path "private_key_oneline.txt") {
        $privateKey = Get-Content "private_key_oneline.txt" -Raw
        Write-Host "✓ Loaded from private_key_oneline.txt" -ForegroundColor Green
    } else {
        Write-Host "ERROR: private_key_oneline.txt not found!" -ForegroundColor Red
        Write-Host "Run ./setup-certificates.ps1 first to generate certificates." -ForegroundColor Yellow
        exit 1
    }
} elseif ($keyChoice -eq "3") {
    Write-Host ""
    Write-Host "Paste your private key (should start with -----BEGIN PRIVATE KEY-----):" -ForegroundColor Yellow
    Write-Host "Press Enter on an empty line when done." -ForegroundColor DarkGray
    
    $lines = @()
    while ($true) {
        $line = Read-Host
        if ([string]::IsNullOrWhiteSpace($line)) { break }
        $lines += $line
    }
    
    $privateKey = ($lines -join "\n").Trim()
} else {
    Write-Host "Invalid choice. Exiting." -ForegroundColor Red
    exit 1
}

# Validate inputs
if ([string]::IsNullOrWhiteSpace($accountId) -or 
    [string]::IsNullOrWhiteSpace($clientId) -or 
    [string]::IsNullOrWhiteSpace($certificateId) -or 
    [string]::IsNullOrWhiteSpace($privateKey)) {
    Write-Host ""
    Write-Host "ERROR: All fields are required!" -ForegroundColor Red
    exit 1
}

# Create .env file
$upperEnv = $envName.ToUpper()
$envContent = @"
# NetSuite MCP Server - $envName Environment Configuration
# Generated on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

NETSUITE_${upperEnv}_ACCOUNT_ID=$accountId
NETSUITE_${upperEnv}_CLIENT_ID=$clientId
NETSUITE_${upperEnv}_CERTIFICATE_ID=$certificateId
NETSUITE_${upperEnv}_PRIVATE_KEY=$privateKey

# Default environment
NETSUITE_DEFAULT_ENV=$envName
"@

try {
    $envContent | Out-File $envFile -Encoding UTF8 -NoNewline
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "✓ Environment configured successfully!" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Configuration saved to: $envFile" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Run: npm install" -ForegroundColor White
    Write-Host "  2. Run: npm run build" -ForegroundColor White
    Write-Host "  3. Test: ./mcp-query.sh environments" -ForegroundColor White
    Write-Host ""
    
} catch {
    Write-Host "ERROR: Failed to create $envFile" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
