import { getCatalog } from "./catalog";
import { encodeNativeMessage, NativeMessageReader } from "./framing";
import { runChat } from "./providers";
import type { ChatRequest } from "./types";

/**
 * Native messaging host entry point. The browser spawns this process on
 * chrome.runtime.connectNative and closes stdin when the port disconnects.
 */

interface HostRequest {
  id: number;
  type: "health" | "providers" | "chat";
  payload?: ChatRequest;
}

const write = (msg: unknown) => {
  process.stdout.write(encodeNativeMessage(msg));
};

async function handle(req: HostRequest): Promise<void> {
  try {
    switch (req.type) {
      case "health":
        write({ id: req.id, type: "health", ok: true });
        break;
      case "providers":
        write({ id: req.id, type: "providers", catalog: await getCatalog() });
        break;
      case "chat": {
        if (!req.payload?.provider || !req.payload?.messages?.length) {
          write({ id: req.id, type: "error", message: "invalid chat payload" });
          break;
        }
        for await (const ev of runChat(req.payload)) {
          write({ id: req.id, ...ev });
        }
        break;
      }
      default:
        write({ id: (req as any)?.id ?? -1, type: "error", message: "unknown request type" });
    }
  } catch (err) {
    write({ id: req.id, type: "error", message: String(err) });
  }
  write({ id: req.id, type: "done" });
}

const reader = new NativeMessageReader();
for await (const chunk of Bun.stdin.stream()) {
  for (const msg of reader.feed(chunk as Uint8Array)) {
    void handle(msg as HostRequest);
  }
}
process.exit(0);
