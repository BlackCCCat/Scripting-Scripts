import { Navigation, NavigationStack, List, Section, Picker, Button, Text, VStack, HStack, Spacer, Toolbar, ToolbarItem, Image, ZStack } from 'scripting'
import { useState } from 'scripting'
import { Person } from '../types'
import { FormRow } from '../components'
import { deleteAvatar } from '../storage'
import { replaceDraftPhoto } from '../photoUtils'
import { pickAndCropPhoto } from './PhotoCropPage'

const RELATIONSHIP_OPTIONS = ['自己', '伴侣', '子女', '家人', '朋友', '同学', '同事', '其他']

// 判断关系值是否为内置选项
const isBuiltInRelationship = (value?: string) => value ? RELATIONSHIP_OPTIONS.includes(value) : false

interface PersonEditorPageProps {
  person?: Person
  onSave: (person: Person) => void
}

export function PersonEditorPage({ person, onSave }: PersonEditorPageProps) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(person?.name ?? '')
  const initialRelationship = person?.relationship ?? ''
  const [relationship, setRelationship] = useState(
    isBuiltInRelationship(initialRelationship) ? initialRelationship : '其他'
  )
  const [relationshipCustom, setRelationshipCustom] = useState(
    isBuiltInRelationship(initialRelationship) ? '' : initialRelationship
  )
  const [notes, setNotes] = useState(person?.notes ?? '')
  const [avatarPath, setAvatarPath] = useState(person?.avatarPath ?? null)
  const [isSaving, setIsSaving] = useState(false)

  // 记录编辑前的原始头像路径，用于保存后清理旧文件
  const originalAvatarPath = person?.avatarPath ?? null

  const isCustomRelationship = relationship === '其他'

  const pickAvatar = async () => {
    try {
      const path = await pickAndCropPhoto()
      if (!path) return
      setAvatarPath(await replaceDraftPhoto(path, avatarPath, person?.avatarPath ?? null))
    } catch (err) {
      console.log('选择头像失败:', err)
    }
  }

  const removeAvatar = async () => {
    if (avatarPath && avatarPath !== person?.avatarPath) {
      await deleteAvatar(avatarPath)
    }
    setAvatarPath(null)
  }

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setIsSaving(true)
    const trimmedCustom = relationshipCustom.trim()
    let finalRelationship = relationship
    if (isCustomRelationship && trimmedCustom) {
      finalRelationship = trimmedCustom
    }
    const updated: Person = {
      id: person?.id ?? '',
      name: trimmed,
      avatarPath,
      relationship: finalRelationship,
      notes: notes.trim(),
      isPinned: person?.isPinned, // 保留置顶状态
      createdAt: person?.createdAt ?? Date.now()
    }
    await onSave(updated)
    // 若头像已被更换或删除，则删除原头像文件
    if (originalAvatarPath && originalAvatarPath !== updated.avatarPath) {
      await deleteAvatar(originalAvatarPath)
    }
    setIsSaving(false)
    dismiss(updated)
  }

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle={person ? '编辑人物' : '新人物'}
        navigationBarTitleDisplayMode="inline"
        scrollIndicator="hidden"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button key="返回" action={dismiss}>
                <Image systemName="chevron.down" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button title="保存" systemImage="square.and.arrow.down" fontWeight="semibold" action={handleSave} disabled={isSaving || !name.trim()} />
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section>
          <ZStack frame={{ maxWidth: Infinity, height: 210 }} alignment="bottomTrailing" clipShape={{ type: 'rect', cornerRadius: 22, style: 'continuous' as const }}>
            <Button action={pickAvatar} buttonStyle="plain" frame={{ maxWidth: Infinity, height: 210 }}>
              {avatarPath ? (
                <Image
                  filePath={avatarPath}
                  resizable
                  scaleToFill
                  frame={{ maxWidth: Infinity, height: 210 }}
                />
              ) : (
                <VStack frame={{ maxWidth: Infinity, maxHeight: Infinity }} alignment="center" spacing={10} background="tertiarySystemGroupedBackground">
                  <Image systemName="photo.on.rectangle.angled" font={34} foregroundStyle="secondaryLabel" />
                  <Text foregroundStyle="secondaryLabel" font={14}>点击添加人物照片</Text>
                </VStack>
              )}
            </Button>
            {avatarPath ? (
              <Button
                title="删除"
                role="destructive"
                buttonStyle="bordered"
                font={13}
                action={removeAvatar}
                padding={{ bottom: 12, trailing: 12 }}
              />
            ) : null}
          </ZStack>
        </Section>

        <Section title="基本信息">
          <FormRow label="姓名" value={name} prompt="输入姓名" onChanged={setName} />
          <HStack spacing={12} frame={{ maxWidth: Infinity }}>
            <Picker
              label={<Text>关系</Text>}
              value={relationship}
              onChanged={(v: string) => setRelationship(v)}
              pickerStyle="menu"
            >
              {RELATIONSHIP_OPTIONS.map(option => (
                <Text key={option} tag={option}>{option}</Text>
              ))}
            </Picker>
            <Spacer />
          </HStack>
          {isCustomRelationship && (
            <FormRow label="自定义" value={relationshipCustom} prompt="请输入" onChanged={setRelationshipCustom} />
          )}
          <FormRow label="备注" value={notes} prompt="写下关于 TA 的点滴" onChanged={setNotes} />
        </Section>
      </List>
    </NavigationStack>
  )
}
