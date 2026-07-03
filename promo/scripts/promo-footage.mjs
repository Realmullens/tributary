import { chromium } from "playwright";

const API = "http://localhost:4100";
const WEB = "http://localhost:4110";
const HERE = new URL(".", import.meta.url).pathname;
const OUT = `${HERE}footage/`;

async function api(path, opts = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `tributary_session=${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const login = await api("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "bailey@test.dev", password: "testing123" }),
});
const token = login.token;
const { studios } = await api("/api/studios", {}, token);
const studio = studios.find((s) => s.name === "UI Shots") ?? studios[0];
const { session } = await api(
  `/api/studios/${studio.id}/sessions`,
  { method: "POST", body: JSON.stringify({ title: "The Weekly Show — Ep. 12" }) },
  token
);
console.log("session", session.id);

function launch(y4m) {
  return chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${HERE}${y4m}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
}

const hostBrowser = await launch("cam-host.y4m");
const guestBrowser = await launch("cam-guest.y4m");

const hostCtx = await hostBrowser.newContext({
  permissions: ["camera", "microphone"],
  viewport: { width: 1600, height: 1000 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } },
});
await hostCtx.addCookies([{ name: "tributary_session", value: token, url: WEB, httpOnly: true }]);
const host = await hostCtx.newPage();

// --- host: lobby → enter ---
await host.goto(`${WEB}/sessions/${session.id}/room`);
await host.getByRole("button", { name: "Enter studio" }).click({ timeout: 20000 });
await host.getByRole("button", { name: "Cam off" }).waitFor({ timeout: 20000 });
console.log("host in room");

// --- guest joins ---
const guestCtx = await guestBrowser.newContext({
  permissions: ["camera", "microphone"],
  viewport: { width: 1600, height: 1000 },
});
const guest = await guestCtx.newPage();
await guest.goto(`${WEB}/join/${session.invite_token}`);
await guest.getByPlaceholder("Your name").fill("Jordan");
await guest.getByRole("button", { name: "Continue" }).click();
await guest.getByRole("button", { name: "Join studio" }).click({ timeout: 20000 });
await guest.getByRole("button", { name: "Cam off" }).waitFor({ timeout: 20000 });
await host.waitForFunction(() => document.querySelectorAll("main video").length >= 2, null, {
  timeout: 20000,
});
console.log("guest joined");
await host.waitForTimeout(2000);

// --- record: countdown + REC ---
await host.getByRole("button", { name: "Record" }).click();
await host.waitForTimeout(5500); // countdown 3s + settle
console.log("recording");

// chat while recording
await host.getByRole("button", { name: "Chat", exact: true }).click();
await host.waitForTimeout(800);
await guest.getByRole("button", { name: "Chat", exact: true }).click();
await guest.getByPlaceholder(/message/i).fill("This is so smooth 🔥");
await guest.keyboard.press("Enter");
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}still-chat.png` });
await host.getByPlaceholder(/message/i).fill("Recording locally in 4K 🎙️");
await host.keyboard.press("Enter");
await host.waitForTimeout(2000);
await host.getByRole("button", { name: "Chat", exact: true }).click(); // close
await host.waitForTimeout(800);

// camera toggle beat
await host.getByRole("button", { name: "Cam off" }).click();
await host.waitForTimeout(1600);
await host.getByRole("button", { name: "Cam on" }).click();
await host.waitForTimeout(1500);

// let REC timer tick for footage
await host.waitForTimeout(3000);
await host.screenshot({ path: `${OUT}still-recording.png` });

// --- stop → upload complete toast ---
await host.getByRole("button", { name: /Stop/ }).click();
await host.waitForTimeout(4500);
console.log("stopped");
await guestCtx.close();
await guestBrowser.close();

// --- session detail: wait for processing ---
await host.goto(`${WEB}/sessions/${session.id}`);
let recordingId = null;
for (let i = 0; i < 30; i++) {
  await host.waitForTimeout(2000);
  const data = await api(`/api/sessions/${session.id}`, {}, token);
  const rec = (data.recordings ?? [])[0];
  if (rec && ["ready", "complete"].includes(rec.status)) {
    recordingId = rec.id;
    break;
  }
  await host.reload();
}
console.log("recording ready:", recordingId);

// transcribe for editor footage
if (recordingId) {
  await api(`/api/recordings/${recordingId}/transcribe`, { method: "POST", body: "{}" }, token).catch((e) =>
    console.log("transcribe kickoff failed:", e.message)
  );
  for (let i = 0; i < 45; i++) {
    await host.waitForTimeout(2000);
    const t = await api(`/api/recordings/${recordingId}/transcript`, {}, token).catch(() => null);
    if (t && (t.segments?.length || t.status === "ready")) break;
  }
  await host.goto(`${WEB}/recordings/${recordingId}/edit`);
  await host.waitForTimeout(5000);
  await host.screenshot({ path: `${OUT}still-editor.png` });
  console.log("editor shot");
}

// dashboard still
await host.goto(`${WEB}/`);
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}still-dashboard.png` });

const video = host.video();
await hostCtx.close();
const path = await video.path();
console.log("video:", path);
await hostBrowser.close();
console.log("done");
