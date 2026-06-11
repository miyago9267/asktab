/**
 * Installs the asktab native messaging host:
 * 1. Generates extension/.key.pem (stable extension ID) if missing and
 *    caches its public key + derived ID in extension/.key.json.
 * 2. Writes an absolute-path wrapper (browsers spawn hosts with a bare env).
 * 3. Installs the host manifest into every Chromium-family browser found.
 *
 * Re-run after moving the repo or changing the bun path. Rebuild the
 * extension afterwards so dist/manifest.json picks up the key.
 */
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const HOST_NAME = "com.miyago9267.asktab";
const root = resolve(import.meta.dir, "..");
const keyPem = `${root}/extension/.key.pem`;
const keyJson = `${root}/extension/.key.json`;

async function run(cmd: string[], stdin?: Uint8Array): Promise<Uint8Array> {
  const proc = Bun.spawn(cmd, { stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
  const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  if ((await proc.exited) !== 0) {
    throw new Error(`${cmd[0]} failed: ${await new Response(proc.stderr).text()}`);
  }
  return out;
}

// 1. key + extension ID
if (!(await Bun.file(keyPem).exists())) {
  await Bun.write(keyPem, await run(["openssl", "genrsa", "2048"]));
  console.log(`generated ${keyPem}`);
}
const spkiDer = await run(["openssl", "rsa", "-in", keyPem, "-pubout", "-outform", "DER"]);
const pubKey = Buffer.from(spkiDer).toString("base64");
const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", spkiDer));
const extensionId = [...digest.slice(0, 16)]
  .flatMap((b) => [b >> 4, b & 0xf])
  .map((n) => "abcdefghijklmnop"[n])
  .join("");
await Bun.write(keyJson, JSON.stringify({ key: pubKey, id: extensionId }, null, 2));

// 2. wrapper the browser can exec directly
const wrapper = `${root}/server/bin/asktab-host`;
await mkdir(`${root}/server/bin`, { recursive: true });
await Bun.write(wrapper, `#!/bin/sh\nexec "${process.execPath}" run "${root}/server/src/host.ts"\n`);
await chmod(wrapper, 0o755);

// 3. host manifests for installed Chromium-family browsers (macOS paths)
const appSupport = `${homedir()}/Library/Application Support`;
const browsers: Record<string, string> = {
  Chrome: `${appSupport}/Google/Chrome/NativeMessagingHosts`,
  Arc: `${appSupport}/Arc/User Data/NativeMessagingHosts`,
  Brave: `${appSupport}/BraveSoftware/Brave-Browser/NativeMessagingHosts`,
  Edge: `${appSupport}/Microsoft Edge/NativeMessagingHosts`,
  Chromium: `${appSupport}/Chromium/NativeMessagingHosts`,
};
const manifest = JSON.stringify(
  {
    name: HOST_NAME,
    description: "asktab native messaging host (local claude/codex bridge)",
    path: wrapper,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  },
  null,
  2,
);

const installed: string[] = [];
for (const [browser, dir] of Object.entries(browsers)) {
  const parent = dir.split("/NativeMessagingHosts")[0];
  if (!(await exists(parent))) continue;
  await mkdir(dir, { recursive: true });
  await Bun.write(`${dir}/${HOST_NAME}.json`, manifest);
  installed.push(browser);
}

async function exists(path: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["test", "-d", path]);
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

// 4. launchd agent for the HTTP server — the preferred transport on macOS.
// Browsers propagate their quarantine flag down the process tree, so CLIs
// that extract unsigned dylibs (opencode) trigger Gatekeeper on every run
// when spawned under the native messaging host. launchd as the ancestor
// avoids quarantine inheritance entirely.
const agentLabel = "com.miyago9267.asktab.server";
const agentPlist = `${homedir()}/Library/LaunchAgents/${agentLabel}.plist`;
await mkdir(`${homedir()}/Library/LaunchAgents`, { recursive: true });
await Bun.write(
  agentPlist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${agentLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>run</string>
    <string>${root}/server/src/index.ts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/asktab-server.log</string>
  <key>StandardErrorPath</key><string>/tmp/asktab-server.log</string>
</dict>
</plist>
`,
);
const uid = process.getuid?.() ?? 501;
await Bun.spawn(["launchctl", "bootout", `gui/${uid}/${agentLabel}`], { stderr: "ignore" }).exited;
const boot = Bun.spawn(["launchctl", "bootstrap", `gui/${uid}`, agentPlist], { stderr: "pipe" });
if ((await boot.exited) !== 0) {
  console.error("launchctl bootstrap failed:", await new Response(boot.stderr).text());
}

console.log(`extension ID: ${extensionId}`);
console.log(`host manifest installed for: ${installed.join(", ") || "no browsers found"}`);
console.log(`launchd agent: ${agentLabel} (server on 127.0.0.1:8787)`);
console.log("next: bun run build:ext, then (re)load extension/dist in the browser");
