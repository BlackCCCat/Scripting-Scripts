// 收藏页：列出全部收藏位置，点击跳转地图，左滑删除，清空全部。
// 参考项目历史管理器的 trailingSwipeActions + Dialog.actionSheet 模式。

import { NavigationStack, List, HStack, VStack, Text, Button, Section, Image, Spacer } from "scripting";
import type { Coordinate, FavoriteLocation, ActiveLocation } from "../types";

declare const Dialog: any;

interface FavoritesPageProps {
  favorites: FavoriteLocation[];
  active: ActiveLocation | null;
  onPick: (coord: Coordinate, name: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export function FavoritesPage({ favorites, active, onPick, onDelete, onClearAll }: FavoritesPageProps) {
  // 左滑删除确认（参考项目历史管理器 Dialog.actionSheet 模式）
  async function handleDeleteFav(fav: FavoriteLocation) {
    const index = await Dialog.actionSheet({
      title: "删除确认",
      message: `确定删除收藏「${fav.name}」？`,
      actions: [
        { label: "取消" },
        { label: "删除", destructive: true },
      ],
      cancelButton: false,
    });
    if (index === 1) {
      onDelete(fav.id);
    }
  }

  // 清空全部确认
  async function handleClearAll() {
    const index = await Dialog.actionSheet({
      title: "清空确认",
      message: `确定清空全部 ${favorites.length} 项收藏？此操作不可恢复。`,
      actions: [
        { label: "取消" },
        { label: "清空全部", destructive: true },
      ],
      cancelButton: false,
    });
    if (index === 1) {
      onClearAll();
    }
  }

  return (
    <NavigationStack>
      <List navigationTitle="收藏的位置" navigationBarTitleDisplayMode="inline" listStyle="insetGroup">
        {favorites.length === 0 ? (
          <Section>
            <VStack alignment="center" frame={{ maxWidth: "infinity" }} padding={{ vertical: 48 }}>
              <Image systemName="star" foregroundStyle="tertiaryLabel" font="title" />
              <Text foregroundStyle="tertiaryLabel" font="subheadline" padding={{ top: 12 }}>
                暂无收藏
              </Text>
              <Text foregroundStyle="quaternaryLabel" font="caption2" padding={{ top: 4 }}>
                在地图上选好位置后点击「收藏」
              </Text>
            </VStack>
          </Section>
        ) : (
          <Section
            header={
              <HStack frame={{ maxWidth: "infinity" }}>
                <Text>{`共 ${favorites.length} 项`}</Text>
                <Spacer />
                <Button action={handleClearAll}>
                  <Text foregroundStyle="systemRed" font="subheadline">清空全部</Text>
                </Button>
              </HStack>
            }
          >
            {favorites.map((fav) => {
              const isActive =
                active != null &&
                Math.abs(fav.longitude - active.longitude) < 1e-6 &&
                Math.abs(fav.latitude - active.latitude) < 1e-6;
              return (
                <Button
                  key={fav.id}
                  action={() => onPick({ latitude: fav.latitude, longitude: fav.longitude }, fav.name)}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button
                        title="删除"
                        systemImage="trash"
                        tint="systemRed"
                        action={() => handleDeleteFav(fav)}
                      />
                    ],
                  }}
                >
                  <HStack spacing={20} padding={{ vertical: 4 }}>
                    <Image
                      systemName="star.fill"
                      foregroundStyle="systemYellow"
                      font={20}
                    />
                    <VStack alignment="leading" spacing={2}>
                      <Text foregroundStyle="label" font="body">{fav.name}</Text>
                      <Text font="caption" foregroundStyle="tertiaryLabel">
                        {fav.latitude.toFixed(6)}, {fav.longitude.toFixed(6)}
                      </Text>
                    </VStack>
                    {isActive ? (
                      <Spacer />
                    ) : null}
                    {isActive ? (
                      <HStack spacing={4}>
                        <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" font="caption" />
                        <Text foregroundStyle="systemGreen" font="caption">生效中</Text>
                      </HStack>
                    ) : null}
                  </HStack>
                </Button>
              );
            })}
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}
