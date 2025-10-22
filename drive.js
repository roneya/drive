// drive.js
import express from "express";
import multer from "multer";
import fetch from "node-fetch";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Temporary in-memory token store
// Structure: { email: { access_token, client_id, created_at } }
const tokenStore = {};
const TOKEN_TTL = 45 * 60 * 1000; // 45 minutes

// Utility: Validate and retrieve token
function getValidToken(email) {
  const entry = tokenStore[email];
  if (!entry) return null;
  if (Date.now() - entry.created_at > TOKEN_TTL) {
    delete tokenStore[email];
    return null;
  }
  return entry.access_token;
}

// ---------- 1️⃣ AUTH ENDPOINT ----------
app.post("/auth", async (req, res) => {
  try {
    const { client_id, email, redirect_uri } = req.body;
    if (!client_id) return res.status(400).json({ error: "Missing client_id" });
    if (!email) return res.status(400).json({ error: "Missing email" });

    const redirect = encodeURIComponent(
      redirect_uri || "https://developers.google.com/oauthplayground"
    );

    const scope = encodeURIComponent(
      "openid email profile https://www.googleapis.com/auth/drive.file"
    );

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${client_id}&response_type=token&scope=${scope}&redirect_uri=${redirect}&login_hint=${email}`;

    res.json({
      success: true,
      auth_url: authUrl,
      message:
        "Open this URL, grant access, then POST /token to save your access_token.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 1️⃣.5️⃣ TOKEN SAVE ENDPOINT ----------
app.post("/token", async (req, res) => {
  try {
    const { email, access_token, client_id } = req.body;
    if (!email || !access_token || !client_id)
      return res.status(400).json({ error: "Missing fields" });

    tokenStore[email] = {
      access_token,
      client_id,
      created_at: Date.now(),
    };

    res.json({
      success: true,
      message: "Access token saved for this session.",
      expires_in_minutes: 45,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 2️⃣ UPLOAD ENDPOINT ----------
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { email, folder_id, is_public } = req.body;
    const file = req.file;

    if (!email) return res.status(400).json({ error: "Missing email" });
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const access_token = getValidToken(email);
    if (!access_token)
      return res.status(401).json({ error: "No valid token found for this email. Please re-auth." });

    const metadata = folder_id
      ? { name: file.originalname, parents: [folder_id] }
      : { name: file.originalname };

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([file.buffer]));

    // Upload file to Drive
    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}` },
        body: form,
      }
    );

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(uploadData.error?.message || "Upload failed");

    const fileId = uploadData.id;
    let response = { success: true, file_id: fileId };

    // Make file public if requested
    if (is_public === "true" || is_public === true) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });

      const linkRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink,webContentLink`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );

      const links = await linkRes.json();
      response.view_url = links.webViewLink;
      response.download_url = links.webContentLink;
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- 3️⃣ LOGOUT ENDPOINT ----------
app.post("/logout", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email" });

  if (tokenStore[email]) {
    delete tokenStore[email];
    return res.json({ success: true, message: "Logged out and token cleared." });
  }
  res.status(404).json({ error: "No active session for this email." });
});

// ---------- HEALTH ----------
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ---------- START SERVER ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Drive API running on port ${PORT}`);
});
