// Instrument types, inferred from a tag's name. Shared by server and client.
export type Kind = 'scalpel' | 'forceps' | 'scissors' | 'clamp' | 'generic';

export function kindOf(name: string): Kind {
  const n = name.toLowerCase();
  if (n.includes('scalpel') || n.includes('blade')) return 'scalpel';
  if (n.includes('forcep')) return 'forceps';
  if (n.includes('scissor')) return 'scissors';
  if (n.includes('clamp') || n.includes('hemostat')) return 'clamp';
  return 'generic';
}

export const isUnregistered = (name: string) => name.startsWith('Tag ');

export const KIND_LABEL: Record<Kind, string> = {
  scalpel: 'Scalpel',
  forceps: 'Tissue forceps',
  scissors: 'Mayo scissors',
  clamp: 'Towel clamp',
  generic: 'Instrument',
};
