import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execFileAsync = promisify(execFile);

export interface Branch {
	name: string;
	isRemote: boolean;
	fullName: string;
}

export interface Worktree {
	path: string;
	branch: string;
	isDetached: boolean;
	commit: string;
}

export class GitHelper {
	/**
	 * Run a git command and return stdout
	 */
	async runGit(args: string[], cwd: string): Promise<string> {
		try {
			const { stdout } = await execFileAsync("git", args, {
				cwd,
				maxBuffer: 10 * 1024 * 1024, // 10MB buffer
				encoding: "utf8",
			});
			return stdout.trim();
		} catch (error: any) {
			throw new Error(
				`Git command failed: ${error.message}\nCommand: git ${args.join(" ")}'`,
			);
		}
	}
	/**
	 * Get the repository root directory
	 */
	async getRepoRoot(cwd: string): Promise<string> {
		const result = await this.runGit(["rev-parse", "--show-toplevel"], cwd);
		return result.trim();
	}
	/**
	 * Get repository name from path
	 */
	getRepoName(repoRoot: string): string {
		return path.basename(repoRoot);
	}
	/**
	 * Check if directory is a git repository
	 */
	async isGitRepo(cwd: string): Promise<boolean> {
		try {
			await this.runGit(["rev-parse", "--git-dir"], cwd);
			return true;
		} catch {
			return false;
		}
	}
	/**
	 * Fetch all remote branches
	 */
	async fetchAll(cwd: string): Promise<void> {
		await this.runGit(["fetch", "--all", "--prune"], cwd);
	}
	/**
	 * * Get list of local branches
	 */
	async getLocalBranches(cwd: string): Promise<Branch[]> {
		const output = await this.runGit(
			["branch", "--format=%(refname:short)"],
			cwd,
		);
		return output
			.split("\n")
			.filter((line) => line.trim())
			.map((name) => ({
				name: name.trim(),
				isRemote: false,
				fullName: name.trim(),
			}));
	}
	/**
	 * Get list of remote branches
	 */
	async getRemoteBranches(cwd: string): Promise<Branch[]> {
		const output = await this.runGit(
			["branch", "-r", "--format=%(refname:short)"],
			cwd,
		);
		return output
			.split("\n")
			.filter((line) => line.trim())
			.filter((line) => !line.includes("HEAD ->")) // Filter out HEAD pointer
			.map((fullName) => {
				const name = fullName.replace(/^origin\//, "");
				return {
					name,
					isRemote: true,
					fullName: fullName.trim(),
				};
			});
	}
	/**
	 * Get all branches (local + remote, deduplicated)
	 */
	async getAllBranches(cwd: string): Promise<Branch[]> {
		const [localBranches, remoteBranches] = await Promise.all([
			this.getLocalBranches(cwd),
			this.getRemoteBranches(cwd),
		]);
		const localNames = new Set(localBranches.map((b) => b.name));
		const uniqueRemotes = remoteBranches.filter((b) => !localNames.has(b.name));
		return [...localBranches, ...uniqueRemotes];
	}
	/**
	 * Check if a local branch exists
	 */
	async branchExists(cwd: string, branchName: string): Promise<boolean> {
		try {
			await this.runGit(["rev-parse", "--verify", branchName], cwd);
			return true;
		} catch {
			return false;
		}
	}
	/**
	 * Create a local tracking branch from remote
	 */
	async createTrackingBranch(
		cwd: string,
		branchName: string,
		remoteBranch: string,
	): Promise<void> {
		await this.runGit(["branch", "--track", branchName, remoteBranch], cwd);
	}

	/**
	 * List all worktrees
	 */
	async listWorktrees(cwd: string): Promise<Worktree[]> {
		const output = await this.runGit(["worktree", "list", "--porcelain"], cwd);
		return this.parseWorktreeList(output);
	}
	/**
	 * Parse worktree list output
	 */
	private parseWorktreeList(output: string): Worktree[] {
		const worktrees: Worktree[] = [];
		const lines = output.split("\n");
		let current: Partial<Worktree> = {};
		for (const line of lines) {
			if (line.startsWith("worktree ")) {
				current.path = line.substring("worktree ".length);
			} else if (line.startsWith("HEAD")) {
				current.commit = line.substring("HEAD ".length);
			} else if (line.startsWith("branch ")) {
				const branchRef = line.substring("branch ".length);
				current.branch = branchRef.replace("refs/heads/", "");
				current.isDetached = false;
			} else if (line.startsWith("detached")) {
				current.isDetached = true;
				current.branch = "(detached)";
			} else if (line === "") {
				if (current.path) {
					worktrees.push(current as Worktree);
				}
				current = {};
			}
		}
		// Handle last entry
		if (current.path) {
			worktrees.push(current as Worktree);
		}
		return worktrees;
	}
	/**
	 * Check if worktree exists for a branch
	 */
	async worktreeExistsForBranch(
		cwd: string,
		branchName: string,
	): Promise<string | null> {
		const worktrees = await this.listWorktrees(cwd);
		const found = worktrees.find((wt) => wt.branch === branchName);
		return found ? found.path : null;
	}
	/**
	 * Add a new worktree
	 */
	async addWorktree(
		cwd: string,
		worktreePath: string,
		branchName: string,
	): Promise<void> {
		await this.runGit(["worktree", "add", worktreePath, branchName], cwd);
	}
	/**
	 * Remove a worktree
	 */
	async removeWorktree(cwd: string, worktreePath: string): Promise<void> {
		await this.runGit(["worktree", "remove", worktreePath], cwd);
	}
	/**
	 * Prune worktrees
	 */
	async pruneWorktrees(cwd: string): Promise<void> {
		await this.runGit(["worktree", "prune"], cwd);
	}
}
