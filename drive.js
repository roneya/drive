// drive-api.js
import express from "express";
import multer from "multer";
import fetch from "node-fetch";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🧠 Utility: Upload a file to Google Drive
async function uploadFileToDrive(fileBuffer, fileName, accessToken, folderId) {
  const metadata = folderId
    ? { name: fileName, parents: [folderId] }
    : { name: fileName };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([fileBuffer]));

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Upload failed.");

  // Make file public
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  // Get public URLs
  const linkRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${data.id}?fields=webViewLink,webContentLink`,
    { headers: { Authorization: "Bearer " + accessToken } }
  );
  const links = await linkRes.json();

  return {
    success: true,
    file_id: data.id,
    view_url: links.webViewLink,
    download_url: links.webContentLink,
  };
}

// === 1️⃣ /auth endpoint ===
// Note: this just returns the OAuth URL — Render can’t open popups.
app.post("/auth", async (req, res) => {
  try {
    const { client_id, redirect_uri } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: "Missing client_id" });
    }

    const redirect = encodeURIComponent(
      redirect_uri || "https://developers.google.com/oauthplayground"
    );
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${client_id}&response_type=token&scope=https://www.googleapis.com/auth/drive.file%20openid%20email&redirect_uri=${redirect}`;

    res.json({
      success: true,
      auth_url: authUrl,
      message: "Open this URL to authorize and get your access_token.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 2️⃣ /upload endpoint ===
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { client_id, access_token, folder_id } = req.body;
    const file = req.file;

    if (!client_id) return res.status(400).json({ error: "Missing client_id" });
    if (!access_token) return res.status(400).json({ error: "Missing access_token" });
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const result = await uploadFileToDrive(file.buffer, file.originalname, access_token, folder_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === 3️⃣ Health check ===
app.get("/", (req, res) => res.send("🚀 Drive API is live on Render!"));

// === Start server ===
app.listen(PORT, () => console.log(`✅ Drive API running on port ${PORT}`));