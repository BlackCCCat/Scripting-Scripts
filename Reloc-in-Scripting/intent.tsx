import { Intent, Navigation, Script } from "scripting";
import { App } from "./index";
import { parseAndConvertToMapCoord } from "./utils/coords";
import { formatText, getStrings, loadActiveLanguage } from "./utils/i18n";

function sharedInput(): string {
  return Intent.urlsParameter?.[0]?.trim() || Intent.textsParameter?.[0]?.trim() || "";
}

async function run() {
  const t = getStrings(loadActiveLanguage()).intent;
  const raw = sharedInput();
  if (!raw) {
    Script.exit(Intent.text(t.noShareInput));
    return;
  }

  let shared: { latitude: number; longitude: number; altitude?: number; name?: string };
  try {
    const parsed = await parseAndConvertToMapCoord(raw);
    shared = {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      altitude: parsed.altitude,
      name: parsed.name || undefined,
    };
  } catch (error) {
    Script.exit(
      Intent.text(formatText(t.parseShareFailed, error instanceof Error ? error.message : String(error))),
    );
    return;
  }

  await Navigation.present({
    element: <App shared={shared} />,
    modalPresentationStyle: "fullScreen",
  });
  Script.exit();
}

void run();
