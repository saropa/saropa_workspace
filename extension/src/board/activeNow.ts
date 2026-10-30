// Which projects have a chat working in them now. Pure: the chats and the project folders come in.

// A chat idle for longer than this is not "active now".
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

// The fields of a chat the board uses.
export interface ChatSummary {
  // Working folder of the chat, an absolute path.
  folder: string;
  // Last activity, Unix time in milliseconds.
  last: number;
  // The live state name (for example "waiting"); undefined when the chat is idle.
  state?: string;
  archived: boolean;
}

export interface ProjectFolder {
  id: string;
  // The project's folder as an absolute path.
  folder: string;
}

// Forward slashes, no trailing slash; a Windows path (drive letter) is lower-cased because its
// case does not matter ("c:\\work" from a file path, "C:\\work" from Chat Explorer). POSIX stays exact.
function norm(p: string): string {
  const n = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(n) ? n.toLowerCase() : n;
}

// The ids of the projects that hold an unarchived chat which has a live state or was used within
// the window. A chat belongs to a project when its folder is the project folder or inside it
// (a worktree under the project counts).
export function activeProjects(chats: readonly ChatSummary[], projects: readonly ProjectFolder[], now: number): string[] {
  const live = chats.filter((c) => !c.archived && (c.state !== undefined || now - c.last <= ACTIVE_WINDOW_MS));
  return projects
    .filter((p) => {
      const root = norm(p.folder);
      return live.some((c) => {
        const f = norm(c.folder);
        return f === root || f.startsWith(root + "/");
      });
    })
    .map((p) => p.id);
}
