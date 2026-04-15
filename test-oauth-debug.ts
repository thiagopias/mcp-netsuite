#!/usr/bin/env node

/**
 * OAuth Debug Tool
 * 
 * This script helps debug OAuth 2.0 authentication issues with NetSuite
 */

import jwt from "jsonwebtoken";

const accountId = process.env.NETSUITE_SB2_ACCOUNT_ID || process.env.NETSUITE_SB1_ACCOUNT_ID;
const clientId = process.env.NETSUITE_SB2_CLIENT_ID || process.env.NETSUITE_SB1_CLIENT_ID;
const certificateId = process.env.NETSUITE_SB2_CERTIFICATE_ID || process.env.NETSUITE_SB1_CERTIFICATE_ID;
const privateKey = process.env.NETSUITE_SB2_PRIVATE_KEY || process.env.NETSUITE_SB1_PRIVATE_KEY;

console.log("🔍 NetSuite OAuth 2.0 Debug");
console.log("=" .repeat(60));

if (!accountId || !clientId || !certificateId || !privateKey) {
  console.error("❌ Missing required environment variables");
  console.error(`Account ID: ${accountId ? '✓' : '✗'}`);
  console.error(`Client ID: ${clientId ? '✓' : '✗'}`);
  console.error(`Certificate ID: ${certificateId ? '✓' : '✗'}`);
  console.error(`Private Key: ${privateKey ? '✓' : '✗'}`);
  process.exit(1);
}

console.log("✓ All environment variables present\n");

console.log("Configuration:");
console.log(`  Account ID: ${accountId}`);
console.log(`  Client ID: ${clientId.substring(0, 20)}...`);
console.log(`  Certificate ID: ${certificateId}`);
console.log(`  Private Key: ${privateKey.substring(0, 50)}...`);
console.log();

// Build token endpoint
const accountIdForUrl = accountId.replace(/_/g, "-").toLowerCase();
const baseUrl = `https://${accountIdForUrl}.suitetalk.api.netsuite.com`;
const tokenEndpoint = `${baseUrl}/services/rest/auth/oauth2/v1/token`;

console.log(`Token Endpoint: ${tokenEndpoint}\n`);

// Build JWT assertion
const now = Math.floor(Date.now() / 1000);

const payload = {
  iss: clientId,
  scope: ["restlets", "rest_webservices"],
  aud: tokenEndpoint,
  iat: now,
  exp: now + 3600,
};

const header = {
  typ: "JWT",
  alg: "PS256",
  kid: certificateId,
};

console.log("JWT Payload:");
console.log(JSON.stringify(payload, null, 2));
console.log();

console.log("JWT Header:");
console.log(JSON.stringify(header, null, 2));
console.log();

try {
  const clientAssertion = jwt.sign(payload, privateKey, {
    algorithm: "PS256",
    header,
  });

  console.log("✓ JWT assertion generated successfully");
  console.log(`JWT (first 100 chars): ${clientAssertion.substring(0, 100)}...\n`);

  // Attempt to exchange for token
  console.log("🔄 Attempting OAuth token exchange...");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion,
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  console.log(`Response Status: ${response.status} ${response.statusText}`);
  console.log();

  const responseText = await response.text();

  if (response.ok) {
    const data = JSON.parse(responseText);
    console.log("✅ SUCCESS! Access token received");
    console.log(`Token (first 50 chars): ${data.access_token.substring(0, 50)}...`);
    console.log(`Expires in: ${data.expires_in} seconds`);
    console.log(`Token type: ${data.token_type}`);
  } else {
    console.log("❌ FAILED! Error response:");
    console.log(responseText);
    console.log();
    
    try {
      const errorData = JSON.parse(responseText);
      console.log("Parsed error:");
      console.log(JSON.stringify(errorData, null, 2));
      
      console.log("\n💡 Troubleshooting tips:");
      if (errorData.error === "invalid_client") {
        console.log("  - Client ID may be incorrect");
        console.log("  - Integration record may not exist or is inactive");
        console.log("  - Check: Setup > Integration > Manage Integrations");
      } else if (errorData.error === "invalid_grant") {
        console.log("  - Certificate ID may be incorrect");
        console.log("  - Certificate may not be uploaded correctly in NetSuite");
        console.log("  - OAuth 2.0 mapping may not be configured");
        console.log("  - Check: Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup");
        console.log("  - Ensure the certificate matches the private key");
      }
    } catch {
      // Not JSON
    }
  }
} catch (error) {
  console.log("❌ ERROR during JWT generation or token exchange:");
  console.log(error);
}

