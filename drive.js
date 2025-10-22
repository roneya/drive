// drive-api.js
window.DriveAPI = (() => {
  let accessToken = null;
  let userEmail = null;

  // 🔹 Load Google Identity Services dynamically
  async function loadGoogleSDK() {
    if (window.google && window.google.accounts) return;
    await new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }

  // 🔹 1️⃣ AUTH API — get Drive access token
  async function auth(context) {
    if (!context?.client_id) throw new Error("client_id missing in request context");
    await loadGoogleSDK();

    return new Promise((resolve, reject) => {
      try {
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: context.client_id,
          scope: "openid email https://www.googleapis.com/auth/drive.file",
          callback: async (tokenResponse) => {
            accessToken = tokenResponse.access_token;

            // Extract email (optional)
            if (tokenResponse.id_token) {
              const payload = JSON.parse(atob(tokenResponse.id_token.split(".")[1]));
              userEmail = payload.email;
            }

            resolve({
              success: true,
              access_token: accessToken,
              email: userEmail,
              message: "Drive access granted",
            });
          },
        });

        tokenClient.requestAccessToken({ prompt: "consent" });
      } catch (err) {
        reject({ success: false, error: err.message });
      }
    });
  }

  // 🔹 2️⃣ UPLOAD API — upload file and return public link
  async function upload(file, context) {
    if (!context?.client_id) throw new Error("client_id missing in request context");
    if (!accessToken) throw new Error("Please authenticate first using DriveAPI.auth()");
    if (!file) throw new Error("No file provided");

    const folderId = context.folder_id || null;

    // Build metadata (use folder if provided)
    const metadata = folderId ? { name: file.name, parents: [folderId] } : { name: file.name };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", file);

    // Upload
    const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken },
      body: form,
    });
    const uploadData = await uploadRes.json();
    if (uploadData.error) throw new Error(uploadData.error.message);

    // Make public
    await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });

    // Get URLs
    const linkRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${uploadData.id}?fields=webViewLink,webContentLink`,
      { headers: { Authorization: "Bearer " + accessToken } }
    );
    const linkData = await linkRes.json();

    return {
      success: true,
      file_id: uploadData.id,
      view_url: linkData.webViewLink,
      download_url: linkData.webContentLink,
    };
  }

  // 🔹 Optional helper
  function isAuthed() {
    return !!accessToken;
  }

  return { auth, upload, isAuthed };
})();