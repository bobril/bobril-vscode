import * as vscode from "vscode";
import * as longPollingClient from "./longPollingClient";
import * as utils from "./utils";
import { stringify } from "querystring";

export interface StackFrame {
  functionName?: string;
  args?: any[];
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface SuiteOrTest {
  isSuite: boolean;
  name: string;
  skipped: boolean;
  failure: boolean;
  duration: number;
  failures: { message: string; stack: StackFrame[] }[];
  nested: SuiteOrTest[];
}

export interface TestResultsHolder extends SuiteOrTest {
  userAgent: string;
  running: boolean;
  testsFailed: number;
  testsSkipped: number;
  testsFinished: number;
  totalTests: number;
}

export interface TestSvrState {
  agents: TestResultsHolder[];
}

let liveReloadEnabled = false;
let coverageEnabled = false;
let coverageCache = new Map<string, number[]>();

export function activate(context: vscode.ExtensionContext) {
  console.log("Bobril companion is now active!");

  let c = new longPollingClient.Connection("http://localhost:8080/bb/api/main");

  context.subscriptions.push(
    vscode.commands.registerCommand("bobril.toggleCoverage", async () => {
      c.send("setCoverage", { value: !coverageEnabled });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("bobril.toggleLiveReload", async () => {
      c.send("setLiveReload", { value: !liveReloadEnabled });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("bobril.statusBarClicked", async () => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.items = [
        { label: "Toggle Coverage" },
        { label: "Toggle Live Reload" }
      ] as vscode.QuickPickItem[];

      quickPick.onDidChangeSelection((selection: vscode.QuickPickItem[]) => {
        if (selection[0]) {
          switch (quickPick.items.indexOf(selection[0])) {
            case 0:
              vscode.commands.executeCommand("bobril.toggleCoverage");
              break;
            case 1:
              vscode.commands.executeCommand("bobril.toggleLiveReload");
              break;
          }
        }
      });
      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    })
  );

  let statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10
  );
  statusBarItem.command = "bobril.statusBarClicked";
  let connected = false;
  let reconnectDelay = 0;
  let compiling = false;
  let compilationStatus = "";
  let testStatus = "";

  function updateStatusBar() {
    if (connected) {
      let s = "";
      if (liveReloadEnabled) {
        s += "$(refresh)";
      }
      if (coverageEnabled) {
        s += "$(checklist)";
      }
      if (compiling) {
        s += "$(zap~spin)";
      } else {
        s += "$(zap)";
      }
      s += compilationStatus + testStatus;
      statusBarItem.text = s;
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  }

  function reconnect() {
    c.connect();
    updateStatusBar();
  }

  c.onClose = () => {
    connected = false;
    updateStatusBar();
    if (reconnectDelay < 30000) {
      reconnectDelay += 1000;
    }
    setTimeout(() => {
      reconnect();
    }, reconnectDelay);
  };

  c.onMessage = (
    c: longPollingClient.Connection,
    message: string,
    data: any
  ) => {
    if (!connected) {
      connected = true;
      updateStatusBar();
    }
    switch (message) {
      case "compilationStarted": {
        compilationStatus = "Compiling";
        updateStatusBar();
        break;
      }
      case "compilationFinished": {
        compilationStatus =
          "$(error)" +
          data.errors +
          "$(warning)" +
          data.warnings +
          "$(watch)" +
          data.time +
          "ms";
        updateStatusBar();
        break;
      }
      case "testUpdated": {
        let state = data as TestSvrState;
        testStatus = "";
        state.agents.forEach(a => {
          testStatus +=
            (a.running ? "$(microscope~spin)" : "$(microscope)") +
            a.testsFailed +
            "/" +
            a.totalTests +
            "$(watch)" +
            a.duration.toFixed(0) +
            "ms";
        });
        updateStatusBar();
        break;
      }
      case "focusPlace": {
        focusPlace(data.fn, data.pos);
        break;
      }
      case "setLiveReload": {
        liveReloadEnabled = data.value;
        updateStatusBar();
        break;
      }
      case "setCoverage": {
        coverageEnabled = data.value;
        updateStatusBar();
        break;
      }
      case "coverageUpdated": {
        coverageCache.clear();
        triggerUpdateDecorations();
        break;
      }
      default: {
        console.log("Unknown message: " + message, data);
        break;
      }
    }
  };

  async function focusPlace(fn: string, pos: number[]) {
    function revealPlace(editor: vscode.TextEditor) {
      editor.selection = new vscode.Selection(
        pos[0] - 1,
        (pos[1] || 1) - 1,
        pos[0] - 1,
        (pos[1] || 1) - 1
      );
      editor.revealRange(
        new vscode.Range(
          pos[0] - 1,
          (pos[1] || 1) - 1,
          (pos[2] || pos[0]) - 1,
          (pos[3] || pos[1] || 1) - 1
        )
      );
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor &&
      activeEditor.document.uri.toString() === vscode.Uri.file(fn).toString()
    ) {
      revealPlace(activeEditor);
    } else {
      let td = await vscode.workspace.openTextDocument(fn);
      let editor = await vscode.window.showTextDocument(td);
      revealPlace(editor);
    }
  }

  reconnect();

  // create a decorator type that we use to decorate small numbers
  var fullyCoveredDecorationType = vscode.window.createTextEditorDecorationType(
    {
      backgroundColor: "rgba(0,255,0,20%)"
    }
  );

  var partiallyCoveredDecorationType = vscode.window.createTextEditorDecorationType(
    {
      backgroundColor: "rgba(255,255,0,40%)"
    }
  );

  var notCoveredDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255,0,0,20%)"
  });

  var activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    triggerUpdateDecorations();
  }

  vscode.window.onDidChangeActiveTextEditor(
    editor => {
      activeEditor = editor;
      if (editor) {
        triggerUpdateDecorations();
      }
    },
    null,
    context.subscriptions
  );

  vscode.workspace.onDidChangeTextDocument(
    event => {
      if (activeEditor && event.document === activeEditor.document) {
        triggerUpdateDecorations();
      }
    },
    null,
    context.subscriptions
  );

  var timeout: NodeJS.Timer | undefined = undefined;
  function triggerUpdateDecorations() {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(updateDecorations, 100);
  }

  interface FileCoverageResponse {
    status: "Unknown" | "Calculating" | "Done";
    ranges: number[];
  }

  function updateDecorations() {
    if (!activeEditor) {
      return;
    }
    var doc = activeEditor.document;
    var fileName = doc.fileName;
    if (coverageCache.has(fileName)) {
      var r = coverageCache.get(fileName)!;
      var coverageDecorations: vscode.DecorationOptions[][] = [[], [], []];
      for (var i = 0; i < r.length; ) {
        var range = new vscode.Range(r[i + 1], r[i + 2], r[i + 3], r[i + 4]);
        var hover = "";
        switch (r[i]) {
          case 0:
            hover = "Statement: " + r[i + 5];
            break;
          case 1:
            hover = "Condition Falsy: " + r[i + 5] + " Truthy: " + r[i + 6];
            break;
          case 2:
            hover = "Function: " + r[i + 5];
            break;
          case 3:
            hover = "Switch Branch: " + r[i + 5];
            break;
        }
        var decoration = <vscode.DecorationOptions>{
          range,
          hoverMessage: hover
        };
        let covType = 0;
        if (r[i] != 1) {
          if (r[i + 5]) covType = 2;
        } else {
          if (r[i + 5]) covType++;
          if (r[i + 6]) covType++;
        }
        coverageDecorations[covType].push(decoration);
        i += r[i] != 1 ? 6 : 7;
      }
      activeEditor!.setDecorations(
        fullyCoveredDecorationType,
        coverageDecorations[2]
      );
      activeEditor!.setDecorations(
        partiallyCoveredDecorationType,
        coverageDecorations[1]
      );
      activeEditor!.setDecorations(
        notCoveredDecorationType,
        coverageDecorations[0]
      );
    } else {
      utils
        .postRequest<FileCoverageResponse>("/bb/api/getFileCoverage", {
          fileName
        })
        .then(resp => {
          if (resp.status == "Done") {
            var r = resp.ranges;
            coverageCache.set(fileName, r);
            triggerUpdateDecorations();
          }
        });
    }
  }

  context.subscriptions.push(fullyCoveredDecorationType);
}

// this method is called when your extension is deactivated
export function deactivate() {
  coverageCache.clear();
}
