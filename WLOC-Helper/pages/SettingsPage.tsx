// 设置页：编辑设备代理写入接口、默认地图图层、写入精度和随机扰动半径。
// 保存后写回 Storage，并通知主页面刷新。

import { useState, NavigationStack, List, HStack, Text, Button, TextField, Section, Stepper, Toggle, Image, Spacer } from "scripting";
import type { AppSettings, MapLayerId } from "../types";
import {
  MAP_LAYER_OPTIONS,
  DEFAULT_SAVE_API,
  DEFAULT_ACCURACY,
  DEFAULT_ENABLED_RANDOM_RADIUS,
  MAX_RANDOM_RADIUS,
} from "../constants";

interface SettingsPageProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

export function SettingsPage({ settings, onSave }: SettingsPageProps) {
  const [saveApi, setSaveApi] = useState(settings.saveApi);
  const [defaultLayer, setDefaultLayer] = useState<MapLayerId>(settings.defaultLayer);
  const [accuracy, setAccuracy] = useState(settings.accuracy);
  const [randomRadiusEnabled, setRandomRadiusEnabled] = useState(settings.randomRadius > 0);
  const [randomRadiusText, setRandomRadiusText] = useState(
    String(settings.randomRadius > 0 ? settings.randomRadius : DEFAULT_ENABLED_RANDOM_RADIUS),
  );

  function normalizedRandomRadius(): number {
    const parsed = Number.parseInt(randomRadiusText, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ENABLED_RANDOM_RADIUS;
    return Math.min(MAX_RANDOM_RADIUS, parsed);
  }

  function handleRandomRadiusChanged(value: string) {
    const digits = value.replace(/\D/g, "");
    if (!digits) {
      setRandomRadiusText("");
      return;
    }
    setRandomRadiusText(String(Math.min(MAX_RANDOM_RADIUS, Number.parseInt(digits, 10))));
  }

  function handleSave() {
    onSave({
      saveApi: saveApi.trim() || DEFAULT_SAVE_API,
      defaultLayer,
      accuracy,
      randomRadius: randomRadiusEnabled ? normalizedRandomRadius() : 0,
    });
  }

  function handleReset() {
    setSaveApi(DEFAULT_SAVE_API);
    setDefaultLayer("imagery");
    setAccuracy(DEFAULT_ACCURACY);
    setRandomRadiusEnabled(false);
    setRandomRadiusText(String(DEFAULT_ENABLED_RANDOM_RADIUS));
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
      >
        <Section
          header={<Text>设备代理</Text>}
          footer={<Text foregroundStyle="tertiaryLabel">WLOC 模块拦截 gs-loc.apple.com，默认指向该写入接口。如使用自建代理可在此修改。</Text>}
        >
          <TextField
            title="写入接口地址"
            value={saveApi}
            onChanged={setSaveApi}
            axis="vertical"
          />
        </Section>

        <Section header={<Text>默认地图图层</Text>}>
          {MAP_LAYER_OPTIONS.map((opt) => (
            <Button key={opt.id} action={() => setDefaultLayer(opt.id)}>
              <HStack frame={{ maxWidth: "infinity" }} spacing={10}>
                <Image
                  systemName={opt.id === "imagery" ? "globe.europe.africa.fill" : opt.id === "hybrid" ? "map.fill" : "map"}
                  foregroundStyle={defaultLayer === opt.id ? "systemBlue" : "secondaryLabel"}
                  frame={{ width: 22 }}
                />
                <Text foregroundStyle="label">{opt.label}</Text>
                <Spacer />
                {defaultLayer === opt.id ? (
                  <Image systemName="checkmark" foregroundStyle="systemBlue" font="body" />
                ) : null}
              </HStack>
            </Button>
          ))}
        </Section>

        <Section
          header={<Text>写入精度</Text>}
          footer={<Text foregroundStyle="tertiaryLabel">写入设备时上报的定位精度（米），默认 25m。</Text>}
        >
          <HStack frame={{ maxWidth: "infinity" }} spacing={10}>
            <Image systemName="scope" foregroundStyle="secondaryLabel" frame={{ width: 22 }} />
            <Text foregroundStyle="label">精度</Text>
            <Spacer />
            <Stepper
              onIncrement={() => setAccuracy((a) => Math.min(200, a + 5))}
              onDecrement={() => setAccuracy((a) => Math.max(5, a - 5))}
            >
              <Text foregroundStyle="secondaryLabel">{accuracy} m</Text>
            </Stepper>
          </HStack>
        </Section>

        <Section
          header={<Text>随机扰动</Text>}
          footer={<Text foregroundStyle="tertiaryLabel">启用后，每次定位会在目标点周围指定半径内随机偏移。范围 1–5000m；保存设置后，下次点击“储存到设备”时写入，关闭则写入 0。</Text>}
        >
          <HStack frame={{ maxWidth: "infinity" }} spacing={10}>
            <Image systemName="circle.dotted" foregroundStyle="secondaryLabel" frame={{ width: 22 }} />
            <Text foregroundStyle="label">启用随机扰动</Text>
            <Spacer />
            <Toggle
              title=""
              toggleStyle="switch"
              value={randomRadiusEnabled}
              onChanged={setRandomRadiusEnabled}
            />
          </HStack>

          {randomRadiusEnabled ? (
            <HStack frame={{ maxWidth: "infinity", alignment: "leading" }} spacing={10}>
              <Image systemName="ruler" foregroundStyle="secondaryLabel" frame={{ width: 22 }} />
              <Text foregroundStyle="label" frame={{ width: 72, alignment: "leading" }}>扰动半径</Text>
              <Spacer />
              <TextField
                title=""
                value={randomRadiusText}
                onChanged={handleRandomRadiusChanged}
                onBlur={() => setRandomRadiusText(String(normalizedRandomRadius()))}
                keyboardType="numberPad"
                frame={{ width: 72, alignment: "trailing" }}
              />
              <Text foregroundStyle="secondaryLabel">m</Text>
            </HStack>
          ) : null}
        </Section>

        <Section>
          <Button title="恢复默认" systemImage="arrow.counterclockwise" action={handleReset} />
        </Section>

        <Section>
          <Button title="保存" systemImage="checkmark.circle" role="confirm" action={handleSave} />
        </Section>
      </List>
    </NavigationStack>
  );
}
