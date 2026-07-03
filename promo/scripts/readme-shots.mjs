import { chromium } from "playwright";

const API = "http://localhost:4100";
const WEB = "http://localhost:4110";
const HERE = new URL(".", import.meta.url).pathname;
const OUT = "/Users/bailey/Dev/Riverside Clone/docs/screenshots/";

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
});
await hostCtx.addCookies([{ name: "tributary_session", value: token, url: WEB, httpOnly: true }]);
const host = await hostCtx.newPage();

// Host lobby shot
await host.goto(`${WEB}/sessions/${session.id}/room`);
await host.getByRole("button", { name: "Enter studio" }).waitFor({ timeout: 15000 });
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}lobby.png` });
console.log("shot: lobby");
await host.getByRole("button", { name: "Enter studio" }).click();
await host.getByRole("button", { name: "Cam off" }).waitFor({ timeout: 15000 });

// Guest joins
const guestCtx = await guestBrowser.newContext({
  permissions: ["camera", "microphone"],
  viewport: { width: 1600, height: 1000 },
});
const guest = await guestCtx.newPage();
await guest.goto(`${WEB}/join/${session.invite_token}`);
await guest.getByPlaceholder("Your name").fill("Jordan");
await guest.getByRole("button", { name: "Continue" }).click();
await guest.getByRole("button", { name: "Join studio" }).click({ timeout: 15000 });
await guest.getByRole("button", { name: "Cam off" }).waitFor({ timeout: 15000 });
console.log("guest joined");

// Wait for mesh to connect (2 tiles on host)
await host.waitForFunction(() => document.querySelectorAll("main video").length >= 2, null, {
  timeout: 20000,
});

// Start recording (3s countdown), let it run, hero shot
await host.getByRole("button", { name: "Record" }).click();
await host.waitForTimeout(6500);
await host.screenshot({ path: `${OUT}studio.png` });
console.log("shot: studio (recording)");

// Stop, wait for uploads + processing
await host.getByRole("button", { name: /Stop/ }).click();
await host.waitForTimeout(4000);

// Guest can leave now
await guestBrowser.close();

// Session detail: poll until tracks are ready (ffmpeg post-production)
await host.goto(`${WEB}/sessions/${session.id}`);
for (let i = 0; i < 30; i++) {
  await host.waitForTimeout(2000);
  const ready = await host.evaluate(() => document.body.innerText.match(/ready/gi)?.length ?? 0);
  if (ready >= 2) break;
  await host.reload();
}
await host.waitForTimeout(1000);
await host.screenshot({ path: `${OUT}session.png`, fullPage: false });
console.log("shot: session detail");

await hostBrowser.close();
console.log("done");
