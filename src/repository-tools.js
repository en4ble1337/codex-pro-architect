export const REPOSITORY_TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "repo_tree",
    description: "List tracked and non-ignored repository files. Use this first to understand repository shape.",
    parameters: {
      type: "object",
      properties: {
        max_entries: { type: "integer", minimum: 10, maximum: 100000 }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "read_file",
    description: "Read a line-numbered UTF-8 text file inside the repository. Paths must be repository-relative.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "search_code",
    description: "Search repository text with ripgrep, falling back to git grep. The pattern is treated as a regular expression.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, maxLength: 500 },
        glob: { type: "string", minLength: 1, maxLength: 200 },
        max_results: { type: "integer", minimum: 1, maximum: 5000 }
      },
      required: ["pattern"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "git_status",
    description: "Return concise branch and worktree status for the repository.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    type: "function",
    name: "git_diff",
    description: "Read a repository diff. working is unstaged, staged is index-only, and head is all changes from HEAD.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["working", "staged", "head"] },
        path: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "git_log",
    description: "Read recent commit hashes, dates, and subjects.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "git_show",
    description: "Inspect a commit or revision, optionally limited to one repository-relative path.",
    parameters: {
      type: "object",
      properties: {
        revision: { type: "string", minLength: 1, maxLength: 200 },
        path: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    }
  }
];
