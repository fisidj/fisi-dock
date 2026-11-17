// Pinned fixture: the prompt painters of Gentle Shell 4.8.0, as literal source text.
export function panelPromptRule(width: number): string {
	return "─".repeat(width);
}

export function framePromptLines(lines: string[], width: number): string[] {
	return [panelPromptRule(width), ...lines, panelPromptRule(width)];
}
