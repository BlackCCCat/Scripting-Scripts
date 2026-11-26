import { Intent, Navigation, Script } from "scripting";
import { App } from "./index";
import { parseAndConvertToMapCoord } from "./utils/coords";

function sharedInput(): string {
  return Intent.urlsParameter?.[0]?.trim() || Intent.textsParameter?.[0]?.trim() || "";
}

async function run() {
  const raw = sharedInput();
  if (!raw) {
    Script.exit(Intent.text("未收到可识别的地点分享链接或坐标文本。"));
    return;
  }

  let shared: { latitude: number; longitude: number; name?: string };
  try {
    const parsed = await parseAndConvertToMapCoord(raw);
    shared = {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      name: parsed.name || undefined,
    };
  } catch (error) {
    Script.exit(
      Intent.text(`无法解析分享位置：${error instanceof Error ? error.message : String(error)}`),
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
