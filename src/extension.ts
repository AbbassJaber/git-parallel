import * as vscode from "vscode";
import { GitHelper } from "./gitHelper";
import { WorktreeManager } from "./worktreeManager";

export function activate(context: vscode.ExtensionContext) {
	const gitHelper = new GitHelper();
	const worktreeManager = new WorktreeManager(gitHelper);

	// Command: Open Branch in New Window
	const openBranchCommand = vscode.commands.registerCommand(
		"parallel-branch.openBranchInNewWindow",
		async () => {
			try {
				await worktreeManager.openBranchInNewWindow();
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to open branch: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		},
	);

	// Command: Manage Worktrees
	const manageWorktreesCommand = vscode.commands.registerCommand(
		"parallel-branch.manageWorktrees",
		async () => {
			try {
				await worktreeManager.manageWorktrees();
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to manage worktrees: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		},
	);
	// Command: Prune Worktrees
	const pruneWorktreesCommand = vscode.commands.registerCommand(
		"parallel-branch.pruneWorktrees",
		async () => {
			try {
				await worktreeManager.pruneWorktrees();
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to prune worktrees: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		},
	);
	context.subscriptions.push(
		openBranchCommand,
		manageWorktreesCommand,
		pruneWorktreesCommand,
	);
}
export function deactivate() {}
