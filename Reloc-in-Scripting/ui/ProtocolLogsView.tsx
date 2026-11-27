import {
  Button,
  Circle,
  Divider,
  HStack,
  Image,
  List,
  Menu,
  NavigationStack,
  Rectangle,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
  ZStack,
  type Color,
  useState,
} from "scripting";
import type {
  AppLanguage,
  LiveLocationTelemetry,
  MFiStatus,
  ProtocolEvent,
  SessionSnapshot,
  TargetLocation,
} from "../types";
import { distanceMeters, formatDistanceMeters, formatLatLon } from "../utils/coords";
import { formatText, getStrings } from "../utils/i18n";
import { exportDiagnosticLogs, formatProtocolLogReport } from "../utils/logExport";
import {
  MetricTile,
  RelocPrimaryButton,
  SettingsIconBadge,
  ToolbarLeadingActions,
} from "./components";
import { RELOC_COLORS, sessionPhaseText } from "./theme";

type LogFilter = "all" | "nmea" | "errors";

interface ProtocolLogsViewProps {
  snapshot: SessionSnapshot;
  events: ProtocolEvent[];
  mfiStatus: MFiStatus;
  telemetry: LiveLocationTelemetry | null;
  activeWgs84Target: TargetLocation | null;
  language?: AppLanguage;
  onStartProbe: () => void;
  onStartSend: () => void;
  onStop: () => void;
  onRefreshTelemetry: () => void;
  onClearLogs: () => void;
  onToast: (message: string) => void;
  onClose?: () => void;
  homeTabSwitcher?: { currentTab: number; onSelectTab: (tab: number) => void };
}

function ProtocolLogsToolbarActions(props: {
  events: ProtocolEvent[];
  language?: AppLanguage;
  onClearLogs: () => void;
  onToast: (message: string) => void;
}) {
  const [copiedBanner, setCopiedBanner] = useState(false);
  const s = getStrings(props.language).logs;

  async function handleExport() {
    try {
      const msg = await exportDiagnosticLogs(props.events);
      props.onToast(msg);
    } catch (error) {
      props.onToast(formatText(s.exportFailed, error instanceof Error ? error.message : String(error)));
    }
  }

  return (
    <HStack spacing={12}>
      <Button
        buttonStyle="borderless"
        disabled={props.events.length === 0}
        action={() => {
          Pasteboard.setString(formatProtocolLogReport(props.events));
          HapticFeedback.lightImpact();
          setCopiedBanner(true);
          props.onToast(s.copiedReportToast);
          setTimeout(() => setCopiedBanner(false), 1500);
        }}
      >
        <Image systemName={copiedBanner ? "checkmark" : "doc.on.doc"} />
      </Button>
      <Menu label={<Image systemName="ellipsis.circle" />}>
        <Button
          disabled={props.events.length === 0}
          action={() => void handleExport()}
        >
          <HStack>
            <Image systemName="square.and.arrow.up" />
            <Text>{s.exportShare}</Text>
          </HStack>
        </Button>
        <Button
          role="destructive"
          disabled={props.events.length === 0}
          action={props.onClearLogs}
        >
          <HStack>
            <Image systemName="trash" />
            <Text>{s.clearLogs}</Text>
          </HStack>
        </Button>
      </Menu>
    </HStack>
  );
}

function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function ProtocolLogsView(props: ProtocolLogsViewProps) {
  const { snapshot, events, mfiStatus, telemetry, activeWgs84Target, language } = props;
  const s = getStrings(language).logs;
  const [filter, setFilter] = useState<LogFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEvents = events.filter((event) => {
    if (filter === "nmea") {
      const upper = `${event.name} ${event.detail}`.toUpperCase();
      if (
        !upper.includes("LOCATION") &&
        !upper.includes("NMEA") &&
        !upper.includes("GP") &&
        !upper.includes("FFFA") &&
        !upper.includes("FFFB")
      ) {
        return false;
      }
    }
    if (filter === "errors" && !event.isError) {
      return false;
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      event.name.toLowerCase().includes(q) ||
      event.detail.toLowerCase().includes(q) ||
      event.timestamp.toLowerCase().includes(q)
    );
  });

  const offsetMeters =
    telemetry && activeWgs84Target
      ? distanceMeters(
          { latitude: telemetry.latitude, longitude: telemetry.longitude },
          { latitude: activeWgs84Target.latitude, longitude: activeWgs84Target.longitude },
        )
      : null;

  function protocolBadge(title: string, subtitle: string, value: string, tint: Color, ok: boolean | null) {
    const shape = { type: "rect" as const, cornerRadius: 10, style: "continuous" as const };
    const bg: Color =
      ok === true
        ? "rgba(23, 184, 122, 0.13)"
        : ok === false
          ? "rgba(230, 64, 69, 0.13)"
          : "rgba(142, 142, 147, 0.13)";

    return (
      <HStack
        spacing={6}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        padding={{ horizontal: 9, vertical: 7 }}
        background={{ style: bg, shape }}
        clipShape={shape}
      >
        <Image
          systemName={ok === true ? "checkmark.circle.fill" : ok === false ? "exclamationmark.triangle.fill" : "questionmark.circle"}
          font="caption2"
          foregroundStyle={tint}
        />
        <VStack alignment="leading" spacing={0}>
          <Text font="caption2" fontWeight="semibold" fontDesign="monospaced" foregroundStyle={tint} lineLimit={1}>
            {`${title}: ${value}`}
          </Text>
          <Text font="caption2" fontDesign="monospaced" foregroundStyle="secondaryLabel" lineLimit={1}>
            {subtitle}
          </Text>
        </VStack>
      </HStack>
    );
  }

  const cardShape = { type: "rect" as const, cornerRadius: 18, style: "continuous" as const };
  const detailShape = { type: "rect" as const, cornerRadius: 8, style: "continuous" as const };
  const isSessionConnected = snapshot.isRunning && snapshot.authenticated;

  return (
    <NavigationStack ignoresSafeArea={{ regions: "container", edges: "vertical" }}>
      <VStack
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background={
          <Rectangle
            fill="systemGroupedBackground"
            ignoresSafeArea={{ regions: "all", edges: "vertical" }}
          />
        }
        navigationTitle={s.navTitle}
        navigationBarTitleDisplayMode="inline"
        searchable={{
          value: searchQuery,
          onChanged: setSearchQuery,
          prompt: s.searchPrompt,
        }}
        toolbar={{
          topBarLeading:
            props.homeTabSwitcher || props.onClose ? (
              <ToolbarLeadingActions
                homeTabSwitcher={props.homeTabSwitcher}
                onClose={props.onClose}
                language={language}
              />
            ) : undefined,
          topBarTrailing: (
            <ProtocolLogsToolbarActions
              events={events}
              language={language}
              onClearLogs={props.onClearLogs}
              onToast={props.onToast}
            />
          ),
        }}
      >
        {/* 顶部实测与协议链路仪表盘卡片 */}
        <VStack padding={{ horizontal: 14, top: 10, bottom: 10 }}>
          <VStack
            alignment="leading"
            spacing={10}
            padding={14}
            background={{ style: "secondarySystemGroupedBackground", shape: cardShape }}
            clipShape={cardShape}
            overlay={
              <ZStack allowsHitTesting={false}>
                <RoundedRectangle
                  cornerRadius={18}
                  style="continuous"
                  fill="clear"
                  stroke={{
                    shapeStyle: "rgba(142, 142, 147, 0.22)",
                    strokeStyle: { lineWidth: 0.8 },
                  }}
                />
              </ZStack>
            }
          >
            <HStack spacing={8}>
              <SettingsIconBadge
                systemName="sensor.tag.radiowaves.forward.fill"
                color={snapshot.isRunning ? RELOC_COLORS.emerald : RELOC_COLORS.accent}
              />
              <VStack alignment="leading" spacing={1}>
                <Text font="subheadline" fontWeight="semibold">
                  {s.telemetryTitle}
                </Text>
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  {formatText(
                    s.telemetryMeta,
                    sessionPhaseText(snapshot, language),
                    snapshot.lockdownConnected ? "✓" : "·",
                    snapshot.linkReady ? "✓" : "·",
                    snapshot.identified ? "✓" : "·",
                  )}
                </Text>
              </VStack>
              <Spacer />
              <Button
                buttonStyle="plain"
                action={() => {
                  HapticFeedback.lightImpact();
                  props.onRefreshTelemetry();
                }}
              >
                <HStack
                  padding={{ horizontal: 12, vertical: 6 }}
                  background={{ style: "rgba(43, 115, 245, 0.15)", shape: "capsule" }}
                  contentShape="capsule"
                >
                  <Text font="caption" fontWeight="semibold" foregroundStyle={RELOC_COLORS.accent}>
                    {s.refreshBtn}
                  </Text>
                </HStack>
              </Button>
            </HStack>

            <HStack spacing={8}>
              <MetricTile
                title={s.latLonTile}
                value={telemetry ? formatLatLon(telemetry.latitude, telemetry.longitude, 5) : s.clickToRefresh}
                tint="label"
              />
              <MetricTile
                title={offsetMeters !== null ? s.offsetTile : s.lastUpdateTile}
                value={
                  offsetMeters !== null
                    ? formatDistanceMeters(offsetMeters)
                    : telemetry
                      ? new Date(telemetry.timestamp).toLocaleTimeString()
                      : "--:--:--"
                }
                tint={
                  offsetMeters !== null
                    ? offsetMeters <= 20
                      ? RELOC_COLORS.emerald
                      : RELOC_COLORS.amber
                    : "secondaryLabel"
                }
              />
            </HStack>

            <HStack spacing={8}>
              {protocolBadge(
                s.mfiBadge,
                "0xAA02 -> 0xAA05",
                snapshot.authenticated ? s.mfiPassed : snapshot.isRunning ? s.mfiWaiting : s.mfiIdle,
                snapshot.authenticated ? RELOC_COLORS.emerald : "secondaryLabel",
                snapshot.authenticated ? true : null,
              )}
              {protocolBadge(
                s.injectBadge,
                snapshot.activeSentences.length > 0
                  ? snapshot.activeSentences.map((id) => (id === 1 ? "$GPGGA" : id === 2 ? "$GPRMC" : `#${id}`)).join("+")
                  : "0xFFFA / 0xFFFB",
                snapshot.packetsAcknowledged > 0 ? `ACK ${snapshot.packetsAcknowledged}` : snapshot.activeSentences.length > 0 ? s.waitFirstPacket : s.unsubscribed,
                snapshot.packetsAcknowledged > 0
                  ? RELOC_COLORS.emerald
                  : snapshot.lastError
                    ? RELOC_COLORS.crimson
                    : "secondaryLabel",
                snapshot.packetsAcknowledged > 0 ? true : snapshot.lastError ? false : null,
              )}
            </HStack>

            {/* 会话控制按钮：GlassProminent 彩色玻璃渲染 + 白色高对比文字 + 全热区点击 */}
            <HStack spacing={8}>
              {!snapshot.isRunning ? (
                <>
                  <RelocPrimaryButton
                    title={s.startProbe}
                    systemImage="waveform.path.ecg"
                    variant="prominent"
                    tint="systemTeal"
                    disabled={!mfiStatus.isLoaded}
                    action={props.onStartProbe}
                  />
                  <RelocPrimaryButton
                    title={s.startSend}
                    systemImage="play.fill"
                    variant="prominent"
                    tint={RELOC_COLORS.accent}
                    disabled={!mfiStatus.isLoaded}
                    action={props.onStartSend}
                  />
                </>
              ) : !isSessionConnected ? (
                <RelocPrimaryButton
                  title={snapshot.mode === "probe" ? s.probingBtn : s.connectingBtn}
                  loading
                  variant="prominent"
                  tint={RELOC_COLORS.accent}
                  action={props.onStop}
                />
              ) : (
                <RelocPrimaryButton
                  title={snapshot.mode === "probe" ? s.probeReadyStop : s.stopSessionBtn}
                  systemImage="stop.fill"
                  variant="prominent"
                  tint={snapshot.mode === "probe" ? RELOC_COLORS.emerald : RELOC_COLORS.crimson}
                  action={props.onStop}
                />
              )}
            </HStack>

            {snapshot.lastError ? (
              <Text font="caption2" foregroundStyle={RELOC_COLORS.crimson} lineLimit={2}>
                {formatText(s.recentError, snapshot.lastError)}
              </Text>
            ) : null}
          </VStack>
        </VStack>

        {/* 日志过滤胶囊栏 */}
        <HStack spacing={8} padding={{ horizontal: 14, bottom: 8 }}>
          {(
            [
              { id: "all", label: s.filterAll },
              { id: "nmea", label: s.filterNmea },
              { id: "errors", label: s.filterErrors },
            ] as { id: LogFilter; label: string }[]
          ).map((cat) => {
            const selected = filter === cat.id;
            return (
              <Button
                key={cat.id}
                buttonStyle="plain"
                action={() => {
                  HapticFeedback.lightImpact();
                  setFilter(cat.id);
                }}
              >
                <HStack
                  padding={{ horizontal: 12, vertical: 6 }}
                  background={{
                    style: selected ? RELOC_COLORS.accent : "rgba(142, 142, 147, 0.14)",
                    shape: "capsule",
                  }}
                  contentShape="capsule"
                >
                  <Text
                    font="caption"
                    fontWeight="semibold"
                    foregroundStyle={selected ? "white" : "label"}
                  >
                    {cat.label}
                  </Text>
                </HStack>
              </Button>
            );
          })}
          <Spacer />
          <Text font="caption2" monospacedDigit foregroundStyle="secondaryLabel">
            {formatText(s.eventCount, filteredEvents.length)}
          </Text>
        </HStack>

        <Divider />

        {filteredEvents.length === 0 ? (
          <VStack
            spacing={12}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            padding={{ horizontal: 32 }}
          >
            <Spacer />
            <Image
              systemName="waveform.path.ecg.rectangle"
              font="largeTitle"
              foregroundStyle="rgba(43, 115, 245, 0.65)"
            />
            <Text font="headline">{s.emptyTitle}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
              {s.emptyBody}
            </Text>
            <Spacer />
          </VStack>
        ) : (
          <List
            listStyle="plain"
            ignoresSafeArea={{ regions: "container", edges: "bottom" }}
          >
            {filteredEvents.map((event) => (
              <VStack
                key={event.id}
                alignment="leading"
                spacing={5}
                listRowInsets={{ top: 5, leading: 14, bottom: 5, trailing: 14 }}
                listRowSeparator="hidden"
              >
                <HStack spacing={8}>
                  <Circle
                    fill={event.isError ? RELOC_COLORS.crimson : RELOC_COLORS.accent}
                    frame={{ width: 6, height: 6 }}
                  />
                  <Text
                    font="caption"
                    fontWeight="semibold"
                    fontDesign="monospaced"
                    foregroundStyle={event.isError ? RELOC_COLORS.crimson : RELOC_COLORS.accent}
                    lineLimit={1}
                  >
                    {event.name}
                  </Text>
                  <Spacer />
                  <Text font="caption2" monospacedDigit foregroundStyle="secondaryLabel">
                    {formatShortTime(event.timestamp)}
                  </Text>
                </HStack>

                {event.detail ? (
                  <Text
                    font="caption2"
                    fontDesign="monospaced"
                    foregroundStyle={event.isError ? RELOC_COLORS.crimson : "label"}
                    padding={8}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                    background={{ style: "rgba(142, 142, 147, 0.10)", shape: detailShape }}
                  >
                    {event.detail}
                  </Text>
                ) : null}
              </VStack>
            ))}
          </List>
        )}
      </VStack>
    </NavigationStack>
  );
}
