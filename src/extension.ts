"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as longPollingClient from "./longPollingClient";

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

export function activate(context: vscode.ExtensionContext) {
  console.log("Bobril companion is now active!");

  let c = new longPollingClient.Connection("http://localhost:8080/bb/api/main");

  let statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10
  );
  let connected = false;
  let disconnected = false;
  let reconnectDelay = 0;
  let compilationStatus = "";
  let testStatus = "";

  function updateStatusBar() {
    let s = "Disconnected";
    if (connected) {
      s = "Connected";
      if (compilationStatus || testStatus) s = compilationStatus + testStatus;
    } else if (!disconnected) {
      s = "Connecting";
    }
    statusBarItem.text = s;
    statusBarItem.show();
  }

  function reconnect() {
    disconnected = false;
    c.connect();
    updateStatusBar();
  }

  c.onClose = () => {
    connected = false;
    disconnected = true;
    updateStatusBar();
    if (reconnectDelay < 30000) reconnectDelay += 1000;
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
          "E:" + data.errors + " W:" + data.warnings + " " + data.time + "ms";
        updateStatusBar();
        break;
      }
      case "testUpdated": {
        let state = data as TestSvrState;
        testStatus = "";
        state.agents.forEach(a => {
          testStatus +=
            " F:" +
            a.testsFailed +
            "/" +
            a.totalTests +
            " " +
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
  var consoleLogDecorationType = vscode.window.createTextEditorDecorationType({
    borderWidth: "1px",
    borderStyle: "solid",
    overviewRulerColor: "blue",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
      // this color will be used in light color themes
      borderColor: "darkblue"
    },
    dark: {
      // this color will be used in dark color themes
      borderColor: "lightblue"
    }
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

  var timeout = null;
  function triggerUpdateDecorations() {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(updateDecorations, 500);
  }

  function updateDecorations() {
    if (!activeEditor) {
      return;
    }
    /*
        var regEx = /\d+/g;
        var text = activeEditor.document.fileName;
        var smallNumbers: vscode.DecorationOptions[] = [];
        var match;
        while (match = regEx.exec(text)) {
            var startPos = activeEditor.document.positionAt(match.index);
            var endPos = activeEditor.document.positionAt(match.index + match[0].length);
            var decoration = <vscode.DecorationOptions>{
                range: new vscode.Range(startPos, endPos),
                hoverMessage: 'Number **' + match[0] + '**'
            };
            if (match[0].length < 3) {
                smallNumbers.push(decoration);
            }

        }
        activeEditor.setDecorations(consoleLogDecorationType, smallNumbers);
        */
  }

  context.subscriptions.push(consoleLogDecorationType);
}

// this method is called when your extension is deactivated
export function deactivate() {}
