import {
  Button,
  DisclosureGroup,
  HStack,
  Image,
  LabeledContent,
  Link,
  List,
  NavigationStack,
  Picker,
  ProgressView,
  Rectangle,
  RoundedRectangle,
  Section,
  Spacer,
  Stepper,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  type Color,
  useState,
} from "scripting";
import {
  DEFAULT_GLOBAL_SEARCH_ENDPOINT,
  DEFAULT_SERVICE_NAME,
  DURATION_OPTIONS,
  SHIM_SERVICE_NAME,
  TUNNEL_SOURCE_OPTIONS,
  UPSTREAM_INFO,
} from "../constants";
import { utf8 } from "../core/bytes";
import {
  PAIRING_EXPORT_FORMATS,
  exportPairingAsBinary,
  exportPairingAsJson,
  exportPairingAsXml,
  type PairingExportFormat,
} from "../core/pairing";
import type {
  AppSettings,
  ConnectionCheckState,
  MFiStatus,
  MapDisplayStyle,
  PairingStatus,
  TunnelSource,
} from "../types";
import {
  clearMFiCredentials,
  mfiCandidateDirectories,
  saveMFiCredentials,
  scanLocalMFiDirectory,
  testMFiSignerRoundTrip,
} from "../utils/storage";
import { MetricTile, SettingsIconBadge, StepSectionHeader } from "./components";
import { RELOC_COLORS } from "./theme";
import { launchShortcut } from "../utils/shortcut";

interface ConfigurationViewProps {
  settings: AppSettings;
  mfiStatus: MFiStatus;
  pairingStatus: PairingStatus;
  pairingInProgress: boolean;
  pairingPIN: string;
  pairingStepMessage: string;
  connectionState: ConnectionCheckState;
  connectionSummary: string;
  isSessionRunning: boolean;
  onUpdateSettings: (next: AppSettings) => void;
  onMFiChanged: () => void;
  onStartOnDevicePairing: () => void;
  onCancelOnDevicePairing: () => void;
  onImportPairingBytes: (bytes: Uint8Array) => Promise<boolean>;
  onDeletePairing: () => void;
  onTestConnection: () => Promise<string>;
  onOpenChangelog?: () => void;
  onToast: (message: string) => void;
  onClose?: () => void;
  embedded?: boolean;
}

export function ConfigurationView(props: ConfigurationViewProps) {
  const { settings, mfiStatus, pairingStatus } = props;

  const [pendingCertBytes, setPendingCertBytes] = useState<Uint8Array | null>(null);
  const [pendingCertName, setPendingCertName] = useState<string>("");
  const [pendingKeyBytes, setPendingKeyBytes] = useState<Uint8Array | null>(null);
  const [pendingKeyName, setPendingKeyName] = useState<string>("");
  const [mfiGuideExpanded, setMfiGuideExpanded] = useState(false);

  const [pastePairingText, setPastePairingText] = useState("");
  const [exportExpanded, setExportExpanded] = useState(false);
  const [copiedPinToast, setCopiedPinToast] = useState(false);

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    props.onUpdateSettings({ ...settings, [key]: value });
  }

  async function pickMFiFile(kind: "cert" | "key") {
    try {
      const files = await DocumentPicker.pickFiles({
        types: ["public.data", "public.item", "public.text"],
      });
      if (!files || files.length === 0) return;
      const path = files[0];
      const name = path.split("/").pop() || path;
      const bytes = FileManager.readAsBytesSync(path);

      if (kind === "cert") {
        setPendingCertBytes(bytes);
        setPendingCertName(name);
        if (pendingKeyBytes) {
          commitMFiPair(bytes, pendingKeyBytes, `${name} + ${pendingKeyName}`);
        } else {
          props.onToast(`已读取证书 ${name}，请继续选择 identity.pk8 私钥`);
        }
      } else {
        setPendingKeyBytes(bytes);
        setPendingKeyName(name);
        if (pendingCertBytes) {
          commitMFiPair(pendingCertBytes, bytes, `${pendingCertName} + ${name}`);
        } else {
          props.onToast(`已读取私钥 ${name}，请继续选择 certificate.p7b 证书`);
        }
      }
    } catch (error) {
      props.onToast(`读取文件失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function commitMFiPair(certBytes: Uint8Array, keyBytes: Uint8Array, label: string) {
    try {
      const status = saveMFiCredentials(certBytes, keyBytes, `手动导入 (${label})`);
      setPendingCertBytes(null);
      setPendingCertName("");
      setPendingKeyBytes(null);
      setPendingKeyName("");
      props.onMFiChanged();
      props.onToast(`✓ MFi 凭据校验通过：${status.leafSubject}`);
    } catch (error) {
      props.onToast(`MFi 校验失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function handleScanLocalMFi() {
    const found = scanLocalMFiDirectory();
    if (!found) {
      props.onToast("未在本地预设目录找到匹配的 certificate.p7b 与 identity.pk8");
      return;
    }
    props.onMFiChanged();
    props.onToast(`✓ 已自动载入本地凭据（${found.status.leafSubject ?? ""}）`);
  }

  function handleTestMFiRoundTrip() {
    const res = testMFiSignerRoundTrip();
    if (res.ok) {
      props.onToast(`✓ ECDSA P-256 签名验证通过 (${res.durationMs} ms)`);
    } else {
      props.onToast(`MFi 验证失败：${res.error ?? "未知错误"}`);
    }
  }

  async function pickPairingFile() {
    try {
      const files = await DocumentPicker.pickFiles({
        types: ["public.data", "public.item", "public.text"],
      });
      if (!files || files.length === 0) return;
      const bytes = FileManager.readAsBytesSync(files[0]);
      await props.onImportPairingBytes(bytes);
    } catch (error) {
      props.onToast(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function importPairingFromPasteboard() {
    const text = await Pasteboard.getString();
    if (!text) {
      props.onToast("剪贴板为空");
      return;
    }
    await props.onImportPairingBytes(utf8(text));
  }

  async function handleExportPairing(format: PairingExportFormat, toClipboard: boolean) {
    try {
      const { loadPairing } = await import("../core/pairing");
      const record = loadPairing();
      if (!record) return;
      const spec = PAIRING_EXPORT_FORMATS.find((f) => f.id === format);
      if (!spec) return;

      if (toClipboard) {
        const text = format === "json" ? exportPairingAsJson(record) : exportPairingAsXml(record);
        Pasteboard.setString(text);
        props.onToast(`✓ 已复制 ${spec.label} 到剪贴板`);
        return;
      }

      const name = `${record.identifier || "reloc"}.${spec.extension}`;
      const data =
        format === "binary"
          ? Data.fromUint8Array(exportPairingAsBinary(record))
          : Data.fromString(
              format === "json" ? exportPairingAsJson(record) : exportPairingAsXml(record),
            );
      if (!data) throw new Error("无法构建导出数据");
      const saved = await DocumentPicker.exportFiles({ files: [{ data, name }] });
      props.onToast(saved.length > 0 ? `✓ 已导出 ${name}` : "已取消导出");
    } catch (error) {
      props.onToast(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const testingConn = props.connectionState === "checking";
  const connVerified =
    props.connectionState === "verified"
      ? true
      : props.connectionState === "failed"
        ? false
        : null;
  const connTestSummary = props.connectionSummary;

  async function handleTestConn() {
    if (testingConn) return;
    try {
      await props.onTestConnection();
    } catch {
      // 错误提示已由 runConnectionCheck 通过 Toast 和 connectionSummary 处理
    }
  }

  const allReady = pairingStatus.isLoaded && mfiStatus.isLoaded && connVerified === true;
  const partialReady = pairingStatus.isLoaded && mfiStatus.isLoaded;
  const heroAccent: Color = allReady
    ? RELOC_COLORS.emerald
    : partialReady
      ? RELOC_COLORS.accent
      : RELOC_COLORS.amber;
  const heroBgTint: Color = allReady
    ? "rgba(23, 184, 122, 0.16)"
    : partialReady
      ? "rgba(43, 115, 245, 0.16)"
      : "rgba(242, 153, 31, 0.16)";
  const heroCardShape = { type: "rect" as const, cornerRadius: 20, style: "continuous" as const };
  const heroIconShape = { type: "rect" as const, cornerRadius: 14, style: "continuous" as const };
  const pinBoxShape = { type: "rect" as const, cornerRadius: 10, style: "continuous" as const };

  const serviceStatusText = testingConn
    ? "验证中"
    : connVerified === true
      ? "已连接"
      : connVerified === false
        ? "连接失败"
        : "待验证";
  const serviceStatusTint: Color =
    connVerified === true
      ? RELOC_COLORS.emerald
      : connVerified === false
        ? RELOC_COLORS.amber
        : "secondaryLabel";

  const stepIndex = !props.pairingInProgress
    ? 0
    : props.pairingStepMessage.includes("保存")
      ? 3
      : props.pairingPIN
        ? 2
        : 1;

  function pairingStepPill(num: number, title: string, active: boolean, current: boolean) {
    return (
      <HStack
        spacing={4}
        padding={{ horizontal: 7, vertical: 4 }}
        background={{
          style: current ? "rgba(43, 115, 245, 0.14)" : "clear",
          shape: "capsule",
        }}
      >
        <Text
          font="caption2"
          fontWeight="bold"
          fontDesign="rounded"
          foregroundStyle={active ? "white" : "secondaryLabel"}
          frame={{ width: 16, height: 16 }}
          background={{
            style: active ? RELOC_COLORS.accent : "rgba(142, 142, 147, 0.25)",
            shape: "circle",
          }}
        >
          {String(num)}
        </Text>
        <Text
          font="caption2"
          fontWeight={current ? "bold" : "medium"}
          foregroundStyle={active ? "label" : "secondaryLabel"}
          lineLimit={1}
        >
          {title}
        </Text>
      </HStack>
    );
  }

  const listContent = (
    <List
      navigationTitle={props.embedded ? undefined : "设备配对与连接"}
      navigationBarTitleDisplayMode="inline"
      listStyle="insetGroup"
      toolbar={
        !props.embedded && props.onClose
          ? { topBarTrailing: <Button title="关闭" action={props.onClose} /> }
          : undefined
      }
    >
        {/* 顶部 Hero 状态概览卡片（对应 heroHeaderCard，overlay RoundedRectangle 确保四角描边与圆角完全贴合） */}
        <Section>
          <VStack
            alignment="leading"
            spacing={14}
            padding={16}
            background={{ style: "secondarySystemGroupedBackground", shape: heroCardShape }}
            clipShape={heroCardShape}
            overlay={
              <ZStack allowsHitTesting={false}>
                <RoundedRectangle
                  cornerRadius={20}
                  style="continuous"
                  fill="clear"
                  stroke={{
                    shapeStyle: heroAccent,
                    strokeStyle: { lineWidth: 1 },
                  }}
                />
              </ZStack>
            }
            listRowInsets={{ top: 8, leading: 0, bottom: 8, trailing: 0 }}
            listRowBackground={<Rectangle fill="clear" />}
          >
            <HStack spacing={12}>
              <ZStack frame={{ width: 48, height: 48 }} background={{ style: heroBgTint, shape: heroIconShape }}>
                <Image
                  systemName={allReady ? "checkmark.shield.fill" : "antenna.radiowaves.left.and.right"}
                  font="title2"
                  fontWeight="bold"
                  foregroundStyle={heroAccent}
                />
              </ZStack>

              <VStack alignment="leading" spacing={3}>
                <Text font="headline">
                  {allReady ? "设备与认证已就绪" : "配置回环、配对与 MFi 凭据"}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {allReady
                    ? "可直接返回「定位」标签页开始定格定位"
                    : "依次完成回环通路、设备配对、MFi 本地凭据与验证"}
                </Text>
              </VStack>
              <Spacer />
            </HStack>

            <HStack spacing={10}>
              <MetricTile
                title="配对记录"
                value={pairingStatus.isLoaded ? "已保存" : "未配置"}
                tint={pairingStatus.isLoaded ? RELOC_COLORS.emerald : "secondaryLabel"}
              />
              <MetricTile
                title="MFi 凭据"
                value={mfiStatus.isLoaded ? "已就绪" : "未导入"}
                tint={mfiStatus.isLoaded ? RELOC_COLORS.emerald : RELOC_COLORS.amber}
              />
              <MetricTile
                title="设备服务"
                value={serviceStatusText}
                tint={serviceStatusTint}
              />
            </HStack>
          </VStack>
        </Section>

        {/* 01 隧道来源与连接目标 */}
        <Section header={<StepSectionHeader number="01" title="隧道来源与连接目标" />}>
          <Picker
            label={
              <HStack spacing={10}>
                <SettingsIconBadge systemName="network" color={RELOC_COLORS.accent} />
                <Text>隧道来源</Text>
              </HStack>
            }
            value={settings.tunnelSource}
            onChanged={(val: string) => updateSetting("tunnelSource", val as TunnelSource)}
          >
            {TUNNEL_SOURCE_OPTIONS.map((opt) => (
              <Text key={opt.id} tag={opt.id}>
                {opt.label}
              </Text>
            ))}
          </Picker>

          <HStack spacing={10}>
            <SettingsIconBadge systemName="server.rack" color="systemIndigo" />
            <Text>目标主机</Text>
            <Spacer />
            <TextField
              title="10.7.0.1"
              value={settings.host}
              onChanged={(v) => updateSetting("host", v)}
              multilineTextAlignment="trailing"
              keyboardType="URL"
              frame={{ width: 150 }}
            />
          </HStack>

          <HStack spacing={10}>
            <SettingsIconBadge systemName="cable.connector" color="systemBlue" />
            <Text>RSD 端口</Text>
            <Spacer />
            <TextField
              title="49152"
              value={String(settings.remotePort)}
              onChanged={(v) => {
                const n = Number.parseInt(v, 10);
                if (!Number.isNaN(n)) updateSetting("remotePort", n);
              }}
              multilineTextAlignment="trailing"
              keyboardType="numberPad"
              frame={{ width: 100 }}
            />
          </HStack>

          <HStack spacing={10}>
            <SettingsIconBadge systemName="lock.shield" color="systemTeal" />
            <Text>Lockdown 端口</Text>
            <Spacer />
            <TextField
              title="62078"
              value={String(settings.lockdownPort)}
              onChanged={(v) => {
                const n = Number.parseInt(v, 10);
                if (!Number.isNaN(n)) updateSetting("lockdownPort", n);
              }}
              multilineTextAlignment="trailing"
              keyboardType="numberPad"
              frame={{ width: 100 }}
            />
          </HStack>

          <Picker
            label={
              <HStack spacing={10}>
                <SettingsIconBadge systemName="car.fill" color={RELOC_COLORS.emerald} />
                <Text>CarKit 服务名</Text>
              </HStack>
            }
            value={settings.serviceName}
            onChanged={(v: string) => updateSetting("serviceName", v)}
          >
            <Text tag={DEFAULT_SERVICE_NAME}>{DEFAULT_SERVICE_NAME}</Text>
            <Text tag={SHIM_SERVICE_NAME}>{SHIM_SERVICE_NAME}</Text>
          </Picker>

          <Button
            disabled={testingConn || props.isSessionRunning}
            action={() => void handleTestConn()}
          >
            <HStack spacing={10}>
              {testingConn ? (
                <ProgressView controlSize="small" frame={{ width: 28, height: 28 }} />
              ) : (
                <SettingsIconBadge
                  systemName={
                    connVerified === true
                      ? "checkmark"
                      : connVerified === false
                        ? "exclamationmark"
                        : "arrow.triangle.2.circlepath"
                  }
                  color={
                    connVerified === true
                      ? RELOC_COLORS.emerald
                      : connVerified === false
                        ? RELOC_COLORS.amber
                        : RELOC_COLORS.accent
                  }
                />
              )}
              <Text foregroundStyle="label">
                {testingConn
                  ? "正在检测设备连接与 CarKit 服务…"
                  : connVerified === true
                    ? "重新检测设备连接"
                    : "测试设备连接与 CarKit 服务"}
              </Text>
            </HStack>
          </Button>

          {connTestSummary ? (
            <Text font="caption" foregroundStyle={connVerified === false ? RELOC_COLORS.amber : "secondaryLabel"}>
              {connTestSummary}
            </Text>
          ) : null}
        </Section>

        {/* 02 设备配对 (Remote Pairing) */}
        <Section header={<StepSectionHeader number="02" title="设备配对" />}>
          <HStack spacing={10}>
            <SettingsIconBadge
              systemName={pairingStatus.isLoaded ? "checkmark.seal.fill" : "iphone.radiowaves.left.and.right"}
              color={pairingStatus.isLoaded ? RELOC_COLORS.emerald : RELOC_COLORS.amber}
            />
            <VStack alignment="leading" spacing={2}>
              <Text font="subheadline" fontWeight="medium">
                {pairingStatus.isLoaded ? pairingStatus.deviceName || "配对记录已保存" : "配对记录"}
              </Text>
              <Text
                font="caption"
                foregroundStyle={pairingStatus.isLoaded ? RELOC_COLORS.emerald : "secondaryLabel"}
                lineLimit={1}
              >
                {pairingStatus.isLoaded
                  ? `HostID: ${pairingStatus.summaryID ?? "-"}`
                  : "尚未配置这台 iPhone"}
              </Text>
            </VStack>
            <Spacer />
          </HStack>

          {!props.pairingInProgress ? (
            <Button
              disabled={props.isSessionRunning}
              action={props.onStartOnDevicePairing}
            >
              <HStack spacing={10}>
                <SettingsIconBadge systemName="iphone.gen3.radiowaves.left.and.right" color={RELOC_COLORS.accent} />
                <Text font="subheadline" fontWeight="semibold" foregroundStyle="label">
                  {pairingStatus.isLoaded ? "重新配对这台 iPhone" : "一键配对这台 iPhone"}
                </Text>
                <Spacer />
                <Text
                  font="caption2"
                  fontWeight="semibold"
                  foregroundStyle={RELOC_COLORS.accent}
                  padding={{ horizontal: 8, vertical: 3 }}
                  background={{ style: "rgba(43, 115, 245, 0.14)", shape: "capsule" }}
                >
                  悬浮窗指引
                </Text>
              </HStack>
            </Button>
          ) : null}

          {props.pairingInProgress || props.pairingStepMessage ? (
            <VStack alignment="leading" spacing={10} padding={{ vertical: 4 }}>
              {props.pairingInProgress ? (
                <HStack spacing={6}>
                  {pairingStepPill(1, "广播就绪", stepIndex >= 1, stepIndex === 1)}
                  <Image systemName="chevron.right" font="caption2" foregroundStyle="secondaryLabel" />
                  {pairingStepPill(2, "输入配对码", stepIndex >= 2, stepIndex === 2)}
                  <Image systemName="chevron.right" font="caption2" foregroundStyle="secondaryLabel" />
                  {pairingStepPill(3, "保存完成", stepIndex >= 3, stepIndex === 3)}
                </HStack>
              ) : null}

              <Text
                font="footnote"
                fontWeight="medium"
                foregroundStyle={props.pairingStepMessage.includes("失败") ? RELOC_COLORS.crimson : "label"}
              >
                {props.pairingStepMessage || "正在等待系统设置完成配对…"}
              </Text>

              {props.pairingPIN ? (
                <HStack spacing={6}>
                  {Array.from(props.pairingPIN).map((ch, idx) => (
                    <ZStack
                      key={`${idx}-${ch}`}
                      frame={{ maxWidth: "infinity", height: 46 }}
                      background={{ style: "rgba(242, 153, 31, 0.16)", shape: pinBoxShape }}
                      clipShape={pinBoxShape}
                      overlay={
                        <ZStack allowsHitTesting={false}>
                          <RoundedRectangle
                            cornerRadius={10}
                            style="continuous"
                            fill="clear"
                            stroke={{
                              shapeStyle: "rgba(242, 153, 31, 0.45)",
                              strokeStyle: { lineWidth: 1 },
                            }}
                          />
                        </ZStack>
                      }
                    >
                      <Text font="title" fontWeight="bold" fontDesign="monospaced">
                        {ch}
                      </Text>
                    </ZStack>
                  ))}
                </HStack>
              ) : null}
            </VStack>
          ) : null}

          {props.pairingPIN ? (
            <Button
              action={() => {
                Pasteboard.setString(props.pairingPIN);
                HapticFeedback.lightImpact();
                setCopiedPinToast(true);
                props.onToast("已复制 6 位配对码");
                setTimeout(() => setCopiedPinToast(false), 1500);
              }}
            >
              <HStack spacing={10}>
                <SettingsIconBadge
                  systemName={copiedPinToast ? "checkmark" : "doc.on.doc"}
                  color={RELOC_COLORS.amber}
                />
                <Text foregroundStyle={RELOC_COLORS.amber} fontWeight="semibold">
                  {copiedPinToast ? "已复制配对码" : "复制配对码"}
                </Text>
              </HStack>
            </Button>
          ) : null}

          {props.pairingInProgress ? (
            <Button
              role="destructive"
              action={props.onCancelOnDevicePairing}
            >
              <HStack spacing={10}>
                <SettingsIconBadge systemName="xmark" color={RELOC_COLORS.crimson} />
                <Text foregroundStyle={RELOC_COLORS.crimson}>取消配对</Text>
              </HStack>
            </Button>
          ) : null}

          <Button
            disabled={props.pairingInProgress || props.isSessionRunning}
            action={() => void pickPairingFile()}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="square.and.arrow.down" color="systemBlue" />
              <Text foregroundStyle="label">导入已有配对文件 (.rppairing / .mobilepair / .json)</Text>
            </HStack>
          </Button>

          <Button
            disabled={props.pairingInProgress || props.isSessionRunning}
            action={() => void importPairingFromPasteboard()}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="doc.on.clipboard" color="systemIndigo" />
              <Text foregroundStyle="label">从剪贴板导入配对文本</Text>
            </HStack>
          </Button>

          <DisclosureGroup
            title="手动粘贴或导出当前配对记录"
            isExpanded={exportExpanded}
            onChanged={setExportExpanded}
          >
            <TextField
              title="粘贴 XML Plist 或 JSON 配对文本"
              value={pastePairingText}
              onChanged={setPastePairingText}
              prompt='{"identifier": ...} 或 <?xml ...'
            />
            <Button
              title="解析并导入上方文本"
              action={async () => {
                const ok = await props.onImportPairingBytes(utf8(pastePairingText));
                if (ok) setPastePairingText("");
              }}
            />
            {pairingStatus.isLoaded ? (
              <>
                <Button
                  title="导出为 .mobiledevicepairing (XML)"
                  action={() => void handleExportPairing("xml", false)}
                />
                <Button
                  title="导出为 .mobiledevicepairing (Binary)"
                  action={() => void handleExportPairing("binary", false)}
                />
                <Button
                  title="复制 JSON 到剪贴板"
                  action={() => void handleExportPairing("json", true)}
                />
              </>
            ) : null}
          </DisclosureGroup>

          {pairingStatus.isLoaded ? (
            <Button
              role="destructive"
              disabled={props.pairingInProgress || props.isSessionRunning}
              action={async () => {
                const confirmed = await Dialog.confirm({
                  title: "删除当前 Remote Pairing 记录？",
                  message: "删除后需要重新配对或导入配对文件才能建立 RSD 隧道。",
                  confirmLabel: "删除",
                  cancelLabel: "取消",
                });
                if (!confirmed) return;
                props.onDeletePairing();
                props.onToast("已删除配对记录");
              }}
            >
              <HStack spacing={10}>
                <SettingsIconBadge systemName="trash" color={RELOC_COLORS.crimson} />
                <Text foregroundStyle={RELOC_COLORS.crimson}>移除已保存配对记录</Text>
              </HStack>
            </Button>
          ) : null}
        </Section>

        {/* 03 MFi 本地凭据导入 */}
        <Section header={<StepSectionHeader number="03" title="MFi 本地凭据" />}>
          <HStack spacing={10}>
            <SettingsIconBadge
              systemName={mfiStatus.isLoaded ? "checkmark.shield.fill" : "shield.slash.fill"}
              color={mfiStatus.isLoaded ? RELOC_COLORS.emerald : RELOC_COLORS.amber}
            />
            <VStack alignment="leading" spacing={2}>
              <Text font="subheadline" fontWeight="medium">
                {mfiStatus.isLoaded ? "MFi 凭据已就绪" : "尚未加载 MFi 凭据"}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                {mfiStatus.isLoaded
                  ? `${mfiStatus.leafSubject ?? "Leaf Cert"} · 共 ${mfiStatus.certificateCount} 张证书`
                  : mfiStatus.errorMessage || "请选择 certificate.p7b 与 identity.pk8"}
              </Text>
              {mfiStatus.sourceLabel ? (
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  {`来源：${mfiStatus.sourceLabel}`}
                </Text>
              ) : null}
            </VStack>
            <Spacer />
          </HStack>

          <Button action={() => void pickMFiFile("cert")}>
            <HStack spacing={10}>
              <SettingsIconBadge systemName="doc.badge.plus" color={RELOC_COLORS.accent} />
              <Text foregroundStyle="label">
                {pendingCertName ? `已选证书：${pendingCertName}（点此重选）` : "选择 certificate.p7b 证书文件"}
              </Text>
            </HStack>
          </Button>

          <Button action={() => void pickMFiFile("key")}>
            <HStack spacing={10}>
              <SettingsIconBadge systemName="key.fill" color={RELOC_COLORS.amber} />
              <Text foregroundStyle="label">
                {pendingKeyName ? `已选私钥：${pendingKeyName}（点此重选）` : "选择 identity.pk8 私钥文件"}
              </Text>
            </HStack>
          </Button>

          <Button action={handleScanLocalMFi}>
            <HStack spacing={10}>
              <SettingsIconBadge systemName="folder.badge.gearshape" color="systemTeal" />
              <Text foregroundStyle="label">从本地预设目录自动扫描</Text>
            </HStack>
          </Button>

          {mfiStatus.isLoaded ? (
            <>
              <Button action={handleTestMFiRoundTrip}>
                <HStack spacing={10}>
                  <SettingsIconBadge systemName="checkmark.seal" color={RELOC_COLORS.emerald} />
                  <Text foregroundStyle="label">验证 MFi P-256 签名回环</Text>
                </HStack>
              </Button>

              <Button
                role="destructive"
                action={async () => {
                  const confirmed = await Dialog.confirm({
                    title: "清除本地 MFi 凭据？",
                    message: "清除后需重新选择 certificate.p7b 与 identity.pk8 或自动扫描目录。",
                    confirmLabel: "清除",
                    cancelLabel: "取消",
                  });
                  if (!confirmed) return;
                  clearMFiCredentials();
                  props.onMFiChanged();
                  props.onToast("已清除 MFi 凭据");
                }}
              >
                <HStack spacing={10}>
                  <SettingsIconBadge systemName="trash" color={RELOC_COLORS.crimson} />
                  <Text foregroundStyle={RELOC_COLORS.crimson}>清除已保存的 MFi 凭据</Text>
                </HStack>
              </Button>
            </>
          ) : null}

          <DisclosureGroup
            title="支持的本地目录与文件格式说明"
            isExpanded={mfiGuideExpanded}
            onChanged={setMfiGuideExpanded}
          >
            <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                • certificate.p7b：PKCS#7 SignedData 证书链（DER 或 PEM），需包含非 CA 的 EC P-256 叶子证书。
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                • identity.pk8：PKCS#8 或 SEC1 EC P-256 私钥（DER 或 PEM），将通过钥匙串本地签名 SHA-256 挑战。
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {`• 自动扫描目录：\n${mfiCandidateDirectories().map((d) => `  - ${d}`).join("\n")}`}
              </Text>
            </VStack>
          </DisclosureGroup>
        </Section>

        {/* 04 定位选项与地图外观 */}
        <Section header={<StepSectionHeader number="04" title="定位选项" />}>
          <Stepper
            onIncrement={() => {
              const next = Math.min(5.0, Math.round((settings.intervalSeconds + 0.25) * 100) / 100);
              updateSetting("intervalSeconds", next);
            }}
            onDecrement={() => {
              const next = Math.max(0.25, Math.round((settings.intervalSeconds - 0.25) * 100) / 100);
              updateSetting("intervalSeconds", next);
            }}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="timer" color={RELOC_COLORS.accent} />
              <LabeledContent title="NMEA 发送间隔">
                <Text fontDesign="monospaced">{`${settings.intervalSeconds.toFixed(2)} 秒`}</Text>
              </LabeledContent>
            </HStack>
          </Stepper>

          <Picker
            label={
              <HStack spacing={10}>
                <SettingsIconBadge systemName="hourglass" color="systemPurple" />
                <Text>会话时长</Text>
              </HStack>
            }
            value={settings.durationSeconds}
            onChanged={(v: number) => updateSetting("durationSeconds", v)}
          >
            {DURATION_OPTIONS.map((opt) => (
              <Text key={opt.value} tag={opt.value}>
                {opt.label}
              </Text>
            ))}
          </Picker>

          <Stepper
            onIncrement={() => {
              const next = Math.min(10000, Math.round(settings.defaultAltitude + 5));
              updateSetting("defaultAltitude", next);
            }}
            onDecrement={() => {
              const next = Math.max(-100, Math.round(settings.defaultAltitude - 5));
              updateSetting("defaultAltitude", next);
            }}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="mountain.2.fill" color="systemIndigo" />
              <LabeledContent title="默认海拔">
                <Text fontDesign="monospaced">{`${settings.defaultAltitude.toFixed(0)} m`}</Text>
              </LabeledContent>
            </HStack>
          </Stepper>

          <Toggle
            value={settings.gcj02CorrectionEnabled}
            onChanged={(v) => updateSetting("gcj02CorrectionEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="globe.asia.australia.fill" color={RELOC_COLORS.emerald} />
              <Text>中国大陆地图 GCJ-02 纠偏</Text>
            </HStack>
          </Toggle>

          <Toggle
            value={settings.microJitterEnabled}
            onChanged={(v) => updateSetting("microJitterEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="dot.radiowaves.left.and.right" color={RELOC_COLORS.amber} />
              <Text>自然微漂移 (±0.6m GPS 抖动)</Text>
            </HStack>
          </Toggle>

          <Toggle
            value={settings.backgroundKeepAliveEnabled}
            onChanged={(v) => updateSetting("backgroundKeepAliveEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="bolt.shield.fill" color="systemTeal" />
              <Text>后台保活（切换地图不断连）</Text>
            </HStack>
          </Toggle>

          <Toggle
            value={settings.liveActivityEnabled}
            onChanged={(v) => updateSetting("liveActivityEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="platter.filled.top.iphone" color="systemPink" />
              <Text>显示灵动岛（实时活动）</Text>
            </HStack>
          </Toggle>

          <Picker
            label={
              <HStack spacing={10}>
                <SettingsIconBadge systemName="map.fill" color={RELOC_COLORS.accent} />
                <Text>默认地图样式</Text>
              </HStack>
            }
            value={settings.mapStyle}
            onChanged={(s: string) => updateSetting("mapStyle", s as MapDisplayStyle)}
          >
            <Text tag="standard">标准地图</Text>
            <Text tag="satellite">卫星图</Text>
            <Text tag="hybrid">混合图</Text>
          </Picker>
        </Section>

        {/* 05 海外搜索服务 */}
        <Section header={<StepSectionHeader number="05" title="海外地理编码 (OSM)" />}>
          <HStack spacing={10}>
            <SettingsIconBadge systemName="magnifyingglass.circle.fill" color="systemBlue" />
            <TextField
              title={DEFAULT_GLOBAL_SEARCH_ENDPOINT}
              value={settings.globalSearchEndpoint}
              onChanged={(v) => updateSetting("globalSearchEndpoint", v)}
              keyboardType="URL"
            />
          </HStack>
          {settings.globalSearchEndpoint.trim() !== "" ? (
            <Button
              title="恢复默认搜索服务地址"
              action={() => updateSetting("globalSearchEndpoint", "")}
            />
          ) : null}
        </Section>

        {/* 06 快捷指令配置 */}
        <Section header={<StepSectionHeader number="06" title="快捷指令" />}>
          <Toggle
            value={settings.shortcutButtonEnabled}
            onChanged={(v) => updateSetting("shortcutButtonEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="gearshape.fill" color={RELOC_COLORS.accent} />
              <Text>首页显示快捷指令按钮</Text>
            </HStack>
          </Toggle>

          {settings.shortcutButtonEnabled ? (
            <>
              <HStack spacing={10}>
                <SettingsIconBadge systemName="character.cursor.ibeam" color="systemIndigo" />
                <Text>快捷指令名称</Text>
                <Spacer />
                <TextField
                  title="输入快捷指令名称"
                  value={settings.shortcutName}
                  onChanged={(v) => updateSetting("shortcutName", v)}
                  multilineTextAlignment="trailing"
                  textInputAutocapitalization="never"
                />
              </HStack>

              <Button
                action={async () => {
                  const target = "prefs:root=Privacy&path=LOCATION";
                  await Pasteboard.setString(target);
                  HapticFeedback.lightImpact();
                  props.onToast(`已复制：${target}`);
                }}
              >
                <HStack spacing={10}>
                  <SettingsIconBadge systemName="doc.on.doc.fill" color="systemBlue" />
                  <VStack alignment="leading" spacing={2}>
                    <Text foregroundStyle="label">复制定位设置链接（用于创建快捷指令）</Text>
                    <Text font="caption" fontDesign="monospaced" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {"prefs:root=Privacy&path=LOCATION"}
                    </Text>
                  </VStack>
                  <Spacer />
                </HStack>
              </Button>

              {settings.shortcutName.trim() !== "" ? (
                <Button action={() => void launchShortcut(settings.shortcutName, props.onToast)}>
                  <HStack spacing={10}>
                    <SettingsIconBadge systemName="play.fill" color={RELOC_COLORS.emerald} />
                    <Text foregroundStyle="label">立即运行该快捷指令</Text>
                  </HStack>
                </Button>
              ) : null}
            </>
          ) : null}
        </Section>

        {/* 07 上游项目与致谢 */}
        <Section header={<StepSectionHeader number="07" title="关于与上游致谢" />}>
          <HStack spacing={10}>
            <SettingsIconBadge systemName="arrow.triangle.branch" color={RELOC_COLORS.accent} />
            <LabeledContent title="上游项目">
              <Link url={UPSTREAM_INFO.repoUrl}>
                {UPSTREAM_INFO.name}
              </Link>
            </LabeledContent>
          </HStack>

          <HStack spacing={10}>
            <SettingsIconBadge systemName="tag.fill" color={RELOC_COLORS.emerald} />
            <LabeledContent title="同步基准">
              <Text fontDesign="monospaced">
                {`${UPSTREAM_INFO.baseTag} · ${UPSTREAM_INFO.baseCommitShort}`}
              </Text>
            </LabeledContent>
          </HStack>

          <HStack spacing={10}>
            <SettingsIconBadge systemName="doc.text.fill" color="systemPurple" />
            <LabeledContent title="开源协议">
              <Text fontDesign="monospaced">{UPSTREAM_INFO.license}</Text>
            </LabeledContent>
          </HStack>

          {props.onOpenChangelog ? (
            <Button action={props.onOpenChangelog}>
              <HStack spacing={10}>
                <SettingsIconBadge systemName="sparkles" color={RELOC_COLORS.amber} />
                <Text foregroundStyle="label">查看更新说明</Text>
              </HStack>
            </Button>
          ) : null}
        </Section>
      </List>
  );

  return props.embedded ? listContent : <NavigationStack>{listContent}</NavigationStack>;
}
