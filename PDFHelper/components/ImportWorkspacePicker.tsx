import {
  Button,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Text,
  TextField,
  useState,
} from "scripting"
import type { SourceItem, WorkspaceId } from "../types"
import type { FileImportCandidate, FileImportChoice } from "../utils/importer"
import { parsePageRange } from "../utils/importer"

const WORKSPACE_OPTIONS = (
  <>
    <Text tag="primary">工作区 1</Text>
    <Text tag="secondary">工作区 2</Text>
  </>
)

function ImportWorkspacePicker(props: {
  sources: SourceItem[]
  defaultWorkspaceId: WorkspaceId
}) {
  const dismiss = Navigation.useDismiss()
  const [assignments, setAssignments] = useState<WorkspaceId[]>(() =>
    props.sources.map(() => props.defaultWorkspaceId)
  )

  return (
    <NavigationStack>
      <List
        navigationTitle="选择导入位置"
        navigationBarTitleDisplayMode="inline"
        presentationDetents={["medium"]}
        presentationDragIndicator="visible"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
          confirmationAction: <Button title="导入" action={() => dismiss(assignments)} />,
        }}
      >
        <Section footer={<Text>每个项目可以分别放入不同的工作区。</Text>}>
          {props.sources.map((source, index) => (
            <Picker
              key={source.id}
              title={source.name}
              pickerStyle="menu"
              value={assignments[index]}
              onChanged={(value: string) => {
                setAssignments((previous) => previous.map((workspaceId, itemIndex) =>
                  itemIndex === index ? value as WorkspaceId : workspaceId
                ))
              }}
            >
              {WORKSPACE_OPTIONS}
            </Picker>
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}

function FileImportOptionsSheet(props: { candidates: FileImportCandidate[] }) {
  const dismiss = Navigation.useDismiss()
  const [choices, setChoices] = useState<FileImportChoice[]>(() =>
    props.candidates.map((candidate) => ({
      workspaceId: "primary",
      mode: "whole",
      pageRange: `1-${Math.max(1, candidate.pageCount)}`,
    }))
  )

  const updateChoice = (index: number, update: Partial<FileImportChoice>) => {
    setChoices((previous) => previous.map((choice, itemIndex) =>
      itemIndex === index ? { ...choice, ...update } : choice
    ))
  }

  const confirm = async () => {
    for (let index = 0; index < props.candidates.length; index += 1) {
      const candidate = props.candidates[index]
      const choice = choices[index]
      if (candidate.kind !== "pdf" || candidate.notice || choice.mode !== "per-page") continue
      if (!parsePageRange(choice.pageRange, candidate.pageCount)) {
        await Dialog.alert({
          title: "页码范围无效",
          message: `${candidate.name}：请输入 1-${candidate.pageCount} 范围内的单页或连续页码`,
        })
        return
      }
    }
    dismiss(choices)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="导入设置"
        navigationBarTitleDisplayMode="inline"
        presentationDetents={["medium"]}
        presentationDragIndicator="visible"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
          confirmationAction: <Button title="导入" action={() => void confirm()} />,
        }}
      >
        {props.candidates.map((candidate, index) => (
          <Section
            key={`${candidate.path}-${index}`}
            header={<Text>{candidate.name}</Text>}
            footer={candidate.notice
              ? <Text foregroundStyle="systemRed">{candidate.notice}</Text>
              : candidate.kind === "pdf" ? <Text>共 {candidate.pageCount} 页</Text> : undefined}
          >
            <Picker
              title="导入到"
              pickerStyle="menu"
              value={choices[index].workspaceId}
              onChanged={(value: string) => updateChoice(index, { workspaceId: value as WorkspaceId })}
            >
              {WORKSPACE_OPTIONS}
            </Picker>
            {candidate.kind === "pdf" && !candidate.notice ? (
              <>
                <Picker
                  title="导入方式"
                  pickerStyle="segmented"
                  value={choices[index].mode}
                  onChanged={(value: string) => updateChoice(index, { mode: value as FileImportChoice["mode"] })}
                >
                  <Text tag="whole">整体</Text>
                  <Text tag="per-page">按页</Text>
                </Picker>
                {choices[index].mode === "per-page" ? (
                  <TextField
                    title="页码范围"
                    value={choices[index].pageRange}
                    prompt={`1-${candidate.pageCount}`}
                    keyboardType="numbersAndPunctuation"
                    onChanged={(value) => updateChoice(index, { pageRange: value })}
                  />
                ) : null}
              </>
            ) : null}
          </Section>
        ))}
      </List>
    </NavigationStack>
  )
}

export async function chooseImportWorkspaceAssignments(
  sources: SourceItem[],
  defaultWorkspaceId: WorkspaceId
): Promise<WorkspaceId[] | null> {
  if (sources.length === 0) return []

  const result = await Navigation.present<WorkspaceId[] | null>({
    element: <ImportWorkspacePicker sources={sources} defaultWorkspaceId={defaultWorkspaceId} />,
    modalPresentationStyle: "pageSheet",
  })

  return Array.isArray(result) && result.length === sources.length ? result : null
}

export async function chooseFileImportChoices(
  candidates: FileImportCandidate[]
): Promise<FileImportChoice[] | null> {
  if (candidates.length === 0) return null

  const result = await Navigation.present<FileImportChoice[] | null>({
    element: <FileImportOptionsSheet candidates={candidates} />,
    modalPresentationStyle: "pageSheet",
  })

  return Array.isArray(result) && result.length === candidates.length ? result : null
}
