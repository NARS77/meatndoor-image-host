"use strict";

const repository = "NARS77/meatndoor-image-host";
const api = "https://api.github.com/repos/" + repository;
const branch = "media";
const byId = id => document.getElementById(id);
const dialog = byId("auth");
const fileInput = byId("file");
let token = "";
let pendingFile = null;
let busy = false;
let waitingForGitHub = false;
let libraryRequest = 0;

function encodedPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function publicUrl(path) {
  return "https://raw.githubusercontent.com/" + repository + "/" + branch + "/" + encodedPath(path);
}

async function request(path, options = {}) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(api + path, { ...options, headers, cache: "no-store", redirect: "error" });
  if (response.ok) return response.json();
  const error = new Error("GitHub could not complete this request (" + response.status + "). Try again.");
  error.status = response.status;
  if (response.status === 401) {
    disconnect();
    error.message = "GitHub rejected the token. Connect again with a current token.";
  } else if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
    error.message = "GitHub’s request limit was reached. Try again after the limit resets.";
  } else if (response.status === 403 || response.status === 404 && options.method === "PUT") {
    error.message = "Check access to this repository and the token’s Contents permission, then try again.";
  }
  throw error;
}

function disconnect() {
  token = "";
  byId("token").value = "";
  byId("connect").textContent = "Connect uploads";
}

function showLink(url) {
  byId("result-url").value = url;
  byId("result").hidden = false;
}

async function copyLink(url, button) {
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy link"; }, 1500);
  } catch {
    showLink(url);
    byId("result-url").focus();
    byId("result-url").select();
    byId("notice").textContent = "The link is selected. Use your device’s Copy command.";
  }
}

function imageRow(entry) {
  const name = entry.path.split("/").pop();
  const url = publicUrl(entry.path);
  const row = document.createElement("li");
  const image = document.createElement("img");
  image.className = "thumb";
  image.alt = "";
  image.loading = "lazy";
  image.src = url;
  const names = document.createElement("div");
  names.className = "names";
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = name;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = name.split(".").pop().toUpperCase() + " · " + (entry.size < 1048576
    ? Math.max(1, Math.round(entry.size / 1024)) + " KiB"
    : (entry.size / 1048576).toFixed(1) + " MiB");
  names.append(link, meta);
  const copy = document.createElement("button");
  copy.textContent = "Copy link";
  copy.setAttribute("aria-label", "Copy link to " + name);
  copy.addEventListener("click", () => copyLink(url, copy));
  row.append(image, names, copy);
  return row;
}

async function refreshLibrary() {
  const id = ++libraryRequest;
  byId("refresh").disabled = true;
  try {
    const result = await request("/git/trees/" + branch + "?recursive=1");
    if (id !== libraryRequest) return;
    const entries = result.tree.filter(entry => entry.type === "blob" &&
      /^images\/.+\.(jpe?g|png|webp|gif|avif)$/i.test(entry.path));
    entries.sort((a, b) => a.path.split("/").pop().localeCompare(b.path.split("/").pop()));
    byId("library").replaceChildren(...entries.map(imageRow));
    byId("library-state").textContent = result.truncated ? "GitHub returned a partial library." :
      entries.length ? "" : "Your uploaded images will appear here.";
  } catch (error) {
    if (id === libraryRequest) byId("library-state").textContent = "Library refresh failed. " + error.message;
  } finally {
    if (id === libraryRequest) byId("refresh").disabled = false;
  }
}

async function inspect(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image that is 10 MiB or smaller.");
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const chars = String.fromCharCode(...bytes);
  let extension;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) extension = "jpg";
  if (chars.startsWith("\x89PNG\r\n\x1a\n")) extension = "png";
  if (/^GIF8[79]a/.test(chars)) extension = "gif";
  if (chars.startsWith("RIFF") && chars.slice(8, 12) === "WEBP") extension = "webp";
  if (chars.slice(4, 8) === "ftyp" && /avif|avis/.test(chars.slice(8))) extension = "avif";
  if (!extension) throw new Error("Choose a JPEG, PNG, WebP, GIF or AVIF image.");
  return extension;
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file. Choose the image again."));
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.readAsDataURL(file);
  });
}

async function upload(file) {
  setBusy(true);
  byId("result").hidden = true;
  byId("notice").textContent = "Uploading " + file.name + "…";
  try {
    const extension = await inspect(file);
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N} _.-]+/gu, "-").replace(/^[. ]+|[. ]+$/g, "").slice(0, 85) || "image";
    const path = "images/" + digest + "/" + stem + "." + extension;
    const endpoint = "/contents/" + encodedPath(path);
    try {
      await request(endpoint, { method: "PUT", body: JSON.stringify({
        message: "Upload " + stem + "." + extension, branch, content: await readBase64(file)
      }) });
    } catch (error) {
      // A duplicate upload or a lost response can leave the complete file in place.
      if (error.status && ![409, 422].includes(error.status)) throw error;
      const existing = await request(endpoint + "?ref=" + branch).catch(() => null);
      if (existing?.size !== file.size) throw error;
    }
    showLink(publicUrl(path));
    byId("notice").textContent = "Uploaded " + file.name + ".";
    await refreshLibrary();
  } catch (error) {
    byId("notice").textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function setBusy(value) {
  busy = value;
  byId("choose").disabled = value;
  byId("connect").disabled = value;
  byId("drop").setAttribute("aria-busy", String(value));
}

function promptToken(file = null) {
  pendingFile = file;
  byId("save-token").textContent = file ? "Connect and upload" : "Connect";
  byId("token").setCustomValidity("");
  dialog.showModal();
  byId("token").focus();
}

async function chooseFile(file) {
  if (busy || !file) return;
  setBusy(true);
  byId("result").hidden = true;
  byId("notice").textContent = "";
  try {
    await inspect(file);
    if (token) await upload(file);
    else promptToken(file);
  } catch (error) {
    byId("notice").textContent = error.message;
  } finally {
    setBusy(false);
  }
}

byId("choose").onclick = () => fileInput.click();
fileInput.onchange = () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  chooseFile(file);
};
byId("connect").onclick = () => {
  if (!token) return promptToken();
  disconnect();
  byId("notice").textContent = "Direct uploads disconnected.";
};
byId("cancel").onclick = () => dialog.close();
dialog.addEventListener("close", () => { byId("token").value = ""; pendingFile = null; });
byId("token").oninput = () => byId("token").setCustomValidity("");
byId("auth-form").onsubmit = async event => {
  event.preventDefault();
  const value = byId("token").value.trim();
  if (!value.startsWith("github_pat_")) {
    byId("token").setCustomValidity("Enter a fine-grained GitHub token.");
    byId("token").reportValidity();
    return;
  }
  const file = pendingFile;
  token = value;
  dialog.close();
  byId("connect").textContent = "Disconnect";
  if (file) await upload(file);
  else byId("notice").textContent = "Token set for this tab. Choose an image to upload.";
};
for (const event of ["dragover", "drop"]) {
  window.addEventListener(event, e => e.preventDefault());
}
const drop = byId("drop");
drop.ondragover = () => { if (!busy) drop.classList.add("drag"); };
drop.ondragleave = event => { if (!drop.contains(event.relatedTarget)) drop.classList.remove("drag"); };
drop.ondrop = event => {
  drop.classList.remove("drag");
  const files = event.dataTransfer.files;
  if (files.length === 1) chooseFile(files[0]);
  else byId("notice").textContent = "Choose one image at a time.";
};

byId("refresh").onclick = refreshLibrary;
byId("github-upload").onclick = () => {
  waitingForGitHub = true;
  byId("notice").textContent = "Commit your image to the media branch on GitHub, then return here to copy its link.";
};
window.addEventListener("focus", () => { if (waitingForGitHub) refreshLibrary(); });
byId("result-copy").onclick = () => copyLink(byId("result-url").value, byId("result-copy"));
refreshLibrary();
