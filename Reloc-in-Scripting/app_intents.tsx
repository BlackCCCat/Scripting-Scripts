import { AppIntentManager, AppIntentProtocol, LiveActivity, Notification } from "scripting";
import { STORAGE_KEYS } from "./constants";
import { debugLog, describeError } from "./core/debug";
import { getStrings, loadActiveLanguage } from "./utils/i18n";

type RestoreAck = {
  ok: boolean;
  message: string | null;
};

const ASK_TIMEOUT_MS = 25_000;

export const RelocStopSpoofingIntent = AppIntentManager.register({
  name: "RelocStopSpoofing",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (_params: undefined) => {
    const failure = await requestMainScriptStop();
    if (failure === null) {
      await LiveActivity.endAllActivities({ dismissTimeInterval: 0 }).catch(() => undefined);
      return;
    }
    const t = getStrings(loadActiveLanguage()).intent;
    await Notification.schedule({
      title: t.openRelocStopTitle,
      body: failure,
    }).catch(() => false);
  },
});

async function requestMainScriptStop(): Promise<string | null> {
  const t = getStrings(loadActiveLanguage()).intent;
  const id = Storage.get<string>(STORAGE_KEYS.sessionID) ?? null;
  if (!id) {
    Storage.remove(STORAGE_KEYS.interrupted);
    return t.mainNotRunning;
  }

  try {
    const ack = await ScriptSession.request<RestoreAck>(
      id,
      { type: "stop" },
      { timeout: ASK_TIMEOUT_MS },
    );
    debugLog("intent", `主脚本响应 stop: ${JSON.stringify(ack)}`);
    if (ack.ok) {
      Storage.remove(STORAGE_KEYS.interrupted);
      return null;
    }
    return ack.message ?? t.stopFailed;
  } catch (error) {
    debugLog("intent", "主脚本未响应", describeError(error));
    return t.cannotContactMain;
  }
}
