export interface GoldenAutoModeCase {
  id: string;
  category: string;
  toolName: string;
  input: Record<string, string>;
  userIntent: string;
  expectBlock: boolean;
  expectPromptIncludes: string;
}
