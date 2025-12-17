const http = require("http");
const { google } = require("googleapis");

function openBrowser(url) {
  const { exec } = require("child_process");
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` :
    process.platform === "darwin" ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd);
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("ERROR: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// drive.file = can create/read files your app creates (safer than full drive)
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("Missing ?code=...");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end("Success! You can close this tab. Check your terminal for refresh_token.");

    console.log("\n===== TOKENS =====\n", tokens);
    console.log("\n===== REFRESH TOKEN (SAVE THIS) =====\n", tokens.refresh_token, "\n");

    server.close();
  } catch (err) {
    console.error("Token exchange failed:", err);
    res.end("Token exchange failed. Check terminal.");
    server.close();
  }
});

server.listen(3000, () => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",     // IMPORTANT: forces refresh_token
    scope: SCOPES,
  });

  console.log("Opening browser for consent...");
  console.log(authUrl);
  openBrowser(authUrl);
});
