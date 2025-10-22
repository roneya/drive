// drive-api.js
import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;

// In-memory token store
const sessions = new Map();

/* ==========================================================
   1️⃣  /auth — Get OAuth URL
   ========================================================== */
app.post("/auth", (req, res) => {
  const { client_id, email } = req.body;
  if (!client_id || !email)
    return res.status(400).json({ error: "client_id and email required" });

  const redirect_uri = encodeURIComponent("https://developers.google.com/oauthplayground");
  const scope = encodeURIComponent("openid email profile https://www.googleapis.com/auth/drive.file");

  const auth_url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${client_id}&response_type=token&scope=${scope}&redirect_uri=${redirect_uri}&login_hint=${email}`;

  res.json({
    success: true,
    auth_url,
    message: "Open this URL in a browser, copy the access_token, then call /token."
  });
});

/* ==========================================================
   2️⃣  /token — Save user token
   ========================================================== */
app.post("/token", (req, res) => {
  const { email, access_token } = req.body;
  if (!email || !access_token)
    return res.status(400).json({ error: "email and access_token required" });

  sessions.set(email, { token: access_token, savedAt: Date.now() });
  res.json({
    success: true,
    message: `Token saved for ${email}`,
    expires_in_minutes: 45
  });
});

/* ==========================================================
   3️⃣  /upload — Upload to Google Drive
   ========================================================== */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { email, is_public } = req.body;
    const file = req.file;

    if (!email || !file)
      return res.status(400).json({ error: "email and file required" });

    const session = sessions.get(email);
    if (!session)
      return res.status(401).json({ error: "No token saved. Call /auth then /token first." });

    const access_token = session.token;

    // Step 1: Upload
    const metadata = { name: file.originalname };
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata), { contentType: "application/json" });
    form.append("file", file.buffer, { filename: file.originalname });

    const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}` },
      body: form
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(uploadData.error?.message || "Upload failed.");

    const fileId = uploadData.id;
    let links = {};

    // Step 2: If public, set permission
    if (is_public === "true" || is_public === true) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });

      const linkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink,webContentLink`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      links = await linkRes.json();
    }

    res.json({
      success: true,
      file_id: fileId,
      view_url: links.webViewLink || null,
      download_url: links.webContentLink || null,
      visibility: is_public === "true" ? "public" : "private"
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ==========================================================
   4️⃣  /logout — Clear token for email
   ========================================================== */
app.post("/logout", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  sessions.delete(email);
  res.json({ success: true, message: `${email} logged out.` });
});

/* ==========================================================
   Health check
   ========================================================== */
app.get("/", (_, res) => res.send("✅ Drive Upload API Live"));
app.listen(PORT, () => console.log(`🚀 API running on port ${PORT}`));
