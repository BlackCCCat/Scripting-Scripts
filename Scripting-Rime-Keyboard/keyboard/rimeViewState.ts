export type KeyboardRimeState = {
  preedit: string;
  preeditCursor: number;
  candidates: Rime.Candidate[];
  highlightedIdx: number;
  pageNo: number;
  rimePageSize: number;
  ascii: boolean;
  currentSchemaId: string | null;
};

export const EMPTY_KEYBOARD_RIME_STATE: KeyboardRimeState = {
  preedit: "",
  preeditCursor: 0,
  candidates: [],
  highlightedIdx: 0,
  pageNo: 0,
  rimePageSize: 5,
  ascii: false,
  currentSchemaId: null,
};

export class RimeViewStateController {
  private state: KeyboardRimeState;
  private listeners = new Set<(state: KeyboardRimeState) => void>();

  constructor(initialState: KeyboardRimeState = EMPTY_KEYBOARD_RIME_STATE) {
    this.state = initialState;
  }

  getSnapshot() {
    return this.state;
  }

  publish(state: KeyboardRimeState, notifyListeners = true) {
    if (this.state === state) return;
    this.state = state;
    if (!notifyListeners) return;
    for (const listener of this.listeners) listener(state);
  }

  subscribe(listener: (state: KeyboardRimeState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose() {
    this.listeners.clear();
  }
}
