import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { GitHelper, Branch } from "./gitHelper";
export class WorktreeManager {
	constructor(private gitHelper: GitHelper) {}
	/**
	 * Get configuration value
	 */
	private getConfig<T>(key: string): T {
		return vscode.workspace.getConfiguration("parallelBranch").get<T>(key)!;
	}
	/**
	 * Get current workspace folder path
	 */
	private getCurrentWorkspacePath(): string {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error("No workspace folder is open");
		}
		return workspaceFolders[0].uri.fsPath;
	}
	/**
	 * Sanitize branch name for use in file paths
	 */
	private sanitizeBranchName(branchName: string): string {
		return branchName
			.replace(/\//g, "-")
			.replace(/\s+/g, "-")
			.replace(/[^a-zA-Z0-9_-]/g, "")
			.substring(0, 100);
	}
	/**
	 * Generate worktree path based on pattern
	 */
	private generateWorktreePath(repoRoot: string, branchName: string): string {
		const repoName = this.gitHelper.getRepoName(repoRoot);
		const pattern = this.getConfig<string>("worktreeFolderPattern");
		const sanitizedBranch = this.sanitizeBranchName(branchName);
		const folderName = pattern.replace("{branch}", sanitizedBranch);
		const parentDir = path.dirname(repoRoot);
		return path.join(parentDir, `${repoName}${folderName}`);
	}
	/**
	 * Open branch in new window
	 */
	async openBranchInNewWindow(): Promise<void> {
		const currentPath = this.getCurrentWorkspacePath();
		// Check if it's a git repo
		const isRepo = await this.gitHelper.isGitRepo(currentPath);
		if (!isRepo) {
			throw new Error("Current workspace is not a Git repository");
		}
		// Get repo root
		const repoRoot = await this.gitHelper.getRepoRoot(currentPath);
		// Auto-fetch if enabled
		const autoFetch = this.getConfig<boolean>("autoFetch");
		if (autoFetch) {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Fetching remote branches...",
					cancellable: false,
				},
				async () => {
					await this.gitHelper.fetchAll(repoRoot);
				},
			);
		}
		// Get all branches
		const branches = await this.gitHelper.getAllBranches(repoRoot);
		if (branches.length === 0) {
			throw new Error("No branches found in repository");
		}
		// Show quick pick
		const items = branches.map((branch) => ({
			label: branch.name,
			description: branch.isRemote ? "$(cloud) remote" : "$(git-branch) local",
			branch,
		}));
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: "Select a branch to open in a new window",
			matchOnDescription: true,
		});
		if (!selected) {
			return;
		}
		const branch = selected.branch;
		// Check if worktree already exists
		const existingWorktree = await this.gitHelper.worktreeExistsForBranch(
			repoRoot,
			branch.name,
		);
		if (existingWorktree) {
			// Worktree exists, just open it
			await this.openFolderInNewWindow(existingWorktree);
			vscode.window.showInformationMessage(
				`Opened existing worktree for branch '${branch.name}'`,
			);
			return;
		}
		// Generate worktree path
		const worktreePath = this.generateWorktreePath(repoRoot, branch.name);
		// Check if path exists but is not a worktree
		if (fs.existsSync(worktreePath)) {
			const action = await vscode.window.showWarningMessage(
				`Path '${worktreePath}' already exists but is not a worktree. What would you like to do?`,
				"Open Anyway",
				"Choose Another Path",
				"Cancel",
			);
			if (action === "Open Anyway") {
				await this.openFolderInNewWindow(worktreePath);
				return;
			} else if (action === "Choose Another Path") {
				const uri = await vscode.window.showOpenDialog({
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					openLabel: "Select Worktree Location",
				});
				if (!uri || uri.length === 0) {
					return;
				}

				await this.createAndOpenWorktree(repoRoot, uri[0].fsPath, branch);
				return;
			} else {
				return;
			}
		}

		// Create worktree
		await this.createAndOpenWorktree(repoRoot, worktreePath, branch);
	}

	/**
	 * Create worktree and optionally open it
	 */
	private async createAndOpenWorktree(
		repoRoot: string,
		worktreePath: string,
		branch: Branch,
	): Promise<void> {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Creating worktree for branch '${branch.name}'...`,
				cancellable: false,
			},
			async () => {
				// If remote branch, create local tracking branch first
				if (branch.isRemote) {
					const localExists = await this.gitHelper.branchExists(
						repoRoot,
						branch.name,
					);
					if (!localExists) {
						await this.gitHelper.createTrackingBranch(
							repoRoot,
							branch.name,
							branch.fullName,
						);
					}
				}
				// Add worktree
				await this.gitHelper.addWorktree(repoRoot, worktreePath, branch.name);
			},
		);
		vscode.window.showInformationMessage(
			`Worktree created for branch '${branch.name}' at ${worktreePath}`,
		);
		// Open if configured
		const openAfterCreate = this.getConfig<boolean>("openAfterCreate");
		if (openAfterCreate) {
			await this.openFolderInNewWindow(worktreePath);
		}
	}

	private async openFolderInNewWindow(folderPath: string): Promise<void> {
		const uri = vscode.Uri.file(folderPath);
		await vscode.commands.executeCommand("vscode.openFolder", uri, true);
	}

	async manageWorktrees(): Promise<void> {
		const currentPath = this.getCurrentWorkspacePath();
		const isRepo = await this.gitHelper.isGitRepo(currentPath);
		if (!isRepo) {
			throw new Error("Current workspace is not a Git repository");
		}
		const repoRoot = await this.gitHelper.getRepoRoot(currentPath);
		const worktrees = await this.gitHelper.listWorktrees(repoRoot);

		if (worktrees.length === 0) {
			vscode.window.showInformationMessage("No worktrees found");
			return;
		}
		const items = worktrees.map((wt) => ({
			label: wt.branch,
			description: wt.path,
			detail: wt.isDetached ? "Detached HEAD" : undefined,
			worktree: wt,
		}));
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: "Select a worktree to manage",
		});
		if (!selected) {
			return;
		}
		const action = await vscode.window.showQuickPick(
			[
				{ label: "$(folder-opened) Open in New Window", action: "open" },
				{ label: "$(trash) Remove Worktree", action: "remove" },
			],
			{
				placeHolder: `What would you like to do with '${selected.worktree.branch}'?`,
			},
		);
		if (!action) {
			return;
		}
		if (action.action === "open") {
			await this.openFolderInNewWindow(selected.worktree.path);
		} else if (action.action === "remove") {
			const confirm = await vscode.window.showWarningMessage(
				`Are you sure you want to remove worktree '${selected.worktree.branch}' at ${selected.worktree.path}?`,
				{ modal: true },
				"Yes",
				"No",
			);
			if (confirm === "Yes") {
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Removing worktree '${selected.worktree.branch}'...'`,
						cancellable: false,
					},
					async () => {
						await this.gitHelper.removeWorktree(
							repoRoot,
							selected.worktree.path,
						);
					},
				);
				vscode.window.showInformationMessage(
					`Worktree '${selected.worktree.branch}' removed successfully`,
				);
			}
		}
	}
	/**
	 * Prune worktrees
	 */
	async pruneWorktrees(): Promise<void> {
		const currentPath = this.getCurrentWorkspacePath();
		const isRepo = await this.gitHelper.isGitRepo(currentPath);
		if (!isRepo) {
			throw new Error("Current workspace is not a Git repository");
		}
		const repoRoot = await this.gitHelper.getRepoRoot(currentPath);
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Pruning worktrees...",
				cancellable: false,
			},
			async () => {
				await this.gitHelper.pruneWorktrees(repoRoot);
			},
		);
		vscode.window.showInformationMessage("Worktrees pruned successfully");
	}
}
