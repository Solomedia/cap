// Fail closed: only an explicit "false" lets a deploy through.
export function parseFreeze(value: string | undefined): boolean {
	return value?.trim().toLowerCase() !== "false";
}
