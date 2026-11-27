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
  AppLanguage,
  AppSettings,
  ConnectionCheckState,
  MFiStatus,
  MapDisplayStyle,
  PairingStatus,
  TunnelSource,
} from "../types";
import { formatText, getStrings } from "../utils/i18n";
import {
  clearMFiCredentials,
  mfiCandidateDirectories,
  saveMFiCredentials,
  scanLocalMFiDirectory,
  testMFiSignerRoundTrip,
} from "../utils/storage";
import {
  MetricTile,
  SettingsIconBadge,
  StepSectionHeader,
  ToolbarLeadingActions,
} from "./components";
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
  homeTabSwitcher?: { currentTab: number; onSelectTab: (tab: number) => void };
}

export function ConfigurationView(props: ConfigurationViewProps) {
  const { settings, mfiStatus, pairingStatus } = props;
  const s = getStrings(settings.language);

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
          props.onToast(formatText(s.config.certPickedToast, name));
        }
      } else {
        setPendingKeyBytes(bytes);
        setPendingKeyName(name);
        if (pendingCertBytes) {
          commitMFiPair(pendingCertBytes, bytes, `${pendingCertName} + ${name}`);
        } else {
          props.onToast(formatText(s.config.keyPickedToast, name));
        }
      }
    } catch (error) {
      props.onToast(formatText(s.config.mfiReadFailed, error instanceof Error ? error.message : String(error)));
    }
  }

  function commitMFiPair(certBytes: Uint8Array, keyBytes: Uint8Array, label: string) {
    try {
      const status = saveMFiCredentials(certBytes, keyBytes, label);
      setPendingCertBytes(null);
      setPendingCertName("");
      setPendingKeyBytes(null);
      setPendingKeyName("");
      props.onMFiChanged();
      props.onToast(formatText(s.config.mfiSavedToast, status.leafSubject ?? ""));
    } catch (error) {
      props.onToast(formatText(s.config.mfiVerifyFailed, error instanceof Error ? error.message : String(error)));
    }
  }

  function handleScanLocalMFi() {
    const found = scanLocalMFiDirectory();
    if (!found) {
      props.onToast(s.config.mfiScanNotFound);
      return;
    }
    props.onMFiChanged();
    props.onToast(formatText(s.config.mfiScanLoaded, found.status.leafSubject ?? ""));
  }

  function handleTestMFiRoundTrip() {
    const res = testMFiSignerRoundTrip();
    if (res.ok) {
      props.onToast(formatText(s.config.mfiRoundTripOk, res.durationMs));
    } else {
      props.onToast(formatText(s.config.mfiRoundTripFail, res.error ?? s.common.unknownError));
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
      props.onToast(formatText(s.config.importFailed, error instanceof Error ? error.message : String(error)));
    }
  }

  async function importPairingFromPasteboard() {
    const text = await Pasteboard.getString();
    if (!text) {
      props.onToast(s.config.clipboardEmpty);
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
        props.onToast(formatText(s.config.copiedUrlToast, spec.label));
        return;
      }

      const name = `${record.identifier || "reloc"}.${spec.extension}`;
      const data =
        format === "binary"
          ? Data.fromUint8Array(exportPairingAsBinary(record))
          : Data.fromString(
              format === "json" ? exportPairingAsJson(record) : exportPairingAsXml(record),
            );
      if (!data) throw new Error("Failed to build export data");
      const saved = await DocumentPicker.exportFiles({ files: [{ data, name }] });
      props.onToast(saved.length > 0 ? formatText(s.config.exportedFile, name) : s.config.exportCancelled);
    } catch (error) {
      props.onToast(formatText(s.config.exportFailed, error instanceof Error ? error.message : String(error)));
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
    ? s.config.svcChecking
    : connVerified === true
      ? s.config.svcConnected
      : connVerified === false
        ? s.config.svcFailed
        : s.config.svcPending;
  const serviceStatusTint: Color =
    connVerified === true
      ? RELOC_COLORS.emerald
      : connVerified === false
        ? RELOC_COLORS.amber
        : "secondaryLabel";

  const stepIndex = !props.pairingInProgress
    ? 0
    : /保存|saved/i.test(props.pairingStepMessage)
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

  return (
    <NavigationStack>
      <List
        navigationTitle={s.config.navTitle}
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={
          props.homeTabSwitcher || props.onClose
            ? {
                topBarLeading: (
                  <ToolbarLeadingActions
                    homeTabSwitcher={props.homeTabSwitcher}
                    onClose={props.onClose}
                    language={settings.language}
                  />
                ),
              }
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
                  {allReady ? s.config.heroReadyTitle : s.config.heroSetupTitle}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {allReady ? s.config.heroReadySub : s.config.heroSetupSub}
                </Text>
              </VStack>
              <Spacer />
            </HStack>

            <HStack spacing={10}>
              <MetricTile
                title={s.config.tilePairing}
                value={pairingStatus.isLoaded ? s.config.tilePairingSaved : s.config.tilePairingEmpty}
                tint={pairingStatus.isLoaded ? RELOC_COLORS.emerald : "secondaryLabel"}
              />
              <MetricTile
                title={s.config.tileMFi}
                value={mfiStatus.isLoaded ? s.config.tileMFiReady : s.config.tileMFiEmpty}
                tint={mfiStatus.isLoaded ? RELOC_COLORS.emerald : RELOC_COLORS.amber}
              />
              <MetricTile
                title={s.config.tileService}
                value={serviceStatusText}
                tint={serviceStatusTint}
              />
            </HStack>
          </VStack>
        </Section>

        {/* 01 隧道来源与连接目标 */}
        <Section header={<StepSectionHeader number="01" title={s.config.step1Title} />}>
          <Picker
            label={
              <HStack spacing={10}>
                <SettingsIconBadge systemName="network" color={RELOC_COLORS.accent} />
                <Text>{s.config.tunnelSource}</Text>
              </HStack>
            }
            value={settings.tunnelSource}
            onChanged={(val: string) => updateSetting("tunnelSource", val as TunnelSource)}
          >
            {TUNNEL_SOURCE_OPTIONS.map((opt) => (
              <Text key={opt.id} tag={opt.id}>
                {opt.id === "proxyApp" ? s.config.tunnelProxyLabel : s.config.tunnelBuiltInLabel}
              </Text>
            ))}
          </Picker>

          <HStack spacing={10}>
            <SettingsIconBadge systemName="server.rack" color="systemIndigo" />
            <Text>{s.config.targetHost}</Text>
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
            <Text>{s.config.rsdPort}</Text>
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
            <Text>{s.config.lockdownPort}</Text>
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
                <Text>{s.config.carkitService}</Text>
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
                  ? s.config.testConnChecking
                  : connVerified === true
                    ? s.config.testConnRetest
                    : s.config.testConnRun}
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
        <Section header={<StepSectionHeader number="02" title={s.config.step2Title} />}>
          <HStack spacing={10}>
            <SettingsIconBadge
              systemName={pairingStatus.isLoaded ? "checkmark.seal.fill" : "iphone.radiowaves.left.and.right"}
              color={pairingStatus.isLoaded ? RELOC_COLORS.emerald : RELOC_COLORS.amber}
            />
            <VStack alignment="leading" spacing={2}>
              <Text font="subheadline" fontWeight="medium">
                {pairingStatus.isLoaded ? pairingStatus.deviceName || s.config.pairingSavedDefault : s.config.pairingRecord}
              </Text>
              <Text
                font="caption"
                foregroundStyle={pairingStatus.isLoaded ? RELOC_COLORS.emerald : "secondaryLabel"}
                lineLimit={1}
              >
                {pairingStatus.isLoaded
                  ? `HostID: ${pairingStatus.summaryID ?? "-"}`
                  : s.config.pairingNotConfigured}
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
                  {pairingStatus.isLoaded ? s.config.repairDevice : s.config.pairDevice}
                </Text>
                <Spacer />
                <Text
                  font="caption2"
                  fontWeight="semibold"
                  foregroundStyle={RELOC_COLORS.accent}
                  padding={{ horizontal: 8, vertical: 3 }}
                  background={{ style: "rgba(43, 115, 245, 0.14)", shape: "capsule" }}
                >
                  {s.config.pipBadge}
                </Text>
              </HStack>
            </Button>
          ) : null}

          {props.pairingInProgress || props.pairingStepMessage ? (
            <VStack alignment="leading" spacing={10} padding={{ vertical: 4 }}>
              {props.pairingInProgress ? (
                <HStack spacing={6}>
                  {pairingStepPill(1, s.config.pairStep1, stepIndex >= 1, stepIndex === 1)}
                  <Image systemName="chevron.right" font="caption2" foregroundStyle="secondaryLabel" />
                  {pairingStepPill(2, s.config.pairStep2, stepIndex >= 2, stepIndex === 2)}
                  <Image systemName="chevron.right" font="caption2" foregroundStyle="secondaryLabel" />
                  {pairingStepPill(3, s.config.pairStep3, stepIndex >= 3, stepIndex === 3)}
                </HStack>
              ) : null}

              <Text
                font="footnote"
                fontWeight="medium"
                foregroundStyle={/失败|未完成|fail|incomplete/i.test(props.pairingStepMessage) ? RELOC_COLORS.crimson : "label"}
              >
                {props.pairingStepMessage || s.config.pairingWaitMsg}
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
                props.onToast(s.config.copiedPinToast);
                setTimeout(() => setCopiedPinToast(false), 1500);
              }}
            >
              <HStack spacing={10}>
                <SettingsIconBadge
                  systemName={copiedPinToast ? "checkmark" : "doc.on.doc"}
                  color={RELOC_COLORS.amber}
                />
                <Text foregroundStyle={RELOC_COLORS.amber} fontWeight="semibold">
                  {copiedPinToast ? s.config.copiedPinBtn : s.config.copyPinBtn}
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
                <Text foregroundStyle={RELOC_COLORS.crimson}>{s.config.cancelPairing}</Text>
              </HStack>
            </Button>
          ) : null}

          <Button
            disabled={props.pairingInProgress || props.isSessionRunning}
            action={() => void pickPairingFile()}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="square.and.arrow.down" color="systemBlue" />
              <Text foregroundStyle="label">{s.config.importPairingFile}</Text>
            </HStack>
          </Button>

          <Button
            disabled={props.pairingInProgress || props.isSessionRunning}
            action={() => void importPairingFromPasteboard()}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="doc.on.clipboard" color="systemIndigo" />
              <Text foregroundStyle="label">{s.config.importPairingClipboard}</Text>
            </HStack>
          </Button>

          <DisclosureGroup
            title={s.config.pairingDisclosure}
            isExpanded={exportExpanded}
            onChanged={setExportExpanded}
          >
            <TextField
              title={s.config.pastePairingPlaceholder}
              value={pastePairingText}
              onChanged={setPastePairingText}
              prompt='{"identifier": ...} / <?xml ...'
            />
            <Button
              title={s.config.parseImportBtn}
              action={async () => {
                const ok = await props.onImportPairingBytes(utf8(pastePairingText));
                if (ok) setPastePairingText("");
              }}
            />
            {pairingStatus.isLoaded ? (
              <>
                <Button
                  title={s.config.exportXmlBtn}
                  action={() => void handleExportPairing("xml", false)}
                />
                <Button
                  title={s.config.exportBinBtn}
                  action={() => void handleExportPairing("binary", false)}
                />
                <Button
                  title={s.config.copyJsonBtn}
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
                  title: s.config.deletePairingTitle,
                  message: s.config.deletePairingMsg,
                  confirmLabel: s.config.deletePairingConfirm,
                  cancelLabel: s.common.cancel,
                });
                if (!confirmed) return;
                props.onDeletePairing();
                props.onToast(s.config.deletedPairingToast);
              }}
            >
              <HStack spacing={10}>
                <SettingsIconBadge systemName="trash" color={RELOC_COLORS.crimson} />
                <Text foregroundStyle={RELOC_COLORS.crimson}>{s.config.removePairingBtn}</Text>
              </HStack>
            </Button>
          ) : null}
        </Section>

        {/* 03 MFi 本地凭据导入 */}
        <Section header={<StepSectionHeader number="03" title={s.config.step3Title} />}>
          <HStack spacing={10}>
            <SettingsIconBadge
              systemName={mfiStatus.isLoaded ? "checkmark.shield.fill" : "shield.slash.fill"}
              color={mfiStatus.isLoaded ? RELOC_COLORS.emerald : RELOC_COLORS.amber}
            />
            <VStack alignment="leading" spacing={2}>
              <Text font="subheadline" fontWeight="medium">
                {mfiStatus.isLoaded ? s.config.mfiReady : s.config.mfiEmpty}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                {mfiStatus.isLoaded
                  ? formatText(s.config.mfiCount, mfiStatus.leafSubject ?? "Leaf Cert", mfiStatus.certificateCount)
                  : mfiStatus.errorMessage || s.config.mfiPrompt}
              </Text>
              {mfiStatus.sourceLabel ? (
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  {formatText(s.config.mfiSource, mfiStatus.sourceLabel)}
                </Text>
              ) : null}
            </VStack>
            <Spacer />
          </HStack>

          <Button action={() => void pickMFiFile("cert")}>
            <HStack spacing={10}>
              <SettingsIconBadge systemName="doc.badge.plus" color={RELOC_COLORS.accent} />
              <Text foregroundStyle="label">
                {pendingCertName ? formatText(s.config.pickCertSelected, pendingCertName) : s.config.pickCert}
              </Text>
            </HStack>
          </Button>

          <Button action={() => void pickMFiFile("key")}>
            <HStack spacing={10}>
              <SettingsIconBadge systemName="key.fill" color={RELOC_COLORS.amber} />
              <Text foregroundStyle="label">
                {pendingKeyName ? formatText(s.config.pickKeySelected, pendingKeyName) : s.config.pickKey}
              </Text>
            </HStack>
          </Button>

          <Button action={handleScanLocalMFi}>
            <HStack spacing={10}>
              <SettingsIconBadge systemName="folder.badge.gearshape" color="systemTeal" />
              <Text foregroundStyle="label">{s.config.scanLocalMFi}</Text>
            </HStack>
          </Button>

          {mfiStatus.isLoaded ? (
            <>
              <Button action={handleTestMFiRoundTrip}>
                <HStack spacing={10}>
                  <SettingsIconBadge systemName="checkmark.seal" color={RELOC_COLORS.emerald} />
                  <Text foregroundStyle="label">{s.config.testMFiRoundTrip}</Text>
                </HStack>
              </Button>

              <Button
                role="destructive"
                action={async () => {
                  const confirmed = await Dialog.confirm({
                    title: s.config.clearMFiTitle,
                    message: s.config.clearMFiMsg,
                    confirmLabel: s.config.clearMFiConfirm,
                    cancelLabel: s.common.cancel,
                  });
                  if (!confirmed) return;
                  clearMFiCredentials();
                  props.onMFiChanged();
                  props.onToast(s.config.clearedMFiToast);
                }}
              >
                <HStack spacing={10}>
                  <SettingsIconBadge systemName="trash" color={RELOC_COLORS.crimson} />
                  <Text foregroundStyle={RELOC_COLORS.crimson}>{s.config.clearMFiBtn}</Text>
                </HStack>
              </Button>
            </>
          ) : null}

          <DisclosureGroup
            title={s.config.mfiGuideTitle}
            isExpanded={mfiGuideExpanded}
            onChanged={setMfiGuideExpanded}
          >
            <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {s.config.mfiGuideCert}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {s.config.mfiGuideKey}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {formatText(s.config.mfiGuideDirs, mfiCandidateDirectories().map((d) => `  - ${d}`).join("\n"))}
              </Text>
            </VStack>
          </DisclosureGroup>
        </Section>

        {/* 04 定位与外观选项 */}
        <Section header={<StepSectionHeader number="04" title={s.config.step4Title} />}>
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
              <LabeledContent title={s.config.nmeaInterval}>
                <Text fontDesign="monospaced">{formatText(s.config.nmeaIntervalVal, settings.intervalSeconds.toFixed(2))}</Text>
              </LabeledContent>
            </HStack>
          </Stepper>

          <Picker
            label={
              <HStack spacing={10}>
                <SettingsIconBadge systemName="hourglass" color="systemPurple" />
                <Text>{s.config.durationLabel}</Text>
              </HStack>
            }
            value={settings.durationSeconds}
            onChanged={(v: number) => updateSetting("durationSeconds", v)}
          >
            {DURATION_OPTIONS.map((opt) => (
              <Text key={opt.value} tag={opt.value}>
                {opt.value === 0 ? s.config.durationContinuous : formatText(s.config.durationSeconds, opt.value)}
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
              <LabeledContent title={s.config.defaultAltitude}>
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
              <Text>{s.config.gcj02Toggle}</Text>
            </HStack>
          </Toggle>

          <Toggle
            value={settings.microJitterEnabled}
            onChanged={(v) => updateSetting("microJitterEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="dot.radiowaves.left.and.right" color={RELOC_COLORS.amber} />
              <Text>{s.config.microJitterToggle}</Text>
            </HStack>
          </Toggle>

          <Toggle
            value={settings.backgroundKeepAliveEnabled}
            onChanged={(v) => updateSetting("backgroundKeepAliveEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="bolt.shield.fill" color="systemTeal" />
              <Text>{s.config.keepAliveToggle}</Text>
            </HStack>
          </Toggle>

          <Toggle
            value={settings.liveActivityEnabled}
            onChanged={(v) => updateSetting("liveActivityEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="platter.filled.top.iphone" color="systemPink" />
              <Text>{s.config.liveActivityToggle}</Text>
            </HStack>
          </Toggle>

          <Picker
            label={
              <HStack spacing={10}>
                <SettingsIconBadge systemName="globe" color={RELOC_COLORS.accent} />
                <Text>{s.config.languageLabel}</Text>
              </HStack>
            }
            value={settings.language}
            onChanged={(val: string) => updateSetting("language", val as AppLanguage)}
          >
            <Text tag="system">{s.config.languageSystem}</Text>
            <Text tag="zh-Hans">简体中文</Text>
            <Text tag="en">English</Text>
          </Picker>

          <Picker
            label={
              <HStack spacing={10}>
                <SettingsIconBadge systemName="map.fill" color={RELOC_COLORS.accent} />
                <Text>{s.config.mapStyleLabel}</Text>
              </HStack>
            }
            value={settings.mapStyle}
            onChanged={(val: string) => updateSetting("mapStyle", val as MapDisplayStyle)}
          >
            <Text tag="standard">{s.map.styleStandard}</Text>
            <Text tag="satellite">{s.map.styleSatellite}</Text>
            <Text tag="hybrid">{s.map.styleHybrid}</Text>
          </Picker>
        </Section>

        {/* 05 海外搜索服务 */}
        <Section header={<StepSectionHeader number="05" title={s.config.step5Title} />}>
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
              title={s.config.restoreDefaultSearchBtn}
              action={() => updateSetting("globalSearchEndpoint", "")}
            />
          ) : null}
        </Section>

        {/* 06 快捷指令配置 */}
        <Section header={<StepSectionHeader number="06" title={s.config.step6Title} />}>
          <Toggle
            value={settings.shortcutButtonEnabled}
            onChanged={(v) => updateSetting("shortcutButtonEnabled", v)}
          >
            <HStack spacing={10}>
              <SettingsIconBadge systemName="bolt.fill" color={RELOC_COLORS.accent} />
              <Text>{s.config.shortcutToggle}</Text>
            </HStack>
          </Toggle>

          {settings.shortcutButtonEnabled ? (
            <>
              <HStack spacing={10}>
                <SettingsIconBadge systemName="character.cursor.ibeam" color="systemIndigo" />
                <Text>{s.config.shortcutNameLabel}</Text>
                <Spacer />
                <TextField
                  title={s.config.shortcutNamePlaceholder}
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
                  props.onToast(formatText(s.config.copiedUrlToast, target));
                }}
              >
                <HStack spacing={10}>
                  <SettingsIconBadge systemName="doc.on.doc.fill" color="systemBlue" />
                  <VStack alignment="leading" spacing={2}>
                    <Text foregroundStyle="label">{s.config.copyLocationUrlTitle}</Text>
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
                    <Text foregroundStyle="label">{s.config.runShortcutBtn}</Text>
                  </HStack>
                </Button>
              ) : null}
            </>
          ) : null}
        </Section>

        {/* 07 上游项目与致谢 */}
        <Section header={<StepSectionHeader number="07" title={s.config.step7Title} />}>
          <HStack spacing={10}>
            <SettingsIconBadge systemName="arrow.triangle.branch" color={RELOC_COLORS.accent} />
            <LabeledContent title={s.config.upstreamProject}>
              <Link url={UPSTREAM_INFO.repoUrl}>
                {UPSTREAM_INFO.name}
              </Link>
            </LabeledContent>
          </HStack>

          <HStack spacing={10}>
            <SettingsIconBadge systemName="tag.fill" color={RELOC_COLORS.emerald} />
            <LabeledContent title={s.config.syncBase}>
              <Text fontDesign="monospaced">
                {`${UPSTREAM_INFO.baseTag} · ${UPSTREAM_INFO.baseCommitShort}`}
              </Text>
            </LabeledContent>
          </HStack>

          <HStack spacing={10}>
            <SettingsIconBadge systemName="doc.text.fill" color="systemPurple" />
            <LabeledContent title={s.config.license}>
              <Text fontDesign="monospaced">{UPSTREAM_INFO.license}</Text>
            </LabeledContent>
          </HStack>

          {props.onOpenChangelog ? (
            <Button action={props.onOpenChangelog}>
              <HStack spacing={10}>
                <SettingsIconBadge systemName="sparkles" color={RELOC_COLORS.amber} />
                <Text foregroundStyle="label">{s.config.viewChangelog}</Text>
              </HStack>
            </Button>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  );
}
