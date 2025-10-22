// drive.js
import express from "express";
import multer from "multer";
import fetch from "node-fetch";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🧠 Session Store (per email)
const sessionStore = {}; // { email: { client_id, access_token, created_at } }
const TOKEN_TTL = 45 * 60 * 1000; // 45 min

function getSession(email) {
  const session = sessionStore[email];
  if (!session) return null;
  if (Date.now() - session.created_at > TOKEN_TTL) {
    delete sessionStore[email];
    return null;
  }
  return session;
}

// ============ 1️⃣ AUTH API ============
// Takes email + client_id, returns Google Auth URL
app.post("/auth", async (req, res) => {
  try {
    const { client_id, email, redirect_uri } = req.body;
    if (!client_id) return res.status(400).json({ error: "Missing client_id" });
    if (!email) return res.status(400).json({ error: "Missing email" });

    // Save client_id for this email (even before token)
    sessionStore[email] = { client_id, created_at: Date.now() };

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
      message: "Open this URL to authorize and then send the token to /token.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ 2️⃣ TOKEN API ============
// Takes email + access_token and saves it in the same session
app.post("/token", async (req, res) => {
  try {
    const { email, access_token } = req.body;
    if (!email || !access_token)
      return res.status(400).json({ error: "Missing email or access_token" });

    const existing = sessionStore[email];
    if (!existing)
      return res.status(400).json({ error: "No client_id found. Call /auth first." });

    existing.access_token = access_token;
    existing.created_at = Date.now();

    res.json({
      success: true,
      message: `Token saved for ${email}.`,
      expires_in_minutes: 45,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ 3️⃣ UPLOAD API ============
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { email, folder_id, is_public } = req.body;
    const file = req.file;
    if (!email) return res.status(400).json({ error: "Missing email" });
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const session = getSession(email);
    if (!session || !session.access_token)
      return res.status(401).json({ error: "Not authorized. Please re-authenticate." });

    const { access_token } = session;

    const metadata = folder_id
      ? { name: file.originalname, parents: [folder_id] }
      : { name: file.originalname };

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([file.buffer]));

    const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}` },
      body: form,
    });

    const data = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(data.error?.message || "Upload failed");

    const fileId = data.id;
    let response = { success: true, file_id: fileId };

    // Handle visibility
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

// ============ 4️⃣ LOGOUT API ============
app.post("/logout", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email" });

  if (sessionStore[email]) {
    delete sessionStore[email];
    return res.json({ success: true, message: `${email} logged out and session cleared.` });
  }

  res.status(404).json({ error: "No active session found for this email." });
});

// ============ HEALTH ============
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Drive API running on port ${PORT}`);
});
