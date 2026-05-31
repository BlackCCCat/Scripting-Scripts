import {
  VStack,
  HStack,
  Text,
  Image,
  ScrollView,
  Spacer,
  Button,
  Divider,
  VirtualNode,
} from "scripting"
import { FUELS, FuelCode } from "./types"
import { RADIUS_OPTIONS } from "./settings"
import { Theme } from "./theme"

/** 设置区块容器 */
function SettingSection({
  title,
  children,
}: {
  title: string
  children: (VirtualNode | null | undefined | boolean)[] | VirtualNode
}) {
  return (
    <VStack alignment="leading" spacing={10}>
      <Text font={13} fontWeight="semibold" foregroundStyle={Theme.secondary}>
        {title}
      </Text>
      <VStack
        spacing={0}
        background={Theme.cardBg}
        clipShape={{ type: "rect", cornerRadius: 14 }}
        frame={{ maxWidth: "infinity" }}
      >
        {children}
      </VStack>
    </VStack>
  )
}

/** 单个可选行 */
function OptionRow({
  label,
  selected,
  onTap,
  showDivider,
}: {
  label: string
  selected: boolean
  onTap: () => void
  showDivider: boolean
}) {
  return (
    <Button action={onTap}>
      <VStack spacing={0}>
        <HStack padding={{ horizontal: 14, vertical: 13 }}>
          <Text font={16} foregroundStyle="label">
            {label}
          </Text>
          <Spacer />
          {selected ? (
            <Image
              systemName="checkmark"
              font={15}
              fontWeight="semibold"
              foregroundStyle={Theme.orange}
            />
          ) : null}
        </HStack>
        {showDivider ? (
          <Divider padding={{ leading: 14 }} />
        ) : null}
      </VStack>
    </Button>
  )
}

export function SettingsPage({
  preferred,
  radiusKm,
  onPreferredChange,
  onRadiusChange,
}: {
  preferred: FuelCode
  radiusKm: number
  onPreferredChange: (code: FuelCode) => void
  onRadiusChange: (km: number) => void
}) {
  return (
    <ScrollView>
      <VStack
        spacing={22}
        alignment="leading"
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        padding={{ horizontal: 16, top: 12, bottom: 28 }}
      >
        <SettingSection title="首页放大显示的油品">
          {FUELS.map((f, i) => (
            <OptionRow
              label={f.fullName}
              selected={f.code === preferred}
              onTap={() => onPreferredChange(f.code)}
              showDivider={i < FUELS.length - 1}
            />
          ))}
        </SettingSection>

        <SettingSection title="附近加油站搜索半径">
          {RADIUS_OPTIONS.map((km, i) => (
            <OptionRow
              label={`${km} 公里`}
              selected={km === radiusKm}
              onTap={() => onRadiusChange(km)}
              showDivider={i < RADIUS_OPTIONS.length - 1}
            />
          ))}
        </SettingSection>

        <VStack alignment="leading" spacing={6} padding={{ horizontal: 4 }}>
          <Text font={12} foregroundStyle={Theme.secondary}>
            油价数据来自 qiyoujiage.com 公开页面，仅供参考。
          </Text>
          <Text font={12} foregroundStyle={Theme.secondary}>
            实际价格以加油站公示价格为准。
          </Text>
        </VStack>
      </VStack>
    </ScrollView>
  )
}
