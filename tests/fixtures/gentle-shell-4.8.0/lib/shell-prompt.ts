// Hand-written pin of the prompt painter names Fisi Dock reads from Gentle Shell as of 4.8.0; the bodies are stand-ins, not upstream code.
export function panelPromptRule(width: number): string {
	return "─".repeat(width);
}

export function framePromptLines(lines: string[], width: number): string[] {
	return [panelPromptRule(width), ...lines, panelPromptRule(width)];
}
