import * as vscode from "vscode";
import { registerPerfReviewParticipant } from "./participants/perfReview.js";
import { registerScriptingParticipant } from "./participants/scripting.js";
import { registerEstimationParticipant } from "./participants/estimation.js";

export function activate(context: vscode.ExtensionContext): void {
  registerPerfReviewParticipant(context);
  registerScriptingParticipant(context);
  registerEstimationParticipant(context);

  vscode.window.showInformationMessage(
    "PERF Agents active: @perf-review, @scripting, @estimation"
  );
}

export function deactivate(): void {}
