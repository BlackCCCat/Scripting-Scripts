import { Path } from "scripting";
import { T9_PROCESSOR_LUA } from "./keyboard/t9ProcessorAsset";

export const T9_PROCESSOR_FILENAME = "t9_processor.lua";
export const T9_PROCESSOR_SCHEMA_ENTRY =
  "- lua_processor@*t9_processor*processor";

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function scriptingRimeDataRoots() {
  const fm = (globalThis as any).FileManager;
  const roots: string[] = [];

  const appGroupDocumentsDirectory = String(
    fm?.appGroupDocumentsDirectory ?? "",
  ).trim();
  if (appGroupDocumentsDirectory) {
    const appGroupRoot = String(Path.dirname(appGroupDocumentsDirectory))
      .trim();
    const rimeRoot = String(Path.join(appGroupRoot, "Rime")).trim();
    roots.push(
      String(Path.join(rimeRoot, "user")).trim(),
      String(Path.join(rimeRoot, "shared")).trim(),
    );
  }

  const rime = (globalThis as any).Rime;
  roots.push(
    String(rime?.userDataDir ?? "").trim(),
    String(rime?.sharedDataDir ?? "").trim(),
  );

  return unique(roots);
}

async function pathExists(fm: any, path: string) {
  try {
    if (typeof fm.existsSync === "function") {
      return Boolean(fm.existsSync(path));
    }
    if (typeof fm.fileExists === "function") {
      return Boolean(fm.fileExists(path));
    }
    if (typeof fm.exists === "function") return Boolean(await fm.exists(path));
  } catch {}
  return false;
}

async function createDirectory(fm: any, path: string) {
  try {
    if (await pathExists(fm, path)) return true;
    if (typeof fm.createDirectorySync === "function") {
      fm.createDirectorySync(path);
      return true;
    }
    if (typeof fm.createDirectory === "function") {
      await fm.createDirectory(path);
      return true;
    }
  } catch {}
  return await pathExists(fm, path);
}

async function writeStringFile(fm: any, path: string, content: string) {
  try {
    if (typeof fm.writeAsStringSync === "function") {
      fm.writeAsStringSync(path, content);
      return true;
    }
    if (typeof fm.writeAsString === "function") {
      await fm.writeAsString(path, content);
      return true;
    }
    if (typeof fm.writeString === "function") {
      await fm.writeString(path, content);
      return true;
    }
  } catch {}
  return false;
}

export async function ensureT9ProcessorLuaInstalled() {
  const fm = (globalThis as any).FileManager;
  if (!fm || !T9_PROCESSOR_LUA) {
    return { ok: false, paths: [] as string[] };
  }

  const installed: string[] = [];
  for (const root of scriptingRimeDataRoots()) {
    const luaDir = String(Path.join(root, "lua")).trim();
    const target = String(Path.join(luaDir, T9_PROCESSOR_FILENAME)).trim();
    if (!(await createDirectory(fm, root))) continue;
    if (!(await createDirectory(fm, luaDir))) continue;
    if (await writeStringFile(fm, target, T9_PROCESSOR_LUA)) {
      installed.push(target);
    }
  }

  return {
    ok: installed.length > 0,
    paths: installed,
  };
}
