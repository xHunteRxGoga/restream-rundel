import { createTwitchConnector } from "./twitch.js";
import { createYouTubeConnector } from "./youtube.js";
import { createKickConnector } from "./kick.js";
import { createVkConnector } from "./vk.js";
import { PLATFORMS } from "../platforms.js";

export function createConnectors(options) {
  const connectors = {
    twitch: createTwitchConnector(options),
    youtube: createYouTubeConnector(options),
    kick: createKickConnector(options),
    vk: createVkConnector(options),
  };

  return {
    start() {
      for (const connector of Object.values(connectors)) {
        Promise.resolve(connector.start()).catch((error) => {
          console.error(error);
        });
      }
    },
    stop() {
      for (const connector of Object.values(connectors)) connector.stop();
    },
    reload() {
      this.stop();
      this.start();
    },
    async send(text) {
      return Promise.all(
        PLATFORMS.map(async (platform) => {
          try {
            const result = await connectors[platform].send(text);
            return { platform, ok: Boolean(result?.ok), error: result?.error || "" };
          } catch (error) {
            return { platform, ok: false, error: error.message || "не ушло" };
          }
        }),
      );
    },
  };
}
