// drive.js
import express from "express";
import multer from "multer";
import fetch from "node-fetch";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Upload to Google Drive
async function uploadFileToDrive(fileBuffer, fileName, accessToken, folderId) {
  const metadata = folderId
    ? { name: fileName, parents: [folderId] }
    : { name: fileName };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([fileBuffer]));

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error?.message || "Upload failed");

  // Make file public
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  const linkRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${data.id}?fields=webViewLink,webContentLink`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const links = await linkRes.json();

  return {
    success: true,
    file_id: data.id,
    view_url: links.webViewLink,
    download_url: links.webContentLink,
  };
}

// === POST /upload ===
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { access_token, folder_id } = req.body;
    const file = req.file;

    if (!access_token) return res.status(400).json({ error: "Missing access_token" });
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const result = await uploadFileToDrive(file.buffer, file.originalname, access_token, folder_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === GET /health ===
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ✅ Listen on correct host for Render
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Drive API running on port ${PORT}`);
});
