const configStore: Record<string, Record<string, unknown>> = {
  claudeSessions: {
    projects: [],
    pollingInterval: 3000,
    cpuThreshold: 5.0,
    showStatusBar: true,
  },
};

const workspace = {
  getConfiguration(section: string) {
    const store = configStore[section] ?? {};
    return {
      get<T>(key: string, defaultValue?: T): T {
        const value = store[key];
        return (value !== undefined ? value : defaultValue) as T;
      },
      async update(key: string, value: unknown, _target?: unknown): Promise<void> {
        if (!configStore[section]) {
          configStore[section] = {};
        }
        configStore[section][key] = value;
      },
    };
  },
};

const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showOpenDialog: vi.fn(),
  showInputBox: vi.fn(),
  createStatusBarItem: vi.fn(() => ({
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    text: "",
    tooltip: "",
    color: undefined,
    command: undefined,
    name: undefined,
  })),
  createTerminal: vi.fn(),
};

const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: "file" }),
};

class EventEmitter {
  event = vi.fn();
  fire = vi.fn();
  dispose = vi.fn();
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

class TreeItem {
  label: string;
  collapsibleState: number;
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;

  constructor(label: string, collapsibleState: number = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

const ThemeIcon = vi.fn().mockImplementation((id: string) => ({ id }));
const ThemeColor = vi.fn().mockImplementation((id: string) => ({ id }));

class MarkdownString {
  value = "";
  appendMarkdown(text: string) {
    this.value += text;
  }
}

export function _resetConfigStore(): void {
  configStore.claudeSessions = {
    projects: [],
    pollingInterval: 3000,
    cpuThreshold: 5.0,
    showStatusBar: true,
  };
}

export {
  workspace,
  window,
  ConfigurationTarget,
  StatusBarAlignment,
  Uri,
  EventEmitter,
  TreeItemCollapsibleState,
  TreeItem,
  ThemeIcon,
  ThemeColor,
  MarkdownString,
};
